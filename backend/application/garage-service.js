// backend/application/garage-service.js
// Buyer Digital Garage Projection (Only Handed-Over / Owned Vehicles, Saved Configs & Favorites)

const { dbState } = require('../infrastructure/storage-engine');
const { ORDER_STATUS, MAINTENANCE_MILESTONES, SERVICE_CENTERS } = require('../domain/constants');

const GarageService = {
  getMyGarage(user) {
    if (!user || !user.userId) return { ownedVehicles: [], pendingOrdersCount: 0, savedCars: [], savedConfigs: [], serviceHistory: [] };

    const allUserOrders = (dbState.orders || []).filter(o => o.userId === user.userId || o.buyerId === user.userId);
    const ownedStatuses = [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED];
    const pendingOrdersCount = allUserOrders.filter(o => !ownedStatuses.includes(o.orderStatus) && o.orderStatus !== ORDER_STATUS.CANCELLED).length;

    const handoversByOrder = new Map((dbState.handovers || []).map(h => [h.orderId, h]));
    const warrantiesByOrder = new Map((dbState.warranties || []).map(w => [w.orderId, w]));
    const ownerships = (dbState.vehicleOwnerships || []).filter(own => own.userId === user.userId);

    // Combine explicit vehicleOwnerships and Delivered/Completed orders cleanly without duplicates
    const ownedMap = new Map();
    for (const own of ownerships) {
      ownedMap.set(own.vin, {
        ownershipId: own.id,
        orderId: own.orderId,
        vehicleId: own.vehicleId,
        vehicleName: own.vehicleName,
        fuel: own.fuel || 'ev',
        vin: own.vin,
        licensePlate: own.licensePlate || null,
        acquiredAt: own.acquiredAt,
        source: 'handover_verified'
      });
    }

    for (const o of allUserOrders) {
      if (!ownedStatuses.includes(o.orderStatus)) continue;
      const h = handoversByOrder.get(o.id);
      const w = warrantiesByOrder.get(o.id);
      const vin = (h && h.vin) || (w && w.vin) || o.vin;
      if (!vin || ownedMap.has(vin)) continue;
      const vehicle = (dbState.vehicles || []).find(v => v.id === o.vehicleId) || (dbState.certifiedVehicles || []).find(v => v.id === o.vehicleId);
      ownedMap.set(vin, {
        ownershipId: null,
        orderId: o.id,
        vehicleId: o.vehicleId,
        vehicleName: o.vehicleName,
        fuel: (vehicle && vehicle.fuel) || 'ev',
        vin,
        licensePlate: o.licensePlate || (w && w.licensePlate) || null,
        acquiredAt: o.deliveredAt || o.completedAt || o.createdAt,
        source: 'delivered_order'
      });
    }

    const userRecords = (dbState.serviceRecords || []).filter(r => r.userId === user.userId);
    const ownedVehicles = Array.from(ownedMap.values()).map(item => {
      const warranty = (dbState.warranties || []).find(w => w.vin === item.vin || w.orderId === item.orderId) || null;
      const vehicleRecords = userRecords.filter(r => r.vin === item.vin);
      const latestRecord = vehicleRecords[0] || null;
      const currentOdo = latestRecord ? latestRecord.odoKm : (warranty ? warranty.currentOdoKm : 0);
      const nextMilestone = MAINTENANCE_MILESTONES.find(m => m.km > currentOdo) || MAINTENANCE_MILESTONES[MAINTENANCE_MILESTONES.length - 1];
      const vehicle = (dbState.vehicles || []).find(v => v.id === item.vehicleId) || (dbState.certifiedVehicles || []).find(v => v.id === item.vehicleId);

      // Honest telemetry: never fabricate 100% battery SoH if not inspected or non-EV
      const measuredBatterySoH = item.fuel === 'ev'
        ? (warranty && typeof warranty.batteryHealthPercent === 'number' ? warranty.batteryHealthPercent : null)
        : null;

      return {
        ...item,
        image: (vehicle && vehicle.image) || (warranty && warranty.image) || 'assets/garage-car-detail.jpg',
        currentOdoKm: currentOdo,
        measuredBatterySoH,
        healthStatusNote: measuredBatterySoH !== null
          ? `Pin cao áp đạt ${measuredBatterySoH}% theo lần kiểm định gần nhất`
          : (item.fuel === 'ev' ? 'Chưa có đo kiểm Pin SoH tại xưởng' : 'Xe sử dụng động cơ Xăng/Hybrid (không áp dụng Pin cao áp EV)'),
        warranty: warranty ? {
          warrantyCode: warranty.warrantyCode,
          startDate: warranty.startDate,
          endDate: warranty.endDate,
          batteryEndDate: warranty.batteryEndDate,
          status: warranty.status
        } : null,
        nextMilestone,
        serviceHistory: vehicleRecords
      };
    });

    const userRecord = (dbState.users || []).find(u => u.id === user.userId);
    const savedCarIds = Array.isArray(userRecord && userRecord.savedCars) ? userRecord.savedCars : [];
    const savedCars = savedCarIds
      .map(id => (dbState.vehicles || []).find(v => v.id === id) || (dbState.certifiedVehicles || []).find(v => v.id === id))
      .filter(Boolean);

    const savedConfigs = (dbState.configurations || []).filter(c => c.userId === user.userId);

    return {
      ownedVehicles,
      pendingOrdersCount,
      savedCars,
      savedConfigs,
      serviceCenters: SERVICE_CENTERS
    };
  }
};

module.exports = GarageService;
