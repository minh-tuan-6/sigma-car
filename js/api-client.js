// js/api-client.js
// Centralized API Client with session persistence, abort timeout & strict live/static separation

const API_BASE = (typeof window !== 'undefined' && (window.SIGMACAR_API_BASE || localStorage.getItem('sigmacar_api_base'))) || '/api/v1';

function escapeHtmlClient(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeSafeUrlClient(url, fallback = '#profile') {
  const s = String(url || '').trim();
  if (!s) return fallback;
  if (s.startsWith('#') || (s.startsWith('/') && !s.startsWith('//'))) return s;
  try {
    const parsed = new URL(s);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return s;
  } catch (_) {}
  return fallback;
}

const ApiClient = {
  isDemoMode() {
    try {
      return localStorage.getItem('sigmacar_demo_mode') === 'true';
    } catch (_) {
      return false;
    }
  },

  staticHostDetected: false,

  // Last reason the live API was considered unavailable ({ code, status }), for diagnostics UI.
  lastBackendIssue: null,

  // Error codes emitted by the Pages Function proxy when the backend itself is unavailable.
  PROXY_OUTAGE_CODES: ['BACKEND_NOT_CONFIGURED', 'BACKEND_ORIGIN_INVALID', 'BACKEND_UNREACHABLE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_INVALID_RESPONSE'],

  getApiBase() {
    return API_BASE;
  },

  // Probes GET /health and classifies the result. Never throws.
  // → { status: 'online' | 'static-host' | 'proxy-outage' | 'offline' | 'error', code?, httpStatus?, data? }
  async checkHealth(timeoutMs = 6000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(`${API_BASE}/health`, { headers: { Accept: 'application/json' }, signal: controller ? controller.signal : undefined });
      const ctype = res.headers.get('content-type') || '';
      if (ctype.includes('text/html')) return { status: 'static-host', code: 'STATIC_HOST_NO_API', httpStatus: res.status };
      const proxyCode = res.headers.get('x-sigma-proxy-error');
      if (proxyCode) return { status: 'proxy-outage', code: proxyCode, httpStatus: res.status };
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (res.ok && data && data.success && data.data && data.data.status === 'ok') {
        return { status: 'online', httpStatus: res.status, data: data.data };
      }
      return { status: 'error', code: (data && data.error && data.error.code) || 'INVALID_HEALTH_RESPONSE', httpStatus: res.status };
    } catch (err) {
      return { status: 'offline', code: err && err.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  setDemoMode(enabled) {
    try {
      const next = Boolean(enabled);
      if (next) localStorage.setItem('sigmacar_demo_mode', 'true');
      else localStorage.removeItem('sigmacar_demo_mode');
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('sigmacar:demo-mode-changed', { detail: { enabled: next } }));
      }
    } catch (_) {}
  },

  // Isolated session token storage (demo sandbox keys kept strictly separate from live API keys)
  getToken() {
    const key = this.isDemoMode() ? 'sigmacar_demo_auth_token' : 'sigmacar_auth_token';
    return localStorage.getItem(key) || null;
  },

  setToken(token) {
    const key = this.isDemoMode() ? 'sigmacar_demo_auth_token' : 'sigmacar_auth_token';
    if (token) {
      localStorage.setItem(key, token);
    } else {
      localStorage.removeItem(key);
    }
  },

  getCurrentUser() {
    try {
      const key = this.isDemoMode() ? 'sigmacar_demo_user' : 'sigmacar_user';
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  setCurrentUser(user) {
    const key = this.isDemoMode() ? 'sigmacar_demo_user' : 'sigmacar_user';
    if (user) {
      localStorage.setItem(key, JSON.stringify(user));
    } else {
      localStorage.removeItem(key);
    }
  },

  // Central HTTP request handler with AbortController timeout and zero fake fallback in Live Mode
  async request(endpoint, options = {}) {
    if (this.isDemoMode() && !options.forceLive) {
      return this.handleStaticFallback(endpoint, options);
    }

    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const timeoutMs = options.timeoutMs || 15000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const fetchOpts = { ...options, headers };
      if (controller && !options.signal) {
        fetchOpts.signal = controller.signal;
      }
      const res = await fetch(url, fetchOpts);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html') && res.ok) {
        // Static CDN SPA rewrite returned index.html instead of an API server
        this.lastBackendIssue = { code: 'STATIC_HOST_NO_API', status: res.status };
        return this.handleStaticFallback(endpoint, options);
      }

      // The Cloudflare Pages Function proxy (functions/api/v1/[[path]].js) is up but the backend is not:
      // degrade exactly like a static host (public reads from the bundled catalog, writes fail loudly).
      const proxyErrorCode = res.headers.get('x-sigma-proxy-error');
      if (proxyErrorCode && this.PROXY_OUTAGE_CODES.includes(proxyErrorCode)) {
        this.lastBackendIssue = { code: proxyErrorCode, status: res.status };
        return this.handleStaticFallback(endpoint, options);
      }

      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = null;
        }
      }

      if (!data) {
        if (res.status === 404 || res.status === 405) {
          // Pure static hosting (e.g. Cloudflare Pages) without Node backend
          return this.handleStaticFallback(endpoint, options);
        }
        const err = new Error(`Máy chủ phản hồi không đúng định dạng (${res.status}).`);
        err.status = res.status;
        err.code = 'INVALID_SERVER_RESPONSE';
        throw err;
      }

      if (!res.ok || data.success === false) {
        const errorMsg = data.error?.message || `Lỗi máy chủ (${res.status})`;
        const err = new Error(errorMsg);
        err.status = res.status;
        err.code = data.error?.code || 'API_ERROR';
        throw err;
      }

      return data;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const timeoutErr = new Error('Kết nối tới máy chủ quá thời gian chờ. Vui lòng thử lại.');
        timeoutErr.code = 'REQUEST_TIMEOUT';
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      if (err && (err.status || err.code === 'API_ERROR')) {
        throw err;
      }
      const isNetworkOffline = err && err.message && (
        err.message.includes('Failed to fetch') ||
        err.message.includes('NetworkError') ||
        err.message.includes('Load failed') ||
        err.name === 'TypeError'
      );
      if (isNetworkOffline) {
        return this.handleStaticFallback(endpoint, options);
      }
      console.warn(`[ApiClient Error] ${options.method || 'GET'} ${url}:`, err.message);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  // Read-only static catalog + opt-in local demo sandbox ONLY when explicitly running without backend
  handleStaticFallback(endpoint, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const path = endpoint.split('?')[0];
    let body = {};
    if (options.body) {
      try { body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body; } catch (e) {}
    }

    this.staticHostDetected = true;
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('sigmacar:static-host-detected', { detail: { endpoint: path, method } }));
      }
    } catch (_) {}

    const staticData = (typeof SIGMA_DATA !== 'undefined' && SIGMA_DATA)
      ? SIGMA_DATA
      : ((typeof window !== 'undefined' && window.SIGMA_DATA) ? window.SIGMA_DATA : { cars: [], certifiedCars: [] });

    // Read-only public endpoints allowed on static CDN hosting
    if (method === 'GET' && endpoint.startsWith('/vehicles/certified')) {
      const list = (staticData.certifiedCars || []).map(c => ({ isCertified: true, type: 'certified', stock: c.stock ?? 1, ...c }));
      return { success: true, staticReadOnly: true, data: list };
    }
    if (method === 'GET' && endpoint.startsWith('/vehicles/') && endpoint.endsWith('/related')) {
      const targetId = decodeURIComponent(endpoint.replace('/vehicles/', '').replace('/related', '').split('?')[0]);
      const all = staticData.cars || [];
      const cur = all.find(c => c.id === targetId);
      const rel = cur ? all.filter(c => c.id !== cur.id && c.category === cur.category).slice(0, 3) : all.slice(0, 3);
      return { success: true, staticReadOnly: true, data: rel };
    }
    if (method === 'GET' && endpoint.startsWith('/vehicles/')) {
      const targetId = decodeURIComponent(endpoint.replace('/vehicles/', '').split('?')[0]);
      const all = [
        ...(staticData.cars || []),
        ...(staticData.certifiedCars || []).map(c => ({ isCertified: true, type: 'certified', stock: c.stock ?? 1, ...c }))
      ];
      const found = all.find(c => c.id === targetId || c.id === targetId.replace(/^sigma-/, ''));
      if (!found) {
        const err = new Error(`Không tìm thấy thông tin xe với mã "${targetId}".`);
        err.status = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      return { success: true, staticReadOnly: true, data: found };
    }
    if (method === 'GET' && endpoint.startsWith('/vehicles')) {
      const cars = staticData.cars || [];
      return {
        success: true,
        staticReadOnly: true,
        data: cars,
        pagination: { page: 1, pageSize: Math.max(12, cars.length), total: cars.length, totalPages: 1, hasMore: false }
      };
    }
    if (method === 'GET' && endpoint.startsWith('/promotions')) {
      return {
        success: true,
        staticReadOnly: true,
        data: [
          { id: 'promo_sigma50', code: 'SIGMA50', name: 'Ưu đãi đặt cọc Tiên phong 50 triệu VNĐ', discountType: 'fixed', discountValue: 50000000, minOrderValue: 1000000000 },
          { id: 'promo_evgreen5', code: 'EVGREEN5', name: 'Ưu đãi Xe Thuần Điện 5% (tối đa 30 triệu)', discountType: 'percent', discountValue: 5, maxDiscountAmount: 30000000, minOrderValue: 300000000 }
        ]
      };
    }
    if (method === 'POST' && endpoint.startsWith('/financing/calculate')) {
      const price = Number(body.vehiclePrice);
      const downPercent = body.downPaymentPercent !== undefined ? Number(body.downPaymentPercent) : 30;
      const rate = body.annualInterestRatePercent !== undefined ? Number(body.annualInterestRatePercent) : 7.9;
      const months = body.termMonths !== undefined ? Number(body.termMonths) : 60;
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(downPercent) || downPercent < 0 || downPercent >= 100 || !Number.isFinite(rate) || rate < 0 || !Number.isInteger(months) || months < 1) {
        const err = new Error('Thông số tính toán trả góp không hợp lệ.');
        err.status = 400;
        throw err;
      }
      const downPaymentAmount = Math.round(price * (downPercent / 100));
      const financedPrincipal = price - downPaymentAmount;
      const monthlyRate = (rate / 100) / 12;
      const monthlyPayment = monthlyRate === 0
        ? Math.round(financedPrincipal / months)
        : Math.round(financedPrincipal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1));
      return {
        success: true,
        staticReadOnly: true,
        data: {
          vehiclePrice: price,
          downPaymentPercent: downPercent,
          downPaymentAmount,
          financedPrincipal,
          annualInterestRate: rate,
          termMonths: months,
          monthlyPayment,
          totalInterest: Math.max(0, (monthlyPayment * months) - financedPrincipal),
          totalCostOfLoan: price + Math.max(0, (monthlyPayment * months) - financedPrincipal)
        }
      };
    }

    const sandbox = typeof window !== 'undefined'
      ? window.SigmaStaticSandbox
      : (typeof globalThis !== 'undefined' ? globalThis.SigmaStaticSandbox : null);
    if (sandbox && typeof sandbox.handlePublic === 'function') {
      const publicResult = sandbox.handlePublic(endpoint, options, this);
      if (publicResult) return publicResult;
    }

    if (path === '/auth/me' && method === 'GET') {
      const cur = this.getCurrentUser();
      if (!cur || !this.getToken()) {
        const err = new Error('Phiên đăng nhập chưa được kích hoạt.');
        err.status = 401;
        err.code = 'UNAUTHORIZED';
        throw err;
      }
      if (this.isDemoMode()) {
        return { success: true, demoMode: true, data: cur };
      }
      const err = new Error('Không thể xác thực phiên làm việc với máy chủ.');
      err.status = 503;
      err.code = 'BACKEND_UNAVAILABLE';
      throw err;
    }

    // Write/Auth/Private routes NEVER silently spoof success unless user explicitly opted into Sandbox Demo Mode
    if (!this.isDemoMode()) {
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('sigmacar:backend-unavailable', { detail: { endpoint: path, method } }));
        }
      } catch (_) {}
      const err = new Error('Không thể kết nối tới máy chủ API SIGMACAR. Website hiện đang chạy ở chế độ xem tĩnh (Static Read-Only).');
      err.status = 503;
      err.code = 'BACKEND_UNAVAILABLE';
      throw err;
    }

    if (sandbox && typeof sandbox.handleDemo === 'function') {
      return sandbox.handleDemo(endpoint, options, this);
    }

    // Opt-in local demo sandbox fallback (strictly namespaced under sigmacar_demo_*, never bypasses role or password)
    if (endpoint === '/auth/login' && method === 'POST') {
      const email = (body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const demoAccounts = {
        'admin@sigmacar.vn': { pass: 'Admin@123456', user: { id: 'usr_admin_01', email: 'admin@sigmacar.vn', fullName: 'Hệ Thống Quản Trị SIGMACAR', role: 'admin', branchId: 'all', branchIds: ['hn-caugiay', 'hcm-q7'], savedCars: [] } },
        'minhphan.seller@sigmacar.vn': { pass: 'Seller@123456', user: { id: 'usr_seller_01', email: 'minhphan.seller@sigmacar.vn', fullName: 'Minh Phan - Tư vấn SIGMACAR', role: 'seller', branchId: 'hn-caugiay', branchIds: ['hn-caugiay'], savedCars: [] } },
        'minhhoang.sigma@example.com': { pass: 'Buyer@123456', user: { id: 'usr_buyer_01', email: 'minhhoang.sigma@example.com', fullName: 'Minh Hoàng', role: 'buyer', savedCars: [] } }
      };
      const matched = demoAccounts[email];
      if (!matched || matched.pass !== password) {
        const err = new Error('Email hoặc mật khẩu không chính xác (Sandbox Demo Mode).');
        err.status = 401;
        throw err;
      }
      const token = 'demo_token_' + Date.now();
      this.setToken(token);
      this.setCurrentUser({ ...matched.user, isDemoSandbox: true });
      return { success: true, demoMode: true, data: { token, user: matched.user } };
    }

    const err = new Error('Thao tác này yêu cầu kết nối trực tiếp với máy chủ backend SIGMACAR.');
    err.status = 503;
    err.code = 'BACKEND_UNAVAILABLE';
    throw err;
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

    async logout() {
      try {
        if (ApiClient.getToken() && !ApiClient.isDemoMode()) {
          await ApiClient.request('/auth/logout', { method: 'POST', timeoutMs: 3000 });
        }
      } catch (_) {
        // Ignore network errors when tearing down local session
      } finally {
        ApiClient.setToken(null);
        ApiClient.setCurrentUser(null);
      }
    }
  },

  // Vehicles Methods
  vehicles: {
    async getAll(filters = {}) {
      const params = new URLSearchParams();
      if (filters.category && filters.category !== 'all') params.set('category', filters.category);
      if (filters.fuel && filters.fuel !== 'all') params.set('fuel', filters.fuel);
      if (filters.brand && filters.brand !== 'all') params.set('brand', filters.brand);
      if (filters.minPrice) params.set('minPrice', filters.minPrice);
      if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
      if (filters.minRange) params.set('minRange', filters.minRange);
      if (filters.maxRange) params.set('maxRange', filters.maxRange);
      if (filters.minBatteryKwh) params.set('minBatteryKwh', filters.minBatteryKwh);
      if (filters.maxMonthlyPayment) params.set('maxMonthlyPayment', filters.maxMonthlyPayment);
      if (filters.usage && filters.usage !== 'all') params.set('usage', filters.usage);
      if (filters.inStock) params.set('inStock', 'true');
      if (filters.search) params.set('search', filters.search);
      if (filters.sort && filters.sort !== 'default') params.set('sort', filters.sort);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await ApiClient.request(`/vehicles${qs}`);
      return res.data || [];
    },

    async query(filters = {}, requestOpts = {}) {
      const params = new URLSearchParams();
      if (filters.category && filters.category !== 'all') params.set('category', filters.category);
      if (filters.fuel && filters.fuel !== 'all') params.set('fuel', filters.fuel);
      if (filters.brand && filters.brand !== 'all') params.set('brand', filters.brand);
      if (filters.minPrice) params.set('minPrice', filters.minPrice);
      if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
      if (filters.minRange) params.set('minRange', filters.minRange);
      if (filters.maxRange) params.set('maxRange', filters.maxRange);
      if (filters.minBatteryKwh) params.set('minBatteryKwh', filters.minBatteryKwh);
      if (filters.maxMonthlyPayment) params.set('maxMonthlyPayment', filters.maxMonthlyPayment);
      if (filters.usage && filters.usage !== 'all') params.set('usage', filters.usage);
      if (filters.inStock) params.set('inStock', 'true');
      if (filters.search) params.set('search', filters.search);
      if (filters.sort && filters.sort !== 'default') params.set('sort', filters.sort);
      params.set('paginated', '1');
      params.set('page', String(filters.page || 1));
      params.set('pageSize', String(filters.pageSize || 12));

      const res = await ApiClient.request(`/vehicles?${params.toString()}`, requestOpts);
      return { items: res.data || [], pagination: res.pagination || { page: 1, pageSize: 12, total: (res.data || []).length, totalPages: 1, hasMore: false } };
    },

    async getRelated(id) {
      const res = await ApiClient.request(`/vehicles/${encodeURIComponent(id)}/related`);
      return res.data || [];
    },

    async create(payload) {
      const res = await ApiClient.request('/vehicles', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
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
    },

    async update(id, payload) {
      const res = await ApiClient.request(`/vehicles/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  // Financing Calculator & Applications
  financing: {
    async calculate({ vehiclePrice, downPaymentPercent, annualInterestRatePercent, termMonths, repaymentMethod, includeSchedule, monthlyIncome, monthlyObligation }) {
      const res = await ApiClient.request('/financing/calculate', {
        method: 'POST',
        body: JSON.stringify({
          vehiclePrice,
          downPaymentPercent,
          annualInterestRatePercent,
          termMonths,
          repaymentMethod,
          includeSchedule,
          monthlyIncome,
          monthlyObligation
        })
      });
      return res.data;
    },
    async submitApplication(payload) {
      const res = await ApiClient.request('/financing/applications', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async getApplications() {
      const res = await ApiClient.request('/financing/applications');
      return res.data || [];
    },
    async reviewApplication(id, payload) {
      const res = await ApiClient.request(`/financing/applications/${encodeURIComponent(id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
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

    async getById(orderId) {
      const res = await ApiClient.request(`/orders/${encodeURIComponent(orderId)}`);
      return res.data;
    },

    async getTimeline(orderId) {
      const res = await ApiClient.request(`/orders/${encodeURIComponent(orderId)}/timeline`);
      return res.data;
    },

    async updateStatus(orderId, status, note = '') {
      const res = await ApiClient.request(`/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note })
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

  // Test Drive Appointments & Dynamic Slots
  appointments: {
    async getSlots({ branchId, date, category = 'test_drive' } = {}) {
      const params = new URLSearchParams();
      if (branchId) params.set('branchId', branchId);
      if (date) params.set('date', date);
      if (category) params.set('category', category);
      const res = await ApiClient.request(`/appointments/slots?${params.toString()}`);
      return res.data;
    },

    async reschedule(apptId, payload) {
      const res = await ApiClient.request(`/appointments/${encodeURIComponent(apptId)}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
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

  // Analytics Overview, Funnel & CSV Export (Seller / Admin - SIG-P4-006, SIG-P4-007)
  analytics: {
    async getOverview(params = {}) {
      const qs = new URLSearchParams();
      ['branchId', 'dateFrom', 'dateTo', 'tzOffsetMinutes'].forEach(k => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '' && params[k] !== 'all') {
          qs.set(k, String(params[k]));
        }
      });
      const qStr = qs.toString() ? `?${qs.toString()}` : '';
      const res = await ApiClient.request(`/analytics/overview${qStr}`);
      return res.data;
    },
    async getFunnel(params = {}) {
      const qs = new URLSearchParams();
      ['branchId', 'dateFrom', 'dateTo', 'promoCode'].forEach(k => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '' && params[k] !== 'all') {
          qs.set(k, String(params[k]));
        }
      });
      const qStr = qs.toString() ? `?${qs.toString()}` : '';
      const res = await ApiClient.request(`/analytics/funnel${qStr}`);
      return res.data;
    },
    async exportCsv(params = {}) {
      const qs = new URLSearchParams();
      ['branchId', 'dateFrom', 'dateTo', 'tzOffsetMinutes'].forEach(k => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '' && params[k] !== 'all') {
          qs.set(k, String(params[k]));
        }
      });
      const qStr = qs.toString() ? `?${qs.toString()}` : '';
      const headers = {};
      const token = ApiClient.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const base = (ApiClient.BASE_URL || '/api/v1').replace(/\/$/, '');
      const resp = await fetch(`${base}/analytics/export${qStr}`, { headers });
      if (!resp.ok) throw new Error('Không thể xuất báo cáo CSV doanh thu.');
      return await resp.text();
    },
    async recordEvent(payload = {}) {
      try {
        const consentGranted = typeof localStorage !== 'undefined'
          ? localStorage.getItem('sigmacar_analytics_consent') !== 'false'
          : true;
        const sidKey = 'sigmacar_funnel_sid';
        let sessionId = payload.sessionId;
        if (!sessionId && typeof sessionStorage !== 'undefined') {
          sessionId = sessionStorage.getItem(sidKey);
          if (!sessionId) {
            sessionId = `sid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            sessionStorage.setItem(sidKey, sessionId);
          }
        }
        const res = await ApiClient.request('/analytics/events', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: sessionId || 'anon-web',
            eventType: payload.eventType,
            targetId: payload.targetId || null,
            branchId: payload.branchId || null,
            promoCode: payload.promoCode || null,
            consentGranted
          })
        });
        return res.data;
      } catch (_) {
        return { recorded: false };
      }
    }
  },

  // AI Chat, Consultation Persistence & Live RAG Engine
  ai: {
    async chat(messageOrPayload, history = []) {
      const payload = (messageOrPayload && typeof messageOrPayload === 'object' && !Array.isArray(messageOrPayload))
        ? messageOrPayload
        : { message: messageOrPayload, history };
      const res = await ApiClient.request('/ai/chat', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },

    async getPreferences() {
      const res = await ApiClient.request('/ai/preferences');
      return res.data;
    },

    async updatePreferences(prefs) {
      const res = await ApiClient.request('/ai/preferences', {
        method: 'PUT',
        body: JSON.stringify(prefs || {})
      });
      return res.data;
    },

    async getConversations(params = {}) {
      const qs = new URLSearchParams();
      if (params.limit) qs.set('limit', params.limit);
      if (params.offset) qs.set('offset', params.offset);
      const q = qs.toString() ? `?${qs.toString()}` : '';
      const res = await ApiClient.request(`/ai/conversations${q}`);
      return res.data;
    },

    async createConversation(payload = {}) {
      const res = await ApiClient.request('/ai/conversations', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },

    async getConversationMessages(conversationId, params = {}) {
      const qs = new URLSearchParams();
      if (params.limit) qs.set('limit', params.limit);
      if (params.offset) qs.set('offset', params.offset);
      const q = qs.toString() ? `?${qs.toString()}` : '';
      const res = await ApiClient.request(`/ai/conversations/${encodeURIComponent(conversationId)}/messages${q}`);
      return res.data;
    },

    async deleteConversation(conversationId) {
      const res = await ApiClient.request(`/ai/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'DELETE'
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

    async createStaff(staffData) {
      const res = await ApiClient.request('/admin/users', {
        method: 'POST',
        body: JSON.stringify(staffData)
      });
      return res.data;
    },

    async deleteUser(userId) {
      const res = await ApiClient.request(`/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE'
      });
      return res.data;
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

    async estimate({ orderId, reasonCode, reasonId, odoKm, currentOdoKm }) {
      const reasonMap = {
        technical_defect: 'tech_issue',
        delivery_damage: 'mismatch_spec',
        wrong_spec: 'mismatch_spec',
        change_of_mind: 'exchange_model'
      };
      const mappedReason = reasonMap[reasonCode] || reasonId || reasonCode || 'tech_issue';
      const params = new URLSearchParams({
        orderId: String(orderId || ''),
        reasonId: String(mappedReason),
        currentOdoKm: String(currentOdoKm ?? odoKm ?? 0)
      });
      const res = await ApiClient.request(`/returns/estimate?${params.toString()}`);
      const d = res.data || res;
      const fin = d.financials || {};
      const deductions = [];
      if (Number(fin.inspectionFee || 0) > 0) {
        deductions.push({ name: 'Phí kiểm định & lưu kho', amount: Number(fin.inspectionFee) });
      }
      if (Number(fin.transportFee || 0) > 0) {
        deductions.push({ name: 'Phí thu hồi vận chuyển', amount: Number(fin.transportFee) });
      }
      if (Number(fin.odoDeduction || 0) > 0) {
        deductions.push({ name: 'Phụ phí ODO vượt mức', amount: Number(fin.odoDeduction) });
      }
      return {
        basePaidAmount: Number(fin.originalPaidAmount || 0),
        deductions,
        totalDeductions: Number(fin.totalDeductions || 0),
        estimatedRefundAmount: Number(fin.estimatedRefundAmount || 0),
        eligibility: d.eligibility || null,
        policy: d.policy || null
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
      const inWorkshopStatuses = ['Đang xử lý', 'Đang kiểm tra', 'Đang bảo dưỡng', 'In Progress'];
      const activeAppts = (g.serviceAppointments || []).filter(a => inWorkshopStatuses.includes(a.status)).length;
      const pendingAppts = (g.serviceAppointments || []).filter(a => a.status === 'Chờ xác nhận' || a.status === 'Pending').length;
      const activeWarranties = (g.warranties || []).filter(w => (w.status || '').includes('hiệu lực') || w.status === 'Active').length;
      return {
        stats: {
          vehiclesInWorkshop: activeAppts,
          pendingAppointments: pendingAppts,
          activeWarranties: activeWarranties || (g.warranties || []).length,
          warrantyClaimsActive: (g.warranties || []).filter(w => w.status === 'Claim').length,
          csatScore: g.kpis?.csatScore ?? 'Chưa có đánh giá'
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
          criteriaAverages: d.stats?.criteriaAverages || { design: 0, performance: 0, features: 0, comfort: 0, value: 0 }
        },
        reviews: (d.reviews || []).map(r => ({
          ...r,
          userName: r.authorName || r.userName || 'Khách hàng',
          userRole: r.authorTier || 'Chủ xe SIGMACAR',
          orderNumber: r.orderId || r.orderNumber || (r.verifiedPurchase ? 'SG-VERIFIED' : ''),
          helpfulCount: typeof r.helpfulCount === 'number' ? r.helpfulCount : (Array.isArray(r.helpfulVoterIds) ? r.helpfulVoterIds.length : 0),
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
    },

    async updateQuestion(questionId, payload) {
      const res = await ApiClient.request(`/questions/${encodeURIComponent(questionId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return res.data || res;
    },

    async removeQuestion(questionId) {
      const res = await ApiClient.request(`/questions/${encodeURIComponent(questionId)}`, { method: 'DELETE' });
      return res.data || res;
    },

    async reportQuestion(questionId, reason) {
      const res = await ApiClient.request(`/questions/${encodeURIComponent(questionId)}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      return res.data || res;
    },

    async moderateQuestion(questionId, payload) {
      const res = await ApiClient.request(`/questions/${encodeURIComponent(questionId)}/moderate`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
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
    },

    async rate(ticketId, payload) {
      const res = await ApiClient.request(`/support/tickets/${encodeURIComponent(ticketId)}/rate`, {
        method: 'POST',
        body: JSON.stringify(payload)
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
            queuedCount: c.stats?.queuedCount ?? 0,
            sentCount: c.stats?.sentCount ?? 0,
            deliveredCount: c.stats?.deliveredCount ?? 0,
            bouncedCount: c.stats?.bouncedCount ?? 0,
            failedCount: c.stats?.failedCount ?? 0,
            skippedUnsubscribedCount: c.stats?.skippedUnsubscribedCount ?? 0,
            openedCount: c.stats?.deliveredCount ?? 0,
            clickedCount: c.stats?.clickedCount ?? 0
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
      const promoSafe = escapeHtmlClient(payload.promoCode || 'SIGMAVIP2026');
      const replaceVarsEscaped = (str = '') =>
        escapeHtmlClient(String(str))
          .replace(/\{\{\s*customer_name\s*\}\}/g, 'Minh Hoàng')
          .replace(/\{\{\s*birth_date\s*\}\}/g, '29/10/1992')
          .replace(/\{\{\s*promo_code\s*\}\}/g, promoSafe)
          .replace(/\{\{\s*vehicle_name\s*\}\}/g, 'Toyota Camry 2.5Q');
      const renderedSubject = replaceVarsEscaped(payload.subject || '');
      const renderedBody = replaceVarsEscaped(payload.bodyHtml || '').replace(/\n/g, '<br>');
      const safeCtaUrl = sanitizeSafeUrlClient(payload.ctaUrl, '#profile');
      const safeCtaLabel = escapeHtmlClient(payload.ctaLabel || 'Khám phá ngay');
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
                <div style="font-size:18px; font-weight:800; color:#1D4ED8;">${promoSafe}</div>
              </div>
              <div style="text-align:center; margin-top:14px;">
                <a href="${escapeHtmlClient(safeCtaUrl)}" style="display:inline-block; background:#2563EB; color:#FFFFFF; text-decoration:none; font-weight:700; font-size:13px; padding:10px 22px; border-radius:8px;">${safeCtaLabel}</a>
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
  },

  // Per-Branch Inventory Ledger
  inventory: {
    async getByVehicle(vehicleId) {
      const res = await ApiClient.request(`/inventory/${encodeURIComponent(vehicleId)}`);
      return res.data;
    },
    async getAll(params = {}) {
      const qs = new URLSearchParams();
      if (params.branchId) qs.set('branchId', params.branchId);
      if (params.vehicleId) qs.set('vehicleId', params.vehicleId);
      const qStr = qs.toString() ? `?${qs.toString()}` : '';
      const res = await ApiClient.request(`/inventory${qStr}`);
      return res.data || [];
    },
    async adjust(vehicleId, payload) {
      const res = await ApiClient.request(`/inventory/${encodeURIComponent(vehicleId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  // Promotions & Pricing Quotes
  promotions: {
    async list(activeOnly = true) {
      const res = await ApiClient.request(`/promotions?activeOnly=${activeOnly ? 'true' : 'false'}`);
      return res.data || [];
    },
    async validate(payload) {
      const res = await ApiClient.request('/promotions/validate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async create(payload) {
      const res = await ApiClient.request('/promotions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  quotes: {
    async create(payload) {
      const res = await ApiClient.request('/quotes', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  // Persistent Cart + Guest LocalStorage Draft Helpers
  cart: {
    GUEST_DRAFT_KEY: 'sigmacar_guest_cart_draft_v1',

    getGuestDraft() {
      try {
        const raw = localStorage.getItem(this.GUEST_DRAFT_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    },

    saveGuestDraft(items) {
      try {
        localStorage.setItem(this.GUEST_DRAFT_KEY, JSON.stringify(Array.isArray(items) ? items : []));
      } catch (e) {}
      return items;
    },

    clearGuestDraft() {
      try { localStorage.removeItem(this.GUEST_DRAFT_KEY); } catch (e) {}
    },

    addGuestDraftItem(item) {
      const draft = this.getGuestDraft();
      const idx = draft.findIndex(d =>
        (d.itemType || 'vehicle') === (item.itemType || 'vehicle') &&
        d.itemId === item.itemId &&
        (d.colorName || null) === (item.colorName || null) &&
        (d.trimName || null) === (item.trimName || null)
      );
      if (idx >= 0) {
        if ((item.itemType || 'vehicle') !== 'certified') {
          draft[idx].quantity = Math.min(20, (draft[idx].quantity || 1) + (item.quantity || 1));
        }
      } else {
        draft.push({ ...item, lineId: item.lineId || `guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, quantity: item.quantity || 1 });
      }
      this.saveGuestDraft(draft);
      return draft;
    },

    async get() {
      const res = await ApiClient.request('/cart');
      return res.data;
    },
    async addItem(payload) {
      const res = await ApiClient.request('/cart/items', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async addBundle(bundleQuoteId, expectedVersion = null) {
      const payload = { bundleQuoteId };
      if (expectedVersion !== undefined && expectedVersion !== null) payload.expectedVersion = expectedVersion;
      const res = await ApiClient.request('/cart/bundle', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async updateItem(lineId, payload) {
      const res = await ApiClient.request(`/cart/items/${encodeURIComponent(lineId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async updateMeta(payload) {
      const res = await ApiClient.request('/cart', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async removeItem(lineId, expectedVersion) {
      const qs = expectedVersion !== undefined ? `?expectedVersion=${encodeURIComponent(expectedVersion)}` : '';
      const res = await ApiClient.request(`/cart/items/${encodeURIComponent(lineId)}${qs}`, {
        method: 'DELETE'
      });
      return res.data;
    },
    async applyPromo(code, expectedVersion) {
      const res = await ApiClient.request('/cart/promo', {
        method: 'POST',
        body: JSON.stringify({ code, expectedVersion })
      });
      return res.data;
    },
    async mergeGuestDraftOnLogin() {
      const draft = this.getGuestDraft();
      if (!draft || draft.length === 0 || !ApiClient.getToken()) return null;
      const res = await ApiClient.request('/cart/merge', {
        method: 'POST',
        body: JSON.stringify({ items: draft })
      });
      this.clearGuestDraft();
      return res.data;
    },
    async clear() {
      const res = await ApiClient.request('/cart', { method: 'DELETE' });
      return res.data;
    }
  },

  // Atomic Checkout & Payment Intents
  checkout: {
    async submit(payload, idempotencyKey) {
      const headers = {};
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      const res = await ApiClient.request('/checkout', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, idempotencyKey })
      });
      return res.data;
    }
  },

  payments: {
    async createIntent(payload, idempotencyKey) {
      const headers = {};
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      const res = await ApiClient.request('/payments/intents', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, idempotencyKey })
      });
      return res.data;
    },
    async getHistory(orderId) {
      const res = await ApiClient.request(`/payments/intents/${encodeURIComponent(orderId)}`);
      return res.data;
    },
    async simulateSandbox(payload) {
      const res = await ApiClient.request('/payments/sandbox/simulate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  // P2: Private Media, Policies, Order Timeline, Registration, Handover, Refunds, Contracts, Garage, Notifications & Support CSAT
  media: {
    async upload(payload) {
      const res = await ApiClient.request('/media/upload', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async getSignedUrl(mediaId) {
      const res = await ApiClient.request(`/media/${encodeURIComponent(mediaId)}/sign`);
      return res.data;
    },
    async remove(mediaId) {
      const res = await ApiClient.request(`/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
      return res.data;
    }
  },

  policies: {
    async getActive() {
      const res = await ApiClient.request('/policies');
      return res.data;
    }
  },

  registration: {
    async estimate(payload) {
      const res = await ApiClient.request('/registration/estimate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async listCases() {
      const res = await ApiClient.request('/registration/cases');
      return res.data || [];
    },
    async saveCase(payload) {
      const res = await ApiClient.request('/registration/cases', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async submitCase(caseId) {
      const res = await ApiClient.request(`/registration/cases/${encodeURIComponent(caseId)}/submit`, {
        method: 'POST'
      });
      return res.data;
    },
    async updateStatus(caseId, payload) {
      const res = await ApiClient.request(`/registration/cases/${encodeURIComponent(caseId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  handovers: {
    async execute(payload) {
      const res = await ApiClient.request('/handovers', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async list() {
      const res = await ApiClient.request('/handovers');
      return res.data || [];
    }
  },

  refunds: {
    async list() {
      const res = await ApiClient.request('/refunds');
      return res.data || [];
    },
    async execute(payload, idempotencyKey = null) {
      const headers = {};
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      const res = await ApiClient.request('/refunds', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, idempotencyKey })
      });
      return res.data;
    }
  },

  garage: {
    async get() {
      const res = await ApiClient.request('/garage');
      return res.data;
    }
  },

  contracts: {
    async generate(orderId, revisionNote = '') {
      const res = await ApiClient.request('/contracts/generate', {
        method: 'POST',
        body: JSON.stringify({ orderId, revisionNote })
      });
      return res.data;
    },
    async list(orderId = null) {
      const qs = orderId ? `?orderId=${encodeURIComponent(orderId)}` : '';
      const res = await ApiClient.request(`/contracts${qs}`);
      return res.data || [];
    },
    async acknowledge(contractId, payload) {
      const res = await ApiClient.request(`/contracts/${encodeURIComponent(contractId)}/acknowledge`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async getDocument(contractId) {
      const res = await ApiClient.request(`/contracts/${encodeURIComponent(contractId)}/document`);
      return res.data;
    }
  },

  notifications: {
    async list() {
      const res = await ApiClient.request('/notifications');
      return res.data || [];
    },
    async markRead(notifId) {
      const res = await ApiClient.request(`/notifications/${encodeURIComponent(notifId)}/read`, { method: 'PATCH' });
      return res.data;
    }
  },

  tco: {
    async getAssumptions(region = 'vietnam') {
      const res = await ApiClient.request(`/cost-estimates/assumptions?region=${encodeURIComponent(region)}`);
      return res.data;
    },
    async estimate(payload) {
      const res = await ApiClient.request('/cost-estimates/tco', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  configurations: {
    async list() {
      const res = await ApiClient.request('/configurations');
      return res.data || [];
    },
    async getById(id) {
      const res = await ApiClient.request(`/configurations/${encodeURIComponent(id)}`);
      return res.data;
    },
    async save(payload, existingId = null) {
      const url = existingId ? `/configurations/${encodeURIComponent(existingId)}` : '/configurations';
      const res = await ApiClient.request(url, {
        method: existingId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async remove(id) {
      const res = await ApiClient.request(`/configurations/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      return res.data;
    }
  },

  accessories: {
    async list(filters = {}) {
      const qs = new URLSearchParams();
      ['vehicleId', 'category', 'kind', 'inStockOnly', 'compatibleOnly', 'q'].forEach(k => {
        if (filters[k] !== undefined && filters[k] !== null && filters[k] !== '' && filters[k] !== 'all') {
          qs.set(k, String(filters[k]));
        }
      });
      const q = qs.toString() ? `?${qs.toString()}` : '';
      const res = await ApiClient.request(`/accessories${q}`);
      return res.data;
    },
    async getBySku(sku, vehicleId = null) {
      const qs = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : '';
      const res = await ApiClient.request(`/accessories/${encodeURIComponent(sku)}${qs}`);
      return res.data;
    }
  },

  bundles: {
    async recommend(vehicleId, usage = 'family') {
      const qs = new URLSearchParams();
      if (vehicleId) qs.set('vehicleId', vehicleId);
      if (usage) qs.set('usage', usage);
      const res = await ApiClient.request(`/bundles/recommend?${qs.toString()}`);
      return res.data;
    },
    async createQuote(payload) {
      const res = await ApiClient.request('/bundles/quote', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  workshop: {
    async listResources(branchId = null) {
      const qs = branchId && branchId !== 'all' ? `?branchId=${encodeURIComponent(branchId)}` : '';
      const res = await ApiClient.request(`/workshop/resources${qs}`);
      return res.data;
    },
    async getAvailability(serviceCenterId, date) {
      const res = await ApiClient.request(`/workshop/availability?serviceCenterId=${encodeURIComponent(serviceCenterId)}&date=${encodeURIComponent(date)}`);
      return res.data;
    },
    async listJobs(filters = {}) {
      const qs = new URLSearchParams();
      ['serviceCenterId', 'date', 'status'].forEach(k => {
        if (filters[k] && filters[k] !== 'all') qs.set(k, String(filters[k]));
      });
      const q = qs.toString() ? `?${qs.toString()}` : '';
      const res = await ApiClient.request(`/workshop/jobs${q}`);
      return res.data || [];
    },
    async createJob(payload) {
      const res = await ApiClient.request('/workshop/jobs', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async reassignJob(jobId, payload) {
      const res = await ApiClient.request(`/workshop/jobs/${encodeURIComponent(jobId)}/reassign`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async cancelJob(jobId, reason = '') {
      const res = await ApiClient.request(`/workshop/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      return res.data;
    },
    async completeJob(jobId, payload) {
      const res = await ApiClient.request(`/workshop/jobs/${encodeURIComponent(jobId)}/complete`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  warrantyClaims: {
    async list(filters = {}) {
      const qs = filters.status && filters.status !== 'all' ? `?status=${encodeURIComponent(filters.status)}` : '';
      const res = await ApiClient.request(`/warranty-claims${qs}`);
      return res.data || [];
    },
    async submit(payload) {
      const res = await ApiClient.request('/warranty-claims', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async review(claimId, payload) {
      const res = await ApiClient.request(`/warranty-claims/${encodeURIComponent(claimId)}/review`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  cms: {
    async getPublic(params = {}) {
      const qs = new URLSearchParams();
      if (params.contentType) qs.set('contentType', params.contentType);
      if (params.slot) qs.set('slot', params.slot);
      const q = qs.toString() ? `?${qs.toString()}` : '';
      const res = await ApiClient.request(`/cms/public${q}`);
      return res.data || [];
    },
    async listStaff() {
      const res = await ApiClient.request('/cms');
      return res.data || { items: [], auditLogs: [] };
    },
    async saveDraft(payload) {
      const res = await ApiClient.request('/cms', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async publish(contentId, payload = {}) {
      const res = await ApiClient.request(`/cms/${encodeURIComponent(contentId)}/publish`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },
    async rollback(contentId, payload) {
      const res = await ApiClient.request(`/cms/${encodeURIComponent(contentId)}/rollback`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    }
  },

  charging: {
    async findStations(params = {}) {
      const qs = new URLSearchParams();
      ['lat', 'lng', 'province', 'connectorType', 'minPowerKw', 'q', 'forceRefresh'].forEach(k => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '' && params[k] !== 'all') {
          qs.set(k, String(params[k]));
        }
      });
      const qStr = qs.toString() ? `?${qs.toString()}` : '';
      const res = await ApiClient.request(`/charging/stations${qStr}`);
      return res.data;
    }
  }
};

if (typeof window !== 'undefined') {
  window.ApiClient = ApiClient;
}
