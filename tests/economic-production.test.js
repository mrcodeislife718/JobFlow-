import test from 'node:test';
import assert from 'node:assert/strict';
import { JobFlowEconomicProductionLedger, jobFlowEconomicProductionGate } from '../src/economic-production.js';

test('JobFlow economic production requires recovered revenue, ROI, repeatability and contribution', () => {
  const ledger = new JobFlowEconomicProductionLedger();
  for (let i = 0; i < 5; i += 1) {
    const businessId = `b${i}`;
    ledger.record({ type: 'paying_business', businessId });
    ledger.record({ type: 'retained_business', businessId });
    ledger.record({ type: 'recovered_revenue', businessId, amountUsd: 4000 });
    ledger.record({ type: 'subscription_revenue', businessId, amountUsd: 500 });
    ledger.record({ type: 'delivery_cost', businessId, amountUsd: 100 });
  }
  const result = jobFlowEconomicProductionGate(ledger.metrics());
  assert.equal(result.productive, true);
  assert.equal(result.metrics.customerROI, 8);
});
