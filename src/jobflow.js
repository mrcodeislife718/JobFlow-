import { randomUUID } from 'node:crypto';
import { JobFlowReliabilityLedger } from './reliability-efficiency.js';

const APPOINTMENT_STATES = new Set(['scheduled','confirmed','completed','cancelled','no_show']);

export class JobFlowCore {
  constructor({ now = () => new Date().toISOString(), reliabilityLedger = new JobFlowReliabilityLedger() } = {}) {
    this.now = now;
    this.reliability = reliabilityLedger;
    this.customers = new Map();
    this.leads = new Map();
    this.appointments = new Map();
    this.payments = new Map();
    this.events = [];
  }

  record(type, entityType, entityId, payload = {}) {
    const event = { id: randomUUID(), type, entityType, entityId, at: this.now(), payload: structuredClone(payload) };
    this.events.push(event);
    return event;
  }

  captureLead({ name, phone, email, source = 'direct', service, missedCall = false }) {
    if (!phone && !email) throw new Error('lead requires phone or email');
    const id = randomUUID();
    const lead = { id, name, phone, email, source, service, status: 'new', missedCall, createdAt: this.now() };
    this.leads.set(id, lead);
    this.record('lead.captured', 'lead', id, { source, missedCall });
    if (missedCall) this.record('recovery.started', 'lead', id, { channel: phone ? 'sms' : 'email' });
    this.reliability.record({ operation: 'lead.capture', success: true });
    return structuredClone(lead);
  }

  qualifyLead(id, { qualified, reason = null }) {
    const lead = this.#require(this.leads, id, 'lead');
    lead.status = qualified ? 'qualified' : 'disqualified';
    lead.qualificationReason = reason;
    this.record('lead.qualified', 'lead', id, { qualified, reason });
    this.reliability.record({ operation: 'lead.qualify', success: true });
    return structuredClone(lead);
  }

  createCustomerFromLead(leadId) {
    const lead = this.#require(this.leads, leadId, 'lead');
    if (lead.status === 'disqualified') throw new Error('cannot convert disqualified lead');
    const id = randomUUID();
    const customer = { id, name: lead.name, phone: lead.phone, email: lead.email, leadId, createdAt: this.now() };
    this.customers.set(id, customer);
    lead.status = 'converted';
    this.record('customer.created', 'customer', id, { leadId });
    this.reliability.record({ operation: 'customer.convert', success: true });
    return structuredClone(customer);
  }

  scheduleAppointment({ customerId, service, startsAt, providerId = null, locationId = null, priceCents = 0, recovered = false }) {
    this.#require(this.customers, customerId, 'customer');
    if (!service || !startsAt) throw new Error('service and startsAt are required');
    const id = randomUUID();
    const appointment = { id, customerId, service, startsAt, providerId, locationId, priceCents, status: 'scheduled', recovered, createdAt: this.now() };
    this.appointments.set(id, appointment);
    this.record('appointment.scheduled', 'appointment', id, { customerId, service, recovered });
    if (recovered) {
      this.record('revenue.recovered', 'appointment', id, { valueCents: priceCents });
      this.reliability.record({ operation: 'appointment.schedule', success: true, recoveredRevenue: priceCents / 100 });
    } else {
      this.reliability.record({ operation: 'appointment.schedule', success: true });
    }
    return structuredClone(appointment);
  }

  transitionAppointment(id, status, details = {}) {
    if (!APPOINTMENT_STATES.has(status)) throw new Error(`invalid appointment status: ${status}`);
    const appointment = this.#require(this.appointments, id, 'appointment');
    appointment.status = status;
    appointment.updatedAt = this.now();
    this.record(`appointment.${status}`, 'appointment', id, details);
    if (status === 'cancelled') this.record('rebooking.required', 'appointment', id, { customerId: appointment.customerId });
    if (status === 'completed') this.record('followup.review_requested', 'appointment', id, { customerId: appointment.customerId });
    this.reliability.record({ operation: `appointment.${status}`, success: true });
    return structuredClone(appointment);
  }

  recordPayment({ appointmentId, amountCents, status = 'paid', method = 'external' }) {
    const appointment = this.#require(this.appointments, appointmentId, 'appointment');
    if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('amountCents must be a non-negative integer');
    const id = randomUUID();
    const payment = { id, appointmentId, customerId: appointment.customerId, amountCents, status, method, createdAt: this.now() };
    this.payments.set(id, payment);
    this.record('payment.recorded', 'payment', id, { appointmentId, amountCents, status });
    this.reliability.record({ operation: 'payment.record', success: true });
    return structuredClone(payment);
  }

  revenueSummary() {
    const paidCents = [...this.payments.values()].filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amountCents, 0);
    const recoveredCents = this.events.filter((e) => e.type === 'revenue.recovered').reduce((sum, e) => sum + (e.payload.valueCents ?? 0), 0);
    const completedAppointments = [...this.appointments.values()].filter((a) => a.status === 'completed').length;
    return { paidCents, recoveredCents, completedAppointments, leads: this.leads.size, customers: this.customers.size, appointments: this.appointments.size };
  }

  economicProductionSummary({ operatingCostCents = 0 } = {}) {
    const revenue = this.revenueSummary();
    const totalAttributedCents = revenue.paidCents + revenue.recoveredCents;
    return {
      ...revenue,
      operatingCostCents,
      totalAttributedCents,
      valuePerOperatingDollar: operatingCostCents <= 0 ? 0 : totalAttributedCents / operatingCostCents,
      reliability: this.reliability.metrics(),
    };
  }

  timeline(entityId) {
    return this.events.filter((event) => event.entityId === entityId || event.payload.customerId === entityId || event.payload.leadId === entityId).map((event) => structuredClone(event));
  }

  #require(map, id, label) {
    const value = map.get(id);
    if (!value) {
      this.reliability.record({ operation: `${label}.require`, success: false });
      throw new Error(`${label} not found: ${id}`);
    }
    return value;
  }
}
