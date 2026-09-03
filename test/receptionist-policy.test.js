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

test('records a failed external transition and only accepts verified recovery', () => {
  const workflow = new AppointmentWorkflow({ bookingId: 'b2', customerId: 'c2' });
  assert.throws(() => workflow.perform('send_confirmation', {
    execute: () => ({ delivered: false }),
    verify: result => ({ verified: result.delivered })
  }), /verification failed/);
  const recovery = workflow.recover({
    strategy: 'retry-secondary-provider',
    execute: () => ({ delivered: true, provider: 'secondary' }),
    verify: result => ({ verified: result.delivered === true })
  });
  assert.equal(recovery.verification.verified, true);
  assert.equal(workflow.receipt().failures[0].recoveryStrategy, 'retry-secondary-provider');
});
