import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { accessSync, constants, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createSecureContext } from 'node:tls';
import type { SecureContext } from 'node:tls';
import { claimCorrelation, claimOracle } from './delegated-command-claim-helpers.mts';

export const WORKLOAD_URI = 'spiffe://rifare.test/internal-use';
type Identity = { certificate_pem: string; private_key_pem: string; certificate_sha256: string };
type Credentials = { ca: Identity; otherCa: Identity; server: Identity; wrongHost: Identity;
  client: Identity; foreignClient: Identity; expiredClient: Identity; ambiguousClient: Identity; noUriClient: Identity };
export type PeerRequest = { method: string; path: string; headers: IncomingHttpHeaders; raw: Buffer; body: any;
  tls_authorized: boolean; certificate_sha256: string; session_reused: boolean; connection_id: number };
export type PeerHandler = (request: PeerRequest, response: ServerResponse, defaultResponse: any) => unknown;
type Options = { hold_handshake?: boolean; handler?: PeerHandler; server_identity?: 'valid' | 'wrong-host' };
const sha = (bytes: string | Buffer) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve };
}

let generated: { credentials: Credentials; runtime: Record<string, string> } | undefined;
/** Certificates are generated in an owned private directory, read into this test
 * process and immediately removed from disk. No keys or provider data are fixtures in Git. */
