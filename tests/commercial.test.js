import test from 'node:test';
import assert from 'node:assert/strict';
import { JobFlowAppService } from '../src/app-service.js';

class MemoryStore {
  constructor() { this.value = {}; }
  async load(fallback) { return Object.keys(this.value).length ? structuredClone(this.value) : structuredClone(fallback); }
  async save(value) { this.value = structuredClone(value); }
}

test('billing events are idempotent and activate a business once', async () => {
  const service = new JobFlowAppService({ store: new MemoryStore(), business: { id: 'biz-1' } });
  await service.init();
  const update = { businessId: 'biz-1', customerId: 'cus_1', subscriptionId: 'sub_1', status: 'active' };
  const first = await service.applyBillingEvent('evt_1', update);
  const second = await service.applyBillingEvent('evt_1', update);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(service.isPaid(), true);
  assert.equal(service.economicProduction().metrics.payingBusinesses, 1);
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
