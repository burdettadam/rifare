import { fixture, frozenClock } from './fixtures.mts';

type Mode = 'success' | 'reject' | 'transient-before' | 'accepted-timeout';
type Receipt = { merchant: string; key: string; value: string; accepted_at: number; state: 'accepted_synthetic' };
export function fakeProvider(modes: Mode[] = ['success'], clock = frozenClock()) {
  if (!Array.isArray(modes) || !modes.length || modes.some(m => !['success','reject','transient-before','accepted-timeout'].includes(m))) throw new Error('INVALID_FAULT_PLAN');
  const plan = [...modes], ledger = new Map<string, Receipt>(); let attempts = 0;
  function identity(merchant: string, key: string) {
    fixture(merchant);
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error('INVALID_OPERATION_KEY');
    return merchant + ':' + key;
  }
  return Object.freeze({
    act(merchant: string, key: string, value: string) {
      const id = identity(merchant, key);
      if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new Error('INVALID_OPERATION_VALUE');
      attempts++;
      const existing = ledger.get(id);
      if (existing) {
        if (existing.value !== value) throw new Error('IDEMPOTENCY_CONFLICT');
        return structuredClone(existing);
      }
      const mode = plan.shift() ?? 'success';
      if (mode === 'reject') throw new Error('PROVIDER_REJECTED');
      if (mode === 'transient-before') throw new Error('TRANSPORT_FAILED_BEFORE_ACCEPTANCE');
      const receipt: Receipt = { merchant, key, value, accepted_at: clock.now(), state: 'accepted_synthetic' };
      ledger.set(id, receipt);
      if (mode === 'accepted-timeout') throw new Error('TRANSPORT_TIMEOUT_OUTCOME_UNKNOWN');
      return structuredClone(receipt);
    },
    lookup(merchant: string, key: string) {
      const value = ledger.get(identity(merchant, key)); return value ? structuredClone(value) : null;
    },
    snapshot() { return { attempts, effects: [...ledger.values()].map(v => structuredClone(v)).sort((a,b) => (a.merchant+a.key).localeCompare(b.merchant+b.key)) }; }
  });
}
