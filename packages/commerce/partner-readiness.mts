import { exact, id, integer } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { permissionDecision } from './authorization.mts';
import { controlState, assertExecution } from './execution-stops.mts';
import { assertRecoveryEgress } from './data-guards.mts';

export type PartnerContext = Readonly<{service: string; account_id: string; source_identity: string;
  source_config_digest: string; region: string; capability: string}>;
export type PartnerPin = PartnerContext & Readonly<{revision: number; configuration_digest: string;
  approval_id: string; approval_digest: string; expires_at: number; control_stamp: string;
  qualification: 'synthetic_local_only'; external_qualified: false}>;
export const PARTNER_QUALIFICATION = 'synthetic_local_only' as const;
export const PARTNER_ACTION = 'diagnostic.partner.service';

export function partnerHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('INVALID_INPUT'); return value;
}
export function partnerContext(value: unknown): PartnerContext {
  const p = exact(jsonValue(value), ['service', 'account_id', 'source_identity', 'source_config_digest', 'region', 'capability']);
  for (const key of ['service', 'account_id', 'source_identity', 'region', 'capability']) id(p[key]); partnerHash(p.source_config_digest);
  return p as PartnerContext;
}
function checked(row: Row | undefined): Row | null {
  if (!row) return null; const body = JSON.parse(row.body);
  if (contentDigest(body) !== row.digest) throw new Error('PARTNER_RECORD_INTEGRITY'); return {...row, body};
}
export function partnerCurrentActor(k: CommerceKernel, s: Row, actor: string, action: string, resource: string | null = null): boolean {
  const member = k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1')
    .get(s.tenant_id, s.store_id, actor) as Row | undefined;
  return !!member && permissionDecision(k.db, {...s, actor_id: actor, role: member.role}, action, resource).allowed;
}

/** Current local development readiness. Bounded reference strings and a real
 * application reviewer are not authentication of any external agreement. */
