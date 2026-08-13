import test from 'node:test';
import assert from 'node:assert/strict';
import { JobFlowCore } from '../src/jobflow.js';

test('missed-call lead can become a paid recovered appointment', () => {
  const app = new JobFlowCore({ now: () => '2026-08-13T18:30:00.000Z' });
  const lead = app.captureLead({ name: 'A', email: 'a@example.invalid', service: 'cut', missedCall: true });
  app.qualifyLead(lead.id, { qualified: true });
  const customer = app.createCustomerFromLead(lead.id);
  const appt = app.scheduleAppointment({ customerId: customer.id, service: 'cut', startsAt: '2026-08-14T15:00:00Z', priceCents: 8000, recovered: true });
  app.transitionAppointment(appt.id, 'confirmed');
  app.transitionAppointment(appt.id, 'completed');
  app.recordPayment({ appointmentId: appt.id, amountCents: 8000 });
  assert.deepEqual(app.revenueSummary(), { paidCents: 8000, recoveredCents: 8000, completedAppointments: 1, leads: 1, customers: 1, appointments: 1 });
  assert.equal(app.events.some((e) => e.type === 'recovery.started'), true);
  assert.equal(app.events.some((e) => e.type === 'followup.review_requested'), true);
});

test('cancelled appointment produces rebooking workflow event', () => {
  const app = new JobFlowCore();
  const lead = app.captureLead({ name: 'B', email: 'b@example.invalid', service: 'repair' });
  const customer = app.createCustomerFromLead(lead.id);
  const appt = app.scheduleAppointment({ customerId: customer.id, service: 'repair', startsAt: '2026-08-20T10:00:00Z' });
  app.transitionAppointment(appt.id, 'cancelled', { reason: 'customer request' });
  assert.equal(app.events.some((e) => e.type === 'rebooking.required'), true);
});
