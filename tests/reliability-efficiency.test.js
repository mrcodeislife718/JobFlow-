import test from "node:test";
import assert from "node:assert/strict";
import { JobFlowReliabilityLedger, executeCustomerContinuityStep, shouldAutomate } from "../src/reliability-efficiency.js";

test("deduplicates consequential customer actions", async () => {
  const ledger = new JobFlowReliabilityLedger();
  let calls = 0;
  const action = async () => { calls += 1; return { booked: true }; };
  const first = await executeCustomerContinuityStep({ operation: "book", idempotencyKey: "lead-1-book", ledger, action });
  const second = await executeCustomerContinuityStep({ operation: "book", idempotencyKey: "lead-1-book", ledger, action });
  assert.equal(first.booked, true);
  assert.deepEqual(second, { duplicate: true, skipped: true });
  assert.equal(calls, 1);
});

test("automation requires positive risk-adjusted value", () => {
  assert.equal(shouldAutomate({ expectedValue: 100, automationCost: 20, riskPenalty: 10 }), true);
  assert.equal(shouldAutomate({ expectedValue: 20, automationCost: 20, riskPenalty: 10 }), false);
});
