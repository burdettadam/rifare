'use strict';
(() => {
  // Presentation only: no credentials, storage, API calls or action authority.
  window.RifareA11y?.destroy();
  const controller = new AbortController(), fields = new WeakMap();
  let invalidBatch = null, submittedForm = null;
  const element = value => typeof value === 'string' ? document.getElementById(value) : value;
  const tokens = value => (value || '').split(/\s+/).filter(Boolean);
  function describe(node, id) {
    if (node) node.setAttribute('aria-describedby', [...new Set([...tokens(node.getAttribute('aria-describedby')), id])].join(' '));
  }
  function focus(value) {
    const node = element(value);
    if (!node || node.closest('[hidden]') || node.disabled) return;
    if (!node.matches('input,select,textarea,button,a[href],summary,[tabindex]')) node.tabIndex = -1;
    node.focus();
  }
  function announce(value, message, options = {}) {
    const node = element(value);
    if (!node) return;
    node.setAttribute('role', options.error ? 'alert' : 'status');
    node.setAttribute('aria-live', options.error ? 'assertive' : 'polite');
    node.setAttribute('aria-atomic', 'true');
    node.tabIndex = -1;
    node.classList.toggle('error', Boolean(options.error));
    node.textContent = message;
    if (options.error) describe(options.form || submittedForm, node.id);
    if (options.focus || options.error) focus(node);
  }
  function clearField(field) {
    const saved = fields.get(field);
    if (!saved) return;
    document.getElementById(saved.id)?.remove();
    const remaining = tokens(field.getAttribute('aria-describedby')).filter(id => id !== saved.id);
    if (remaining.length) field.setAttribute('aria-describedby', remaining.join(' '));
    else field.removeAttribute('aria-describedby');
    if (saved.invalid === null) field.removeAttribute('aria-invalid');
    else field.setAttribute('aria-invalid', saved.invalid);
    fields.delete(field);
  }
  function clearErrors(form = document) {
    for (const field of form.querySelectorAll('input,select,textarea')) clearField(field);
  }
  function fieldLabel(field) {
    const label = field.labels?.[0]?.cloneNode(true);
    if (label) for (const child of label.querySelectorAll('input,select,textarea,.field-error')) child.remove();
    return label?.textContent.trim() || field.getAttribute('aria-label') || 'This field';
  }
  document.addEventListener('invalid', event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
    event.preventDefault();
    clearField(field);
    const id = field.id + '-validation-error', error = document.createElement('span');
    error.id = id; error.className = 'field-error';
    error.textContent = fieldLabel(field) + ': ' + field.validationMessage;
    fields.set(field, { id, invalid: field.getAttribute('aria-invalid') });
    field.setAttribute('aria-invalid', 'true'); describe(field, id);
    field.insertAdjacentElement('afterend', error);
    if (!invalidBatch) {
      invalidBatch = field;
      // Native validation may checkpoint microtasks between invalid fields.
      // Wait for this validation task to finish so the first field keeps focus.
      setTimeout(() => {
        const first = invalidBatch; invalidBatch = null;
        if (!first?.isConnected) return;
        const notice = document.querySelector('[data-workflow-notice]');
        if (notice) announce(notice, 'Check the marked fields before continuing.', { error: true, form: first.form });
        focus(first);
      }, 0);
    }
  }, { capture: true, signal: controller.signal });
  document.addEventListener('input', event => clearField(event.target), { signal: controller.signal });
  document.addEventListener('submit', event => {
    submittedForm = event.target;
    clearErrors(submittedForm);
  }, { capture: true, signal: controller.signal });
  document.querySelector('.skip-link')?.addEventListener('click', () => focus('main-content'), { signal: controller.signal });
  window.RifareA11y = Object.freeze({ announce, focus, clearErrors, destroy: () => controller.abort() });
})();
