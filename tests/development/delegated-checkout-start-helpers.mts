import { commandClaimFixture } from './delegated-command-claim-helpers.mts';
import { DelegatedCheckoutStarts } from '../../packages/commerce/delegated-checkout-starts.mts';
import { DelegatedCommandClaims } from '../../packages/commerce/delegated-command-claims.mts';

/** Real native preview and file-backed journal, without a receipt context,
 * provider, JOSE, transport or preexisting command claim. */
export async function nativeStartFixture() {
  const f = await commandClaimFixture();
  try {
    const read = f.quotes.read.bind(f.quotes);
    let reads = 0, armed = Infinity, quoteAction = () => {};
    f.quotes.read = (...args: Parameters<typeof read>) => {
      const result = read(...args); if (++reads === armed) quoteAction(); return result;
    };
    const previews = f.newOwner(), preview = await previews.prepare(f.customer, f.request);
    const grant = structuredClone(f.start.request.grant);
    const starts = new DelegatedCheckoutStarts(f.kernel, previews, { grant });
    const nativeClaims = new DelegatedCommandClaims(f.kernel, f.correlation, starts);
    const startRequest = { command_id: f.start.request.command_id, preview_id: preview.preview_id };
    return { ...f, previews, preview, grant, starts, nativeClaims, startRequest,
      claimNative: () => nativeClaims.claimCheckoutStart(f.customer, startRequest),
      afterQuoteReads: (additional: number, action: () => void) => { armed = reads + additional; quoteAction = action; },
      cleanup: () => { starts.close(); f.cleanup(); },
    };
  } catch (error) { f.cleanup(); throw error; }
}

export async function usingNativeStart(fn: (f: Awaited<ReturnType<typeof nativeStartFixture>>) => unknown) {
  const f = await nativeStartFixture(); try { return await fn(f); } finally { f.cleanup(); }
}
