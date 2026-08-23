const BOOK = /\b(book|schedule|appointment|reserve)\b/i;
const CANCEL = /\b(cancel|cancellation)\b/i;
const RESCHEDULE = /\b(reschedule|move|change.*appointment)\b/i;
const PRICE = /\b(price|cost|how much|rate)\b/i;
const HOURS = /\b(hours|open|close|available)\b/i;
const HUMAN = /\b(human|person|manager|representative|agent)\b/i;

export class JobFlowReceptionist {
  constructor({ core, business = {}, model = null } = {}) {
    if (!core) throw new Error('JobFlowReceptionist requires JobFlowCore');
    this.core = core;
    this.model = model;
    this.business = {
      name: business.name ?? 'Business',
      hours: business.hours ?? {},
      services: business.services ?? [],
      escalationMessage: business.escalationMessage ?? 'I will have a team member follow up with you.',
    };
    this.conversations = new Map();
  }

  async respond({ conversationId = crypto.randomUUID(), message, customer = {}, context = {} }) {
    if (!message?.trim()) throw new Error('message is required');
    const intent = this.classify(message);
    const turn = { at: new Date().toISOString(), role: 'user', message, intent };
    const history = this.conversations.get(conversationId) ?? [];
    history.push(turn);

    let result = await this.#execute(intent, { message, customer, context, conversationId });
    if (this.model && result.needsLanguageModel) {
      const generated = await this.model.generate({ message, intent, business: this.business, history: structuredClone(history), context });
      if (generated?.text) result = { ...result, text: generated.text, modelUsed: true };
    }

    history.push({ at: new Date().toISOString(), role: 'assistant', message: result.text, intent });
    this.conversations.set(conversationId, history);
    this.core.record('receptionist.turn', 'conversation', conversationId, { intent, escalated: Boolean(result.escalated) });
    return { conversationId, intent, ...result };
  }

  classify(message) {
    if (HUMAN.test(message)) return 'escalate';
    if (RESCHEDULE.test(message)) return 'reschedule';
    if (CANCEL.test(message)) return 'cancel';
    if (BOOK.test(message)) return 'book';
    if (PRICE.test(message)) return 'pricing';
    if (HOURS.test(message)) return 'hours';
    return 'general';
  }

  async #execute(intent, { message, customer, context }) {
    if (intent === 'pricing') {
      const service = this.#findService(message);
      if (!service) return { text: 'Which service are you interested in?', needsLanguageModel: false };
      return { text: `${service.name} is ${this.#money(service.priceCents)}${service.durationMinutes ? ` and usually takes ${service.durationMinutes} minutes` : ''}.`, service, needsLanguageModel: false };
    }
    if (intent === 'hours') {
      const summary = Object.entries(this.business.hours).map(([day, hours]) => `${day}: ${hours}`).join(', ');
      return { text: summary ? `Our hours are ${summary}.` : 'I can help check availability for a specific day.', needsLanguageModel: !summary };
    }
    if (intent === 'escalate') return { text: this.business.escalationMessage, escalated: true, needsLanguageModel: false };
    if (intent === 'book') {
      if (!customer.phone && !customer.email) return { text: 'I can book that. What phone number or email should we use?', action: 'collect-contact', needsLanguageModel: false };
      const service = this.#findService(message) ?? this.business.services[0];
      if (!service) return { text: 'Which service would you like to book?', action: 'collect-service', needsLanguageModel: false };
      if (!context.startsAt) return { text: `I can book ${service.name}. What date and time works best?`, action: 'collect-time', service, needsLanguageModel: false };
      const lead = this.core.captureLead({ name: customer.name, phone: customer.phone, email: customer.email, service: service.name, source: 'ai-receptionist' });
      this.core.qualifyLead(lead.id, { qualified: true, reason: 'receptionist booking request' });
      const record = this.core.createCustomerFromLead(lead.id);
      const appointment = this.core.scheduleAppointment({ customerId: record.id, service: service.name, startsAt: context.startsAt, priceCents: service.priceCents ?? 0 });
      this.core.transitionAppointment(appointment.id, 'confirmed', { channel: 'ai-receptionist' });
      return { text: `You are booked for ${service.name} at ${context.startsAt}.`, action: 'booked', appointment: this.core.appointments.get(appointment.id), needsLanguageModel: false };
    }
    if (intent === 'cancel' || intent === 'reschedule') {
      if (!context.appointmentId) return { text: `I can ${intent} that. Please provide the appointment reference or the contact information used to book.`, action: 'collect-appointment', needsLanguageModel: false };
      const appointment = this.core.appointments.get(context.appointmentId);
      if (!appointment) return { text: 'I could not find that appointment. I can escalate this to the business.', escalated: true, needsLanguageModel: false };
      if (intent === 'cancel') {
        this.core.transitionAppointment(appointment.id, 'cancelled', { source: 'ai-receptionist' });
        return { text: 'Your appointment has been cancelled. I can also help you choose another time.', action: 'cancelled', appointment, needsLanguageModel: false };
      }
      if (!context.startsAt) return { text: 'What new date and time would you like?', action: 'collect-time', needsLanguageModel: false };
      appointment.startsAt = context.startsAt;
      appointment.updatedAt = new Date().toISOString();
      this.core.record('appointment.rescheduled', 'appointment', appointment.id, { startsAt: context.startsAt, source: 'ai-receptionist' });
      return { text: `Your appointment has been moved to ${context.startsAt}.`, action: 'rescheduled', appointment: structuredClone(appointment), needsLanguageModel: false };
    }
    return { text: `I can help with services, pricing, hours, booking, rescheduling, cancellations, and connecting you with ${this.business.name}.`, needsLanguageModel: true };
  }

  #findService(message) {
    const lower = message.toLowerCase();
    return this.business.services.find((service) => lower.includes(service.name.toLowerCase())) ?? null;
  }

  #money(cents = 0) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }
}
