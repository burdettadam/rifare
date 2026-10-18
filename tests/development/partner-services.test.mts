import test from 'node:test';
import assert from 'node:assert/strict';
import { usingPartner, usingPartnerWarehouse, changedPartnerModule } from './partner-services-helpers.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';

test('CASE-M10-G01-01', () => usingPartner(f => {
  const {pin} = f.enable('protection');
  assert.equal(pin.qualification, 'synthetic_local_only'); assert.equal(pin.external_qualified, false);
  assert.equal(f.readiness.inspect(f.a.scope, f.context('protection')).ready, true);
  assert.equal(f.readiness.inspect(f.a.scope, f.context('protection', 'underwrite')).ready, false);
  assert.equal(f.readiness.inspect(f.a.scope, f.context('protection', 'issue', 'EU_TEST')).ready, false);
  assert.equal(f.readiness.inspect(f.b.scope, f.context('protection')).ready, false);
}));
test('CASE-M10-G01-02', () => usingPartner(f => {
  assert.equal(f.readiness.inspect(f.a.scope, f.context('protection')).ready, false);
  const {configuration} = f.enable('protection', {expires_at: f.now() + 100});
  assert.throws(() => f.readiness.approve(f.owner, {service: 'protection', account_id: 'protection_account', approval_id: 'self_review',
    expected_revision: configuration.revision, configuration_digest: configuration.digest, expires_at: f.now() + 100}), /INDEPENDENT_REVIEW_REQUIRED/);
  f.advance(101); assert.throws(() => f.readiness.assertReady(f.a.scope, f.context('protection')), /PARTNER_UNAVAILABLE/);
  assert.equal(f.source.coverageEffects().length, 0);
}));
test('CASE-M10-G01-03', async () => {
  await usingPartner(async f => {
    const p = f.protectionReady(); f.source.beforeCommit = () => f.readiness.revoke(f.owner, {service: 'protection', account_id: 'protection_account'});
    const blocked = await f.protection.dispatch(f.a.scope, p.id); assert.equal(blocked.state, 'blocked'); assert.equal(f.source.coverageEffects().length, 0);
  });
  await usingPartner(async f => {
    const p = f.protectionReady(); f.source.loseNextResponse = true;
    assert.equal((await f.protection.dispatch(f.a.scope, p.id)).state, 'unknown');
    f.readiness.revoke(f.owner, {service: 'protection', account_id: 'protection_account'});
    const result = await f.protection.reconcile(f.a.scope, p.id);
    assert.equal(result.state, 'issued'); assert.equal(f.source.coverageEffects().length, 1);
  });
  await changedPartnerModule('../../packages/commerce/partner-readiness.mts', 'PartnerReadiness',
    'ready: reasons.length === 0,', 'ready: true, // deliberate credential/configuration-as-contract bypass', Broken => usingPartner(f => {
      const result = new Broken(f.kernel).inspect(f.a.scope, f.context('protection'));
      assert.throws(() => assert.equal(result.ready, false, 'A configured fixture or credential is not contractual authority'), assert.AssertionError);
    }));
});

test('M10-G07-PREP-01', () => usingPartner(async f => {
  const p = f.protectionReady(), result = await f.protection.dispatch(f.a.scope, p.id);
  assert.equal(result.state, 'issued'); assert.equal(result.fee_minor, '500'); assert.equal(result.loss_party, 'synthetic_insurer');
  assert.equal(result.reimbursement_guaranteed, false); assert.equal(result.financial_settlement, 'unobserved');
  f.confirmProtection(p); await f.protection.dispatch(f.a.scope, p.id); assert.equal(f.source.coverageEffects().length, 1);
}));
test('M10-G07-PREP-02', () => usingPartner(f => {
  assert.throws(() => f.proposal(), /PARTNER_UNAVAILABLE/); f.enable('protection');
  assert.throws(() => f.proposal({product_id: 'excluded'}), /PRODUCT_EXCLUDED/);
  assert.throws(() => f.proposal({region: 'EU_TEST'}), /PARTNER_UNAVAILABLE|REGION_UNSUPPORTED/);
  const p = f.proposal(); f.reviewProtection(p);
  assert.throws(() => f.protection.confirm(f.a.scope, {proposal_id: p.id, preview_digest: p.preview_digest}), /CUSTOMER_VERIFICATION_REQUIRED/);
  assert.equal(f.source.coverageEffects().length, 0);
}));
test('M10-G07-PREP-03', async () => {
  await usingPartner(async f => {
    const p = f.protectionReady(), terms = f.source.configuration('protection')!.body.terms;
    f.configureSource('protection', {terms: {...terms, fee_minor: '900'}});
    assert.throws(() => f.confirmProtection(p), /PARTNER_UNAVAILABLE|PREVIEW_CHANGED/);
    await assert.rejects(f.protection.dispatch(f.a.scope, p.id), /PARTNER_UNAVAILABLE|PREVIEW_CHANGED/);
    assert.equal(f.source.coverageEffects().length, 0);
  });
  await changedPartnerModule('../../packages/commerce/protection-coverage.mts', 'ProtectionCoverage',
    'reimbursement_guaranteed: false,', 'reimbursement_guaranteed: true,', Broken => usingPartner(async f => {
      const p = f.protectionReady(); await f.protection.dispatch(f.a.scope, p.id);
      assert.throws(() => assert.equal(new Broken(f.kernel, f.source).read(f.a.scope, p.id).reimbursement_guaranteed, false,
        'A locally recorded fee cannot establish reimbursement'), assert.AssertionError);
    }));
});

