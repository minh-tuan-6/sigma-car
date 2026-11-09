const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  APPOINTMENT_TRANSITIONS,
  canUserTransitionOrder,
  canUserTransitionAppointment
} = require('../../backend/domain/state-machines');
const { ORDER_STATUS, PAYMENT_STATUS, APPOINTMENT_STATUS, ROLES } = require('../../backend/domain/constants');

describe('Unit Test: State Machines and Transition RBAC Guards', () => {
  it('should allow valid Order transitions for Admin', () => {
    // Pending -> Confirmed
    let res = canUserTransitionOrder(ROLES.ADMIN, ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED);
    assert.strictEqual(res.allowed, true);

    // Confirmed -> Preparing
    res = canUserTransitionOrder(ROLES.ADMIN, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING);
    assert.strictEqual(res.allowed, true);

    // Preparing -> Shipped
    res = canUserTransitionOrder(ROLES.ADMIN, ORDER_STATUS.PREPARING, ORDER_STATUS.SHIPPED);
    assert.strictEqual(res.allowed, true);

    // Shipped -> Delivered
    res = canUserTransitionOrder(ROLES.ADMIN, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED);
    assert.strictEqual(res.allowed, true);

    // Delivered -> Completed
    res = canUserTransitionOrder(ROLES.ADMIN, ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED);
    assert.strictEqual(res.allowed, true);
  });

  it('should reject invalid and terminal Order state transitions', () => {
    // Completed is terminal
    let res = canUserTransitionOrder(ROLES.ADMIN, ORDER_STATUS.COMPLETED, ORDER_STATUS.PENDING);
    assert.strictEqual(res.allowed, false);

    // Cancelled is terminal
    res = canUserTransitionOrder(ROLES.ADMIN, ORDER_STATUS.CANCELLED, ORDER_STATUS.CONFIRMED);
    assert.strictEqual(res.allowed, false);

    // Cannot skip directly from Pending to Delivered
    res = canUserTransitionOrder(ROLES.ADMIN, ORDER_STATUS.PENDING, ORDER_STATUS.DELIVERED);
    assert.strictEqual(res.allowed, false);
  });

  it('should restrict Buyer from modifying order status except cancelling pending orders', () => {
    // Buyer can cancel when pending
    let res = canUserTransitionOrder(ROLES.BUYER, ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED);
    assert.strictEqual(res.allowed, true);

    // Buyer CANNOT confirm their own order
    res = canUserTransitionOrder(ROLES.BUYER, ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED);
    assert.strictEqual(res.allowed, false);

    // Buyer CANNOT cancel once order is confirmed or preparing
    res = canUserTransitionOrder(ROLES.BUYER, ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED);
    assert.strictEqual(res.allowed, false);

    res = canUserTransitionOrder(ROLES.BUYER, ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELLED);
    assert.strictEqual(res.allowed, false);
  });

  it('should enforce Seller transition restrictions', () => {
    // Seller can confirm, prepare, ship
    let res = canUserTransitionOrder(ROLES.SELLER, ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED);
    assert.strictEqual(res.allowed, true);

    res = canUserTransitionOrder(ROLES.SELLER, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING);
    assert.strictEqual(res.allowed, true);

    res = canUserTransitionOrder(ROLES.SELLER, ORDER_STATUS.PREPARING, ORDER_STATUS.SHIPPED);
    assert.strictEqual(res.allowed, true);

    // Seller CANNOT cancel a confirmed order without Admin approval
    res = canUserTransitionOrder(ROLES.SELLER, ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED);
    assert.strictEqual(res.allowed, false);
  });

  it('should correctly govern Appointment state transitions', () => {
    // Buyer can cancel their appointment
    let res = canUserTransitionAppointment(ROLES.BUYER, APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.CANCELLED);
    assert.strictEqual(res.allowed, true);

    // Buyer cannot mark appointment as completed
    res = canUserTransitionAppointment(ROLES.BUYER, APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.COMPLETED);
    assert.strictEqual(res.allowed, false);

    // Seller/Admin can confirm and complete
    res = canUserTransitionAppointment(ROLES.SELLER, APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.CONFIRMED);
    assert.strictEqual(res.allowed, true);

    res = canUserTransitionAppointment(ROLES.SELLER, APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.COMPLETED);
    assert.strictEqual(res.allowed, true);
  });
});
