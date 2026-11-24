import test from "node:test";
import assert from "node:assert/strict";
import { browserBinding, newBrowserBinding } from "../../apps/commerce-backend/src/modules/external-identity/browser.ts";

test("external OIDC browser binding uses a secure host-only cookie for HTTPS", async () => {
  const binding = await newBrowserBinding(true);
  assert.equal(await browserBinding(binding.requestCookie), binding.value);
  assert.match(binding.responseCookie, /(?:^|; )Secure(?:;|$)/);
  assert.match(binding.responseCookie, /(?:^|; )HttpOnly(?:;|$)/);
  assert.match(binding.responseCookie, /(?:^|; )SameSite=Lax(?:;|$)/);
  assert.match(binding.responseCookie, /(?:^|; )Path=\/auth\/customer\/external-oidc(?:;|$)/);
  assert.doesNotMatch(binding.responseCookie, /(?:^|; )Domain=/);
});

test("disposable loopback HTTP binding does not request a Secure cookie", async () => {
  const binding = await newBrowserBinding(false);
  assert.equal(await browserBinding(binding.requestCookie), binding.value);
  assert.doesNotMatch(binding.responseCookie, /(?:^|; )Secure(?:;|$)/);
});
