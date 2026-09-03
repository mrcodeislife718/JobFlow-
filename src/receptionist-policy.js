import crypto from 'node:crypto';

const DEFAULT_ACTIONS = Object.freeze({
  lookup_booking: 'allow',
  propose_times: 'allow',
  reschedule_booking: 'approval',
  cancel_booking: 'approval',
  issue_refund: 'deny',
  change_pricing: 'deny',
  send_confirmation: 'allow'
});

export class ReceptionistPolicy {
  constructor(policy = DEFAULT_ACTIONS) { this.policy = { ...DEFAULT_ACTIONS, ...policy }; }

  decide(action, { approved = false } = {}) {
    const mode = this.policy[action] ?? 'deny';
    if (mode === 'allow') return { action, allowed: true, approvalRequired: false };
    if (mode === 'approval') return { action, allowed: approved, approvalRequired: true };
    return { action, allowed: false, approvalRequired: false };
  }

  assert(action, context = {}) {
    const decision = this.decide(action, context);
    if (!decision.allowed) throw new Error(decision.approvalRequired ? `approval required: ${action}` : `action denied: ${action}`);
    return decision;
  }
}

export class AppointmentWorkflow {
  constructor({ policy = new ReceptionistPolicy(), bookingId, customerId }) {
    if (!bookingId || !customerId) throw new Error('bookingId and customerId are required');
    this.id = crypto.randomUUID();
    this.policy = policy;
    this.bookingId = bookingId;
    this.customerId = customerId;
    this.events = [];
  }

  perform(action, { approved = false, execute, verify }) {
    this.policy.assert(action, { approved });
    if (typeof execute !== 'function' || typeof verify !== 'function') throw new Error('execute and verify functions are required');
    const result = execute();
    const verification = verify(result);
    if (!verification?.verified) throw new Error(`external state verification failed for ${action}`);
    const event = { action, approved, result: structuredClone(result), verification: structuredClone(verification), at: Date.now() };
    this.events.push(event);
    return structuredClone(event);
  }

  receipt() {
    const payload = { workflowId: this.id, bookingId: this.bookingId, customerId: this.customerId, events: structuredClone(this.events) };
    return { ...payload, digest: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  }
}