test('M10-G08-PREP-01', () => usingPartner(f => {
  f.enable('duties'); const c = f.dutyCase();
  f.source.recordDuty({event_id: 'assessment_one', resource_id: f.resource_id, route_id: 'US_TEST_CA_TEST', kind: 'assessment', quote_ref: 'duty_estimate',
    amount_minor: '850', currency: 'USD', party_ref: 'customs_fixture', observed_at: f.now()});
  const result = f.duties.assess(f.a.scope, {case_id: c.id, assessment_id: 'assessment_one'});
  assert.equal(result.estimate_minor, '700'); assert.equal(result.assessment_minor, '850'); assert.equal(result.variance_minor, '150');
  assert.equal(result.collection_minor, null); assert.equal(result.remittance_minor, null); assert.equal(result.variance_state, 'review_required');
  assert.equal(result.assessment_ref, 'assessment_one');
}));
test('M10-G08-PREP-02', () => usingPartner(f => {
  assert.throws(() => f.dutyCase(), /PARTNER_UNAVAILABLE/); f.enable('duties');
  f.source.recordDuty({event_id: 'unsupported_estimate', resource_id: f.resource_id, route_id: 'unsupported_route', kind: 'estimate', quote_ref: 'unsupported_estimate',
    amount_minor: '700', currency: 'USD', party_ref: 'synthetic_calculator', observed_at: f.now()});
  assert.throws(() => f.duties.open(f.a.scope, {case_id: 'bad_route', resource_id: f.resource_id, estimate_id: 'unsupported_estimate', region: 'US_TEST'}), /ROUTE_UNSUPPORTED/);
  f.readiness.outage(f.owner, {service: 'duties', account_id: 'duties_account', unavailable: true});
  assert.throws(() => f.dutyCase(), /PARTNER_UNAVAILABLE/);
}));
test('M10-G08-PREP-03', async () => {
  await usingPartner(f => {
    f.enable('duties'); const c = f.dutyCase();
    f.source.recordDuty({event_id: 'assessment_one', resource_id: f.resource_id, route_id: 'US_TEST_CA_TEST', kind: 'assessment', quote_ref: 'duty_estimate',
      amount_minor: '850', currency: 'USD', party_ref: 'customs_fixture', observed_at: f.now()});
    const result = f.duties.assess(f.a.scope, {case_id: c.id, assessment_id: 'assessment_one'});
    assert.throws(() => f.duties.approveVariance(f.a.scope, {case_id: c.id, variance_digest: result.variance_digest, obligation_ref: 'approved_difference'}), /ACCESS_DENIED/);
    const reviewed = f.duties.approveVariance(f.reviewer, {case_id: c.id, variance_digest: result.variance_digest, obligation_ref: 'approved_difference'});
    assert.equal(reviewed.variance_state, 'approved_obligation'); assert.equal(reviewed.assessment_minor, '850'); assert.equal(reviewed.collection_minor, null);
  });
  await changedPartnerModule('../../packages/commerce/duty-assessments.mts', 'DutyAssessments',
    'assessment_minor: assessment.amount_minor,', 'assessment_minor: estimate.amount_minor,', Broken => usingPartner(f => {
      f.enable('duties'); const c = f.dutyCase();
      f.source.recordDuty({event_id: 'assessment_one', resource_id: f.resource_id, route_id: 'US_TEST_CA_TEST', kind: 'assessment', quote_ref: 'duty_estimate',
        amount_minor: '850', currency: 'USD', party_ref: 'customs_fixture', observed_at: f.now()});
      const result = new Broken(f.kernel, f.source).assess(f.a.scope, {case_id: c.id, assessment_id: 'assessment_one'});
      assert.throws(() => assert.equal(result.assessment_minor, '850', 'Final customs assessment must not be overwritten by its estimate'), assert.AssertionError);
    }));
});

