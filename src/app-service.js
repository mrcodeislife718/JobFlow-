import { JobFlowCore } from './jobflow.js';
import { JobFlowReceptionist } from './receptionist.js';
import { JsonStore } from './store.js';

function mapToArray(map) { return [...map.values()].map((value) => structuredClone(value)); }

export class JobFlowAppService {
  constructor({ store = new JsonStore(process.env.JOBFLOW_DATA_PATH ?? './data/jobflow.json'), business = {} } = {}) {
    this.store = store;
    this.business = business;
    this.core = new JobFlowCore();
    this.receptionist = new JobFlowReceptionist({ core: this.core, business });
  }

  async init() {
    const state = await this.store.load({ customers: [], leads: [], appointments: [], payments: [], events: [] });
    this.core.customers = new Map((state.customers ?? []).map((x) => [x.id, x]));
    this.core.leads = new Map((state.leads ?? []).map((x) => [x.id, x]));
    this.core.appointments = new Map((state.appointments ?? []).map((x) => [x.id, x]));
    this.core.payments = new Map((state.payments ?? []).map((x) => [x.id, x]));
    this.core.events = state.events ?? [];
    return this;
  }

  async persist() {
    await this.store.save({
      customers: mapToArray(this.core.customers),
      leads: mapToArray(this.core.leads),
      appointments: mapToArray(this.core.appointments),
      payments: mapToArray(this.core.payments),
      events: structuredClone(this.core.events),
    });
  }

  async receptionistTurn(input) { const result = await this.receptionist.respond(input); await this.persist(); return result; }
  async captureLead(input) { const result = this.core.captureLead(input); await this.persist(); return result; }
  async qualifyLead(id, input) { const result = this.core.qualifyLead(id, input); await this.persist(); return result; }
  async createCustomerFromLead(id) { const result = this.core.createCustomerFromLead(id); await this.persist(); return result; }
  async scheduleAppointment(input) { const result = this.core.scheduleAppointment(input); await this.persist(); return result; }
  async transitionAppointment(id, status, details = {}) { const result = this.core.transitionAppointment(id, status, details); await this.persist(); return result; }
  async recordPayment(input) { const result = this.core.recordPayment(input); await this.persist(); return result; }

  dashboard() {
    return {
      revenue: this.core.revenueSummary(),
      leads: mapToArray(this.core.leads),
      customers: mapToArray(this.core.customers),
      appointments: mapToArray(this.core.appointments).sort((a,b) => String(a.startsAt).localeCompare(String(b.startsAt))),
      payments: mapToArray(this.core.payments),
      recentEvents: this.core.events.slice(-50).reverse(),
    };
  }
}
