// backend/application/analytics-service.js
// Analytics derived strictly from actual stored records in the database (fail-closed branch/date scoped, SIG-P4-006)

const { dbState } = require('../infrastructure/storage-engine');
const { ORDER_STATUS, PAYMENT_STATUS, APPOINTMENT_STATUS, TICKET_STATUS, ROLES, LEGACY_VEHICLE_ARCHIVES } = require('../domain/constants');

function toLocalDateStr(isoTs, tzOffsetMinutes = 420) {
  const ms = Date.parse(isoTs);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + Number(tzOffsetMinutes || 420) * 60000).toISOString().slice(0, 10);
}

function createError(message, statusCode = 400, code = 'ANALYTICS_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function getScopedRecords({ branchId = null, branchIds = null, userRole = ROLES.ADMIN, dateFrom = null, dateTo = null, tzOffsetMinutes = 420 } = {}) {
  const isSeller = userRole && userRole !== ROLES.ADMIN;
  const allowedBranches = Array.isArray(branchIds) && branchIds.length > 0
    ? branchIds.filter(Boolean)
    : [];

  if (branchId && branchId !== 'all' && isSeller && !allowedBranches.includes(branchId)) {
    throw createError('Bạn không có quyền truy cập số liệu doanh thu của chi nhánh khác.', 403, 'BRANCH_SCOPE_DENIED');
  }

  let orders = [...(dbState.orders || [])];
  let appointments = [...(dbState.appointments || [])];
  let tickets = [...(dbState.supportTickets || [])];
  let refunds = [...(dbState.refunds || [])];

  if (isSeller) {
    // Fail-closed: unassigned staff sees empty slice, never global figures
    orders = allowedBranches.length > 0 ? orders.filter(o => o.branchId && allowedBranches.includes(o.branchId)) : [];
    appointments = allowedBranches.length > 0 ? appointments.filter(a => a.branchId && allowedBranches.includes(a.branchId)) : [];
    tickets = allowedBranches.length > 0 ? tickets.filter(t => t.branchId && allowedBranches.includes(t.branchId)) : [];
  }
  if (branchId && branchId !== 'all') {
    orders = orders.filter(o => o.branchId === branchId);
    appointments = appointments.filter(a => a.branchId === branchId);
    tickets = tickets.filter(t => t.branchId === branchId);
  }

  const fromStr = dateFrom ? String(dateFrom).slice(0, 10) : null;
  const toStr = dateTo ? String(dateTo).slice(0, 10) : null;
  if (fromStr || toStr) {
    const inRange = (iso) => {
      const d = toLocalDateStr(iso, tzOffsetMinutes);
      if (!d) return false;
      if (fromStr && d < fromStr) return false;
      if (toStr && d > toStr) return false;
      return true;
    };
    orders = orders.filter(o => inRange(o.createdAt));
    appointments = appointments.filter(a => {
      const d = a.preferredDate ? String(a.preferredDate).slice(0, 10) : toLocalDateStr(a.createdAt, tzOffsetMinutes);
      if (fromStr && d < fromStr) return false;
      if (toStr && d > toStr) return false;
      return true;
    });
    tickets = tickets.filter(t => inRange(t.createdAt));
    refunds = refunds.filter(r => inRange(r.settledAt || r.createdAt));
  }

  const orderIds = new Set(orders.map(o => o.id));
  refunds = refunds.filter(r => orderIds.has(r.orderId));

  return { orders, appointments, tickets, refunds };
}

