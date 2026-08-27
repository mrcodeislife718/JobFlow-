import { JobFlowCore } from './jobflow.js';
import { JobFlowReceptionist } from './receptionist.js';
import { JsonStore } from './store.js';
import { JobFlowEconomicProductionLedger, jobFlowEconomicProductionGate } from './economic-production.js';

function mapToArray(map) { return [...map.values()].map((value) => structuredClone(value)); }

export class JobFlowAppService {
  constructor({ store = new JsonStore(process.env.JOBFLOW_DATA_PATH ?? './data/jobflow.json'), business = {} } = {}) {
    this.store = store;
    this.business = { id: process.env.JOBFLOW_BUSINESS_ID ?? 'default', ...business };
    this.core = new JobFlowCore();
    this.receptionist = new JobFlowReceptionist({ core: this.core, business: this.business });
    this.subscription = { status: 'inactive', customerId: null, subscriptionId: null, updatedAt: null };
    this.processedBillingEvents = new Set();
    this.economic = new JobFlowEconomicProductionLedger();
    this.economicEvents = [];
  }

  async init() {
    const state = await this.store.load({ customers: [], leads: [], appointments: [], payments: [], events: [], subscription: this.subscription, processedBillingEvents: [], economicEvents: [] });
    this.core.customers = new Map((state.customers ?? []).map((x) => [x.id, x]));
    this.core.leads = new Map((state.leads ?? []).map((x) => [x.id, x]));
    this.core.appointments = new Map((state.appointments ?? []).map((x) => [x.id, x]));
    this.core.payments = new Map((state.payments ?? []).map((x) => [x.id, x]));
    this.core.events = state.events ?? [];
    this.subscription = state.subscription ?? this.subscription;
    this.processedBillingEvents = new Set(state.processedBillingEvents ?? []);
    this.economicEvents = state.economicEvents ?? [];
    this.economic = new JobFlowEconomicProductionLedger();
    for (const event of this.economicEvents) this.economic.record(event);
    return this;
  }

  async persist() {
    await this.store.save({
      customers: mapToArray(this.core.customers),
      leads: mapToArray(this.core.leads),
      appointments: mapToArray(this.core.appointments),
      payments: mapToArray(this.core.payments),
      events: structuredClone(this.core.events),
      subscription: structuredClone(this.subscription),
      processedBillingEvents: [...this.processedBillingEvents],
      economicEvents: structuredClone(this.economicEvents),
    });
  }

  recordEconomic(event) {
    const normalized = { businessId: this.business.id, ...event };
    this.economicEvents.push(normalized);
    this.economic.record(normalized);
    return normalized;
  }

  async applyBillingEvent(eventId, update) {
    if (!eventId || this.processedBillingEvents.has(eventId)) return { duplicate: true, subscription: this.subscription };
    this.processedBillingEvents.add(eventId);
    if (update?.businessId && update.businessId !== this.business.id) throw new Error('billing event business mismatch');
    if (update) {
      const wasActive = this.subscription.status === 'active';
      this.subscription = { ...this.subscription, ...update, updatedAt: new Date().toISOString() };
      if (!wasActive && this.subscription.status === 'active') this.recordEconomic({ type: 'paying_business' });
      if (wasActive && this.subscription.status === 'active') this.recordEconomic({ type: 'retained_business' });
    }
    await this.persist();
    return { duplicate: false, subscription: this.subscription };
  }

  isPaid() { return this.subscription.status === 'active'; }
  billingState() { return structuredClone(this.subscription); }

  async receptionistTurn(input) { const result = await this.receptionist.respond(input); await this.persist(); return result; }
  async captureLead(input) { const result = this.core.captureLead(input); await this.persist(); return result; }
  async qualifyLead(id, input) { const result = this.core.qualifyLead(id, input); await this.persist(); return result; }
  async createCustomerFromLead(id) { const result = this.core.createCustomerFromLead(id); await this.persist(); return result; }
  async scheduleAppointment(input) {
    const result = this.core.scheduleAppointment(input);
    if (result.recovered && result.priceCents > 0) this.recordEconomic({ type: 'recovered_revenue', amountUsd: result.priceCents / 100 });
    await this.persist();
    return result;
  }
  async transitionAppointment(id, status, details = {}) { const result = this.core.transitionAppointment(id, status, details); await this.persist(); return result; }
  async recordPayment(input) { const result = this.core.recordPayment(input); await this.persist(); return result; }

  economicProduction() {
    const metrics = this.economic.metrics();
    return { ...jobFlowEconomicProductionGate(metrics), continuity: this.core.economicProductionSummary() };
  }

  dashboard() {
    return {
      business: this.business,
      subscription: this.billingState(),
      revenue: this.core.revenueSummary(),
      economicProduction: this.economicProduction(),
      leads: mapToArray(this.core.leads),
      customers: mapToArray(this.core.customers),
      appointments: mapToArray(this.core.appointments).sort((a,b) => String(a.startsAt).localeCompare(String(b.startsAt))),
      payments: mapToArray(this.core.payments),
      recentEvents: this.core.events.slice(-50).reverse(),
    };
  }
}
