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

export type InternalUseConfiguration = Readonly<{
  origin: string; correlation: CommandCorrelation; ca_pem: string; certificate_pem: string;
  private_key_pem: string; certificate_sha256: string; workload_uri: string; timeout_ms?: number;
}>;
export type InternalUseCode = 'INTERNAL_USE_CONFIG_INVALID' | 'INTERNAL_USE_INPUT_INVALID'
  | 'INTERNAL_USE_UNAVAILABLE' | 'INTERNAL_USE_GUARD_DENIED' | 'INTERNAL_USE_CAPACITY'
  | 'INTERNAL_USE_TRANSPORT_FAILED' | 'INTERNAL_USE_RESPONSE_INVALID' | 'INTERNAL_USE_TIMEOUT'
  | 'INTERNAL_USE_HTTP_UNRESOLVED';
export class InternalUseClientDenied extends Error {
  readonly code: InternalUseCode;
  constructor(code: InternalUseCode) { super(code); this.code = code; this.name = 'InternalUseClientDenied'; }
}
function fail(code: InternalUseCode): never { throw new InternalUseClientDenied(code); }
const MAX_PENDING = 8, MAX_HEADERS = 16_384;
const CERTIFICATE = /-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?/g;
const PRIVATE_KEY = /^-----BEGIN (PRIVATE KEY|EC PRIVATE KEY|RSA PRIVATE KEY)-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END \1-----\r?\n?$/;
function certificates(value: unknown, maximum: number): X509Certificate[] {
  if (typeof value !== 'string' || value.length > 65_536) fail('INTERNAL_USE_CONFIG_INVALID');
  const blocks = value.match(CERTIFICATE);
  if (!blocks || blocks.length > maximum || blocks.join('') !== value) fail('INTERNAL_USE_CONFIG_INVALID');
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
    fail('INTERNAL_USE_CONFIG_INVALID');
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/')
    fail('INTERNAL_USE_CONFIG_INVALID');
  return value;
}
function workload(value: unknown): string {
  // This local profile admits a narrower, unambiguous spelling than arbitrary
  // URI syntax: lowercase DNS trust domain and nonempty unreserved path parts.
  if (typeof value !== 'string' || value.length > 1024 ||
    !/^spiffe:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:\/[A-Za-z0-9_~.-]+)+$/.test(value))
    fail('INTERNAL_USE_CONFIG_INVALID');
  const parsed = new URL(value), segments = parsed.pathname.split('/').slice(1);
  if (parsed.href !== value || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
    parsed.hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
    segments.some(segment => segment === '.' || segment === '..')) fail('INTERNAL_USE_CONFIG_INVALID');
  return value;
}
function responseHeaders(response: IncomingMessage): void {
  if (response.statusCode !== 200) fail('INTERNAL_USE_HTTP_UNRESOLVED');
  const count = new Map<string, number>();
  for (let i = 0; i < response.rawHeaders.length; i += 2) {
    const name = response.rawHeaders[i].toLowerCase(); count.set(name, (count.get(name) ?? 0) + 1);
  }
  if (count.get('content-type') !== 1 || (count.get('content-encoding') ?? 0) > 1 ||
    (count.get('content-length') ?? 0) > 1) fail('INTERNAL_USE_RESPONSE_INVALID');
  const media = response.headers['content-type'], encoding = response.headers['content-encoding'];
  if (typeof media !== 'string' || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(media) ||
    (encoding !== undefined && encoding !== 'identity')) fail('INTERNAL_USE_RESPONSE_INVALID');
  const length = response.headers['content-length'];
  if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > MAX_COMMAND_BYTES))
    fail('INTERNAL_USE_RESPONSE_INVALID');
}

/** Explicit internal mTLS candidate only. Configured machine correlation is
 * bootstrap data, not observed provider actor/grant authority. The client has no
 * retry, durable state, proof construction, FINALIZE or receipt verification. */
export class InternalDelegatedUseClient {
  readonly #correlation: CommandCorrelation;
  readonly #url: URL;
  readonly #timeout: number;
  readonly #notBefore: number;
  readonly #notAfter: number;
  readonly #pending = new Set<() => void>();
  #credentials: { ca: Buffer[]; cert: Buffer; key: Buffer } | undefined;
  #lastTime = 0;
  #closed = false;

