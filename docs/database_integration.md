# SIGMACAR — Database Readiness & Future Integration Specification
## Architecture, Domain Models, Repository Contracts & Production DB Migration Guide

> **Document Status**: Production-Ready Architectural Contract  
> **Platform Version**: 1.0.0  
> **Target Database Engine**: PostgreSQL 15+ / MySQL 8.0+ / MongoDB 6.0+ (via Repository Adapters)  
> **Current Engine**: In-Memory ACID Transaction Engine with JSON Persistence (`data/sigmacar_store.json`)

---

## 1. Current Persistence Architecture

SIGMACAR is organized strictly following the **Repository & Layered Clean Architecture** pattern:

```
[Presentation Layer: Vanilla JS SPA + Figma-Accurate CSS]
                    │
                    ▼ (Centralized API Client: js/api-client.js)
[API Layer: RESTful v1 Endpoints + JWT/scrypt Security Middleware]
                    │
                    ▼ (Business Workflows & Validation)
[Application Layer: AuthService, OrderService, FinancingService, AnalyticsService]
                    │
                    ▼ (State Machines & Transition Validators)
[Domain Layer: Order/Payment/Appointment State Machines, Constants]
                    │
                    ▼ (Interface Abstraction Boundary)
[Infrastructure Layer: UserRepository, VehicleRepository, OrderRepository, AppointmentRepository]
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
[Current Adapter]     [Future Database Adapter]
In-Memory Mutex Lock  PostgreSQL / MySQL / Prisma / Knex
Snapshot Rollback     Foreign Keys & ACID Transactions
JSON File Storage     `DATABASE_URL` via process.env
```

### Key Architectural Isolation
- **UI Components & Services NEVER speak directly to SQL or raw data files.**
- All queries pass through **Repository Interfaces** (`UserRepository`, `VehicleRepository`, `OrderRepository`, `AppointmentRepository`).
- Switching to a real database later requires **ZERO changes** to frontend components (`js/app.js`, `js/api-client.js`) and **ZERO changes** to core business workflows (`backend/application/*`).
- Only the repository implementations in `backend/infrastructure/repositories/*` need to switch their query executions from `dbState` to SQL queries or ORM models.

---

## 2. Domain Entities & Entity-Relationship Model (ERD)

```
┌────────────────────────┐         1:N         ┌────────────────────────┐
│         USERS          │────────────────────<│         ORDERS         │
│ ────────────────────── │                     │ ────────────────────── │
│ id (PK)                │                     │ id (PK)                │
│ email (UNIQUE)         │                     │ orderNumber (UNIQUE)   │
│ passwordHash (scrypt)  │                     │ userId (FK -> USERS)   │
│ fullName               │                     │ vehicleId (FK)         │
│ phone                  │                     │ unitPrice (VND)        │
│ role (buyer/seller/adm)│                     │ depositAmount (VND)    │
│ branchId (optional FK) │                     │ orderStatus            │
│ tier / points          │                     │ paymentStatus          │
│ createdAt              │                     │ paymentMethod          │
└────────────────────────┘                     │ createdAt              │
            │                                  └────────────────────────┘
            │                                               │
            │ 1:N                                           │ 1:N
            ▼                                               ▼
┌────────────────────────┐                     ┌────────────────────────┐
│      APPOINTMENTS      │                     │     ORDER_HISTORY      │
│ ────────────────────── │                     │ ────────────────────── │
│ id (PK)                │                     │ id (PK)                │
│ userId (FK -> USERS)   │                     │ orderId (FK -> ORDERS) │
│ customerName           │                     │ status                 │
│ phone / email          │                     │ updatedBy (FK)         │
│ carName                │                     │ timestamp              │
│ branchId (FK)          │                     │ note                   │
│ preferredDate          │                     └────────────────────────┘
│ timeSlot               │
│ status                 │
│ createdAt              │
└────────────────────────┘
            ▲
            │ N:1
┌────────────────────────┐
│    BRANCHES (STORES)   │
│ ────────────────────── │
│ id (PK)                │
│ name                   │
│ city                   │
│ address                │
│ phone                  │
└────────────────────────┘
            ▲
            │
┌────────────────────────┐
│        VEHICLES        │
│ ────────────────────── │
│ id (PK)                │
│ name                   │
│ category (SUV/Sedan)   │
│ condition (new/cert)   │
│ price (VND)            │
│ range (km)             │
│ hp / power             │
│ battery (kWh)          │
│ stock (INTEGER >= 0)   │
│ isAvailable (BOOLEAN)  │
└────────────────────────┘
```

