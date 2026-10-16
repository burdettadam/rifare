import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';

export function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(body));
}
export function sameOrigin(req: IncomingMessage, port: number) {
  const host = `127.0.0.1:${port}`;
  if (req.headers.host !== host) throw new Error('HOST_DENIED');
  if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new Error('ORIGIN_DENIED');
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new Error('ORIGIN_DENIED');
}
export function authorize(req: IncomingMessage, secret: string) {
  const received = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from('Bearer ' + secret);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('AUTHORIZATION_REQUIRED');
}
export async function body(req: IncomingMessage) {
  if (req.headers['content-type'] !== 'application/json') throw new Error('JSON_REQUIRED');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('INVALID_JSON'); }
}
export function listen(server: Server, port: number): Promise<number> {
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 500;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve((server.address() as any).port));
  });
}
export function safeError(error: unknown) {
  const message = error instanceof Error && 'code' in error && error.code === 'EXTERNAL_EFFECT_DENIED'
    ? String(error.code) : error instanceof Error ? error.message : 'INTERNAL_ERROR';
  return /^[A-Z_]+$/.test(message) ? message : 'INTERNAL_ERROR';
}
