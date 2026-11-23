/** Controller-only fixture, NOT a browser, layout, CSP or accessibility qualification. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

type Handler = (event: any) => unknown;
class Element {
  id = ''; value = ''; hidden = false; disabled = false; readOnly = false; checked = false;
  type = ''; className = ''; tabIndex = 0; text = ''; parentElement: Element | null = null;
  children: Element[] = []; attributes = new Map<string, string>(); listeners = new Map<string, Handler[]>();
  classList = { toggle: (_name: string, _enabled?: boolean) => {}, add: (..._names: string[]) => {}, remove: (..._names: string[]) => {} };
  readonly tagName: string; readonly owner: TestDocument;
  constructor(tagName: string, owner: TestDocument) { this.tagName = tagName; this.owner = owner; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.text = String(value); this.children = []; }
  get innerHTML(): never { throw new Error('HTML_RENDERING_DENIED_IN_CONTROLLER_TEST'); }
  set innerHTML(_value: string) { throw new Error('HTML_RENDERING_DENIED_IN_CONTROLLER_TEST'); }
  append(...items: (Element | string)[]) {
    for (const item of items) {
      const child = typeof item === 'string' ? this.owner.createTextNode(item) : item;
      child.parentElement = this; this.children.push(child);
    }
  }
  appendChild(child: Element) { this.append(child); return child; }
  replaceChildren(...items: (Element | string)[]) { this.text = ''; this.children = []; this.append(...items); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() { this.owner.activeElement = this; }
  addEventListener(type: string, handler: Handler) { this.listeners.set(type, [...this.listeners.get(type) ?? [], handler]); }
  async dispatch(type: string, extra: object = {}) {
    const event = { type, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const handler of this.listeners.get(type) ?? []) {
      const outcome = handler(event);
      if (outcome && typeof (outcome as any).then === 'function')
        void Promise.resolve(outcome).catch(error => { this.owner.errors.push(error); });
    }
    return event;
  }
}
class TestDocument {
  nodes = new Map<string, Element>(); activeElement: Element | null = null; visibilityState = 'visible';
  forms = new Map<string, string>(); errors: unknown[] = [];
  constructor(html: string) {
    // Read declared ids/defaults only. This deliberately does not implement a browser DOM.
    for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
      const element = new Element(match[1].toUpperCase(), this); element.id = match[3];
      const attrs = match[2];
      element.hidden = /\bhidden(?:[\s=>]|$)/.test(attrs); element.disabled = /\bdisabled(?:[\s=>]|$)/.test(attrs);
      element.type = /\btype="([^"]+)"/.exec(attrs)?.[1] ?? '';
      this.nodes.set(element.id, element);
    }
    for (const form of html.matchAll(/<form\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g))
      for (const field of form[2].matchAll(/\bid="([^"]+)"/g)) this.forms.set(field[1], form[1]);
  }
  getElementById(id: string) { const element = this.nodes.get(id); assert.ok(element, 'Missing actual HTML id: ' + id); return element; }
  createElement(tag: string) { return new Element(tag.toUpperCase(), this); }
  createTextNode(text: string) { const element = this.createElement('#text'); element.textContent = text; return element; }
  createDocumentFragment() { return this.createElement('#fragment'); }
}

export type ObservedRequest = { path: string; body: any; init: RequestInit };
export type Fault = (request: ObservedRequest, forward: () => Promise<Response>) => Promise<Response>;
export function controllerFixture(url: string, fault?: Fault, now: () => number = Date.now) {
  const html = readFileSync(new URL('../../apps/commerce-api/checkout-review.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../../apps/commerce-api/checkout-review-client.js', import.meta.url), 'utf8');
  const document = new TestDocument(html), events = new Map<string, Handler[]>();
  const calls: ObservedRequest[] = [], timers = new Set<ReturnType<typeof setTimeout>>();
  const deniedStorage = new Proxy({}, { get() { throw new Error('BROWSER_STORAGE_DENIED'); }, set() { throw new Error('BROWSER_STORAGE_DENIED'); } });
  const presentation: Record<string, any> = {};
  runInNewContext(readFileSync(new URL('../../packages/presentation/locale-presentation.js', import.meta.url), 'utf8'), presentation);
  const window = {
    addEventListener(type: string, handler: Handler) { events.set(type, [...events.get(type) ?? [], handler]); },
    RifareA11y: { announce(value: Element | string, message: string, options: { error?: boolean } = {}) {
      const element = typeof value === 'string' ? document.getElementById(value) : value;
      element.textContent = message; element.setAttribute('role', options.error ? 'alert' : 'status');
    },
      focus(id: string) { document.getElementById(id).focus(); }, clearErrors() {} },
    localStorage: deniedStorage, sessionStorage: deniedStorage,
    RifarePresentation: presentation.RifarePresentation,
  };
  const fetchObserved = async (path: string, init: RequestInit = {}) => {
    assert.ok(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'));
    assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const request = { path, body: init.body ? JSON.parse(String(init.body)) : undefined, init };
    calls.push(request);
    const forward = () => fetch(url + path, init);
    return fault ? fault(request, forward) : forward();
  };
  class ClientDate extends Date { static now() { return now(); } }
  runInNewContext(source, {
    document, window, fetch: fetchObserved, AbortController, TextDecoder, TextEncoder, Uint8Array, URL, URLSearchParams, Date: ClientDate,
    localStorage: deniedStorage, sessionStorage: deniedStorage,
    setTimeout(fn: () => void, delay: number) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay); timers.add(timer); return timer; },
    clearTimeout(timer: ReturnType<typeof setTimeout>) { timers.delete(timer); clearTimeout(timer); },
    console: { log() { throw new Error('PRIVATE_CONSOLE_DENIED'); }, error() { throw new Error('PRIVATE_CONSOLE_DENIED'); } },
  }, { filename: 'checkout-review-client.js', timeout: 1000 });
  const node = (id: string) => document.getElementById(id);
  return {
    node, calls, document,
    async input(id: string, value: string) { node(id).value = value; await node(id).dispatch('input'); },
    async click(id: string) {
      assert.equal(node(id).disabled, false, id + ' must be enabled');
      const event = await node(id).dispatch('click');
      if (!event.defaultPrevented && node(id).type === 'submit' && document.forms.has(id))
        await node(document.forms.get(id)!).dispatch('submit');
    },
    async event(type: string, extra: object = {}) { for (const handler of events.get(type) ?? []) await handler({ type, ...extra }); },
    async until(predicate: () => boolean, label: string, timeout = 4000) {
      const end = Date.now() + timeout;
      while (!predicate()) { if (document.errors.length) throw document.errors[0];
        if (Date.now() >= end) throw new Error(label + ': ' + node('workflow-notice').textContent);
        await new Promise(resolve => setTimeout(resolve, 5)); }
    },
    async dispose() { for (const handler of events.get('pagehide') ?? []) await handler({ type: 'pagehide' });
      for (const timer of timers) clearTimeout(timer); timers.clear(); },
  };
}
