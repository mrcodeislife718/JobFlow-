export class JobFlowEconomicProductionLedger {
  #events = [];
  record(event) { this.#events.push(structuredClone(event)); }
  metrics() {
    const uniqueBusinesses = (type) => new Set(this.#events.filter(e => e.type === type).map(e => e.businessId).filter(Boolean)).size;
    const payingBusinesses = uniqueBusinesses('paying_business');
    const retainedBusinesses = uniqueBusinesses('retained_business');
    const recoveredRevenue = this.#events.filter(e => e.type === 'recovered_revenue').reduce((s, e) => s + (e.amountUsd ?? 0), 0);
    const revenue = this.#events.filter(e => e.type === 'subscription_revenue').reduce((s, e) => s + (e.amountUsd ?? 0), 0);
    const deliveryCost = this.#events.filter(e => e.type === 'delivery_cost').reduce((s, e) => s + (e.amountUsd ?? 0), 0);
    return {
      payingBusinesses,
      retainedBusinesses,
      recoveredRevenueUsd: recoveredRevenue,
      subscriptionRevenueUsd: revenue,
      deliveryCostUsd: deliveryCost,
      grossContributionUsd: revenue - deliveryCost,
      customerROI: revenue === 0 ? 0 : recoveredRevenue / revenue,
      businessRetentionRate: payingBusinesses === 0 ? 0 : retainedBusinesses / payingBusinesses,
    };
  }
}

export function jobFlowEconomicProductionGate(metrics) {
  const checks = {
    payingBusiness: metrics.payingBusinesses > 0,
    measurableRecoveredRevenue: metrics.recoveredRevenueUsd > 0,
    positiveGrossContribution: metrics.grossContributionUsd > 0,
    customerROI: metrics.customerROI >= 3,
    repeatableDemand: metrics.payingBusinesses >= 5,
    retentionSignal: metrics.payingBusinesses < 3 || metrics.businessRetentionRate >= 0.5,
  };
  return { productive: Object.values(checks).every(Boolean), checks, metrics };
}
