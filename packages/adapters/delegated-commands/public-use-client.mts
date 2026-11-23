import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { Agent, request } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';
import { types } from 'node:util';
import { checkoutSnapshot } from '../../commerce/checkout-preview.mts';
import { canonical } from '../../commerce/configuration-values.mts';
import { exact } from '../../commerce/kernel.mts';
import { commandCorrelation } from '../../commerce/delegated-command-claim-records.mts';
import type { CommandCorrelation } from '../../commerce/delegated-command-claim-records.mts';
import { encodeDelegatedCommand, createDelegatedRecovery, bindDelegatedResponse, MAX_COMMAND_BYTES } from './command-codec.mts';
import type { BoundDelegatedResponse, EncodedDelegatedCommand } from './command-codec.mts';

export type PublicUseConfiguration = Readonly<{
  origin: string; correlation: CommandCorrelation; ca_pem: string; certificate_pem: string;
  private_key_pem: string; certificate_sha256: string; workload_uri: string; timeout_ms?: number;
}>;
export type PublicUseCode = 'PUBLIC_USE_CONFIG_INVALID' | 'PUBLIC_USE_INPUT_INVALID'
  | 'PUBLIC_USE_UNAVAILABLE' | 'PUBLIC_USE_GUARD_DENIED' | 'PUBLIC_USE_CAPACITY'
  | 'PUBLIC_USE_TRANSPORT_FAILED' | 'PUBLIC_USE_RESPONSE_INVALID' | 'PUBLIC_USE_TIMEOUT'
  | 'PUBLIC_USE_HTTP_UNRESOLVED';
export class PublicUseClientDenied extends Error {
  readonly code: PublicUseCode;
  constructor(code: PublicUseCode) { super(code); this.code = code; this.name = 'PublicUseClientDenied'; }
}
function fail(code: PublicUseCode): never { throw new PublicUseClientDenied(code); }
const MAX_PENDING = 8, MAX_HEADERS = 16_384, MAX_REQUEST_BYTES = 100_000;
export type UnverifiedRequestArtifact = Readonly<{
  original_command_id: string; command_digest: string; challenge_id: string;
  request_uri: string; compact_jws: string;
  evidence_status: 'unverified_authorization_request'; execution_authorized: false;
  request_signature_verified: false; qualification: 'candidate_contract_only';
}>;
type RetainedRequest = Readonly<{ original: string; uri: string; challengeId: string }>;
const CERTIFICATE = /-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?/g;
const PRIVATE_KEY = /^-----BEGIN (PRIVATE KEY|EC PRIVATE KEY|RSA PRIVATE KEY)-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END \1-----\r?\n?$/;
function certificates(value: unknown, maximum: number): X509Certificate[] {
  if (typeof value !== 'string' || value.length > 65_536) fail('PUBLIC_USE_CONFIG_INVALID');
  const blocks = value.match(CERTIFICATE);
  if (!blocks || blocks.length > maximum || blocks.join('') !== value) fail('PUBLIC_USE_CONFIG_INVALID');
  return blocks.map(block => new X509Certificate(block));
}
function validAt(certificate: X509Certificate, now: number): boolean {
  const before = certificate.validFromDate.getTime(), after = certificate.validToDate.getTime();
  return Number.isFinite(before) && Number.isFinite(after) && before <= now && now < after;
}
function origin(value: unknown): string {
  // URL is a final syntax check, never a repair or a source of extra options.
  if (typeof value !== 'string' || value.length > 1024 ||
    !/^https:\/\/(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::[1-9][0-9]{0,4})?$/.test(value))
    fail('PUBLIC_USE_CONFIG_INVALID');
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/')
    fail('PUBLIC_USE_CONFIG_INVALID');
  return value;
}
function workload(value: unknown): string {
  // This local profile admits a narrower, unambiguous spelling than arbitrary
  // URI syntax: lowercase DNS trust domain and nonempty unreserved path parts.
  if (typeof value !== 'string' || value.length > 1024 ||
    !/^spiffe:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:\/[A-Za-z0-9_~.-]+)+$/.test(value))
    fail('PUBLIC_USE_CONFIG_INVALID');
  const parsed = new URL(value), segments = parsed.pathname.split('/').slice(1);
  if (parsed.href !== value || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
    parsed.hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
    segments.some(segment => segment === '.' || segment === '..')) fail('PUBLIC_USE_CONFIG_INVALID');
  return value;
}
function responseHeaders(response: IncomingMessage, artifact: boolean): void {
  if (response.statusCode !== 200) fail('PUBLIC_USE_HTTP_UNRESOLVED');
  const count = new Map<string, number>();
  for (let i = 0; i < response.rawHeaders.length; i += 2) {
    const name = response.rawHeaders[i].toLowerCase(); count.set(name, (count.get(name) ?? 0) + 1);
  }
  if (count.get('content-type') !== 1 || (count.get('content-encoding') ?? 0) > 1 ||
    (count.get('content-length') ?? 0) > 1) fail('PUBLIC_USE_RESPONSE_INVALID');
  const media = response.headers['content-type'], encoding = response.headers['content-encoding'];
  if (typeof media !== 'string' || !(artifact ? media === 'application/oauth-authz-req+jwt' : /^application\/json(?:;\s*charset=utf-8)?$/i.test(media)) ||
    (artifact ? encoding !== undefined : (encoding !== undefined && encoding !== 'identity'))) fail('PUBLIC_USE_RESPONSE_INVALID');
  const length = response.headers['content-length'];
  if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > (artifact ? MAX_REQUEST_BYTES : MAX_COMMAND_BYTES)))
    fail('PUBLIC_USE_RESPONSE_INVALID');
  if (artifact && (count.get('cache-control') !== 1 || response.headers['cache-control'] !== 'no-store' ||
    count.get('pragma') !== 1 || response.headers.pragma !== 'no-cache' ||
    count.get('x-content-type-options') !== 1 || response.headers['x-content-type-options'] !== 'nosniff'))
    fail('PUBLIC_USE_RESPONSE_INVALID');

}

