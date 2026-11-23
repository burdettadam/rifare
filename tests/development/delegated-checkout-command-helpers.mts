import { nativeStartFixture } from './delegated-checkout-start-helpers.mts';
import { DelegatedCheckoutApi } from '../../packages/commerce/delegated-checkout-api.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';

export type CommandHttpMode = 'live' | 'history' | 'absent';
type Options = Readonly<{ mode?: CommandHttpMode; shadowAuthorize?: boolean }>;

/** Actual native START owners and loopback server; no provider, receipt context
 * or JOSE fixture. History mode retains only the fixed local correlation. */
export async function commandHttpFixture(options: Options = {}) {
  const f = await nativeStartFixture(), logs: unknown[] = [];
  const makeApi = (mode: CommandHttpMode) => {
    const api = new DelegatedCheckoutApi(f.kernel, { previews: f.previews,
      ...(mode === 'absent' ? {} : { commands: { correlation: f.correlation,
        ...(mode === 'live' ? { starts: f.starts } : {}) } }) });
    if (options.shadowAuthorize) Object.defineProperty(api, 'authorize', { value() {} });
    return api;
  };
  const start = (api: DelegatedCheckoutApi) => startCommerceServer({ kernel: f.kernel, caps: f.caps,
    simulator: f.simulator, customers: f.customers, checkout: api, log: entry => { logs.push(entry); } });
  try {
    let api = makeApi(options.mode ?? 'live'), server = await start(api);
    const request = (operation: string, input?: unknown, bearer = f.bearer, headers: Record<string, string> = {}) =>
      fetch(server.url + (operation.startsWith('/') ? operation : '/v1/delegated-checkout-commands/' + operation), {
        method: input === undefined ? 'GET' : 'POST', headers: { ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
          ...(input === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(3000),
      });
    return { ...f, logs, request, get api() { return api; }, get server() { return server; },
      restartServer: async (mode: CommandHttpMode = 'history') => {
        await server.close(); api = makeApi(mode); server = await start(api);
      },
      dispose: async () => { try { await server.close(); } finally { f.cleanup(); } },
    };
  } catch (error) { f.cleanup(); throw error; }
}

export async function usingCommandHttp(fn: (f: Awaited<ReturnType<typeof commandHttpFixture>>) => unknown,
  options: Options = {}) {
  const f = await commandHttpFixture(options); try { return await fn(f); } finally { await f.dispose(); }
}
