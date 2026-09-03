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
    this.failures = [];
  }

  perform(action, { approved = false, execute, verify }) {
    this.policy.assert(action, { approved });
    if (typeof execute !== 'function' || typeof verify !== 'function') throw new Error('execute and verify functions are required');
    try {
      const result = execute();
      const verification = verify(result);
      if (!verification?.verified) {
        const failure = { action, class: 'verification', retryable: true, result: structuredClone(result), verification: structuredClone(verification), at: Date.now() };
        this.failures.push(failure);
        throw new Error(`external state verification failed for ${action}`);
      }
      const event = { action, approved, result: structuredClone(result), verification: structuredClone(verification), at: Date.now() };
      this.events.push(event);
      return structuredClone(event);
    } catch (error) {
      if (!this.failures.some(failure => failure.action === action && failure.at === this.failures.at(-1)?.at)) {
        this.failures.push({ action, class: 'execution', retryable: true, message: error instanceof Error ? error.message : String(error), at: Date.now() });
      }
      throw error;
    }
  }

  recover({ failureIndex = this.failures.length - 1, strategy, execute, verify }) {
    const failure = this.failures[failureIndex];
    if (!failure) throw new Error('unknown workflow failure');
    if (!failure.retryable) throw new Error('workflow failure is not retryable');
    if (!strategy || typeof execute !== 'function' || typeof verify !== 'function') throw new Error('recovery strategy, execute and verify are required');
    const result = execute(failure);
    const verification = verify(result);
    if (!verification?.verified) throw new Error(`recovery verification failed for ${failure.action}`);
    const event = { action: `recovery:${failure.action}`, strategy, result: structuredClone(result), verification: structuredClone(verification), at: Date.now() };
    this.events.push(event);
    failure.retryable = false;
    failure.recoveredAt = event.at;
    failure.recoveryStrategy = strategy;
    return structuredClone(event);
  }

  receipt() {
    const payload = { workflowId: this.id, bookingId: this.bookingId, customerId: this.customerId, events: structuredClone(this.events), failures: structuredClone(this.failures) };
    return { ...payload, digest: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  }
}