test('M10-G09-PREP-01', () => usingPartnerWarehouse(f => {
  f.enable('reverse_hub'); const route = f.route(), event = f.event();
  const result = f.hubs.importReceipt(f.a.scope, {route_id: route.id, event_id: event.event_id});
  assert.equal(result.site_id, 'hub_one'); assert.equal(result.observed_receipt_units, 1);
  assert.equal(result.warehouse_source_identity, f.warehouse.identity); assert.equal(result.physical_receipt_qualified, false);
  assert.equal(f.warehouse.stock('shirt-small', 'warehouse-one'), 0);
}));
test('M10-G09-PREP-02', () => usingPartnerWarehouse(f => {
  assert.throws(() => f.route(), /PARTNER_UNAVAILABLE/); f.enable('reverse_hub');
  assert.throws(() => f.hubs.route(f.a.scope, {route_id: 'excluded_route', request_id: f.request.id, site_id: 'hub_one', category: 'medical', region: 'US_TEST'}), /SITE_CATEGORY_UNSUPPORTED/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM commerce_warehouse_return_events').get()!.n, 0);
}));
test('M10-G09-PREP-03', async () => {
  await usingPartnerWarehouse(f => {
    f.enable('reverse_hub'); const route = f.route(), delivery = f.event({kind: 'delivery', units: []});
    assert.equal(f.hubs.importReceipt(f.a.scope, {route_id: route.id, event_id: delivery.event_id}).observed_receipt_units, 0);
    const receipt = f.event(); f.hubs.importReceipt(f.a.scope, {route_id: route.id, event_id: receipt.event_id});
    const correction = f.event({kind: 'correction', parent_event_id: receipt.event_id, units: [f.unit({received: false})]});
    const result = f.hubs.importReceipt(f.a.scope, {route_id: route.id, event_id: correction.event_id});
    assert.equal(result.observed_receipt_units, 0); assert.equal(result.events.length, 3);
  });
  await changedPartnerModule('../../packages/commerce/reverse-hubs.mts', 'ReverseHubs',
    'observed_receipt_units: receipt.total_actual,', 'observed_receipt_units: 3,', Broken => usingPartnerWarehouse(f => {
      f.enable('reverse_hub'); const route = f.route();
      assert.throws(() => assert.equal(new Broken(f.kernel, f.source, f.warehouse).read(f.a.scope, route.id).observed_receipt_units, 0,
        'A software route is not a physical receipt'), assert.AssertionError);
    }));
});

test('M10-G10-PREP-01', () => usingPartner(f => {
  f.enable('international_handoff'); f.journey(); f.handoffEvent(); f.handoffs.import(f.a.scope, {journey_id: 'journey_one', event_id: 'handoff_one'});
  f.handoffEvent({event_id: 'handoff_two', sequence: 2, kind: 'received', final_minor: '350', fee_ref: 'fee_local'});
  const result = f.handoffs.import(f.a.scope, {journey_id: 'journey_one', event_id: 'handoff_two'});
  assert.equal(result.all_completed, false); assert.equal(result.legs[0].state, 'received'); assert.equal(result.legs[1].state, 'not_started');
  assert.equal(result.final_cost_minor, '350'); assert.deepEqual(result.current_custody, [{unit_id: 'unit_one', site_id: 'hub', in_transit: false}]);
}));
test('M10-G10-PREP-02', () => usingPartner(f => {
  f.enable('international_handoff'); f.journey(); f.handoffEvent({event_id: 'missing_first', sequence: 2, kind: 'received'});
  assert.throws(() => f.handoffs.import(f.a.scope, {journey_id: 'journey_one', event_id: 'missing_first'}), /HANDOFF_SEQUENCE_MISSING/);
  f.advance(1000); assert.equal(f.handoffs.read(f.a.scope, 'journey_one').all_completed, false);
  f.handoffEvent({event_id: 'rejected_first', kind: 'rejected'});
  const result = f.handoffs.import(f.a.scope, {journey_id: 'journey_one', event_id: 'rejected_first'});
  assert.equal(result.legs[0].state, 'rejected'); assert.equal(result.final_cost_minor, '0');
}));
test('M10-G10-PREP-03', async () => {
  await usingPartner(f => {
    f.enable('international_handoff'); f.journey(); f.handoffEvent(); f.handoffs.import(f.a.scope, {journey_id: 'journey_one', event_id: 'handoff_one'});
    f.handoffEvent({event_id: 'handoff_two', sequence: 2, kind: 'received', final_minor: '350', fee_ref: 'fee_local'});
    f.handoffs.import(f.a.scope, {journey_id: 'journey_one', event_id: 'handoff_two'});
    const result = f.handoffs.import(f.a.scope, {journey_id: 'journey_one', event_id: 'handoff_two'});
    assert.equal(result.events.length, 2); assert.equal(result.final_cost_minor, '350'); assert.equal(result.all_completed, false);
  });
  await changedPartnerModule('../../packages/commerce/international-handoffs.mts', 'InternationalHandoffs',
    "all_completed: legs.every(leg => leg.state === 'received'),", "all_completed: legs.some(leg => leg.state === 'received'),", Broken => usingPartner(f => {
      f.enable('international_handoff'); f.journey(); f.handoffEvent(); f.handoffs.import(f.a.scope, {journey_id: 'journey_one', event_id: 'handoff_one'});
      f.handoffEvent({event_id: 'handoff_two', sequence: 2, kind: 'received', final_minor: '350', fee_ref: 'fee_local'});
      f.handoffs.import(f.a.scope, {journey_id: 'journey_one', event_id: 'handoff_two'});
      assert.throws(() => assert.equal(new Broken(f.kernel, f.source).read(f.a.scope, 'journey_one').all_completed, false,
        'First hub receipt cannot complete the cross-border journey'), assert.AssertionError);
    }));
});

test('M10-G11-PREP-01', () => usingPartner(async f => {
  f.enable('hsa_fsa'); const p = f.hsaProposal();
  const result = await f.hsa.confirm(f.customer, {operation_id: p.id, preview_digest: p.preview_digest});
  assert.equal(result.state, 'eligibility_confirmed'); assert.equal(result.payment_reference, 'native_payment_one');
  assert.equal(result.payment_status, 'authorized'); assert.equal(result.payment_effect_executed, false); assert.equal(result.external_qualified, false);
  assert.equal(f.source.eligibilityEffects().length, 1);
}));
test('M10-G11-PREP-02', () => usingPartner(f => {
  assert.throws(() => f.hsaProposal(), /PARTNER_UNAVAILABLE/); f.enable('hsa_fsa');
  f.eligibility({eligibility_id: 'unqualified', eligible: false});
  assert.throws(() => f.hsa.propose(f.a.scope, {operation_id: 'bad_eligibility', resource_id: f.resource_id,
    eligibility_id: 'unqualified', payment_resource_id: f.payment.id, product_id: 'shirt', region: 'US_TEST'}), /PROVIDER_ELIGIBILITY_REQUIRED/);
  assert.throws(() => f.hsa.propose(f.a.scope, {operation_id: 'model_eligibility', resource_id: f.resource_id,
    eligibility_id: 'missing', payment_resource_id: f.payment.id, product_id: 'shirt', region: 'US_TEST', generated_health_description: 'medically beneficial'}), /INVALID_INPUT/);
  assert.equal(f.source.eligibilityEffects().length, 0);
}));
test('M10-G11-PREP-03', async () => {
  await usingPartner(async f => {
    f.enable('hsa_fsa'); const p = f.hsaProposal(); f.eligibility({revision: 2, eligible: false});
    await assert.rejects(f.hsa.confirm(f.customer, {operation_id: p.id, preview_digest: p.preview_digest}), /PROVIDER_ELIGIBILITY_REQUIRED|PREVIEW_CHANGED/);
    assert.equal(f.source.eligibilityEffects().length, 0);
  });
  await usingPartner(async f => {
    f.enable('hsa_fsa'); const p = f.hsaProposal(); f.source.loseNextResponse = true;
    assert.equal((await f.hsa.confirm(f.customer, {operation_id: p.id, preview_digest: p.preview_digest})).state, 'unknown');
    f.readiness.revoke(f.owner, {service: 'hsa_fsa', account_id: 'hsa_fsa_account'});
    assert.equal((await f.hsa.reconcile(f.a.scope, p.id)).state, 'eligibility_confirmed');
    assert.equal(f.source.eligibilityEffects().length, 1);
  });
  await changedPartnerModule('../../packages/commerce/hsa-fsa.mts', 'HsaFsa',
    "if (!eligibility.eligible) throw new Error('PROVIDER_ELIGIBILITY_REQUIRED');", '// Deliberate model-description-as-authority bypass', Broken => usingPartner(f => {
      f.enable('hsa_fsa'); f.eligibility({eligible: false});
      const oracle = () => assert.throws(() => new Broken(f.kernel, f.source).propose(f.a.scope, {operation_id: 'broken_eligibility', resource_id: f.resource_id,
        eligibility_id: 'eligibility_one', payment_resource_id: f.payment.id, product_id: 'shirt', region: 'US_TEST'}), /PROVIDER_ELIGIBILITY_REQUIRED/);
      assert.throws(oracle, assert.AssertionError);
    }));
});

test('M10-G12-PREP-01', () => usingPartner(async f => {
  f.enable('network_alerts'); const a = f.importAlert(), p = f.response(); f.approveResponse(p);
  const r = await f.alerts.dispatch(f.a.scope, p.id);
  assert.equal(r.state, 'acknowledged'); assert.equal(a.deadline_at, f.now() + 60000); assert.equal(a.account_id, 'network_alerts_account');
  assert.equal(f.alerts.read(f.a.scope, 'network_alert').fee_minor, '100');
  assert.equal(f.alerts.read(f.a.scope, 'network_alert').recovered_minor, '0'); assert.equal(f.source.alertEffects().length, 1);
}));
test('M10-G12-PREP-02', () => usingPartner(f => {
  assert.throws(() => f.importAlert(), /PARTNER_UNAVAILABLE/); f.enable('network_alerts');
  f.alert({event_id: 'wrong_account_event', alert_id: 'wrong_account_alert', account_id: 'other_account'});
  assert.throws(() => f.alerts.import(f.a.scope, {event_id: 'wrong_account_event', resource_id: f.resource_id, region: 'US_TEST'}), /PARTNER_SOURCE_SCOPE/);
  f.importAlert(); assert.throws(() => f.response({response: 'refund'}), /ALERT_RESPONSE_UNSUPPORTED/);
  assert.throws(() => f.alerts.read(f.b.scope, 'network_alert'), /NOT_FOUND|ACCESS_DENIED/); assert.equal(f.source.alertEffects().length, 0);
}));
test('M10-G12-PREP-03', async () => {
  await usingPartner(async f => {
    f.enable('network_alerts'); f.importAlert(); const p = f.response(); f.approveResponse(p); f.source.loseNextResponse = true;
    assert.equal((await f.alerts.dispatch(f.a.scope, p.id)).state, 'unknown');
    f.advance(60001); await f.alerts.reconcile(f.a.scope, p.id);
    assert.throws(() => f.response({operation_id: 'duplicate_response'}), /ORIGINAL_OPERATION_REQUIRED|ALERT_DEADLINE_EXPIRED/);
    const result = f.alerts.import(f.a.scope, {event_id: 'network_event', resource_id: f.resource_id, region: 'US_TEST'});
    assert.equal(result.fee_minor, '100'); assert.equal(result.recovered_minor, '0'); assert.equal(f.source.alertEffects().length, 1);
  });
  await changedPartnerModule('../../packages/commerce/network-alerts.mts', 'NetworkAlerts',
    'network_coverage_qualified: false,', 'network_coverage_qualified: true,', Broken => usingPartner(f => {
      f.enable('network_alerts'); f.importAlert();
      assert.throws(() => assert.equal(new Broken(f.kernel, f.source).read(f.a.scope, 'network_alert').network_coverage_qualified, false,
        'Webhook fixtures cannot establish contracted network coverage'), assert.AssertionError);
    }));
});

test('PORT-028', async () => {
  await usingPartner(f => {
    assert.throws(() => f.proposal(), /PARTNER_UNAVAILABLE/);
    assert.throws(() => f.dutyCase(), /PARTNER_UNAVAILABLE/);
    assert.throws(() => f.hsaProposal(), /PARTNER_UNAVAILABLE/);
    assert.throws(() => f.importAlert(), /PARTNER_UNAVAILABLE/);
    assert.equal(f.source.coverageEffects().length + f.source.eligibilityEffects().length + f.source.alertEffects().length, 0);
    assert.equal(f.readiness.inspect(f.a.scope, f.context('protection')).alternative, 'merchant_review_without_partner_promise');
  });
  await usingPartnerWarehouse(f => {
    assert.throws(() => f.route(), /PARTNER_UNAVAILABLE/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM commerce_warehouse_return_events').get()!.n, 0);
  });
});
