'use strict';
(() => {
  // This controller presents native observations. It never grants execution,
  // provisions context, issues receipts, or retries a mutation automatically.
  const $ = id => document.getElementById(id);
  const presentation = window.RifarePresentation;
  const display = Object.freeze({ locale: 'en-US', time_zone: 'UTC' });
  const ID = /^[A-Za-z0-9_-]{1,96}$/;
  const HASH = /^[a-f0-9]{64}$/;
  const BEARER = /^[A-Za-z0-9_-]{43}$/;
  const COMPACT_RECEIPT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  const RECEIPT_CHARACTERS = 100000;
  const MINOR = /^(0|[1-9][0-9]{0,23})$/;
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const RESPONSE_BYTES = 262144;
  const REQUEST_TIMEOUT_MS = 10000;
  const routes = Object.freeze({
    'preview-status': '/v1/delegated-checkout/preview-status',
    prepare: '/v1/delegated-checkout/prepare',
    status: '/v1/delegated-checkout/status',
    receipt: '/v1/delegated-checkout/receipt',
    cancel: '/v1/delegated-checkout/cancel',
    lookup: '/v1/delegated-checkout-recovery/lookup',
  });
  const failures = Object.freeze({
    REQUEST_FAILED: 'The server response could not be confirmed.',
    TIMEOUT: 'The request timed out before a complete response was confirmed.',
    RESPONSE_INVALID: 'The response could not be safely matched to this review.',
    REQUEST_DENIED: 'The server did not accept the current session or customer proof.',
    NOT_FOUND: 'No original record was returned for these references.',
    CONFLICT: 'The current server record or authority has changed.',
    UNAVAILABLE: 'The server cannot provide this operation right now.',
    CAPACITY: 'The server is at its current limit.',
    INVALID_REQUEST: 'The server did not accept this request.',
    EXPIRED: 'The observed proposal deadline has passed.',
    CURRENCY_UNSUPPORTED: 'This page cannot safely format the proposal currency.',
  });
  const httpFailures = Object.freeze({
    400: 'INVALID_REQUEST', 403: 'REQUEST_DENIED', 404: 'NOT_FOUND',
    405: 'INVALID_REQUEST', 409: 'CONFLICT', 413: 'INVALID_REQUEST',
    415: 'INVALID_REQUEST', 429: 'CAPACITY', 500: 'REQUEST_FAILED', 503: 'UNAVAILABLE',
  });

  let session = '';
  let generation = 0;
  let pending = null;
  let expiryTimer = null;
  let original = null;       // Sticky until an explicit local/session clear.
  let preview = null;
  let intent = null;         // Sanitized presentation, never raw receipt data.
  let known = null;          // Last accepted identity/revision, even after a failed read.
  let needsStatus = false;
  let uncertain = null;
  let confirmation = null;
  let receiptAttempted = false; // A status without evidence never authorizes resubmission.

  class ReviewFailure extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  function requireValue(ok, code = 'RESPONSE_INVALID') {
    if (!ok) throw new ReviewFailure(code);
  }
  function exact(value, fields) {
    requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
    const keys = Object.keys(value);
    requireValue(keys.length === fields.length && fields.every(key => Object.hasOwn(value, key)));
    return value;
  }
  function identifier(value) { requireValue(typeof value === 'string' && ID.test(value)); return value; }
  function hash(value) { requireValue(typeof value === 'string' && HASH.test(value)); return value; }
  function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    requireValue(Number.isSafeInteger(value) && value >= minimum && value <= maximum);
    return value;
  }
  function minor(value) {
    requireValue(typeof value === 'string' && MINOR.test(value));
    return BigInt(value);
  }
  function money(value, currency) {
    minor(value);
    requireValue(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency));
    // The native preview accepts any uppercase currency code. Presentation uses
    // only the existing helper's explicit exponents; unknown precision is refused.
    requireValue(Object.hasOwn(presentation.currencies, currency), 'CURRENCY_UNSUPPORTED');
    return presentation.amount({ minor: value, currency }, display).formatted;
  }
  function instant(value) {
    integer(value, 0, 253402300799999);
    return presentation.instant(value, display).iso + ' (UTC)';
  }
  function interval(value) {
    instant(value.created_at); instant(value.expires_at);
    requireValue(value.created_at <= Date.now() && value.expires_at > value.created_at &&
      value.expires_at - value.created_at <= 600000);
  }
  function wellFormed(value) {
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++i);
        requireValue(next >= 0xdc00 && next <= 0xdfff);
      } else requireValue(unit < 0xdc00 || unit > 0xdfff);
    }
    return value;
  }

  // JSON.parse alone cannot reject duplicate (including escaped) member names.
  // The bounded decoder parses each string/number once and accepts no extensions.
  function strictJson(text, secret) {
    let offset = 0, visited = 0;
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    function whitespace() {
      while (offset < text.length && ' \t\r\n'.includes(text[offset])) offset++;
    }
    function string() {
      requireValue(text[offset] === '"');
      const start = offset++;
      while (offset < text.length) {
        const char = text[offset++];
        if (char === '\\') { offset++; continue; }
        if (char === '"') {
          let value;
          try { value = JSON.parse(text.slice(start, offset)); }
          catch { throw new ReviewFailure('RESPONSE_INVALID'); }
          wellFormed(value);
          requireValue(!secret || !value.includes(secret));
          return value;
        }
      }
      throw new ReviewFailure('RESPONSE_INVALID');
    }
    function value(depth) {
      requireValue(depth <= 16 && ++visited <= 20000);
      whitespace();
      if (text[offset] === '"') return string();
      if (text[offset] === '{') {
        offset++; whitespace();
        const object = Object.create(null), names = new Set();
        if (text[offset] === '}') { offset++; return object; }
        while (true) {
          whitespace(); const key = string();
          requireValue(!names.has(key)); names.add(key);
          whitespace(); requireValue(text[offset++] === ':');
          object[key] = value(depth + 1);
          if (key === 'execution_authorized') requireValue(object[key] === false);
          whitespace(); const separator = text[offset++];
          if (separator === '}') return object;
          requireValue(separator === ',');
        }
      }
      if (text[offset] === '[') {
        offset++; whitespace();
        const array = [];
        if (text[offset] === ']') { offset++; return array; }
        while (true) {
          array.push(value(depth + 1)); whitespace();
          const separator = text[offset++];
          if (separator === ']') return array;
          requireValue(separator === ',');
        }
      }
      for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
        if (text.startsWith(literal, offset)) { offset += literal.length; return result; }
      }
      number.lastIndex = offset;
      const found = number.exec(text);
      requireValue(found !== null);
      offset = number.lastIndex;
      const result = Number(found[0]);
      requireValue(Number.isFinite(result));
      return result;
    }
    const result = value(0);
    whitespace(); requireValue(offset === text.length);
    return result;
  }

  function validateQuote(value, currency, expectedAmount) {
    exact(value, ['quote_id', 'source_identity', 'source_revision', 'amount_minor', 'currency', 'explicit_zero']);
    identifier(value.quote_id); identifier(value.source_identity); identifier(value.source_revision);
    requireValue(value.currency === currency && value.amount_minor === expectedAmount &&
      value.explicit_zero === (minor(value.amount_minor) === 0n));
  }
  function validatePreview(value, references) {
    exact(value, ['schema_version', 'preview_id', 'tenant_id', 'store_id', 'merchant_id', 'resource_id',
      'customer_id', 'cart_id', 'cart_operation_id', 'cart_preview_digest', 'currency', 'items',
      'subtotal_minor', 'tax_minor', 'shipping_minor', 'fees_minor', 'total_payable_minor',
      'pricing_source_identity', 'pricing_source_revision', 'shipping_quote', 'fee_quote',
      'terms_digest', 'created_at', 'expires_at', 'preview_digest', 'qualification']);
    requireValue(value.schema_version === 1 && value.qualification === 'synthetic_only' &&
      value.preview_id === references.preview_id);
    for (const key of ['preview_id', 'tenant_id', 'store_id', 'merchant_id', 'resource_id', 'customer_id',
      'cart_id', 'cart_operation_id', 'pricing_source_identity']) identifier(value[key]);
    for (const key of ['cart_preview_digest', 'pricing_source_revision', 'terms_digest', 'preview_digest']) hash(value[key]);
    interval(value);
    requireValue(Date.now() < value.expires_at, 'EXPIRED');
    requireValue(Array.isArray(value.items) && value.items.length >= 1 && value.items.length <= 30);
    let subtotal = 0n, tax = 0n;
    const variants = new Set();
    const items = value.items.map(item => {
      exact(item, ['variant_id', 'product_id', 'quantity', 'unit_minor', 'tax_minor', 'line_total_minor',
        'currency', 'source_revision', 'terms_digest']);
      identifier(item.variant_id); identifier(item.product_id); identifier(item.source_revision); hash(item.terms_digest);
      integer(item.quantity, 1, 20);
      requireValue(!variants.has(item.variant_id) && item.currency === value.currency);
      variants.add(item.variant_id);
      const base = minor(item.unit_minor) * BigInt(item.quantity), itemTax = minor(item.tax_minor);
      requireValue(base + itemTax === minor(item.line_total_minor));
      subtotal += base; tax += itemTax;
      return Object.freeze({ product_id: item.product_id, variant_id: item.variant_id, quantity: item.quantity,
        unit: money(item.unit_minor, value.currency), tax: money(item.tax_minor, value.currency),
        total: money(item.line_total_minor, value.currency) });
    });
    requireValue(subtotal === minor(value.subtotal_minor) && tax === minor(value.tax_minor) &&
      subtotal + tax + minor(value.shipping_minor) + minor(value.fees_minor) === minor(value.total_payable_minor));
    validateQuote(value.shipping_quote, value.currency, value.shipping_minor);
    validateQuote(value.fee_quote, value.currency, value.fees_minor);
    const amounts = {};
    for (const [name, field] of [['subtotal', 'subtotal_minor'], ['tax', 'tax_minor'], ['shipping', 'shipping_minor'],
      ['fees', 'fees_minor'], ['total', 'total_payable_minor']]) amounts[name] = money(value[field], value.currency);
    return Object.freeze({ preview_id: value.preview_id, context_id: references.context_id,
      resource_id: value.resource_id, cart_id: value.cart_id, merchant_id: value.merchant_id,
      preview_digest: value.preview_digest, currency: value.currency, total_payable_minor: value.total_payable_minor,
      created_at: value.created_at, expires_at: value.expires_at, items: Object.freeze(items), amounts: Object.freeze(amounts) });
  }
  function receiptInstant(value) {
    requireValue(typeof value === 'string');
    const found = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]{1,9}))?Z$/.exec(value);
    requireValue(found !== null);
    const fraction = (found[2] || '').padEnd(9, '0');
    const canonical = found[1] + '.' + fraction.slice(0, 3) + 'Z';
    const epoch = Date.parse(canonical);
    integer(epoch, 0, 253402300799999);
    requireValue(new Date(epoch).toISOString() === canonical);
    return BigInt(epoch) * 1000000n + BigInt(fraction.slice(3));
  }
  function validateReceipt(receipt, value) {
    exact(receipt, ['receipt_id', 'grant_id', 'grant_revision', 'challenge', 'operation_digest',
      'checkout_preview_digest', 'issuer_key_id', 'policy_version_digest', 'issued_at', 'expires_at',
      'execution_authorized', 'qualification']);
    requireValue(typeof receipt.receipt_id === 'string' && UUID.test(receipt.receipt_id) &&
      typeof receipt.grant_id === 'string' && UUID.test(receipt.grant_id));
    integer(receipt.grant_revision, 1);
    requireValue(typeof receipt.challenge === 'string' && /^[\x21-\x7e]{22,128}$/.test(receipt.challenge) &&
      typeof receipt.issuer_key_id === 'string' && receipt.issuer_key_id.length >= 1 && receipt.issuer_key_id.length <= 16384 &&
      typeof receipt.policy_version_digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(receipt.policy_version_digest));
    requireValue(receipt.execution_authorized === false && receipt.qualification === 'candidate_contract_only' &&
      receipt.checkout_preview_digest === value.purchase.preview_digest &&
      receipt.operation_digest === 'sha256:' + value.purchase.preview_digest);
    const issued = receiptInstant(receipt.issued_at), expires = receiptInstant(receipt.expires_at);
    const verified = BigInt(value.verified_at) * 1000000n;
    requireValue(issued <= verified && verified < expires && expires > issued && expires - issued <= 600000000000n);
    // Ceil to the native millisecond boundary; retain only a local action deadline.
    return Number((expires + 999999n) / 1000000n);
  }
  function validateIntent(value, request, operation, expected, proposal) {
    exact(value, ['intent_id', 'resource_id', 'revision', 'created_at', 'expires_at', 'state', 'authority_revoked',
      'minimized', 'binding_digest', 'purchase', 'receipt', 'verified_at', 'evidence_status',
      'execution_authorized', 'qualification']);
    requireValue(typeof value.intent_id === 'string' && /^delegated_intent_[a-f0-9]{40}$/.test(value.intent_id));
    identifier(value.resource_id); hash(value.binding_digest); integer(value.revision, 1); interval(value);
    requireValue(['prepared', 'evidence_verified', 'cancelled', 'expired'].includes(value.state) &&
      typeof value.authority_revoked === 'boolean' && typeof value.minimized === 'boolean' &&
      value.evidence_status === 'historical_observation' && value.execution_authorized === false &&
      value.qualification === 'candidate_contract_only');
    requireValue(!value.minimized || value.authority_revoked);
    requireValue(value.state !== 'cancelled' || value.authority_revoked);
    let purchase = null, amount = '', receiptDeadline = value.expires_at;
    if (value.authority_revoked || value.minimized || value.state === 'cancelled') {
      requireValue(value.purchase === null && value.receipt === null && value.verified_at === null);
    } else {
      exact(value.purchase, ['currency', 'total_payable_minor', 'preview_digest']);
      hash(value.purchase.preview_digest);
      requireValue(typeof value.purchase.total_payable_minor === 'string' && /^(0|[1-9][0-9]{0,17})$/.test(value.purchase.total_payable_minor));
      amount = money(value.purchase.total_payable_minor, value.purchase.currency);
      purchase = Object.freeze({ currency: value.purchase.currency,
        total_payable_minor: value.purchase.total_payable_minor, preview_digest: value.purchase.preview_digest });
      if (value.receipt === null) requireValue(value.verified_at === null && value.state !== 'evidence_verified');
      else {
        integer(value.verified_at, value.created_at, Math.min(Date.now(), value.expires_at - 1));
        requireValue(value.state !== 'prepared');
        receiptDeadline = Math.min(value.expires_at, validateReceipt(value.receipt, value));
      }
    }
    if (Object.hasOwn(request, 'intent_id')) requireValue(value.intent_id === request.intent_id);
    if (proposal) {
      requireValue(value.resource_id === proposal.resource_id && value.expires_at <= proposal.expires_at);
      if (purchase) requireValue(purchase.currency === proposal.currency &&
        purchase.total_payable_minor === proposal.total_payable_minor && purchase.preview_digest === proposal.preview_digest);
    }
    if (expected) {
      for (const key of ['intent_id', 'resource_id', 'created_at', 'expires_at', 'binding_digest']) requireValue(value[key] === expected[key]);
      requireValue(value.revision >= expected.revision && (!expected.authority_revoked || value.authority_revoked) &&
        (!expected.minimized || value.minimized));
      const transitions = { prepared: ['prepared', 'evidence_verified', 'expired', 'cancelled'],
        evidence_verified: ['evidence_verified', 'expired', 'cancelled'], expired: ['expired', 'cancelled'], cancelled: ['cancelled'] };
      requireValue(transitions[expected.state].includes(value.state));
      if (purchase && expected.purchase) requireValue(purchase.currency === expected.purchase.currency &&
        purchase.total_payable_minor === expected.purchase.total_payable_minor && purchase.preview_digest === expected.purchase.preview_digest);
      if (value.revision === expected.revision) requireValue(value.state === expected.state &&
        value.authority_revoked === expected.authority_revoked && value.minimized === expected.minimized &&
        value.verified_at === expected.verified_at);
    }
    if (operation === 'cancel') requireValue(value.state === 'cancelled' && value.authority_revoked &&
      value.revision > request.expected_revision);
    if (operation === 'receipt') requireValue(expected && expected.state === 'prepared' && !expected.has_receipt &&
      value.state === 'evidence_verified' && value.receipt !== null && value.verified_at !== null &&
      !value.authority_revoked && !value.minimized && value.revision > expected.revision);
    // Do not retain the raw receipt, its identifiers, challenge or signer details.
    return Object.freeze({ intent_id: value.intent_id, resource_id: value.resource_id, revision: value.revision,
      created_at: value.created_at, expires_at: value.expires_at, binding_digest: value.binding_digest,
      state: value.state, authority_revoked: value.authority_revoked, minimized: value.minimized,
      purchase, amount, has_receipt: value.receipt !== null, verified_at: value.verified_at, action_deadline: receiptDeadline });
  }
  function validateEnvelope(value, ticket) {
    exact(value, ['profile', 'qualification', 'evidence_status', 'execution_authorized', 'operation', 'result']);
    requireValue(value.profile === 'commerce-sqlite-diagnostic' && value.qualification === 'candidate_contract_only' &&
      value.evidence_status === 'historical_observation' && value.execution_authorized === false && value.operation === ticket.operation);
    if (ticket.operation === 'preview-status') return validatePreview(value.result, ticket.references);
    let result = value.result;
    if (ticket.operation === 'lookup') {
      exact(result, ['original', 'intent']); exact(result.original, ['preview_id', 'context_id']);
      requireValue(result.original.preview_id === ticket.references.preview_id && result.original.context_id === ticket.references.context_id);
      result = result.intent;
    }
    return validateIntent(result, ticket.request, ticket.operation, ticket.expected, ticket.proposal);
  }

  function current(ticket) {
    requireValue(ticket.generation === generation && pending === ticket && ticket.secret === session, 'STALE');
    requireValue(!ticket.controller.signal.aborted, ticket.timedOut ? 'TIMEOUT' : 'STALE');
    if (ticket.operation === 'receipt') requireValue(ticket.expected && Date.now() < ticket.expected.action_deadline, 'EXPIRED');
  }
  function releaseReceipt(ticket) {
    if (ticket.operation === 'receipt') ticket.request = Object.freeze({ intent_id: ticket.request.intent_id });
  }
  async function receive(ticket) {
    let responsePending;
    try {
      responsePending = fetch(routes[ticket.operation], {
        method: 'POST', headers: { authorization: 'Bearer ' + ticket.secret, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(ticket.request), credentials: 'omit', mode: 'same-origin', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: ticket.controller.signal,
      });
    } finally {
      // The browser owns the transient request body. Keep only the original ID
      // for response validation, never a receipt copy in pending controller state.
      releaseReceipt(ticket);
    }
    const response = await responsePending;
    current(ticket);
    ticket.httpStatus = response.status;
    requireValue(response.redirected === false && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json');
    const declared = response.headers.get('content-length');
    requireValue(declared === null || (/^[0-9]{1,12}$/.test(declared) && Number(declared) <= RESPONSE_BYTES));
    requireValue(response.body && typeof response.body.getReader === 'function');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const part = await reader.read();
        current(ticket);
        if (part.done) break;
        requireValue(ArrayBuffer.isView(part.value) && part.value.BYTES_PER_ELEMENT === 1);
        size += part.value.byteLength; requireValue(size <= RESPONSE_BYTES);
        chunks.push(decoder.decode(part.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      requireValue(declared === null || Number(declared) === size);
      current(ticket);
      const value = strictJson(chunks.join(''), ticket.secret);
      current(ticket);
      if (response.status !== 200) throw new ReviewFailure(httpFailures[response.status] || 'REQUEST_FAILED');
      const result = validateEnvelope(value, ticket);
      if (ticket.operation === 'receipt') requireValue(Date.now() < result.action_deadline, 'EXPIRED');
      current(ticket);
      return result;
    } finally {
      // A cancellation may race a body read. Never wait indefinitely to cancel it.
      reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  function say(message, error = false) {
    if (window.RifareA11y) window.RifareA11y.announce('workflow-notice', message, { error });
    else {
      $('workflow-notice').textContent = message;
      $('workflow-notice').setAttribute('role', error ? 'alert' : 'status');
    }
  }
  function focus(id) {
    if (window.RifareA11y) window.RifareA11y.focus(id);
    else $(id).focus();
  }
  async function perform(operation, request, references, onSuccess) {
    if (pending || !session) return;
    const ticket = { operation, request: Object.freeze({ ...request }), references,
      expected: known, proposal: preview, secret: session, generation,
      controller: new AbortController(), timedOut: false, httpStatus: null };
    if (operation === 'receipt') request = null;
    pending = ticket; confirmation = null; render();
    const loading = { 'preview-status': 'Checking the original proposal…', prepare: 'Sending one preparation request…',
      lookup: 'Looking up the original preparation…', status: 'Checking the original record…',
      receipt: 'Checking the supplied receipt for the original record…', cancel: 'Sending the confirmed cancellation…' };
    say(loading[operation]);
    let timeout;
    const deadline = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        ticket.timedOut = true;
        ticket.controller.abort();
        reject(new ReviewFailure('TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([receive(ticket), deadline]);
      current(ticket);
      onSuccess(result);
    } catch (error) {
      if (ticket.generation !== generation || pending !== ticket) return;
      preview = null; intent = null; confirmation = null;
      if (known) needsStatus = true;
      let code = error instanceof ReviewFailure && Object.hasOwn(failures, error.code) ? error.code : 'REQUEST_FAILED';
      if (ticket.httpStatus === 403) code = 'REQUEST_DENIED';
      if (code === 'REQUEST_DENIED') { session = ''; $('session-input').value = ''; }
      let message = failures[code] + ' Earlier details have been cleared.';
      if (operation === 'prepare' || uncertain === 'preparation') {
        uncertain = 'preparation';
        message += ' Preparation may have reached the server. Recover original; another preparation stays disabled.';
      } else if (operation === 'cancel' || uncertain === 'cancellation') {
        uncertain = 'cancellation'; needsStatus = true;
        message += ' Cancellation is unconfirmed. Check status before any further change; do not resend it.';
      } else if (operation === 'receipt' || uncertain === 'receipt') {
        uncertain = 'receipt'; needsStatus = true;
        message += ' Receipt submission is unconfirmed. Check the original status; this page will not send another receipt.';
      } else if (original) {
        message += known ? ' Check status explicitly before changing this original record.' :
          ' Absence does not authorize a replacement. Keep the original references; preparation stays disabled.';
      }
      if (code === 'REQUEST_DENIED') message += ' Enter a current session and use the original references to recover.';
      say(message, true);
    } finally {
      clearTimeout(timeout); ticket.controller.abort(); ticket.secret = ''; releaseReceipt(ticket);
      if (pending === ticket) { pending = null; render(); }
    }
  }

  function referencesValid() {
    return typeof $('preview-id').value === 'string' && typeof $('context-id').value === 'string' &&
      ID.test($('preview-id').value) && ID.test($('context-id').value);
  }
  function references() {
    if (original) return original;
    if (!referencesValid()) {
      say('Enter both original references using letters, numbers, underscores or hyphens, up to 96 characters.', true);
      focus(ID.test($('preview-id').value) ? 'context-id' : 'preview-id');
      return null;
    }
    return Object.freeze({ preview_id: $('preview-id').value, context_id: $('context-id').value });
  }
  function sameReferences(a, b) { return a && b && a.preview_id === b.preview_id && a.context_id === b.context_id; }
  function canPrepare() {
    return Boolean(session && !pending && !original && preview && referencesValid() &&
      sameReferences(preview, { preview_id: $('preview-id').value, context_id: $('context-id').value }) && Date.now() < preview.expires_at);
  }
  function canCancel() {
    return Boolean(session && !pending && intent && known && !needsStatus && !uncertain &&
      !intent.authority_revoked && !intent.minimized && ['prepared', 'evidence_verified'].includes(intent.state) &&
      Date.now() < intent.action_deadline);
  }
  function canReceiveReceipt() {
    return Boolean(session && original && !pending && intent && known && !needsStatus && !uncertain &&
      !confirmation && !receiptAttempted && !intent.authority_revoked && !intent.minimized &&
      intent.state === 'prepared' && !intent.has_receipt && Date.now() < intent.action_deadline);
  }
  function receiptInputValid() {
    const value = $('receipt-input').value;
    return typeof value === 'string' && value.length <= RECEIPT_CHARACTERS && COMPACT_RECEIPT.test(value);
  }
  function acceptIntent(value) {
    intent = value; known = value;
    if (value.authority_revoked || value.minimized || ['cancelled', 'expired'].includes(value.state)) preview = null;
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function detail(label, value) {
    const row = element('div'); row.append(element('dt', label), element('dd', String(value)));
    $('reference-details').append(row);
  }
  function clearDynamicDetails() {
    $('preview-items').replaceChildren(); $('reference-details').replaceChildren();
    for (const id of ['preview-subtotal', 'preview-tax', 'preview-shipping', 'preview-fees', 'preview-total', 'preview-deadline',
      'intent-state', 'intent-message', 'intent-money', 'intent-revision', 'receipt-state', 'intent-deadline', 'cancel-revision']) $(id).textContent = '';
    $('preview-panel').hidden = true; $('intent-panel').hidden = true; $('intent-amount').hidden = true;
  }
  function render() {
    clearTimeout(expiryTimer); expiryTimer = null;
    clearDynamicDetails();
    const busy = pending !== null;
    const expiredPreview = preview && Date.now() >= preview.expires_at;
    const expiredIntent = intent && Date.now() >= intent.action_deadline;
    $('main-content').setAttribute('aria-busy', String(busy));
    $('session-state').textContent = session ? 'Ready on this page' : 'Not entered';
    $('preview-id').disabled = !session || busy;
    $('context-id').disabled = !session || busy;
    $('preview-id').readOnly = original !== null;
    $('context-id').readOnly = original !== null;
    if (original) { $('preview-id').value = original.preview_id; $('context-id').value = original.context_id; }
    $('reference-state').textContent = original ? 'Original references fixed' : 'Existing references';
    $('load-preview').disabled = !session || busy || Boolean(original) || !referencesValid();
    $('recover-intent').disabled = !session || busy || (!original && !referencesValid());
    $('prepare-intent').disabled = !canPrepare();
    $('refresh-intent').disabled = !session || busy || !known;
    $('request-cancel').disabled = !canCancel();
    if (confirmation && !canCancel()) confirmation = null;
    $('cancel-confirmation').hidden = !confirmation;
    $('confirm-cancel').disabled = !confirmation || !canCancel();
    $('keep-intent').disabled = !confirmation || busy;
    if (confirmation) $('cancel-revision').textContent = 'Observed revision ' + confirmation.expected_revision + '. No replacement will be prepared.';
    const receiptAvailable = canReceiveReceipt();
    $('receipt-panel').hidden = !receiptAvailable;
    $('receipt-input').disabled = !receiptAvailable;
    if (!receiptAvailable) $('receipt-input').value = '';
    $('submit-receipt').disabled = !receiptAvailable || !receiptInputValid();
    $('intent-empty').hidden = Boolean(intent && !busy);
    $('intent-empty-copy').textContent = uncertain === 'preparation' ?
      'Preparation is unconfirmed. Recover it using the fixed original references.' : uncertain === 'cancellation' ?
      'Cancellation is unconfirmed. Check the original status before doing anything further.' : uncertain === 'receipt' ?
      'Receipt submission is unconfirmed. Check the original status; another receipt will not be sent from this page.' : known ?
      'Details are unavailable until a fresh status is accepted for the original record.' : original ?
      'No original record has been confirmed. Absence never enables another preparation.' :
      'Review your proposal or recover an existing preparation using its original references.';

    if (preview && !busy && !expiredPreview) {
      $('preview-panel').hidden = false;
      preview.items.forEach((item, index) => {
        const row = element('li', undefined, 'item'), info = element('div');
        info.append(element('h3', 'Item ' + (index + 1)), element('p', 'Quantity ' + item.quantity + ' · ' + item.unit + ' each'),
          element('p', 'Line tax ' + item.tax));
        row.append(element('span', String(index + 1).padStart(2, '0'), 'item-number'), info, element('span', item.total, 'item-total'));
        $('preview-items').append(row);
      });
      for (const name of ['subtotal', 'tax', 'shipping', 'fees', 'total']) $('preview-' + name).textContent = preview.amounts[name];
      $('preview-deadline').textContent = 'Observed proposal deadline: ' + instant(preview.expires_at);
      detail('Preview', preview.preview_id); detail('Context supplied for this review', preview.context_id);
      detail('Cart', preview.cart_id); detail('Merchant', preview.merchant_id); detail('Preview digest', preview.preview_digest);
      detail('Proposal created', instant(preview.created_at));
      preview.items.forEach((item, index) => { detail('Item ' + (index + 1) + ' product', item.product_id); detail('Item ' + (index + 1) + ' variant', item.variant_id); });
    }
    if (intent && !busy) {
      $('intent-panel').hidden = false;
      const labels = { prepared: 'Prepared', evidence_verified: 'Evidence observed', cancelled: 'Cancelled', expired: 'Expired' };
      const masked = intent.authority_revoked || intent.minimized || intent.state === 'cancelled';
      $('intent-state').textContent = intent.state === 'cancelled' ? 'Cancelled' : intent.minimized ? 'Minimized history' :
        intent.authority_revoked ? 'Authority revoked' : labels[intent.state];
      $('intent-message').textContent = masked ? 'This original record is retained as history. Earlier proposal, purchase and receipt details have been cleared.' :
        intent.state === 'expired' ? 'Expiry was reported by the server. This record remains historical evidence.' :
          intent.has_receipt ? 'Receipt evidence was observed. It does not authorize a purchase or execution.' :
            'Preparation recorded. Nothing has been purchased or paid.';
      if (!masked && intent.state !== 'expired' && !expiredIntent) {
        $('intent-amount').hidden = false; $('intent-money').textContent = intent.amount;
      }
      $('intent-revision').textContent = String(intent.revision);
      $('receipt-state').textContent = masked ? 'Details unavailable' : intent.has_receipt ? 'Historical evidence observed' : 'None observed';
      $('intent-deadline').textContent = 'Observed record deadline: ' + instant(intent.expires_at);
      detail('Original intent', intent.intent_id); detail('Observed revision', intent.revision);
      detail('Record created', instant(intent.created_at)); detail('Binding digest', intent.binding_digest);
    }
    $('expiry-notice').hidden = !(expiredPreview || expiredIntent);
    $('expiry-notice').textContent = expiredPreview || expiredIntent ?
      'An observed deadline has passed on this page. Actions are disabled; only the server can report a state change. Check status or recover the original.' : '';
    const deadlines = [preview?.expires_at, intent?.action_deadline].filter(value => typeof value === 'number' && value > Date.now());
    if (deadlines.length) expiryTimer = setTimeout(render, Math.max(1, Math.min(...deadlines) - Date.now() + 1));
  }
  function reset(message, keepInput = false) {
    generation++;
    if (pending) { pending.controller.abort(); pending.secret = ''; releaseReceipt(pending); }
    pending = null; session = ''; original = null; preview = null; intent = null; known = null;
    needsStatus = false; uncertain = null; confirmation = null; receiptAttempted = false;
    if (!keepInput) $('session-input').value = '';
    $('receipt-input').value = '';
    $('preview-id').value = ''; $('context-id').value = ''; $('technical-details').open = false;
    window.RifareA11y?.clearErrors();
    render(); say(message);
  }
  function sessionEdited() {
    if (session || pending || original || preview || known || $('preview-id').value || $('context-id').value) {
      reset('The previous local session and details were cleared. Use the newly entered session to continue. Server work was not undone.', true);
    }
  }
  function referencesEdited() {
    if (original) { render(); return; }
    generation++;
    if (pending) { pending.controller.abort(); pending.secret = ''; pending = null; }
    preview = null; intent = null; known = null; confirmation = null;
    render();
    say('References changed. Review this proposal before preparing, or recover its original record.');
  }

  // No input value is restored from navigation, URLs, cookies or browser storage.
  window.addEventListener('pagehide', () => reset('This page was cleared. Server work was not undone.'));
  window.addEventListener('pageshow', () => reset('Use an existing verified customer session to begin.'));
  if (!presentation || presentation.version !== 1) {
    $('session-input').value = ''; $('preview-id').value = ''; $('context-id').value = ''; $('receipt-input').value = '';
    say('The required display helper is unavailable. Review actions remain disabled.', true);
    return;
  }
  $('session-input').disabled = false; $('use-session').disabled = false; $('clear-local').disabled = false;
  $('session-input').addEventListener('input', sessionEdited);
  $('session-input').addEventListener('change', sessionEdited);
  $('session-form').addEventListener('submit', event => {
    event.preventDefault();
    const entered = $('session-input').value;
    if (!BEARER.test(entered)) { say('Enter an existing 43-character customer session.', true); focus('session-input'); return; }
    reset('Session ready on this page. The server will check your current access with each request.');
    session = entered; render(); focus('preview-id');
  });
  for (const id of ['preview-id', 'context-id']) {
    $(id).addEventListener('input', referencesEdited);
    $(id).addEventListener('change', referencesEdited);
  }
  $('entry-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!session || pending || original) return;
    const selected = references(); if (!selected) return;
    perform('preview-status', { preview_id: selected.preview_id }, selected, value => {
      preview = value;
      say('Original proposal observed. Review its amounts before choosing Prepare once.');
    });
  });
  $('prepare-intent').addEventListener('click', () => {
    if (!canPrepare()) { render(); return; }
    original = references(); if (!original) return;
    uncertain = 'preparation';
    perform('prepare', original, original, value => {
      acceptIntent(value); uncertain = null; needsStatus = false;
      say('The original preparation was observed. No order was placed and no payment was authorized.');
    });
  });
  $('recover-intent').addEventListener('click', () => {
    if (!session || pending) return;
    const selected = references(); if (!selected) return;
    original = selected;
    perform('lookup', original, original, value => {
      acceptIntent(value);
      if (!needsStatus) uncertain = null;
      say(needsStatus ? 'The original record was recovered. Check status before any further change.' :
        'The original record was recovered. No replacement preparation was created.');
    });
  });
  $('refresh-intent').addEventListener('click', () => {
    if (!session || pending || !known) return;
    perform('status', { intent_id: known.intent_id }, original, value => {
      acceptIntent(value); uncertain = null; needsStatus = false;
      say(receiptAttempted && value.state === 'prepared' && !value.has_receipt && !value.authority_revoked && !value.minimized ?
        'The original status was observed without receipt evidence. This page will not send another receipt.' :
        'The original status and revision were observed from the server.');
    });
  });
  $('receipt-input').addEventListener('input', render);
  $('receipt-input').addEventListener('change', render);
  $('receipt-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!canReceiveReceipt()) { render(); return; }
    if (!receiptInputValid()) {
      say('Enter a complete signed receipt without spaces, up to 100000 characters. Nothing was sent.', true);
      render(); focus('receipt-input'); return;
    }
    const request = { intent_id: intent.intent_id, compact_jws: $('receipt-input').value };
    $('receipt-input').value = '';
    receiptAttempted = true; uncertain = 'receipt'; needsStatus = true;
    perform('receipt', request, original, value => {
      acceptIntent(value); uncertain = null; needsStatus = false;
      say('Receipt evidence was observed for the original preparation. No order was placed and no payment or execution was authorized.');
    });
  });
  $('request-cancel').addEventListener('click', () => {
    if (!canCancel()) { render(); return; }
    confirmation = Object.freeze({ intent_id: intent.intent_id, expected_revision: intent.revision });
    render(); focus('cancel-title');
  });
  $('keep-intent').addEventListener('click', () => {
    confirmation = null; render(); say('No cancellation was sent.'); focus('request-cancel');
  });
  $('confirm-cancel').addEventListener('click', () => {
    if (!canCancel() || !confirmation || confirmation.intent_id !== intent.intent_id || confirmation.expected_revision !== intent.revision) {
      confirmation = null; render(); return;
    }
    const request = confirmation; confirmation = null; uncertain = 'cancellation'; needsStatus = true;
    perform('cancel', request, original, value => {
      acceptIntent(value); uncertain = null; needsStatus = false;
      say('Cancellation was observed for the original record. Earlier purchase and receipt details were cleared.');
    });
  });
  $('clear-local').addEventListener('click', () => {
    reset('This page was cleared. Server work was not undone and your server session was not revoked.');
    focus('session-input');
  });
  reset('Use an existing verified customer session to begin.');
})();
