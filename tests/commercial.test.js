import test from 'node:test';
import assert from 'node:assert/strict';
import { JobFlowAppService } from '../src/app-service.js';
import { subscriptionUpdateFromStripe } from '../src/commercial.js';

class MemoryStore {
  constructor() { this.value = {}; }
  async load(fallback) { return Object.keys(this.value).length ? structuredClone(this.value) : structuredClone(fallback); }
  async save(value) { this.value = structuredClone(value); }
}

class FailOnceStore extends MemoryStore {
  constructor() { super(); this.failNext = true; }
  async save(value) {
    if (this.failNext) { this.failNext = false; throw new Error('simulated persistence failure'); }
    await super.save(value);
  }
}

test('billing events are idempotent and activate a business once', async () => {
  const service = new JobFlowAppService({ store: new MemoryStore(), business: { id: 'biz-1' } });
  await service.init();
  const update = { businessId: 'biz-1', customerId: 'cus_1', subscriptionId: 'sub_1', status: 'active', entitlementAuthoritative: true };
  const first = await service.applyBillingEvent('evt_1', update);
  const second = await service.applyBillingEvent('evt_1', update);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(service.isPaid(), true);
  assert.equal(service.economicProduction().metrics.payingBusinesses, 1);
});

test('checkout completion links Stripe identity but cannot grant paid entitlement', async () => {
  const service = new JobFlowAppService({ store: new MemoryStore(), business: { id: 'biz-checkout' } });
  await service.init();
  const update = subscriptionUpdateFromStripe({
    type: 'checkout.session.completed',
    data: { object: { metadata: { business_id: 'biz-checkout' }, customer: 'cus_checkout', subscription: 'sub_checkout' } },
  });
  await service.applyBillingEvent('evt_checkout', update);
  assert.equal(service.isPaid(), false);
  assert.equal(service.billingState().customerId, 'cus_checkout');
  assert.equal(service.billingState().subscriptionId, 'sub_checkout');
  assert.equal(service.economicProduction().metrics.payingBusinesses, 0);
});

test('subscription state is authoritative and repeated active updates do not fake retention', async () => {
  const service = new JobFlowAppService({ store: new MemoryStore(), business: { id: 'biz-authoritative' } });
  await service.init();
  const active = subscriptionUpdateFromStripe({
    type: 'customer.subscription.updated',
    data: { object: { metadata: { business_id: 'biz-authoritative' }, customer: 'cus_a', id: 'sub_a', status: 'active' } },
  });
  await service.applyBillingEvent('evt_active_1', active);
  await service.applyBillingEvent('evt_active_2', active);
  const metrics = service.economicProduction().metrics;
  assert.equal(service.isPaid(), true);
  assert.equal(metrics.payingBusinesses, 1);
  assert.equal(metrics.retainedBusinesses, 0);
});

test('unattributed or cross-business webhooks fail before claiming idempotency', async () => {
  const service = new JobFlowAppService({ store: new MemoryStore(), business: { id: 'biz-owned' } });
  await service.init();
  await assert.rejects(
    service.applyBillingEvent('evt_missing_owner', { customerId: 'cus_x', subscriptionId: 'sub_x', status: 'active', entitlementAuthoritative: true }),
    /business identity is required/,
  );
  await assert.rejects(
    service.applyBillingEvent('evt_wrong_owner', { businessId: 'biz-other', customerId: 'cus_x', subscriptionId: 'sub_x', status: 'active', entitlementAuthoritative: true }),
    /business mismatch/,
  );
  assert.equal(service.isPaid(), false);
  const accepted = await service.applyBillingEvent('evt_missing_owner', { businessId: 'biz-owned', customerId: 'cus_ok', subscriptionId: 'sub_ok', status: 'active', entitlementAuthoritative: true });
  assert.equal(accepted.duplicate, false);
  assert.equal(service.isPaid(), true);
});

test('failed persistence rolls back entitlement and releases the event for Stripe retry', async () => {
  const store = new FailOnceStore();
  const service = new JobFlowAppService({ store, business: { id: 'biz-retry' } });
  await service.init();
  const update = { businessId: 'biz-retry', customerId: 'cus_retry', subscriptionId: 'sub_retry', status: 'active', entitlementAuthoritative: true };
  await assert.rejects(service.applyBillingEvent('evt_retry', update), /simulated persistence failure/);
  assert.equal(service.isPaid(), false);
  assert.equal(service.economicProduction().metrics.payingBusinesses, 0);
  const retry = await service.applyBillingEvent('evt_retry', update);
  assert.equal(retry.duplicate, false);
  assert.equal(service.isPaid(), true);
  assert.equal(service.economicProduction().metrics.payingBusinesses, 1);
});

test('unsupported Stripe events are ignored without mutating billing state', async () => {
  const service = new JobFlowAppService({ store: new MemoryStore(), business: { id: 'biz-ignore' } });
  await service.init();
  const ignored = await service.applyBillingEvent('evt_ignore', subscriptionUpdateFromStripe({ type: 'invoice.created', data: { object: {} } }));
  assert.equal(ignored.ignored, true);
  assert.equal(service.isPaid(), false);
});

test('recovered appointments feed economic production metrics', async () => {
  const service = new JobFlowAppService({ store: new MemoryStore(), business: { id: 'biz-2' } });
  await service.init();
  const lead = await service.captureLead({ name: 'A', phone: '1', service: 'repair', missedCall: true });
  await service.qualifyLead(lead.id, { qualified: true });
  const customer = await service.createCustomerFromLead(lead.id);
  await service.scheduleAppointment({ customerId: customer.id, service: 'repair', startsAt: '2026-08-28T10:00:00Z', priceCents: 50000, recovered: true });
  assert.equal(service.economicProduction().metrics.recoveredRevenueUsd, 500);
});
