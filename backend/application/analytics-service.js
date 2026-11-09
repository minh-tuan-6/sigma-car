// backend/application/analytics-service.js
// Analytics derived strictly from actual stored records in the database

const { dbState } = require('../infrastructure/storage-engine');
const { ORDER_STATUS, PAYMENT_STATUS, APPOINTMENT_STATUS } = require('../domain/constants');

const AnalyticsService = {
  getSellerOverview({ branchId } = {}) {
    let orders = [...dbState.orders];
    let appointments = [...dbState.appointments];

    if (branchId) {
      orders = orders.filter(o => o.branchId === branchId);
      appointments = appointments.filter(a => a.branchId === branchId);
    }

    // 1. Calculate revenue from valid non-cancelled orders
    const validOrders = orders.filter(o => 
      [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(o.orderStatus)
    );

    const totalRevenue = validOrders.reduce((sum, o) => sum + (o.unitPrice || 0), 0);
    const newDepositsCount = orders.filter(o => o.paymentStatus === PAYMENT_STATUS.DEPOSIT_PAID).length;

    // 2. Appointments counts
    const todayAppointments = appointments.filter(a => a.status !== APPOINTMENT_STATUS.CANCELLED);
    const pendingSupport = dbState.supportTickets.filter(t => t.status === 'Open').length;

    // 3. Segment shares calculated from real orders
    const segmentCounts = { 'SUV': 0, 'Sedan': 0, 'Compact': 0 };
    orders.forEach(o => {
      const v = dbState.vehicles.find(veh => veh.id === o.vehicleId);
      if (v && segmentCounts[v.category] !== undefined) {
        segmentCounts[v.category]++;
      } else {
        segmentCounts['SUV']++;
      }
    });

    const totalCounted = Object.values(segmentCounts).reduce((a, b) => a + b, 0) || 1;
    const segmentShares = [
      { name: 'SUV Electric', share: Math.round((segmentCounts['SUV'] / totalCounted) * 100), color: '#0066FF' },
      { name: 'Sedan Grand', share: Math.round((segmentCounts['Sedan'] / totalCounted) * 100), color: '#3B82F6' },
      { name: 'Compact Urban', share: Math.round((segmentCounts['Compact'] / totalCounted) * 100), color: '#60A5FA' }
    ];

    return {
      totalRevenue: totalRevenue,
      monthlyRevenue: totalRevenue.toLocaleString('vi-VN'),
      totalRevenueNumber: totalRevenue,
      newDepositsCount,
      todayTestDrives: todayAppointments.length,
      supportRequests: pendingSupport,
      segmentShares,
      appointments: appointments.slice(0, 10).map(a => ({
        id: a.id,
        customer: a.customerName,
        phone: a.phone,
        car: a.carName,
        branch: a.branchName,
        time: `${a.preferredDate} - ${a.timeSlot}`,
        status: a.status
      }))
    };
  }
};

module.exports = AnalyticsService;
