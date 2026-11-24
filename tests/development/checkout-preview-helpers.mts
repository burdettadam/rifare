import { readFileSync } from 'node:fs';
import type { FrozenCheckoutPreview } from '../../packages/commerce/checkout-preview.mts';

// Fixed synthetic input; no pricing/composition implementation in a fixture.
const preview = JSON.parse(readFileSync(new URL('../fixtures/delegated-receipts/binding-preview.v1.json', import.meta.url), 'utf8'));
export const previewDigest = 'faac6890d8c5efbeb20224759738d1fded8e82ad550fe3c5bf6ff13d1d98e525';
export function previewFixture(): FrozenCheckoutPreview { return structuredClone(preview); }
