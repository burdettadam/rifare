import { checkoutSnapshot } from '../../commerce/checkout-preview.mts';
import { ReceiptBindingDenied } from '../../commerce/delegated-receipt-binding.mts';

/** JSON.parse owns JSON syntax. A separate bounded scan checks member names in
 * the original text, before duplicate information can be lost. No signature or
 * canonicalization is implemented here. Returned claims reuse native snapshots. */
export function strictReceiptJson(bytes: Uint8Array, maximumBytes = 100_000): unknown {
  const fail = (): never => { throw new ReceiptBindingDenied('RECEIPT_JSON_INVALID'); };
  try {
    if (!bytes.length || bytes.length > maximumBytes) fail();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    const stack: { object: boolean; key: boolean; names: Set<string> }[] = [];
    let i = 0, tokens = 0;
    while (i < text.length) {
      if (++tokens > 32768) fail();
      const c = text[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') {
        const start = i++;
        while (i < text.length) {
          if (text[i] === '\\') { i += 2; continue; }
          if (text[i++] === '"') break;
        }
        const value: string = JSON.parse(text.slice(start, i));
        for (const point of value) {
          const code = point.codePointAt(0)!;
          if (code >= 0xd800 && code <= 0xdfff) fail();
        }
        const parent = stack.at(-1);
        if (parent?.object && parent.key) {
          if (parent.names.has(value)) fail();
          parent.names.add(value); parent.key = false;
        }
      } else if (c === '{' || c === '[') {
        stack.push({ object: c === '{', key: c === '{', names: new Set() }); i++;
        if (stack.length > 16) fail();
      } else if (c === '}' || c === ']') {
        stack.pop(); i++;
      } else if (c === ',') {
        const parent = stack.at(-1); if (parent?.object) parent.key = true; i++;
      } else if (c === ':') {
        i++;
      } else {
        // Syntax was already validated by JSON.parse; skip a primitive token.
        const start = i;
        while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
        const token = text.slice(start, i);
        if (/^-?[0-9]/.test(token)) {
          // This receipt profile has only nonnegative integer revisions. Check
          // original spelling before JSON.parse rounding can alias another value.
          // Fraction/exponent spellings are deliberately unsupported by this port.
          if (!/^(0|[1-9][0-9]{0,15})$/.test(token) || BigInt(token) > BigInt(Number.MAX_SAFE_INTEGER)) fail();
        }
      }
    }
    return checkoutSnapshot(parsed);
  } catch { fail(); }
}
