import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { id, integer, exact } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import {
  supportCase,
  supportText,
  supportEvent,
  ownershipRow,
  SupportOwnership,
} from './support-core.mts';

export const SUPPORT_CHANNELS = Object.freeze(['webchat', 'email', 'sms', 'helpdesk']);
export class SupportConversations {
  readonly k: CommerceKernel;
  constructor(k: CommerceKernel) {
    this.k = k;
  }
  link(scope: Scope, customerProof: Scope, input: unknown) {
    const p = exact(jsonValue(input), [
      'case_id',
      'channel',
      'account_id',
      'external_id',
      'history',
      'source_revision',
    ]);
    if (
      !SUPPORT_CHANNELS.includes(p.channel) ||
      !['partial', 'complete', 'unavailable'].includes(p.history)
    )
      throw new Error('SUPPORT_INPUT_INVALID');
    id(p.account_id);
    id(p.external_id);
    integer(p.source_revision, 1);
    return this.k.transaction(() => {
      const { s, c } = supportCase(this.k, scope, p.case_id, 'support.link'),
        v = this.k.require(customerProof, ['customer']);
      if (
        v.role !== 'customer' ||
        v.tenant_id !== s.tenant_id ||
        v.store_id !== s.store_id ||
        v.resource_id !== c.resource_id ||
        v.customer_id !== c.customer_id
      )
        throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
      const ref =
          'slink_' +
          contentDigest([s.tenant_id, s.store_id, p.channel, p.account_id, p.external_id]).slice(
            0,
            40,
          ),
        old = this.k.db
          .prepare('SELECT * FROM commerce_support_links WHERE tenant_id=? AND store_id=? AND id=?')
          .get(s.tenant_id, s.store_id, ref) as Row;
      if (old) {
        if (old.erased || old.case_id !== c.id || old.customer_id !== c.customer_id)
          throw new Error('CONVERSATION_IDENTITY_CONFLICT');
        if (p.source_revision < old.source_revision) throw new Error('SOURCE_VERSION_CONFLICT');
        if (p.source_revision === old.source_revision && p.history !== old.history)
          throw new Error('SOURCE_VERSION_CONFLICT');
        this.k.db
          .prepare(
            'UPDATE commerce_support_links SET history=?,source_revision=? WHERE tenant_id=? AND store_id=? AND id=?',
          )
          .run(p.history, p.source_revision, s.tenant_id, s.store_id, ref);
      } else
        this.k.db
          .prepare('INSERT INTO commerce_support_links VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)')
          .run(
            s.tenant_id,
            s.store_id,
            ref,
            c.id,
            c.resource_id,
            c.customer_id,
            p.channel,
            p.account_id,
            p.external_id,
            p.history,
            p.source_revision,
            this.k.clock(),
          );
      if (!ownershipRow(this.k, s, c.id))
        new SupportOwnership(this.k).takeover(scope, {
          case_id: c.id,
          expected_generation: 0,
          reason: 'operator_requested',
        });
      supportEvent(
        this.k,
        s,
        c.id,
        'channel_linked',
        ownershipRow(this.k, s, c.id)!.generation,
        ref,
      );
      return this.linkRecord(scope, ref);
    });
  }
  linkRecord(scope: Scope, ref: string) {
    const s = this.k.require(scope);
    id(ref);
    const r = this.k.db
      .prepare(
        'SELECT * FROM commerce_support_links WHERE tenant_id=? AND store_id=? AND id=? AND erased=0',
      )
      .get(s.tenant_id, s.store_id, ref) as Row;
    if (!r) throw new Error('NOT_FOUND');
    supportCase(this.k, scope, r.case_id);
    return r;
  }
  ingest(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), [
      'link_id',
      'external_id',
      'direction',
      'visibility',
      'text',
      'source_at',
    ]);
    id(p.external_id);
    integer(p.source_at);
    if (
      !['incoming', 'outgoing', 'internal'].includes(p.direction) ||
      !['public', 'staff'].includes(p.visibility) ||
      p.source_at > this.k.clock() ||
      (p.direction === 'internal') !== (p.visibility === 'staff')
    )
      throw new Error('SUPPORT_INPUT_INVALID');
    supportText(p.text);
    return this.k.transaction(() => {
      const link = this.linkRecord(scope, p.link_id),
        { s, c } = supportCase(this.k, scope, link.case_id, 'support.ingest');
      const hash = contentDigest(p),
        ref =
          'smsg_' + contentDigest([s.tenant_id, s.store_id, link.id, p.external_id]).slice(0, 40),
        old = this.k.db
          .prepare(
            'SELECT * FROM commerce_support_messages WHERE tenant_id=? AND store_id=? AND id=?',
          )
          .get(s.tenant_id, s.store_id, ref) as Row;
      if (old) {
        if (old.digest !== hash || old.erased) throw new Error('MESSAGE_IDEMPOTENCY_CONFLICT');
        return { id: ref, duplicate: true };
      }
      this.k.db
        .prepare('INSERT INTO commerce_support_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)')
        .run(
          s.tenant_id,
          s.store_id,
          ref,
          c.id,
          c.resource_id,
          link.id,
          p.external_id,
          p.direction,
          p.visibility,
          canonical(p),
          hash,
          p.source_at,
          this.k.clock(),
        );
      supportEvent(
        this.k,
        s,
        c.id,
        p.direction === 'incoming'
          ? 'message_received'
          : p.direction === 'outgoing'
            ? 'outbound_observed'
            : 'internal_note',
        ownershipRow(this.k, s, c.id)?.generation ?? 0,
        ref,
      );
      return { id: ref, duplicate: false };
    });
  }
  customerMessage(scope: Scope, input: unknown) {
    const p = exact(input, ['link_id', 'request_id', 'text']),
      link = this.linkRecord(scope, p.link_id),
      s = this.k.require(scope, ['customer']);
    if (
      s.role !== 'customer' ||
      s.resource_id !== link.resource_id ||
      s.customer_id !== link.customer_id
    )
      throw new Error('ACCESS_DENIED');
    // A verified customer can create only an incoming public webchat message.
    if (link.channel !== 'webchat') throw new Error('CHANNEL_UNSUPPORTED');
    return this.#incoming(scope, link, p);
  }
  #incoming(scope: Scope, link: Row, p: Row) {
    id(p.request_id);
    supportText(p.text);
    return this.k.transaction(() => {
      const { s, c } = supportCase(this.k, scope, link.case_id, 'support.customer_message');
      const body = {
          link_id: link.id,
          external_id: p.request_id,
          direction: 'incoming',
          visibility: 'public',
          text: p.text,
        },
        hash = contentDigest(body),
        ref = 'scust_' + contentDigest([link.id, p.request_id]).slice(0, 40);
      const old = this.k.db
        .prepare(
          'SELECT digest FROM commerce_support_messages WHERE tenant_id=? AND store_id=? AND id=?',
        )
        .get(s.tenant_id, s.store_id, ref) as Row;
      if (old && old.digest !== hash) throw new Error('MESSAGE_IDEMPOTENCY_CONFLICT');
      if (!old) {
        this.k.db
          .prepare('INSERT INTO commerce_support_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)')
          .run(
            s.tenant_id,
            s.store_id,
            ref,
            c.id,
            c.resource_id,
            link.id,
            p.request_id,
            'incoming',
            'public',
            canonical(body),
            hash,
            this.k.clock(),
            this.k.clock(),
          );
        supportEvent(
          this.k,
          s,
          c.id,
          'message_received',
          ownershipRow(this.k, s, c.id)?.generation ?? 0,
          ref,
        );
      }
      return { id: ref, duplicate: !!old };
    });
  }
  history(scope: Scope, caseId: string, after = 0, limit = 50) {
    integer(after);
    integer(limit, 1);
    if (limit > 100) throw new Error('SUPPORT_INPUT_INVALID');
    const { s, c } = supportCase(this.k, scope, caseId);
    const staff = ['owner', 'operator', 'reviewer'].includes(s.role),
      rows = this.k.db
        .prepare(
          `SELECT rowid cursor,* FROM commerce_support_messages WHERE tenant_id=? AND store_id=? AND case_id=? AND erased=0 AND rowid>? AND (?=1 OR visibility='public') ORDER BY rowid LIMIT ?`,
        )
        .all(s.tenant_id, s.store_id, c.id, after, Number(staff), limit + 1) as Row[];
    const selected = rows.slice(0, limit),
      messages = selected.map((r) => {
        const p = JSON.parse(r.body);
        if (contentDigest(p) !== r.digest) throw new Error('SUPPORT_MESSAGE_INTEGRITY');
        return {
          id: r.id,
          link_id: r.link_id,
          external_id: r.external_id,
          direction: r.direction,
          visibility: r.visibility,
          text: p.text,
          source_at: r.source_at,
          observed_at: r.observed_at,
        };
      });
    const links = this.k.db
      .prepare(
        'SELECT id,channel,history,source_revision,verified_at FROM commerce_support_links WHERE tenant_id=? AND store_id=? AND case_id=? AND erased=0 ORDER BY id',
      )
      .all(s.tenant_id, s.store_id, c.id) as Row[];
    return {
      case_id: c.id,
      resource_id: c.resource_id,
      messages,
      links,
      history_complete:
        links.length > 0 &&
        links.every((r) => r.history === 'complete') &&
        after === 0 &&
        rows.length <= limit,
      visibility: staff ? 'staff_and_public' : 'public_only',
      next_cursor: rows.length > limit ? selected.at(-1)!.cursor : null,
      ownership: new SupportOwnership(this.k).inspect(scope, c.id),
      unknown_history_means_no_reply: false,
    };
  }
}
