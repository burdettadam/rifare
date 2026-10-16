// Test-process defense in depth, not a sandbox against malicious native code.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
let denied = false;
function block(): never { denied = true; throw new Error('RIFARE_TEST_NETWORK_DENIED'); }
for (const [target, keys] of [
  [net, ['connect','createConnection']], [net.Socket.prototype, ['connect']],
  [http, ['get','request']], [https, ['get','request']], [tls, ['connect']],
  [dns, Object.keys(dns).filter(k=>k.startsWith('resolve') || ['lookup','lookupService','reverse'].includes(k))],
  [dnsPromises, Object.keys(dnsPromises).filter(k=>k.startsWith('resolve') || ['lookup','lookupService','reverse'].includes(k))],
  [dns.Resolver.prototype, Object.getOwnPropertyNames(dns.Resolver.prototype).filter(k=>k.startsWith('resolve') || k==='reverse')],
  [dnsPromises.Resolver.prototype, Object.getOwnPropertyNames(dnsPromises.Resolver.prototype).filter(k=>k.startsWith('resolve') || k==='reverse')],
  [dgram, ['createSocket']]
] as const) for (const key of keys) (target as any)[key] = block;
globalThis.fetch = async () => block();
if (globalThis.WebSocket) globalThis.WebSocket = class { constructor() { block(); } } as any;
syncBuiltinESMExports();
process.on('beforeExit', () => {
  if (denied) { process.stderr.write('RIFARE_TEST_NETWORK_DENIED: attempted egress, even if caught\n'); process.exitCode = 1; }
});
process.on('exit', () => { if (denied) process.exitCode = 1; });
