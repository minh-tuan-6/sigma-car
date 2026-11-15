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

  // ---- Connectivity state ------------------------------------------------------------------------------------
  // Backend availability is tracked separately from authentication (401/403 are answers from a live API) and from
  // Demo Sandbox (opt-in only, never enabled here):
  //   'unknown'      page just loaded, nothing confirmed yet
  //   'online'       a response matching the SIGMACAR API contract was received (see isApiContractResponse)
  //   'static-host'  /api/v1 returned the SPA shell or a non-JSON 404/405: no API behind this host
  //   'proxy-outage' the Pages proxy answered but reports the backend unavailable (X-Sigma-Proxy-Error)
  //   'offline'      network error, request timeout, browser offline event or failed health check
  // staticHostDetected (the "Static Preview" banner) is true only for 'static-host' / 'proxy-outage'.
  // Every request / health check takes a sequence number when it starts; an observation is applied only if no
  // later-started one has already decided, so a slow stale failure cannot overwrite a newer confirmed 'online'.
  connectivity: 'unknown',
  _connSeq: 0,
  _stateSeq: 0,
  _retryTimer: null,
  _retryDelayMs: 0,
  _healthInFlight: null,
  _autoRetry: false,
  RETRY_MIN_MS: 5000,
  RETRY_MAX_MS: 60000,

  _nextSeq() {
    this._connSeq += 1;
    return this._connSeq;
  },

  _emit(type, detail) {
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(type, { detail }));
      }
    } catch (_) {}
  },

  _isCrossOriginApi() {
    if (!/^https?:\/\//i.test(API_BASE)) return false;
    try {
      return typeof window === 'undefined' || !window.location || new URL(API_BASE).origin !== window.location.origin;
    } catch (_) {
      return true;
    }
  },

  // True only for responses produced by the SIGMACAR API (not a CDN page, captive portal or arbitrary JSON):
  // JSON content type + the API envelope ({ success: true } or { success: false, error: { code: 'UPPER_CASE' } })
  // + the backend's X-Request-Id or the Pages proxy marker (X-Sigma-Proxy: 1). A cross-origin API base cannot read
  // those headers without CORS exposure, so only the envelope is checked there.
  isApiContractResponse(res, data) {
    if (!res || !res.headers || typeof res.headers.get !== 'function') return false;
    const ctype = String(res.headers.get('content-type') || '').toLowerCase();
    if (!ctype.includes('application/json')) return false;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.success !== 'boolean') return false;
    if (data.success === false) {
      const e = data.error;
      if (!e || typeof e !== 'object' || typeof e.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(e.code)) return false;
    }
    if (this._isCrossOriginApi()) return true;
    const requestId = res.headers.get('x-request-id');
    return Boolean((requestId && /^[A-Za-z0-9._-]{4,64}$/.test(requestId)) || res.headers.get('x-sigma-proxy') === '1');
  },

  // fetch() rejects with these when the network (not the server) failed. Other TypeErrors are programming errors
  // and must surface instead of silently switching the site to the static catalog.
  isNetworkError(err) {
    const msg = String((err && err.message) || '');
    return /failed to fetch|networkerror|load failed|network connection was lost|fetch failed|network request failed|internet connection appears to be offline/i.test(msg);
  },

  // Applies a connectivity observation unless a later-started request / health check already decided.
  _applyConnectivity(seq, state, issue = null) {
    if (seq < this._stateSeq) return false;
    this._stateSeq = seq;
    const prevState = this.connectivity;
    const prevStatic = this.staticHostDetected;
    const prevCode = this.lastBackendIssue && this.lastBackendIssue.code;
    this.connectivity = state;
    this.staticHostDetected = state === 'static-host' || state === 'proxy-outage';
    this.lastBackendIssue = state === 'online' ? null : (issue || { code: 'UNKNOWN' });
    if (state === 'online') this._clearRetry();
    else this._scheduleRetry();
    const nextCode = this.lastBackendIssue && this.lastBackendIssue.code;
    if (prevState !== state || prevCode !== nextCode) {
      this._emit('sigmacar:connectivity-changed', { state, previous: prevState, issue: this.lastBackendIssue });
    }
    if (state === 'online' && prevState !== 'online') this._emit('sigmacar:backend-online', { previous: prevState });
    if (this.staticHostDetected && !prevStatic) this._emit('sigmacar:static-host-detected', { code: nextCode });
    return true;
  },

  // At most one retry timer; exponential backoff 5 s → 60 s; cleared as soon as connectivity is confirmed.
  _scheduleRetry() {
    if (!this._autoRetry || this._retryTimer) return;
    const delay = this._retryDelayMs ? Math.min(this._retryDelayMs * 2, this.RETRY_MAX_MS) : this.RETRY_MIN_MS;
    this._retryDelayMs = delay;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.verifyConnectivity();
    }, delay);
  },

  _clearRetry() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._retryDelayMs = 0;
  },

  // Health probe that updates the connectivity state. Concurrent calls share one in-flight probe.
  verifyConnectivity() {
    if (this._healthInFlight) return this._healthInFlight;
    const seq = this._nextSeq();
    this._healthInFlight = (async () => {
      try {
        const r = await this.checkHealth();
        const state = r.status === 'online' ? 'online'
          : (r.status === 'static-host' || r.status === 'proxy-outage') ? r.status : 'offline';
        this._applyConnectivity(seq, state, state === 'online' ? null : { code: r.code || 'HEALTH_CHECK_FAILED', status: r.httpStatus });
        return r;
      } finally {
        this._healthInFlight = null;
        // A stale result may have been ignored: keep retrying while the current state is not confirmed online.
        if (this.connectivity !== 'online' && this.connectivity !== 'unknown') this._scheduleRetry();
      }
    })();
    return this._healthInFlight;
  },

  // Browser wiring (called once from this file in the browser): online/offline events, one startup probe if no
  // API call has decided yet, retry while not online. Returns false when there is no window (tests, workers).
  initConnectivity({ startupDelayMs = 2500 } = {}) {
    if (this._connInit || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return false;
    this._connInit = true;
    this._autoRetry = true;
    window.addEventListener('online', () => {
      this._clearRetry();
      this.verifyConnectivity();
    });
    window.addEventListener('offline', () => {
      this._applyConnectivity(this._nextSeq(), 'offline', { code: 'BROWSER_OFFLINE' });
    });
    this._startupTimer = setTimeout(() => {
      this._startupTimer = null;
      if (this.connectivity === 'unknown') this.verifyConnectivity();
    }, startupDelayMs);
    if (this.connectivity !== 'online' && this.connectivity !== 'unknown') this._scheduleRetry();
    return true;
  },

  // Stops timers and listeners' effects (tests / teardown).
  stopConnectivity() {
    this._autoRetry = false;
    this._clearRetry();
    if (this._startupTimer) clearTimeout(this._startupTimer);
    this._startupTimer = null;
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
        // HTTP 200 + {status:'ok'} is not enough: it must come from the SIGMACAR API.
        if (!this.isApiContractResponse(res, data)) return { status: 'error', code: 'UNVERIFIED_HEALTH_RESPONSE', httpStatus: res.status };
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

    const seq = this._nextSeq();
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
    let timedOut = false;
    const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;

    try {
      const fetchOpts = { ...options, headers };
      if (controller && !options.signal) {
        fetchOpts.signal = controller.signal;
      }
      const res = await fetch(url, fetchOpts);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html') && res.ok) {
        // Static CDN SPA rewrite returned index.html instead of an API server
        this._applyConnectivity(seq, 'static-host', { code: 'STATIC_HOST_NO_API', status: res.status });
        return this.handleStaticFallback(endpoint, options);
      }

      // The Cloudflare Pages Function proxy (functions/api/v1/[[path]].js) is up but the backend is not:
      // degrade exactly like a static host (public reads from the bundled catalog, writes fail loudly).
      const proxyErrorCode = res.headers.get('x-sigma-proxy-error');
      if (proxyErrorCode && this.PROXY_OUTAGE_CODES.includes(proxyErrorCode)) {
        this._applyConnectivity(seq, 'proxy-outage', { code: proxyErrorCode, status: res.status });
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
          this._applyConnectivity(seq, 'static-host', { code: 'NON_JSON_RESPONSE', status: res.status });
          return this.handleStaticFallback(endpoint, options);
        }
        const err = new Error(`Máy chủ phản hồi không đúng định dạng (${res.status}).`);
        err.status = res.status;
        err.code = 'INVALID_SERVER_RESPONSE';
        throw err;
      }

      // Any genuine API answer — including 401/403/4xx errors — proves the backend is reachable.
      if (this.isApiContractResponse(res, data)) this._applyConnectivity(seq, 'online');

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
        // Only our own timer means "the server did not answer"; a caller-supplied signal aborting is not an outage.
        if (timedOut && !options.signal) this._applyConnectivity(seq, 'offline', { code: 'REQUEST_TIMEOUT' });
        const timeoutErr = new Error('Kết nối tới máy chủ quá thời gian chờ. Vui lòng thử lại.');
        timeoutErr.code = 'REQUEST_TIMEOUT';
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      if (err && (err.status || err.code === 'API_ERROR')) {
        throw err;
      }
      if (this.isNetworkError(err)) {
        // Temporary network failure: record it (banner + automatic retry); public reads keep the bundled catalog.
        this._applyConnectivity(seq, 'offline', { code: 'NETWORK_ERROR' });
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

    // Connectivity state is set by the caller (request → _applyConnectivity); serving fallback data, including
    // the opt-in Demo Sandbox, does not by itself mean "no backend".

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
      // T1.18: mirror backend FinancingService.calculateLoan (same rounding) so the offline demo shows the first-month
      // figures, honours the repayment method and evaluates DTI like the server.
      const method = body.repaymentMethod === 'equal_principal' ? 'equal_principal' : (body.repaymentMethod === 'flat' ? 'flat' : 'annuity');
      const basePrincipal = Math.floor(financedPrincipal / months);
      let monthlyPayment;
      let firstMonthPayment;
      let lastMonthPayment;
      let totalInterest;
      if (monthlyRate === 0) {
        monthlyPayment = Math.round(financedPrincipal / months);
        firstMonthPayment = monthlyPayment;
        lastMonthPayment = monthlyPayment;
        totalInterest = 0;
      } else if (method === 'flat') {
        const flatInterest = Math.round(financedPrincipal * monthlyRate);
        firstMonthPayment = (months === 1 ? financedPrincipal : basePrincipal) + flatInterest;
        lastMonthPayment = (financedPrincipal - basePrincipal * (months - 1)) + flatInterest;
        monthlyPayment = firstMonthPayment;
        totalInterest = flatInterest * months;
      } else if (method === 'equal_principal') {
        firstMonthPayment = (months === 1 ? financedPrincipal : basePrincipal) + Math.round(financedPrincipal * monthlyRate);
        const lastOpening = financedPrincipal - basePrincipal * (months - 1);
        lastMonthPayment = lastOpening + Math.round(lastOpening * monthlyRate);
        monthlyPayment = firstMonthPayment;
        totalInterest = Math.round(financedPrincipal * monthlyRate * (months + 1) / 2);
      } else {
        monthlyPayment = Math.round(financedPrincipal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1));
        firstMonthPayment = monthlyPayment;
        lastMonthPayment = monthlyPayment;
        totalInterest = Math.max(0, (monthlyPayment * months) - financedPrincipal);
      }
      const firstMonthPrincipal = method === 'equal_principal' && monthlyRate !== 0
        ? (months === 1 ? financedPrincipal : basePrincipal)
        : basePrincipal;
      let affordability = null;
      const income = Number(body.monthlyIncome);
      if (body.monthlyIncome !== undefined && body.monthlyIncome !== null && body.monthlyIncome !== '' && Number.isFinite(income) && income > 0) {
        const obligation = Math.max(0, Number(body.monthlyObligation || 0)) || 0;
        const totalDebt = firstMonthPayment + obligation;
        const dtiPercent = Math.round((totalDebt / income) * 1000) / 10;
        const riskBand = dtiPercent > 50 ? 'stretched' : (dtiPercent > 40 ? 'moderate' : 'comfortable');
        affordability = {
          monthlyIncome: income,
          monthlyObligation: obligation,
          proposedVehicleInstallment: firstMonthPayment,
          totalMonthlyDebt: totalDebt,
          dtiPercent,
          riskBand,
          eligibleForStandardLender: dtiPercent <= 50,
          advisory: riskBand === 'stretched'
            ? 'Tỷ lệ trả nợ vượt 50% thu nhập — ngân hàng có thể yêu cầu tăng tỷ lệ trả trước hoặc đồng vay.'
            : (riskBand === 'moderate'
              ? 'Tỷ lệ trả nợ ở mức trung bình khá (40% - 50% thu nhập). Cần chứng minh nguồn thu ổn định.'
              : 'Tỷ lệ trả nợ trên thu nhập (DTI) ở mức an toàn (<= 40%).')
        };
      }
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
          repaymentMethod: method,
          monthlyPayment,
          firstMonthPayment,
          firstMonthPrincipal,
          lastMonthPayment,
          totalInterest,
          totalCostOfLoan: price + totalInterest,
          isEstimateOnly: true,
          ...(affordability ? { affordability } : {})
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

    // T1.3: set (not flip) a favourite on the server. The endpoint only toggles, so if the server ends up in the other
    // state (the UI and server had drifted apart), toggle once more.
    async setSavedCar(vehicleId, wantSaved) {
      let result = await this.toggleSavedCar(vehicleId);
      if (result && typeof result.saved === 'boolean' && result.saved !== Boolean(wantSaved)) {
        result = await this.toggleSavedCar(vehicleId);
      }
      return result;
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
    // T1.2: the seller dashboard and buyer profile call listApplications().
    async listApplications() {
      return this.getApplications();
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
      const data = res.data || {};
      // T1.4: order history entries are {status, paymentStatus, note, timestamp}; the timeline modals render
      // {label, detail, at}. Add those display fields and keep the original ones.
      const raw = Array.isArray(data.events) ? data.events : (Array.isArray(data.timeline) ? data.timeline : []);
      const fmt = (iso) => {
        const t = Date.parse(iso);
        return Number.isFinite(t) ? new Date(t).toLocaleString('vi-VN') : (iso || '');
      };
      const events = raw.map(ev => ({
        ...ev,
        label: ev.label || ev.type || [ev.status, ev.paymentStatus].filter(Boolean).join(' · ') || 'Cập nhật',
        detail: ev.detail || ev.note || '',
        at: ev.at || fmt(ev.timestamp || ev.createdAt)
      }));
      return { ...data, events };
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
      const data = res.data || {};
      // T1.7: the booking form reads slot.timeSlot / slot.remaining and branch.homeServiceDistricts; the server sends
      // remainingCapacity / isAvailable and a top-level homeServiceDistricts (the offline demo sends `time`).
      const slots = (Array.isArray(data.slots) ? data.slots : []).map(s => {
        const remaining = typeof s.remainingCapacity === 'number'
          ? s.remainingCapacity
          : (typeof s.remaining === 'number' ? s.remaining : (s.isAvailable === false || s.available === false ? 0 : 1));
        return { ...s, timeSlot: s.timeSlot || s.time, remaining: s.isAvailable === false ? 0 : remaining };
      });
      const homeServiceDistricts = data.homeServiceDistricts || data.branch?.homeServiceDistricts || [];
      return { ...data, slots, branch: { ...(data.branch || {}), homeServiceDistricts } };
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
      // T1.5: uploaded evidence is sent as mediaIds (the server verifies ownership/scan status and rebuilds the photo
      // list). Signed /api/v1/media/... URLs have no file extension, so they must not also be sent as photos.
      const mediaIds = Array.isArray(payload.mediaIds) ? payload.mediaIds.filter(Boolean) : [];
      const isOwnMediaUrl = (u) => /\/api\/v1\/media\//.test(String(u || ''));
      const photos = Array.isArray(payload.photos)
        ? payload.photos
          .filter(p => !(mediaIds.length > 0 && typeof p === 'string' && isOwnMediaUrl(p)))
          .map(p => (typeof p === 'string' ? { name: p.split('?')[0].split('/').pop() || 'photo.jpg', url: p, sizeKb: 300 } : p))
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
          ...(mediaIds.length > 0 ? { mediaIds } : {}),
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
    // PLAN T2.4: warranty coverage by VIN (owner / branch staff / admin).
    async lookup(vin) {
      const res = await ApiClient.request(`/warranties/lookup?vin=${encodeURIComponent(String(vin || '').trim())}`);
      return res.data;
    },
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
        maintenanceMilestones: data.maintenanceMilestones || [],
        reminders: Array.isArray(data.reminders) ? data.reminders : [] // T1.14: server-computed maintenance reminders
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
    // T1.1: the product page (app.js loadAndRenderVehicleReviews) calls getForVehicle({vehicleId, star, verifiedOnly,
    // sort}) and reads the server's raw shape (stats, reviews, questions, currentUserEligibility).
    async getForVehicle({ vehicleId, star, verifiedOnly, sort } = {}) {
      const params = new URLSearchParams();
      if (vehicleId) params.set('vehicleId', vehicleId);
      if (star && star !== 'all') params.set('star', star);
      if (verifiedOnly) params.set('verifiedOnly', 'true');
      if (sort) params.set('sort', sort);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await ApiClient.request(`/reviews${qs}`);
      return res.data || {};
    },

    // T1.1 aliases used by app.js; they keep the server message for the toast.
    async delete(reviewId) {
      const res = await ApiClient.request(`/reviews/${encodeURIComponent(reviewId)}`, { method: 'DELETE' });
      return { message: res.message, ...(res.data || {}) };
    },

    async toggleHelpful(reviewId) {
      const res = await ApiClient.request(`/reviews/${encodeURIComponent(reviewId)}/helpful`, { method: 'POST' });
      return { message: res.message, ...(res.data || {}) };
    },

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
      // T1.1: app.js passes the answer text as a plain string.
      const content = typeof payload === 'string' ? payload : (payload && (payload.answer || payload.content));
      const res = await ApiClient.request(`/questions/${encodeURIComponent(questionId)}/answer`, {
        method: 'POST',
        body: JSON.stringify({ content })
      });
      const data = res.data || res;
      return data && typeof data === 'object' && !Array.isArray(data) ? { message: res.message, ...data } : data;
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
    // T1.6: guest tickets are readable only with the accessToken returned at creation. Remember it for this browser
    // session (by ticket id and code) and send it on lookup / reply / rate.
    _guestTokens() {
      try { return JSON.parse(sessionStorage.getItem('sigmacar_ticket_tokens') || '{}') || {}; } catch (e) { return {}; }
    },
    _rememberGuestToken(ticket) {
      if (!ticket || !ticket.accessToken) return;
      try {
        const map = this._guestTokens();
        if (ticket.id) map[ticket.id] = ticket.accessToken;
        if (ticket.ticketCode) map[ticket.ticketCode] = ticket.accessToken;
        sessionStorage.setItem('sigmacar_ticket_tokens', JSON.stringify(map));
      } catch (e) {}
    },
    _guestTokenFor(key) {
      return key ? (this._guestTokens()[key] || null) : null;
    },

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

    async lookupTicket(code, accessToken) {
      const token = accessToken || this._guestTokenFor(code);
      const res = await ApiClient.request(`/support/tickets/lookup?code=${encodeURIComponent(code)}${token ? `&accessToken=${encodeURIComponent(token)}` : ''}`);
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
        ? payload.attachments.map(a => ({ name: String(a.name || 'file.png').split('?')[0] || 'file.png', url: a.url, sizeKb: Math.round((a.sizeBytes || 200000) / 1024) })) // T1.6: no query string in the file name
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
      this._rememberGuestToken(res.data);
      return res.data || res;
    },

    async replyTicket(ticketId, payload) {
      const token = (payload && payload.accessToken) || this._guestTokenFor(ticketId);
      const res = await ApiClient.request(`/support/tickets/${encodeURIComponent(ticketId)}/reply`, {
        method: 'POST',
        body: JSON.stringify(token ? { ...payload, accessToken: token } : payload)
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
      const token = (payload && payload.accessToken) || this._guestTokenFor(ticketId);
      const res = await ApiClient.request(`/support/tickets/${encodeURIComponent(ticketId)}/rate`, {
        method: 'POST',
        body: JSON.stringify(token ? { ...payload, accessToken: token } : payload)
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
    // T1.8: the seller dashboard loads branch stock through inventory.list().
    async list(params = {}) {
      return this.getAll(params);
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
    },
    // The e-contract modal (app.js) embeds the document inside a <div>; the server sends a full HTML page with every
    // value escaped (contract-service buildPrintableHtml), so only its <body> content is returned here.
    async getDocumentHtml(contractId) {
      const doc = await this.getDocument(contractId);
      const html = String((doc && doc.html) || '');
      const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      return body ? body[1] : html;
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

  // PLAN T2.7: My Garage extras (kind = 'tco-results' | 'recommendations'), owner-only.
  garageExtras: {
    async list(kind) {
      const res = await ApiClient.request(`/garage/${encodeURIComponent(kind)}`);
      return res.data || [];
    },
    async save(kind, payload) {
      const res = await ApiClient.request(`/garage/${encodeURIComponent(kind)}`, {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
      return res.data;
    },
    async remove(kind, id) {
      const res = await ApiClient.request(`/garage/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
    },

    // PLAN T2.5: battery swap stations & rental policy. Without the API (static/offline), read the same public
    // reference file the server uses (data/battery-ecosystem.json).
    async _batteryReferenceFile() {
      const r = await fetch('data/battery-ecosystem.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('Không tải được dữ liệu đổi pin & thuê pin.');
      return r.json();
    },
    async getSwapStations(params = {}) {
      try {
        const qs = new URLSearchParams();
        if (params.province) qs.set('province', params.province);
        const res = await ApiClient.request(`/charging/swap-stations${qs.toString() ? `?${qs}` : ''}`);
        return res.data;
      } catch (err) {
        const ref = await this._batteryReferenceFile();
        return { source: ref.source, lastReviewed: ref.lastReviewed, liveAvailabilitySupported: false, disclaimer: ref.disclaimer, stations: ref.swapStations || [] };
      }
    },
    async getBatteryRental() {
      try {
        const res = await ApiClient.request('/charging/battery-rental');
        return res.data;
      } catch (err) {
        const ref = await this._batteryReferenceFile();
        return { source: ref.source, lastReviewed: ref.lastReviewed, disclaimer: ref.disclaimer, plans: ref.rentalPlans || [], policies: ref.policies || [] };
      }
    }
  }
};

if (typeof window !== 'undefined') {
  window.ApiClient = ApiClient;
  ApiClient.initConnectivity();
}