export class PartnerReadiness {
  readonly k: CommerceKernel;
  constructor(k: CommerceKernel) {this.k = k;}
  #configuration(s: Row, service: string, account: string) {
    return checked(this.k.db.prepare('SELECT * FROM commerce_partner_configurations WHERE tenant_id=? AND store_id=? AND service=? AND account_id=?')
      .get(s.tenant_id, s.store_id, service, account) as Row | undefined);
  }
  configure(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['service', 'account_id', 'source_identity', 'source_config_digest', 'regions', 'capabilities',
      'enabled', 'qualification', 'expected_revision', 'expires_at', 'responsibilities']);
    for (const key of ['service', 'account_id', 'source_identity']) id(p[key]); partnerHash(p.source_config_digest);
    integer(p.expected_revision); integer(p.expires_at);
    for (const key of ['regions', 'capabilities']) {
      if (!Array.isArray(p[key]) || !p[key].length || p[key].length > 30 || new Set(p[key]).size !== p[key].length) throw new Error('INVALID_INPUT');
      p[key].forEach(id);
    }
    if (typeof p.enabled !== 'boolean' || p.qualification !== PARTNER_QUALIFICATION || p.expires_at <= this.k.clock()) throw new Error('PARTNER_QUALIFICATION_REQUIRED');
    const responsibility = exact(p.responsibilities, ['contract_ref', 'access_ref', 'roles_ref', 'settlement_ref', 'data_policy_ref', 'sla_ref', 'incident_owner']);
    Object.values(responsibility).forEach(id);
    return this.k.transaction(() => {
      const s = this.k.authorize(scope, 'action.configure'), old = this.#configuration(s, p.service, p.account_id);
      if ((old?.revision ?? 0) !== p.expected_revision) throw new Error('PARTNER_CONFIGURATION_CHANGED');
      const revision = p.expected_revision + 1, {expected_revision, ...definition} = p;
      const body = {...definition, revision, configured_by: s.actor_id}, digest = contentDigest(body);
      this.k.db.prepare(`INSERT INTO commerce_partner_configurations VALUES(?,?,?,?,?,?,0,?,?,?)
        ON CONFLICT(tenant_id,store_id,service,account_id) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,
        unavailable=0,body=excluded.body,digest=excluded.digest,expires_at=excluded.expires_at`)
        .run(s.tenant_id, s.store_id, p.service, p.account_id, revision, Number(p.enabled), canonical(body), digest, p.expires_at);
      this.k.db.prepare("UPDATE commerce_partner_approvals SET state='revoked' WHERE tenant_id=? AND store_id=? AND service=? AND account_id=?")
        .run(s.tenant_id, s.store_id, p.service, p.account_id);
      return {service: p.service, account_id: p.account_id, revision, digest, expires_at: p.expires_at,
        qualification: PARTNER_QUALIFICATION, external_qualified: false};
    });
  }
  approve(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['service', 'account_id', 'approval_id', 'expected_revision', 'configuration_digest', 'expires_at']);
    for (const key of ['service', 'account_id', 'approval_id']) id(p[key]); integer(p.expected_revision, 1); integer(p.expires_at); partnerHash(p.configuration_digest);
    return this.k.transaction(() => {
      const s = this.k.authorize(scope, 'action.approve'), c = this.#configuration(s, p.service, p.account_id);
      if (!c || c.revision !== p.expected_revision || c.digest !== p.configuration_digest || !c.enabled || c.unavailable ||
        p.expires_at <= this.k.clock() || p.expires_at > c.expires_at) throw new Error('PARTNER_CONFIGURATION_CHANGED');
      if (c.body.configured_by === s.actor_id) throw new Error('INDEPENDENT_REVIEW_REQUIRED');
      if (!partnerCurrentActor(this.k, s, c.body.configured_by, 'action.configure')) throw new Error('PARTNER_AUTHOR_AUTHORITY_CHANGED');
      const controls = assertExecution(this.k, s, PARTNER_ACTION);
      const body = {configuration_digest: c.digest, revision: c.revision, approved_by: s.actor_id,
        control_stamp: controls.stamp, qualification: PARTNER_QUALIFICATION, external_qualified: false};
      const old = checked(this.k.db.prepare('SELECT * FROM commerce_partner_approvals WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id, s.store_id, p.approval_id) as Row | undefined);
      if (old) {
        if (old.state !== 'approved' || old.service !== p.service || old.account_id !== p.account_id || old.digest !== contentDigest(body) || old.expires_at !== p.expires_at) throw new Error('PARTNER_APPROVAL_CONFLICT');
      } else this.k.db.prepare("INSERT INTO commerce_partner_approvals VALUES(?,?,?,?,?,?,'approved',?,?,?,?)")
        .run(s.tenant_id, s.store_id, p.approval_id, p.service, p.account_id, c.revision, canonical(body), contentDigest(body), p.expires_at, this.k.clock());
      return {id: p.approval_id, digest: contentDigest(body), expires_at: p.expires_at, external_qualified: false};
    });
  }
  inspect(scope: Scope, value: PartnerContext) {
    const context = partnerContext(value), s = this.k.authorize(scope, 'capability.read'), c = this.#configuration(s, context.service, context.account_id);
    const reasons: string[] = [], controls = controlState(this.k, s, PARTNER_ACTION);
    if (!c || !c.enabled) reasons.push('SERVICE_DISABLED');
    if (c?.unavailable) reasons.push('PARTNER_OUTAGE');
    if (c && c.expires_at <= this.k.clock()) reasons.push('READINESS_EXPIRED');
    if (c && (c.body.service !== context.service || c.body.account_id !== context.account_id || c.body.source_identity !== context.source_identity ||
      c.body.source_config_digest !== context.source_config_digest || c.body.qualification !== PARTNER_QUALIFICATION)) reasons.push('PARTNER_CONFIGURATION_CHANGED');
    if (c && !c.body.regions.includes(context.region)) reasons.push('REGION_UNSUPPORTED');
    if (c && !c.body.capabilities.includes(context.capability)) reasons.push('CAPABILITY_UNSUPPORTED');
    if (c && !partnerCurrentActor(this.k, s, c.body.configured_by, 'action.configure')) reasons.push('PARTNER_AUTHOR_AUTHORITY_CHANGED');
    const approval = c ? checked(this.k.db.prepare(`SELECT * FROM commerce_partner_approvals WHERE tenant_id=? AND store_id=? AND service=? AND account_id=?
      AND revision=? AND state='approved' ORDER BY created_at DESC,id DESC LIMIT 1`).get(s.tenant_id, s.store_id, context.service, context.account_id, c.revision) as Row | undefined) : null;
    if (!approval || approval.expires_at <= this.k.clock()) reasons.push('INDEPENDENT_APPROVAL_REQUIRED');
    if (approval && (!c || approval.body.configuration_digest !== c.digest || approval.body.approved_by === c.body.configured_by ||
      !partnerCurrentActor(this.k, s, approval.body.approved_by, 'action.approve') || approval.body.control_stamp !== controls.stamp)) reasons.push('PARTNER_APPROVAL_CHANGED');
    if (controls.stopped) reasons.push('EXECUTION_STOPPED');
    try {assertRecoveryEgress(this.k);} catch {reasons.push('RECOVERY_EGRESS_BLOCKED');}
    return {ready: reasons.length === 0, reasons, revision: c?.revision ?? 0, configuration_digest: c?.digest ?? null,
      approval_id: approval?.id ?? null, approval_digest: approval?.digest ?? null,
      expires_at: c && approval ? Math.min(c.expires_at, approval.expires_at) : null,
      control_stamp: controls.stamp, qualification: PARTNER_QUALIFICATION, external_qualified: false,
      alternative: 'merchant_review_without_partner_promise'};
  }
  assertReady(scope: Scope, context: PartnerContext, previous?: PartnerPin): PartnerPin {
    const result = this.inspect(scope, context); if (!result.ready) throw new Error('PARTNER_UNAVAILABLE');
    const pin: PartnerPin = {...partnerContext(context), revision: result.revision, configuration_digest: result.configuration_digest!,
      approval_id: result.approval_id!, approval_digest: result.approval_digest!, expires_at: result.expires_at!, control_stamp: result.control_stamp,
      qualification: PARTNER_QUALIFICATION, external_qualified: false};
    if (previous && contentDigest(previous) !== contentDigest(pin)) throw new Error('PARTNER_PIN_CHANGED'); return pin;
  }
  /** A caller must supply an already-persisted original command. This performs
   * read/lookup authorization only and cannot issue a new effect or new pin. */
  assertReconcile(scope: Scope, value: PartnerContext) {
    const context = partnerContext(value), s = this.k.authorize(scope, 'operation.reconcile'); assertRecoveryEgress(this.k);
    return {tenant_id: s.tenant_id, store_id: s.store_id, ...context, lookup_only: true, new_effect_authorized: false};
  }
  revoke(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['service', 'account_id']); id(p.service); id(p.account_id);
    return this.k.transaction(() => {
      const s = this.k.authorize(scope, 'action.configure');
      this.k.db.prepare('UPDATE commerce_partner_configurations SET enabled=0 WHERE tenant_id=? AND store_id=? AND service=? AND account_id=?')
        .run(s.tenant_id, s.store_id, p.service, p.account_id);
      this.k.db.prepare("UPDATE commerce_partner_approvals SET state='revoked' WHERE tenant_id=? AND store_id=? AND service=? AND account_id=?")
        .run(s.tenant_id, s.store_id, p.service, p.account_id); return {revoked: true, original_reconciliation_available: true};
    });
  }
  outage(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['service', 'account_id', 'unavailable']); id(p.service); id(p.account_id);
    if (typeof p.unavailable !== 'boolean') throw new Error('INVALID_INPUT');
    const s = this.k.authorize(scope, 'action.configure');
    this.k.db.prepare('UPDATE commerce_partner_configurations SET unavailable=? WHERE tenant_id=? AND store_id=? AND service=? AND account_id=?')
      .run(Number(p.unavailable), s.tenant_id, s.store_id, p.service, p.account_id); return {unavailable: p.unavailable};
  }
}
