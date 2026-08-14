import test from 'node:test';
import assert from 'node:assert/strict';
import { JobFlowCore } from '../src/jobflow.js';
import { JobFlowWaitlist } from '../src/waitlist.js';
import { JobFlowReminders } from '../src/reminders.js';

test('waitlist prioritizes customers and reminders become due', () => {
  const now = () => '2026-08-14T12:00:00.000Z';
  const core = new JobFlowCore({ now });
  const lead = core.captureLead({ name: 'A', email: 'a@example.com', service: 'cut' });
  const customer = core.createCustomerFromLead(lead.id);
  const waitlist = new JobFlowWaitlist({ core, now });
  const entry = waitlist.add({ customerId: customer.id, service: 'cut', priority: 10 });
  assert.equal(waitlist.next('cut').id, entry.id);
  const appointment = core.scheduleAppointment({ customerId: customer.id, service: 'cut', startsAt: '2026-08-15T15:00:00.000Z' });
  waitlist.markBooked(entry.id, appointment.id);
  assert.equal(waitlist.next('cut'), null);
  const reminders = new JobFlowReminders({ core, now });
  const reminder = reminders.schedule({ appointmentId: appointment.id, sendAt: '2026-08-14T11:00:00.000Z' });
  assert.equal(reminders.due().length, 1);
  reminders.markSent(reminder.id);
  assert.equal(reminders.due().length, 0);
});
