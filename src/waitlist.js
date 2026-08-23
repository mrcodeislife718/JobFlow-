import { randomUUID } from 'node:crypto';

export class JobFlowWaitlist {
  constructor({ core, now = () => new Date().toISOString() } = {}) {
    if (!core) throw new Error('JobFlowWaitlist requires JobFlowCore');
    this.core = core;
    this.now = now;
    this.entries = new Map();
  }

  add({ customerId, service, priority = 0 }) {
    if (!this.core.customers.has(customerId)) throw new Error('customer not found');
    if (!service?.trim()) throw new Error('service is required');
    const id = randomUUID();
    const entry = { id, customerId, service, priority, status: 'waiting', createdAt: this.now() };
    this.entries.set(id, entry);
    this.core.record('waitlist.added', 'waitlist', id, { customerId, service, priority });
    return structuredClone(entry);
  }

  next(service) {
    const entry = [...this.entries.values()]
      .filter((item) => item.status === 'waiting' && item.service === service)
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0];
    return entry ? structuredClone(entry) : null;
  }

  markBooked(id, appointmentId) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('waitlist entry not found');
    entry.status = 'booked';
    entry.appointmentId = appointmentId;
    entry.updatedAt = this.now();
    this.core.record('waitlist.filled', 'waitlist', id, { appointmentId });
    return structuredClone(entry);
  }
}
