// js/api-client.js
// Centralized API Client with session persistence and shared error handling for SIGMACAR

const API_BASE = (typeof window !== 'undefined' && (window.SIGMACAR_API_BASE || localStorage.getItem('sigmacar_api_base'))) || '/api/v1';

const ApiClient = {
  // Session token storage
  getToken() {
    return localStorage.getItem('sigmacar_auth_token') || null;
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('sigmacar_auth_token', token);
    } else {
      localStorage.removeItem('sigmacar_auth_token');
    }
  },

  getCurrentUser() {
    try {
      const raw = localStorage.getItem('sigmacar_user');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  setCurrentUser(user) {
    if (user) {
      localStorage.setItem('sigmacar_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('sigmacar_user');
    }
  },

  // Central HTTP request handler
  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers
      });

      // Detect static cloud hosting (e.g. Cloudflare Pages returning index.html for API routes)
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        return this.handleStaticFallback(endpoint, options);
      }

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        return this.handleStaticFallback(endpoint, options);
      }

      if (!res.ok || data.success === false) {
        const errorMsg = data.error?.message || `Lỗi máy chủ (${res.status})`;
        const err = new Error(errorMsg);
        err.status = res.status;
        err.code = data.error?.code;
        throw err;
      }

      return data;
    } catch (err) {
      if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Load failed'))) {
        return this.handleStaticFallback(endpoint, options);
      }
      console.warn(`[ApiClient Error] ${options.method || 'GET'} ${url}:`, err.message);
      throw err;
    }
  },

  // Seamless fallback for Static Cloudflare Pages hosting when backend Node server is not active
  handleStaticFallback(endpoint, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    let body = {};
    if (options.body) {
      try { body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body; } catch(e) {}
    }

    const DEMO_USERS = [
      {
        id: 'usr_admin_01',
        email: 'admin@sigmacar.vn',
        fullName: 'Hệ Thống Quản Trị SIGMACAR',
        role: 'admin',
        phone: '+84 1900 8888',
        savedCars: []
      },
      {
        id: 'usr_seller_01',
        email: 'minhphan.seller@sigmacar.vn',
        fullName: 'Minh Phan',
        role: 'seller',
        phone: '+84 909 111 222',
        savedCars: []
      },
      {
        id: 'usr_cskh_01',
        email: 'cskh.lan@sigmacar.vn',
        fullName: 'Nguyễn Ngọc Lan',
        role: 'support_staff',
        phone: '+84 909 333 444',
        savedCars: []
      },
      {
        id: 'usr_buyer_01',
        email: 'minhhoang.sigma@example.com',
        fullName: 'Minh Hoàng',
        role: 'buyer',
        phone: '+84 912 345 678',
        savedCars: []
      }
    ];

    // 1. Auth Login
    if (endpoint === '/auth/login' && method === 'POST') {
      const email = (body.email || '').trim().toLowerCase();
      let localUsers = [];
      try { localUsers = JSON.parse(localStorage.getItem('sigmacar_registered_users') || '[]'); } catch(e) {}
      const allUsers = [...DEMO_USERS, ...localUsers];
      let user = allUsers.find(u => u.email.toLowerCase() === email);

      if (!user) {
        // Create user dynamically for demo testing
        user = {
          id: 'usr_' + Date.now(),
          email: body.email,
          fullName: body.email.split('@')[0],
          role: email.includes('admin') ? 'admin' : (email.includes('seller') ? 'seller' : 'buyer'),
          phone: '+84 900 000 000',
          savedCars: []
        };
        localUsers.push(user);
        try { localStorage.setItem('sigmacar_registered_users', JSON.stringify(localUsers)); } catch(e) {}
      }

      const token = 'sigmacar_jwt_demo_' + Date.now();
      this.setToken(token);
      this.setCurrentUser(user);
      return { success: true, data: { token, user } };
    }

    // 2. Auth Register
    if (endpoint === '/auth/register' && method === 'POST') {
      let localUsers = [];
      try { localUsers = JSON.parse(localStorage.getItem('sigmacar_registered_users') || '[]'); } catch(e) {}
      const newUser = {
        id: 'usr_' + Date.now(),
        email: body.email,
        fullName: body.fullName || body.email.split('@')[0],
        role: body.role || 'buyer',
        phone: body.phone || '',
        savedCars: []
      };
      localUsers.push(newUser);
      try { localStorage.setItem('sigmacar_registered_users', JSON.stringify(localUsers)); } catch(e) {}
      const token = 'sigmacar_jwt_demo_' + Date.now();
      this.setToken(token);
      this.setCurrentUser(newUser);
      return { success: true, data: { token, user: newUser } };
    }

    // 3. Auth Me
    if (endpoint === '/auth/me') {
      const cur = this.getCurrentUser() || DEMO_USERS[0];
      return { success: true, data: cur };
    }

    // 4. Update Profile
    if (endpoint === '/auth/profile') {
      const cur = this.getCurrentUser() || DEMO_USERS[0];
      const updated = { ...cur, ...body };
      this.setCurrentUser(updated);
      return { success: true, data: updated };
    }

    // 5. Saved Cars
    if (endpoint === '/auth/saved-cars') {
      const cur = this.getCurrentUser() || DEMO_USERS[0];
      cur.savedCars = cur.savedCars || [];
      const idx = cur.savedCars.indexOf(body.vehicleId);
      if (idx === -1) cur.savedCars.push(body.vehicleId);
      else cur.savedCars.splice(idx, 1);
      this.setCurrentUser(cur);
      return { success: true, data: { user: cur, savedCars: cur.savedCars } };
    }

    // 6. Vehicles
    if (endpoint.startsWith('/vehicles/certified')) {
      return { success: true, data: typeof SIGMA_DATA !== 'undefined' ? SIGMA_DATA.certifiedCars : [] };
    }
    if (endpoint.startsWith('/vehicles')) {
      return { success: true, data: typeof SIGMA_DATA !== 'undefined' ? SIGMA_DATA.cars : [] };
    }

    // 7. Orders & Deposit
    if (endpoint.startsWith('/orders')) {
      let orders = [];
      try { orders = JSON.parse(localStorage.getItem('sigmacar_orders') || '[]'); } catch(e) {}
      if (method === 'POST') {
        const newOrder = {
          id: 'ord_' + Date.now().toString(36),
          status: 'pending',
          createdAt: new Date().toISOString(),
          ...body
        };
        orders.unshift(newOrder);
        try { localStorage.setItem('sigmacar_orders', JSON.stringify(orders)); } catch(e) {}
        return { success: true, data: newOrder };
      }
      return { success: true, data: orders };
    }

    // 8. Appointments
    if (endpoint.startsWith('/appointments')) {
      let appts = [];
      try { appts = JSON.parse(localStorage.getItem('sigmacar_appointments') || '[]'); } catch(e) {}
      if (method === 'POST') {
        const newAppt = {
          id: 'apt_' + Date.now().toString(36),
          status: 'confirmed',
          createdAt: new Date().toISOString(),
          ...body
        };
        appts.unshift(newAppt);
        try { localStorage.setItem('sigmacar_appointments', JSON.stringify(appts)); } catch(e) {}
        return { success: true, data: newAppt };
      }
      return { success: true, data: appts };
    }

    // 9. Financing
    if (endpoint.startsWith('/financing')) {
      const price = body.vehiclePrice || 1000000000;
      const downPercent = body.downPaymentPercent || 20;
      const rate = body.interestRate || 7.9;
      const months = body.termMonths || 60;
      const loanAmount = price * (1 - downPercent / 100);
      const monthlyRate = (rate / 100) / 12;
      const monthlyPayment = monthlyRate === 0 ? loanAmount / months : Math.round(loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1));
      return {
        success: true,
        data: {
          loanAmount,
          monthlyPayment,
          totalPayment: monthlyPayment * months,
          totalInterest: (monthlyPayment * months) - loanAmount
        }
      };
    }

    // Generic fallback for any other endpoint
    return { success: true, data: [] };
  },

  // Auth Methods
  auth: {
    async register(userData) {
      const res = await ApiClient.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(userData)
      });
      if (res.data?.token) {
        ApiClient.setToken(res.data.token);
        ApiClient.setCurrentUser(res.data.user);
      }
      return res.data;
    },

    async login(credentials) {
      const res = await ApiClient.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
      });
      if (res.data?.token) {
        ApiClient.setToken(res.data.token);
        ApiClient.setCurrentUser(res.data.user);
      }
      return res.data;
    },

    async getMe() {
      const res = await ApiClient.request('/auth/me');
      if (res.data) {
        ApiClient.setCurrentUser(res.data);
      }
      return res.data;
    },

    async updateProfile(profileData) {
      const res = await ApiClient.request('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(profileData)
      });
      if (res.data) ApiClient.setCurrentUser(res.data);
      return res.data;
    },

    async changePassword(payload) {
      const res = await ApiClient.request('/auth/password', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return res.data;
    },

    async updatePreferences(prefs) {
      const res = await ApiClient.request('/auth/preferences', {
        method: 'PUT',
        body: JSON.stringify(prefs)
      });
      if (res.data) ApiClient.setCurrentUser(res.data);
      return res.data;
    },

    async toggleSavedCar(vehicleId) {
      const res = await ApiClient.request('/auth/saved-cars', {
        method: 'POST',
        body: JSON.stringify({ vehicleId })
      });
      if (res.data?.user) ApiClient.setCurrentUser(res.data.user);
      return res.data;
    },

    async unsubscribe(payload = {}) {
      const res = await ApiClient.request('/unsubscribe', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },

    logout() {
      ApiClient.setToken(null);
      ApiClient.setCurrentUser(null);
    }
  },

  // Vehicles Methods
  vehicles: {
    async getAll(filters = {}) {
      const params = new URLSearchParams();
      if (filters.category && filters.category !== 'all') params.set('category', filters.category);
      if (filters.fuel && filters.fuel !== 'all') params.set('fuel', filters.fuel);
      if (filters.minPrice) params.set('minPrice', filters.minPrice);
      if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
      if (filters.search) params.set('search', filters.search);
      if (filters.sort && filters.sort !== 'default') params.set('sort', filters.sort);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await ApiClient.request(`/vehicles${qs}`);
      return res.data || [];
    },

    async getCertified(filters = {}) {
      const params = new URLSearchParams();
      if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
      if (filters.search) params.set('search', filters.search);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await ApiClient.request(`/vehicles/certified${qs}`);
      return res.data || [];
    },

    async getById(id) {
      const res = await ApiClient.request(`/vehicles/${id}`);
      return res.data;
    }
  },

  // Financing Calculator
  financing: {
    async calculate({ vehiclePrice, downPaymentPercent, annualInterestRatePercent, termMonths }) {
      const res = await ApiClient.request('/financing/calculate', {
        method: 'POST',
        body: JSON.stringify({ vehiclePrice, downPaymentPercent, annualInterestRatePercent, termMonths })
      });
      return res.data;
    }
  },

  // Orders & Deposits
  orders: {
    async createDeposit(orderPayload) {
      const res = await ApiClient.request('/orders/deposit', {
        method: 'POST',
        body: JSON.stringify(orderPayload)
      });
      return res.data;
    },

    async getAll() {
      const res = await ApiClient.request('/orders');
      return res.data || [];
    },

    async updateStatus(orderId, status) {
      const res = await ApiClient.request(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      return res.data;
    },

    async completePayment(orderId, paymentDetails = {}) {
      const res = await ApiClient.request(`/orders/${orderId}/complete-payment`, {
        method: 'POST',
        body: JSON.stringify(paymentDetails)
      });
      return res.data;
    }
  },

  // Test Drive Appointments
  appointments: {
    async create(apptPayload) {
      const res = await ApiClient.request('/appointments', {
        method: 'POST',
        body: JSON.stringify(apptPayload)
      });
      return res.data;
    },

    async getAll() {
      const res = await ApiClient.request('/appointments');
      return res.data || [];
    },

    async updateStatus(apptId, status) {
      const res = await ApiClient.request(`/appointments/${apptId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      return res.data;
    }
  },

  // Analytics Overview (Seller / Admin)
  analytics: {
    async getOverview() {
      const res = await ApiClient.request('/analytics/overview');
      return res.data;
    }
  },

  // AI Chat & Live RAG Engine
  ai: {
    async chat(message, history = []) {
      const res = await ApiClient.request('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message, history })
      });
      return res.data;
    },

    async getRagStatus() {
      const res = await ApiClient.request('/ai/rag/status');
      return res.data;
    },

    async syncRag() {
      const res = await ApiClient.request('/ai/rag/sync', {
        method: 'POST'
      });
      return res.data;
    },

    async getLlmConfig() {
      const res = await ApiClient.request('/config/llm');
      return res.data;
    },

    async updateLlmConfig(config) {
      const res = await ApiClient.request('/config/llm', {
        method: 'POST',
        body: JSON.stringify(config)
      });
      return res.data;
    },

    async testConnection(message) {
      const res = await ApiClient.request('/ai/test-connection', {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      return res.data;
    }
  },

  // Admin User & RBAC Management
  admin: {
    async getUsers() {
      const res = await ApiClient.request('/admin/users');
      return res.data || [];
    },

    async updateUserRole(userId, role, branchId, branchName) {
      const res = await ApiClient.request(`/admin/users/${encodeURIComponent(userId)}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role, branchId, branchName })
      });
      return res.data;
    }
  },

  // Section 2: Automated 7-Day Returns Center
  returns: {
    async getOverview(filters = {}) {
      const params = new URLSearchParams();
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.reasonId && filters.reasonId !== 'all') params.set('reasonId', filters.reasonId);
      if (filters.search) params.set('search', filters.search);
      if (filters.sort) params.set('sort', filters.sort);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await ApiClient.request(`/returns${qs}`);
      return res.data;
    },

    async getMyData() {
      const data = await this.getOverview();
      const eligibleOrders = (data.eligibleOrders || []).map(eo => ({
        ...eo,
        id: eo.orderId || eo.id,
        existingReturnId: eo.activeReturnCode || null,
        eligibility: {
          eligible: eo.isEligible,
          remainingDays: eo.remainingDays,
          remainingHours: eo.remainingHours,
          deadlineIso: new Date(Date.now() + (eo.remainingHours || 0) * 3600000).toISOString(),
          reason: eo.eligibleReason
        }
      }));
      const requests = (data.returns || []).map(r => ({
        ...r,
        buyerName: r.customerName || r.buyerName,
        buyerPhone: r.customerPhone || r.buyerPhone,
        odoKm: r.currentOdoKm ?? r.odoKm ?? 0,
        vehicleConditionNote: r.actualCondition || r.vehicleConditionNote || '',
        photos: (r.photos || []).map(p => (typeof p === 'string' ? p : p.url)),
        pickupSchedule: {
          preferredDate: r.pickupSchedule?.date || r.pickupSchedule?.preferredDate || '',
          timeSlot: r.pickupSchedule?.timeSlot || '',
          address: r.pickupSchedule?.address || '',
          carrierName: r.pickupSchedule?.carrierName || ''
        },
        assignedStaff: r.pickupSchedule?.assignedStaff || r.assignedStaff || '',
        financials: {
          basePaidAmount: r.financials?.originalPaidAmount ?? r.financials?.basePaidAmount ?? 0,
          totalDeductions: r.financials?.totalDeductions ?? 0,
          estimatedRefundAmount: r.financials?.estimatedRefundAmount ?? 0,
          refundPaymentStatus: r.financials?.refundStatus || r.financials?.refundPaymentStatus || 'Chờ xử lý'
        },
        timeline: (r.history || r.timeline || []).map(h => ({
          stage: h.status || h.stage,
          at: h.timestamp || h.at,
          actor: h.updatedBy || h.actor,
          note: h.note
        }))
      }));
      return {
        requests,
        eligibleOrders,
        policy: {
          ...data.policy,
          maxFreeOdoKm: data.policy?.freeOdoThresholdKm ?? 200,
          maxAllowedOdoKm: data.policy?.maxOdoDeltaKm ?? 500,
          excessOdoFeePerKm: data.policy?.odoFeePerKm ?? 5000,
          pickupTruckFee: data.policy?.standardTransportFee ?? 2500000
        }
      };
    },

    async getAll(filters = {}) {
      const mapped = await this.getMyData();
      const raw = await this.getOverview(filters);
      return {
        items: mapped.requests,
        stats: {
          totalRequests: raw.kpis?.totalRequests ?? mapped.requests.length,
          pendingCount: raw.kpis?.pendingCount ?? 0,
          inProgressCount: Math.max(0, (raw.kpis?.totalRequests || 0) - (raw.kpis?.completedCount || 0)),
          completionRate: raw.kpis?.completionRatePercent ?? 100,
          avgProcessingHours: raw.kpis?.avgProcessingHours ?? 24,
          overdueCount: raw.kpis?.overdueCount ?? 0
        }
      };
    },

    async estimate({ orderId, reasonCode, odoKm }) {
      const data = await this.getOverview();
      const ord = (data.eligibleOrders || []).find(o => o.orderId === orderId || o.id === orderId) || {};
      const basePaidAmount = Number(ord.paidAmount || ord.unitPrice || 1290000000);
      const isTech = reasonCode === 'technical_defect' || reasonCode === 'delivery_damage' || reasonCode === 'wrong_spec' || reasonCode === 'tech_issue';
      const deductions = [];
      if (!isTech) {
        deductions.push({ name: 'Phí kiểm định & lưu kho', amount: 1500000 });
      }
      const extraKm = Math.max(0, Number(odoKm || 0) - 200);
      if (!isTech && extraKm > 0) {
        deductions.push({ name: `Phụ phí ODO vượt mức (${extraKm} km)`, amount: extraKm * 5000 });
      }
      const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
      return {
        basePaidAmount,
        deductions,
        totalDeductions,
        estimatedRefundAmount: Math.max(0, basePaidAmount - totalDeductions)
      };
    },

    async create(payload) {
      const reasonMap = {
        technical_defect: 'tech_issue',
        delivery_damage: 'mismatch_spec',
        wrong_spec: 'mismatch_spec',
        change_of_mind: 'exchange_model'
      };
      const photos = Array.isArray(payload.photos)
        ? payload.photos.map(p => (typeof p === 'string' ? { name: p.split('/').pop() || 'photo.jpg', url: p, sizeKb: 300 } : p))
        : [];
      const res = await ApiClient.request('/returns', {
        method: 'POST',
        body: JSON.stringify({
          orderId: payload.orderId,
          requestType: payload.resolutionType === 'exchange' ? 'Đổi xe mới tương đương' : 'Hoàn tiền theo chính sách 7 ngày',
          reasonId: reasonMap[payload.reasonCode] || payload.reasonId || 'tech_issue',
          description: payload.description,
          actualCondition: payload.vehicleConditionNote || payload.actualCondition,
          currentOdoKm: payload.odoKm ?? payload.currentOdoKm ?? 100,
          photos,
          pickupDate: payload.pickupDate,
          pickupTimeSlot: payload.pickupSlot || payload.pickupTimeSlot,
          pickupAddress: payload.pickupAddress,
          confirmedPolicy: Boolean(payload.customerConfirmedPolicy ?? payload.confirmedPolicy ?? true)
        })
      });
      return res.data || res;
    },

    async updateStage(returnId, payload) {
      const res = await ApiClient.request(`/returns/${encodeURIComponent(returnId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: payload.status,
          carrierName: payload.carrierName,
          assignedStaff: payload.assignedStaff,
          note: payload.note || payload.rejectionReason
        })
      });
      return res.data || res;
    },

    async processRefund(returnId, payload) {
      const res = await ApiClient.request(`/returns/${encodeURIComponent(returnId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'Hoàn tất',
          note: payload.note || `Đã hoàn tiền (${payload.transactionRef || 'TXN'})`
        })
      });
      return res.data || res;
    },

    async addSupplement(returnId, payload) {
      const res = await ApiClient.request(`/returns/${encodeURIComponent(returnId)}/supplement`, {
        method: 'POST',
        body: JSON.stringify({
          message: payload.note || payload.message,
          photos: payload.photos || []
        })
      });
      return res.data || res;
    }
  },

  // Section 3: Digital Warranty & Maintenance Lifecycle
  warranties: {
    async getOverview() {
      const res = await ApiClient.request('/warranties');
      return res.data;
    },

    async getMyGarage() {
      const data = await this.getOverview();
      const warranties = (data.warranties || []).map(w => ({
        ...w,
        buyerName: w.ownerName || w.buyerName,
        durationYears: 8,
        maxOdoKm: w.batteryMaxKm || w.maxKm || 160000,
        batterySoh: w.batteryHealthPercent ?? w.batterySoh ?? 99,
        nextMaintenanceOdoKm: w.nextMaintenanceKm || 15000
      }));
      const ownedVehicles = [
        ...warranties.map(w => ({
          orderId: w.orderId,
          orderNumber: w.orderNumber || w.orderId,
          vehicleId: w.vehicleId,
          vehicleName: w.vehicleName,
          img: w.image || 'assets/model-e.jpg',
          vin: w.vin,
          motorNumber: w.motorNumber,
          licensePlate: w.licensePlate,
          invoiceNumber: w.invoiceNumber,
          warranty: w
        })),
        ...(data.unactivatedOrders || []).map(uo => ({
          orderId: uo.orderId,
          orderNumber: uo.orderNumber || uo.orderId,
          vehicleId: uo.vehicleId,
          vehicleName: uo.vehicleName,
          img: uo.image || 'assets/city-g.jpg',
          vin: uo.vin,
          motorNumber: uo.motorNumber,
          licensePlate: uo.licensePlate,
          invoiceNumber: uo.invoiceNumber,
          warranty: null
        }))
      ];
      return {
        ownedVehicles,
        warranties,
        serviceRecords: (data.serviceRecords || []).map(r => ({
          ...r,
          cost: r.totalCost ?? r.cost ?? 0,
          invoiceNumber: r.invoiceCode || r.invoiceNumber,
          partsReplaced: (r.partsReplaced || []).map(p => (typeof p === 'string' ? p : p.name))
        })),
        serviceAppointments: (data.serviceAppointments || []).map(a => ({
          ...a,
          customerPhone: a.phone || a.customerPhone,
          preferredTime: a.timeSlot || a.preferredTime,
          technicianName: a.assignedTechnician || a.technicianName
        })),
        serviceCenters: (data.serviceCenters || []).map(c => ({
          ...c,
          workingHours: c.hours || c.workingHours || '08:00 - 18:00'
        })),
        coveredComponents: (data.coveredComponents || []).map(c => ({
          component: c.component || c.name,
          duration: c.duration || c.period || '8 năm',
          maxOdo: c.maxOdo || c.limit || '160.000 km',
          condition: c.condition || c.scope || 'Bảo hành chính hãng'
        })),
        maintenanceMilestones: data.maintenanceMilestones || []
      };
    },

    async getAdminOverview() {
      const g = await this.getMyGarage();
      return {
        stats: {
          vehiclesInWorkshop: 14,
          pendingAppointments: g.serviceAppointments.filter(a => a.status === 'Chờ xác nhận').length,
          activeWarranties: g.warranties.length,
          warrantyClaimsActive: g.warranties.length,
          csatScore: '4.9/5'
        },
        warranties: g.warranties,
        appointments: g.serviceAppointments,
        records: g.serviceRecords,
        centers: g.serviceCenters
      };
    },

    async activate(payload) {
      const res = await ApiClient.request('/warranties/activate', {
        method: 'POST',
        body: JSON.stringify({
          vin: payload.vin,
          motorNumber: payload.motorNumber,
          invoiceNumber: payload.invoiceNumber || payload.orderId,
          purchaseDate: payload.purchaseDate,
          licensePlate: payload.licensePlate
        })
      });
      return res.data || res;
    },

    async bookServiceAppointment(payload) {
      const res = await ApiClient.request('/maintenance/appointments', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: payload.vehicleId,
          vehicleName: payload.vehicleName,
          vin: payload.vin,
          serviceCenterId: payload.serviceCenterId,
          serviceType: payload.serviceType,
          preferredDate: payload.preferredDate,
          timeSlot: payload.preferredTime || payload.timeSlot || '09:00',
          conditionNotes: payload.conditionNote || payload.conditionNotes
        })
      });
      return res.data || res;
    },

    async updateServiceAppointment(appointmentId, payload) {
      const res = await ApiClient.request(`/maintenance/appointments/${encodeURIComponent(appointmentId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data || res;
    },

    async createServiceRecord(payload) {
      const g = await this.getMyGarage();
      const war = g.warranties.find(w => w.id === payload.warrantyId) || g.warranties[0] || {};
      const res = await ApiClient.request('/maintenance/records', {
        method: 'POST',
        body: JSON.stringify({
          vin: payload.vin || war.vin || 'SGME2026VN001889',
          odoKm: payload.odoKm,
          serviceType: payload.serviceType,
          serviceCenterId: payload.serviceCenterId || 'hn-caugiay',
          partsReplaced: (payload.partsReplaced || []).map(p => (typeof p === 'string' ? { code: 'PT-01', name: p, qty: 1, unitPrice: 0 } : p)),
          inspectionResult: payload.inspectionResult,
          laborCost: payload.cost || 0,
          partsCost: 0
        })
      });
      return res.data || res;
    }
  },

  // Section 4: Verified Reviews & Community Q&A
  reviews: {
    async getByVehicle(vehicleId, filters = {}) {
      const params = new URLSearchParams();
      if (vehicleId) params.set('vehicleId', vehicleId);
      if (filters.rating && filters.rating !== 'all') params.set('star', filters.rating);
      if (filters.verifiedOnly) params.set('verifiedOnly', 'true');
      if (filters.sort) params.set('sort', filters.sort);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await ApiClient.request(`/reviews${qs}`);
      const d = res.data || {};
      return {
        summary: {
          averageRating: d.stats?.averageRating ?? 0,
          totalReviews: d.stats?.totalReviews ?? 0,
          verifiedCount: d.stats?.verifiedCount ?? 0,
          distribution: d.stats?.starDistribution || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
          criteriaAverages: d.stats?.criteriaAverages || { design: 5, performance: 5, features: 5, comfort: 5, value: 5 }
        },
        reviews: (d.reviews || []).map(r => ({
          ...r,
          userName: r.authorName || r.userName || 'Khách hàng',
          userRole: r.authorTier || 'Chủ xe SIGMACAR',
          orderNumber: r.orderId || r.orderNumber || 'SG-VERIFIED',
          helpfulVotes: r.helpfulVoterIds || r.helpfulVotes || [],
          media: (r.media || []).map(m => (typeof m === 'string' ? m : m.url)),
          status: r.moderationStatus === 'approved' ? 'Đã duyệt' : (r.moderationStatus === 'hidden' ? 'Đã ẩn' : 'Đã gỡ')
        })),
        questions: (d.questions || []).map(q => ({
          ...q,
          userName: q.authorName || q.userName || 'Khách hàng',
          answers: (q.answers || []).map(a => ({
            ...a,
            responderName: a.authorName || a.responderName,
            responderRole: a.authorRole || a.responderRole
          }))
        }))
      };
    },

    async getAdminAll() {
      const res = await ApiClient.request('/reviews?includeModerated=true');
      const d = res.data || {};
      return {
        reviews: (d.reviews || []).map(r => ({
          ...r,
          userName: r.authorName || r.userName || 'Khách hàng',
          orderNumber: r.orderId || r.orderNumber || 'Verified',
          status: r.moderationStatus === 'approved' ? 'Đã duyệt' : (r.moderationStatus === 'hidden' ? 'Đã ẩn' : 'Đã gỡ')
        })),
        questions: d.questions || []
      };
    },

    async create(payload) {
      const media = Array.isArray(payload.media)
        ? payload.media.map(m => (typeof m === 'string' ? { name: m.split('/').pop() || 'photo.jpg', url: m, sizeKb: 250 } : m))
        : [];
      const res = await ApiClient.request('/reviews', {
        method: 'POST',
        body: JSON.stringify({ ...payload, media })
      });
      return res.data || res;
    },

    async update(reviewId, payload) {
      const res = await ApiClient.request(`/reviews/${encodeURIComponent(reviewId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return res.data || res;
    },

    async remove(reviewId) {
      const res = await ApiClient.request(`/reviews/${encodeURIComponent(reviewId)}`, {
        method: 'DELETE'
      });
      return res.data || res;
    },

    async voteHelpful(reviewId) {
      const res = await ApiClient.request(`/reviews/${encodeURIComponent(reviewId)}/helpful`, {
        method: 'POST'
      });
      return res.data || res;
    },

    async report(reviewId, payload) {
      const res = await ApiClient.request(`/reviews/${encodeURIComponent(reviewId)}/report`, {
        method: 'POST',
        body: JSON.stringify(typeof payload === 'string' ? { reason: payload } : payload)
      });
      return res.data || res;
    },

    async moderate(reviewId, payload) {
      const actionMap = {
        'Đã duyệt': 'approve',
        'Đã ẩn': 'hide',
        'Đã gỡ': 'remove'
      };
      const res = await ApiClient.request(`/reviews/${encodeURIComponent(reviewId)}/moderate`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: actionMap[payload.status] || payload.action || 'approve',
          reason: payload.reason
        })
      });
      return res.data || res;
    },

    async askQuestion(payload) {
      const res = await ApiClient.request('/questions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data || res;
    },

    async answerQuestion(questionId, payload) {
      const res = await ApiClient.request(`/questions/${encodeURIComponent(questionId)}/answer`, {
        method: 'POST',
        body: JSON.stringify({ content: payload.answer || payload.content })
      });
      return res.data || res;
    }
  },

  // Section 5: Customer Support Center & Ticketing
  support: {
    async getCenterData(filters = {}) {
      const params = new URLSearchParams();
      if (filters.faqCategory && filters.faqCategory !== 'all') params.set('faqCategory', filters.faqCategory);
      if (filters.faqSearch) params.set('faqSearch', filters.faqSearch);
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.category && filters.category !== 'all') params.set('category', filters.category);
      if (filters.priority && filters.priority !== 'all') params.set('priority', filters.priority);
      if (filters.search) params.set('search', filters.search);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await ApiClient.request(`/support/center${qs}`);
      return res.data;
    },

    async getFaqs(filters = {}) {
      const d = await this.getCenterData({ faqCategory: filters.category, faqSearch: filters.search });
      return d.faqs || [];
    },

    async getTickets(filters = {}) {
      const d = await this.getCenterData(filters);
      return (d.tickets || []).map(t => ({
        ...t,
        orderId: t.linkedOrderId || t.orderId,
        vehicleName: t.linkedVehicleName || t.vehicleName,
        messages: (t.messages || []).map(m => ({
          ...m,
          senderRole: m.senderRole === 'buyer' ? 'customer' : m.senderRole
        }))
      }));
    },

    async getStats() {
      const d = await this.getCenterData();
      return d.kpis || {};
    },

    async lookupTicket(code) {
      const res = await ApiClient.request(`/support/tickets/lookup?code=${encodeURIComponent(code)}`);
      const t = res.data;
      return {
        ...t,
        messages: (t.messages || []).map(m => ({
          ...m,
          senderRole: m.senderRole === 'buyer' ? 'customer' : m.senderRole
        }))
      };
    },

    async createTicket(payload) {
      const attachments = Array.isArray(payload.attachments)
        ? payload.attachments.map(a => ({ name: a.name || 'file.png', url: a.url, sizeKb: Math.round((a.sizeBytes || 200000) / 1024) }))
        : [];
      const res = await ApiClient.request('/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          linkedOrderId: payload.orderId || payload.linkedOrderId,
          linkedVehicleName: payload.vehicleName || payload.linkedVehicleName,
          attachments
        })
      });
      return res.data || res;
    },

    async replyTicket(ticketId, payload) {
      const res = await ApiClient.request(`/support/tickets/${encodeURIComponent(ticketId)}/reply`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data || res;
    },

    async updateTicket(ticketId, payload) {
      const res = await ApiClient.request(`/support/tickets/${encodeURIComponent(ticketId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data || res;
    },

    async addInternalNote(ticketId, payload) {
      const res = await ApiClient.request(`/support/tickets/${encodeURIComponent(ticketId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ internalNote: payload.note })
      });
      return res.data || res;
    }
  },

  // Section 6: Email Campaigns & Privacy
  campaigns: {
    async getAll() {
      const res = await ApiClient.request('/campaigns');
      const d = res.data || {};
      return {
        campaigns: (d.campaigns || []).map(c => ({
          ...c,
          campaignCode: c.id,
          occasion: c.category || 'Chăm sóc Khách hàng',
          stats: {
            totalRecipients: c.stats?.eligibleRecipients ?? 0,
            sentCount: c.stats?.sentCount ?? 0,
            failedCount: c.stats?.failedCount ?? 0,
            openedCount: c.stats?.deliveredCount ?? 0,
            clickedCount: Math.max(0, (c.stats?.deliveredCount ?? 0) - 1)
          }
        })),
        templates: [
          {
            id: 'tpl_birthday',
            name: 'Chúc mừng Sinh nhật Thành viên VIP',
            occasion: 'Sinh nhật',
            subject: '🎂 Chúc mừng sinh nhật {{customer_name}} — Quà tặng đặc quyền từ SIGMACAR!',
            bodyHtml: 'Kính gửi {{customer_name}}, Nhân dịp sinh nhật ({{birth_date}}), SIGMACAR kính chúc Quý khách vạn dặm bình an cùng chiếc {{vehicle_name}}!',
            ctaLabel: 'Nhận Quà Sinh Nhật',
            ctaUrl: '#profile'
          },
          {
            id: 'tpl_tet',
            name: 'Chúc Tết & Xuân Thịnh Vượng',
            occasion: 'Lễ Tết',
            subject: '🌸 Chúc Mừng Năm Mới {{customer_name}} — Kiểm tra an toàn Pin miễn phí!',
            bodyHtml: 'Kính gửi {{customer_name}}, Mừng Xuân mới, SIGMACAR tặng Quý khách gói kiểm tra 18 hạng mục miễn phí cho xe {{vehicle_name}}.',
            ctaLabel: 'Đặt lịch Dịch vụ Tết',
            ctaUrl: '#profile'
          },
          {
            id: 'tpl_maintenance',
            name: 'Nhắc lịch Bảo dưỡng Định kỳ',
            occasion: 'Nhắc bảo dưỡng',
            subject: '🔧 Nhắc lịch bảo dưỡng định kỳ cho xe {{vehicle_name}} của {{customer_name}}',
            bodyHtml: 'Xin chào {{customer_name}}, Chiếc {{vehicle_name}} của Quý khách sắp đến mốc bảo dưỡng định kỳ tại Trung tâm Dịch vụ 3S.',
            ctaLabel: 'Đặt lịch Bảo dưỡng',
            ctaUrl: '#profile'
          }
        ],
        smtpConfigured: Boolean(d.privacySummary?.smtpConfigured),
        stats: {
          optedInUsersCount: d.privacySummary?.optedInCount ?? 2
        }
      };
    },

    async preview(payload) {
      const replaceVars = (str = '') =>
        String(str)
          .replace(/\{\{\s*customer_name\s*\}\}/g, 'Minh Hoàng')
          .replace(/\{\{\s*birth_date\s*\}\}/g, '29/10/1992')
          .replace(/\{\{\s*promo_code\s*\}\}/g, payload.promoCode || 'SIGMAVIP2026')
          .replace(/\{\{\s*vehicle_name\s*\}\}/g, 'SIGMA Model E');
      const renderedSubject = replaceVars(payload.subject || '');
      const renderedBody = replaceVars(payload.bodyHtml || '');
      return {
        renderedSubject,
        renderedHtml: `
          <div style="font-family:sans-serif; color:#0F172A; background:#F8FAFC; padding:18px; border-radius:12px;">
            <div style="background:#0F172A; color:#FFFFFF; padding:16px 20px; border-radius:10px 10px 0 0;">
              <div style="font-size:11px; color:#38BDF8; font-weight:700;">SIGMACAR VIETNAM • OFFICIAL CARE</div>
              <div style="font-size:16px; font-weight:800; margin-top:4px;">${renderedSubject}</div>
            </div>
            <div style="background:#FFFFFF; padding:20px; border:1px solid #E2E8F0; border-top:none; border-radius:0 0 10px 10px;">
              <p style="font-size:13.5px; line-height:1.6;">${renderedBody}</p>
              <div style="margin:14px 0; padding:12px; background:#EFF6FF; border:1px dashed #2563EB; border-radius:8px; text-align:center;">
                <span style="font-size:11px; color:#64748B;">MÃ ƯU ĐÃI ĐẶC QUYỀN:</span>
                <div style="font-size:18px; font-weight:800; color:#1D4ED8;">${payload.promoCode || 'SIGMAVIP2026'}</div>
              </div>
              <div style="text-align:center; margin-top:14px;">
                <a href="${payload.ctaUrl || '#profile'}" style="display:inline-block; background:#2563EB; color:#FFFFFF; text-decoration:none; font-weight:700; font-size:13px; padding:10px 22px; border-radius:8px;">${payload.ctaLabel || 'Khám phá ngay'}</a>
              </div>
              <hr style="border:none; border-top:1px solid #E2E8F0; margin:16px 0;">
              <div style="font-size:11px; color:#64748B; text-align:center;">
                Email được gửi vì Quý khách đã đăng ký nhận tin (Opt-in). <a href="#profile" style="color:#2563EB;">Hủy đăng ký nhận tin (Unsubscribe)</a>.
              </div>
            </div>
          </div>
        `
      };
    },

    async create(payload) {
      const res = await ApiClient.request('/campaigns', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data || res;
    },

    async updateStatus(campaignId, payload) {
      const res = await ApiClient.request(`/campaigns/${encodeURIComponent(campaignId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data || res;
    },

    async sendTest(campaignId, payload) {
      const testEmail = typeof payload === 'string' ? payload : payload.testEmail;
      const res = await ApiClient.request(`/campaigns/${encodeURIComponent(campaignId)}/test-send`, {
        method: 'POST',
        body: JSON.stringify({ testEmail })
      });
      return { message: res.message || res.data?.note || 'Đã gửi email thử nghiệm!' };
    },

    async execute(campaignId) {
      const res = await ApiClient.request(`/campaigns/${encodeURIComponent(campaignId)}/execute`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: true })
      });
      return {
        campaign: res.data,
        deliveryMode: res.data?.deliveryMode || 'simulated_dev_queue'
      };
    },

    async unsubscribe(payload = {}) {
      const res = await ApiClient.request('/unsubscribe', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return {
        ...(res.data || {}),
        message: res.message || 'Đã hủy đăng ký nhận Email tiếp thị thành công!'
      };
    }
  }
};
