import { intentFixture } from './delegated-intent-helpers.mts';
import { DelegatedCheckoutApi } from '../../packages/commerce/delegated-checkout-api.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';

type Options = { configured?: boolean; receiptOptions?: Parameters<typeof intentFixture>[0] };
export async function checkoutHttpFixture(options: Options = {}) {
  const f = await intentFixture(options.receiptOptions);
  const logs: unknown[] = [];
  const api = new DelegatedCheckoutApi(f.kernel, { previews: f.previews, receipts: f.receiptOwner });
  const start = (configured = true) => startCommerceServer({ kernel: f.kernel, caps: f.caps,
    simulator: f.simulator, customers: f.customers, checkout: configured ? api : undefined,
    log: entry => { logs.push(entry); } });
  try {
    let server = await start(options.configured !== false);
    const request = (operation: string, input?: unknown, bearer = f.customerBearer, headers: Record<string, string> = {}) =>
      fetch(server.url + (operation.startsWith('/') ? operation : '/v1/delegated-checkout/' + operation), {
        method: input === undefined ? 'GET' : 'POST', headers: { ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
          ...(input === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(3000),
      });
    return { ...f, api, logs, request, get server() { return server; },
      get context() { return f.context; }, get verifyCalls() { return f.verifyCalls; },
      restartServer: async (configured = true) => { await server.close(); server = await start(configured); },
      dispose: async () => { await server.close(); f.cleanup(); },
    };
  } catch (error) { f.cleanup(); throw error; }
}
export async function usingCheckoutHttp(fn: (f: Awaited<ReturnType<typeof checkoutHttpFixture>>) => unknown, options: Options = {}) {
  const f = await checkoutHttpFixture(options); try { await fn(f); } finally { await f.dispose(); }
}