---

## 3. Repository Interfaces & Contract Specifications

### 3.1 `UserRepository`
```typescript
interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    phone?: string;
    role: 'buyer' | 'seller' | 'admin';
    branchId?: string;
  }): Promise<User>;
  update(id: string, updates: Partial<User>): Promise<User>;
}
```

### 3.2 `VehicleRepository`
```typescript
interface VehicleRepository {
  findAll(filters?: {
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    search?: string;
    sort?: 'price-asc' | 'price-desc' | 'range-desc';
    type?: 'new' | 'certified';
  }): Promise<Vehicle[]>;
  findCertified(filters?: { maxPrice?: number; search?: string }): Promise<CertifiedVehicle[]>;
  findById(id: string): Promise<Vehicle | null>;
  reserveInventory(vehicleId: string, quantity?: number): Promise<Vehicle>;
  restoreInventory(vehicleId: string, quantity?: number): Promise<Vehicle>;
}
```

### 3.3 `OrderRepository`
```typescript
interface OrderRepository {
  findById(idOrNumber: string): Promise<Order | null>;
  findByQuery(params: {
    userId?: string;
    branchId?: string;
    userRole?: string;
  }): Promise<Order[]>;
  create(orderData: CreateOrderDTO): Promise<Order>;
  transitionStatus(
    orderId: string,
    targetStatus: OrderStatus,
    updatedByUserId: string,
    userRole: string,
    note?: string
  ): Promise<Order>;
}
```

### 3.4 `AppointmentRepository`
```typescript
interface AppointmentRepository {
  findById(id: string): Promise<Appointment | null>;
  findByQuery(params: {
    userId?: string;
    branchId?: string;
    userRole?: string;
  }): Promise<Appointment[]>;
  isSlotAvailable(branchId: string, date: string, timeSlot: string): Promise<boolean>;
  create(data: CreateAppointmentDTO): Promise<Appointment>;
  transitionStatus(
    id: string,
    targetStatus: AppointmentStatus,
    updatedByUserId: string,
    userRole: string
  ): Promise<Appointment>;
}
```

---

## 4. API Request & Response Schemas

| Endpoint | Method | Role Required | Request Body | Response (200 / 201) |
|---|---|---|---|---|
| `/api/v1/auth/register` | `POST` | Public | `{ email, password, fullName, phone }` | `{ success: true, data: { user, token } }` |
| `/api/v1/auth/login` | `POST` | Public | `{ email, password }` | `{ success: true, data: { user, token } }` |
| `/api/v1/auth/me` | `GET` | Authenticated | None | `{ success: true, data: userProfile }` |
| `/api/v1/vehicles` | `GET` | Public | Query: `category`, `minPrice`, `maxPrice`, `search`, `sort` | `{ success: true, count, data: Vehicle[] }` |
| `/api/v1/vehicles/:id` | `GET` | Public | Path: `id` | `{ success: true, data: Vehicle }` |
| `/api/v1/financing/calculate`| `POST` | Public | `{ vehiclePrice, downPaymentPercent, annualInterestRatePercent, termMonths }` | `{ success: true, data: LoanQuotation }` |
| `/api/v1/appointments` | `POST` | Public / Buyer | `{ customerName, phone, email, branchId, date, timeSlot, carName }` | `{ success: true, data: Appointment }` |
| `/api/v1/appointments` | `GET` | Authenticated | Scoped by role and identity | `{ success: true, count, data: Appointment[] }` |
| `/api/v1/orders/deposit` | `POST` | Buyer | `{ vehicleId, branchId, buyerName, buyerPhone, paymentMethod }` | `{ success: true, data: Order }` |
| `/api/v1/orders` | `GET` | Authenticated | Scoped by role and identity | `{ success: true, count, data: Order[] }` |
| `/api/v1/orders/:id/status` | `PATCH` | Seller / Admin | `{ status, note }` | `{ success: true, data: UpdatedOrder }` |
| `/api/v1/analytics/summary` | `GET` | Seller / Admin | Scoped by branchId for Seller; Global for Admin | `{ success: true, data: AnalyticsReport }` |

---

## 5. Required Unique Constraints & Database Indexes

When deploying to a relational database (PostgreSQL/MySQL), the following constraints and indexes **must** be created:

