export class ExternalEffectDenied extends Error {
  code = 'EXTERNAL_EFFECT_DENIED';
  constructor() { super('External effects are disabled in the synthetic development profile.'); }
}

export async function requestExternalEffect(_url: unknown): Promise<never> {
  // There is no network operation behind this boundary. Provider implementations
  // belong to later, independently qualified adapters; a prompt cannot enable one.
  throw new ExternalEffectDenied();
}
