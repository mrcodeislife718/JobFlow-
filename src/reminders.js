import { randomUUID } from 'node:crypto';

export class JobFlowReminders {
  constructor({ core, now = () => new Date().toISOString() } = {}) {
    if (!core) throw new Error('JobFlowReminders requires JobFlowCore');
    this.core = core;
    this.now = now;
    this.items = new Map();
  }

  schedule({ appointmentId, sendAt, channel = 'sms' }) {
    const appointment = this.core.appointments.get(appointmentId);
    if (!appointment) throw new Error('appointment not found');
    if (!sendAt) throw new Error('sendAt is required');
    const id = randomUUID();
    const item = { id, appointmentId, customerId: appointment.customerId, sendAt, channel, status: 'pending', createdAt: this.now() };
    this.items.set(id, item);
    this.core.record('reminder.scheduled', 'reminder', id, { appointmentId, sendAt, channel });
    return structuredClone(item);
  }

  due(at = this.now()) {
    return [...this.items.values()]
      .filter((item) => item.status === 'pending' && item.sendAt <= at)
      .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
      .map((item) => structuredClone(item));
  }

  markSent(id) {
    const item = this.items.get(id);
    if (!item) throw new Error('reminder not found');
    item.status = 'sent';
    item.sentAt = this.now();
    this.core.record('reminder.sent', 'reminder', id, { appointmentId: item.appointmentId, channel: item.channel });
    return structuredClone(item);
  }
}
