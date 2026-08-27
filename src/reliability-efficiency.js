export class JobFlowReliabilityLedger {
  #events = [];
  #idempotency = new Map();

  claim(key) {
    if (!key) throw new Error("idempotency key required");
    if (this.#idempotency.has(key)) return false;
    this.#idempotency.set(key, Date.now());
    return true;
  }

  record(event) {
    if (!event?.operation) throw new Error("operation required");
    this.#events.push({ at: Date.now(), ...event });
  }

  metrics() {
    const successes = this.#events.filter((event) => event.success).length;
    const failures = this.#events.filter((event) => event.success === false).length;
    const recoveredRevenue = this.#events.reduce((sum, event) => sum + (event.recoveredRevenue ?? 0), 0);
    const operatingCost = this.#events.reduce((sum, event) => sum + (event.operatingCost ?? 0), 0);
    return {
      events: this.#events.length,
      successes,
      failures,
      recoveredRevenue,
      operatingCost,
      revenuePerOperatingDollar: operatingCost === 0 ? 0 : recoveredRevenue / operatingCost,
    };
  }
}

export async function executeCustomerContinuityStep({
  operation,
  idempotencyKey,
  ledger,
  action,
  verify,
  recover,
  retries = 1,
}) {
  if (ledger && !ledger.claim(idempotencyKey)) {
    return { duplicate: true, skipped: true };
  }
  let lastError;
  const attempts = Math.max(1, retries + 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await action();
      if (verify && !(await verify(value))) throw new Error("continuity verification failed");
      ledger?.record({ operation, success: true, attempts: attempt + 1 });
      return value;
    } catch (error) {
      lastError = error;
    }
  }
  if (recover) {
    const value = await recover();
    if (verify && !(await verify(value))) throw new Error("recovery verification failed");
    ledger?.record({ operation, success: true, recovered: true, attempts });
    return value;
  }
  ledger?.record({ operation, success: false, attempts });
  throw lastError ?? new Error("continuity step failed");
}

export function shouldAutomate({ expectedValue, automationCost, riskPenalty = 0 }) {
  return expectedValue > automationCost + riskPenalty;
}
