import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../src/store.js';
import { JobFlowAppService } from '../src/app-service.js';

test('restores persisted appointment state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobflow-'));
  const file = join(dir, 'state.json');
  try {
    const one = await new JobFlowAppService({ store: new JsonStore(file) }).init();
    const lead = await one.captureLead({ name: 'A', email: 'a@example.invalid', service: 'repair' });
    const customer = await one.createCustomerFromLead(lead.id);
    await one.scheduleAppointment({ customerId: customer.id, service: 'repair', startsAt: '2026-08-20T15:00:00Z' });
    const two = await new JobFlowAppService({ store: new JsonStore(file) }).init();
    assert.equal(two.dashboard().appointments.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
