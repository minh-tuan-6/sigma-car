// backend/application/battery-service.js
// Battery swap stations and battery rental (BaaS) reference information (PLAN.md T2.5). Read-only, public.
// The data is bundled reference data (data/battery-ecosystem.json, marked source "demo_reference"): no live availability
// and no prices presented as real quotes. require() of JSON works in Node and in the Workers bundle.

const reference = require('../../data/battery-ecosystem.json');

const BatteryService = {
  listSwapStations({ province, branchId } = {}) {
    let stations = Array.isArray(reference.swapStations) ? reference.swapStations : [];
    if (province && province !== 'all') {
      const p = String(province).toLowerCase();
      stations = stations.filter(s => String(s.province).toLowerCase() === p);
    }
    if (branchId) stations = stations.filter(s => s.branchId === branchId);
    return {
      source: reference.source,
      lastReviewed: reference.lastReviewed,
      liveAvailabilitySupported: false,
      disclaimer: reference.disclaimer,
      stations: stations.map(s => ({ ...s }))
    };
  },

  getRentalPolicy() {
    return {
      source: reference.source,
      lastReviewed: reference.lastReviewed,
      disclaimer: reference.disclaimer,
      plans: (reference.rentalPlans || []).map(p => ({ ...p })),
      policies: [...(reference.policies || [])]
    };
  },

  // Monthly rental cost for a given distance under one plan (shown next to the plan; same rule as the plan notes).
  estimateMonthlyRental(planId, monthlyKm) {
    const plan = (reference.rentalPlans || []).find(p => p.id === planId);
    if (!plan) return null;
    const km = Math.max(0, Number(monthlyKm) || 0);
    const extraKm = plan.includedKmPerMonth ? Math.max(0, km - plan.includedKmPerMonth) : 0;
    return { planId: plan.id, monthlyKm: km, extraKm, totalVnd: plan.monthlyFeeVnd + extraKm * (plan.extraFeeVndPerKm || 0) };
  }
};

module.exports = BatteryService;