/** Explicit public mTLS candidate only. Configured machine correlation is
 * bootstrap data, not observed provider actor/grant authority. The client has no
 * retry, durable state, proof construction, FINALIZE or receipt verification. */
export class PublicDelegatedUseClient {
  readonly #correlation: CommandCorrelation;
  readonly #url: URL;
  readonly #timeout: number;
  readonly #notBefore: number;
  readonly #notAfter: number;
  readonly #pending = new Set<() => void>();
  readonly #requests = new WeakMap<BoundDelegatedResponse, RetainedRequest>();
  #credentials: { ca: Buffer[]; cert: Buffer; key: Buffer } | undefined;
  #lastTime = 0;
  #closed = false;

  constructor(input: PublicUseConfiguration) {
    try {
      const config = checkoutSnapshot(input);
      exact(config, ['origin', 'correlation', 'ca_pem', 'certificate_pem', 'private_key_pem',
        'certificate_sha256', 'workload_uri', ...(Object.hasOwn(config, 'timeout_ms') ? ['timeout_ms'] : [])]);
      const correlation = commandCorrelation(config.correlation);
      if (correlation.actor.type !== 'MACHINE_IDENTITY') fail('PUBLIC_USE_CONFIG_INVALID');
      const selectedOrigin = origin(config.origin), selectedWorkload = workload(config.workload_uri);
      const timeout = config.timeout_ms ?? 5000;
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) fail('PUBLIC_USE_CONFIG_INVALID');
      const now = Date.now(), roots = certificates(config.ca_pem, 8), [leaf] = certificates(config.certificate_pem, 1);
      if (!Number.isSafeInteger(now) || now < 0 || roots.some(root => !root.ca || !validAt(root, now)) ||
        leaf.ca || !validAt(leaf, now) || leaf.subjectAltName !== 'URI:' + selectedWorkload ||
        typeof config.private_key_pem !== 'string' || config.private_key_pem.length > 32_768 ||
        !PRIVATE_KEY.test(config.private_key_pem) || !leaf.checkPrivateKey(createPrivateKey(config.private_key_pem)) ||
        config.certificate_sha256 !== 'sha256:' + createHash('sha256').update(leaf.raw).digest('hex'))
        fail('PUBLIC_USE_CONFIG_INVALID');
      this.#correlation = correlation; this.#timeout = timeout;
      this.#url = new URL(selectedOrigin + '/v1/organizations/' + correlation.organization_id + '/delegated-use-commands');
      this.#notBefore = leaf.validFromDate.getTime(); this.#notAfter = leaf.validToDate.getTime(); this.#lastTime = now;
      this.#credentials = { ca: roots.map(root => Buffer.from(root.toString())),
        cert: Buffer.from(config.certificate_pem), key: Buffer.from(config.private_key_pem) };
    } catch { fail('PUBLIC_USE_CONFIG_INVALID'); }
  }
  /** Concrete private owner identity only; this never authenticates a provider. */
  boundTo(correlation: CommandCorrelation): boolean {
    const retained = this.#correlation;
    try { return canonical(commandCorrelation(correlation)) === canonical(retained); }
    catch { return false; }
  }
  close(): void {
    if (this.#closed) return; this.#closed = true;
    for (const cancel of [...this.#pending]) cancel();
    this.#credentials?.key.fill(0); this.#credentials = undefined;
    // Releasing our references is not guaranteed runtime or OS memory erasure.
  }
  #available(deadline?: number): void {
    if (this.#closed || !this.#credentials) fail('PUBLIC_USE_UNAVAILABLE');
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < this.#lastTime || now < this.#notBefore || now >= this.#notAfter)
      fail('PUBLIC_USE_UNAVAILABLE');
    this.#lastTime = now;
    if (deadline !== undefined && performance.now() >= deadline) fail('PUBLIC_USE_TIMEOUT');
  }
  #guard(guard: () => void): void {
    try {
      const returned = guard();
      if (returned !== undefined) {
        // An accidentally async native guard must neither send nor produce an
        // unhandled rejection. Arbitrary thenables are never invoked.
        if (types.isPromise(returned)) Promise.prototype.then.call(returned, undefined, () => {});
        fail('PUBLIC_USE_GUARD_DENIED');
      }
    } catch { fail('PUBLIC_USE_GUARD_DENIED'); }
  }
  #original(input: unknown): EncodedDelegatedCommand {
    try {
      const original = encodeDelegatedCommand(input);
      if (original.request.command !== 'START_USE') fail('PUBLIC_USE_INPUT_INVALID');
      return original;
    } catch { fail('PUBLIC_USE_INPUT_INVALID'); }
  }
  async start(original: unknown, guard: () => void): Promise<BoundDelegatedResponse> {
    this.#available(); const encoded = this.#original(original);
    return this.#send(encoded, encoded, guard);
  }
  async recover(original: unknown, recovery: unknown, guard: () => void): Promise<BoundDelegatedResponse> {
    this.#available(); const retained = this.#original(original);
    let encoded: EncodedDelegatedCommand;
    try {
      encoded = encodeDelegatedCommand(recovery);
      if (encoded.canonical_json !== createDelegatedRecovery(retained.request).canonical_json)
        fail('PUBLIC_USE_INPUT_INVALID');
    } catch { fail('PUBLIC_USE_INPUT_INVALID'); }
    return this.#send(retained, encoded, guard);
  }
  async fetchRequest(original: unknown, challenge: BoundDelegatedResponse,
    guard: () => void): Promise<UnverifiedRequestArtifact> {
    this.#available();
    const encoded = this.#original(original), retained = this.#requests.get(challenge);
    if (!retained || retained.original !== encoded.canonical_json) fail('PUBLIC_USE_INPUT_INVALID');
    return this.#exchange(new URL(retained.uri), undefined, guard, (body) => {
      // ASCII spelling preserves the exact body bytes. No decoding or trust inference occurs.
      if (!body.length || body.length > MAX_REQUEST_BYTES || body.some(byte => byte > 127))
        fail('PUBLIC_USE_RESPONSE_INVALID');
      const compact = body.toString('ascii');
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compact))
        fail('PUBLIC_USE_RESPONSE_INVALID');
      return Object.freeze({
        original_command_id: encoded.original_command_id, command_digest: encoded.command_digest,
        challenge_id: retained.challengeId, request_uri: retained.uri, compact_jws: compact,
        evidence_status: 'unverified_authorization_request', execution_authorized: false,
        request_signature_verified: false, qualification: 'candidate_contract_only',
      });
    });
  }
  #send(original: EncodedDelegatedCommand, outbound: EncodedDelegatedCommand,
    guard: () => void): Promise<BoundDelegatedResponse> {
    return this.#exchange(this.#url, outbound, guard, (body, response) => {
      let bound: BoundDelegatedResponse;
      try {
        bound = bindDelegatedResponse(original.request, body,
          outbound.request.command === 'RECOVER_RESULT' ? { recovery: outbound.request } : {});
      } catch { fail('PUBLIC_USE_RESPONSE_INVALID'); }
      const links: string[] = [];
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        if (response.rawHeaders[i].toLowerCase() === 'link') links.push(response.rawHeaders[i + 1]);
      }
      if (bound.response.result.kind === 'CHALLENGE') {
        const challengeId = bound.response.result.challenge_id;
        const uri = this.#url.origin + '/v1/flows/instances/' + challengeId + '/request';
        if (links.length !== 1 || links[0] !== '<' + uri + '>; rel="urn:marty:delegated-use:request"')
          fail('PUBLIC_USE_RESPONSE_INVALID');
        this.#requests.set(bound, Object.freeze({ original: original.canonical_json, uri, challengeId }));
      } else if (links.length) fail('PUBLIC_USE_RESPONSE_INVALID');
      return bound;
    });
  }
  #exchange<T>(url: URL, outbound: EncodedDelegatedCommand | undefined, guard: () => void,
    parse: (body: Buffer, response: IncomingMessage) => T): Promise<T> {
    if (typeof guard !== 'function') fail('PUBLIC_USE_INPUT_INVALID');
    this.#available();
    if (this.#pending.size >= MAX_PENDING) fail('PUBLIC_USE_CAPACITY');
    return new Promise((resolve, reject) => {
      const bytes = Buffer.from(outbound?.canonical_json ?? ''), deadline = performance.now() + this.#timeout;
      let active: ClientRequest | undefined, incoming: IncomingMessage | undefined, agent: Agent | undefined;
      let settled = false, timer: ReturnType<typeof setTimeout>;
      const finish = (error?: PublicUseClientDenied, result?: T) => {
        if (settled) return; settled = true; clearTimeout(timer); this.#pending.delete(cancel);
        active?.destroy(); incoming?.destroy(); agent?.destroy(); bytes.fill(0);
        if (error) reject(error); else resolve(result!);
      };
      const cancel = () => finish(new PublicUseClientDenied('PUBLIC_USE_UNAVAILABLE'));
      const failure = (error: unknown) => finish(error instanceof PublicUseClientDenied
        ? error : new PublicUseClientDenied('PUBLIC_USE_TRANSPORT_FAILED'));
      this.#pending.add(cancel);
      timer = setTimeout(() => finish(new PublicUseClientDenied('PUBLIC_USE_TIMEOUT')), this.#timeout);
      try {
        this.#guard(guard); this.#available(deadline);
        if (settled) return;
        // A fresh native agent has no connection/TLS-session reuse and receives
        // an explicitly empty proxy environment, never the process proxy config.
        agent = new Agent({ keepAlive: false, maxCachedSessions: 0, maxSockets: 1,
          maxTotalSockets: 1, proxyEnv: {} });
        active = request(url, { method: outbound ? 'POST' : 'GET', agent, ...this.#credentials!, rejectUnauthorized: true,
          minVersion: 'TLSv1.2', maxHeaderSize: MAX_HEADERS,
          headers: outbound ? { 'content-type': 'application/json', accept: 'application/json',
            'content-length': String(bytes.length), connection: 'close' }
            : { accept: 'application/oauth-authz-req+jwt', connection: 'close' } }, response => {
          incoming = response;
          if (settled) { response.destroy(); return; }
          try { responseHeaders(response, !outbound); } catch (error) { failure(error); return; }
          const chunks: Buffer[] = []; let received = 0;
          response.on('data', chunk => {
            if (settled) return;
            received += chunk.length;
            if (received > (outbound ? MAX_COMMAND_BYTES : MAX_REQUEST_BYTES)) finish(new PublicUseClientDenied('PUBLIC_USE_RESPONSE_INVALID'));
            else chunks.push(chunk);
          });
          response.once('error', () => finish(new PublicUseClientDenied('PUBLIC_USE_TRANSPORT_FAILED')));
          response.once('aborted', () => finish(new PublicUseClientDenied('PUBLIC_USE_TRANSPORT_FAILED')));
          response.once('end', () => {
            if (settled) return;
            try {
              this.#available(deadline);
              if (!response.complete || (response.headers['content-length'] !== undefined &&
                Number(response.headers['content-length']) !== received)) fail('PUBLIC_USE_RESPONSE_INVALID');
              finish(undefined, parse(Buffer.concat(chunks, received), response));
            } catch (error) { failure(error); }
          });
          response.once('close', () => {
            if (!settled && !response.complete) finish(new PublicUseClientDenied('PUBLIC_USE_TRANSPORT_FAILED'));
          });
        });
        active.once('error', () => finish(new PublicUseClientDenied('PUBLIC_USE_TRANSPORT_FAILED')));
        active.once('socket', socket => {
          if (!(socket instanceof TLSSocket)) { failure(new PublicUseClientDenied('PUBLIC_USE_TRANSPORT_FAILED')); return; }
          socket.once('secureConnect', () => {
            if (settled) return;
            try {
              if (!socket.authorized || socket.authorizationError) fail('PUBLIC_USE_TRANSPORT_FAILED');
              // RCG4BC6-POST-TLS-GUARD: no headers, write, end or flush precedes
              // this authenticated-TLS guard. Real peer plaintext tests witness it.
              this.#guard(guard);
              this.#available(deadline);
              if (settled || active!.destroyed || socket.destroyed) fail('PUBLIC_USE_UNAVAILABLE');
              // All caller/native callbacks are finished. No await or further
              // owner dispatch may intervene before these exact application bytes.
              active!.end(bytes);
            } catch (error) { failure(error); }
          });
        });
      } catch (error) { failure(error); }
    });
  }
}
