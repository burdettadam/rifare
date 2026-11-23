/** Explicit browser qualification for a synthetic, loopback, disposable native
 * installation. The caller supplies Playwright's page and private fixture values.
 * This helper is not advertised by the standalone production command manifest. */
export async function verifyStandaloneAdmin(page, fixture) {
  if (fixture.synthetic !== true || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(fixture.origin) ||
      !fixture.email.endsWith('@example.invalid') || !/^[a-f0-9]{32}$/.test(fixture.password) ||
      !/^rifare-admin-[a-z0-9-]+$/.test(fixture.artifactPrefix)) throw new Error('ADMIN_DISPOSABLE_FIXTURE_REQUIRED');
  const checks = [], errors = [], external = [], assets = [], assetChecks = [], scriptRequests = [];
  const ensure = (condition, code) => { if (!condition) throw new Error(code); };
  const origin = fixture.origin, path = url => url.startsWith(origin + '/') ? url.slice(origin.length).split('?')[0] : null;
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const p = await context.newPage(); p.setDefaultTimeout(10000);
  let customerContext;
  await context.route('**/*', route => {
    if (!path(route.request().url())) { external.push(route.request().url().split('/').slice(0, 3).join('/')); return route.abort(); }
    return route.continue();
  });
  p.on('pageerror', error => errors.push(error.message.slice(0, 300)));
  p.on('request', request => {
    if (['script', 'stylesheet'].includes(request.resourceType()) && path(request.url())) scriptRequests.push(path(request.url()));
  });
  p.on('response', response => {
    const target = path(response.url());
    if (target?.startsWith('/app/assets/') && ['script', 'stylesheet'].includes(response.request().resourceType())) {
      assetChecks.push(response.headerValue('content-type').then(type => assets.push({ path: target, kind: response.request().resourceType(), status: response.status(), type })));
    }
  });
  try {
    for (const endpoint of ['/admin/users/me', '/admin/products', '/admin/orders']) {
      const r = await context.request.get(origin + endpoint); ensure(r.status() === 401, 'ADMIN_ANONYMOUS_DATA_ACCEPTED');
    }
    checks.push('ADMIN-ANONYMOUS-DATA');
    const initial = await p.goto(origin + '/app/products'); ensure(initial.status() === 200, 'ADMIN_STATIC_HTML_NOT_SERVED');
    await Promise.all(assetChecks);
    const validAsset = a => a.status === 200 && (a.kind === 'script' ? /(?:java|ecma)script/i : /text\/css/i).test(a.type ?? '');
    ensure(assets.every(validAsset), 'ADMIN_STATIC_ENTRY_ASSET_INVALID');
    await p.getByPlaceholder('Email', { exact: true }).waitFor();
    ensure(p.url().split('?')[0] === origin + '/app/login', 'ADMIN_ANONYMOUS_DEEP_LINK_NOT_GUARDED');
    await p.screenshot({ path: fixture.artifactPrefix + '-login.png', fullPage: true });
    checks.push('ADMIN-ANONYMOUS-DEEP-LINK');
    await p.getByPlaceholder('Email', { exact: true }).fill(fixture.email);
    await p.getByPlaceholder('Password', { exact: true }).fill('00000000000000000000000000000000');
    const wrong = p.waitForResponse(r => r.request().method() === 'POST' && path(r.url()) === '/auth/user/emailpass');
    await p.getByRole('button', { name: 'Continue with Email', exact: true }).click();
    ensure((await wrong).status() === 401, 'ADMIN_WRONG_PASSWORD_ACCEPTED');
    ensure((await context.request.get(origin + '/admin/products')).status() === 401, 'ADMIN_FAILED_LOGIN_GAVE_DATA');
    checks.push('ADMIN-WRONG-PASSWORD');
    await p.getByPlaceholder('Password', { exact: true }).fill(fixture.password);
    await p.getByRole('button', { name: 'Continue with Email', exact: true }).click();
    await p.getByRole('link', { name: 'Products', exact: true }).waitFor();
    ensure((await context.request.get(origin + '/admin/products')).status() === 200, 'ADMIN_OPERATOR_DATA_UNAVAILABLE');
    checks.push('ADMIN-OPERATOR-LOGIN');
    await p.getByRole('link', { name: 'Products', exact: true }).click();
    await p.getByRole('link', { name: 'Create', exact: true }).click();
    await p.locator('[role="dialog"]').first().waitFor();
    ensure(await p.locator('[role="dialog"]').count() === 1 && await p.getByRole('dialog').count() === 1,
      'ADMIN_SINGLE_ACCESSIBLE_PRODUCT_DIALOG_REQUIRED');
    checks.push('ADMIN-SINGLE-PRODUCT-DIALOG');
    const title = 'Rifare Admin Qualification ' + Date.now();
    await p.getByRole('dialog').locator('input[name="title"]').fill(title);
    const saved = p.waitForResponse(r => r.request().method() === 'POST' && path(r.url()) === '/admin/products');
    await p.getByRole('button', { name: 'Save as draft', exact: true }).click();
    const save = await saved, body = await save.json();
    ensure(save.status() === 200 && /^prod_[A-Za-z0-9]+$/.test(body.product?.id) && body.product.title === title && body.product.status === 'draft', 'ADMIN_NATIVE_PRODUCT_NOT_PERSISTED');
    const product = { id: body.product.id, title, status: body.product.status };
    await p.waitForURL(origin + '/app/products/' + product.id);
    await p.getByRole('heading', { name: title, exact: true }).waitFor();
    checks.push('ADMIN-NATIVE-CATALOG-WRITE');
    await p.reload(); await p.getByRole('heading', { name: title, exact: true }).waitFor();
    await p.screenshot({ path: fixture.artifactPrefix + '-product.png', fullPage: true });
    await p.goto(origin + '/app/products'); await p.getByRole('link', { name: 'Create', exact: true }).waitFor();
    await p.getByText(title, { exact: true }).waitFor();
    checks.push('ADMIN-DEEP-LINK-RELOAD');
    // Genuine native synthetic customer JWT, not a user cookie or an external
    // provider authentication claim. A separate context carries no operator session.
    customerContext = await browser.newContext({ extraHTTPHeaders: {
      authorization: 'Bearer ' + fixture.customerToken, 'x-publishable-api-key': fixture.publishableKey,
    } });
    const customer = await customerContext.request.get(origin + '/store/customers/me');
    ensure(customer.status() === 200 && (await customer.json()).customer?.id === fixture.customerId, 'ADMIN_CUSTOMER_CONTROL_INVALID');
    for (const endpoint of ['/admin/users/me', '/admin/products', '/admin/orders']) {
      ensure((await customerContext.request.get(origin + endpoint)).status() === 401, 'ADMIN_CUSTOMER_TOKEN_GAVE_OPERATOR_DATA');
    }
    const forbiddenLogin = await customerContext.request.post(origin + '/auth/customer/emailpass', { data: { email: fixture.email, password: fixture.password } });
    ensure([400, 401].includes(forbiddenLogin.status()) && !(await forbiddenLogin.json()).token, 'ADMIN_OPERATOR_CREDENTIALS_BECAME_CUSTOMER_LOGIN');
    checks.push('ADMIN-CUSTOMER-SEPARATION');
    const held = [
      ['POST', '/store/carts/' + fixture.cartId + '/complete'], ['POST', '/store/carts/' + fixture.cartId + '/customer'],
      ['POST', '/store/payment-collections'], ['PUT', '/store/payment-collections/pay_col_synthetic'],
      ['PATCH', '/store/payment-collections/pay_col_synthetic'], ['DELETE', '/store/payment-collections/pay_col_synthetic'],
      ['GET', '/store/orders'], ['POST', '/store/returns'], ['POST', '/hooks/payment/pp_system_default'],
    ];
    for (const [method, endpoint] of held) {
      const r = await customerContext.request.fetch(origin + endpoint, { method, ...(method === 'GET' ? {} : { data: {} }) });
      ensure(r.status() === 503 && (await r.json()).code === 'RIFARE_COMMERCE_IDENTITY_NOT_CONNECTED', 'ADMIN_PUBLIC_COMMERCE_HOLD_CHANGED:' + method + ':' + endpoint);
    }
    checks.push('ADMIN-PUBLIC-COMMERCE-HOLDS');
    await p.getByRole('button', { name: fixture.email, exact: false }).click();
    await p.getByRole('menuitem', { name: 'Log out', exact: true }).click();
    await p.getByPlaceholder('Email', { exact: true }).waitFor();
    ensure((await context.request.get(origin + '/admin/products')).status() === 401, 'ADMIN_LOGOUT_RETAINED_BROWSER_ACCESS');
    await p.goto(origin + '/app/products'); await p.getByPlaceholder('Email', { exact: true }).waitFor();
    checks.push('ADMIN-LOCAL-LOGOUT');
    await Promise.all(assetChecks);
    ensure(assets.length > 0 && assets.every(validAsset), 'ADMIN_ASSET_DELIVERY_FAILED');
    ensure(scriptRequests.length > 0 && scriptRequests.every(target => target.startsWith('/app/assets/')) && !external.length && !errors.length, 'ADMIN_BROWSER_RUNTIME_ERRORS');
    checks.push('ADMIN-STATIC-ASSETS');
    return { result: 'pass', checks, product, assets, protectedRequestsRefused: held.length,
      browser: browser.version(), scope: 'relocated-native-admin-synthetic-operator-and-customer-jwt',
      globalTokenRevocationVerified: false, connectedProviderVerified: false, productionQualified: false };
  } catch (error) {
    await p.screenshot({ path: fixture.artifactPrefix + '-failure.png', fullPage: true }).catch(() => {});
    console.error('ADMIN_BROWSER_FAILURE=' + JSON.stringify({ checks, errors, external, assets, failure: error.message }));
    throw error;
  } finally { await customerContext?.close(); await context.close(); }
}