### Unique Constraints
1. `users.email`: `UNIQUE INDEX idx_users_email (LOWER(email))`
2. `orders.order_number`: `UNIQUE INDEX idx_orders_order_number (order_number)`
3. `appointments.slot_collision`: `UNIQUE INDEX idx_appointment_slot (branch_id, preferred_date, time_slot) WHERE status IN ('Pending', 'Confirmed')`
4. `vehicles.vin`: `UNIQUE INDEX idx_vehicles_vin (vin) WHERE vin IS NOT NULL`

### Performance & Query Indexes
1. `orders(user_id, created_at DESC)`: For fast customer order history retrieval.
2. `orders(branch_id, order_status)`: For Seller store dashboard pipeline queries.
3. `appointments(branch_id, preferred_date)`: For showroom slot scheduling calendar.
4. `vehicles(price, category, range)`: For catalog multi-filter searches.

---

## 6. Transaction Boundaries & Concurrency

### Critical All-or-Nothing Operations
1. **Deposit Order Creation**:
   - Step A: Verify inventory (`stock >= 1`).
   - Step B: Decrement inventory (`stock = stock - 1`). If `stock == 0`, set `is_available = false`.
   - Step C: Create `orders` record with server-validated `unit_price` and `deposit_amount = 50,000,000`.
   - Step D: Insert initial audit record in `order_history`.
   - *Rollback Guard*: If Step C or D fails, Step B inventory reservation is completely rolled back.
2. **Order Cancellation**:
   - Transition status to `Cancelled`.
   - Increment vehicle inventory (`stock = stock + 1`).
3. **Appointment Booking**:
   - Check unique slot reservation.
   - If occupied, abort with `409 Conflict` (`SLOT_CONFLICT`).

---

## 7. Role-Based Access Scopes (RBAC Matrix)

| Operation | Buyer | Seller (Store Scoped) | Admin (Global) |
|---|:---:|:---:|:---:|
| Browse & Compare Vehicles | ✅ | ✅ | ✅ |
| AI Automotive Consultation | ✅ | ✅ | ✅ |
| Calculate Loan & Financing | ✅ | ✅ | ✅ |
| Book Test Drive Appointment | ✅ | ✅ | ✅ |
| Cancel Own Pending Appointment | ✅ | ❌ | ✅ |
| Confirm / Complete Appointment | ❌ | ✅ (Assigned branch) | ✅ (All branches) |
| Place Vehicle Deposit | ✅ | ❌ | ❌ |
| View Orders | ✅ (Own orders only) | ✅ (Branch orders only) | ✅ (All system orders) |
| Confirm / Prepare / Ship Order | ❌ | ✅ (Branch orders) | ✅ (All orders) |
| Cancel Confirmed Order / Refund | ❌ | ❌ | ✅ |
| View Revenue Analytics | ❌ | ✅ (Branch revenue) | ✅ (Platform total) |
| Change Vehicle Base Price / Stock| ❌ | ❌ | ✅ |

---

## 8. Migration Strategy for External Database

When the real database credentials (e.g., PostgreSQL connection string) are provided:

```
[Step A: Environment Config]
  Set DATABASE_URL="postgresql://user:pass@host:5432/sigmacardb" in .env
  Set DATABASE_DIALECT="postgres"

[Step B: Schema Application]
  Run standard DDL migration script to create tables, foreign keys, and unique indexes.

[Step C: Seed / ETL Migration]
  Run `node scripts/migrate-json-to-sql.js` to transfer seeded vehicles,
  branches, and initial administrator accounts without duplicates.

[Step D: Repository Adapter Swap]
  Replace memory operations in `backend/infrastructure/repositories/*`
  with parameterized SQL pool queries (`pg` pool / Knex / Prisma).

[Step E: Automated Verification]
  Execute `npm test` against the live test database to verify that
  all 32 unit, integration, RBAC, and E2E tests pass identically.
```

---

## 9. Seed-Data Policy

- **Development/Test Accounts**:
  - `admin@sigmacar.vn` / `Admin@123456` (System Administrator)
  - `minhphan.seller@sigmacar.vn` / `Seller@123456` (Cầu Giấy Branch Seller)
  - `minhhoang.sigma@example.com` / `Buyer@123456` (Gold Member Buyer)
- **Production Rules**:
  - Never run destructive commands (`DROP TABLE`, `TRUNCATE`) automatically in production environments.
  - Production deployments must only apply additive schema changes.
  - Passwords must always be hashed with `crypto.scrypt` (or `bcrypt`/`argon2`) before storage.