const AnalyticsService = {
  getSellerOverview({ branchId, branchIds, userRole, dateFrom = null, dateTo = null, tzOffsetMinutes = 420 } = {}) {
    const { orders, appointments, tickets, refunds } = getScopedRecords({
      branchId,
      branchIds,
      userRole,
      dateFrom,
      dateTo,
      tzOffsetMinutes
    });

    // Exclude Cancelled/Failed/Returned from valid GMV & unit aggregates
    const validOrders = orders.filter(o =>
      [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(o.orderStatus)
    );

    const getOrderTotal = (o) => Math.round(Number(o.totalAmount ?? o.unitPrice ?? 0));

    const committedValue = validOrders.reduce((sum, o) => sum + getOrderTotal(o), 0);
    const cashCollectedRevenue = orders
      .filter(o => ![ORDER_STATUS.CANCELLED, ORDER_STATUS.FAILED].includes(o.orderStatus))
      .reduce((sum, o) => {
        if (o.paymentStatus === PAYMENT_STATUS.FULLY_PAID) return sum + Math.round(Number(o.paidAmount || getOrderTotal(o)));
        if (o.paymentStatus === PAYMENT_STATUS.DEPOSIT_PAID) return sum + Math.round(Number(o.paidAmount || o.depositAmount || 0));
        return sum + Math.round(Number(o.paidAmount || 0));
      }, 0);

    const depositHeldVnd = orders
      .filter(o => ![ORDER_STATUS.CANCELLED, ORDER_STATUS.FAILED].includes(o.orderStatus) && o.paymentStatus === PAYMENT_STATUS.DEPOSIT_PAID)
      .reduce((sum, o) => sum + Math.round(Number(o.paidAmount || o.depositAmount || 0)), 0);

    const recognizedRevenue = validOrders
      .filter(o => o.paymentStatus === PAYMENT_STATUS.FULLY_PAID || [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(o.orderStatus))
      .reduce((sum, o) => sum + getOrderTotal(o), 0);

    const refundedVnd = refunds
      .filter(r => ['Settled', 'Refunded', 'Approved'].includes(r.status))
      .reduce((sum, r) => sum + Math.round(Number(r.refundAmount || r.amount || 0)), 0);

    const netCashVnd = Math.max(0, cashCollectedRevenue - refundedVnd);

    const unitsOrdered = validOrders.reduce((sum, o) => {
      if (Array.isArray(o.lines) && o.lines.length > 0) {
        return sum + o.lines.reduce((ls, l) => ls + Number(l.quantity || 1), 0);
      }
      return sum + 1;
    }, 0);
    const unitsHandedOver = validOrders
      .filter(o => [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(o.orderStatus))
      .length;

    const newDepositsCount = orders.filter(o => o.paymentStatus === PAYMENT_STATUS.DEPOSIT_PAID).length;
    const unpaidOrdersCount = orders.filter(o => o.paymentStatus === PAYMENT_STATUS.UNPAID && o.orderStatus !== ORDER_STATUS.CANCELLED).length;
    const todayAppointments = appointments.filter(a => a.status !== APPOINTMENT_STATUS.CANCELLED);
    const pendingSupport = tickets.filter(t =>
      [TICKET_STATUS.OPEN, TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.WAITING_STAFF, 'Open'].includes(t.status)
    ).length;

    const segmentCounts = { 'SUV': 0, 'Sedan': 0, 'Compact': 0, 'Khác': 0 };
    validOrders.forEach(o => {
      const v = (dbState.vehicles || []).find(veh => veh.id === o.vehicleId) ||
        (dbState.certifiedVehicles || []).find(veh => veh.id === o.vehicleId) ||
        LEGACY_VEHICLE_ARCHIVES[o.vehicleId];
      if (v && segmentCounts[v.category] !== undefined) {
        segmentCounts[v.category]++;
      } else {
        segmentCounts['Khác']++;
      }
    });

    const totalCounted = Object.values(segmentCounts).reduce((a, b) => a + b, 0);
    const pct = (n) => (totalCounted > 0 ? Math.round((n / totalCounted) * 100) : 0);
    const segmentShares = [
      { name: 'SUV Electric', count: segmentCounts['SUV'], share: pct(segmentCounts['SUV']), color: '#0066FF' },
      { name: 'Sedan Grand', count: segmentCounts['Sedan'], share: pct(segmentCounts['Sedan']), color: '#3B82F6' },
      { name: 'Compact Urban', count: segmentCounts['Compact'], share: pct(segmentCounts['Compact']), color: '#60A5FA' }
    ];

    // Dynamic monthly revenue buckets derived strictly from filtered validOrders (no hardcoded numbers)
    const monthlyMap = new Map();
    for (const o of validOrders) {
      const monthKey = (toLocalDateStr(o.createdAt, tzOffsetMinutes) || '').slice(0, 7);
      if (!monthKey) continue;
      monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + getOrderTotal(o));
    }
    const monthlySeries = Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, committedGmv]) => ({ month, committedGmv }));

    return {
      filterScope: {
        branchId: branchId || 'all',
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        tzOffsetMinutes: Number(tzOffsetMinutes || 420)
      },
      totalRevenue: committedValue,
      recognizedRevenue,
      cashCollectedRevenue,
      depositHeldVnd,
      refundedVnd,
      netCashVnd,
      monthlyRevenue: recognizedRevenue.toLocaleString('vi-VN'),
      totalRevenueNumber: committedValue,
      unitsOrdered,
      unitsHandedOver,
      newDepositsCount,
      unpaidOrdersCount,
      todayTestDrives: todayAppointments.length,
      supportRequests: pendingSupport,
      segmentShares,
      monthlySeries,
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
  },

  exportSellerCsv({ branchId, branchIds, userRole, dateFrom = null, dateTo = null, tzOffsetMinutes = 420 } = {}) {
    const { orders } = getScopedRecords({ branchId, branchIds, userRole, dateFrom, dateTo, tzOffsetMinutes });
    const reconciledOrders = orders.filter(o =>
      ![ORDER_STATUS.CANCELLED, ORDER_STATUS.FAILED, 'Returned'].includes(o.orderStatus)
    );
    const header = ['OrderNumber', 'CreatedDateLocal', 'BranchId', 'Vehicle', 'OrderStatus', 'PaymentStatus', 'TotalAmountVND', 'PaidAmountVND'];
    const escCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = reconciledOrders.map(o => {
      const totalVnd = Math.round(Number(o.totalAmount ?? o.unitPrice ?? 0));
      const paidVnd = o.paymentStatus === PAYMENT_STATUS.FULLY_PAID
        ? Math.round(Number(o.paidAmount || totalVnd))
        : o.paymentStatus === PAYMENT_STATUS.DEPOSIT_PAID
          ? Math.round(Number(o.paidAmount || o.depositAmount || 0))
          : Math.round(Number(o.paidAmount || 0));
      return [
        o.orderNumber || o.id,
        toLocalDateStr(o.createdAt, tzOffsetMinutes),
        o.branchId || '',
        o.vehicleName || o.vehicleId || '',
        o.orderStatus || '',
        o.paymentStatus || '',
        totalVnd,
        paidVnd
      ].map(escCsv).join(',');
    });
    return [header.join(','), ...rows].join('\n');
  }
};

module.exports = AnalyticsService;
