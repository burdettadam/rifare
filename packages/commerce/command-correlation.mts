import { exact, id } from './values.mts';
import { checkoutSnapshot } from './checkout-preview.mts';
import type { Principal } from './delegated-receipt-binding.mts';

export type CommandCorrelation = Readonly<{ provider_ref: string; organization_id: string; actor: Principal }>;
export type CommandClaimCode =
  | 'COMMAND_CLAIM_CONFIG_INVALID' | 'COMMAND_CLAIM_INPUT_INVALID' | 'COMMAND_CLAIM_BINDING_INVALID'
  | 'COMMAND_CLAIM_ACCESS_DENIED' | 'COMMAND_CLAIM_NOT_FOUND' | 'COMMAND_CLAIM_CONFLICT'
  | 'COMMAND_CLAIM_CHALLENGE_CONFLICT' | 'COMMAND_CLAIM_REVISION_CONFLICT' | 'COMMAND_CLAIM_RETIRED'
  | 'COMMAND_CLAIM_TRANSACTION_OWNERSHIP' | 'COMMAND_CLAIM_CLOCK_INVALID' | 'COMMAND_CLAIM_ROW_LIMIT'
  | 'COMMAND_CLAIM_INTEGRITY' | 'COMMAND_CLAIM_STORAGE_UNAVAILABLE';
export class CommandClaimDenied extends Error {
  readonly code: CommandClaimCode;
  constructor(code: CommandClaimCode) { super(code); this.code = code; this.name = 'CommandClaimDenied'; }
}
export function claimDenied(code: CommandClaimCode): never { throw new CommandClaimDenied(code); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function commandClaimUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value) || value === '00000000-0000-0000-0000-000000000000')
    claimDenied('COMMAND_CLAIM_INPUT_INVALID');
}

/** These fixed opaque local names establish correlation only, never a URI or
 * authenticated provider identity. No callback or endpoint selection is allowed. */
export function commandCorrelation(input: unknown): CommandCorrelation {
  try {
    const c = checkoutSnapshot(input) as CommandCorrelation;
    exact(c, ['provider_ref','organization_id','actor']); id(c.provider_ref); commandClaimUuid(c.organization_id);
    exact(c.actor, ['type','id']);
    if (!['SERVICE_ACCOUNT','MACHINE_IDENTITY'].includes(c.actor.type) ||
      typeof c.actor.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(c.actor.id))
      claimDenied('COMMAND_CLAIM_CONFIG_INVALID');
    return c;
  } catch { claimDenied('COMMAND_CLAIM_CONFIG_INVALID'); }
}