function identities() {
  if (generated) return generated;
  const directory = mkdtempSync(join(tmpdir(), 'rifare-use-tls-'));
  let stage = 'setup';
  try {
    let executable: string | undefined;
    const executableName = process.platform === 'win32' ? 'openssl.exe' : 'openssl';
    for (const entry of (process.env.PATH ?? '').split(delimiter)) {
      try { const path = join(entry, executableName); accessSync(path, constants.X_OK); executable = realpathSync(path); break; }
      catch { /* Only an available local executable can generate this fixture. */ }
    }
    if (!executable) throw new Error('TLS_FIXTURE_GENERATOR_UNAVAILABLE');
    const run = (...args: string[]) => {
      stage = args[0];
      return execFileSync(executable!, args, { cwd: directory,
        timeout: 5000, maxBuffer: 32768, stdio: ['ignore', 'pipe', 'pipe'] });
    };
    const runtime = { node: process.versions.node, node_openssl: process.versions.openssl,
      openssl_path: executable, openssl_version: run('version').toString('utf8').trim(),
      openssl_sha256: createHash('sha256').update(readFileSync(executable)).digest('hex') };
    const read = (name: string): Identity => {
      const certificate_pem = readFileSync(join(directory, name + '.pem'), 'utf8');
      return { certificate_pem, private_key_pem: readFileSync(join(directory, name + '.key'), 'utf8'),
        certificate_sha256: sha(new X509Certificate(certificate_pem).raw) };
    };
    for (const name of ['ca', 'other-ca']) run('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
      '-nodes', '-keyout', name + '.key', '-out', name + '.pem', '-days', '2', '-sha256', '-subj', '/CN=Rifare Synthetic CA',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
      '-addext', 'subjectAltName=URI:' + WORKLOAD_URI);
    let serial = 1;
    const leaf = (name: string, san: string, purpose: 'serverAuth' | 'clientAuth', ca = 'ca', days = '2') => {
      run('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
        '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=Rifare Synthetic Leaf');
      writeFileSync(join(directory, name + '.cnf'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n' +
        'extendedKeyUsage=' + purpose + '\n' + (san ? 'subjectAltName=' + san + '\n' : ''), { mode: 0o600 });
      run('x509', '-req', '-in', name + '.csr', '-CA', ca + '.pem', '-CAkey', ca + '.key',
        '-set_serial', String(serial++), '-out', name + '.pem', '-days', days, '-sha256', '-extfile', name + '.cnf');
      return read(name);
    };
    generated = { runtime, credentials: { ca: read('ca'), otherCa: read('other-ca'),
      server: leaf('server', 'DNS:localhost,IP:127.0.0.1', 'serverAuth'),
      wrongHost: leaf('wrong-host', 'DNS:wrong.example.invalid', 'serverAuth'),
      client: leaf('client', 'URI:' + WORKLOAD_URI, 'clientAuth'),
      foreignClient: leaf('foreign-client', 'URI:' + WORKLOAD_URI, 'clientAuth', 'other-ca'),
      expiredClient: leaf('expired-client', 'URI:' + WORKLOAD_URI, 'clientAuth', 'ca', '0'),
      ambiguousClient: leaf('ambiguous-client', 'URI:' + WORKLOAD_URI + ',URI:spiffe://rifare.test/other', 'clientAuth'),
      noUriClient: leaf('no-uri-client', 'DNS:localhost', 'clientAuth') } };
    return generated;
  } catch (error) {
    const failure = error as { status?: number; stderr?: Buffer };
    const configuration = failure.stderr?.toString().includes('config') ? 'CONFIG' : 'OTHER';
    throw new Error('TLS_FIXTURE_GENERATION_FAILED_' + stage.toUpperCase() + '_' +
      (typeof failure.status === 'number' ? failure.status : 'UNKNOWN') + '_' + configuration);
  }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

/** A local TLS peer with synthetic protocol responses, not a Marty emulator or
 * assertion about provider current policy. SNI provides a real handshake barrier. */
export async function delegatedUsePeer(options: Options = {}) {
  const { credentials, runtime } = identities(), correlation = structuredClone(claimCorrelation);
  const identity = options.server_identity === 'wrong-host' ? credentials.wrongHost : credentials.server;
  const context = createSecureContext({ key: identity.private_key_pem, cert: identity.certificate_pem,
    ca: credentials.ca.certificate_pem });
  const sockets = new Set<Socket>(), requests: PeerRequest[] = [], responses = new Map<string, any>();
  const held: ((error: Error | null, context?: SecureContext) => void)[] = [];
  let handshake = deferred(), hold = options.hold_handshake ?? false, handler = options.handler;
  let applicationBytes = 0, connections = 0, tlsConnections = 0, closed = false;
  const path = '/internal/v1/organizations/' + correlation.organization_id + '/delegated-use-commands';
  const server = createServer({ key: identity.private_key_pem, cert: identity.certificate_pem,
    ca: credentials.ca.certificate_pem, requestCert: true, rejectUnauthorized: true,
    minVersion: 'TLSv1.2', SNICallback(_name, callback) {
      handshake.resolve(); if (hold) held.push(callback); else callback(null, context);
    } }, (req, res) => {
    const chunks: Buffer[] = []; let bytes = 0;
    req.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) req.destroy(); else chunks.push(chunk); });
    req.on('error', () => { res.destroy(); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks), socket = req.socket as import('node:tls').TLSSocket;
      let body: any; try { body = JSON.parse(raw.toString('utf8')); } catch { body = null; }
      const record: PeerRequest = { method: req.method ?? '', path: req.url ?? '', headers: { ...req.headers }, raw, body,
        tls_authorized: socket.authorized, certificate_sha256: sha(socket.getPeerCertificate().raw ?? Buffer.alloc(0)),
        session_reused: socket.isSessionReused(), connection_id: socket.remotePort ?? 0 };
      requests.push(record);
      let result: any;
      res.statusCode = 200;
      if (req.method !== 'POST' || req.url !== path || !body) { res.statusCode = 400; result = { detail: 'INVALID_REQUEST' }; }
      else if (body.command === 'START_USE') {
        const digest = sha(raw), previous = responses.get(body.command_id);
        if (previous && previous.command_digest !== digest) { res.statusCode = 409; result = { detail: 'ORIGINAL_CONFLICT' }; }
        else {
          result = previous ?? { profile: 'urn:marty:delegation-command-response:v1', original_command_id: body.command_id,
            command_digest: digest, recovered: false, result: { ...structuredClone(claimOracle.challenge_response.result),
              grant: structuredClone(body.grant), operation: structuredClone(body.operation) } };
          responses.set(body.command_id, result);
        }
      } else if (body.command === 'RECOVER_RESULT') {
        const previous = responses.get(body.original_command_id);
        if (!previous) { res.statusCode = 404; result = { detail: 'RESULT_NOT_FOUND' }; }
        else if (previous.command_digest !== body.expected_command_digest) { res.statusCode = 409; result = { detail: 'ORIGINAL_CONFLICT' }; }
        else result = { ...previous, recovered: true };
      } else { res.statusCode = 400; result = { detail: 'UNSUPPORTED_COMMAND' }; }
      res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
      Promise.resolve().then(() => handler ? handler(record, res, result) : res.end(JSON.stringify(result)))
        .catch(() => { res.destroy(); });
    });
  });
  // Register after the HTTPS owner's connection listener. Its public socket.on
  // wrapper disables optimized parser consumption when a data observer is added;
  // prepending here would let the later parser bypass the plaintext witness.
  server.on('secureConnection', socket => {
    tlsConnections++; socket.on('data', bytes => { applicationBytes += bytes.length; });
  });
  server.on('connection', socket => { connections++; sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('TLS_FIXTURE_LISTEN_FAILED');
  const config = { origin: 'https://localhost:' + address.port, correlation,
    ca_pem: credentials.ca.certificate_pem, ...credentials.client, workload_uri: WORKLOAD_URI, timeout_ms: 2000 };
  return { config, correlation, credentials, requests, responses, runtime,
    get applicationBytes() { return applicationBytes; }, get connections() { return connections; },
    get tlsConnections() { return tlsConnections; }, get handshakeEntered() { return handshake.promise; },
    holdHandshake() { hold = true; handshake = deferred(); },
    releaseHandshake() { hold = false; for (const callback of held.splice(0)) callback(null, context); },
    setHandler(next?: PeerHandler) { handler = next; },
    async close() {
      if (closed) return; closed = true;
      for (const callback of held.splice(0)) callback(new Error('TLS_FIXTURE_CLOSED'));
      for (const socket of sockets) socket.destroy(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
export async function usingDelegatedUsePeer(fn: (peer: Awaited<ReturnType<typeof delegatedUsePeer>>) => unknown,
  options: Options = {}) {
  const peer = await delegatedUsePeer(options); try { return await fn(peer); } finally { await peer.close(); }
}
