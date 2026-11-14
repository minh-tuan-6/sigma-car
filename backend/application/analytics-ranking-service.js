// backend/application/analytics-ranking-service.js
// Best-selling vehicles and accessories (PLAN.md T4.10). Uses AnalyticsService.getScopedRecords, so branch scope,
// date filters (and demo-data exclusion, T5.2) are exactly the same as the revenue overview.
// Counts committed orders only (Cancelled / Failed excluded); revenue = line price × quantity.

const AnalyticsService = require('./analytics-service');
const { ORDER_STATUS } = require('../domain/constants');

const EXCLUDED = new Set([ORDER_STATUS.CANCELLED, ORDER_STATUS.FAILED]);

function orderLines(order) {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items.map(l => ({
      itemType: l.itemType || 'vehicle',
      itemId: l.itemId || l.vehicleId || l.sku,
      name: l.name || l.itemId,
      quantity: Math.max(1, Number(l.quantity) || 1),
      unitPrice: Math.round(Number(l.unitPrice || l.price || 0))
    }));
  }
  if (order.vehicleId) {
    return [{ itemType: 'vehicle', itemId: order.vehicleId, name: order.vehicleName || order.vehicleId, quantity: 1, unitPrice: Math.round(Number(order.unitPrice || 0)) }];
  }
  return [];
}

function rank(map, top) {
  return Array.from(map.values())
    .sort((a, b) => (b.units - a.units) || (b.revenue - a.revenue))
    .slice(0, top);
}

const AnalyticsRankingService = {
  getTopProducts({ branchId, branchIds, userRole, dateFrom = null, dateTo = null, top = 5, includeDemo = false } = {}) {
    const { orders } = AnalyticsService.getScopedRecords({ branchId, branchIds, userRole, dateFrom, dateTo, includeDemo });
    const n = Math.min(20, Math.max(1, parseInt(top, 10) || 5));
    const vehicles = new Map();
    const accessories = new Map();
    let countedOrders = 0;
    for (const o of orders) {
      if (EXCLUDED.has(o.orderStatus)) continue;
      countedOrders += 1;
      for (const line of orderLines(o)) {
        if (!line.itemId) continue;
        const target = ['accessory', 'component', 'bundle_accessory'].includes(line.itemType) ? accessories : (line.itemType === 'vehicle' ? vehicles : null);
        if (!target) continue;
        const row = target.get(line.itemId) || { itemId: line.itemId, name: line.name, units: 0, orders: 0, revenue: 0 };
        row.units += line.quantity;
        row.orders += 1;
        row.revenue += line.unitPrice * line.quantity;
        target.set(line.itemId, row);
      }
    }
    return { countedOrders, topVehicles: rank(vehicles, n), topAccessories: rank(accessories, n) };
  }
};

module.exports = AnalyticsRankingService;