  constructor(input: InternalUseConfiguration) {
    try {
      const config = checkoutSnapshot(input);
      exact(config, ['origin', 'correlation', 'ca_pem', 'certificate_pem', 'private_key_pem',
        'certificate_sha256', 'workload_uri', ...(Object.hasOwn(config, 'timeout_ms') ? ['timeout_ms'] : [])]);
      const correlation = commandCorrelation(config.correlation);
      if (correlation.actor.type !== 'MACHINE_IDENTITY') fail('INTERNAL_USE_CONFIG_INVALID');
      const selectedOrigin = origin(config.origin), selectedWorkload = workload(config.workload_uri);
      const timeout = config.timeout_ms ?? 5000;
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) fail('INTERNAL_USE_CONFIG_INVALID');
      const now = Date.now(), roots = certificates(config.ca_pem, 8), [leaf] = certificates(config.certificate_pem, 1);
      if (!Number.isSafeInteger(now) || now < 0 || roots.some(root => !root.ca || !validAt(root, now)) ||
        leaf.ca || !validAt(leaf, now) || leaf.subjectAltName !== 'URI:' + selectedWorkload ||
        typeof config.private_key_pem !== 'string' || config.private_key_pem.length > 32_768 ||
        !PRIVATE_KEY.test(config.private_key_pem) || !leaf.checkPrivateKey(createPrivateKey(config.private_key_pem)) ||
        config.certificate_sha256 !== 'sha256:' + createHash('sha256').update(leaf.raw).digest('hex'))
        fail('INTERNAL_USE_CONFIG_INVALID');
      this.#correlation = correlation; this.#timeout = timeout;
      this.#url = new URL(selectedOrigin + '/internal/v1/organizations/' + correlation.organization_id + '/delegated-use-commands');
      this.#notBefore = leaf.validFromDate.getTime(); this.#notAfter = leaf.validToDate.getTime(); this.#lastTime = now;
      this.#credentials = { ca: roots.map(root => Buffer.from(root.toString())),
        cert: Buffer.from(config.certificate_pem), key: Buffer.from(config.private_key_pem) };
    } catch { fail('INTERNAL_USE_CONFIG_INVALID'); }
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
    if (this.#closed || !this.#credentials) fail('INTERNAL_USE_UNAVAILABLE');
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < this.#lastTime || now < this.#notBefore || now >= this.#notAfter)
      fail('INTERNAL_USE_UNAVAILABLE');
    this.#lastTime = now;
    if (deadline !== undefined && performance.now() >= deadline) fail('INTERNAL_USE_TIMEOUT');
  }
  #guard(guard: () => void): void {
    try {
      const returned = guard();
      if (returned !== undefined) {
        // An accidentally async native guard must neither send nor produce an
        // unhandled rejection. Arbitrary thenables are never invoked.
        if (types.isPromise(returned)) Promise.prototype.then.call(returned, undefined, () => {});
        fail('INTERNAL_USE_GUARD_DENIED');
      }
    } catch { fail('INTERNAL_USE_GUARD_DENIED'); }
  }
  #original(input: unknown): EncodedDelegatedCommand {
    try {
      const original = encodeDelegatedCommand(input);
      if (original.request.command !== 'START_USE') fail('INTERNAL_USE_INPUT_INVALID');
      return original;
    } catch { fail('INTERNAL_USE_INPUT_INVALID'); }
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
        fail('INTERNAL_USE_INPUT_INVALID');
    } catch { fail('INTERNAL_USE_INPUT_INVALID'); }
    return this.#send(retained, encoded, guard);
  }
  #send(original: EncodedDelegatedCommand, outbound: EncodedDelegatedCommand,
    guard: () => void): Promise<BoundDelegatedResponse> {
    if (typeof guard !== 'function') fail('INTERNAL_USE_INPUT_INVALID');
    this.#available();
    if (this.#pending.size >= MAX_PENDING) fail('INTERNAL_USE_CAPACITY');
    return new Promise((resolve, reject) => {
      const bytes = Buffer.from(outbound.canonical_json), deadline = performance.now() + this.#timeout;
      let active: ClientRequest | undefined, incoming: IncomingMessage | undefined, agent: Agent | undefined;
      let settled = false, timer: ReturnType<typeof setTimeout>;
      const finish = (error?: InternalUseClientDenied, result?: BoundDelegatedResponse) => {
        if (settled) return; settled = true; clearTimeout(timer); this.#pending.delete(cancel);
        active?.destroy(); incoming?.destroy(); agent?.destroy(); bytes.fill(0);
        if (error) reject(error); else resolve(result!);
      };
      const cancel = () => finish(new InternalUseClientDenied('INTERNAL_USE_UNAVAILABLE'));
      const failure = (error: unknown) => finish(error instanceof InternalUseClientDenied
        ? error : new InternalUseClientDenied('INTERNAL_USE_TRANSPORT_FAILED'));
      this.#pending.add(cancel);
      timer = setTimeout(() => finish(new InternalUseClientDenied('INTERNAL_USE_TIMEOUT')), this.#timeout);
      try {
        this.#guard(guard); this.#available(deadline);
        if (settled) return;
        // A fresh native agent has no connection/TLS-session reuse and receives
        // an explicitly empty proxy environment, never the process proxy config.
        agent = new Agent({ keepAlive: false, maxCachedSessions: 0, maxSockets: 1,
          maxTotalSockets: 1, proxyEnv: {} });
        active = request(this.#url, { method: 'POST', agent, ...this.#credentials!, rejectUnauthorized: true,
          minVersion: 'TLSv1.2', maxHeaderSize: MAX_HEADERS,
          headers: { 'content-type': 'application/json', accept: 'application/json',
            'content-length': String(bytes.length), connection: 'close' } }, response => {
          incoming = response;
          if (settled) { response.destroy(); return; }
          try { responseHeaders(response); } catch (error) { failure(error); return; }
          const chunks: Buffer[] = []; let received = 0;
          response.on('data', chunk => {
            if (settled) return;
            received += chunk.length;
            if (received > MAX_COMMAND_BYTES) finish(new InternalUseClientDenied('INTERNAL_USE_RESPONSE_INVALID'));
            else chunks.push(chunk);
          });
          response.once('error', () => finish(new InternalUseClientDenied('INTERNAL_USE_TRANSPORT_FAILED')));
          response.once('aborted', () => finish(new InternalUseClientDenied('INTERNAL_USE_TRANSPORT_FAILED')));
          response.once('end', () => {
            if (settled) return;
            try {
              this.#available(deadline);
              if (!response.complete || (response.headers['content-length'] !== undefined &&
                Number(response.headers['content-length']) !== received)) fail('INTERNAL_USE_RESPONSE_INVALID');
              let bound: BoundDelegatedResponse;
              try {
                bound = bindDelegatedResponse(original.request, Buffer.concat(chunks, received),
                  outbound.request.command === 'RECOVER_RESULT' ? { recovery: outbound.request } : {});
              } catch { fail('INTERNAL_USE_RESPONSE_INVALID'); }
              finish(undefined, bound);
            } catch (error) { failure(error); }
          });
          response.once('close', () => {
            if (!settled && !response.complete) finish(new InternalUseClientDenied('INTERNAL_USE_TRANSPORT_FAILED'));
          });
        });
        active.once('error', () => finish(new InternalUseClientDenied('INTERNAL_USE_TRANSPORT_FAILED')));
        active.once('socket', socket => {
          if (!(socket instanceof TLSSocket)) { failure(new InternalUseClientDenied('INTERNAL_USE_TRANSPORT_FAILED')); return; }
          socket.once('secureConnect', () => {
            if (settled) return;
            try {
              if (!socket.authorized || socket.authorizationError) fail('INTERNAL_USE_TRANSPORT_FAILED');
              // RCG4BC5-POST-TLS-GUARD: no headers, write, end or flush precedes
              // this authenticated-TLS guard. Real peer plaintext tests witness it.
              this.#guard(guard);
              this.#available(deadline);
              if (settled || active!.destroyed || socket.destroyed) fail('INTERNAL_USE_UNAVAILABLE');
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
