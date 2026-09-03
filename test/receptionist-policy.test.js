import test from 'node:test';
import assert from 'node:assert/strict';
import { AppointmentWorkflow, ReceptionistPolicy } from '../src/receptionist-policy.js';

test('requires approval for consequential scheduling changes and verifies external state', () => {
  const policy = new ReceptionistPolicy();
  assert.equal(policy.decide('lookup_booking').allowed, true);
  assert.equal(policy.decide('reschedule_booking').allowed, false);
  assert.equal(policy.decide('reschedule_booking', { approved: true }).allowed, true);
  assert.equal(policy.decide('issue_refund').allowed, false);

  const workflow = new AppointmentWorkflow({ policy, bookingId: 'b1', customerId: 'c1' });
  const event = workflow.perform('reschedule_booking', {
    approved: true,
    execute: () => ({ bookingId: 'b1', startsAt: '2026-09-04T14:00:00Z' }),
    verify: result => ({ verified: result.startsAt === '2026-09-04T14:00:00Z' })
  });
  assert.equal(event.verification.verified, true);
});
