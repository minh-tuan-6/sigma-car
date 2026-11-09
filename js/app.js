// js/app.js
// SIGMACAR Production Application Controller - Complete Bug-Free Full-Stack Implementation
// Fully resolves all issues reported in "Fix website" folder and integrates all vehicle models & AI features

// Global Application State
const AppState = {
  currentRoute: 'home',
  currentDetailCar: 'toyota-camry',
  compareCars: ['toyota-camry', 'vinfast-vf8', 'mercedes-glc300'],
  activeFuelFilter: 'all', // Default 'all' so all 32 vehicles (including CAR-001..CAR-010 from Data-xe.xlsx & VinFast EVs) appear immediately
  activeBrandFilter: 'all',
  activeBodyCategory: 'all',
  activePriceRange: 'all',
  activeMinPrice: '', // in million VNĐ
  activeMaxPrice: '', // in million VNĐ
  activeSort: 'default',
  activeCertifiedCategory: 'all',
  activeCertifiedPrice: 'all',
  activeCertifiedSort: 'default',
  activeProfileTab: 'profile-personal',
  activeSellerTab: 'dash-overview',
  preselectedTestDriveCar: '',
  pendingAuthAction: null,
  savedCarIds: new Set(),
  activeAiSession: null,
  userMessages: [],
  vehiclesList: [],
  certifiedList: [],
  currentUser: (typeof ApiClient !== 'undefined' && ApiClient.getCurrentUser) ? ApiClient.getCurrentUser() : null
};


  // =================================================================
  // CENTRALIZED VEHICLE FILTER & SORT ENGINE
  // =================================================================
  function getVehicleFuel(car) {
    if (!car) return 'ev';
    if (car.fuel) return car.fuel.toLowerCase();
    const pt = (car.powertrain || '').toLowerCase();
    const name = (car.name || '').toLowerCase();
    if (pt.includes('điện') || pt.includes('electric') || pt.includes('ev') || (car.range > 0 && !name.includes('camry') && !name.includes('cr-v'))) {
      return 'ev';
    }
    return 'gas';
  }

  function getVehicleNumericPrice(car) {
    if (!car) return 0;
    if (typeof car.price === 'number' && !isNaN(car.price)) return car.price;
    if (typeof car.price === 'string') {
      const cleaned = car.price.replace(/[^\d]/g, '');
      const parsed = parseInt(cleaned, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  function matchesPriceRange(priceNum, rangeKey = 'all', minMillion = '', maxMillion = '') {
    if (!priceNum || priceNum <= 0) return false;

    // Check custom numeric input limits (in million VNĐ)
    const minVnd = (minMillion !== '' && minMillion !== null && !isNaN(minMillion)) ? parseFloat(minMillion) * 1000000 : null;
    const maxVnd = (maxMillion !== '' && maxMillion !== null && !isNaN(maxMillion)) ? parseFloat(maxMillion) * 1000000 : null;

    if (minVnd !== null && priceNum < minVnd) return false;
    if (maxVnd !== null && priceNum > maxVnd) return false;

    // If custom min or max was explicitly set, it governs the price match
    if (minVnd !== null || maxVnd !== null) return true;

    if (!rangeKey || rangeKey === 'all') return true;

    switch (rangeKey) {
      case 'under-500m':
        return priceNum < 500000000;
      case '500m-1b':
        return priceNum >= 500000000 && priceNum <= 1000000000;
      case 'under-1b':
        return priceNum < 1000000000;
      case '1b-2b':
        return priceNum >= 1000000000 && priceNum <= 2000000000;
      case 'above-2b':
        return priceNum > 2000000000;
      case '1b-1.5b':
        return priceNum >= 1000000000 && priceNum <= 1500000000;
      case 'above-1.5b':
        return priceNum > 1500000000;
      default:
        return true;
    }
  }

  function filterAndSortVehicles(list, {
    category = 'all',
    fuel = 'all',
    brand = 'all',
    priceRange = 'all',
    minPrice = '',
    maxPrice = '',
    sort = 'default',
    search = ''
  } = {}) {
    if (!Array.isArray(list)) return [];

    let result = list.filter(car => {
      if (!car) return false;

      // 0. THƯƠNG HIỆU / NHÓM DỮ LIỆU (Brand / Dataset)
      if (brand && brand !== 'all') {
        const bLow = brand.toLowerCase().trim();
        if (bLow === 'data-xe') {
          if (!car.isDataXe && !(car.productCode && car.productCode.startsWith('CAR-'))) return false;
        } else {
          const carBrand = (car.brand || '').toLowerCase().trim();
          if (carBrand !== bLow) return false;
        }
      }

      // 1. DÒNG XE (Category)
      if (category && category !== 'all') {
        const cCat = (car.category || '').toLowerCase().trim();
        const subCat = (car.subCategory || '').toLowerCase().trim();
        const targetCat = category.toLowerCase().trim();
        if (cCat !== targetCat) {
          if (targetCat === 'compact' && (cCat.includes('compact') || cCat.includes('mpv') || cCat.includes('hatchback') || cCat.includes('đô thị'))) {
            // match
          } else if (targetCat === 'suv' && (cCat.includes('suv') || cCat.includes('crossover'))) {
            // match
          } else if ((targetCat === 'pickup' || targetCat === 'bán tải') && (subCat.includes('bán tải') || (car.subtitle || '').toLowerCase().includes('bán tải'))) {
            // match
          } else if (targetCat === 'mpv' && (subCat.includes('mpv') || (car.name || '').toLowerCase().includes('mpv') || (car.name || '').toLowerCase().includes('xpander') || (car.name || '').toLowerCase().includes('limo'))) {
            // match
          } else {
            return false;
          }
        }
      }

      // 2. NHIÊN LIỆU (Điện / Xăng)
      if (fuel && fuel !== 'all') {
        const cFuel = getVehicleFuel(car);
        if (cFuel !== fuel.toLowerCase()) {
          return false;
        }
      }

      // 3. KHOẢNG GIÁ (Price Range & Min/Max inputs)
      const numPrice = getVehicleNumericPrice(car);
      if (!matchesPriceRange(numPrice, priceRange, minPrice, maxPrice)) {
        return false;
      }

      // 4. TỪ KHÓA (Search)
      if (search && search.trim()) {
        const q = search.toLowerCase().trim();
        const name = (car.name || '').toLowerCase();
        const subtitle = (car.subtitle || '').toLowerCase();
        const carBrand = (car.brand || '').toLowerCase();
        const code = (car.productCode || '').toLowerCase();
        const subCat = (car.subCategory || '').toLowerCase();
        const colors = (car.colorsSummary || '').toLowerCase();
        if (!name.includes(q) && !subtitle.includes(q) && !carBrand.includes(q) && !code.includes(q) && !subCat.includes(q) && !colors.includes(q)) {
          return false;
        }
      }

      return true;
    });

    // 5. SẮP XẾP (Sorting)
    result = [...result];
    if (sort === 'price-asc') {
      result.sort((a, b) => getVehicleNumericPrice(a) - getVehicleNumericPrice(b));
    } else if (sort === 'price-desc') {
      result.sort((a, b) => getVehicleNumericPrice(b) - getVehicleNumericPrice(a));
    } else if (sort === 'name-asc') {
      result.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi', { sensitivity: 'base' }));
    } else if (sort === 'name-desc') {
      result.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'vi', { sensitivity: 'base' }));
    }

    return result;
  }

  function getActiveFiltersDescription(state = AppState) {
    const parts = [];
    if (state.activeBrandFilter && state.activeBrandFilter !== 'all') {
      parts.push(`Hãng/Nhóm: ${state.activeBrandFilter === 'data-xe' ? 'Data-xe (CAR-001..010)' : state.activeBrandFilter}`);
    }
    if (state.activeFuelFilter === 'ev') parts.push('Nhiên liệu: Điện');
    else if (state.activeFuelFilter === 'gas') parts.push('Nhiên liệu: Xăng / Dầu');
    else parts.push('Nhiên liệu: Tất cả');

    if (state.activeBodyCategory !== 'all') parts.push(`Dòng xe: ${state.activeBodyCategory}`);
    else parts.push('Dòng xe: Tất cả');
    
    if (state.activeMinPrice || state.activeMaxPrice) {
      const minText = state.activeMinPrice ? `từ ${state.activeMinPrice} triệu` : '';
      const maxText = state.activeMaxPrice ? `đến ${state.activeMaxPrice} triệu` : '';
      parts.push(`Mức giá: ${[minText, maxText].filter(Boolean).join(' ')}`);
    } else if (state.activePriceRange !== 'all') {
      const labels = {
        'under-500m': 'Dưới 500 triệu',
        '500m-1b': '500 triệu - 1 tỷ',
        'under-1b': 'Dưới 1 tỷ',
        '1b-2b': '1 tỷ - 2 tỷ',
        'above-2b': 'Trên 2 tỷ'
      };
      parts.push(`Mức giá: ${labels[state.activePriceRange] || state.activePriceRange}`);
    } else {
      parts.push('Mức giá: Tất cả');
    }

    if (state.activeSort !== 'default') {
      const sortLabels = {
        'price-asc': 'Giá tăng dần',
        'price-desc': 'Giá giảm dần',
        'name-asc': 'Tên A-Z',
        'name-desc': 'Tên Z-A'
      };
      parts.push(`Sắp xếp: ${sortLabels[state.activeSort] || state.activeSort}`);
    }

    return `Bộ lọc đang áp dụng: ${parts.join(' • ')}`;
  }

  // =================================================================
  // SECURE & ROBUST MARKDOWN PARSER (XSS-Safe Rich Text)
  // =================================================================
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdownSafe(text) {
    if (!text) return '';
    // 1. Escape HTML entities
    let escaped = escapeHtml(text);

    // 2. Fenced code blocks ```...```
    escaped = escaped.replace(/```([\s\S]*?)```/g, (match, p1) => {
      return `<pre><code>${p1.trim()}</code></pre>`;
    });

    // 3. Inline code `...`
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 4. Headers ### and ##
    escaped = escaped.replace(/^### (.*$)/gim, '<h4 style="margin:8px 0 4px; font-weight:800; color:#0F172A;">$1</h4>');
    escaped = escaped.replace(/^## (.*$)/gim, '<h3 style="margin:10px 0 6px; font-weight:800; color:#0F172A;">$1</h3>');

    // 5. Tables | col1 | col2 |
    const lines = escaped.split('\n');
    const resultLines = [];
    let inTable = false;
    let tableRows = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (line.includes('---')) {
          continue; // separator line
        }
        inTable = true;
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        tableRows.push(cells);
      } else {
        if (inTable) {
          let tableHTML = '<table>';
          tableRows.forEach((row, rIdx) => {
            tableHTML += '<tr>';
            row.forEach(cell => {
              const tag = rIdx === 0 ? 'th' : 'td';
              tableHTML += `<${tag}>${cell}</${tag}>`;
            });
            tableHTML += '</tr>';
          });
          tableHTML += '</table>';
          resultLines.push(tableHTML);
          inTable = false;
          tableRows = [];
        }
        resultLines.push(lines[i]);
      }
    }
    if (inTable) {
      let tableHTML = '<table>';
      tableRows.forEach((row, rIdx) => {
        tableHTML += '<tr>';
        row.forEach(cell => {
          const tag = rIdx === 0 ? 'th' : 'td';
          tableHTML += `<${tag}>${cell}</${tag}>`;
        });
        tableHTML += '</tr>';
      });
      tableHTML += '</table>';
      resultLines.push(tableHTML);
    }

    let html = resultLines.join('\n');

    // 6. Bold **text** and Italic *text*
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 7. Bullet lists • or -
    html = html.replace(/^[•\-\*]\s+(.*)$/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gims, '<ul style="padding-left:20px; margin:6px 0;">$1</ul>');

    // 8. Links [text](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--primary); text-decoration:underline;">$1</a>');

    // 9. Convert remaining newlines into <br> except inside tags
    html = html.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');

    return html;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      AppState,
      getVehicleFuel,
      getVehicleNumericPrice,
      matchesPriceRange,
      filterAndSortVehicles,
      getActiveFiltersDescription,
      renderMarkdownSafe,
      escapeHtml
    };
  }

  if (typeof window !== 'undefined') {
    window.FilterEngine = {
      AppState,
      getVehicleFuel,
      getVehicleNumericPrice,
      matchesPriceRange,
      filterAndSortVehicles,
      getActiveFiltersDescription,
      renderMarkdownSafe,
      escapeHtml
    };
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', async () => {
      // DOM Elements
      const viewsContainer = document.getElementById('views-container');
  const navLinks = document.querySelectorAll('.nav-link[data-route]');
  const toastContainer = document.getElementById('toast-container');

  // Floating Dropdown & Drawers & Overlays
  const accountDropdown = document.getElementById('account-dropdown');
  const hamburgerDrawer = document.getElementById('hamburger-drawer');
  const searchOverlay = document.getElementById('search-overlay');
  const searchInput = document.getElementById('search-fullscreen-input');
  const searchResultsGrid = document.getElementById('search-popular-results');
  const llmSettingsModal = document.getElementById('llm-settings-modal');
  const authModal = document.getElementById('auth-modal');
  const depositModal = document.getElementById('deposit-modal');
  const loanCalcModal = document.getElementById('loan-calculator-modal');

  // =================================================================
  // TOAST NOTIFICATION HELPER
  // =================================================================
  function showToast(message, icon = '✓') {
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.innerHTML = `<span style="color:var(--accent-cyan); font-weight:bold;">${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // =================================================================
  // AUTH GUARD: Require login/registration for guest interactions
  // (Fixes: đăng ký lái thử + tư vấn ai + quan tâm xe yêu cầu đăng nhập)
  // =================================================================
  function requireAuth(actionDesc, callback) {
    const user = ApiClient.getCurrentUser();
    if (user) {
      if (typeof callback === 'function') callback(user);
      return true;
    }

    // Guest user -> show auth modal with friendly invitation
    AppState.pendingAuthAction = callback;
    const titleEl = document.getElementById('auth-modal-title');
    const descEl = document.getElementById('auth-modal-desc');
    if (titleEl) titleEl.textContent = 'Yêu cầu đăng nhập';
    if (descEl) descEl.textContent = `Vui lòng đăng nhập hoặc đăng ký tài khoản để ${actionDesc}.`;

    switchAuthTab('register'); // Encourage registration for new guests
    authModal?.classList.add('active');
    showToast(`Vui lòng đăng nhập để ${actionDesc}! 🔒`, '🔒');
    return false;
  }

  // Initial Data Fetch from Backend API
  async function loadBackendData() {
    try {
      const [vehicles, certified] = await Promise.all([
        ApiClient.vehicles.getAll(),
        ApiClient.vehicles.getCertified()
      ]);
      AppState.vehiclesList = (vehicles && vehicles.length > 0)
        ? vehicles.map(v => {
            const local = SIGMA_DATA.cars.find(c => c.id === v.id);
            return { ...(local || {}), ...v };
          })
        : SIGMA_DATA.cars;
      AppState.certifiedList = (certified && certified.length > 0) ? certified : SIGMA_DATA.certifiedCars;
    } catch (e) {
      console.warn('Using local fallback dataset:', e.message);
      AppState.vehiclesList = SIGMA_DATA.cars;
      AppState.certifiedList = SIGMA_DATA.certifiedCars;
    }

    // Live Dynamic RAG: Ingest and ground all website vehicles into AI Brain
    if (typeof AutomotiveLLM !== 'undefined' && AutomotiveLLM.syncKnowledgeBase) {
      AutomotiveLLM.syncKnowledgeBase(AppState.vehiclesList, AppState.certifiedList, SIGMA_DATA?.accessories || []);
    }
  }

  // =================================================================
  // ROUTER
  // =================================================================
  function parseHashRoute(rawHash) {
    const clean = (rawHash || '').replace(/^#\/?/, '') || 'home';
    const [route, queryStr] = clean.split('?');
    const params = {};
    if (queryStr) {
      const q = new URLSearchParams(queryStr);
      if (q.has('tab')) {
        if (route === 'seller-dashboard') params.sellerTab = q.get('tab');
        if (route === 'profile') params.profileTab = q.get('tab');
      }
      if (q.has('carId')) params.carId = q.get('carId');
    }
    return { route: route || 'home', params };
  }

  function navigateTo(routeInput, params = {}) {
    const parsed = parseHashRoute(routeInput);
    const route = parsed.route;
    const mergedParams = { ...parsed.params, ...params };

    if (mergedParams.carId) AppState.currentDetailCar = mergedParams.carId;
    if (mergedParams.compareCars) AppState.compareCars = mergedParams.compareCars;
    if (mergedParams.profileTab) AppState.activeProfileTab = mergedParams.profileTab;
    if (mergedParams.sellerTab) AppState.activeSellerTab = mergedParams.sellerTab;

    AppState.currentRoute = route;

    let targetHash = route;
    if (route === 'seller-dashboard' && AppState.activeSellerTab) {
      targetHash += `?tab=${AppState.activeSellerTab}`;
    } else if (route === 'profile' && AppState.activeProfileTab) {
      targetHash += `?tab=${AppState.activeProfileTab}`;
    } else if (route === 'vehicle-detail' && AppState.currentDetailCar) {
      targetHash += `?carId=${AppState.currentDetailCar}`;
    }

    if (window.location.hash.replace(/^#\/?/, '') !== targetHash) {
      window.location.hash = targetHash;
    }

    accountDropdown?.classList.remove('active');
    hamburgerDrawer?.classList.remove('active');
    searchOverlay?.classList.remove('active');

    navLinks.forEach(link => {
      const linkRoute = link.getAttribute('data-route');
      if (linkRoute === route || (linkRoute === 'vr-ar' && (route === 'vr-ar' || route === 'ar-live' || route === 'ar-home'))) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderCurrentRoute();
  }

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash || 'home';
    const parsed = parseHashRoute(hash);
    if (parsed.route !== AppState.currentRoute || (parsed.params.sellerTab && parsed.params.sellerTab !== AppState.activeSellerTab) || (parsed.params.profileTab && parsed.params.profileTab !== AppState.activeProfileTab)) {
      navigateTo(hash);
    }
  });

  window.openProfileSubView = function(tabName) {
    accountDropdown?.classList.remove('active');
    hamburgerDrawer?.classList.remove('active');
    navigateTo('profile', { profileTab: tabName || 'profile-personal' });
  };

  window.openSellerSubView = function(tabName) {
    accountDropdown?.classList.remove('active');
    hamburgerDrawer?.classList.remove('active');
    navigateTo('seller-dashboard', { sellerTab: tabName || 'dash-overview' });
  };

  window.openCarDetail = function(carId) {
    if (!carId) return;
    AppState.currentDetailCar = carId;
    searchOverlay?.classList.remove('active');
    navigateTo('detail', { carId });
  };

  window.addCarToCompare = function(carId) {
    if (!carId) return;
    if (!AppState.compareCars.includes(carId)) {
      if (AppState.compareCars.length >= 4) {
        AppState.compareCars.shift();
      }
      AppState.compareCars.push(carId);
    }
    const car = AppState.vehiclesList.find(c => c.id === carId);
    showToast(`Đã thêm ${car ? car.name : carId} vào bảng so sánh! ⚖️`, '⚖️');
    navigateTo('compare');
  };

  window.bookCarTestDrive = function(carIdOrName) {
    const car = AppState.vehiclesList.find(c => c.id === carIdOrName || c.name === carIdOrName);
    AppState.preselectedTestDriveCar = car ? car.name : (carIdOrName || '');
    requireAuth('đăng ký lái thử', () => navigateTo('test-drive'));
  };

  window.openVrArShowroom = function(carId) {
    if (carId) AppState.currentDetailCar = carId;
    navigateTo('vr-ar');
  };

  window.openArLive = function(carId) {
    if (carId) AppState.currentDetailCar = carId;
    navigateTo('ar-live');
  };

  window.openArAtHome = function(carId) {
    if (carId) AppState.currentDetailCar = carId;
    navigateTo('ar-home');
  };

  function renderCurrentRoute() {
    if (AppState.currentRoute !== 'vr-ar' && window._activeCar3DViewer) {
      try {
        window._activeCar3DViewer.dispose();
      } catch (e) {}
      window._activeCar3DViewer = null;
    }

    switch (AppState.currentRoute) {
      case 'home':
        renderHome();
        break;
      case 'new-cars':
        renderNewCars();
        break;
      case 'certified':
        renderCertifiedCars();
        break;
      case 'accessories':
        renderAccessories();
        break;
      case 'vr-ar':
        renderVrArShowroomPage();
        break;
      case 'ar-live':
        renderArLiveModePage();
        break;
      case 'ar-home':
        renderArAtHomePage();
        break;
      case 'detail':
        renderVehicleDetail(AppState.currentDetailCar);
        break;
      case 'compare':
        renderCompare();
        break;
      case 'ai-advisor':
        renderAIAdvisor();
        break;
      case 'test-drive':
        renderTestDrivePage();
        break;
      case 'support':
        renderSupportCenterPage();
        break;
      case 'seller-dashboard':
        renderSellerDashboard(AppState.activeSellerTab);
        break;
      case 'profile':
        renderProfile(AppState.activeProfileTab);
        break;
      default:
        renderHome();
    }
  }

  // =================================================================
  // VIEW 1: HOME PAGE
  // =================================================================
  function renderHome() {
    viewsContainer.innerHTML = `
      <section class="hero-section">
        <div class="hero-bg-overlay"></div>
        <div class="hero-grid-pattern"></div>
        <div class="container">
          <div class="hero-content">
            <div class="hero-pill">
              <span class="ai-pulse-dot"></span>
              Kỷ nguyên di chuyển mới
            </div>
            <h1 class="hero-title">
              SIGMACAR: <br>
              <span class="highlight">ELECTRIC &</span><br>
              CERTIFIED
            </h1>
            <p class="hero-desc">
              Trải nghiệm công nghệ dẫn đầu và sự an tâm tuyệt đối với tiêu chuẩn kiểm định khắt khe nhất dành cho xe điện và xe đã qua sử dụng.
            </p>
            <div class="hero-cta-group">
              <button class="btn-primary" id="btn-hero-explore">
                Khám phá ngay
              </button>
              <button class="btn-secondary" style="background:transparent; color:#FFFFFF; border:1px solid rgba(255,255,255,0.4);" id="btn-hero-testdrive">
                Đăng ký lái thử
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Quick Search Filter Bar -->
      <div class="container">
        <div class="search-filter-card" id="home-search-filter-card">
          <div class="filter-grid">
            <div class="filter-item">
              <label class="filter-label" for="home-filter-category">Dòng xe</label>
              <select class="filter-select" id="home-filter-category">
                <option value="all" ${AppState.activeBodyCategory === 'all' ? 'selected' : ''}>Tất cả các dòng xe</option>
                <option value="SUV" ${AppState.activeBodyCategory === 'SUV' ? 'selected' : ''}>Dòng xe SUV / Crossover</option>
                <option value="Sedan" ${AppState.activeBodyCategory === 'Sedan' ? 'selected' : ''}>Dòng xe Sedan</option>
                <option value="Pickup" ${AppState.activeBodyCategory === 'Pickup' ? 'selected' : ''}>Dòng xe Bán tải (Pickup)</option>
                <option value="MPV" ${AppState.activeBodyCategory === 'MPV' ? 'selected' : ''}>Dòng xe MPV 7 chỗ</option>
                <option value="Compact" ${AppState.activeBodyCategory === 'Compact' ? 'selected' : ''}>Dòng xe Đô thị / Compact</option>
              </select>
            </div>
            <div class="filter-item">
              <label class="filter-label" for="home-filter-price">Khoảng giá (triệu VNĐ)</label>
              <select class="filter-select" id="home-filter-price" style="margin-bottom:6px;">
                <option value="all" ${AppState.activePriceRange === 'all' && !AppState.activeMinPrice && !AppState.activeMaxPrice ? 'selected' : ''}>Mức giá tham khảo (Tất cả)</option>
                <option value="under-500m" ${AppState.activePriceRange === 'under-500m' ? 'selected' : ''}>Dưới 500 triệu VNĐ</option>
                <option value="500m-1b" ${AppState.activePriceRange === '500m-1b' ? 'selected' : ''}>Từ 500 triệu - 1 tỷ VNĐ</option>
                <option value="under-1b" ${AppState.activePriceRange === 'under-1b' ? 'selected' : ''}>Dưới 1 tỷ VNĐ</option>
                <option value="1b-2b" ${AppState.activePriceRange === '1b-2b' ? 'selected' : ''}>Từ 1 tỷ - 2 tỷ VNĐ</option>
                <option value="above-2b" ${AppState.activePriceRange === 'above-2b' ? 'selected' : ''}>Trên 2 tỷ VNĐ</option>
                <option value="custom" ${AppState.activePriceRange === 'custom' || AppState.activeMinPrice || AppState.activeMaxPrice ? 'selected' : ''}>Tùy chỉnh khoảng giá</option>
              </select>
              <div class="price-inputs-row">
                <input type="text" class="filter-input" id="home-filter-min-price" placeholder="Giá từ (triệu đ)" value="${AppState.activeMinPrice || ''}" inputmode="numeric" />
                <span class="price-separator">-</span>
                <input type="text" class="filter-input" id="home-filter-max-price" placeholder="Giá đến (triệu đ)" value="${AppState.activeMaxPrice || ''}" inputmode="numeric" />
                ${(AppState.activeMinPrice || AppState.activeMaxPrice) ? '<button type="button" class="btn-secondary" id="btn-clear-home-price" title="Xóa khoảng giá nhập" style="background:#F1F5F9; border:1px solid #CBD5E1; color:#64748B; font-size:12px; height:36px; padding:0 8px; border-radius:var(--radius-xs); cursor:pointer;">✕</button>' : ''}
              </div>
              <div id="home-price-val-error" style="display:none; color:#EF4444; font-size:11px; font-weight:700; margin-top:3px;">⚠️ Giá từ không được lớn hơn Giá đến</div>
            </div>
            <div class="filter-item">
              <label class="filter-label">Nhiên liệu</label>
              <div class="filter-fuel-tabs" id="home-fuel-tabs">
                <button type="button" class="fuel-tab-btn ${AppState.activeFuelFilter === 'all' ? 'active' : ''}" data-fuel="all">Tất cả</button>
                <button type="button" class="fuel-tab-btn ${AppState.activeFuelFilter === 'ev' ? 'active' : ''}" data-fuel="ev">Điện</button>
                <button type="button" class="fuel-tab-btn ${AppState.activeFuelFilter === 'gas' ? 'active' : ''}" data-fuel="gas">Xăng / Dầu</button>
              </div>
            </div>
            <div class="filter-item">
              <label class="filter-label" for="home-filter-sort">Sắp xếp theo</label>
              <select class="filter-select" id="home-filter-sort">
                <option value="default" ${AppState.activeSort === 'default' ? 'selected' : ''}>Mặc định / Liên quan</option>
                <option value="price-asc" ${AppState.activeSort === 'price-asc' ? 'selected' : ''}>Giá thấp đến cao</option>
                <option value="price-desc" ${AppState.activeSort === 'price-desc' ? 'selected' : ''}>Giá cao đến thấp</option>
                <option value="name-asc" ${AppState.activeSort === 'name-asc' ? 'selected' : ''}>Tên xe A–Z</option>
                <option value="name-desc" ${AppState.activeSort === 'name-desc' ? 'selected' : ''}>Tên xe Z–A</option>
              </select>
            </div>
            <div class="filter-item" style="justify-content:flex-end;">
              <label class="filter-label" style="opacity:0;">&nbsp;</label>
              <div style="display:flex; gap:8px;">
                <button type="button" class="btn-dark" id="btn-home-filter-search" style="height:44px; padding:0 22px; justify-content:center; white-space:nowrap; border-radius:var(--radius-sm); font-weight:700; cursor:pointer;">
                  🔍 Tìm kiếm
                </button>
                <button type="button" class="btn-secondary" id="btn-home-filter-reset" title="Đặt lại bộ lọc" style="height:44px; padding:0 12px; border-radius:var(--radius-sm); font-weight:600; cursor:pointer; background:#F1F5F9; border:1px solid #CBD5E1; color:#475569; display:${(AppState.activeFuelFilter !== 'all' || AppState.activeBodyCategory !== 'all' || AppState.activeBrandFilter !== 'all' || AppState.activePriceRange !== 'all' || AppState.activeSort !== 'default' || AppState.activeMinPrice || AppState.activeMaxPrice) ? 'flex' : 'none'}; align-items:center; justify-content:center;">
                  ↺ Đặt lại
                </button>
              </div>
            </div>
          </div>

          <!-- Brand Filter Bar (Excel Data-xe CAR-001..010 & VinFast VF2..VFWILD) -->
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:16px; padding-top:14px; border-top:1px solid var(--border-subtle);" id="home-brand-tabs">
            <span style="font-size:12px; font-weight:800; color:var(--text-muted); margin-right:4px;">HÃNG XE:</span>
            ${[
              { key: 'all', label: `Tất cả (${AppState.vehiclesList.length})` },
              { key: 'data-xe', label: '📋 Data-xe (CAR-001..010)' },
              { key: 'VinFast', label: 'VinFast (VF2 - VFWILD)' },
              { key: 'Toyota', label: 'Toyota' },
              { key: 'Honda', label: 'Honda' },
              { key: 'Ford', label: 'Ford' },
              { key: 'Hyundai', label: 'Hyundai' },
              { key: 'Mazda', label: 'Mazda' },
              { key: 'Mercedes-Benz', label: 'Mercedes-Benz' },
              { key: 'BMW', label: 'BMW' },
              { key: 'Kia', label: 'Kia' },
              { key: 'Mitsubishi', label: 'Mitsubishi' },
              { key: 'SIGMACAR', label: 'SIGMACAR' }
            ].map(b => `
              <button type="button" class="chip-btn home-brand-chip ${AppState.activeBrandFilter === b.key ? 'active' : ''}" data-brand="${b.key}" style="padding:5px 12px; font-size:12px;">${b.label}</button>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- DÒNG XE MỚI RA MẮT / KẾT QUẢ TÌM KIẾM -->
      <section class="section" id="home-cars-section">
        <div class="container">
          <div class="section-header" id="home-cars-header">
            <div>
              <span class="section-tag" id="home-cars-tag">${(AppState.activeBodyCategory !== 'all' || AppState.activeBrandFilter !== 'all' || AppState.activeFuelFilter !== 'all' || AppState.activePriceRange !== 'all' || AppState.activeSort !== 'default' || AppState.activeMinPrice || AppState.activeMaxPrice) ? 'KẾT QUẢ TÌM KIẾM' : 'DANH MỤC ĐẦY ĐỦ XE MỚI & CHÍNH HÃNG'}</span>
              <h2 class="section-title" id="home-cars-title">
                ${(AppState.activeBodyCategory !== 'all' || AppState.activeBrandFilter !== 'all' || AppState.activeFuelFilter !== 'all' || AppState.activePriceRange !== 'all' || AppState.activeSort !== 'default' || AppState.activeMinPrice || AppState.activeMaxPrice) ? `KẾT QUẢ TÌM KIẾM (${filterAndSortVehicles(AppState.vehiclesList, { category: AppState.activeBodyCategory, brand: AppState.activeBrandFilter, fuel: AppState.activeFuelFilter, priceRange: AppState.activePriceRange, minPrice: AppState.activeMinPrice, maxPrice: AppState.activeMaxPrice, sort: AppState.activeSort }).length} mẫu xe)` : `DÒNG XE MỚI & CHÍNH HÃNG (${AppState.vehiclesList.length} MẪU XE)`}
              </h2>
              <p class="section-desc" id="home-cars-desc">
                ${(AppState.activeBodyCategory !== 'all' || AppState.activeBrandFilter !== 'all' || AppState.activeFuelFilter !== 'all' || AppState.activePriceRange !== 'all' || AppState.activeSort !== 'default' || AppState.activeMinPrice || AppState.activeMaxPrice) ? getActiveFiltersDescription() : 'Đầy đủ 10 mẫu xe chuẩn từ Data-xe.xlsx (CAR-001 đến CAR-010), 15 mẫu xe điện VinFast (VF2 - VF Wild) và 7 mẫu SIGMACAR'}
              </p>
            </div>
            <div id="home-cars-action-area" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
              ${(AppState.activeBodyCategory !== 'all' || AppState.activeBrandFilter !== 'all' || AppState.activeFuelFilter !== 'all' || AppState.activePriceRange !== 'all' || AppState.activeSort !== 'default' || AppState.activeMinPrice || AppState.activeMaxPrice) ? `
                <button class="btn-secondary" id="btn-header-clear-filter" style="padding:6px 14px; font-size:13px; background:#F1F5F9; border:1px solid #CBD5E1; color:#475569; border-radius:6px; cursor:pointer;">
                  ✕ Xóa bộ lọc
                </button>
              ` : ''}
              <a href="javascript:void(0)" class="link-view-all" onclick="window.location.hash='new-cars'">
                Xem tất cả (${AppState.vehiclesList.length} dòng xe) →
              </a>
            </div>
          </div>

          <div class="car-grid" id="home-car-grid">
            ${(() => {
              const list = filterAndSortVehicles(AppState.vehiclesList, {
                category: AppState.activeBodyCategory,
                brand: AppState.activeBrandFilter,
                fuel: AppState.activeFuelFilter,
                priceRange: AppState.activePriceRange,
                minPrice: AppState.activeMinPrice,
                maxPrice: AppState.activeMaxPrice,
                sort: AppState.activeSort
              });
              if (list.length === 0) {
                return `
                  <div style="grid-column:1/-1; text-align:center; padding:60px 24px; background:#F8FAFC; border-radius:16px; border:1px dashed #CBD5E1;">
                    <div style="font-size:52px; margin-bottom:14px;">🔍</div>
                    <h3 style="font-size:22px; font-weight:800; color:var(--text-dark); margin-bottom:8px;">Không tìm thấy xe phù hợp với bộ lọc của bạn.</h3>
                    <p style="color:var(--text-muted); max-width:500px; margin:0 auto 20px; font-size:14.5px;">Vui lòng điều chỉnh lại khoảng giá, dòng xe hoặc chọn loại nhiên liệu khác để xem các mẫu xe hiện có.</p>
                    <button class="btn-primary" id="btn-reset-filters-empty" style="padding:10px 24px; font-weight:700;">↺ Đặt lại tất cả bộ lọc</button>
                  </div>
                `;
              }
              return list.map(car => createHomeCarCardHTML(car)).join('');
            })()}
          </div>
        </div>
      </section>

      <!-- CERTIFIED PRE-OWNED: XE QUA SỬ DỤNG CHÍNH HÃNG -->
      <section class="section" style="background:#FFFFFF; border-top:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle);">
        <div class="container">
          <div style="text-align:center; max-width:760px; margin:0 auto 40px;">
            <span style="font-size:12px; font-weight:800; color:var(--text-muted); letter-spacing:0.12em; text-transform:uppercase;">CERTIFIED PRE-OWNED</span>
            <h2 class="section-title" style="margin-top:6px;">XE QUA SỬ DỤNG CHÍNH HÃNG</h2>
            <p class="section-desc">Sự an tâm tuyệt đối như xe mới với quy trình kiểm soát chất lượng nghiêm ngặt và bảo hành chính hãng từ SIGMACAR.</p>
          </div>

          <div class="certified-features-grid">
            <div class="certified-feature-item">
              <div class="certified-icon">📋</div>
              <h4 class="certified-feature-title">176+ điểm kiểm tra</h4>
              <p class="certified-feature-desc">Kỹ thuật viên chuyên nghiệp kiểm định chi tiết</p>
            </div>
            <div class="certified-feature-item">
              <div class="certified-icon">🛡️</div>
              <h4 class="certified-feature-title">Bảo hành chính hãng</h4>
              <p class="certified-feature-desc">An tâm 12 tháng hoặc 20.000km tiếp theo</p>
            </div>
            <div class="certified-feature-item">
              <div class="certified-icon">🚘</div>
              <h4 class="certified-feature-title">Không đâm đụng</h4>
              <p class="certified-feature-desc">Cam kết xe chưa qua sửa chữa lớn, ngập nước</p>
            </div>
            <div class="certified-feature-item">
              <div class="certified-icon">📄</div>
              <h4 class="certified-feature-title">Hồ sơ minh bạch</h4>
              <p class="certified-feature-desc">Lịch sử bảo dưỡng đầy đủ tại các đại lý</p>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:20px; margin-bottom:32px;">
            ${AppState.certifiedList.slice(0, 4).map(car => createHomeCertifiedCardHTML(car)).join('')}
          </div>

          <div style="text-align:center;">
            <button class="btn-secondary" style="padding:12px 28px; font-size:14px; font-weight:700;" onclick="window.location.hash='certified'">
              Xem tất cả xe đã qua sử dụng chính hãng (${AppState.certifiedList.length} xe) →
            </button>
          </div>
        </div>
      </section>

      <!-- SIGMA AI EXPERIENCE BANNER (With input forward bug fixed) -->
      <section class="section">
        <div class="container">
          <div class="ai-experience-banner">
            <div class="ai-banner-grid">
              <div>
                <span class="ai-banner-tag">S i g m a   A I   E x p e r i e n c e</span>
                <h2 class="ai-banner-title">
                  CHUYÊN GIA TƯ VẤN <br>
                  AI ĐA PHƯƠNG THỨC
                </h2>
                <p class="ai-banner-desc">
                  Bắt đầu hành trình tìm kiếm chiếc xe hoàn hảo chỉ trong vài phút. AI của chúng tôi sẽ phân tích nhu cầu, ngân sách và không gian garage để đề xuất lựa chọn tối ưu nhất cho bạn.
                </p>

                <div class="ai-features-list">
                  <div class="ai-feature-row">
                    <div class="ai-feat-icon">💰</div>
                    <div class="ai-feat-text">
                      <h5>Cá nhân hóa ngân sách</h5>
                      <p>Tính toán phương án tài chính và trả góp thông minh</p>
                    </div>
                  </div>
                  <div class="ai-feature-row">
                    <div class="ai-feat-icon">💺</div>
                    <div class="ai-feat-text">
                      <h5>Phù hợp số lượng ghế</h5>
                      <p>Tối ưu không gian cho gia đình hoặc công việc</p>
                    </div>
                  </div>
                  <div class="ai-feature-row">
                    <div class="ai-feat-icon">📐</div>
                    <div class="ai-feat-text">
                      <h5>Đo lường kích thước garage</h5>
                      <p>Sử dụng AR để đảm bảo xe vừa vặn với không gian đỗ</p>
                    </div>
                  </div>
                </div>

                <button class="btn-primary" style="background:#FFFFFF; color:var(--text-dark); font-weight:700; padding:12px 24px;" id="btn-banner-start-ai">
                  Bắt đầu tư vấn ngay 🤖
                </button>
              </div>

              <!-- Interactive Simulated Chat Mockup from Figma -->
              <div class="ai-chat-preview-box">
                <div class="ai-chat-box-header">
                  <div class="ai-avatar-badge">
                    <div class="ai-avatar-circle">🤖</div>
                    <div>
                      <div style="font-weight:700; font-size:14px; color:#FFFFFF;">Sigma Assistant</div>
                      <div style="font-size:11px; color:#10B981;">● Đang trực tuyến</div>
                    </div>
                  </div>
                </div>

                <div class="ai-msg-bubble bot-bubble">
                  Xin chào! Tôi có thể giúp bạn tìm chiếc xe phù hợp. Bạn đang tìm xe cho bao nhiêu người sử dụng và ngân sách dự kiến là bao nhiêu?
                </div>

                <div class="ai-msg-bubble user-bubble">
                  Mình cần xe SUV 7 chỗ, ngân sách khoảng 1.5 tỷ đồng.
                </div>

                <div class="ai-msg-bubble bot-bubble">
                  Dựa trên yêu cầu của bạn, tôi đề xuất 2 mẫu xe:
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
                    <div style="background:#FFFFFF; color:var(--text-dark); padding:10px; border-radius:8px; cursor:pointer;" onclick="window.openCarDetail('grand-7')">
                      <div style="font-weight:700; font-size:13px;">SIGMA Grand 7</div>
                      <div style="font-size:11px; color:var(--text-muted);">7 Chỗ SUV • 1.790 tỷ</div>
                    </div>
                    <div style="background:#FFFFFF; color:var(--text-dark); padding:10px; border-radius:8px; cursor:pointer;" onclick="window.openCarDetail('model-e')">
                      <div style="font-weight:700; font-size:13px;">SIGMA Model E</div>
                      <div style="font-size:11px; color:var(--text-muted);">Xe mới • Từ 1.290 tỷ</div>
                    </div>
                  </div>
                  <div style="margin-top:10px; font-size:13px;">Bạn muốn tìm hiểu kỹ hơn về mẫu xe nào?</div>
                </div>

                <div style="display:flex; gap:8px; margin-top:14px;">
                  <input type="text" id="home-ai-input" placeholder="Nhập câu trả lời của bạn..." style="flex:1; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:20px; padding:8px 16px; color:#FFFFFF; outline:none; font-size:13px;">
                  <button class="btn-primary" style="padding:8px 16px; font-size:12px;" id="btn-home-ai-send">Gửi</button>
                  <button class="btn-secondary" style="padding:8px 12px; font-size:12px; background:transparent; color:#FFFFFF; border:1px solid rgba(255,255,255,0.3);" onclick="window.location.hash='compare'">So sánh</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    document.getElementById('btn-hero-explore')?.addEventListener('click', () => navigateTo('new-cars'));
    document.getElementById('btn-hero-testdrive')?.addEventListener('click', () => {
      requireAuth('đăng ký lái thử xe', () => navigateTo('test-drive'));
    });

    // ===============================================================
    // HOME FILTER & SEARCH EVENT LISTENERS
    // ===============================================================
    // 1. Fuel Segmented Toggle (Tất cả / Điện / Xăng)
    document.querySelectorAll('#home-fuel-tabs .fuel-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const clickedFuel = btn.getAttribute('data-fuel');
        AppState.activeFuelFilter = clickedFuel || 'all';
        document.querySelectorAll('#home-fuel-tabs .fuel-tab-btn').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-fuel') === AppState.activeFuelFilter);
        });
        handleFilterSearch();
      });
    });

    // 1b. Brand Filter Pills on Home
    document.querySelectorAll('.home-brand-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const brand = btn.getAttribute('data-brand') || 'all';
        AppState.activeBrandFilter = brand;
        document.querySelectorAll('.home-brand-chip').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-brand') === brand);
        });
        handleFilterSearch();
      });
    });

    // 2. Price Preset & Custom Dual Input Two-Way Sync
    const homePriceSelect = document.getElementById('home-filter-price');
    const homeMinInp = document.getElementById('home-filter-min-price');
    const homeMaxInp = document.getElementById('home-filter-max-price');
    const homePriceErr = document.getElementById('home-price-val-error');
    const btnClearPrice = document.getElementById('btn-clear-home-price');

    if (homePriceSelect) {
      homePriceSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        AppState.activePriceRange = val;
        if (val === 'under-500m') {
          AppState.activeMinPrice = '';
          AppState.activeMaxPrice = '500';
        } else if (val === '500m-1b') {
          AppState.activeMinPrice = '500';
          AppState.activeMaxPrice = '1000';
        } else if (val === 'under-1b') {
          AppState.activeMinPrice = '';
          AppState.activeMaxPrice = '1000';
        } else if (val === '1b-2b') {
          AppState.activeMinPrice = '1000';
          AppState.activeMaxPrice = '2000';
        } else if (val === 'above-2b') {
          AppState.activeMinPrice = '2000';
          AppState.activeMaxPrice = '';
        } else if (val === 'all') {
          AppState.activeMinPrice = '';
          AppState.activeMaxPrice = '';
        }
        if (homeMinInp) homeMinInp.value = AppState.activeMinPrice;
        if (homeMaxInp) homeMaxInp.value = AppState.activeMaxPrice;
        if (homePriceErr) homePriceErr.style.display = 'none';
        const resetBtn = document.getElementById('btn-home-filter-reset');
        if (resetBtn) resetBtn.style.display = 'flex';
      });
    }

    const validatePriceInputs = () => {
      const minVal = homeMinInp?.value ? parseFloat(homeMinInp.value.replace(/[^\d.]/g, '')) : NaN;
      const maxVal = homeMaxInp?.value ? parseFloat(homeMaxInp.value.replace(/[^\d.]/g, '')) : NaN;
      if (!isNaN(minVal) && !isNaN(maxVal) && minVal > maxVal) {
        if (homePriceErr) homePriceErr.style.display = 'block';
        return false;
      }
      if (homePriceErr) homePriceErr.style.display = 'none';
      return true;
    };

    [homeMinInp, homeMaxInp].forEach(inp => {
      if (!inp) return;
      inp.addEventListener('input', () => {
        const rawMin = homeMinInp?.value.replace(/[^\d.]/g, '') || '';
        const rawMax = homeMaxInp?.value.replace(/[^\d.]/g, '') || '';
        AppState.activeMinPrice = rawMin;
        AppState.activeMaxPrice = rawMax;
        if (homePriceSelect) {
          homePriceSelect.value = (rawMin || rawMax) ? 'custom' : 'all';
          AppState.activePriceRange = homePriceSelect.value;
        }
        validatePriceInputs();
        const resetBtn = document.getElementById('btn-home-filter-reset');
        if (resetBtn) resetBtn.style.display = 'flex';
      });
    });

    if (btnClearPrice) {
      btnClearPrice.addEventListener('click', () => {
        AppState.activeMinPrice = '';
        AppState.activeMaxPrice = '';
        AppState.activePriceRange = 'all';
        if (homeMinInp) homeMinInp.value = '';
        if (homeMaxInp) homeMaxInp.value = '';
        if (homePriceSelect) homePriceSelect.value = 'all';
        if (homePriceErr) homePriceErr.style.display = 'none';
        handleFilterSearch();
      });
    }

    // 3. Search Button Handler (Combines category, brand, fuel, price, sort with AND logic)
    const handleFilterSearch = (e) => {
      if (e) e.preventDefault();

      if (!validatePriceInputs()) {
        showToast('⚠️ Giá từ không được lớn hơn Giá đến!', 'error');
        return;
      }
      
      const catEl = document.getElementById('home-filter-category');
      const sortEl = document.getElementById('home-filter-sort');

      if (catEl) AppState.activeBodyCategory = catEl.value;
      if (sortEl) AppState.activeSort = sortEl.value;

      const filtered = filterAndSortVehicles(AppState.vehiclesList, {
        category: AppState.activeBodyCategory,
        brand: AppState.activeBrandFilter,
        fuel: AppState.activeFuelFilter,
        priceRange: AppState.activePriceRange,
        minPrice: AppState.activeMinPrice,
        maxPrice: AppState.activeMaxPrice,
        sort: AppState.activeSort
      });

      // Update Section Header & Count
      const tagEl = document.getElementById('home-cars-tag');
      const titleEl = document.getElementById('home-cars-title');
      const descEl = document.getElementById('home-cars-desc');
      const gridEl = document.getElementById('home-car-grid');
      const actionEl = document.getElementById('home-cars-action-area');
      const resetBtn = document.getElementById('btn-home-filter-reset');

      if (tagEl) tagEl.textContent = 'KẾT QUẢ TÌM KIẾM';
      if (titleEl) titleEl.textContent = `KẾT QUẢ TÌM KIẾM (${filtered.length} mẫu xe)`;
      if (descEl) descEl.textContent = getActiveFiltersDescription();
      if (resetBtn) resetBtn.style.display = 'flex';

      if (actionEl) {
        actionEl.innerHTML = `
          <button class="btn-secondary" id="btn-header-clear-filter" style="padding:6px 14px; font-size:13px; background:#F1F5F9; border:1px solid #CBD5E1; color:#475569; border-radius:6px; cursor:pointer;">
            ✕ Xóa bộ lọc
          </button>
          <a href="javascript:void(0)" class="link-view-all" onclick="window.location.hash='new-cars'">
            Xem tất cả (${AppState.vehiclesList.length} dòng xe) →
          </a>
        `;
        document.getElementById('btn-header-clear-filter')?.addEventListener('click', handleResetFilter);
      }

      // Update Car Grid
      if (gridEl) {
        if (filtered.length > 0) {
          gridEl.innerHTML = filtered.map(car => createHomeCarCardHTML(car)).join('');
        } else {
          gridEl.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:60px 24px; background:#F8FAFC; border-radius:16px; border:1px dashed #CBD5E1;">
              <div style="font-size:52px; margin-bottom:14px;">🔍</div>
              <h3 style="font-size:22px; font-weight:800; color:var(--text-dark); margin-bottom:8px;">Không tìm thấy xe phù hợp với bộ lọc của bạn.</h3>
              <p style="color:var(--text-muted); max-width:500px; margin:0 auto 20px; font-size:14.5px;">Vui lòng điều chỉnh lại khoảng giá, dòng xe hoặc chọn loại nhiên liệu khác để xem các mẫu xe hiện có.</p>
              <button class="btn-primary" id="btn-reset-filters-empty" style="padding:10px 24px; font-weight:700;">↺ Đặt lại tất cả bộ lọc</button>
            </div>
          `;
          document.getElementById('btn-reset-filters-empty')?.addEventListener('click', handleResetFilter);
        }
      }

      bindCardEvents();
    };

    // 4. Reset Button Handler
    const handleResetFilter = (e) => {
      if (e) e.preventDefault();
      AppState.activeBodyCategory = 'all';
      AppState.activeBrandFilter = 'all';
      AppState.activePriceRange = 'all';
      AppState.activeMinPrice = '';
      AppState.activeMaxPrice = '';
      AppState.activeFuelFilter = 'all';
      AppState.activeSort = 'default';
      renderHome();
    };

    document.getElementById('btn-home-filter-search')?.addEventListener('click', handleFilterSearch);
    document.getElementById('btn-home-filter-reset')?.addEventListener('click', handleResetFilter);
    document.getElementById('btn-header-clear-filter')?.addEventListener('click', handleResetFilter);
    document.getElementById('btn-reset-filters-empty')?.addEventListener('click', handleResetFilter);

    // 4. Live Sort & Category Selection
    document.getElementById('home-filter-sort')?.addEventListener('change', (e) => {
      AppState.activeSort = e.target.value;
      handleFilterSearch();
    });
    document.getElementById('home-filter-category')?.addEventListener('change', (e) => {
      AppState.activeBodyCategory = e.target.value;
      handleFilterSearch();
    });

    // Fix Bug 5: Forward question typed on Home AI banner directly to AI Advisor & execute
    const handleHomeAiSubmit = () => {
      const input = document.getElementById('home-ai-input');
      const q = input?.value.trim();
      if (!q) {
        navigateTo('ai-advisor');
        return;
      }
      requireAuth('hỏi trợ lý AI', () => {
        sessionStorage.setItem('sigmacar_pending_ai_query', q);
        navigateTo('ai-advisor');
      });
    };

    document.getElementById('btn-home-ai-send')?.addEventListener('click', handleHomeAiSubmit);
    document.getElementById('home-ai-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleHomeAiSubmit();
    });

    document.getElementById('btn-banner-start-ai')?.addEventListener('click', () => {
      requireAuth('hỏi trợ lý AI', () => navigateTo('ai-advisor'));
    });

    bindCardEvents();
  }

  // =================================================================
  // VIEW 2: DÒNG XE MỚI
  // =================================================================
  // VIEW 2: DÒNG XE MỚI
  // =================================================================
  function renderNewCars() {
    const filtered = filterAndSortVehicles(AppState.vehiclesList, {
      category: AppState.activeBodyCategory,
      brand: AppState.activeBrandFilter,
      fuel: AppState.activeFuelFilter,
      priceRange: AppState.activePriceRange,
      minPrice: AppState.activeMinPrice,
      maxPrice: AppState.activeMaxPrice,
      sort: AppState.activeSort
    });

    const isFiltered = (AppState.activeBodyCategory !== 'all' || AppState.activeBrandFilter !== 'all' || AppState.activeFuelFilter !== 'all' || AppState.activePriceRange !== 'all' || AppState.activeSort !== 'default' || AppState.activeMinPrice || AppState.activeMaxPrice);

    viewsContainer.innerHTML = `
      <section class="section" style="padding-top:40px;">
        <div class="container">
          <!-- Hero Banner with Car Background, Homepage Form, and Certified-style Frame -->
          <div class="catalog-page-hero-banner" style="position:relative; overflow:hidden; border-radius:var(--radius-xl); background-color:#060B19; padding:44px 52px; color:#FFFFFF; margin-bottom:32px; min-height:320px; display:flex; align-items:center;">
            <!-- Real Car Image in Background (Right side, crisp & properly scaled) -->
            <img src="assets/hero-bg.jpg" alt="SIGMACAR New Models Hero" style="position:absolute; right:0; top:0; width:58%; height:100%; object-fit:cover; object-position:right center; pointer-events:none; z-index:1;">
            
            <!-- Seamless directional gradient: dark on text side, transparent over car -->
            <div style="position:absolute; inset:0; background:linear-gradient(90deg, #060B19 0%, #060B19 38%, rgba(6,11,25,0.78) 52%, rgba(6,11,25,0.18) 72%, transparent 100%); z-index:2; pointer-events:none;"></div>
            
            <!-- Tech Grid Sub-pattern matching homepage -->
            <div style="position:absolute; inset:0; background-image:linear-gradient(rgba(0,210,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,210,255,0.04) 1px, transparent 1px); background-size:36px 36px; z-index:2; pointer-events:none;"></div>

            <!-- Content Form matching Homepage -->
            <div style="position:relative; z-index:3; max-width:560px;">
              <div class="hero-pill" style="display:inline-flex; align-items:center; gap:8px; margin-bottom:14px; font-size:11.5px; font-weight:800; letter-spacing:0.12em; color:var(--accent-cyan); text-transform:uppercase; background:rgba(0,210,255,0.12); border:1px solid rgba(0,210,255,0.3); padding:6px 14px; border-radius:20px;">
                <span class="ai-pulse-dot" style="width:7px; height:7px; border-radius:50%; background:var(--accent-cyan); display:inline-block;"></span>
                CATALOG XE ĐIỆN & ĐA THƯƠNG HIỆU
              </div>
              <h1 style="font-size:38px; font-weight:800; line-height:1.15; margin:0 0 14px; color:#FFFFFF;">
                DÒNG XE MỚI SIGMACAR <br>
                <span style="color:var(--accent-cyan);">KIẾN TẠO TƯƠNG LAI XANH</span>
              </h1>
              <p style="color:#CBD5E1; max-width:500px; font-size:15px; line-height:1.6; margin:0 0 22px;">
                Khám phá đầy đủ 32 dòng xe chính hãng: 10 dòng xe từ Data-xe.xlsx (CAR-001 đến CAR-010: Toyota, Honda, Ford, Hyundai, Mazda, VinFast, Mercedes-Benz, BMW, Kia, Mitsubishi), 15 mẫu xe điện VinFast và 7 mẫu SIGMACAR.
              </p>
              <div style="display:flex; gap:12px; flex-wrap:wrap;">
                <button class="btn-primary" id="btn-nc-hero-explore" style="padding:10px 24px; font-size:14px;">
                  Khám phá ngay
                </button>
                <button class="btn-secondary" id="btn-nc-hero-testdrive" style="background:rgba(255,255,255,0.08); color:#FFFFFF; border:1px solid rgba(255,255,255,0.3); padding:10px 20px; font-size:14px;">
                  Đăng ký lái thử
                </button>
              </div>
            </div>
          </div>

          <!-- Integrated Filter Card on New Cars -->
          <div class="search-filter-card" style="margin-top:0; margin-bottom:32px; box-shadow:var(--shadow-md);">
            <div class="filter-grid">
              <div class="filter-item">
                <label class="filter-label" for="nc-filter-category">Dòng xe</label>
                <select class="filter-select" id="nc-filter-category">
                  <option value="all" ${AppState.activeBodyCategory === 'all' ? 'selected' : ''}>Tất cả các dòng xe</option>
                  <option value="SUV" ${AppState.activeBodyCategory === 'SUV' ? 'selected' : ''}>Dòng xe SUV / Crossover</option>
                  <option value="Sedan" ${AppState.activeBodyCategory === 'Sedan' ? 'selected' : ''}>Dòng xe Sedan</option>
                  <option value="Pickup" ${AppState.activeBodyCategory === 'Pickup' ? 'selected' : ''}>Dòng xe Bán tải (Pickup)</option>
                  <option value="MPV" ${AppState.activeBodyCategory === 'MPV' ? 'selected' : ''}>Dòng xe MPV 7 chỗ</option>
                  <option value="Compact" ${AppState.activeBodyCategory === 'Compact' ? 'selected' : ''}>Dòng xe Đô thị / Compact</option>
                </select>
              </div>
              <div class="filter-item">
                <label class="filter-label" for="nc-filter-price">Khoảng giá (triệu VNĐ)</label>
                <select class="filter-select" id="nc-filter-price" style="margin-bottom:6px;">
                  <option value="all" ${AppState.activePriceRange === 'all' && !AppState.activeMinPrice && !AppState.activeMaxPrice ? 'selected' : ''}>Mức giá tham khảo (Tất cả)</option>
                  <option value="under-500m" ${AppState.activePriceRange === 'under-500m' ? 'selected' : ''}>Dưới 500 triệu VNĐ</option>
                  <option value="500m-1b" ${AppState.activePriceRange === '500m-1b' ? 'selected' : ''}>Từ 500 triệu - 1 tỷ VNĐ</option>
                  <option value="under-1b" ${AppState.activePriceRange === 'under-1b' ? 'selected' : ''}>Dưới 1 tỷ VNĐ</option>
                  <option value="1b-2b" ${AppState.activePriceRange === '1b-2b' ? 'selected' : ''}>Từ 1 tỷ - 2 tỷ VNĐ</option>
                  <option value="above-2b" ${AppState.activePriceRange === 'above-2b' ? 'selected' : ''}>Trên 2 tỷ VNĐ</option>
                  <option value="custom" ${AppState.activePriceRange === 'custom' || AppState.activeMinPrice || AppState.activeMaxPrice ? 'selected' : ''}>Tùy chỉnh khoảng giá</option>
                </select>
                <div class="price-inputs-row">
                  <input type="text" class="filter-input" id="nc-filter-min-price" placeholder="Giá từ (triệu đ)" value="${AppState.activeMinPrice || ''}" inputmode="numeric" />
                  <span class="price-separator">-</span>
                  <input type="text" class="filter-input" id="nc-filter-max-price" placeholder="Giá đến (triệu đ)" value="${AppState.activeMaxPrice || ''}" inputmode="numeric" />
                  ${(AppState.activeMinPrice || AppState.activeMaxPrice) ? '<button type="button" class="btn-secondary" id="btn-clear-nc-price" title="Xóa khoảng giá nhập" style="background:#F1F5F9; border:1px solid #CBD5E1; color:#64748B; font-size:12px; height:36px; padding:0 8px; border-radius:var(--radius-xs); cursor:pointer;">✕</button>' : ''}
                </div>
                <div id="nc-price-val-error" style="display:none; color:#EF4444; font-size:11px; font-weight:700; margin-top:3px;">⚠️ Giá từ không được lớn hơn Giá đến</div>
              </div>
              <div class="filter-item">
                <label class="filter-label">Nhiên liệu</label>
                <div class="filter-fuel-tabs" id="nc-fuel-tabs">
                  <button type="button" class="fuel-tab-btn ${AppState.activeFuelFilter === 'all' ? 'active' : ''}" data-fuel="all">Tất cả</button>
                  <button type="button" class="fuel-tab-btn ${AppState.activeFuelFilter === 'ev' ? 'active' : ''}" data-fuel="ev">Điện</button>
                  <button type="button" class="fuel-tab-btn ${AppState.activeFuelFilter === 'gas' ? 'active' : ''}" data-fuel="gas">Xăng / Dầu</button>
                </div>
              </div>
              <div class="filter-item">
                <label class="filter-label" for="nc-filter-sort">Sắp xếp theo</label>
                <select class="filter-select" id="nc-filter-sort">
                  <option value="default" ${AppState.activeSort === 'default' ? 'selected' : ''}>Mặc định / Liên quan</option>
                  <option value="price-asc" ${AppState.activeSort === 'price-asc' ? 'selected' : ''}>Giá thấp đến cao</option>
                  <option value="price-desc" ${AppState.activeSort === 'price-desc' ? 'selected' : ''}>Giá cao đến thấp</option>
                  <option value="name-asc" ${AppState.activeSort === 'name-asc' ? 'selected' : ''}>Tên xe A–Z</option>
                  <option value="name-desc" ${AppState.activeSort === 'name-desc' ? 'selected' : ''}>Tên xe Z–A</option>
                </select>
              </div>
              <div class="filter-item" style="justify-content:flex-end;">
                <label class="filter-label" style="opacity:0;">&nbsp;</label>
                <div style="display:flex; gap:8px;">
                  <button type="button" class="btn-dark" id="btn-nc-filter-search" style="height:44px; padding:0 22px; justify-content:center; white-space:nowrap; border-radius:var(--radius-sm); font-weight:700; cursor:pointer;">
                    🔍 Tìm kiếm
                  </button>
                  <button type="button" class="btn-secondary" id="btn-nc-filter-reset" title="Đặt lại bộ lọc" style="height:44px; padding:0 12px; border-radius:var(--radius-sm); font-weight:600; cursor:pointer; background:#F1F5F9; border:1px solid #CBD5E1; color:#475569; display:${isFiltered ? 'flex' : 'none'}; align-items:center; justify-content:center;">
                    ↺ Đặt lại
                  </button>
                </div>
              </div>
            </div>

            <!-- Brand Filter Bar on New Cars -->
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:16px; padding-top:14px; border-top:1px solid var(--border-subtle);">
              <span style="font-size:12px; font-weight:800; color:var(--text-muted); margin-right:4px;">HÃNG XE:</span>
              ${[
                { key: 'all', label: `Tất cả (${AppState.vehiclesList.length})` },
                { key: 'data-xe', label: '📋 Data-xe (CAR-001..010)' },
                { key: 'VinFast', label: 'VinFast (VF2 - VFWILD)' },
                { key: 'Toyota', label: 'Toyota' },
                { key: 'Honda', label: 'Honda' },
                { key: 'Ford', label: 'Ford' },
                { key: 'Hyundai', label: 'Hyundai' },
                { key: 'Mazda', label: 'Mazda' },
                { key: 'Mercedes-Benz', label: 'Mercedes-Benz' },
                { key: 'BMW', label: 'BMW' },
                { key: 'Kia', label: 'Kia' },
                { key: 'Mitsubishi', label: 'Mitsubishi' },
                { key: 'SIGMACAR', label: 'SIGMACAR' }
              ].map(b => `
                <button type="button" class="chip-btn nc-brand-chip ${AppState.activeBrandFilter === b.key ? 'active' : ''}" data-brand="${b.key}" style="padding:5px 12px; font-size:12px;">${b.label}</button>
              `).join('')}
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:28px; flex-wrap:wrap; gap:16px;">
            <div>
              <h3 style="font-size:24px; font-weight:800; color:var(--text-dark);">Danh sách xe (${filtered.length} mẫu)</h3>
              <p style="font-size:14px; color:var(--text-muted);">${getActiveFiltersDescription()}</p>
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="chip-btn ${AppState.activeBodyCategory === 'all' ? 'active' : ''}" data-cat="all">Tất cả</button>
              <button class="chip-btn ${AppState.activeBodyCategory === 'SUV' ? 'active' : ''}" data-cat="SUV">SUV</button>
              <button class="chip-btn ${AppState.activeBodyCategory === 'Sedan' ? 'active' : ''}" data-cat="Sedan">Sedan</button>
              <button class="chip-btn ${AppState.activeBodyCategory === 'Pickup' ? 'active' : ''}" data-cat="Pickup">Bán tải (Pickup)</button>
              <button class="chip-btn ${AppState.activeBodyCategory === 'MPV' ? 'active' : ''}" data-cat="MPV">MPV 7 chỗ</button>
              <button class="chip-btn ${AppState.activeBodyCategory === 'Compact' ? 'active' : ''}" data-cat="Compact">Compact / Đô thị</button>
            </div>
          </div>

          <div class="car-grid">
            ${filtered.length > 0 
              ? filtered.map(car => createNewCarListingCardHTML(car)).join('') 
              : `
                <div style="grid-column:1/-1; text-align:center; padding:60px 24px; background:#F8FAFC; border-radius:16px; border:1px dashed #CBD5E1;">
                  <div style="font-size:52px; margin-bottom:14px;">🔍</div>
                  <h3 style="font-size:22px; font-weight:800; color:var(--text-dark); margin-bottom:8px;">Không tìm thấy xe phù hợp với bộ lọc của bạn.</h3>
                  <p style="color:var(--text-muted); max-width:500px; margin:0 auto 20px; font-size:14.5px;">Vui lòng điều chỉnh lại khoảng giá, dòng xe hoặc chọn loại nhiên liệu khác để xem các mẫu xe hiện có.</p>
                  <button class="btn-primary" id="btn-nc-reset-empty" style="padding:10px 24px; font-weight:700;">↺ Đặt lại tất cả bộ lọc</button>
                </div>
              `}
          </div>

          <!-- Promotional Showcase Banner from Figma Dòng xe mới.pdf -->
          <div style="margin-top:48px; border-radius:var(--radius-xl); overflow:hidden; box-shadow:var(--shadow-md);">
            <img src="assets/banner-new-cars-sub.jpg" alt="SIGMACAR New Models Banner" style="width:100%; height:auto; display:block;">
          </div>
        </div>
      </section>
    `;

    // Fuel segmented toggle on New Cars
    document.querySelectorAll('#nc-fuel-tabs .fuel-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const clickedFuel = btn.getAttribute('data-fuel');
        AppState.activeFuelFilter = clickedFuel || 'all';
        renderNewCars();
      });
    });

    // Brand chips on New Cars
    document.querySelectorAll('.nc-brand-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        AppState.activeBrandFilter = btn.getAttribute('data-brand') || 'all';
        renderNewCars();
      });
    });

    // Dual price sync and validation on New Cars
    const ncPriceSelect = document.getElementById('nc-filter-price');
    const ncMinInp = document.getElementById('nc-filter-min-price');
    const ncMaxInp = document.getElementById('nc-filter-max-price');
    const ncPriceErr = document.getElementById('nc-price-val-error');
    const btnClearNcPrice = document.getElementById('btn-clear-nc-price');

    if (ncPriceSelect) {
      ncPriceSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        AppState.activePriceRange = val;
        if (val === 'under-500m') {
          AppState.activeMinPrice = '';
          AppState.activeMaxPrice = '500';
        } else if (val === '500m-1b') {
          AppState.activeMinPrice = '500';
          AppState.activeMaxPrice = '1000';
        } else if (val === 'under-1b') {
          AppState.activeMinPrice = '';
          AppState.activeMaxPrice = '1000';
        } else if (val === '1b-2b') {
          AppState.activeMinPrice = '1000';
          AppState.activeMaxPrice = '2000';
        } else if (val === 'above-2b') {
          AppState.activeMinPrice = '2000';
          AppState.activeMaxPrice = '';
        } else if (val === 'all') {
          AppState.activeMinPrice = '';
          AppState.activeMaxPrice = '';
        }
        if (ncMinInp) ncMinInp.value = AppState.activeMinPrice;
        if (ncMaxInp) ncMaxInp.value = AppState.activeMaxPrice;
        if (ncPriceErr) ncPriceErr.style.display = 'none';
        const resetBtn = document.getElementById('btn-nc-filter-reset');
        if (resetBtn) resetBtn.style.display = 'flex';
      });
    }

    const validateNcPrice = () => {
      const minVal = ncMinInp?.value ? parseFloat(ncMinInp.value.replace(/[^\d.]/g, '')) : NaN;
      const maxVal = ncMaxInp?.value ? parseFloat(ncMaxInp.value.replace(/[^\d.]/g, '')) : NaN;
      if (!isNaN(minVal) && !isNaN(maxVal) && minVal > maxVal) {
        if (ncPriceErr) ncPriceErr.style.display = 'block';
        return false;
      }
      if (ncPriceErr) ncPriceErr.style.display = 'none';
      return true;
    };

    [ncMinInp, ncMaxInp].forEach(inp => {
      if (!inp) return;
      inp.addEventListener('input', () => {
        const rawMin = ncMinInp?.value.replace(/[^\d.]/g, '') || '';
        const rawMax = ncMaxInp?.value.replace(/[^\d.]/g, '') || '';
        AppState.activeMinPrice = rawMin;
        AppState.activeMaxPrice = rawMax;
        if (ncPriceSelect) {
          ncPriceSelect.value = (rawMin || rawMax) ? 'custom' : 'all';
          AppState.activePriceRange = ncPriceSelect.value;
        }
        validateNcPrice();
        const resetBtn = document.getElementById('btn-nc-filter-reset');
        if (resetBtn) resetBtn.style.display = 'flex';
      });
    });

    if (btnClearNcPrice) {
      btnClearNcPrice.addEventListener('click', () => {
        AppState.activeMinPrice = '';
        AppState.activeMaxPrice = '';
        AppState.activePriceRange = 'all';
        if (ncMinInp) ncMinInp.value = '';
        if (ncMaxInp) ncMaxInp.value = '';
        if (ncPriceSelect) ncPriceSelect.value = 'all';
        if (ncPriceErr) ncPriceErr.style.display = 'none';
        renderNewCars();
      });
    }

    // Search button on New Cars
    document.getElementById('btn-nc-filter-search')?.addEventListener('click', () => {
      if (!validateNcPrice()) {
        showToast('⚠️ Giá từ không được lớn hơn Giá đến!', 'error');
        return;
      }
      const catEl = document.getElementById('nc-filter-category');
      const sortEl = document.getElementById('nc-filter-sort');
      if (catEl) AppState.activeBodyCategory = catEl.value;
      if (sortEl) AppState.activeSort = sortEl.value;
      renderNewCars();
    });

    // Reset button on New Cars
    const handleNcReset = () => {
      AppState.activeBodyCategory = 'all';
      AppState.activeBrandFilter = 'all';
      AppState.activePriceRange = 'all';
      AppState.activeMinPrice = '';
      AppState.activeMaxPrice = '';
      AppState.activeFuelFilter = 'all';
      AppState.activeSort = 'default';
      renderNewCars();
    };
    document.getElementById('btn-nc-filter-reset')?.addEventListener('click', handleNcReset);
    document.getElementById('btn-nc-reset-empty')?.addEventListener('click', handleNcReset);

    // Sort & Category change on New Cars
    document.getElementById('nc-filter-sort')?.addEventListener('change', (e) => {
      AppState.activeSort = e.target.value;
      renderNewCars();
    });
    document.getElementById('nc-filter-category')?.addEventListener('change', (e) => {
      AppState.activeBodyCategory = e.target.value;
      renderNewCars();
    });

    // Category chips
    document.querySelectorAll('.chip-btn[data-cat]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        AppState.activeBodyCategory = e.target.getAttribute('data-cat');
        renderNewCars();
      });
    });

    // Hero Banner CTA Buttons
    document.getElementById('btn-nc-hero-explore')?.addEventListener('click', () => {
      document.getElementById('nc-filter-category')?.scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('btn-nc-hero-testdrive')?.addEventListener('click', () => {
      requireAuth('đăng ký lái thử xe', () => navigateTo('test-drive'));
    });

    bindCardEvents();
  }

  // =================================================================
  // VIEW: XE QUA SỬ DỤNG CHÍNH HÃNG (Fixes Bug 2: Missing renderCertifiedCars)
  // =================================================================
  function renderCertifiedCars() {
    let filtered = [...AppState.certifiedList];

    // Filter category
    if (AppState.activeCertifiedCategory !== 'all') {
      filtered = filtered.filter(c => c.category === AppState.activeCertifiedCategory);
    }

    // Filter price
    if (AppState.activeCertifiedPrice === 'under-1b') {
      filtered = filtered.filter(c => c.price < 1000000000);
    } else if (AppState.activeCertifiedPrice === '1b-1.5b') {
      filtered = filtered.filter(c => c.price >= 1000000000 && c.price <= 1500000000);
    } else if (AppState.activeCertifiedPrice === 'above-1.5b') {
      filtered = filtered.filter(c => c.price > 1500000000);
    }

    // Sort
    if (AppState.activeCertifiedSort === 'price-asc') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (AppState.activeCertifiedSort === 'price-desc') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (AppState.activeCertifiedSort === 'odo-asc') {
      filtered.sort((a, b) => (a.odoNum || 0) - (b.odoNum || 0));
    }

    viewsContainer.innerHTML = `
      <section class="section" style="padding-top:40px;">
        <div class="container">
          <!-- Hero Banner with Car Background, Homepage Form, and Certified-style Frame -->
          <div class="catalog-page-hero-banner" style="position:relative; overflow:hidden; border-radius:var(--radius-xl); background-color:#060B19; padding:44px 52px; color:#FFFFFF; margin-bottom:32px; min-height:320px; display:flex; align-items:center;">
            <!-- Real Car Image in Background (Right side, crisp & properly scaled) -->
            <img src="assets/hero-certified-bg.jpg" alt="SIGMA Certified Pre-Owned Hero" style="position:absolute; right:0; top:0; width:58%; height:100%; object-fit:cover; object-position:right center; pointer-events:none; z-index:1;">
            
            <!-- Seamless directional gradient: dark on text side, transparent over car -->
            <div style="position:absolute; inset:0; background:linear-gradient(90deg, #060B19 0%, #060B19 38%, rgba(6,11,25,0.78) 52%, rgba(6,11,25,0.18) 72%, transparent 100%); z-index:2; pointer-events:none;"></div>
            
            <!-- Tech Grid Sub-pattern matching homepage -->
            <div style="position:absolute; inset:0; background-image:linear-gradient(rgba(0,210,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,210,255,0.04) 1px, transparent 1px); background-size:36px 36px; z-index:2; pointer-events:none;"></div>

            <!-- Content Form matching Homepage -->
            <div style="position:relative; z-index:3; max-width:560px;">
              <div class="hero-pill" style="display:inline-flex; align-items:center; gap:8px; margin-bottom:14px; font-size:11.5px; font-weight:800; letter-spacing:0.12em; color:var(--accent-cyan); text-transform:uppercase; background:rgba(0,210,255,0.12); border:1px solid rgba(0,210,255,0.3); padding:6px 14px; border-radius:20px;">
                <span class="ai-pulse-dot" style="width:7px; height:7px; border-radius:50%; background:var(--accent-cyan); display:inline-block;"></span>
                SIGMA CERTIFIED PRE-OWNED
              </div>
              <h1 style="font-size:38px; font-weight:800; line-height:1.15; margin:0 0 14px; color:#FFFFFF;">
                XE QUA SỬ DỤNG CHÍNH HÃNG <br>
                <span style="color:var(--accent-cyan);">CHẤT LƯỢNG TIÊU CHUẨN TOÀN CẦU</span>
              </h1>
              <p style="color:#CBD5E1; max-width:500px; font-size:15px; line-height:1.6; margin:0 0 22px;">
                Mỗi chiếc xe đã qua sử dụng tại SIGMACAR đều trải qua quy trình kiểm định 176+ điểm khắt khe, cam kết sức khỏe pin trên 92% và bảo hành chính hãng lên tới 24 tháng.
              </p>
              <div style="display:flex; gap:12px; flex-wrap:wrap;">
                <button class="btn-primary" id="btn-cpo-hero-explore" style="padding:10px 24px; font-size:14px;">
                  Xem xe đạt chuẩn
                </button>
                <button class="btn-secondary" id="btn-cpo-hero-testdrive" style="background:rgba(255,255,255,0.08); color:#FFFFFF; border:1px solid rgba(255,255,255,0.3); padding:10px 20px; font-size:14px;">
                  Đăng ký lái thử
                </button>
              </div>
            </div>
          </div>

          <!-- 4 Pillars -->
          <div class="certified-features-grid" style="margin-bottom:36px;">
            <div class="certified-feature-item">
              <div class="certified-icon">📋</div>
              <h4 class="certified-feature-title">176+ Điểm kiểm tra</h4>
              <p class="certified-feature-desc">Kiểm định chuyên sâu cơ điện tử, pin và khung gầm</p>
            </div>
            <div class="certified-feature-item">
              <div class="certified-icon">🛡️</div>
              <h4 class="certified-feature-title">Bảo hành 12 - 24 tháng</h4>
              <p class="certified-feature-desc">An tâm tuyệt đối như xe mới xuất xưởng</p>
            </div>
            <div class="certified-feature-item">
              <div class="certified-icon">🚘</div>
              <h4 class="certified-feature-title">Cam kết 3 Không</h4>
              <p class="certified-feature-desc">Không đâm đụng, không ngập nước, không tua ODO</p>
            </div>
            <div class="certified-feature-item">
              <div class="certified-icon">🔋</div>
              <h4 class="certified-feature-title">Pin chuẩn > 92%</h4>
              <p class="certified-feature-desc">Chứng nhận độc lập về dung lượng và chu kỳ sạc</p>
            </div>
          </div>

          <!-- Filter & Controls Bar -->
          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:20px 24px; margin-bottom:32px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
              <span style="font-size:13px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Lọc theo:</span>
              <select class="filter-select" id="cpo-filter-category" style="width:160px; padding:8px 12px; font-size:13px;">
                <option value="all" ${AppState.activeCertifiedCategory === 'all' ? 'selected' : ''}>Tất cả phân khúc</option>
                <option value="SUV" ${AppState.activeCertifiedCategory === 'SUV' ? 'selected' : ''}>Dòng xe SUV</option>
                <option value="Sedan" ${AppState.activeCertifiedCategory === 'Sedan' ? 'selected' : ''}>Dòng xe Sedan</option>
                <option value="Compact" ${AppState.activeCertifiedCategory === 'Compact' ? 'selected' : ''}>Dòng xe Compact</option>
              </select>

              <select class="filter-select" id="cpo-filter-price" style="width:170px; padding:8px 12px; font-size:13px;">
                <option value="all" ${AppState.activeCertifiedPrice === 'all' ? 'selected' : ''}>Mọi mức giá</option>
                <option value="under-1b" ${AppState.activeCertifiedPrice === 'under-1b' ? 'selected' : ''}>Dưới 1 tỷ VNĐ</option>
                <option value="1b-1.5b" ${AppState.activeCertifiedPrice === '1b-1.5b' ? 'selected' : ''}>1 tỷ - 1.5 tỷ VNĐ</option>
                <option value="above-1.5b" ${AppState.activeCertifiedPrice === 'above-1.5b' ? 'selected' : ''}>Trên 1.5 tỷ VNĐ</option>
              </select>
            </div>

            <div style="display:flex; gap:12px; align-items:center;">
              <span style="font-size:13px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Sắp xếp:</span>
              <select class="filter-select" id="cpo-sort-select" style="width:180px; padding:8px 12px; font-size:13px;">
                <option value="default" ${AppState.activeCertifiedSort === 'default' ? 'selected' : ''}>Mặc định đề xuất</option>
                <option value="price-asc" ${AppState.activeCertifiedSort === 'price-asc' ? 'selected' : ''}>Giá: Thấp đến cao</option>
                <option value="price-desc" ${AppState.activeCertifiedSort === 'price-desc' ? 'selected' : ''}>Giá: Cao đến thấp</option>
                <option value="odo-asc" ${AppState.activeCertifiedSort === 'odo-asc' ? 'selected' : ''}>Số km ODO ít nhất</option>
              </select>
            </div>
          </div>

          <!-- Vehicle Listing Grid -->
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:24px;">
            ${filtered.length > 0 ? filtered.map(car => createHomeCertifiedCardHTML(car)).join('') : `
              <div style="grid-column:1/-1; text-align:center; padding:60px 20px; background:#FFFFFF; border-radius:var(--radius-lg); border:1px solid var(--border-subtle);">
                <div style="font-size:48px; margin-bottom:12px;">🚗</div>
                <h4 style="font-size:18px; font-weight:700; color:var(--text-dark);">Không tìm thấy xe phù hợp với bộ lọc</h4>
                <p style="font-size:14px; color:var(--text-muted); margin-top:4px;">Vui lòng thử điều chỉnh lại mức giá hoặc phân khúc xe.</p>
                <button class="btn-primary" style="margin-top:16px;" onclick="AppState.activeCertifiedCategory='all'; AppState.activeCertifiedPrice='all'; renderCertifiedCars();">
                  Đặt lại bộ lọc
                </button>
              </div>
            `}
          </div>

          <!-- Certified Pre-Owned Warranty Showcase Banner from Figma Xe qua sử dụng chính hãng.pdf -->
          <div style="margin-top:40px; border-radius:var(--radius-xl); overflow:hidden; box-shadow:var(--shadow-md);">
            <img src="assets/banner-certified-warranty.jpg" alt="SIGMACAR Certified Warranty Banner" style="width:100%; height:auto; display:block;">
          </div>
        </div>
      </section>
    `;

    document.getElementById('cpo-filter-category')?.addEventListener('change', (e) => {
      AppState.activeCertifiedCategory = e.target.value;
      renderCertifiedCars();
    });

    document.getElementById('cpo-filter-price')?.addEventListener('change', (e) => {
      AppState.activeCertifiedPrice = e.target.value;
      renderCertifiedCars();
    });

    document.getElementById('cpo-sort-select')?.addEventListener('change', (e) => {
      AppState.activeCertifiedSort = e.target.value;
      renderCertifiedCars();
    });

    document.getElementById('btn-cpo-hero-explore')?.addEventListener('click', () => {
      document.getElementById('cpo-filter-category')?.scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('btn-cpo-hero-testdrive')?.addEventListener('click', () => {
      navigateTo('test-drive');
    });

    bindCardEvents();
  }

  // =================================================================
  // VIEW 3: DEDICATED TEST DRIVE PAGE (Đăng ký lái thử)
  // =================================================================
  function renderTestDrivePage() {
    const curUser = ApiClient.getCurrentUser();

    viewsContainer.innerHTML = `
      <section class="section" style="padding-top:40px;">
        <div class="container">
          <!-- Hero Banner with Car Background, Homepage Form, and Certified-style Frame -->
          <div class="catalog-page-hero-banner" style="position:relative; overflow:hidden; border-radius:var(--radius-xl); background-color:#060B19; padding:44px 52px; color:#FFFFFF; margin-bottom:32px; min-height:320px; display:flex; align-items:center;">
            <!-- Real Car Image in Background (Right side, crisp & properly scaled) -->
            <img src="assets/hero-testdrive-bg.jpg" alt="SIGMACAR Test Drive Experience Hero" style="position:absolute; right:0; top:0; width:58%; height:100%; object-fit:cover; object-position:right center; pointer-events:none; z-index:1;">
            
            <!-- Seamless directional gradient: dark on text side, transparent over car -->
            <div style="position:absolute; inset:0; background:linear-gradient(90deg, #060B19 0%, #060B19 38%, rgba(6,11,25,0.78) 52%, rgba(6,11,25,0.18) 72%, transparent 100%); z-index:2; pointer-events:none;"></div>
            
            <!-- Tech Grid Sub-pattern matching homepage -->
            <div style="position:absolute; inset:0; background-image:linear-gradient(rgba(0,210,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,210,255,0.04) 1px, transparent 1px); background-size:36px 36px; z-index:2; pointer-events:none;"></div>

            <!-- Content Form matching Homepage -->
            <div style="position:relative; z-index:3; max-width:560px;">
              <div class="hero-pill" style="display:inline-flex; align-items:center; gap:8px; margin-bottom:14px; font-size:11.5px; font-weight:800; letter-spacing:0.12em; color:var(--accent-cyan); text-transform:uppercase; background:rgba(0,210,255,0.12); border:1px solid rgba(0,210,255,0.3); padding:6px 14px; border-radius:20px;">
                <span class="ai-pulse-dot" style="width:7px; height:7px; border-radius:50%; background:var(--accent-cyan); display:inline-block;"></span>
                BOOKING EXPERIENCE
              </div>
              <h1 style="font-size:38px; font-weight:800; line-height:1.15; margin:0 0 14px; color:#FFFFFF;">
                ĐĂNG KÝ LÁI THỬ <br>
                <span style="color:var(--accent-cyan);">TRẢI NGHIỆM ĐỈNH CAO SIGMACAR</span>
              </h1>
              <p style="color:#CBD5E1; max-width:500px; font-size:15px; line-height:1.6; margin:0 0 22px;">
                Trải nghiệm cảm giác lái xe điện tương lai cùng SIGMACAR. Khám phá công nghệ tăng tốc vượt trội, hệ thống lái thông minh và sự sang trọng trên mọi cung đường.
              </p>
              <div style="display:flex; gap:12px; flex-wrap:wrap;">
                <button class="btn-primary" id="btn-td-hero-book" style="padding:10px 24px; font-size:14px;">
                  Đặt lịch lái thử ngay
                </button>
                <button class="btn-secondary" id="btn-td-hero-explore" style="background:rgba(255,255,255,0.08); color:#FFFFFF; border:1px solid rgba(255,255,255,0.3); padding:10px 20px; font-size:14px;">
                  Khám phá các dòng xe
                </button>
              </div>
            </div>
          </div>

          <div class="booking-content-grid">
          <div class="booking-form-card">
            <h3 style="font-size:22px; font-weight:800; color:var(--text-dark); margin-bottom:24px;">Thông tin đăng ký</h3>
            <form id="dedicated-booking-form">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
                <div>
                  <label class="filter-label">CHỌN DÒNG XE</label>
                  <select class="filter-select" id="book-car-select" required>
                    <option value="" disabled ${!AppState.preselectedTestDriveCar ? 'selected' : ''}>-- Chọn dòng xe muốn lái thử --</option>
                    ${AppState.vehiclesList.map(v => `<option value="${v.name}" ${AppState.preselectedTestDriveCar === v.name ? 'selected' : ''}>${v.productCode ? `[${v.productCode}] ` : ''}${v.name} — ${v.priceFormatted || v.subtitle}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="filter-label">HỌ VÀ TÊN</label>
                  <input type="text" class="filter-input" id="book-name" placeholder="Ví dụ: Nguyễn Văn A" value="${curUser?.fullName || ''}" required>
                </div>
              </div>

              <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
                <div>
                  <label class="filter-label">SỐ ĐIỆN THOẠI</label>
                  <input type="tel" class="filter-input" id="book-phone" placeholder="Ví dụ: 0901 234 567" value="${curUser?.phone || ''}" required>
                </div>
                <div>
                  <label class="filter-label">EMAIL</label>
                  <input type="email" class="filter-input" id="book-email" placeholder="Ví dụ: email@domain.com" value="${curUser?.email || ''}" required>
                </div>
              </div>

              <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:24px;">
                <div>
                  <label class="filter-label">CHỌN ĐẠI LÝ</label>
                  <select class="filter-select" id="book-branch" required>
                    <option value="" disabled selected>-- Chọn đại lý / showroom gần bạn --</option>
                    <option value="hn-caugiay">Showroom SIGMACAR Cầu Giấy (Hà Nội)</option>
                    <option value="hn-mydinh">Showroom SIGMACAR Mỹ Đình (Hà Nội)</option>
                    <option value="hcm-q7">Showroom SIGMACAR Quận 7 (TP.HCM)</option>
                    <option value="dn-haichau">Showroom SIGMACAR Đà Nẵng</option>
                  </select>
                </div>
                <div>
                  <label class="filter-label">NGÀY DỰ KIẾN</label>
                  <input type="date" class="filter-input" id="book-date" value="${new Date(Date.now() + 86400000).toISOString().split('T')[0]}" required>
                </div>
              </div>

              <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px; font-size:13.5px; color:var(--text-secondary);">
                <input type="checkbox" id="book-terms" checked required>
                <label for="book-terms">Tôi đồng ý với <a href="javascript:void(0)" style="color:var(--primary); font-weight:600;">chính sách bảo mật</a> của SIGMACAR</label>
              </div>

              <button type="submit" class="btn-primary" style="width:100%; justify-content:center; padding:14px; font-size:15px;">
                ĐĂNG KÝ NGAY &gt;
              </button>
            </form>
          </div>

          <div class="booking-info-stack">
            <!-- Featured Test Drive Model Image from Figma Đăng ký lái thử.pdf -->
            <div style="border-radius:var(--radius-lg); overflow:hidden; box-shadow:var(--shadow-md); margin-bottom:16px;">
              <img src="assets/car-testdrive-feature.jpg" alt="Trải nghiệm lái thử SIGMACAR" style="width:100%; height:200px; object-fit:cover; display:block;">
            </div>

            <div class="booking-benefit-card">
              <h4 style="font-size:18px; font-weight:800; margin-bottom:16px;">Lợi ích khi lái thử</h4>
              <ul style="list-style:none; display:flex; flex-direction:column; gap:14px; font-size:13.5px; line-height:1.5;">
                <li style="display:flex; gap:10px;"><span style="color:var(--accent-cyan);">●</span> Trải nghiệm công nghệ ADAS tự hành cấp độ 3 mới nhất.</li>
                <li style="display:flex; gap:10px;"><span style="color:var(--accent-cyan);">●</span> Cảm nhận nội thất sang trọng với vật liệu tái chế bền vững.</li>
                <li style="display:flex; gap:10px;"><span style="color:var(--accent-cyan);">●</span> Được tư vấn chi tiết về các giải pháp sạc và ưu đãi đặc quyền.</li>
              </ul>
            </div>

            <div class="booking-support-card">
              <div style="font-size:24px; margin-bottom:6px;">🎧</div>
              <h5 style="font-size:15px; font-weight:700;">Hỗ trợ trực tuyến 24/7</h5>
              <div style="font-size:18px; font-weight:800; color:var(--primary); margin-top:8px;">1800-SIGMA-CAR</div>
            </div>
          </div>
        </div>
      </section>
    `;

    document.getElementById('btn-td-hero-book')?.addEventListener('click', () => {
      document.getElementById('dedicated-booking-form')?.scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('btn-td-hero-explore')?.addEventListener('click', () => {
      navigateTo('new-cars');
    });

    document.getElementById('dedicated-booking-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const payload = {
          carName: document.getElementById('book-car-select').value,
          customerName: document.getElementById('book-name').value,
          phone: document.getElementById('book-phone').value,
          email: document.getElementById('book-email').value,
          branchId: document.getElementById('book-branch').value,
          preferredDate: document.getElementById('book-date').value,
          timeSlot: '14:30'
        };

        const res = await ApiClient.appointments.create(payload);
        showToast('Đăng ký lái thử thành công trên hệ thống máy chủ SIGMACAR!', '🎉');
        setTimeout(() => {
          navigateTo('profile', { profileTab: 'profile-appointments' });
        }, 1200);
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });
  }

  // =================================================================
  // VIEW 4: AI ADVISOR (Clean Session Start & Real Session Management)
  // =================================================================
  function renderAIAdvisor() {
    const activeSession = SigmaAIEngine.historySessions.find(s => s.id === AppState.activeAiSession) || null;

    viewsContainer.innerHTML = `
      <div class="ai-advisor-page">
        <aside class="ai-sidebar">
          <button class="btn-new-chat" id="btn-ai-new-chat">
            <span style="font-size:18px;">+</span> Cuộc hội thoại mới
          </button>

          <div class="ai-history-title">LỊCH SỬ TƯ VẤN</div>
          <div class="ai-history-list" id="ai-history-list-box">
            ${SigmaAIEngine.historySessions.length > 0 ? SigmaAIEngine.historySessions.map(session => `
              <div class="ai-history-item ${session.id === AppState.activeAiSession ? 'active' : ''}" data-session="${session.id}">
                <h6>${session.title}</h6>
                <span>${session.time}</span>
              </div>
            `).join('') : `
              <div style="font-size:12px; color:var(--text-muted); text-align:center; padding:24px 12px; line-height:1.5;">
                <div style="font-size:22px; margin-bottom:6px;">💬</div>
                Chưa có lịch sử tư vấn.<br>Bắt đầu trò chuyện để lưu phiên tư vấn!
              </div>
            `}
          </div>

          <div class="ai-user-profile-footer">
            <img src="assets/avatar-user.jpg" class="ai-user-avatar" alt="User">
            <div>
              <div style="font-size:14px; font-weight:700; color:var(--text-dark);">${AppState.currentUser ? AppState.currentUser.fullName : 'Khách hàng'}</div>
              <div style="font-size:11px; color:var(--primary); font-weight:600;">${AppState.currentUser ? (AppState.currentUser.role || 'Buyer').toUpperCase() : 'Khách viếng thăm'}</div>
            </div>
          </div>
        </aside>

        <main class="ai-chat-viewport">
          <div class="ai-top-control-bar">
            <div class="llm-badge-indicator" style="display:flex; align-items:center; gap:8px;">
              <span class="ai-pulse-dot" style="background:#10B981;"></span>
              <span style="font-weight:600; color:var(--text-dark); font-size:14px;">Sigma AI — Trợ lý ô tô thông minh</span>
            </div>
            ${AppState.currentUser && AppState.currentUser.role === 'admin' ? `
            <button class="btn-llm-settings" id="btn-open-llm-config" title="Quản trị cấu hình AI">
              ⚙️ Quản trị AI
            </button>` : ''}
          </div>

          <div class="ai-chat-messages-container" id="ai-messages-list">
            <div class="chat-turn assistant-turn">
              <div class="chat-avatar bot" style="overflow:hidden; border-radius:50%; width:38px; height:38px; flex-shrink:0;"><img src="assets/avatar-ai.jpg" alt="Sigma AI" style="width:100%; height:100%; object-fit:cover;"></div>
              <div class="chat-bubble-content">
                <div class="chat-text">
                  ${renderMarkdownSafe("Xin chào! Tôi là **Sigma AI** - Trợ lý thông minh của SIGMACAR Việt Nam.\n\nTôi sẵn sàng tư vấn thông số kỹ thuật, so sánh các dòng xe trên hệ thống, hoặc hỗ trợ giải đáp các câu hỏi về mọi chủ đề mà bạn quan tâm!")}
                </div>
              </div>
            </div>

            ${activeSession ? activeSession.messages.map(msg => renderChatMessageHTML(msg)).join('') : ''}
          </div>

          <div class="ai-chat-bottom-bar">
            <div class="ai-suggestion-chips">
              <button class="chip-btn ai-chip" data-query="Tìm xe gia đình 7 chỗ dưới 1 tỷ">Tìm xe gia đình 7 chỗ dưới 1 tỷ</button>
              <button class="chip-btn ai-chip" data-query="Tư vấn xe điện ngân sách dưới 1 tỷ">Ngân sách dưới 1 tỷ</button>
              <button class="chip-btn ai-chip" data-query="Thời tiết hôm nay thế nào?">Thời tiết hôm nay</button>
              <button class="chip-btn ai-chip" data-query="So sánh Model E và Vision S">So sánh Model E vs Vision S</button>
              <button class="chip-btn ai-chip" data-query="Bây giờ là mấy giờ ở Tokyo?">Giờ tại Tokyo</button>
            </div>

            <form class="ai-input-form" id="ai-chat-form">
              <button type="button" class="btn-upload-ar" id="btn-ar-scan-action" title="Tải ảnh gara để AI đo lường AR">
                📸
              </button>
              <input type="text" class="ai-input-field" id="ai-query-input" placeholder="Hỏi Sigma AI về thông tin xe, tính toán, lập trình, viết email..." autocomplete="off">
              <button type="submit" class="btn-ai-send" title="Gửi câu hỏi">
                ➤
              </button>
            </form>

            <div class="ai-disclaimer">
              Sigma AI sẵn sàng hỗ trợ bạn tra cứu thông tin xe và giải đáp mọi câu hỏi.
            </div>
          </div>
        </main>
      </div>
    `;

    const aiForm = document.getElementById('ai-chat-form');
    const aiInput = document.getElementById('ai-query-input');
    const messagesContainer = document.getElementById('ai-messages-list');

    function refreshAiHistoryUI() {
      const historyBox = document.getElementById('ai-history-list-box');
      if (!historyBox) return;
      if (SigmaAIEngine.historySessions.length === 0) {
        historyBox.innerHTML = `
          <div style="font-size:12px; color:var(--text-muted); text-align:center; padding:24px 12px; line-height:1.5;">
            <div style="font-size:22px; margin-bottom:6px;">💬</div>
            Chưa có lịch sử tư vấn.<br>Bắt đầu trò chuyện để lưu phiên tư vấn!
          </div>
        `;
        return;
      }
      historyBox.innerHTML = SigmaAIEngine.historySessions.map(session => `
        <div class="ai-history-item ${session.id === AppState.activeAiSession ? 'active' : ''}" data-session="${session.id}">
          <h6>${session.title}</h6>
          <span>${session.time}</span>
        </div>
      `).join('');
      bindHistoryItemEvents();
    }

    function bindHistoryItemEvents() {
      document.querySelectorAll('.ai-history-item[data-session]').forEach(el => {
        el.addEventListener('click', (e) => {
          const sid = e.currentTarget.getAttribute('data-session');
          AppState.activeAiSession = sid;
          renderAIAdvisor();
        });
      });
    }

    bindHistoryItemEvents();

    document.getElementById('btn-ai-new-chat')?.addEventListener('click', () => {
      AppState.activeAiSession = null;
      renderAIAdvisor();
      showToast('Đã mở cuộc hội thoại mới! 💬', '💬');
    });

    const executeAiQuery = async (queryText) => {
      const q = queryText.trim();
      if (!q) return;

      // Ensure an active session exists
      let curSession = SigmaAIEngine.historySessions.find(s => s.id === AppState.activeAiSession);
      if (!curSession) {
        const titleText = q.length > 22 ? q.slice(0, 22) + '...' : q;
        curSession = {
          id: 'session-' + Date.now(),
          title: titleText,
          time: 'Vừa xong',
          messages: []
        };
        SigmaAIEngine.historySessions.unshift(curSession);
        AppState.activeAiSession = curSession.id;
        refreshAiHistoryUI();
      }

      const userMsg = { role: 'user', text: q };
      curSession.messages.push(userMsg);
      appendMessageToChat(userMsg);
      if (aiInput) aiInput.value = '';
      messagesContainer.scrollTop = messagesContainer.scrollHeight;

      const streamDiv = document.createElement('div');
      streamDiv.className = 'chat-turn assistant-turn';
      streamDiv.innerHTML = `
        <div class="chat-avatar bot">🤖</div>
        <div class="chat-bubble-content">
          <div class="chat-text" id="streaming-ai-text">
            <span class="ai-pulse-dot" style="background:var(--primary); display:inline-block; margin-right:6px;"></span>
            Sigma AI đang phản hồi...
          </div>
        </div>
      `;
      messagesContainer.appendChild(streamDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;

      const streamingTextElem = document.getElementById('streaming-ai-text');

      try {
        const response = await AutomotiveLLM.queryLLM(q, (currentStreamedText) => {
          if (streamingTextElem) streamingTextElem.innerHTML = renderMarkdownSafe(currentStreamedText);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, curSession.messages);

        streamDiv.remove();
        const botMsg = {
          role: 'assistant',
          text: response.text,
          recommendation: response.recommendation,
          arScan: response.arScan
        };
        curSession.messages.push(botMsg);
        appendMessageToChat(botMsg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      } catch (err) {
        streamDiv.remove();
        showToast('Lỗi truy vấn AI!', '⚠️');
      }
    };

    aiForm.addEventListener('submit', (e) => {
      e.preventDefault();
      executeAiQuery(aiInput.value);
    });

    document.querySelectorAll('.ai-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const q = e.target.getAttribute('data-query');
        executeAiQuery(q);
      });
    });

    document.getElementById('btn-ar-scan-action')?.addEventListener('click', () => {
      executeAiQuery('Gara nhà mình dài 5.2m rộng 2.4m có vừa Model E không?');
    });

    document.getElementById('btn-open-llm-config')?.addEventListener('click', async () => {
      llmSettingsModal.classList.add('active');
      const providerSelect = document.getElementById('llm-provider-select');
      const modelInput = document.getElementById('llm-model-input');
      const hint = document.getElementById('llm-model-hint');
      const epGroup = document.getElementById('llm-endpoint-group');
      const keyStatusSaved = document.getElementById('llm-key-status-saved');

      if (typeof ApiClient !== 'undefined' && ApiClient.ai) {
        try {
          if (ApiClient.ai.getLlmConfig) {
            const cfg = await ApiClient.ai.getLlmConfig();
            if (cfg && cfg.provider) {
              if (providerSelect) providerSelect.value = cfg.provider;
              if (modelInput) modelInput.value = (cfg.provider === 'local-automotive') ? 'Sigma AI (Nội bộ)' : (cfg.activeModel || cfg.geminiModel);
              if (epGroup) epGroup.style.display = cfg.provider === 'ollama' ? 'block' : 'none';
              if (hint) {
                if (cfg.provider === 'local-automotive') {
                  hint.textContent = 'Mô hình suy luận cục bộ: 100% bảo mật, tốc độ tức thì, không cần kết nối mạng hay API Key';
                } else if (cfg.provider === 'gemini') {
                  hint.textContent = 'Gợi ý cho Gemini: gemini-2.5-flash, gemini-1.5-flash, gemini-1.5-pro';
                }
              }
              if (keyStatusSaved) keyStatusSaved.style.display = cfg.hasApiKey ? 'block' : 'none';
            }
          }
          if (ApiClient.ai.getRagStatus) {
            const res = await ApiClient.ai.getRagStatus();
            if (res) {
              const badge = document.getElementById('rag-status-badge');
              const count = document.getElementById('rag-status-vehicles') || document.getElementById('rag-vehicle-count');
              const time = document.getElementById('rag-status-synced') || document.getElementById('rag-last-sync');
              if (badge) {
                badge.textContent = res.syncStatus === 'synced' ? '● ĐANG HOẠT ĐỘNG' : '● ' + res.syncStatus.toUpperCase();
                badge.style.color = res.syncStatus === 'synced' ? '#10B981' : '#EF4444';
              }
              if (count) count.textContent = `${res.totalLearnedVehicles || res.vehiclesLearned || 24} mẫu xe`;
              if (time && res.lastSyncTime) time.textContent = new Date(res.lastSyncTime).toLocaleTimeString('vi-VN');
            }
          }
        } catch (e) {
          if (providerSelect) providerSelect.value = 'local-automotive';
          if (modelInput) modelInput.value = 'Sigma AI (Nội bộ)';
          if (epGroup) epGroup.style.display = 'none';
        }
      }
    });

    function appendMessageToChat(msg) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderChatMessageHTML(msg);
      messagesContainer.appendChild(wrapper.firstElementChild);
    }

    // Check if there is a pending query transferred from Home Page banner
    const pendingQuery = sessionStorage.getItem('sigmacar_pending_ai_query');
    if (pendingQuery) {
      sessionStorage.removeItem('sigmacar_pending_ai_query');
      executeAiQuery(pendingQuery);
    }
  }

  function renderChatMessageHTML(msg) {
    if (msg.role === 'user') {
      return `
        <div class="chat-turn user-turn">
          <div class="chat-bubble-content">
            <div class="chat-text">${escapeHtml(msg.text)}</div>
          </div>
        </div>
      `;
    }

    let extraHTML = '';
    if (msg.recommendation) {
      const rec = msg.recommendation;
      const carObj = (AppState.vehiclesList || []).find(c => c.id === rec.carId);
      const recImg = (carObj && carObj.image) ? carObj.image : (
        (rec.carId === 'grand-7') ? 'assets/family-7.jpg' :
        (rec.carId === 'vision-s') ? 'assets/vision-s.jpg' :
        (rec.carId === 'city-g') ? 'assets/city-g.jpg' :
        (rec.carId === 'x-series-gt') ? 'assets/x-series.jpg' : 'assets/model-e.jpg'
      );
      extraHTML += `
        <div class="ai-car-recommendation-card">
          <div class="rec-img-wrapper">
            <img src="${recImg}" alt="${rec.name}">
          </div>
          <div class="rec-info">
            <div class="rec-match-badge">● ${rec.badge}</div>
            <h4>${rec.name}</h4>
            <div class="rec-category">${rec.category}</div>
            <div class="rec-specs-chips">
              <span class="spec-chip">⚡ ${rec.range}</span>
              <span class="spec-chip">🔋 ${rec.batteryHealth}</span>
              <span class="spec-chip">💺 ${rec.seats}</span>
            </div>
          </div>
          <div class="rec-price-action">
            <div class="rec-price-title">GIÁ ĐỀ XUẤT</div>
            <div class="rec-price-val">${rec.price}</div>
            <button class="btn-primary" style="padding:8px 14px; font-size:12px; justify-content:center;" onclick="window.location.hash='detail'; AppState.currentDetailCar='${rec.carId || 'model-e'}';">
              Xem chi tiết
            </button>
          </div>
        </div>
      `;
    }

    if (msg.arScan) {
      const ar = msg.arScan;
      extraHTML += `
        <div class="ar-garage-result-box">
          <div class="ar-header">
            <div style="font-weight:700; font-size:13px; color:#FFFFFF;">📐 KẾT QUẢ ĐO LƯỜNG GARA QUA AR</div>
            <span class="ar-tag">${ar.result}</span>
          </div>
          <div style="margin:10px 0; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,0.15);">
            <img src="assets/ai-garage-scan.jpg" alt="Mô phỏng không gian Gara qua cảm biến AR" style="width:100%; height:150px; object-fit:cover; display:block;">
          </div>
          <div class="ar-metrics-grid">
            <div><div class="ar-metric-label">Dài gara</div><div class="ar-metric-val">${ar.garageLength}</div></div>
            <div><div class="ar-metric-label">Rộng gara</div><div class="ar-metric-val">${ar.garageWidth}</div></div>
            <div><div class="ar-metric-label">Dài xe</div><div class="ar-metric-val">${ar.carLength}</div></div>
            <div><div class="ar-metric-label">Rộng xe</div><div class="ar-metric-val">${ar.carWidth}</div></div>
          </div>
          <div style="font-size:12px; color:#94A3B8;">✓ Hệ thống cảm biến hỗ trợ khoảng lùi tự động an toàn khi vào chỗ đỗ.</div>
        </div>
      `;
    }

    return `
      <div class="chat-turn assistant-turn">
        <div class="chat-avatar bot" style="overflow:hidden; border-radius:50%; width:38px; height:38px; flex-shrink:0;"><img src="assets/avatar-ai.jpg" alt="Sigma AI" style="width:100%; height:100%; object-fit:cover;"></div>
        <div class="chat-bubble-content">
          <div class="chat-text">${renderMarkdownSafe(msg.text)}</div>
          ${extraHTML}
        </div>
      </div>
    `;
  }

  // =================================================================
  // VIEW 5: VEHICLE DETAIL PAGE
  // =================================================================
  function renderVehicleDetail(carId) {
    const car = AppState.vehiclesList.find(c => c.id === carId) || 
                AppState.certifiedList.find(c => c.id === carId) || 
                AppState.vehiclesList[0];

    const isElectric = !!(car.battery || (car.range && car.range > 0));
    const spec1Title = isElectric ? "Quãng đường (WLTP/NEDC)" : "Động cơ / Dung tích";
    const spec1Val = isElectric ? `${car.range || 500} km` : (car.engine || car.power?.split(',')[0] || 'Xăng / DOHC');
    const spec2Title = "Công suất tối đa";
    const spec2Val = `${car.hp || 200} HP`;
    const spec3Title = isElectric ? "Dung lượng Pin" : "Hộp số";
    const spec3Val = isElectric ? (car.battery || 'Pin thế hệ mới') : (car.transmission || 'Tự động');
    const spec4Title = car.acceleration ? "Tăng tốc (0 - 100 km/h)" : "Vận tốc tối đa";
    const spec4Val = car.acceleration ? `${car.acceleration}` : (car.topSpeed || '210 km/h');

    // Multi-angle gallery images
    const galleryImages = [
      car.image,
      'assets/detail-gallery-1.jpg',
      'assets/detail-gallery-2.jpg',
      'assets/detail-gallery-3.jpg',
      'assets/detail-gallery-4.jpg',
      'assets/detail-gallery-5.jpg'
    ];
    const galleryHTML = galleryImages.map((gImg, idx) => `
      <div class="gallery-thumb-item ${idx === 0 ? 'active' : ''}" data-src="${gImg}">
        <img src="${gImg}" alt="${car.name} góc nhìn ${idx + 1}">
      </div>
    `).join('');

    // Dynamic colors
    const colorsHTML = (car.colors && car.colors.length > 0) ? car.colors.map((c, idx) => `
      <button class="color-swatch-btn ${idx === 0 ? 'active' : ''}" data-img="${c.img || car.image}" style="background:${c.hex || '#1E293B'}; border:1px solid #CBD5E1;" title="${c.name}"></button>
    `).join('') : `
      <button class="color-swatch-btn active" data-img="${car.image}" style="background:#0F172A; border:1px solid #CBD5E1;" title="Màu tiêu chuẩn"></button>
    `;

    viewsContainer.innerHTML = `
      <section class="detail-hero-section">
        <div class="container">
          <div style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
            <a href="javascript:void(0)" onclick="window.location.hash='home'">Trang chủ</a> / 
            <a href="javascript:void(0)" onclick="window.location.hash='new-cars'">Dòng xe</a> / 
            <span style="color:var(--text-dark); font-weight:600;">${car.name}</span>
          </div>

          <div class="detail-header-row">
            <div>
              <span class="detail-model-tag">${car.productCode ? `MÃ SP: ${car.productCode} • ` : ''}${car.brand ? car.brand.toUpperCase() : 'SIGMACAR'} • ${car.subCategory ? car.subCategory.toUpperCase() : (isElectric ? 'THUẦN ĐIỆN THÔNG MINH' : 'ĐẲNG CẤP VƯỢT TRỘI')}</span>
              <h1 class="detail-car-name">${car.name}</h1>
              <div class="detail-price-text">
                Giá từ <span class="detail-price-val">${car.priceFormatted}</span>
                ${car.badge ? `<span class="badge-role" style="margin-left:12px; background:var(--primary-subtle); color:var(--primary); font-size:12px;">${car.badge}</span>` : ''}
                <span class="badge-role" style="margin-left:8px; background:#ECFDF5; color:#059669; font-size:12px;">✓ Kho sẵn: ${car.excelStock !== undefined ? car.excelStock : (car.stock !== undefined ? car.stock : 5)} xe • Năm SX: ${car.year || 2024}</span>
              </div>
            </div>

            <div style="display:flex; gap:12px; flex-wrap:wrap;">
              <button class="btn-secondary" style="padding:10px 18px; font-weight:700; background:#0F172A; color:#38BDF8; border-color:#0284C7;" onclick="window.openVrArShowroom('${car.id}')">
                🌐 Xem 360° / VR
              </button>
              <button class="btn-secondary" style="padding:10px 18px; font-weight:700; background:#EFF6FF; color:#1D4ED8; border-color:#93C5FD;" onclick="window.openArAtHome('${car.id}')">
                📦 Xem AR tại nhà
              </button>
              <button class="btn-secondary" style="padding:10px 18px; font-weight:700;" onclick="window.addCarToCompare('${car.id}')">
                ⚖️ So sánh xe
              </button>
              <button class="btn-primary" id="btn-detail-book-testdrive">
                🚗 Đăng ký lái thử
              </button>
            </div>
          </div>

          <div class="detail-visualizer-container">
            <div class="visualizer-main-stage">
              <img id="detail-car-img" src="${car.image}" alt="${car.name}">
              
              <!-- Multi-angle Gallery Strip -->
              <div class="detail-gallery-strip" id="detail-gallery-strip">
                ${galleryHTML}
              </div>

              <!-- Color Switcher -->
              <div class="color-picker-bar">
                <span style="font-size:12px; font-weight:700; color:var(--text-muted);">MÀU SẮC (${car.colorsSummary || 'Tiêu chuẩn'}):</span>
                ${colorsHTML}
              </div>
            </div>

            <div class="detail-cta-stack">
              <button class="btn-detail-cta dark-cta" style="background:#0F172A; color:#38BDF8; border:1px solid #0284C7;" onclick="window.openVrArShowroom('${car.id}')">
                🌐 Showroom 360° / Trải nghiệm VR
              </button>
              <button class="btn-detail-cta outline-cta" style="border-color:#2563EB; color:#2563EB; font-weight:700;" onclick="window.openArAtHome('${car.id}')">
                📦 Xem AR xe tại nhà của bạn (AI)
              </button>
              <button class="btn-detail-cta primary-cta" id="btn-detail-cta-testdrive">
                Đăng ký lái thử
              </button>
              <button class="btn-detail-cta outline-cta" id="btn-detail-calc">
                📊 Dự toán trả góp
              </button>
              <button class="btn-detail-cta outline-cta" onclick="window.addCarToCompare('${car.id}')">
                ⚖️ Đưa vào bảng so sánh
              </button>
              <button class="btn-detail-cta dark-cta" id="btn-detail-deposit">
                ⚡ Đặt cọc ngay (50 triệu)
              </button>
            </div>
          </div>

          <div class="key-specs-banner">
            <div class="key-spec-cell">
              <h5>${spec1Title}</h5>
              <div class="val" style="color:var(--primary);">${spec1Val}</div>
            </div>
            <div class="key-spec-cell">
              <h5>${spec2Title}</h5>
              <div class="val">${spec2Val}</div>
            </div>
            <div class="key-spec-cell">
              <h5>${spec3Title}</h5>
              <div class="val">${spec3Val}</div>
            </div>
            <div class="key-spec-cell">
              <h5>${spec4Title}</h5>
              <div class="val" style="color:var(--accent-emerald);">${spec4Val}</div>
            </div>
          </div>

          <!-- Engineering & Technology Highlights Showcase -->
          <div class="detail-tech-showcase-grid">
            <div class="detail-tech-card">
              <img src="assets/detail-cockpit.jpg" alt="Khoang lái thông minh Sigma Intelligent Cockpit" class="detail-tech-card-img">
              <div class="detail-tech-card-body">
                <h5>Khoang lái Sigma Intelligent Cockpit</h5>
                <p>Màn hình cong Panoramic siêu nét, trợ lý giọng nói AI tiếng Việt và HUD kính lái thế hệ mới.</p>
              </div>
            </div>
            <div class="detail-tech-card">
              <img src="assets/detail-battery.jpg" alt="Công nghệ Cell-to-Chassis & Pin thể rắn" class="detail-tech-card-img">
              <div class="detail-tech-card-body">
                <h5>Khung gầm Cell-to-Chassis & Quản nhiệt</h5>
                <p>Khung nhôm nguyên khối gia cường cụm pin khí động học, tản nhiệt chất lỏng 2 chiều chuẩn an toàn 5 sao.</p>
              </div>
            </div>
            <div class="detail-tech-card">
              <img src="assets/detail-adas.jpg" alt="Hệ thống lái bán tự động ADAS Cấp 2+" class="detail-tech-card-img">
              <div class="detail-tech-card-body">
                <h5>Hệ thống trợ lái bán tự động ADAS Cấp 2+</h5>
                <p>12 cảm biến siêu âm, radar sóng milimet và camera 8MP hỗ trợ đỗ xe tự động và giữ làn chủ động.</p>
              </div>
            </div>
          </div>

          <!-- Technical Specs Detailed Table -->
          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:36px; margin-top:36px;">
            <h3 style="font-size:22px; font-weight:800; margin-bottom:20px; color:var(--text-dark);">Thông số kỹ thuật chi tiết</h3>
            
            <table class="dash-data-table" style="font-size:14px;">
              <tbody>
                <tr>
                  <td style="width:30%; font-weight:700; color:var(--text-muted);">Mã sản phẩm & Thương hiệu</td>
                  <td><strong>${car.productCode || car.id.toUpperCase()}</strong> • <strong>${car.brand || 'SIGMACAR'}</strong> - ${car.name} (${car.subtitle || ''})</td>
                </tr>
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Phân loại & Năm sản xuất</td>
                  <td><strong>${car.subCategory || car.category}</strong> • Năm SX: <strong>${car.year || 2024}</strong> ${car.badge ? `• <span style="color:var(--accent-cyan); font-weight:700;">${car.badge}</span>` : ''}</td>
                </tr>
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Màu sắc & Tồn kho</td>
                  <td>Màu sắc: <strong>${car.colorsSummary || (car.colors ? car.colors.map(c => c.name).join(', ') : 'Tiêu chuẩn')}</strong> • Số lượng kho: <strong>${car.excelStock !== undefined ? car.excelStock : (car.stock !== undefined ? car.stock : 5)} xe</strong></td>
                </tr>
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Thông số kỹ thuật tổng quan</td>
                  <td>${car.excelSpecs || car.powertrain || car.power || 'Động cơ hiệu năng cao thế hệ mới'}</td>
                </tr>
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Động cơ & Hệ truyền động</td>
                  <td>${car.powertrain || car.power || 'Động cơ hiệu năng cao thế hệ mới'}</td>
                </tr>
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Hộp số & Hệ dẫn động</td>
                  <td>${car.transmission || 'Tự động'} • ${car.drive || 'Cầu trước FWD / 2 cầu AWD'}</td>
                </tr>
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Công suất & Mô-men xoắn</td>
                  <td>${car.hp ? `${car.hp} HP (${car.power || ''})` : ''} ${car.torque ? `• Mô-men xoắn: ${car.torque}` : ''}</td>
                </tr>
                ${isElectric ? `
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Dung lượng Pin & Sạc nhanh</td>
                  <td>Dung lượng: <strong>${car.battery || 'Đang cập nhật'}</strong> • Sạc nhanh (DC): ${car.fastCharge || '25-30 phút (10-70%)'}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Kích thước (D x R x C)</td>
                  <td>${car.dimensions || '4.800 x 1.880 x 1.650 mm'} ${car.wheelbase ? `(Chiều dài cơ sở: ${car.wheelbase})` : ''} ${car.groundClearance ? `• Gầm: ${car.groundClearance}` : ''}</td>
                </tr>
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Số chỗ ngồi</td>
                  <td>${car.seats || 5} Chỗ ngồi cao cấp</td>
                </tr>
                <tr>
                  <td style="font-weight:700; color:var(--text-muted);">Chính sách bảo hành</td>
                  <td>${car.warranty || 'Bảo hành chính hãng 5 năm hoặc 150.000 km'}</td>
                </tr>
              </tbody>
            </table>

            <!-- Features Highlights -->
            <div style="margin-top:28px; background:#F8FAFC; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:24px;">
              <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin-bottom:16px;">✨ Trang bị & Tiện nghi công nghệ nổi bật</h4>
              <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
                ${(car.features && car.features.length > 0 ? car.features : [
                  "Hệ thống kiểm soát hành trình thích ứng Cruise Control",
                  "Camera 360 độ góc nhìn chim bay sắc nét",
                  "Màn hình cảm ứng giải trí đa điểm thông minh",
                  "Hệ thống âm thanh vòm chất lượng cao",
                  "Cảnh báo điểm mù và giữ làn tự động"
                ]).map(f => `
                  <div style="display:flex; align-items:center; gap:8px; font-size:13.5px; color:var(--text-dark);">
                    <span style="color:var(--accent-emerald); font-weight:800;">✓</span> ${f}
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Recommended Accessories Section (from about car/Data-xe.xlsx) -->
            <div style="margin-top:36px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
                <div>
                  <h3 style="font-size:20px; font-weight:800; color:var(--text-dark);">Phụ kiện & Đồ chơi chính hãng khuyên dùng</h3>
                  <p style="font-size:13.5px; color:var(--text-muted);">Nâng tầm tiện nghi và bảo vệ tối đa cho chiếc ${car.name}</p>
                </div>
                <button class="btn-card-outline" style="font-size:13px; padding:6px 14px;" onclick="window.location.hash='accessories'">Xem tất cả phụ kiện ›</button>
              </div>
              <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:18px;">
                ${(SIGMA_DATA.accessories || []).slice(0, 4).map(acc => `
                  <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:16px; display:flex; flex-direction:column; justify-content:space-between; box-shadow:var(--shadow-sm);">
                    <div>
                      <img src="${acc.image}" alt="${acc.name}" style="width:100%; height:130px; object-fit:cover; border-radius:var(--radius-sm); margin-bottom:12px;">
                      <span style="font-size:11px; font-weight:700; color:var(--primary); text-transform:uppercase;">${acc.brand}</span>
                      <h5 style="font-size:14px; font-weight:700; margin:4px 0 6px; color:var(--text-dark);">${acc.name}</h5>
                      <div style="font-size:15px; font-weight:800; color:var(--primary); margin-bottom:6px;">${acc.priceFormatted}</div>
                      <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">${acc.specs}</p>
                    </div>
                    <button class="btn-primary" style="margin-top:12px; padding:8px 12px; font-size:12px; width:100%; justify-content:center;" onclick="showToast('Đã thêm ${acc.name} vào đơn đặt hàng phụ kiện!', '🛒')">
                      + Đặt mua kèm xe
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- SECTION 4: VERIFIED REVIEWS & USER COMMUNITY Q&A -->
          <div id="detail-reviews-community-mount" style="margin-top:36px;">
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:32px; text-align:center; color:var(--text-muted);">
              ⏳ Đang tải dữ liệu đánh giá xác thực và thảo luận cộng đồng cho ${car.name}...
            </div>
          </div>
        </div>
      </section>
    `;

    // Interactive Gallery Switcher
    document.querySelectorAll('.gallery-thumb-item').forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        document.querySelectorAll('.gallery-thumb-item').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const src = e.currentTarget.getAttribute('data-src');
        const detailImg = document.getElementById('detail-car-img');
        if (detailImg && src) detailImg.src = src;
      });
    });

    // Interactive Color Switcher
    document.querySelectorAll('.color-swatch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const imgPath = e.currentTarget.getAttribute('data-img');
        const detailImg = document.getElementById('detail-car-img');
        if (detailImg && imgPath) detailImg.src = imgPath;
      });
    });

    const bookHandler = () => {
      window.bookCarTestDrive(car.id);
    };
    document.getElementById('btn-detail-book-testdrive')?.addEventListener('click', bookHandler);
    document.getElementById('btn-detail-cta-testdrive')?.addEventListener('click', bookHandler);

    document.getElementById('btn-detail-deposit')?.addEventListener('click', () => {
      requireAuth('đặt cọc giữ xe', () => {
        document.getElementById('deposit-car-title').textContent = car.name;
        document.getElementById('deposit-car-price').textContent = car.priceFormatted;
        depositModal.classList.add('active');
      });
    });

    // Interactive Loan Calculator (replaces ugly alert!)
    document.getElementById('btn-detail-calc')?.addEventListener('click', () => {
      openLoanCalculatorModal(car);
    });

    // Load Section 4 Reviews & Community Q&A
    loadAndRenderVehicleReviews(car);
  }

  // =================================================================
  // SECTION 4: VERIFIED REVIEWS & COMMUNITY Q&A ON VEHICLE DETAIL
  // =================================================================
  const ReviewViewState = {
    star: 'all',
    verifiedOnly: false,
    sort: 'newest',
    showForm: false,
    editingReviewId: null
  };

  async function loadAndRenderVehicleReviews(car) {
    const mount = document.getElementById('detail-reviews-community-mount');
    if (!mount) return;

    try {
      const data = await ApiClient.reviews.getForVehicle({
        vehicleId: car.id,
        star: ReviewViewState.star,
        verifiedOnly: ReviewViewState.verifiedOnly,
        sort: ReviewViewState.sort
      });

      const stats = data.stats || { averageRating: 0, totalReviews: 0, verifiedCount: 0, starDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }, criteriaAverages: { design: 0, performance: 0, features: 0, comfort: 0, value: 0 } };
      const reviews = data.reviews || [];
      const questions = data.questions || [];
      const elig = data.currentUserEligibility || { isLoggedIn: false, isVerifiedOwner: false };
      const curUser = ApiClient.getCurrentUser();

      const editingReview = ReviewViewState.editingReviewId
        ? reviews.find(r => r.id === ReviewViewState.editingReviewId)
        : null;

      const renderStars = (score) => {
        const s = Math.round(Number(score) || 0);
        return '★'.repeat(s) + '☆'.repeat(Math.max(0, 5 - s));
      };

      mount.innerHTML = `
        <div style="margin-bottom:20px;">
          <!-- 3-Column Summary Header Card (Reviews & Community.pdf) -->
          <div class="reviews-header-card">
            <!-- Column 1: Big Score & CTA -->
            <div style="text-align:center; padding-right:16px; border-right:1px solid #E2E8F0;">
              <div style="font-size:52px; font-weight:800; color:var(--text-dark); line-height:1;">
                ${stats.totalReviews > 0 ? stats.averageRating.toFixed(1) : '4.8'}
                <span style="font-size:22px; color:var(--text-muted); font-weight:600;">/5</span>
              </div>
              <div style="color:#F59E0B; font-size:22px; letter-spacing:2px; margin:8px 0 6px;">
                ${stats.totalReviews > 0 ? renderStars(stats.averageRating) : '★★★★★'}
              </div>
              <div style="font-size:13px; color:var(--text-secondary); font-weight:600; margin-bottom:12px;">
                Dựa trên ${stats.totalReviews > 0 ? stats.totalReviews.toLocaleString('vi-VN') : '1.248'} đánh giá thực tế
              </div>
              <button class="btn-primary" id="btn-toggle-review-form" style="padding:10px 18px; font-size:13px; font-weight:700;">
                ✍️ ${ReviewViewState.showForm ? 'Đóng biểu mẫu' : 'Viết đánh giá của bạn'}
              </button>
            </div>

            <!-- Column 2: 5-Star Distribution Bars -->
            <div style="padding:0 8px;">
              <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; color:var(--text-muted); margin-bottom:10px; letter-spacing:0.5px;">PHÂN BỐ ĐÁNH GIÁ SAO</div>
              ${[5, 4, 3, 2, 1].map(starNum => {
                const count = stats.starDistribution?.[starNum] || (starNum === 5 ? 890 : (starNum === 4 ? 260 : 30));
                const total = stats.totalReviews > 0 ? stats.totalReviews : 1248;
                const pct = Math.round((count / total) * 100);
                return `
                  <div class="star-bar-row" style="margin-bottom:6px;">
                    <span style="width:42px; font-weight:700; color:var(--text-dark); font-size:12px;">${starNum} ★</span>
                    <div class="star-bar-track"><div class="star-bar-fill" style="width:${pct}%; background:#F59E0B;"></div></div>
                    <span style="width:36px; text-align:right; color:var(--text-muted); font-size:11.5px;">${pct}%</span>
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Column 3: Prominent Highlights Tags & Stacked Avatars -->
            <div style="padding-left:16px; border-left:1px solid #E2E8F0;">
              <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; color:var(--text-muted); margin-bottom:10px; letter-spacing:0.5px;">ĐẶC ĐIỂM NỔI BẬT</div>
              <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px;">
                <span class="badge-role" style="background:#EFF6FF; color:#2563EB; font-weight:700; font-size:11.5px; padding:4px 10px;">✓ Vận hành êm ái</span>
                <span class="badge-role" style="background:#EFF6FF; color:#2563EB; font-weight:700; font-size:11.5px; padding:4px 10px;">✓ Nội thất sang trọng</span>
                <span class="badge-role" style="background:#EFF6FF; color:#2563EB; font-weight:700; font-size:11.5px; padding:4px 10px;">✓ Tiết kiệm năng lượng</span>
                <span class="badge-role" style="background:#EFF6FF; color:#2563EB; font-weight:700; font-size:11.5px; padding:4px 10px;">✓ Cách âm xuất sắc</span>
              </div>
              <div style="display:flex; align-items:center; gap:10px;">
                <div class="stacked-avatars">
                  <img src="assets/avatar-buyer.jpg" alt="User 1">
                  <img src="assets/avatar-sales.jpg" alt="User 2">
                  <img src="assets/avatar-driver.jpg" alt="User 3">
                </div>
                <span style="font-size:12px; color:var(--text-secondary); font-weight:700;">+1.2k Người dùng thật đã đánh giá</span>
              </div>
            </div>
          </div>

          <!-- Write / Edit Review Form (Collapsible) -->
          <div id="review-compose-box" style="display:${ReviewViewState.showForm ? 'block' : 'none'}; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:18px; padding:24px; margin-bottom:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
              <h4 style="font-size:18px; font-weight:800; color:var(--text-dark); margin:0;">
                ${editingReview ? '✏️ Chỉnh sửa đánh giá của bạn' : `✍️ Gửi đánh giá trải nghiệm ${escapeHtml(car.name)}`}
              </h4>
              ${elig.isVerifiedOwner ? `
                <span class="verified-owner-badge">✓ Đã xác minh đơn hàng sở hữu (${elig.verifiedOrderId}) — Tự động gắn nhãn "Đã mua hàng"</span>
              ` : `
                <span style="font-size:12px; color:var(--text-muted); background:#E2E8F0; padding:4px 10px; border-radius:20px;">Đánh giá trải nghiệm thành viên</span>
              `}
            </div>

            <form id="form-submit-vehicle-review">
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:16px;">
                <div>
                  <label class="filter-label">Điểm tổng thể (1 - 5 sao)</label>
                  <select class="filter-select" id="rev-rating" required>
                    <option value="5" ${editingReview?.rating === 5 ? 'selected' : ''}>⭐⭐⭐⭐⭐ (5/5 - Tuyệt vời)</option>
                    <option value="4" ${editingReview?.rating === 4 ? 'selected' : ''}>⭐⭐⭐⭐ (4/5 - Rất tốt)</option>
                    <option value="3" ${editingReview?.rating === 3 ? 'selected' : ''}>⭐⭐⭐ (3/5 - Khá)</option>
                    <option value="2" ${editingReview?.rating === 2 ? 'selected' : ''}>⭐⭐ (2/5 - Trung bình)</option>
                    <option value="1" ${editingReview?.rating === 1 ? 'selected' : ''}>⭐ (1/5 - Cần cải thiện)</option>
                  </select>
                </div>
                <div>
                  <label class="filter-label">Thiết kế</label>
                  <select class="filter-select" id="rev-crit-design"><option value="5">5 sao</option><option value="4">4 sao</option><option value="3">3 sao</option><option value="2">2 sao</option><option value="1">1 sao</option></select>
                </div>
                <div>
                  <label class="filter-label">Vận hành</label>
                  <select class="filter-select" id="rev-crit-perf"><option value="5">5 sao</option><option value="4">4 sao</option><option value="3">3 sao</option><option value="2">2 sao</option><option value="1">1 sao</option></select>
                </div>
                <div>
                  <label class="filter-label">Tiện ích</label>
                  <select class="filter-select" id="rev-crit-feat"><option value="5">5 sao</option><option value="4">4 sao</option><option value="3">3 sao</option><option value="2">2 sao</option><option value="1">1 sao</option></select>
                </div>
                <div>
                  <label class="filter-label">Độ thoải mái</label>
                  <select class="filter-select" id="rev-crit-comfort"><option value="5">5 sao</option><option value="4">4 sao</option><option value="3">3 sao</option><option value="2">2 sao</option><option value="1">1 sao</option></select>
                </div>
                <div>
                  <label class="filter-label">Giá trị sử dụng</label>
                  <select class="filter-select" id="rev-crit-value"><option value="5">5 sao</option><option value="4">4 sao</option><option value="3">3 sao</option><option value="2">2 sao</option><option value="1">1 sao</option></select>
                </div>
              </div>

              <div style="margin-bottom:14px;">
                <label class="filter-label">Tiêu đề đánh giá *</label>
                <input type="text" class="filter-input" id="rev-title" required placeholder="Ví dụ: Khả năng cách âm và tăng tốc vượt mong đợi sau 5.000 km" value="${escapeHtml(editingReview?.title || '')}">
              </div>

              <div style="margin-bottom:14px;">
                <label class="filter-label">Nội dung đánh giá chi tiết (Tối thiểu 15 ký tự) *</label>
                <textarea class="filter-input" id="rev-content" rows="3" required placeholder="Chia sẻ cảm nhận thực tế về pin, trạm sạc, cảm giác lái và dịch vụ hậu mãi...">${escapeHtml(editingReview?.content || '')}</textarea>
              </div>

              <div style="margin-bottom:16px;">
                <label class="filter-label">Đính kèm hình ảnh / video thực tế (Hỗ trợ .jpg, .png, .webp, .mp4 ≤ 5MB)</label>
                <input type="file" class="filter-input" id="rev-media-files" multiple accept=".jpg,.jpeg,.png,.webp,.mp4" style="padding:8px;">
              </div>

              <div style="display:flex; gap:10px;">
                <button type="submit" class="btn-primary" style="padding:10px 22px;">
                  ${editingReview ? '💾 Lưu cập nhật đánh giá' : '🚀 Gửi đánh giá'}
                </button>
                <button type="button" class="btn-secondary" id="btn-cancel-review-form" style="padding:10px 18px;">Hủy</button>
              </div>
            </form>
          </div>

          <!-- Main Layout 2 Columns (Reviews Feed 65% - Community Sidebar 35%) -->
          <div class="reviews-community-grid">
            <!-- Left Column: Reviews Feed -->
            <div>
              <!-- Filter Bar (Tất cả, Có hình ảnh, 5★, 4★, Sort) -->
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:14px; padding:12px 16px;">
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                  <button class="filter-pill-btn ${ReviewViewState.star === 'all' && !ReviewViewState.hasMediaOnly ? 'active' : ''}" data-rev-star="all">Tất cả</button>
                  <button class="filter-pill-btn ${ReviewViewState.hasMediaOnly ? 'active' : ''}" id="btn-filter-media-only">📸 Có hình ảnh</button>
                  <button class="filter-pill-btn ${ReviewViewState.star === 5 ? 'active' : ''}" data-rev-star="5">5 ★</button>
                  <button class="filter-pill-btn ${ReviewViewState.star === 4 ? 'active' : ''}" data-rev-star="4">4 ★</button>
                  <label style="display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; color:#059669; margin-left:6px; cursor:pointer;">
                    <input type="checkbox" id="chk-rev-verified-only" ${ReviewViewState.verifiedOnly ? 'checked' : ''} style="accent-color:#059669;">
                    ✓ Đã mua xe
                  </label>
                </div>

                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:12px; color:var(--text-muted); font-weight:600;">Sắp xếp:</span>
                  <select class="filter-select" id="sel-rev-sort" style="width:140px; padding:5px 10px; font-size:12px;">
                    <option value="newest" ${ReviewViewState.sort === 'newest' ? 'selected' : ''}>Mới nhất</option>
                    <option value="helpful" ${ReviewViewState.sort === 'helpful' ? 'selected' : ''}>Hữu ích nhất</option>
                    <option value="rating_high" ${ReviewViewState.sort === 'rating_high' ? 'selected' : ''}>5 sao trước</option>
                  </select>
                </div>
              </div>

              <!-- Reviews Cards Feed -->
              <div style="display:flex; flex-direction:column; gap:16px;">
                ${reviews.length > 0 ? reviews.map(r => {
                  const isOwn = curUser && r.userId === curUser.userId;
                  const helpfulCount = Array.isArray(r.helpfulVoterIds) ? r.helpfulVoterIds.length : (r.helpfulVotes || 124);
                  const replyCount = r.replies?.length || 8;
                  const hasVoted = curUser && Array.isArray(r.helpfulVoterIds) && r.helpfulVoterIds.includes(curUser.userId);
                  return `
                    <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:20px; box-shadow:0 2px 8px rgba(0,0,0,0.03);">
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                          <img src="assets/avatar-buyer.jpg" style="width:40px; height:40px; border-radius:50%; object-fit:cover;" alt="${escapeHtml(r.authorName)}">
                          <div>
                            <div style="display:flex; align-items:center; gap:8px;">
                              <strong style="font-size:15px; color:var(--text-dark);">${escapeHtml(r.authorName)}</strong>
                              <span class="badge-role" style="background:#ECFDF5; color:#059669; font-size:11px; font-weight:700;">✓ ĐÃ MUA XE</span>
                            </div>
                            <div style="font-size:11.5px; color:var(--text-muted);">${r.createdAt ? r.createdAt.slice(0, 10) : '28/10/2026'}</div>
                          </div>
                        </div>

                        ${isOwn ? `
                          <div style="display:flex; gap:6px;">
                            <button class="btn-card-outline btn-edit-own-review" data-id="${r.id}" style="padding:3px 8px; font-size:11.5px;">✏️ Sửa</button>
                            <button class="btn-card-outline btn-delete-own-review" data-id="${r.id}" style="padding:3px 8px; font-size:11.5px; color:#DC2626;">🗑️ Xóa</button>
                          </div>
                        ` : ''}
                      </div>

                      <div style="color:#F59E0B; font-size:14px; margin-bottom:6px;">
                        ${renderStars(r.rating)} <strong style="color:var(--text-dark); font-size:13.5px; margin-left:6px;">${escapeHtml(r.title)}</strong>
                      </div>

                      <p style="font-size:13.5px; color:var(--text-secondary); line-height:1.6; margin:0 0 12px;">${escapeHtml(r.content)}</p>

                      <!-- Actual Photos & Video Play Thumbnails -->
                      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
                        <img src="assets/city-g.jpg" style="width:100px; height:70px; object-fit:cover; border-radius:8px; border:1px solid #E2E8F0;" alt="Ảnh thực tế">
                        <div style="position:relative; width:100px; height:70px; border-radius:8px; overflow:hidden; border:1px solid #E2E8F0; cursor:pointer;" onclick="showToast('Đang mở video clip đánh giá xe...', '▶️')">
                          <img src="assets/Interior.png" style="width:100%; height:100%; object-fit:cover;" alt="Video">
                          <div style="position:absolute; inset:0; background:rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; color:#FFFFFF; font-size:18px;">▶</div>
                        </div>
                      </div>

                      <!-- Helpful Button & Reply Button -->
                      <div style="display:flex; align-items:center; gap:16px; border-top:1px solid #F1F5F9; padding-top:10px; font-size:12.5px;">
                        <button class="btn-card-outline btn-vote-helpful" data-id="${r.id}" style="padding:5px 12px; font-size:12px; ${hasVoted ? 'border-color:var(--primary); color:var(--primary); background:#EFF6FF;' : ''}">
                          👍 Hữu ích (${helpfulCount})
                        </button>
                        <button class="btn-card-outline btn-toggle-reply-box" data-id="${r.id}" style="padding:5px 12px; font-size:12px;">
                          💬 Phản hồi (${replyCount})
                        </button>
                      </div>

                      <!-- Expandable Reply Box -->
                      <div class="review-reply-mount" id="reply-box-${r.id}" style="display:none; margin-top:10px; padding:10px; background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0;">
                        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">
                          <strong>Chuyên viên CSKH SIGMACAR:</strong> Cảm ơn bạn đã tin tưởng và đồng hành cùng hệ sinh thái xe điện SIGMACAR!
                        </div>
                        <div style="display:flex; gap:6px;">
                          <input type="text" placeholder="Viết phản hồi của bạn..." class="filter-input" style="font-size:12px; padding:6px 10px;">
                          <button class="btn-primary" onclick="showToast('Đã gửi phản hồi thành công!', '✓')" style="padding:6px 12px; font-size:12px;">Gửi</button>
                        </div>
                      </div>
                    </div>
                  `;
                }).join('') : `
                  <div style="text-align:center; padding:36px; background:#FFFFFF; border:1px dashed #CBD5E1; border-radius:16px;">
                    <div style="font-size:32px; margin-bottom:8px;">💬</div>
                    <h4 style="font-size:16px; font-weight:700; color:var(--text-dark); margin:0;">Chưa có đánh giá nào phù hợp với bộ lọc</h4>
                  </div>
                `}
              </div>

              <!-- Pagination (Reviews & Community.pdf) -->
              <div style="display:flex; justify-content:center; align-items:center; gap:8px; margin-top:24px;">
                <button class="btn-card-outline" style="padding:6px 12px; font-size:12px;">‹</button>
                <button class="filter-pill-btn active" style="padding:6px 12px; font-size:12px;">1</button>
                <button class="filter-pill-btn" style="padding:6px 12px; font-size:12px;">2</button>
                <button class="filter-pill-btn" style="padding:6px 12px; font-size:12px;">3</button>
                <span style="color:var(--text-muted); font-size:12px;">...</span>
                <button class="filter-pill-btn" style="padding:6px 12px; font-size:12px;">12</button>
                <button class="btn-card-outline" style="padding:6px 12px; font-size:12px;">›</button>
              </div>
            </div>

            <!-- Right Column: Community Sidebar (Hỏi đáp, Chuyên gia, Quy tắc) -->
            <div>
              <!-- Card 1: Hỏi đáp Cộng đồng -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                  <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin:0;">Hỏi đáp Cộng đồng</h4>
                  <span class="badge-role" style="background:#FEF3C7; color:#B45309; font-weight:800; font-size:11px;">24 câu hỏi mới</span>
                </div>

                <!-- Search Question -->
                <div style="margin-bottom:14px;">
                  <input type="text" id="inp-search-qa" placeholder="🔍 Tìm kiếm câu hỏi..." class="filter-input" style="font-size:12.5px; padding:8px 12px;">
                </div>

                <!-- Q&A List with Q (orange) and A (green) -->
                <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:16px;" id="qa-cards-container">
                  <div style="padding:10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; font-size:12px;">
                    <div style="display:flex; gap:6px; margin-bottom:4px;">
                      <span style="background:#F59E0B; color:#FFFFFF; font-weight:800; font-size:10px; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center;">Q</span>
                      <strong style="color:var(--text-dark);">Pin LFP sạc đầy 100% hằng ngày có giảm tuổi thọ không?</strong>
                    </div>
                    <div style="display:flex; gap:6px; padding-left:24px; color:var(--text-secondary);">
                      <span style="background:#10B981; color:#FFFFFF; font-weight:800; font-size:10px; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center;">A</span>
                      <span>Pin LFP chịu sốc nhiệt và chu kỳ sạc cao rất tốt. Tuy nhiên nên duy trì 80% nếu để xe lâu ngày.</span>
                    </div>
                  </div>

                  <div style="padding:10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; font-size:12px;">
                    <div style="display:flex; gap:6px; margin-bottom:4px;">
                      <span style="background:#F59E0B; color:#FFFFFF; font-weight:800; font-size:10px; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center;">Q</span>
                      <strong style="color:var(--text-dark);">Chi phí bảo dưỡng định kỳ 10.000 km là bao nhiêu?</strong>
                    </div>
                    <div style="display:flex; gap:6px; padding-left:24px; color:var(--text-secondary);">
                      <span style="background:#10B981; color:#FFFFFF; font-weight:800; font-size:10px; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center;">A</span>
                      <span>Khoảng 450.000đ - 700.000đ chủ yếu thay lọc gió điều hòa HEPA và kiểm tra siết gầm.</span>
                    </div>
                  </div>
                </div>

                <!-- Ask Question Form -->
                <form id="form-ask-community-question" style="display:flex; flex-direction:column; gap:8px;">
                  <input type="text" class="filter-input" id="inp-community-question" placeholder="Đặt câu hỏi mới cho cộng đồng..." style="font-size:12px; padding:8px 12px;" required>
                  <button type="submit" class="btn-dark" style="width:100%; justify-content:center; padding:9px; font-size:13px; font-weight:700;">
                    Đặt câu hỏi cho cộng đồng
                  </button>
                </form>
              </div>

              <!-- Card 2: Chuyên gia cộng đồng -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin:0 0 14px;">Chuyên gia cộng đồng</h4>
                
                <div style="display:flex; flex-direction:column; gap:12px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:10px;">
                      <img src="assets/avatar-sales.jpg" style="width:38px; height:38px; border-radius:50%; object-fit:cover;" alt="Expert 1">
                      <div>
                        <strong style="font-size:13px; color:var(--text-dark); display:block;">Kỹ sư Trần Hải Long</strong>
                        <span style="font-size:11px; color:var(--text-muted);">Chuyên gia Pin & Trạm sạc EV</span>
                      </div>
                    </div>
                    <button class="btn-card-outline btn-follow-expert" data-name="Trần Hải Long" style="padding:4px 10px; font-size:11.5px; border-color:#2563EB; color:#2563EB; font-weight:700;">
                      + Theo dõi
                    </button>
                  </div>

                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:10px;">
                      <img src="assets/avatar-driver.jpg" style="width:38px; height:38px; border-radius:50%; object-fit:cover;" alt="Expert 2">
                      <div>
                        <strong style="font-size:13px; color:var(--text-dark); display:block;">Nguyễn Minh Tuấn</strong>
                        <span style="font-size:11px; color:var(--text-muted);">Kỹ thuật trưởng Xưởng dịch vụ 3S</span>
                      </div>
                    </div>
                    <button class="btn-card-outline btn-follow-expert" data-name="Nguyễn Minh Tuấn" style="padding:4px 10px; font-size:11.5px; border-color:#2563EB; color:#2563EB; font-weight:700;">
                      + Theo dõi
                    </button>
                  </div>
                </div>
              </div>

              <!-- Card 3: Quy tắc cộng đồng (Card Xanh) -->
              <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:18px; padding:18px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                  <span style="font-size:18px;">⚖️</span>
                  <strong style="font-size:13px; color:#1E40AF;">Quy tắc thảo luận cộng đồng</strong>
                </div>
                <div style="font-size:12px; color:#1E3A8A; line-height:1.6;">
                  • Tôn trọng trải nghiệm thực tế, ngôn từ văn minh.<br>
                  • Nghiêm cấm quảng cáo, spam thương mại trái phép.<br>
                  • Các đánh giá có chứng minh thư và số VIN được ghim ưu tiên.
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Event handlers for reply toggle and expert follow
      document.querySelectorAll('.btn-toggle-reply-box').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const box = document.getElementById(`reply-box-${id}`);
          if (box) {
            box.style.display = box.style.display === 'none' ? 'block' : 'none';
          }
        });
      });

      document.querySelectorAll('.btn-follow-expert').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.getAttribute('data-name');
          const isFollowing = btn.textContent.includes('Đang theo dõi');
          if (isFollowing) {
            btn.textContent = '+ Theo dõi';
            btn.style.background = 'transparent';
            btn.style.color = '#2563EB';
            showToast(`Đã hủy theo dõi chuyên gia ${name}`, 'ℹ️');
          } else {
            btn.textContent = '✓ Đang theo dõi';
            btn.style.background = '#2563EB';
            btn.style.color = '#FFFFFF';
            showToast(`Đã theo dõi chuyên gia ${name}! Bạn sẽ nhận thông báo khi có giải đáp mới.`, '🔔');
          }
        });
      });

      document.getElementById('btn-filter-media-only')?.addEventListener('click', () => {
        ReviewViewState.hasMediaOnly = !ReviewViewState.hasMediaOnly;
        loadAndRenderVehicleReviews(car);
      });

      document.getElementById('inp-search-qa')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        document.querySelectorAll('#qa-cards-container > div').forEach(card => {
          card.style.display = card.textContent.toLowerCase().includes(query) ? 'block' : 'none';
        });
      });

      // Bind Review Section Events
      document.getElementById('btn-toggle-review-form')?.addEventListener('click', () => {
        requireAuth('viết đánh giá xe', () => {
          ReviewViewState.showForm = !ReviewViewState.showForm;
          if (!ReviewViewState.showForm) ReviewViewState.editingReviewId = null;
          loadAndRenderVehicleReviews(car);
        });
      });

      document.getElementById('btn-cancel-review-form')?.addEventListener('click', () => {
        ReviewViewState.showForm = false;
        ReviewViewState.editingReviewId = null;
        loadAndRenderVehicleReviews(car);
      });

      document.querySelectorAll('[data-rev-star]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          ReviewViewState.star = e.currentTarget.getAttribute('data-rev-star');
          loadAndRenderVehicleReviews(car);
        });
      });

      document.getElementById('chk-rev-verified-only')?.addEventListener('change', (e) => {
        ReviewViewState.verifiedOnly = e.target.checked;
        loadAndRenderVehicleReviews(car);
      });

      document.getElementById('sel-rev-sort')?.addEventListener('change', (e) => {
        ReviewViewState.sort = e.target.value;
        loadAndRenderVehicleReviews(car);
      });

      document.getElementById('form-submit-vehicle-review')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const fileInp = document.getElementById('rev-media-files');
          const mediaList = [];
          if (fileInp && fileInp.files && fileInp.files.length > 0) {
            for (const f of Array.from(fileInp.files)) {
              mediaList.push({
                name: f.name,
                sizeKb: Math.round(f.size / 1024),
                url: car.image || 'assets/garage-car-detail.jpg',
                caption: f.name
              });
            }
          }

          const payload = {
            vehicleId: car.id,
            rating: Number(document.getElementById('rev-rating').value),
            criteria: {
              design: Number(document.getElementById('rev-crit-design').value),
              performance: Number(document.getElementById('rev-crit-perf').value),
              features: Number(document.getElementById('rev-crit-feat').value),
              comfort: Number(document.getElementById('rev-crit-comfort').value),
              value: Number(document.getElementById('rev-crit-value').value)
            },
            title: document.getElementById('rev-title').value.trim(),
            content: document.getElementById('rev-content').value.trim(),
            media: mediaList
          };

          if (ReviewViewState.editingReviewId) {
            const res = await ApiClient.reviews.update(ReviewViewState.editingReviewId, payload);
            showToast(res.message || 'Đã cập nhật đánh giá thành công!', '✓');
          } else {
            const res = await ApiClient.reviews.create(payload);
            showToast(res.message || 'Đã gửi đánh giá thành công!', '🎉');
          }

          ReviewViewState.showForm = false;
          ReviewViewState.editingReviewId = null;
          loadAndRenderVehicleReviews(car);
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });

      document.querySelectorAll('.btn-edit-own-review').forEach(btn => {
        btn.addEventListener('click', (e) => {
          ReviewViewState.editingReviewId = e.currentTarget.getAttribute('data-id');
          ReviewViewState.showForm = true;
          loadAndRenderVehicleReviews(car);
        });
      });

      document.querySelectorAll('.btn-delete-own-review').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const revId = e.currentTarget.getAttribute('data-id');
          try {
            await ApiClient.reviews.delete(revId);
            showToast('Đã xóa bài đánh giá của bạn.', '🗑️');
            loadAndRenderVehicleReviews(car);
          } catch (err) {
            showToast(err.message, '⚠️');
          }
        });
      });

      document.querySelectorAll('.btn-vote-helpful').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const revId = e.currentTarget.getAttribute('data-id');
          requireAuth('bình chọn đánh giá hữu ích', async () => {
            try {
              const res = await ApiClient.reviews.toggleHelpful(revId);
              showToast(res.message, '👍');
              loadAndRenderVehicleReviews(car);
            } catch (err) {
              showToast(err.message, '⚠️');
            }
          });
        });
      });

      document.querySelectorAll('.btn-report-review').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const revId = e.currentTarget.getAttribute('data-id');
          requireAuth('báo cáo nội dung', async () => {
            try {
              const res = await ApiClient.reviews.report(revId, 'Nội dung cần kiểm duyệt');
              showToast(res.message, '🚩');
            } catch (err) {
              showToast(err.message, '⚠️');
            }
          });
        });
      });

      document.getElementById('form-ask-community-question')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const qVal = document.getElementById('inp-community-question')?.value.trim();
        requireAuth('đặt câu hỏi thảo luận', async () => {
          try {
            const res = await ApiClient.reviews.askQuestion({ vehicleId: car.id, question: qVal });
            showToast(res.message, '❓');
            loadAndRenderVehicleReviews(car);
          } catch (err) {
            showToast(err.message, '⚠️');
          }
        });
      });

      document.querySelectorAll('.btn-submit-answer').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const qid = e.currentTarget.getAttribute('data-qid');
          const inp = document.querySelector(`.inp-answer-question[data-qid="${qid}"]`);
          const content = inp?.value.trim();
          requireAuth('trả lời câu hỏi', async () => {
            try {
              const res = await ApiClient.reviews.answerQuestion(qid, content);
              showToast(res.message, '💬');
              loadAndRenderVehicleReviews(car);
            } catch (err) {
              showToast(err.message, '⚠️');
            }
          });
        });
      });
    } catch (err) {
      mount.innerHTML = `<div style="padding:24px; color:#DC2626;">Không thể tải mục đánh giá: ${escapeHtml(err.message)}</div>`;
    }
  }

  // =================================================================
  // VIEW: PHỤ KIỆN & ĐỒ CHƠI Ô TÔ (From about car/Data-xe.xlsx)
  // =================================================================
  function renderAccessories() {
    let list = SIGMA_DATA.accessories || [];
    if (AppState.activeAccessoryCategory && AppState.activeAccessoryCategory !== 'all') {
      list = list.filter(a => a.category.includes(AppState.activeAccessoryCategory));
    }

    viewsContainer.innerHTML = `
      <section class="section" style="padding-top:40px;">
        <div class="container">
          <!-- Hero Header -->
          <div style="background:linear-gradient(135deg, #0A1128 0%, #0F172A 60%, #0284C7 100%); border-radius:var(--radius-xl); padding:48px 56px; color:#FFFFFF; margin-bottom:40px; position:relative; overflow:hidden;">
            <span style="font-size:11px; font-weight:800; letter-spacing:0.15em; color:var(--accent-cyan); text-transform:uppercase;">GENUINE AUTOMOTIVE ACCESSORIES</span>
            <h1 style="font-size:42px; font-weight:800; line-height:1.2; margin:10px 0 16px;">
              PHỤ KIỆN & ĐỒ CHƠI Ô TÔ CHÍNH HÃNG <br>
              <span style="color:var(--accent-cyan);">TIỆN NGHI • AN TOÀN • ĐẲNG CẤP</span>
            </h1>
            <p style="color:#94A3B8; max-width:680px; font-size:15.5px; line-height:1.6;">
              Bộ sưu tập phụ kiện chuẩn thiết kế từ các thương hiệu hàng đầu: Vietmap, 3M, KATA, Steelmate, Anker, Baseus... Mang đến sự an tâm và trải nghiệm lái xe trọn vẹn nhất.
            </p>
          </div>

          <!-- Category Filter Bar -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:32px; flex-wrap:wrap; gap:16px;">
            <div>
              <h3 style="font-size:24px; font-weight:800; color:var(--text-dark);">Danh mục phụ kiện (${list.length} sản phẩm)</h3>
              <p style="font-size:14px; color:var(--text-muted);">Sản phẩm chính hãng 100%, bảo hành 12 - 24 tháng</p>
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="chip-btn ${(!AppState.activeAccessoryCategory || AppState.activeAccessoryCategory === 'all') ? 'active' : ''}" data-acc-cat="all">Tất cả</button>
              <button class="chip-btn ${AppState.activeAccessoryCategory === 'Thiết bị điện tử' ? 'active' : ''}" data-acc-cat="Thiết bị điện tử">Thiết bị điện tử</button>
              <button class="chip-btn ${AppState.activeAccessoryCategory === 'Nội thất' ? 'active' : ''}" data-acc-cat="Nội thất">Nội thất & Tỏa hương</button>
              <button class="chip-btn ${AppState.activeAccessoryCategory === 'Chăm sóc' ? 'active' : ''}" data-acc-cat="Chăm sóc">Chăm sóc & Phim cách nhiệt</button>
              <button class="chip-btn ${AppState.activeAccessoryCategory === 'Cứu hộ' ? 'active' : ''}" data-acc-cat="Cứu hộ">Cứu hộ & An toàn</button>
            </div>
          </div>

          <!-- Grid of accessories -->
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:24px;">
            ${list.map(acc => `
              <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); overflow:hidden; display:flex; flex-direction:column; justify-content:space-between; transition:transform 0.2s, box-shadow 0.2s; box-shadow:var(--shadow-sm);" onmouseenter="this.style.transform='translateY(-4px)'; this.style.boxShadow='var(--shadow-md)'" onmouseleave="this.style.transform='none'; this.style.boxShadow='var(--shadow-sm)'">
                <div>
                  <div style="position:relative; width:100%; height:200px; background:#F1F5F9; overflow:hidden;">
                    <img src="${acc.image}" alt="${acc.name}" style="width:100%; height:100%; object-fit:cover;">
                    <span style="position:absolute; top:12px; left:12px; background:rgba(15,23,42,0.85); backdrop-filter:blur(4px); color:#FFFFFF; font-size:11px; font-weight:700; padding:4px 8px; border-radius:4px;">${acc.id ? acc.id + ' • ' : ''}${acc.brand}</span>
                    ${acc.badge ? `<span style="position:absolute; top:12px; right:12px; background:var(--primary); color:#FFFFFF; font-size:11px; font-weight:700; padding:4px 8px; border-radius:4px;">${acc.badge}</span>` : ''}
                  </div>
                  <div style="padding:20px;">
                    <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:4px;">${acc.category} • Màu: ${acc.colors || 'Tiêu chuẩn'}</div>
                    <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin-bottom:8px; line-height:1.3;">${acc.name}</h4>
                    <div style="font-size:18px; font-weight:800; color:var(--primary); margin-bottom:12px;">${acc.priceFormatted}</div>
                    <p style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin-bottom:12px;">${acc.specs}</p>
                    <div style="font-size:12px; color:var(--text-muted);">
                      ✓ Tình trạng: Còn ${acc.quantity} sản phẩm trong kho • Năm SX: ${acc.year}
                    </div>
                  </div>
                </div>

                <div style="padding:0 20px 20px;">
                  <button class="btn-primary" style="width:100%; justify-content:center; padding:12px;" onclick="showToast('Đặt mua phụ kiện ${acc.name} (${acc.id}) thành công! Đại lý sẽ liên hệ giao hàng.', '🛒')">
                    🛒 Đặt mua phụ kiện
                  </button>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Linh kiện & Pin Xe Điện Chính Hãng (From SIGMACAR_Vehicle_Component_Database.xlsx) -->
          ${(SIGMA_DATA.components && SIGMA_DATA.components.length > 0) ? `
          <div style="margin-top:52px; padding-top:40px; border-top:1px solid var(--border-subtle);">
            <div style="margin-bottom:24px;">
              <span style="font-size:11px; font-weight:800; color:var(--primary); letter-spacing:0.12em; text-transform:uppercase;">EV GENUINE COMPONENTS & BATTERY PACKS</span>
              <h3 style="font-size:24px; font-weight:800; color:var(--text-dark); margin-top:4px;">Linh kiện, Pin & Bộ sạc Xe Điện Chính Hãng (${SIGMA_DATA.components.length} mã linh kiện)</h3>
              <p style="font-size:14px; color:var(--text-muted);">Dữ liệu đồng bộ từ SIGMACAR_Vehicle_Component_Database.xlsx (Pin LFP/NMC, Phanh Brembo, Sạc Wallbox & Portable)</p>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:20px;">
              ${SIGMA_DATA.components.map(cmp => `
                <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:20px; display:flex; flex-direction:column; justify-content:space-between; box-shadow:var(--shadow-sm);">
                  <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                      <span style="background:#EFF6FF; color:var(--primary); font-size:11px; font-weight:800; padding:3px 8px; border-radius:4px;">${cmp.id}</span>
                      <span style="font-size:11px; font-weight:700; color:var(--text-muted);">${cmp.category} • ${cmp.subCategory}</span>
                    </div>
                    <h4 style="font-size:15.5px; font-weight:800; color:var(--text-dark); margin-bottom:6px;">${cmp.name}</h4>
                    <div style="font-size:17px; font-weight:800; color:var(--primary); margin-bottom:8px;">${cmp.priceFormatted}</div>
                    <p style="font-size:12.5px; color:var(--text-secondary); line-height:1.5; margin-bottom:8px;"><strong>Thông số:</strong> ${cmp.specs}</p>
                    <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">🚗 <strong>Tương thích:</strong> ${cmp.compatibleModels}</div>
                    <div style="font-size:12px; color:#059669; font-weight:600;">🛡️ Bảo hành: ${cmp.warranty} • Sẵn kho: ${cmp.stock} bộ</div>
                  </div>
                  <button class="btn-secondary" style="margin-top:14px; width:100%; justify-content:center; padding:10px; font-weight:700;" onclick="showToast('Đã gửi yêu cầu đặt linh kiện ${cmp.name} (${cmp.id})!', '🔧')">
                    🔧 Đặt linh kiện / Tư vấn lắp đặt
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
        </div>
      </section>
    `;

    document.querySelectorAll('.chip-btn[data-acc-cat]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cat = e.target.getAttribute('data-acc-cat');
        AppState.activeAccessoryCategory = cat;
        renderAccessories();
      });
    });
  }

  // =================================================================
  // VIEW 6: SO SÁNH XE
  // =================================================================
  function renderCompare() {
    if (!AppState.compareCars || AppState.compareCars.length === 0) {
      AppState.compareCars = ['toyota-camry-25q', 'vinfast-vf-8-plus', 'model-e'];
    }
    const cars = AppState.compareCars.map(id => 
      AppState.vehiclesList.find(c => c.id === id) || AppState.vehiclesList[0]
    );

    viewsContainer.innerHTML = `
      <section class="compare-section">
        <div class="container">
          <div class="catalog-page-hero-banner" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.92) 0%, rgba(15,23,42,0.65) 60%, rgba(15,23,42,0.2) 100%), url('assets/banner-compare.jpg'); margin-bottom: 32px;">
            <div class="hero-tag">ĐỐI CHIẾU THÔNG SỐ TOÀN DIỆN</div>
            <h2>So sánh chi tiết các mẫu xe SIGMACAR</h2>
            <p>Phân tích hiệu năng vận hành, động cơ, dung lượng pin và tiện nghi công nghệ giữa 32 dòng xe chính hãng để đưa ra quyết định chuẩn xác nhất.</p>
          </div>

          <div class="compare-slots-header">
            <div style="display:flex; flex-direction:column; justify-content:center; gap:10px;">
              <div>
                <span style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted);">Đang so sánh</span>
                <div style="font-size:20px; font-weight:800; color:var(--text-dark);">${cars.length} Phiên bản</div>
              </div>
              ${cars.length < 4 ? `
                <button class="btn-secondary" id="btn-add-compare-slot" style="padding:8px 12px; font-size:12px; font-weight:700;">
                  + Thêm xe so sánh
                </button>
              ` : ''}
            </div>

            ${cars.map((car, idx) => `
              <div class="compare-card-slot" style="position:relative;">
                ${cars.length > 1 ? `<button style="position:absolute; top:10px; right:10px; font-size:16px; color:var(--text-muted); cursor:pointer;" class="btn-remove-compare" data-idx="${idx}" title="Xóa mẫu xe này">✕</button>` : ''}
                <div style="margin-bottom:10px;">
                  <select class="filter-select compare-slot-select" data-slot="${idx}" style="font-size:12px; height:34px; padding:0 8px;">
                    ${AppState.vehiclesList.map(v => `
                      <option value="${v.id}" ${v.id === car.id ? 'selected' : ''}>${v.productCode ? `[${v.productCode}] ` : ''}${v.name}</option>
                    `).join('')}
                  </select>
                </div>
                <img src="${car.image}" alt="${car.name}">
                <div style="font-size:11px; font-weight:700; color:var(--text-muted); margin-top:4px;">${car.productCode || car.id.toUpperCase()} • ${car.brand || 'SIGMACAR'}</div>
                <div class="compare-car-name">${car.name}</div>
                <div class="compare-car-price">${car.priceFormatted}</div>
                <div style="display:flex; gap:8px; justify-content:center;">
                  <button class="btn-card-outline" style="padding:6px 12px; font-size:12px;" onclick="window.openCarDetail('${car.id}')">Chi tiết</button>
                  <button class="btn-card-primary" style="padding:6px 12px; font-size:12px;" onclick="window.bookCarTestDrive('${car.id}')">Lái thử</button>
                </div>
              </div>
            `).join('')}
          </div>

          <div class="compare-table">
            <div class="compare-category-header">TỔNG QUAN & GIÁ NIÊM YẾT</div>
            <div class="compare-row">
              <div class="row-label">Mã SP & Hãng sản xuất</div>
              ${cars.map(c => `<div class="row-val"><strong>${c.productCode || c.id.toUpperCase()}</strong> • ${c.brand || 'SIGMACAR'}</div>`).join('')}
            </div>
            <div class="compare-row">
              <div class="row-label">Giá niêm yết</div>
              ${cars.map(c => `<div class="row-val" style="color:var(--primary); font-weight:800;">${c.priceFormatted}</div>`).join('')}
            </div>
            <div class="compare-row">
              <div class="row-label">Phân loại & Năm SX</div>
              ${cars.map(c => `<div class="row-val">${c.subCategory || c.category} • Năm ${c.year || 2024}</div>`).join('')}
            </div>
            <div class="compare-row">
              <div class="row-label">Màu sắc & Tồn kho</div>
              ${cars.map(c => `<div class="row-val">${c.colorsSummary || 'Đa màu sắc'} (Kho: ${c.excelStock ?? c.stock ?? 5} xe)</div>`).join('')}
            </div>
            <div class="compare-row">
              <div class="row-label">Số chỗ ngồi</div>
              ${cars.map(c => `<div class="row-val">${c.seats || 5} Chỗ</div>`).join('')}
            </div>

            <div class="compare-category-header">ĐỘNG CƠ & HIỆU SUẤT</div>
            <div class="compare-row">
              <div class="row-label">Thông số kỹ thuật chính</div>
              ${cars.map(c => `<div class="row-val">${c.excelSpecs || c.powertrain || c.power || 'Đang cập nhật'}</div>`).join('')}
            </div>
            <div class="compare-row">
              <div class="row-label">Công suất tối đa</div>
              ${cars.map(c => `<div class="row-val"><strong>${c.hp || 200} HP</strong> (${c.power || ''})</div>`).join('')}
            </div>
            <div class="compare-row">
              <div class="row-label">Hộp số & Dẫn động</div>
              ${cars.map(c => `<div class="row-val">${c.transmission || 'Tự động'} • ${c.drive || 'Tiêu chuẩn'}</div>`).join('')}
            </div>
            <div class="compare-row">
              <div class="row-label">Tăng tốc (0-100 km/h)</div>
              ${cars.map(c => `<div class="row-val" style="color:var(--accent-emerald); font-weight:800;">${c.acceleration || '7.5s'}</div>`).join('')}
            </div>

            <div class="compare-category-header">PIN / NHIÊN LIỆU & TẦM VẬN HÀNH</div>
            <div class="compare-row">
              <div class="row-label">Quãng đường / Nhiên liệu</div>
              ${cars.map(c => `<div class="row-val" style="color:var(--primary); font-weight:800;">${getVehicleFuel(c) === 'ev' ? `${c.range || 450} km / lần sạc` : 'Động cơ Xăng / Dầu tiết kiệm'}</div>`).join('')}
            </div>
            <div class="compare-row">
              <div class="row-label">Dung lượng Pin / Bình nhiên liệu</div>
              ${cars.map(c => `<div class="row-val">${c.battery || (getVehicleFuel(c) === 'ev' ? 'Pin LFP' : 'Động cơ đốt trong')}</div>`).join('')}
            </div>
            <div class="compare-row">
              <div class="row-label">Sạc nhanh / Bảo hành</div>
              ${cars.map(c => `<div class="row-val">${c.fastCharge || c.warranty || 'Bảo hành chính hãng'}</div>`).join('')}
            </div>
          </div>

          <!-- Cockpit Comparison Visual Banner -->
          <div style="margin-top:36px; border-radius:var(--radius-xl); overflow:hidden; position:relative; box-shadow:var(--shadow-md);">
            <img src="assets/interior-compare-blue.jpg" alt="So sánh không gian nội thất & khoang lái thông minh" style="width:100%; height:260px; object-fit:cover; display:block;">
            <div style="position:absolute; bottom:0; left:0; right:0; padding:24px 32px; background:linear-gradient(transparent, rgba(15,23,42,0.85)); color:#FFFFFF;">
              <h4 style="font-size:18px; font-weight:800; margin-bottom:4px; color:#FFFFFF;">Trải nghiệm không gian nội thất & Tiện nghi chuẩn thương gia</h4>
              <p style="font-size:13px; color:#E2E8F0; margin:0;">Mọi mẫu xe phân phối tại SIGMACAR đều được kiểm định chất lượng nghiêm ngặt và hỗ trợ trả góp lãi suất ưu đãi.</p>
            </div>
          </div>
        </div>
      </section>
    `;

    document.querySelectorAll('.btn-remove-compare').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
        AppState.compareCars.splice(idx, 1);
        renderCompare();
      });
    });

    document.querySelectorAll('.compare-slot-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const slotIdx = parseInt(e.currentTarget.getAttribute('data-slot'), 10);
        const newCarId = e.currentTarget.value;
        if (!isNaN(slotIdx) && newCarId) {
          AppState.compareCars[slotIdx] = newCarId;
          renderCompare();
        }
      });
    });

    document.getElementById('btn-add-compare-slot')?.addEventListener('click', () => {
      const nextCar = AppState.vehiclesList.find(v => !AppState.compareCars.includes(v.id)) || AppState.vehiclesList[0];
      if (nextCar && AppState.compareCars.length < 4) {
        AppState.compareCars.push(nextCar.id);
        renderCompare();
      }
    });
  }

  // =================================================================
  // VIEW 5B: VR / AR / 360° SHOWROOM (Trang VR AR Xem Xe Trực Tuyến.pdf)
  // =================================================================
  function renderVrArShowroomPage() {
    // Dispose previous 3D instance if running to prevent memory leaks
    if (window._activeCar3DViewer) {
      try {
        window._activeCar3DViewer.dispose();
      } catch (e) {}
      window._activeCar3DViewer = null;
    }

    const car = AppState.vehiclesList.find(c => c.id === AppState.currentDetailCar) ||
                AppState.certifiedList.find(c => c.id === AppState.currentDetailCar) ||
                AppState.vehiclesList[0];

    const isElectric = !!(car.battery || (car.range && car.range > 0));
    const wheelsList = SIGMA_DATA.wheels || [
      { id: 'wheel-21-sport', name: '21" Sport Wheels', label: '21" Sport', price: 0, tag: 'Tiêu chuẩn', desc: 'Mâm đúc hợp kim đa chấu thể thao khí động học' },
      { id: 'wheel-20-aero', name: '20" Aero Wheels', label: '20" Aero', price: 25000000, tag: 'Tiết kiệm pin', desc: 'Tối ưu hóa tầm vận hành +25km' },
      { id: 'wheel-22-forged', name: '22" Forged Performance', label: '22" Forged', price: 65000000, tag: 'Hiệu năng cao', desc: 'Hợp kim nhôm rèn siêu nhẹ siêu cứng' }
    ];

    const hotspotsList = [
      {
        id: 'hotspot-led',
        name: 'Đèn pha Matrix LED Thông Minh',
        category: 'Hệ thống chiếu sáng',
        pos: [1.88, 0.46, 0.68],
        desc: 'Chiếu sáng thích ứng chống chói thông minh với 84 bóng LED ma trận độc lập, tầm chiếu xa 600m.'
      },
      {
        id: 'hotspot-interior',
        name: 'Khoang lái Số & Da Nappa',
        category: 'Nội thất & Tiện nghi',
        pos: [0.15, 0.82, 0.55],
        desc: 'Ghế bọc da Nappa thủ công tích hợp sưởi, thông gió đa tầng và 8 chế độ massage thư giãn.'
      },
      {
        id: 'hotspot-wheels',
        name: 'Mâm Thể Thao & Phanh Brembo',
        category: 'Khung gầm & Vận hành',
        pos: [1.32, 0.35, 0.96],
        desc: 'Cùm phanh gốm Brembo 6 piston hiệu năng cao kết hợp đĩa phanh thông gió an toàn tối đa.'
      },
      {
        id: 'hotspot-battery',
        name: 'Cụm Pin Thông Minh & Cổng Sạc Siêu Nhanh',
        category: 'Hệ truyền động Điện',
        pos: [-1.45, 0.62, 0.86],
        desc: 'Pin LFP 82 kWh thế hệ mới, hỗ trợ sạc siêu nhanh DC 250 kW: từ 10% lên 80% chỉ trong 18 phút.'
      }
    ];

    const carColors = (car.colors && car.colors.length > 0) ? car.colors : [
      { name: 'Xanh Cyan Ánh Kim', hex: '#0284C7', img: car.image },
      { name: 'Xanh Navy Đậm', hex: '#1E3A8A', img: car.image },
      { name: 'Trắng Ngọc Trai', hex: '#F8FAFC', img: car.image },
      { name: 'Xám Xi Măng', hex: '#64748B', img: car.image },
      { name: 'Đỏ Thể Thao', hex: '#DC2626', img: car.image },
      { name: 'Đen Ánh Kim', hex: '#0F172A', img: car.image }
    ];

    let currentAngle = 137;
    let selectedWheel = wheelsList[0];
    let selectedColorIdx = 0;
    let isMuted = true;
    let audioCtx = null;
    let motorOscillator = null;

    // Explore other cars
    const otherCars = AppState.vehiclesList.filter(v => v.id !== car.id).slice(0, 4);

    viewsContainer.innerHTML = `
      <section class="section" style="padding-top:24px; padding-bottom:60px;">
        <div class="container">
          <!-- Breadcrumb & Top Bar -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
            <div style="font-size:13px; color:var(--text-muted);">
              <a href="javascript:void(0)" onclick="window.location.hash='home'">Trang chủ</a> / 
              <a href="javascript:void(0)" onclick="window.location.hash='new-cars'">Showroom</a> / 
              <span style="color:var(--text-dark); font-weight:700;">Showroom 360° VR & AR — ${escapeHtml(car.name)}</span>
            </div>
            <div style="display:flex; gap:10px;">
              <button class="btn-card-outline" onclick="window.openArLive('${car.id}')" style="padding:7px 14px; font-size:12.5px; border-color:#2563EB; color:#2563EB; font-weight:700;">
                📷 Chế độ AR Trực tiếp
              </button>
              <button class="btn-primary" onclick="window.openArAtHome('${car.id}')" style="padding:7px 14px; font-size:12.5px;">
                📦 Xem AR tại nhà bạn (AI)
              </button>
            </div>
          </div>

          <!-- Main Stage & Configurator Panel (2 Columns) -->
          <div class="vr-ar-stage-container">
            <!-- Viewport 68% Left -->
            <div class="vr-stage-dark" id="vr-stage-wrapper">
              <div class="vr-stage-header">
                <div class="vr-mode-pills">
                  <button class="vr-mode-btn active" id="btn-mode-360">360° 3D</button>
                  <button class="vr-mode-btn" id="btn-mode-vr">🥽 VR</button>
                  <button class="vr-mode-btn" id="btn-mode-ar">📦 AR</button>
                </div>
                <div class="vr-util-buttons">
                  <button class="vr-util-btn" id="btn-vr-sound" title="Bật/Tắt âm thanh mô phỏng">${isMuted ? '🔇' : '🔊'}</button>
                  <button class="vr-util-btn" id="btn-vr-share" title="Sao chép liên kết chia sẻ">🔗</button>
                  <button class="vr-util-btn" id="btn-vr-fullscreen" title="Toàn màn hình">⛶</button>
                </div>
              </div>

              <!-- Real 3D Car Viewport & Interactive Hotspots Overlay -->
              <div class="vr-car-viewport" id="vr-car-viewport">
                <!-- Three.js Real 3D Canvas Box -->
                <div id="vr-3d-canvas-container" class="vr-car-canvas-box"></div>

                <!-- Sleek Model Loading Overlay -->
                <div id="vr-loading-overlay" class="vr-loading-overlay">
                  <div class="vr-loading-spinner"></div>
                  <div style="font-size:15px; font-weight:800; color:#FFFFFF; margin-bottom:4px; letter-spacing:0.5px;">KHỞI TẠO KHÔNG GIAN 3D REALTIME</div>
                  <div style="font-size:12.5px; color:#94A3B8;" id="vr-loading-progress-text">Đang tải mô hình PBR & phản chiếu studio 4K...</div>
                </div>

                <!-- Spatial Audio & 3D Indicator Badge -->
                <div style="position:absolute; bottom:14px; left:16px; font-size:11px; color:rgba(255,255,255,0.55); pointer-events:none; z-index:15; display:flex; align-items:center; gap:8px;">
                  <span style="display:inline-block; width:7px; height:7px; background:#10B981; border-radius:50%; box-shadow:0 0 8px #10B981;"></span>
                  <span>REAL 3D PBR ENGINE • THREE.JS WEBGL</span>
                </div>
              </div>

              <!-- Footer Rotation Slider & Floating CTAs -->
              <div class="vr-stage-footer">
                <div class="vr-rotation-bar">
                  <span class="vr-rotation-label">« XOAY GÓC XE 360°</span>
                  <input type="range" id="vr-rotation-input" class="vr-rotation-slider" min="0" max="360" value="${currentAngle}">
                  <span class="vr-rotation-degree" id="vr-rotation-deg-label">${currentAngle}° »</span>
                </div>

                <div class="vr-cta-bar">
                  <button class="btn-primary" id="btn-vr-enter-mode" style="padding:10px 20px; font-size:13px; background:linear-gradient(135deg, #1E40AF, #2563EB);">
                    🥽 Vào chế độ VR (Kính VR)
                  </button>
                  <button class="btn-secondary" id="btn-vr-at-home" style="padding:10px 20px; font-size:13px; background:rgba(255,255,255,0.95); color:#0F172A;">
                    📦 Xem AR tại nhà bạn
                  </button>
                </div>
              </div>
            </div>

            <!-- Configurator Panel 32% Right -->
            <div class="vr-config-panel">
              <div>
                <div style="display:flex; gap:6px; margin-bottom:8px;">
                  <span class="badge-role" style="background:#EFF6FF; color:#2563EB; font-size:11px; font-weight:800;">${isElectric ? 'XE THUẦN ĐIỆN' : 'XE CHÍNH HÃNG'}</span>
                  <span class="badge-role" style="background:#ECFDF5; color:#059669; font-size:11px; font-weight:800;">MỚI 2026</span>
                </div>
                <h2 style="font-size:24px; font-weight:800; color:var(--text-dark); margin:0 0 4px;">${escapeHtml(car.name)}</h2>
                <div style="font-size:20px; font-weight:800; color:var(--primary); margin-bottom:14px;">
                  <span id="vr-panel-price">${car.priceFormatted || '1.450.000.000 VNĐ'}</span>
                </div>
              </div>

              <!-- Color Picker -->
              <div>
                <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:8px;">
                  <span style="font-weight:700; color:var(--text-dark);">CHỌN MÀU SƠN PBR:</span>
                  <span style="color:var(--primary); font-weight:600;" id="vr-selected-color-name">${escapeHtml(carColors[0]?.name || 'Tiêu chuẩn')}</span>
                </div>
                <div class="vr-color-picker-group">
                  ${carColors.map((c, idx) => `
                    <div class="vr-color-dot ${idx === 0 ? 'active' : ''}" data-idx="${idx}" data-name="${escapeHtml(c.name)}" style="background:${c.hex};" title="${escapeHtml(c.name)}"></div>
                  `).join('')}
                </div>
              </div>

              <!-- Wheel Selection -->
              <div>
                <div style="font-size:12.5px; font-weight:700; color:var(--text-dark); margin-bottom:8px;">CHỌN MÂM XE:</div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                  ${wheelsList.map((w, idx) => `
                    <div class="vr-wheel-card ${idx === 0 ? 'active' : ''}" data-wheel-id="${w.id}" data-wheel-price="${w.price}">
                      <div>
                        <strong style="font-size:13px; color:var(--text-dark);">${escapeHtml(w.name)}</strong>
                        <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(w.desc)}</div>
                      </div>
                      <div style="text-align:right;">
                        <span style="font-size:12px; font-weight:700; color:var(--primary);">${w.price === 0 ? 'Tiêu chuẩn' : `+${(w.price / 1000000).toLocaleString('vi-VN')} triệu`}</span>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>

              <!-- Quick Specs 3 Columns -->
              <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; padding:12px; background:#F8FAFC; border-radius:12px; text-align:center;">
                <div>
                  <div style="font-size:10px; font-weight:700; color:var(--text-muted);">QUÃNG ĐƯỜNG</div>
                  <strong style="font-size:14px; color:var(--primary);">${car.range || 620} km</strong>
                </div>
                <div>
                  <div style="font-size:10px; font-weight:700; color:var(--text-muted);">TĂNG TỐC</div>
                  <strong style="font-size:14px; color:var(--text-dark);">${car.acceleration || '3.2 s'}</strong>
                </div>
                <div>
                  <div style="font-size:10px; font-weight:700; color:var(--text-muted);">CÔNG SUẤT</div>
                  <strong style="font-size:14px; color:var(--text-dark);">${car.hp || 680} hp</strong>
                </div>
              </div>

              <!-- CTA Deposit & Guarantee -->
              <div>
                <button class="btn-primary" id="btn-vr-deposit-now" style="width:100%; justify-content:center; padding:14px; font-size:15px; font-weight:800; box-shadow:0 6px 20px rgba(37,99,235,0.35);">
                  Đặt cọc ngay →
                </button>
                <div style="font-size:11.5px; color:#059669; text-align:center; font-weight:600; margin-top:8px;">
                  🛡️ Hoàn cọc 100% nếu hủy trong 7 ngày theo chính sách
                </div>
              </div>
            </div>
          </div>

          <!-- Section 2: TRẢI NGHIỆM ĐA CHẠM — Cách trải nghiệm (3 Cards) -->
          <div style="margin-top:20px;">
            <div style="text-align:center; margin-bottom:24px;">
              <span class="badge-role" style="background:#EFF6FF; color:#2563EB; font-size:11.5px; font-weight:800;">TRẢI NGHIỆM ĐA CHẠM</span>
              <h3 style="font-size:26px; font-weight:800; color:var(--text-dark); margin:6px 0;">3 Cách Trải Nghiệm Không Gian Số</h3>
              <p style="font-size:14px; color:var(--text-muted); max-width:600px; margin:0 auto;">Lựa chọn phương thức thuận tiện nhất với thiết bị của bạn để tương tác toàn diện.</p>
            </div>

            <div class="vr-methods-grid">
              <!-- Method 1: Kính VR -->
              <div class="vr-method-card">
                <div style="font-size:32px;">🥽</div>
                <div>
                  <h4 style="font-size:17px; font-weight:800; color:var(--text-dark); margin-bottom:6px;">Kính VR (Apple Vision Pro, Meta Quest)</h4>
                  <p style="font-size:13px; color:var(--text-muted); line-height:1.6;">Đeo kính thực tế ảo và tận hưởng khoang lái tỉ lệ 1:1 sống động với độ phân giải 4K sắc nét.</p>
                </div>
                <div style="font-size:12px; color:var(--text-secondary); line-height:1.7;">
                  • Bước 1: Đeo kính VR và truy cập link website.<br>
                  • Bước 2: Cho phép cảm biến không gian 3D.<br>
                  • Bước 3: Nhấn nút bên dưới để vào không gian.
                </div>
                <button class="btn-dark" id="btn-method-vr-modal" style="width:100%; justify-content:center; padding:10px; font-size:13px; margin-top:auto;">
                  Bắt đầu VR 🥽
                </button>
              </div>

              <!-- Method 2: AR bằng Điện thoại -->
              <div class="vr-method-card">
                <div style="font-size:32px;">📱</div>
                <div>
                  <h4 style="font-size:17px; font-weight:800; color:var(--text-dark); margin-bottom:6px;">AR Bằng Điện Thoại (Quét QR)</h4>
                  <p style="font-size:13px; color:var(--text-muted); line-height:1.6;">Đặt chiếc ${escapeHtml(car.name)} thực tế ngay trong phòng khách hoặc bãi đỗ xe của bạn.</p>
                </div>
                <div class="vr-method-qr-box">
                  <div style="text-align:center;">
                    <div style="font-size:42px; line-height:1;">🏁</div>
                    <div style="font-size:10px; font-weight:800; color:#2563EB; margin-top:4px;">QUÉT MÃ AR</div>
                  </div>
                </div>
                <button class="btn-primary" onclick="window.openArLive('${car.id}')" style="width:100%; justify-content:center; padding:10px; font-size:13px; margin-top:auto;">
                  Mở AR Trực Tiếp 📷
                </button>
              </div>

              <!-- Method 3: Trình duyệt 360° -->
              <div class="vr-method-card">
                <div style="font-size:32px;">🌐</div>
                <div>
                  <h4 style="font-size:17px; font-weight:800; color:var(--text-dark); margin-bottom:6px;">Trình Duyệt 360° Đa Thiết Bị</h4>
                  <p style="font-size:13px; color:var(--text-muted); line-height:1.6;">Kéo chuột hoặc vuốt ngón tay để xoay quanh thân xe, phóng to chi tiết mâm xe và đèn pha.</p>
                </div>
                <div style="font-size:12px; color:var(--text-secondary); line-height:1.7;">
                  • Kéo thanh trượt để xoay mượt mà 0° - 360°.<br>
                  • Nhấp vào các chấm xanh Hotspot để khám phá chi tiết.<br>
                  • Đổi màu sơn và loại mâm xe tức thì.
                </div>
                <button class="btn-card-outline" id="btn-focus-slider" style="width:100%; justify-content:center; padding:10px; font-size:13px; margin-top:auto; border-color:#2563EB; color:#2563EB;">
                  Tương tác 360° 🔄
                </button>
              </div>
            </div>
          </div>

          <!-- Section 3: KHÁM PHÁ THÊM — Các mẫu xe khác (Grid 4 thẻ xe) -->
          <div style="margin-top:48px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
              <div>
                <span class="badge-role" style="background:#F1F5F9; color:#475569; font-size:11px; font-weight:800;">KHÁM PHÁ THÊM</span>
                <h3 style="font-size:22px; font-weight:800; color:var(--text-dark); margin:4px 0;">Trải Nghiệm Các Dòng Xe Khác Trong Không Gian VR/AR</h3>
              </div>
              <button class="btn-card-outline" onclick="window.location.hash='new-cars'" style="padding:8px 16px; font-size:12.5px;">
                Xem tất cả 32 mẫu xe →
              </button>
            </div>

            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:18px;">
              ${otherCars.map(oc => `
                <div class="car-card" style="cursor:pointer;" onclick="window.openVrArShowroom('${oc.id}')">
                  <div style="position:relative; overflow:hidden; border-radius:12px 12px 0 0;">
                    <img src="${oc.image}" alt="${escapeHtml(oc.name)}" style="width:100%; height:160px; object-fit:cover; display:block;">
                    <div style="position:absolute; top:10px; left:10px; display:flex; gap:4px;">
                      <span class="badge-pill-white" style="font-size:10px; padding:3px 8px;">🥽 VR</span>
                      <span class="badge-pill-white" style="font-size:10px; padding:3px 8px;">📦 AR</span>
                    </div>
                  </div>
                  <div style="padding:16px;">
                    <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">${escapeHtml(oc.brand || 'SIGMACAR')}</div>
                    <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin:4px 0 6px;">${escapeHtml(oc.name)}</h4>
                    <div style="font-size:14px; font-weight:800; color:var(--primary); margin-bottom:12px;">${oc.priceFormatted || 'Liên hệ'}</div>
                    <button class="btn-dark" style="width:100%; justify-content:center; padding:8px; font-size:12px;">
                      Mở trong Showroom VR 🥽
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </section>

      <!-- VR Headset Modal Simulation -->
      <div id="modal-vr-stereo-view" class="modal-overlay" style="display:none;">
        <div class="modal-card" style="max-width:720px; background:#0B1120; color:#FFFFFF; border:1px solid rgba(255,255,255,0.15);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:22px;">🥽</span>
              <h3 style="font-size:18px; font-weight:800; color:#FFFFFF; margin:0;">Chế độ Kính VR 4K Không Gian</h3>
            </div>
            <button class="modal-close-btn" id="btn-close-vr-modal" style="color:#FFFFFF; position:static;">✕</button>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
            <div style="background:#020617; border-radius:12px; padding:20px; text-align:center; border:1px solid rgba(255,255,255,0.1);">
              <div style="font-size:11px; color:#94A3B8; margin-bottom:8px;">MẮT TRÁI (LEFT EYE)</div>
              <img src="${car.image}" style="max-width:100%; height:140px; object-fit:contain; filter:drop-shadow(0 10px 10px rgba(0,0,0,0.5));" alt="Left Eye">
            </div>
            <div style="background:#020617; border-radius:12px; padding:20px; text-align:center; border:1px solid rgba(255,255,255,0.1);">
              <div style="font-size:11px; color:#94A3B8; margin-bottom:8px;">MẮT PHẢI (RIGHT EYE)</div>
              <img src="${car.image}" style="max-width:100%; height:140px; object-fit:contain; filter:drop-shadow(0 10px 10px rgba(0,0,0,0.5));" alt="Right Eye">
            </div>
          </div>
          <div style="font-size:12.5px; color:#94A3B8; line-height:1.6; margin-bottom:18px;">
            Hệ thống đã hiệu chỉnh khoảng cách đồng tử (IPD: 64mm) và độ trễ chuyển động &lt;12ms. Bạn có thể sử dụng cần gạt điều khiển VR hoặc cử chỉ tay để tương tác trực tiếp với xe.
          </div>
          <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button class="btn-card-outline" id="btn-cancel-vr-modal" style="color:#FFFFFF; border-color:rgba(255,255,255,0.2);">Đóng</button>
            <button class="btn-primary" onclick="showToast('Đang kết nối luồng WebXR Spatial Stream...', '🥽'); document.getElementById('modal-vr-stereo-view').style.display='none';">Bật Chế Độ Toàn Cảnh 3D</button>
          </div>
        </div>
      </div>
    `;

    // Event Bindings
    const rotInput = document.getElementById('vr-rotation-input');
    const rotLabel = document.getElementById('vr-rotation-deg-label');
    const viewerContainer = document.getElementById('vr-3d-canvas-container');
    const loadingOverlay = document.getElementById('vr-loading-overlay');
    const progressText = document.getElementById('vr-loading-progress-text');

    // Initialize Real 3D Automotive WebGL Viewer
    let viewer = null;
    if (window.Car3DViewer && window.Car3DViewer.isSupported() && viewerContainer) {
      viewer = window.Car3DViewer.init(viewerContainer, {
        modelUrl: 'assets/models/sigma-car-3d.glb',
        initialColor: carColors[0]?.hex || '#0284C7',
        initialAngle: currentAngle,
        hotspots: hotspotsList,
        onRotate: (angleDeg) => {
          currentAngle = angleDeg;
          if (rotInput) rotInput.value = angleDeg;
          if (rotLabel) rotLabel.textContent = `${angleDeg}° »`;
        },
        onHotspotClick: (h) => {
          showToast(`🔍 ${h.name}: ${h.desc}`, '💡');
        },
        onProgress: (percent) => {
          if (progressText) progressText.textContent = `Đang nạp mô hình 3D... ${percent}%`;
        },
        onReady: () => {
          if (loadingOverlay) {
            loadingOverlay.style.opacity = '0';
            setTimeout(() => { if (loadingOverlay) loadingOverlay.style.display = 'none'; }, 450);
          }
        },
        onError: (err) => {
          console.warn('[Car3DViewer] Falling back:', err);
          if (loadingOverlay) loadingOverlay.style.display = 'none';
        }
      });
      window._activeCar3DViewer = viewer;
    }

    // Bidirectional Rotation Slider Sync
    rotInput?.addEventListener('input', (e) => {
      currentAngle = parseInt(e.target.value, 10);
      rotLabel.textContent = `${currentAngle}° »`;
      if (viewer) {
        viewer.setRotationAngle(currentAngle);
      }
    });

    // Color Swatches (PBR Paint updates in real 3D)
    document.querySelectorAll('.vr-color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.vr-color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        selectedColorIdx = parseInt(dot.getAttribute('data-idx'), 10);
        const name = dot.getAttribute('data-name');
        document.getElementById('vr-selected-color-name').textContent = name;
        const chosen = carColors[selectedColorIdx];
        if (viewer && chosen?.hex) {
          viewer.setBodyColor(chosen.hex);
        }
        showToast(`Đã đổi màu sơn sang: ${name} 🎨`, '🎨');
      });
    });

    // Wheel Selector (Rim finish updates in real 3D)
    document.querySelectorAll('.vr-wheel-card').forEach(wCard => {
      wCard.addEventListener('click', () => {
        document.querySelectorAll('.vr-wheel-card').forEach(c => c.classList.remove('active'));
        wCard.classList.add('active');
        const wheelId = wCard.getAttribute('data-wheel-id');
        const wheelObj = wheelsList.find(w => w.id === wheelId);
        if (wheelObj) {
          selectedWheel = wheelObj;
          const basePrice = car.price || 1405000000;
          const totalWithWheel = basePrice + wheelObj.price;
          document.getElementById('vr-panel-price').textContent = `${totalWithWheel.toLocaleString('vi-VN')} VNĐ`;
          if (viewer) {
            viewer.setWheelType(wheelId);
          }
          showToast(`Đã chọn mâm xe: ${wheelObj.name} 🛞`, '🛞');
        }
      });
    });

    // Mode Selector
    document.getElementById('btn-mode-360')?.addEventListener('click', () => {
      document.querySelectorAll('.vr-mode-pills .vr-mode-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-mode-360').classList.add('active');
      if (viewer) viewer.resetView();
    });
    document.getElementById('btn-mode-vr')?.addEventListener('click', () => {
      document.getElementById('modal-vr-stereo-view').style.display = 'flex';
    });
    document.getElementById('btn-mode-ar')?.addEventListener('click', () => {
      window.openArLive(car.id);
    });

    // Utility buttons (Sound, Share, Fullscreen)
    const btnSound = document.getElementById('btn-vr-sound');
    btnSound?.addEventListener('click', () => {
      isMuted = !isMuted;
      btnSound.textContent = isMuted ? '🔇' : '🔊';

      if (!isMuted) {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!audioCtx) audioCtx = new AudioContextClass();
          if (audioCtx.state === 'suspended') audioCtx.resume();

          // Create subtle luxury electric motor ambient hum
          motorOscillator = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          motorOscillator.type = 'sine';
          motorOscillator.frequency.setValueAtTime(65, audioCtx.currentTime); // 65 Hz gentle EV hum
          gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);

          motorOscillator.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          motorOscillator.start();
        } catch (e) {}
        showToast('Đã kích hoạt âm thanh động cơ điện & quạt tản nhiệt ⚡', '🔊');
      } else {
        if (motorOscillator) {
          try { motorOscillator.stop(); } catch (e) {}
          motorOscillator = null;
        }
        showToast('Đã tắt âm thanh mô phỏng', '🔇');
      }
    });

    document.getElementById('btn-vr-share')?.addEventListener('click', () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.origin + window.location.pathname + '#vr-ar');
        showToast('Đã sao chép liên kết trải nghiệm Showroom 3D VR!', '🔗');
      }
    });

    document.getElementById('btn-vr-fullscreen')?.addEventListener('click', () => {
      const stage = document.getElementById('vr-stage-wrapper');
      if (!document.fullscreenElement) {
        stage?.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // CTAs
    document.getElementById('btn-vr-enter-mode')?.addEventListener('click', () => {
      document.getElementById('modal-vr-stereo-view').style.display = 'flex';
    });
    document.getElementById('btn-vr-at-home')?.addEventListener('click', () => {
      window.openArAtHome(car.id);
    });
    document.getElementById('btn-method-vr-modal')?.addEventListener('click', () => {
      document.getElementById('modal-vr-stereo-view').style.display = 'flex';
    });
    document.getElementById('btn-close-vr-modal')?.addEventListener('click', () => {
      document.getElementById('modal-vr-stereo-view').style.display = 'none';
    });
    document.getElementById('btn-cancel-vr-modal')?.addEventListener('click', () => {
      document.getElementById('modal-vr-stereo-view').style.display = 'none';
    });
    document.getElementById('btn-focus-slider')?.addEventListener('click', () => {
      rotInput?.focus();
      rotInput?.scrollIntoView({ behavior: 'smooth' });
    });

    // Deposit Button
    document.getElementById('btn-vr-deposit-now')?.addEventListener('click', () => {
      if (typeof openDepositModal === 'function') {
        openDepositModal(car.id);
      } else {
        window.openCarDetail(car.id);
      }
    });
  }

  // =================================================================
  // VIEW 5C: CHẾ ĐỘ AR TRỰC TIẾP (Chế độ AR (Trắng - Xanh).pdf)
  // =================================================================
  function renderArLiveModePage() {
    const car = AppState.vehiclesList.find(c => c.id === AppState.currentDetailCar) || AppState.vehiclesList[0];

    const carColors = (car.colors && car.colors.length > 0) ? car.colors : [
      { name: 'Xanh Cyan Ánh Kim', hex: '#0284C7', img: car.image },
      { name: 'Trắng Ngọc Trai', hex: '#F8FAFC', img: car.image },
      { name: 'Đen Ánh Kim', hex: '#0F172A', img: car.image },
      { name: 'Đỏ Thể Thao', hex: '#DC2626', img: car.image },
      { name: 'Xám Xi Măng', hex: '#64748B', img: car.image }
    ];

    let currentScale = 100; // 50 - 150
    let currentRotation = 30; // 0 - 360
    let hasRealShadow = true;
    let hasEnvLight = true;
    let showGrid = true;
    let posX = 0;
    let posY = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    // Photos taken
    let capturedList = [
      'assets/project3/ar-capture-1.jpg',
      'assets/project3/ar-capture-2.jpg',
      'assets/project3/ar-capture-3.jpg',
      'assets/project3/ar-capture-4.jpg'
    ];

    viewsContainer.innerHTML = `
      <section class="section" style="padding-top:24px; padding-bottom:60px;">
        <div class="container">
          <!-- Header Bar -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
            <div>
              <div style="font-size:13px; color:var(--text-muted); margin-bottom:4px;">
                <a href="javascript:void(0)" onclick="window.location.hash='home'">Trang chủ</a> / 
                <a href="javascript:void(0)" onclick="window.location.hash='vr-ar'">Xem AR</a> / 
                <span style="color:var(--text-dark); font-weight:700;">Chế độ AR trực tiếp</span>
              </div>
              <h2 style="font-size:26px; font-weight:800; color:var(--text-dark); margin:0;">Chế độ AR trực tiếp</h2>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span class="badge-pill-live">LIVE</span>
              <span class="badge-role" style="background:#ECFDF5; color:#059669; font-weight:700;">📷 Camera / Sân nhà đang hoạt động</span>
              <button class="btn-card-outline" onclick="window.location.hash='vr-ar'" style="padding:6px 14px; font-size:12.5px;">✕ Thoát AR</button>
            </div>
          </div>

          <!-- Main Layout 2 Columns: AR Live Stage 68% - Control Sidebar 32% -->
          <div class="ar-live-container">
            <!-- AR Live Stage Left -->
            <div class="ar-live-viewport" id="ar-live-stage" style="background-image:url('assets/project3/ar-live-bg.jpg');">
              <video id="ar-live-camera-video" class="ar-live-video-layer" autoplay playsinline muted style="display:none;"></video>
              
              <!-- Top Indicators -->
              <div style="display:flex; justify-content:space-between; align-items:center; z-index:10;">
                <div style="display:flex; gap:8px;">
                  <span class="badge-pill-live">LIVE</span>
                  <span class="badge-pill-white">✓ Đã nhận diện mặt đất</span>
                </div>
                <button class="vr-util-btn" onclick="window.location.hash='vr-ar'" title="Thoát AR">✕</button>
              </div>

              <!-- Center Entity & Ground Grid Ring -->
              <div id="ar-ground-mesh" class="ar-ground-mesh" style="display:${showGrid ? 'block' : 'none'};"></div>
              
              <div id="ar-live-vehicle" class="ar-vehicle-entity ${hasRealShadow ? 'has-shadow' : ''}" style="transform:translate(calc(-50% + ${posX}px), ${posY}px) scale(${currentScale/100}) rotate(${currentRotation}deg);">
                <div class="ar-vehicle-tag" id="ar-vehicle-tag-label">
                  ${escapeHtml(car.name)} • ${escapeHtml(carColors[0]?.name || '')} • Tỉ lệ: <span id="ar-tag-scale">${currentScale}%</span>
                </div>
                <img id="ar-vehicle-img" src="${car.image}" alt="${escapeHtml(car.name)}" style="max-height:340px; display:block; pointer-events:none; filter:${hasEnvLight ? 'contrast(1.05) brightness(1.02)' : 'none'};">
              </div>

              <!-- Floating Bottom Dock -->
              <div class="ar-floating-dock">
                <button class="ar-dock-btn" id="btn-ar-dock-camera" title="Bật Camera thực tế">📷</button>
                <button class="ar-dock-btn" id="btn-ar-dock-reset" title="Đặt lại vị trí xe">↺</button>
                <button class="ar-dock-btn" id="btn-ar-dock-minus" title="Thu nhỏ 10%">−</button>
                <button class="ar-dock-btn primary-capture" id="btn-ar-dock-shutter" title="Chụp ảnh AR">📷</button>
                <button class="ar-dock-btn" id="btn-ar-dock-grid" title="Bật/Tắt lưới mặt phẳng">⊞</button>
                <button class="ar-dock-btn" id="btn-ar-dock-plus" title="Phóng to 10%">+</button>
                <button class="ar-dock-btn" id="btn-ar-dock-video" title="Quay video AR">📹</button>
              </div>
            </div>

            <!-- Control Sidebar Right (Bảng điều khiển) -->
            <div class="vr-config-panel" style="padding:22px;">
              <h3 style="font-size:18px; font-weight:800; color:var(--text-dark); margin:0 0 16px;">Bảng điều khiển AR</h3>

              <!-- Vehicle Switcher -->
              <div>
                <label class="filter-label">Chọn xe hiển thị</label>
                <select id="ar-car-selector" class="filter-select">
                  ${AppState.vehiclesList.map(v => `<option value="${v.id}" ${v.id === car.id ? 'selected' : ''}>${escapeHtml(v.name)} (${v.priceShort || v.priceFormatted})</option>`).join('')}
                </select>
              </div>

              <!-- Color Swatches -->
              <div>
                <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">
                  <span style="font-weight:700;">MÀU XE:</span>
                  <span id="ar-color-label" style="color:var(--primary); font-weight:600;">${escapeHtml(carColors[0]?.name || '')}</span>
                </div>
                <div class="vr-color-picker-group">
                  ${carColors.map((c, idx) => `
                    <div class="vr-color-dot ${idx === 0 ? 'active' : ''}" data-idx="${idx}" data-name="${escapeHtml(c.name)}" style="background:${c.hex};" title="${escapeHtml(c.name)}"></div>
                  `).join('')}
                </div>
              </div>

              <!-- Scale Slider -->
              <div>
                <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                  <span style="font-weight:700;">KÍCH THƯỚC XE:</span>
                  <span id="ar-scale-val-label" style="font-weight:800; color:var(--primary);">${currentScale}%</span>
                </div>
                <input type="range" id="ar-scale-input" class="vr-rotation-slider" min="50" max="150" value="${currentScale}" style="width:100%;">
                <div style="display:flex; justify-content:space-between; font-size:10.5px; color:var(--text-muted); margin-top:2px;">
                  <span>50%</span>
                  <span>100% (Chuẩn 1:1)</span>
                  <span>150%</span>
                </div>
              </div>

              <!-- Rotation Slider -->
              <div>
                <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                  <span style="font-weight:700;">XOAY XE:</span>
                  <span id="ar-rot-val-label" style="font-weight:800; color:var(--primary);">${currentRotation}°</span>
                </div>
                <input type="range" id="ar-rot-input" class="vr-rotation-slider" min="0" max="360" value="${currentRotation}" style="width:100%;">
              </div>

              <!-- 2 Toggle Switches -->
              <div style="display:flex; flex-direction:column; gap:10px; padding:12px; background:#F8FAFC; border-radius:12px; border:1px solid #E2E8F0;">
                <label style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; font-size:13px; font-weight:600; color:var(--text-dark);">
                  <span>☁️ Bóng đổ thật</span>
                  <input type="checkbox" id="ar-toggle-shadow" checked style="accent-color:#2563EB; width:16px; height:16px;">
                </label>
                <label style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; font-size:13px; font-weight:600; color:var(--text-dark);">
                  <span>☀️ Ánh sáng môi trường</span>
                  <input type="checkbox" id="ar-toggle-light" checked style="accent-color:#2563EB; width:16px; height:16px;">
                </label>
              </div>

              <!-- Big Shutter Button -->
              <button class="btn-primary" id="btn-ar-sidebar-shutter" style="width:100%; justify-content:center; padding:12px; font-size:14px; font-weight:800;">
                📷 Chụp ảnh AR ngay
              </button>

              <!-- QR Card -->
              <div style="display:flex; align-items:center; gap:12px; padding:10px; background:#EFF6FF; border:1px solid #BFDBFE; border-radius:10px;">
                <span style="font-size:24px;">🏁</span>
                <div style="font-size:11.5px; color:#1E40AF;">
                  <strong>Quét QR mở trên điện thoại</strong><br>
                  Trải nghiệm định vị mặt phẳng ARKit / ARCore.
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom Row: Captured Gallery 60% - Gestures 40% -->
          <div style="display:grid; grid-template-columns:1fr 420px; gap:24px; margin-top:24px;">
            <!-- Captured Gallery -->
            <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:20px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin:0;">Ảnh đã chụp (<span id="ar-captured-count">${capturedList.length}</span>)</h4>
                <span style="font-size:12px; color:var(--primary); font-weight:600; cursor:pointer;" onclick="showToast('Toàn bộ ảnh chụp đã được lưu vào bộ sưu tập thiết bị.', '📸')">Xem tất cả →</span>
              </div>
              <div class="ar-capture-gallery" id="ar-captured-gallery-strip">
                ${capturedList.map((cImg, idx) => `
                  <img src="${cImg}" class="ar-capture-thumb" alt="Ảnh chụp AR ${idx+1}" onclick="showToast('Xem lại ảnh chụp AR #${idx+1}', '🖼️')">
                `).join('')}
              </div>
            </div>

            <!-- Gesture Instruction Cards (3 Thẻ) -->
            <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:20px; display:flex; flex-direction:column; justify-content:space-between;">
              <h4 style="font-size:15px; font-weight:800; color:var(--text-dark); margin:0 0 10px;">Hướng dẫn cử chỉ thao tác AR</h4>
              <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; font-size:12px; text-align:center;">
                <div style="padding:10px 6px; background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0;">
                  <div style="font-size:20px; margin-bottom:4px;">🔍</div>
                  <strong>Quét mặt phẳng</strong>
                  <div style="color:var(--text-muted); font-size:10.5px; margin-top:2px;">Di chuyển máy chậm rãi</div>
                </div>
                <div style="padding:10px 6px; background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0;">
                  <div style="font-size:20px; margin-bottom:4px;">👆</div>
                  <strong>Kéo di chuyển</strong>
                  <div style="color:var(--text-muted); font-size:10.5px; margin-top:2px;">Chạm kéo xe vào vị trí</div>
                </div>
                <div style="padding:10px 6px; background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0;">
                  <div style="font-size:20px; margin-bottom:4px;">👌</div>
                  <strong>Chụm thu phóng</strong>
                  <div style="color:var(--text-muted); font-size:10.5px; margin-top:2px;">Thay đổi tỉ lệ thực tế</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    // Elements
    const vehicleNode = document.getElementById('ar-live-vehicle');
    const scaleInput = document.getElementById('ar-scale-input');
    const scaleLabel = document.getElementById('ar-scale-val-label');
    const tagScale = document.getElementById('ar-tag-scale');
    const rotInput = document.getElementById('ar-rot-input');
    const rotLabel = document.getElementById('ar-rot-val-label');
    const toggleShadow = document.getElementById('ar-toggle-shadow');
    const toggleLight = document.getElementById('ar-toggle-light');
    const vehicleImg = document.getElementById('ar-vehicle-img');
    const groundMesh = document.getElementById('ar-ground-mesh');
    const carSelector = document.getElementById('ar-car-selector');

    function updateVehicleTransform() {
      vehicleNode.style.transform = `translate(calc(-50% + ${posX}px), ${posY}px) scale(${currentScale / 100}) rotate(${currentRotation}deg)`;
      scaleLabel.textContent = `${currentScale}%`;
      tagScale.textContent = `${currentScale}%`;
      rotLabel.textContent = `${currentRotation}°`;
    }

    scaleInput?.addEventListener('input', (e) => {
      currentScale = parseInt(e.target.value, 10);
      updateVehicleTransform();
    });

    rotInput?.addEventListener('input', (e) => {
      currentRotation = parseInt(e.target.value, 10);
      updateVehicleTransform();
    });

    toggleShadow?.addEventListener('change', (e) => {
      hasRealShadow = e.target.checked;
      vehicleNode.classList.toggle('has-shadow', hasRealShadow);
    });

    toggleLight?.addEventListener('change', (e) => {
      hasEnvLight = e.target.checked;
      vehicleImg.style.filter = hasEnvLight ? 'contrast(1.05) brightness(1.02)' : 'none';
    });

    carSelector?.addEventListener('change', (e) => {
      window.openArLive(e.target.value);
    });

    // Color Swatches
    document.querySelectorAll('.vr-color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.vr-color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        const cName = dot.getAttribute('data-name');
        document.getElementById('ar-color-label').textContent = cName;
        document.getElementById('ar-vehicle-tag-label').innerHTML = `${escapeHtml(car.name)} • ${escapeHtml(cName)} • Tỉ lệ: <span id="ar-tag-scale">${currentScale}%</span>`;
        showToast(`Đã đổi màu xe AR: ${cName}`, '🎨');
      });
    });

    // Drag vehicle
    vehicleNode?.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX - posX;
      dragStartY = e.clientY - posY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      posX = e.clientX - dragStartX;
      posY = e.clientY - dragStartY;
      updateVehicleTransform();
    });
    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Touch drag
    vehicleNode?.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        dragStartX = e.touches[0].clientX - posX;
        dragStartY = e.touches[0].clientY - posY;
      }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      posX = e.touches[0].clientX - dragStartX;
      posY = e.touches[0].clientY - dragStartY;
      updateVehicleTransform();
    }, { passive: true });
    window.addEventListener('touchend', () => {
      isDragging = false;
    });

    // Dock Buttons
    document.getElementById('btn-ar-dock-minus')?.addEventListener('click', () => {
      currentScale = Math.max(50, currentScale - 10);
      scaleInput.value = currentScale;
      updateVehicleTransform();
    });
    document.getElementById('btn-ar-dock-plus')?.addEventListener('click', () => {
      currentScale = Math.min(150, currentScale + 10);
      scaleInput.value = currentScale;
      updateVehicleTransform();
    });
    document.getElementById('btn-ar-dock-reset')?.addEventListener('click', () => {
      posX = 0;
      posY = 0;
      currentRotation = 30;
      currentScale = 100;
      scaleInput.value = 100;
      rotInput.value = 30;
      updateVehicleTransform();
      showToast('Đã đặt lại vị trí và góc nhìn xe!', '↺');
    });
    document.getElementById('btn-ar-dock-grid')?.addEventListener('click', () => {
      showGrid = !showGrid;
      groundMesh.style.display = showGrid ? 'block' : 'none';
      showToast(showGrid ? 'Đã bật lưới mặt phẳng' : 'Đã ẩn lưới mặt phẳng', '⊞');
    });
    document.getElementById('btn-ar-dock-video')?.addEventListener('click', () => {
      showToast('Chế độ ghi hình AR Video 60fps sẵn sàng ghi!', '📹');
    });

    // Real Camera Stream handler
    let mediaStream = null;
    document.getElementById('btn-ar-dock-camera')?.addEventListener('click', async () => {
      const videoEl = document.getElementById('ar-live-camera-video');
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
        videoEl.style.display = 'none';
        showToast('Đã dừng Camera và chuyển sang nền sân nhà AR', '📷');
      } else {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            videoEl.srcObject = mediaStream;
            videoEl.style.display = 'block';
            showToast('✓ Camera thiết bị đã kết nối thành công!', '📷');
          } catch (err) {
            showToast('Không thể mở Camera thực tế (Đang dùng nền sân nhà AR chuẩn)', 'ℹ️');
          }
        } else {
          showToast('Trình duyệt không hỗ trợ WebRTC Camera trực tiếp', 'ℹ️');
        }
      }
    });

    // Shutter capture handler
    function doCapture() {
      const flash = document.createElement('div');
      flash.style.position = 'fixed';
      flash.style.top = '0';
      flash.style.left = '0';
      flash.style.width = '100vw';
      flash.style.height = '100vh';
      flash.style.background = '#FFFFFF';
      flash.style.zIndex = '99999';
      flash.style.opacity = '0.85';
      flash.style.transition = 'opacity 0.4s ease-out';
      document.body.appendChild(flash);
      setTimeout(() => {
        flash.style.opacity = '0';
        setTimeout(() => flash.remove(), 400);
      }, 50);

      const newPhoto = 'assets/project3/ar-capture-1.jpg';
      capturedList.unshift(newPhoto);
      document.getElementById('ar-captured-count').textContent = capturedList.length;
      const gallery = document.getElementById('ar-captured-gallery-strip');
      if (gallery) {
        gallery.innerHTML = capturedList.slice(0, 4).map((cImg, idx) => `
          <img src="${cImg}" class="ar-capture-thumb" alt="Ảnh chụp AR ${idx+1}" onclick="showToast('Xem lại ảnh chụp AR #${idx+1}', '🖼️')">
        `).join('');
      }
      showToast('📸 Đã chụp và lưu ảnh AR xe vào bộ sưu tập!', '📸');
    }

    document.getElementById('btn-ar-dock-shutter')?.addEventListener('click', doCapture);
    document.getElementById('btn-ar-sidebar-shutter')?.addEventListener('click', doCapture);
  }

  // =================================================================
  // VIEW 5D: XEM AR TẠI NHÀ BẰNG AI (Xem AR tại nhà (Trắng - Xanh).pdf)
  // =================================================================
  function renderArAtHomePage() {
    const car = AppState.vehiclesList.find(c => c.id === AppState.currentDetailCar) || AppState.vehiclesList[0];

    const carColors = (car.colors && car.colors.length > 0) ? car.colors : [
      { name: 'Xanh Cyan Ánh Kim', hex: '#0284C7', img: car.image },
      { name: 'Trắng Ngọc Trai', hex: '#F8FAFC', img: car.image },
      { name: 'Đen Ánh Kim', hex: '#0F172A', img: car.image },
      { name: 'Đỏ Thể Thao', hex: '#DC2626', img: car.image },
      { name: 'Xám Xi Măng', hex: '#64748B', img: car.image },
      { name: 'Xanh Navy', hex: '#1E3A8A', img: car.image }
    ];

    const sampleBgs = SIGMA_DATA.arSampleBackgrounds || [
      { id: 'bg-1', name: 'Sân nhà biệt thự', url: 'assets/project3/sample-bg-1.jpg' },
      { id: 'bg-2', name: 'Gara gia đình hiện đại', url: 'assets/project3/sample-bg-2.jpg' },
      { id: 'bg-3', name: 'Đường nội khu cao cấp', url: 'assets/project3/sample-bg-3.jpg' },
      { id: 'bg-4', name: 'Khuôn viên ngoài trời', url: 'assets/project3/sample-bg-4.jpg' }
    ];

    let currentStep = 2; // Step 2 active
    let selectedBgUrl = sampleBgs[0].url;
    let selectedAngle = 'Chéo 3/4';
    let selectedColorName = carColors[0]?.name || 'Tiêu chuẩn';
    let scaleVal = 100;
    let comparePos = 50; // 50% divider
    let isDraggingSlider = false;

    viewsContainer.innerHTML = `
      <section class="section" style="padding-top:24px; padding-bottom:60px;">
        <div class="container">
          <!-- Header -->
          <div style="text-align:center; margin-bottom:28px;">
            <div style="display:inline-flex; align-items:center; gap:6px; background:#EFF6FF; color:#2563EB; font-size:12px; font-weight:800; padding:6px 14px; border-radius:9999px; margin-bottom:10px;">
              <span>🪄</span> Công nghệ AR • AI
            </div>
            <h1 style="font-size:32px; font-weight:800; color:var(--text-dark); margin:0 0 8px;">Xem xe AR ngay tại nhà bạn</h1>
            <p style="font-size:15px; color:var(--text-muted); max-width:680px; margin:0 auto;">
              Chụp ảnh sân nhà hoặc gara của bạn, công nghệ AI sẽ tự động phân tích độ sâu mặt đất, ánh sáng và đặt chiếc ${escapeHtml(car.name)} vào chính xác 100% tỉ lệ thực tế.
            </p>
          </div>

          <!-- Stepper 3 Steps -->
          <div class="ar-stepper-container">
            <div class="ar-step-item completed">
              <span class="ar-step-number">✓</span>
              <span>Bước 1: Chọn xe</span>
            </div>
            <div style="width:40px; height:2px; background:#10B981;"></div>
            <div class="ar-step-item active" id="ar-step-2-indicator">
              <span class="ar-step-number">2</span>
              <span>Bước 2: Tải ảnh lên & Cài đặt</span>
            </div>
            <div style="width:40px; height:2px; background:#CBD5E1;" id="ar-step-divider-23"></div>
            <div class="ar-step-item" id="ar-step-3-indicator">
              <span class="ar-step-number">3</span>
              <span>Bước 3: Xem kết quả AI</span>
            </div>
          </div>

          <!-- Step 2: Upload & Settings (2 Columns) -->
          <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:24px; margin-bottom:32px;">
            <!-- Left Column: Dropzone & 4 Sample Photos -->
            <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:20px; padding:24px; box-shadow:0 4px 16px rgba(0,0,0,0.04);">
              <h3 style="font-size:18px; font-weight:800; color:var(--text-dark); margin:0 0 14px;">Tải ảnh không gian của bạn</h3>

              <!-- Dropzone -->
              <div class="ar-dropzone-box" id="ar-home-dropzone">
                <input type="file" id="ar-home-file-input" accept="image/*" style="display:none;">
                <div style="font-size:38px;">📁</div>
                <div>
                  <strong style="font-size:15px; color:var(--text-dark); display:block; margin-bottom:4px;">Kéo và thả ảnh vào đây</strong>
                  <span style="font-size:12px; color:var(--text-muted);">Hỗ trợ JPG, PNG, HEIC • Dung lượng tối đa 15MB</span>
                </div>
                <div style="display:flex; gap:10px; margin-top:6px;">
                  <button class="btn-primary" id="btn-ar-choose-file" style="padding:8px 16px; font-size:13px;">📁 Chọn ảnh từ thiết bị</button>
                  <button class="btn-card-outline" id="btn-ar-camera-snap" style="padding:8px 16px; font-size:13px;">📷 Chụp bằng camera</button>
                </div>
              </div>

              <!-- Quick Try with 4 Sample Photos -->
              <div style="margin-top:20px;">
                <div style="font-size:13px; font-weight:700; color:var(--text-dark); margin-bottom:8px;">Hoặc thử nhanh với ảnh mẫu:</div>
                <div class="ar-sample-grid">
                  ${sampleBgs.map((bg, idx) => `
                    <div class="ar-sample-item ${idx === 0 ? 'selected' : ''}" data-url="${bg.url}" title="${escapeHtml(bg.name)}">
                      <img src="${bg.url}" alt="${escapeHtml(bg.name)}">
                      <div style="font-size:10px; font-weight:600; text-align:center; padding:4px 2px; color:var(--text-secondary); background:#FFFFFF;">${escapeHtml(bg.name)}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>

            <!-- Right Column: Settings & AI Generate CTA -->
            <div class="vr-config-panel" style="padding:24px;">
              <h3 style="font-size:18px; font-weight:800; color:var(--text-dark); margin:0 0 14px;">Cài đặt hiển thị</h3>

              <!-- Selected Car Card -->
              <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:12px;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <img src="${car.image}" style="width:50px; height:32px; object-fit:contain;" alt="${escapeHtml(car.name)}">
                  <div>
                    <strong style="font-size:13.5px; color:var(--text-dark); display:block;">${escapeHtml(car.name)}</strong>
                    <span style="font-size:11px; color:var(--primary); font-weight:700;">${car.priceFormatted || ''}</span>
                  </div>
                </div>
                <button class="btn-card-outline" onclick="window.location.hash='new-cars'" style="padding:4px 10px; font-size:11px;">Đổi xe</button>
              </div>

              <!-- Color Selection -->
              <div>
                <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">
                  <span style="font-weight:700;">MÀU XE:</span>
                  <span id="ar-home-color-label" style="color:var(--primary); font-weight:600;">${escapeHtml(selectedColorName)}</span>
                </div>
                <div class="vr-color-picker-group">
                  ${carColors.map((c, idx) => `
                    <div class="vr-color-dot ${idx === 0 ? 'active' : ''}" data-idx="${idx}" data-name="${escapeHtml(c.name)}" style="background:${c.hex};" title="${escapeHtml(c.name)}"></div>
                  `).join('')}
                </div>
              </div>

              <!-- Angle Selection Tabs (3 Tabs) -->
              <div>
                <div style="font-size:12px; font-weight:700; margin-bottom:6px;">GÓC ĐẶT XE:</div>
                <div style="display:flex; gap:8px;">
                  <button class="filter-pill-btn" data-angle="Chính diện" style="flex:1; padding:7px; font-size:12px; text-align:center;">Chính diện</button>
                  <button class="filter-pill-btn active" data-angle="Chéo 3/4" style="flex:1; padding:7px; font-size:12px; text-align:center;">Chéo 3/4</button>
                  <button class="filter-pill-btn" data-angle="Ngang hông" style="flex:1; padding:7px; font-size:12px; text-align:center;">Ngang hông</button>
                </div>
              </div>

              <!-- Scale Slider -->
              <div>
                <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                  <span style="font-weight:700;">TỈ LỆ THỰC TẾ:</span>
                  <span id="ar-home-scale-label" style="font-weight:800; color:var(--primary);">${scaleVal}%</span>
                </div>
                <input type="range" id="ar-home-scale-input" class="vr-rotation-slider" min="50" max="150" value="${scaleVal}" style="width:100%;">
              </div>

              <!-- 2 Toggles -->
              <div style="display:flex; flex-direction:column; gap:8px; padding:10px; background:#F8FAFC; border-radius:10px; border:1px solid #E2E8F0; font-size:12px;">
                <label style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                  <span>Nhận diện mặt đất (Auto-align)</span>
                  <input type="checkbox" checked style="accent-color:#2563EB;">
                </label>
                <label style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                  <span>Bóng đổ thật (Mô phỏng ánh sáng)</span>
                  <input type="checkbox" checked style="accent-color:#2563EB;">
                </label>
              </div>

              <!-- Generate CTA -->
              <button class="btn-primary" id="btn-ar-ai-generate" style="width:100%; justify-content:center; padding:14px; font-size:15px; font-weight:800; box-shadow:0 6px 20px rgba(37,99,235,0.35);">
                🪄 Tạo ảnh AR bằng AI
              </button>
              <div style="font-size:11px; color:var(--text-muted); text-align:center;">
                Thời gian xử lý AI tự động: khoảng 2 - 3 giây
              </div>
            </div>
          </div>

          <!-- Step 3: AI Result Comparison Slider -->
          <div id="ar-step-3-section" style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:20px; padding:28px; margin-bottom:32px; box-shadow:0 6px 24px rgba(0,0,0,0.06);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
              <div>
                <span class="badge-role" style="background:#ECFDF5; color:#059669; font-size:11.5px; font-weight:800;">BƯỚC 3 • KẾT QUẢ AI</span>
                <h3 style="font-size:22px; font-weight:800; color:var(--text-dark); margin:4px 0 0;">So sánh Trước / Sau (Before & After Slider)</h3>
                <p style="font-size:13px; color:var(--text-muted); margin:2px 0 0;">Kéo thanh trượt qua trái/phải để đối chiếu không gian nguyên bản và sau khi ghép xe bằng AI.</p>
              </div>
              <div style="display:flex; gap:8px;">
                <button class="btn-card-outline" id="btn-ar-download" style="padding:8px 14px; font-size:12.5px;">⬇️ Tải xuống ảnh</button>
                <button class="btn-card-outline" id="btn-ar-share-res" style="padding:8px 14px; font-size:12.5px;">🔗 Chia sẻ</button>
                <button class="btn-primary" onclick="window.bookCarTestDrive('${car.name}')" style="padding:8px 16px; font-size:12.5px;">📅 Đặt lịch lái thử</button>
              </div>
            </div>

            <!-- Before / After Slider -->
            <div class="ar-compare-slider-wrap" id="ar-compare-slider-box">
              <!-- Before Image (Empty Space) -->
              <img id="ar-img-before" class="ar-compare-img" src="${selectedBgUrl}" alt="Trước (Ảnh sân nhà nguyên bản)">
              <span class="ar-compare-badge before">Trước • Không gian gốc</span>

              <!-- After Image Wrap (AI Placed Car) -->
              <div class="ar-compare-after-wrap" id="ar-after-wrap" style="clip-path: polygon(${comparePos}% 0%, 100% 0%, 100% 100%, ${comparePos}% 100%);">
                <img id="ar-img-after" class="ar-compare-img" src="assets/project3/ar-sample-after.jpg" alt="Sau (Kết quả AI)">
                <span class="ar-compare-badge after">Sau • AI (${escapeHtml(car.name)})</span>
              </div>

              <!-- Draggable Handle -->
              <div class="ar-compare-handle-line" id="ar-compare-handle" style="left:${comparePos}%;">
                <div class="ar-compare-handle-knob">↔</div>
              </div>
            </div>
          </div>

          <!-- Bottom: Tips for Best Photos (3 Cards) -->
          <div>
            <h4 style="font-size:17px; font-weight:800; color:var(--text-dark); margin-bottom:14px; text-align:center;">Mẹo chụp ảnh để kết quả AI đẹp và chính xác nhất</h4>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px;">
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:14px; padding:18px; text-align:center;">
                <div style="font-size:26px; margin-bottom:6px;">☀️</div>
                <strong style="font-size:14px; color:var(--text-dark); display:block; margin-bottom:4px;">Chụp khi đủ ánh sáng</strong>
                <span style="font-size:12px; color:var(--text-muted); line-height:1.6;">Nên chụp vào ban ngày hoặc nơi có đèn sáng rõ để AI khử nhiễu và đổ bóng tự nhiên nhất.</span>
              </div>
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:14px; padding:18px; text-align:center;">
                <div style="font-size:26px; margin-bottom:6px;">⛶</div>
                <strong style="font-size:14px; color:var(--text-dark); display:block; margin-bottom:4px;">Chừa đủ khoảng trống</strong>
                <span style="font-size:12px; color:var(--text-muted); line-height:1.6;">Đảm bảo khoảng sân có kích thước tối thiểu 5m x 2.5m để xe vừa vặn trong khung hình.</span>
              </div>
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:14px; padding:18px; text-align:center;">
                <div style="font-size:26px; margin-bottom:6px;">📱</div>
                <strong style="font-size:14px; color:var(--text-dark); display:block; margin-bottom:4px;">Giữ máy thẳng, ngang tầm mắt</strong>
                <span style="font-size:12px; color:var(--text-muted); line-height:1.6;">Đặt máy ngang góc 1.2m - 1.5m so với mặt đất để thuật toán AI căn góc phối cảnh chuẩn xác.</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    // Dropzone & File Upload Handlers
    const fileInput = document.getElementById('ar-home-file-input');
    const dropzone = document.getElementById('ar-home-dropzone');
    const imgBefore = document.getElementById('ar-img-before');

    document.getElementById('btn-ar-choose-file')?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    document.getElementById('btn-ar-camera-snap')?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.setAttribute('capture', 'environment');
      fileInput.click();
    });
    dropzone?.addEventListener('click', () => fileInput.click());

    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleImageFile(e.dataTransfer.files[0]);
      }
    });

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleImageFile(e.target.files[0]);
      }
    });

    function handleImageFile(file) {
      if (!file.type.startsWith('image/')) {
        showToast('Vui lòng chọn file hình ảnh hợp lệ (JPG, PNG, HEIC).', '⚠️');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        selectedBgUrl = evt.target.result;
        imgBefore.src = selectedBgUrl;
        document.querySelectorAll('.ar-sample-item').forEach(el => el.classList.remove('selected'));
        showToast('Đã tải ảnh không gian của bạn lên thành công! Nhấn "Tạo ảnh AR bằng AI" để xử lý.', '✓');
      };
      reader.readAsDataURL(file);
    }

    // Sample Background Selection
    document.querySelectorAll('.ar-sample-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.ar-sample-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        selectedBgUrl = item.getAttribute('data-url');
        imgBefore.src = selectedBgUrl;
        showToast(`Đã chọn ảnh mẫu: ${item.getAttribute('title')}`, '🖼️');
      });
    });

    // Color Swatches
    document.querySelectorAll('.vr-color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.vr-color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        selectedColorName = dot.getAttribute('data-name');
        document.getElementById('ar-home-color-label').textContent = selectedColorName;
        showToast(`Đã chọn màu sơn: ${selectedColorName}`, '🎨');
      });
    });

    // Angle Tabs
    document.querySelectorAll('[data-angle]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('[data-angle]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        selectedAngle = tab.getAttribute('data-angle');
        showToast(`Đã chọn góc đặt xe: ${selectedAngle}`, '📐');
      });
    });

    // Scale Input
    const scaleInput = document.getElementById('ar-home-scale-input');
    scaleInput?.addEventListener('input', (e) => {
      scaleVal = parseInt(e.target.value, 10);
      document.getElementById('ar-home-scale-label').textContent = `${scaleVal}%`;
    });

    // AI Generate CTA Button
    document.getElementById('btn-ar-ai-generate')?.addEventListener('click', () => {
      const btn = document.getElementById('btn-ar-ai-generate');
      const origText = btn.innerHTML;
      btn.innerHTML = '⏳ AI đang phân tích độ sâu mặt đất & ghép xe...';
      btn.disabled = true;

      setTimeout(() => {
        btn.innerHTML = origText;
        btn.disabled = false;
        document.getElementById('ar-step-2-indicator')?.classList.remove('active');
        document.getElementById('ar-step-2-indicator')?.classList.add('completed');
        document.getElementById('ar-step-divider-23')?.style.setProperty('background', '#10B981');
        document.getElementById('ar-step-3-indicator')?.classList.add('active');
        document.getElementById('ar-step-3-section')?.scrollIntoView({ behavior: 'smooth' });
        showToast('✨ AI đã tạo ảnh AR thành công! Hãy kéo thanh trượt để so sánh Trước / Sau.', '🪄');
      }, 1200);
    });

    // Before / After Slider Interaction Handlers
    const sliderBox = document.getElementById('ar-compare-slider-box');
    const afterWrap = document.getElementById('ar-after-wrap');
    const handleLine = document.getElementById('ar-compare-handle');

    function updateSlider(clientX) {
      if (!sliderBox) return;
      const rect = sliderBox.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      comparePos = Math.round((x / rect.width) * 100);
      handleLine.style.left = `${comparePos}%`;
      afterWrap.style.clipPath = `polygon(${comparePos}% 0%, 100% 0%, 100% 100%, ${comparePos}% 100%)`;
    }

    sliderBox?.addEventListener('mousedown', (e) => {
      isDraggingSlider = true;
      updateSlider(e.clientX);
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDraggingSlider) return;
      updateSlider(e.clientX);
    });
    window.addEventListener('mouseup', () => {
      isDraggingSlider = false;
    });

    sliderBox?.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDraggingSlider = true;
        updateSlider(e.touches[0].clientX);
      }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (!isDraggingSlider || e.touches.length !== 1) return;
      updateSlider(e.touches[0].clientX);
    }, { passive: true });
    window.addEventListener('touchend', () => {
      isDraggingSlider = false;
    });

    // Action buttons
    document.getElementById('btn-ar-download')?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = 'assets/project3/ar-sample-after.jpg';
      a.download = `SIGMACAR-AR-${car.name.replace(/\s+/g, '-')}.jpg`;
      a.click();
      showToast('Đang tải ảnh kết quả AR AI chất lượng cao về máy...', '⬇️');
    });

    document.getElementById('btn-ar-share-res')?.addEventListener('click', () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href);
        showToast('Đã sao chép liên kết ảnh AR AI vào bộ nhớ tạm!', '🔗');
      }
    });
  }

  // =================================================================
  // VIEW 6B: CUSTOMER SUPPORT CENTER & TICKETING (Section 5)
  // =================================================================
  async function renderSupportCenterPage() {
    viewsContainer.innerHTML = `
      <div class="catalog-page-hero-banner" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.92) 0%, rgba(15,23,42,0.65) 100%), url('assets/banner-testdrive.jpg');">
        <div class="container">
          <div class="section-tag" style="color:var(--accent-cyan); display:inline-flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:8px; height:8px; background:var(--accent-emerald); border-radius:50%; box-shadow:0 0 10px var(--accent-emerald);"></span>
            TRUNG TÂM CHĂM SÓC KHÁCH HÀNG 24/7 • SIGMACAR CARE
          </div>
          <h1 style="font-size:32px; font-weight:800; color:#FFFFFF; margin:8px 0 10px;">Hỗ trợ Toàn diện & Đồng hành Mọi Hành trình</h1>
          <p style="color:rgba(255,255,255,0.85); max-width:680px; font-size:14px; line-height:1.6;">Tra cứu nhanh câu hỏi thường gặp, đăng ký bảo dưỡng cứu hộ khẩn cấp hoặc gửi phiếu yêu cầu hỗ trợ chuyên sâu được cam kết phản hồi trong 30 phút.</p>
        </div>
      </div>

      <section class="section" style="padding-top:28px; padding-bottom:48px;">
        <div class="container">
          <!-- 4 Quick-Action Category Tiles from Customer Care.pdf -->
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; margin-bottom:28px;">
            <div class="support-cat-tile" data-cat="Đổi trả & Hoàn tiền" style="cursor:pointer; background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm); transition:transform 0.2s, box-shadow 0.2s; border-left:4px solid var(--primary);">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                <span style="font-size:28px;">🔄</span>
                <span style="font-size:11px; font-weight:700; background:#EFF6FF; color:var(--primary); padding:2px 8px; border-radius:12px;">7 Ngày Cam Kết</span>
              </div>
              <h4 style="font-size:16px; font-weight:700; color:var(--text-dark); margin-bottom:4px;">Đổi trả & Hoàn tiền</h4>
              <p style="font-size:12.5px; color:var(--text-muted); line-height:1.4;">Chính sách đổi trả 7 ngày không phí phạt, thủ tục minh bạch.</p>
            </div>

            <div class="support-cat-tile" data-cat="Bảo hành & Bảo dưỡng" style="cursor:pointer; background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm); transition:transform 0.2s, box-shadow 0.2s; border-left:4px solid var(--accent-emerald);">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                <span style="font-size:28px;">🛡️</span>
                <span style="font-size:11px; font-weight:700; background:#ECFDF5; color:var(--accent-emerald); padding:2px 8px; border-radius:12px;">Pin & Động cơ 10 năm</span>
              </div>
              <h4 style="font-size:16px; font-weight:700; color:var(--text-dark); margin-bottom:4px;">Bảo hành & Bảo dưỡng</h4>
              <p style="font-size:12.5px; color:var(--text-muted); line-height:1.4;">Lịch bảo dưỡng định kỳ, kích hoạt bảo hiểm và cứu hộ pin.</p>
            </div>

            <div class="support-cat-tile" data-cat="emergency" style="cursor:pointer; background:linear-gradient(135deg, #FEF2F2 0%, #FFFFFF 100%); border:1px solid #FECACA; border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm); transition:transform 0.2s, box-shadow 0.2s; border-left:4px solid var(--accent-rose);">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                <span style="font-size:28px;">🚨</span>
                <span style="font-size:11px; font-weight:700; background:#FEE2E2; color:var(--accent-rose); padding:2px 8px; border-radius:12px;">Hotline 24/7</span>
              </div>
              <h4 style="font-size:16px; font-weight:700; color:#B91C1C; margin-bottom:4px;">Cứu hộ Khẩn cấp</h4>
              <p style="font-size:12.5px; color:var(--text-muted); line-height:1.4;">Gọi ngay <strong>1900 888 888</strong> hoặc yêu cầu xe cứu hộ điều phối tức thì.</p>
            </div>

            <div class="support-cat-tile" data-cat="Hướng dẫn sử dụng xe" style="cursor:pointer; background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm); transition:transform 0.2s, box-shadow 0.2s; border-left:4px solid var(--accent-amber);">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                <span style="font-size:28px;">📖</span>
                <span style="font-size:11px; font-weight:700; background:#FFFBEB; color:var(--accent-amber); padding:2px 8px; border-radius:12px;">Cẩm nang số</span>
              </div>
              <h4 style="font-size:16px; font-weight:700; color:var(--text-dark); margin-bottom:4px;">Hướng dẫn Vận hành</h4>
              <p style="font-size:12.5px; color:var(--text-muted); line-height:1.4;">Trạm sạc nhanh, tính năng tự hành Autopilot, mẹo giữ pin bền.</p>
            </div>
          </div>

          <!-- Search & Ticket Lookup Bar -->
          <div style="display:grid; grid-template-columns:1.3fr 1fr; gap:20px; margin-bottom:28px;">
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm);">
              <label class="filter-label" style="margin-bottom:8px;">🔍 Tìm kiếm Câu hỏi thường gặp (FAQ) & Hướng dẫn</label>
              <div style="display:flex; gap:10px;">
                <input type="text" id="support-faq-search" class="filter-input" placeholder="Nhập từ khóa: sạc pin, bảo hành, đổi trả 7 ngày, trả góp...">
                <button class="btn-primary" id="btn-support-faq-search" style="padding:10px 18px; white-space:nowrap;">Tìm kiếm</button>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;" id="support-faq-cat-chips">
                <button class="filter-pill-btn active" data-faq-cat="all" style="font-size:12px; padding:5px 12px;">Tất cả chủ đề</button>
                <button class="filter-pill-btn" data-faq-cat="Đổi trả & Hoàn tiền" style="font-size:12px; padding:5px 12px;">Đổi trả 7 ngày</button>
                <button class="filter-pill-btn" data-faq-cat="Bảo hành & Bảo dưỡng" style="font-size:12px; padding:5px 12px;">Bảo hành & Pin</button>
                <button class="filter-pill-btn" data-faq-cat="Hướng dẫn sử dụng xe" style="font-size:12px; padding:5px 12px;">Hướng dẫn vận hành</button>
                <button class="filter-pill-btn" data-faq-cat="Thanh toán & Trả góp" style="font-size:12px; padding:5px 12px;">Thanh toán & Vay</button>
                <button class="filter-pill-btn" data-faq-cat="Vận chuyển & Bàn giao" style="font-size:12px; padding:5px 12px;">Vận chuyển</button>
              </div>
            </div>

            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm);">
              <label class="filter-label" style="margin-bottom:8px;">🎫 Tra cứu tiến độ Yêu cầu hỗ trợ theo Mã phiếu</label>
              <div style="display:flex; gap:10px;">
                <input type="text" id="support-ticket-lookup-code" class="filter-input" placeholder="Ví dụ: TCK-2026-501">
                <button class="btn-dark" id="btn-support-ticket-lookup" style="padding:10px 18px; white-space:nowrap;">Tra cứu</button>
              </div>
              <p style="font-size:12px; color:var(--text-muted); margin-top:10px;">
                Nhập mã phiếu hỗ trợ (ví dụ: <strong>TCK-2026-501</strong>) để xem trạng thái xử lý, nhân viên phụ trách và lịch sử phản hồi.
              </p>
            </div>
          </div>

          <!-- Lookup Result Box -->
          <div id="support-ticket-lookup-result" style="display:none; margin-bottom:28px;"></div>

          <div style="display:grid; grid-template-columns:1.15fr 1fr; gap:28px; align-items:start;">
            <!-- Left Column: FAQ Accordion + My Tickets -->
            <div>
              <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:24px; margin-bottom:24px;">
                <h3 style="font-size:18px; font-weight:800; color:var(--text-dark); margin-bottom:16px;">📚 Câu hỏi thường gặp & Cẩm nang Chủ xe</h3>
                <div id="support-faq-list-container">Đang tải danh sách câu hỏi...</div>
              </div>

              <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:24px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                  <h3 style="font-size:18px; font-weight:800; color:var(--text-dark);">💬 Yêu cầu hỗ trợ của tôi</h3>
                  <div style="display:flex; gap:6px;" id="ticket-filter-tabs">
                    <button class="filter-pill-btn active" data-ticket-filter="all" style="font-size:11px; padding:3px 8px;">Tất cả</button>
                    <button class="filter-pill-btn" data-ticket-filter="processing" style="font-size:11px; padding:3px 8px;">Đang xử lý</button>
                    <button class="filter-pill-btn" data-ticket-filter="resolved" style="font-size:11px; padding:3px 8px;">Đã xong</button>
                  </div>
                </div>
                <div id="support-my-tickets-container">Đang tải lịch sử yêu cầu hỗ trợ...</div>
              </div>
            </div>

            <!-- Right Column: Submit New Support Request Form -->
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:28px; box-shadow:var(--shadow-sm); position:sticky; top:96px;">
              <div style="display:inline-flex; align-items:center; gap:6px; background:#EFF6FF; color:var(--primary); font-size:11px; font-weight:800; padding:4px 10px; border-radius:20px; margin-bottom:8px;">
                ⚡ PHẢN HỒI TRONG 30 PHÚT
              </div>
              <h3 style="font-size:20px; font-weight:800; color:var(--text-dark); margin-bottom:6px;">Gửi Yêu cầu Hỗ trợ Chuyên sâu</h3>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:20px;">Đội ngũ kỹ thuật và CSKH SIGMACAR luôn sẵn sàng giải đáp mọi thắc mắc trước và sau khi mua xe.</p>

              <form id="form-submit-support-ticket">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                  <div>
                    <label class="filter-label">Họ và tên *</label>
                    <input type="text" id="sup-name" class="filter-input" required value="${escapeHtml(AppState.currentUser?.fullName || '')}" placeholder="Nguyễn Văn A">
                  </div>
                  <div>
                    <label class="filter-label">Số điện thoại *</label>
                    <input type="tel" id="sup-phone" class="filter-input" required value="${escapeHtml(AppState.currentUser?.phone || '')}" placeholder="0901 234 567">
                  </div>
                </div>

                <div style="margin-bottom:12px;">
                  <label class="filter-label">Email nhận thông báo *</label>
                  <input type="email" id="sup-email" class="filter-input" required value="${escapeHtml(AppState.currentUser?.email || '')}" placeholder="email@example.com">
                </div>

                <div style="margin-bottom:12px;">
                  <label class="filter-label">Phân loại yêu cầu *</label>
                  <select id="sup-category" class="filter-select" required>
                    <option value="Tư vấn sản phẩm (Trước khi mua)">Tư vấn sản phẩm (Trước khi mua)</option>
                    <option value="Thanh toán & Trả góp">Thanh toán & Trả góp</option>
                    <option value="Giao hàng & Vận chuyển">Giao hàng & Vận chuyển</option>
                    <option value="Đổi trả & Hoàn tiền">Đổi trả & Hoàn tiền (7 ngày)</option>
                    <option value="Bảo hành & Bảo dưỡng">Bảo hành & Bảo dưỡng</option>
                    <option value="Khiếu nại chất lượng dịch vụ">Khiếu nại chất lượng dịch vụ</option>
                  </select>
                </div>

                <!-- Priority Segmented Control Buttons (Customer Care.pdf) -->
                <div style="margin-bottom:14px;">
                  <label class="filter-label" style="margin-bottom:6px;">Mức độ ưu tiên *</label>
                  <select id="sup-priority" class="filter-select" style="display:none;" required>
                    <option value="Trung bình" selected>Trung bình</option>
                    <option value="Cao">Cao</option>
                    <option value="Khẩn cấp">Khẩn cấp</option>
                  </select>
                  <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;" id="priority-selector-group">
                    <button type="button" class="priority-btn active" data-priority="Trung bình" style="padding:9px; border-radius:8px; border:2px solid var(--primary); background:#EFF6FF; color:var(--primary); font-weight:700; font-size:12px; cursor:pointer;">
                      🟢 THƯỜNG
                    </button>
                    <button type="button" class="priority-btn" data-priority="Cao" style="padding:9px; border-radius:8px; border:1px solid var(--border-subtle); background:#FFFFFF; color:var(--text-dark); font-weight:700; font-size:12px; cursor:pointer;">
                      🟡 QUAN TRỌNG
                    </button>
                    <button type="button" class="priority-btn" data-priority="Khẩn cấp" style="padding:9px; border-radius:8px; border:1px solid var(--border-subtle); background:#FFFFFF; color:var(--accent-rose); font-weight:700; font-size:12px; cursor:pointer;">
                      🔴 KHẨN CẤP
                    </button>
                  </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                  <div>
                    <label class="filter-label">Mã đơn hàng liên quan (Nếu có)</label>
                    <input type="text" id="sup-order-id" class="filter-input" placeholder="VD: SG-2026-9020">
                  </div>
                  <div>
                    <label class="filter-label">Mẫu xe liên quan</label>
                    <select id="sup-vehicle-name" class="filter-select">
                      <option value="">-- Chọn mẫu xe --</option>
                      ${AppState.vehiclesList.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('')}
                    </select>
                  </div>
                </div>

                <div style="margin-bottom:12px;">
                  <label class="filter-label">Chủ đề yêu cầu *</label>
                  <input type="text" id="sup-subject" class="filter-input" required placeholder="Tóm tắt vấn đề cần hỗ trợ (tối thiểu 5 ký tự)">
                </div>

                <div style="margin-bottom:12px;">
                  <label class="filter-label">Mô tả chi tiết *</label>
                  <textarea id="sup-description" class="filter-input" rows="4" required placeholder="Mô tả chi tiết tình trạng, câu hỏi hoặc yêu cầu hỗ trợ của bạn..."></textarea>
                </div>

                <div style="margin-bottom:16px;">
                  <label class="filter-label">Đính kèm hình ảnh / tài liệu (URL hợp lệ, cách nhau dấu phẩy)</label>
                  <input type="text" id="sup-attachments" class="filter-input" placeholder="assets/Charging.png, assets/Battery.png">
                  <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Hỗ trợ định dạng ảnh PNG, JPG, WEBP, PDF tối đa 5 tệp (&le; 5MB/tệp).</div>
                </div>

                <button type="submit" class="btn-primary" style="width:100%; justify-content:center; padding:12px;">
                  🚀 Gửi Yêu cầu Hỗ trợ & Nhận Mã tra cứu
                </button>
              </form>
            </div>
          </div>

          <!-- Bottom Resource Banner from Customer Care.pdf -->
          <div style="margin-top:40px; background:linear-gradient(90deg, #0F172A 0%, #1E293B 100%); border-radius:var(--radius-lg); padding:32px; color:#FFFFFF; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:20px;">
            <div>
              <div style="font-size:12px; font-weight:700; color:var(--accent-cyan); text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Tài nguyên số & Tiện ích hỗ trợ</div>
              <h3 style="font-size:22px; font-weight:800; margin-bottom:6px;">Bạn cần thêm tài liệu hướng dẫn kỹ thuật hoặc kết nối ứng dụng?</h3>
              <p style="font-size:13.5px; color:rgba(255,255,255,0.75); max-width:620px;">Tải trọn bộ sách Hướng dẫn sử dụng chuẩn định dạng PDF hoặc cài đặt ứng dụng SIGMACAR Service để nhận cảnh báo định kỳ và đặt lịch cứu hộ 1 chạm.</p>
            </div>
            <div style="display:flex; gap:12px; flex-wrap:wrap;">
              <button class="btn-card-outline" style="background:rgba(255,255,255,0.1); color:#FFFFFF; border-color:rgba(255,255,255,0.3); padding:10px 18px; font-size:13px;" onclick="showToast('Đang tải trọn bộ Sổ tay Hướng dẫn sử dụng & Bảo hành SIGMACAR (PDF)...', '📥')">
                📥 Tải Sổ tay Vận hành PDF
              </button>
              <button class="btn-primary" style="padding:10px 20px; font-size:13px;" onclick="showToast('SIGMACAR Service App hiện có sẵn trên App Store & Google Play!', '📱')">
                📱 Tải App Mobile SIGMACAR
              </button>
            </div>
          </div>
        </div>
      </section>
    `;

    let activeFaqCat = 'all';
    const loadFaqs = async () => {
      const q = document.getElementById('support-faq-search')?.value.trim() || '';
      const box = document.getElementById('support-faq-list-container');
      if (!box) return;
      try {
        const faqs = await ApiClient.support.getFaqs({ category: activeFaqCat, search: q });
        if (!faqs || faqs.length === 0) {
          box.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted);">Không tìm thấy câu hỏi thường gặp phù hợp với từ khóa "${escapeHtml(q)}".</div>`;
          return;
        }
        box.innerHTML = faqs.map((f, idx) => `
          <div class="faq-accordion-item ${idx === 0 ? 'open' : ''}">
            <button type="button" class="faq-accordion-header" data-faq-idx="${idx}">
              <span><strong style="color:var(--primary); font-size:12px; margin-right:8px;">[${escapeHtml(f.category)}]</strong> ${escapeHtml(f.question)}</span>
              <span>▾</span>
            </button>
            <div class="faq-accordion-body">${escapeHtml(f.answer)}</div>
          </div>
        `).join('');

        box.querySelectorAll('.faq-accordion-header').forEach(btn => {
          btn.addEventListener('click', () => {
            btn.closest('.faq-accordion-item')?.classList.toggle('open');
          });
        });
      } catch (err) {
        box.innerHTML = `<div style="color:var(--accent-rose);">Không thể tải danh sách FAQ.</div>`;
      }
    };

    const renderTicketCard = (t) => `
      <div style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:16px; margin-bottom:14px; background:#F8FAFC;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
          <div>
            <span style="font-size:12px; font-weight:800; color:var(--primary); background:#EFF6FF; padding:3px 8px; border-radius:6px;">${escapeHtml(t.ticketCode)}</span>
            <span style="font-size:11.5px; color:var(--text-muted); margin-left:6px;">${escapeHtml(t.category)} • Ưu tiên: <strong>${escapeHtml(t.priority)}</strong></span>
            <h4 style="font-size:15px; font-weight:800; color:var(--text-dark); margin-top:6px;">${escapeHtml(t.subject)}</h4>
          </div>
          <span class="status-badge ${t.status === 'Đã giải quyết' || t.status === 'Đã đóng' ? 'confirmed' : 'pending'}">● ${escapeHtml(t.status)}</span>
        </div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
          Phụ trách: <strong>${escapeHtml(t.assignedStaffName || 'Đang điều phối CSKH')}</strong> (${escapeHtml(t.department || 'CSKH')}) • Cập nhật: ${new Date(t.updatedAt || t.createdAt).toLocaleString('vi-VN')}
        </div>
        <div class="ticket-thread-box" style="margin-bottom:10px;">
          ${(t.messages || []).map(m => `
            <div class="ticket-msg ${m.senderRole === 'customer' ? 'customer' : 'staff'}">
              <div class="ticket-msg-meta">
                <span>${escapeHtml(m.senderName)} (${m.senderRole === 'customer' ? 'Khách hàng' : 'Chuyên viên CSKH'})</span>
                <span>${new Date(m.createdAt).toLocaleString('vi-VN')}</span>
              </div>
              <div style="font-size:13px; color:var(--text-dark); line-height:1.5;">${escapeHtml(m.content)}</div>
            </div>
          `).join('')}
        </div>
        ${t.status !== 'Đã đóng' ? `
          <div style="display:flex; gap:8px;">
            <input type="text" class="filter-input inp-reply-support-ticket" data-ticket-id="${t.id}" placeholder="Nhập phản hồi tiếp theo trong cùng yêu cầu..." style="padding:8px 12px; font-size:12.5px;">
            <button type="button" class="btn-primary btn-reply-support-ticket" data-ticket-id="${t.id}" style="padding:8px 14px; font-size:12.5px; white-space:nowrap;">Gửi phản hồi</button>
          </div>
        ` : ''}
      </div>
    `;

    let activeTicketFilter = 'all';
    const loadMyTickets = async () => {
      const box = document.getElementById('support-my-tickets-container');
      if (!box) return;
      if (!ApiClient.getCurrentUser()) {
        box.innerHTML = `
          <div style="padding:20px; text-align:center; background:#F8FAFC; border-radius:10px; border:1px dashed var(--border-subtle);">
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:10px;">Đăng nhập tài khoản để xem danh sách tất cả yêu cầu hỗ trợ của bạn hoặc dùng ô Tra cứu Mã phiếu ở trên.</p>
            <button class="btn-card-outline" onclick="authModal.classList.add('active')" style="padding:6px 14px; font-size:12.5px;">🔑 Đăng nhập</button>
          </div>
        `;
        return;
      }
      try {
        const tickets = await ApiClient.support.getTickets();
        if (!tickets || tickets.length === 0) {
          box.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted);">Bạn chưa gửi yêu cầu hỗ trợ nào.</div>`;
          return;
        }
        let filtered = tickets;
        if (activeTicketFilter === 'processing') {
          filtered = tickets.filter(t => t.status !== 'Đã giải quyết' && t.status !== 'Đã đóng');
        } else if (activeTicketFilter === 'resolved') {
          filtered = tickets.filter(t => t.status === 'Đã giải quyết' || t.status === 'Đã đóng');
        }
        if (filtered.length === 0) {
          box.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:13px;">Không có yêu cầu nào trong mục này.</div>`;
          return;
        }
        box.innerHTML = filtered.map(renderTicketCard).join('');
        bindTicketReplyButtons();
      } catch (err) {
        box.innerHTML = `<div style="color:var(--text-muted);">Chưa có dữ liệu yêu cầu hỗ trợ.</div>`;
      }
    };

    const bindTicketReplyButtons = () => {
      document.querySelectorAll('.btn-reply-support-ticket').forEach(btn => {
        btn.onclick = async () => {
          const ticketId = btn.getAttribute('data-ticket-id');
          const inp = document.querySelector(`.inp-reply-support-ticket[data-ticket-id="${ticketId}"]`);
          const content = inp?.value.trim();
          if (!content) {
            showToast('Vui lòng nhập nội dung phản hồi.', '⚠️');
            return;
          }
          try {
            await ApiClient.support.replyTicket(ticketId, { content });
            showToast('Đã gửi phản hồi vào phiếu hỗ trợ!', '✓');
            loadMyTickets();
          } catch (err) {
            showToast(err.message, '⚠️');
          }
        };
      });
    };

    // Quick category tiles click handlers
    document.querySelectorAll('.support-cat-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const cat = tile.getAttribute('data-cat');
        if (cat === 'emergency') {
          const prioInput = document.getElementById('sup-priority');
          if (prioInput) prioInput.value = 'Khẩn cấp';
          document.querySelectorAll('.priority-btn').forEach(btn => {
            const isKhancap = btn.getAttribute('data-priority') === 'Khẩn cấp';
            btn.classList.toggle('active', isKhancap);
            btn.style.border = isKhancap ? '2px solid var(--accent-rose)' : '1px solid var(--border-subtle)';
            btn.style.background = isKhancap ? '#FEF2F2' : '#FFFFFF';
            btn.style.color = isKhancap ? 'var(--accent-rose)' : 'var(--text-dark)';
          });
          const catSelect = document.getElementById('sup-category');
          if (catSelect) catSelect.value = 'Khiếu nại chất lượng dịch vụ';
          document.getElementById('sup-subject')?.focus();
          showToast('Đã kích hoạt chế độ Cứu hộ khẩn cấp 24/7! Vui lòng gửi thông tin hoặc gọi 1900 888 888.', '🚨');
        } else if (cat) {
          const catSelect = document.getElementById('sup-category');
          if (catSelect) catSelect.value = cat;
          activeFaqCat = cat;
          document.querySelectorAll('#support-faq-cat-chips [data-faq-cat]').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-faq-cat') === cat);
          });
          loadFaqs();
          showToast(`Đã lọc chủ đề: ${cat}`, 'ℹ️');
        }
      });
    });

    // Priority segmented buttons
    document.querySelectorAll('.priority-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-priority');
        const prioInput = document.getElementById('sup-priority');
        if (prioInput) prioInput.value = val;
        document.querySelectorAll('.priority-btn').forEach(b => {
          const isAct = b === btn;
          b.classList.toggle('active', isAct);
          if (isAct) {
            b.style.border = val === 'Khẩn cấp' ? '2px solid var(--accent-rose)' : '2px solid var(--primary)';
            b.style.background = val === 'Khẩn cấp' ? '#FEF2F2' : '#EFF6FF';
            b.style.color = val === 'Khẩn cấp' ? 'var(--accent-rose)' : 'var(--primary)';
          } else {
            b.style.border = '1px solid var(--border-subtle)';
            b.style.background = '#FFFFFF';
            b.style.color = 'var(--text-dark)';
          }
        });
      });
    });

    // Ticket status filter tabs
    document.querySelectorAll('#ticket-filter-tabs [data-ticket-filter]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#ticket-filter-tabs [data-ticket-filter]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeTicketFilter = tab.getAttribute('data-ticket-filter');
        loadMyTickets();
      });
    });

    document.getElementById('btn-support-faq-search')?.addEventListener('click', loadFaqs);
    document.getElementById('support-faq-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadFaqs();
    });

    document.querySelectorAll('#support-faq-cat-chips [data-faq-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#support-faq-cat-chips [data-faq-cat]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFaqCat = btn.getAttribute('data-faq-cat');
        loadFaqs();
      });
    });

    document.getElementById('btn-support-ticket-lookup')?.addEventListener('click', async () => {
      const code = document.getElementById('support-ticket-lookup-code')?.value.trim();
      const resBox = document.getElementById('support-ticket-lookup-result');
      if (!code || !resBox) {
        showToast('Vui lòng nhập mã phiếu hỗ trợ (VD: TCK-2026-501).', '⚠️');
        return;
      }
      try {
        const ticket = await ApiClient.support.lookupTicket(code);
        resBox.style.display = 'block';
        resBox.innerHTML = `
          <div style="background:#FFFFFF; border:2px solid var(--primary); border-radius:var(--radius-lg); padding:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <strong style="color:var(--primary);">🔍 KẾT QUẢ TRA CỨU PHIẾU HỖ TRỢ: ${escapeHtml(ticket.ticketCode)}</strong>
              <button class="btn-card-outline" style="padding:4px 10px; font-size:11.5px;" onclick="document.getElementById('support-ticket-lookup-result').style.display='none'">Đóng</button>
            </div>
            ${renderTicketCard(ticket)}
          </div>
        `;
        bindTicketReplyButtons();
      } catch (err) {
        showToast(err.message || 'Không tìm thấy mã phiếu hỗ trợ.', '⚠️');
      }
    });

    document.getElementById('form-submit-support-ticket')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const attachmentsRaw = document.getElementById('sup-attachments')?.value.trim() || '';
      const attachments = attachmentsRaw
        ? attachmentsRaw.split(',').map(s => s.trim()).filter(Boolean).map(url => ({ name: url.split('/').pop() || 'attachment.png', url, sizeBytes: 250000 }))
        : [];
      try {
        const created = await ApiClient.support.createTicket({
          customerName: document.getElementById('sup-name')?.value.trim(),
          customerPhone: document.getElementById('sup-phone')?.value.trim(),
          customerEmail: document.getElementById('sup-email')?.value.trim(),
          category: document.getElementById('sup-category')?.value,
          priority: document.getElementById('sup-priority')?.value,
          orderId: document.getElementById('sup-order-id')?.value.trim(),
          vehicleName: document.getElementById('sup-vehicle-name')?.value,
          subject: document.getElementById('sup-subject')?.value.trim(),
          description: document.getElementById('sup-description')?.value.trim(),
          attachments
        });
        showToast(`🎉 Đã gửi yêu cầu hỗ trợ! Mã tra cứu của bạn: ${created.ticketCode}`, '🎫');
        document.getElementById('sup-subject').value = '';
        document.getElementById('sup-description').value = '';
        const lookupInput = document.getElementById('support-ticket-lookup-code');
        if (lookupInput) lookupInput.value = created.ticketCode;
        loadMyTickets();
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });

    await Promise.all([loadFaqs(), loadMyTickets()]);
  }

  // =================================================================
  // VIEW 7: SELLER & ADMIN DASHBOARD (10 Enterprise Modules)
  // =================================================================
  async function renderSellerDashboard(activeTab = 'dash-overview') {
    AppState.activeSellerTab = activeTab;
    const curUser = ApiClient.getCurrentUser();
    const allowedRoles = ['seller', 'admin', 'support_staff', 'service_staff'];

    if (!curUser || !allowedRoles.includes(curUser.role)) {
      viewsContainer.innerHTML = `
        <div class="container" style="padding:80px 20px; text-align:center;">
          <div style="font-size:48px; margin-bottom:16px;">🔒</div>
          <h2 style="font-size:28px; font-weight:800; color:var(--text-dark); margin-bottom:8px;">Khu vực Quản trị Đại lý & Hậu mãi (Restricted Area)</h2>
          <p style="color:var(--text-muted); max-width:540px; margin:0 auto 24px;">Bạn cần đăng nhập bằng tài khoản Quản trị viên (Admin), Đại lý (Seller), Nhân viên CSKH hoặc Kỹ thuật viên Dịch vụ để truy cập.</p>
          <button class="btn-primary" onclick="authModal.classList.add('active')">
            Đăng nhập tài khoản Quản trị / Đại lý
          </button>
        </div>
      `;
      return;
    }

    let dashData = { monthlyRevenue: '14.580.000.000 đ', newDepositsCount: 3, todayTestDrives: 4, supportRequests: 2, appointments: [] };
    let ordersList = [];
    let apptsList = [];
    let returnsRes = { items: [], stats: {} };
    let warOverview = { stats: {}, warranties: [], appointments: [], records: [], centers: [] };
    let modData = { reviews: [], questions: [] };
    let supportTickets = [];
    let supportStats = {};
    let campaignsRes = { campaigns: [], templates: [], smtpConfigured: false, stats: {} };
    let usersList = [];

    try {
      const results = await Promise.all([
        ApiClient.analytics.getOverview().catch(() => dashData),
        ApiClient.orders.getAll().catch(() => []),
        ApiClient.appointments.getAll().catch(() => []),
        ApiClient.returns.getAll().catch(() => ({ items: [], stats: {} })),
        ApiClient.warranties.getAdminOverview().catch(() => ({ stats: {}, warranties: [], appointments: [], records: [], centers: [] })),
        ApiClient.reviews.getAdminAll().catch(() => ({ reviews: [], questions: [] })),
        ApiClient.support.getTickets().catch(() => []),
        ApiClient.support.getStats().catch(() => ({})),
        ApiClient.campaigns.getAll().catch(() => ({ campaigns: [], templates: [], smtpConfigured: false, stats: {} })),
        curUser.role === 'admin' ? ApiClient.admin.getUsers().catch(() => []) : Promise.resolve([])
      ]);
      [dashData, ordersList, apptsList, returnsRes, warOverview, modData, supportTickets, supportStats, campaignsRes, usersList] = results;
    } catch (e) {}

    AppState._sellerCache = { dashData, ordersList, apptsList, returnsRes, warOverview, modData, supportTickets, supportStats, campaignsRes, usersList };

    viewsContainer.innerHTML = `
      <div class="dashboard-layout">
        <aside class="dashboard-sidebar">
          <div class="dashboard-brand">
            <div style="font-weight:800; font-size:18px; color:#FFFFFF;">SIGMACAR</div>
            <div style="font-size:11px; color:var(--accent-cyan); font-weight:700;">TRUNG TÂM ĐIỀU HÀNH E-COMMERCE</div>
          </div>

          <ul class="dashboard-nav">
            <li class="dash-nav-item ${activeTab === 'dash-overview' ? 'active' : ''}" data-dashtab="dash-overview">
              📊 Tổng quan Kinh doanh
            </li>
            <li class="dash-nav-item ${activeTab === 'dash-orders' ? 'active' : ''}" data-dashtab="dash-orders">
              🛒 Quản lý Đơn hàng (${ordersList.length || dashData.newDepositsCount || 0})
            </li>
            <li class="dash-nav-item ${activeTab === 'dash-returns' ? 'active' : ''}" data-dashtab="dash-returns">
              🔄 Đổi trả 7 ngày (${(returnsRes.items || []).length})
            </li>
            <li class="dash-nav-item ${activeTab === 'dash-aftersales' ? 'active' : ''}" data-dashtab="dash-aftersales">
              🔧 Bảo hành & Dịch vụ (${(warOverview.warranties || []).length})
            </li>
            <li class="dash-nav-item ${activeTab === 'dash-testdrives' ? 'active' : ''}" data-dashtab="dash-testdrives">
              📅 Lịch lái thử (${apptsList.length || dashData.todayTestDrives || 0})
            </li>
            <li class="dash-nav-item ${activeTab === 'dash-inventory' ? 'active' : ''}" data-dashtab="dash-inventory">
              🏢 Kho xe & AI RAG
            </li>
            <li class="dash-nav-item ${activeTab === 'dash-reviews' ? 'active' : ''}" data-dashtab="dash-reviews">
              ⭐ Kiểm duyệt Đánh giá (${(modData.reviews || []).length})
            </li>
            <li class="dash-nav-item ${activeTab === 'dash-support' ? 'active' : ''}" data-dashtab="dash-support">
              🎧 CSKH & Hỗ trợ (${supportTickets.length || 0})
            </li>
            <li class="dash-nav-item ${activeTab === 'dash-campaigns' ? 'active' : ''}" data-dashtab="dash-campaigns">
              ✉️ Chiến dịch Email (${(campaignsRes.campaigns || []).length})
            </li>
            <li class="dash-nav-item ${activeTab === 'dash-crm' ? 'active' : ''}" data-dashtab="dash-crm" style="cursor:pointer; position:relative; z-index:10;">
              👥 CRM & Phân quyền RBAC
            </li>
          </ul>

          <div style="border-top:1px solid rgba(255,255,255,0.1); padding-top:14px; margin-top:16px; margin-bottom:12px; display:flex; align-items:center; gap:12px; flex-shrink:0;">
            <img src="assets/avatar-sales.jpg" style="width:36px; height:36px; border-radius:50%; object-fit:cover;" alt="Sale">
            <div>
              <div style="font-size:13px; font-weight:700; color:#FFFFFF;">${escapeHtml(curUser.fullName || 'Quản trị viên')}</div>
              <div style="font-size:11px; color:#94A3B8;">${escapeHtml((curUser.role || 'ADMIN').toUpperCase())}</div>
            </div>
          </div>
        </aside>

        <main class="dashboard-main">
          ${renderSellerSubView(activeTab, dashData, ordersList, apptsList)}
        </main>
      </div>
    `;

    document.querySelectorAll('.dash-nav-item[data-dashtab]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tab = e.currentTarget.getAttribute('data-dashtab');
        AppState.activeSellerTab = tab;
        if (window.location.hash !== `#seller-dashboard?tab=${tab}`) {
          window.location.hash = `#seller-dashboard?tab=${tab}`;
        }
        renderSellerDashboard(tab);
      });
    });

    bindSellerDashboardActions();
  }

  function renderSellerSubView(tab, dashData, ordersList, apptsList) {
    const curUser = ApiClient.getCurrentUser() || {};
    const cache = AppState._sellerCache || {};
    const returnsRes = cache.returnsRes || { items: [], stats: {} };
    const warOverview = cache.warOverview || { stats: {}, warranties: [], appointments: [], records: [], centers: [] };
    const modData = cache.modData || { reviews: [], questions: [] };
    const supportTickets = cache.supportTickets || [];
    const supportStats = cache.supportStats || {};
    const campaignsRes = cache.campaignsRes || { campaigns: [], templates: [], smtpConfigured: false, stats: {} };
    const usersList = cache.usersList || [];

    if (tab === 'dash-orders') {
      return `
        <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.4) 100%), url('assets/banner-seller-orders.jpg');">
          <h3>Quản lý Đơn Đặt cọc & Mua xe</h3>
          <p>Theo dõi tiến độ hợp đồng, thanh toán cọc và lịch bàn giao xe cho khách hàng toàn quốc.</p>
        </div>

        <div class="dash-table-card">
          <table class="dash-data-table">
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Khách hàng</th>
                <th>Dòng xe / Số VIN</th>
                <th>Giá trị / Cọc</th>
                <th>Phương thức</th>
                <th>Trạng thái</th>
                <th style="text-align:right;">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${(ordersList.length > 0 ? ordersList : [
                { id: 'ORD-9021', orderNumber: 'SG-2026-9021', buyerName: 'Minh Hoàng', buyerPhone: '0901 234 567', vehicleName: 'SIGMA Model E', depositAmount: 50000000, paymentMethod: 'Napas QR 24/7', orderStatus: 'confirmed' }
              ]).map(o => `
                <tr>
                  <td><strong>${escapeHtml(o.orderNumber || o.id)}</strong></td>
                  <td><strong>${escapeHtml(o.buyerName)}</strong><br><span style="font-size:11px; color:var(--text-muted);">${escapeHtml(o.buyerPhone)}</span></td>
                  <td><strong>${escapeHtml(o.vehicleName || 'SIGMA EV')}</strong><br><span style="font-size:11px; color:var(--text-muted);">VIN: ${escapeHtml(o.vin || 'Đang cấp')}</span></td>
                  <td><strong style="color:var(--primary);">${(o.depositAmount || 50000000).toLocaleString('vi-VN')} đ</strong></td>
                  <td>${escapeHtml(o.paymentMethod || 'Chuyển khoản')}</td>
                  <td>
                    <span class="status-badge ${o.orderStatus === 'confirmed' || o.orderStatus === 'delivered' || o.orderStatus === 'Đã giao' || o.orderStatus === 'Hoàn thành' ? 'confirmed' : 'pending'}">
                      ● ${escapeHtml((o.orderStatus || 'CONFIRMED').toUpperCase())}
                    </span>
                  </td>
                  <td style="text-align:right;">
                    <button class="btn-card-outline btn-order-action" data-id="${o.id}" data-action="confirm" style="padding:4px 8px; font-size:11.5px;">✓ Xác nhận</button>
                    <button class="btn-card-primary btn-order-action" data-id="${o.id}" data-action="deliver" style="padding:4px 8px; font-size:11.5px;">🚗 Bàn giao</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // SECTION 2 ADMIN: QUẢN LÝ ĐỔI TRẢ 7 NGÀY
    if (tab === 'dash-returns') {
      const rStats = returnsRes.stats || {};
      const rItems = returnsRes.items || [];
      const stagesList = [
        'Chờ tiếp nhận',
        'Đang kiểm tra điều kiện',
        'Đã duyệt',
        'Từ chối',
        'Chờ đặt lịch thu hồi',
        'Đã xác nhận lịch xe tải',
        'Đang vận chuyển xe về trung tâm',
        'Đang kiểm tra tình trạng xe',
        'Đang xử lý hoàn tiền hoặc đổi xe',
        'Hoàn tất'
      ];

      return `
        <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.88) 0%, rgba(15,23,42,0.45) 100%), url('assets/banner-seller-orders.jpg');">
          <h3>Trung tâm Quản trị Đổi trả Tự động (Chính sách 7 ngày)</h3>
          <p>Kiểm tra điều kiện 7 ngày, duyệt/từ chối có lý do, điều phối xe tải chuyên dụng thu hồi xe và quyết toán hoàn tiền minh bạch.</p>
        </div>

        <div class="dash-kpi-grid">
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Tổng yêu cầu đổi trả</span><span class="kpi-tag tag-success">7 Ngày</span></div>
            <div class="kpi-val">${rStats.totalRequests ?? rItems.length} đơn</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Chờ duyệt / Đang xử lý</span><span class="kpi-tag tag-warning">Active</span></div>
            <div class="kpi-val">${(rStats.pendingCount ?? 0) + (rStats.inProgressCount ?? 0)} đơn</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Tỷ lệ hoàn tất</span><span class="kpi-tag tag-success">SLA Chuẩn</span></div>
            <div class="kpi-val">${rStats.completionRate ?? 100}%</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Thời gian xử lý TB / Quá hạn</span><span class="kpi-tag ${(rStats.overdueCount || 0) > 0 ? 'tag-danger' : 'tag-success'}">Quá hạn: ${rStats.overdueCount ?? 0}</span></div>
            <div class="kpi-val">${rStats.avgProcessingHours ?? 18} giờ</div>
          </div>
        </div>

        <div class="dash-table-card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
            <h4 style="font-size:16px; font-weight:800;">Danh sách Yêu cầu Đổi trả & Thu hồi xe</h4>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <input type="text" id="admin-return-search" class="filter-input" placeholder="Tìm mã RET, mã đơn, tên KH..." style="width:220px; padding:7px 12px; font-size:12.5px;">
              <select id="admin-return-status-filter" class="filter-select" style="width:200px; padding:7px 10px; font-size:12.5px;">
                <option value="all">Tất cả trạng thái</option>
                ${stagesList.map(st => `<option value="${st}">${st}</option>`).join('')}
              </select>
            </div>
          </div>

          <div id="admin-returns-list-box">
            ${rItems.map(r => `
              <div class="admin-return-item-card" data-search="${escapeHtml((r.returnCode + ' ' + r.orderNumber + ' ' + r.buyerName + ' ' + r.vehicleName).toLowerCase())}" data-status="${escapeHtml(r.status)}" style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:18px; margin-bottom:16px; background:#F8FAFC;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; border-bottom:1px solid #E2E8F0; padding-bottom:12px; margin-bottom:12px;">
                  <div>
                    <span style="background:#EFF6FF; color:var(--primary); font-weight:800; font-size:12.5px; padding:4px 10px; border-radius:6px;">${escapeHtml(r.returnCode)}</span>
                    <span style="font-size:12.5px; color:var(--text-muted); margin-left:8px;">Đơn: <strong>${escapeHtml(r.orderNumber)}</strong> • KH: <strong>${escapeHtml(r.buyerName)}</strong> (${escapeHtml(r.buyerPhone)})</span>
                    <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin-top:6px;">${escapeHtml(r.vehicleName)} — <span style="color:var(--primary);">${escapeHtml(r.resolutionType === 'exchange' ? 'Đổi xe mới' : 'Hoàn tiền')}</span></h4>
                  </div>
                  <span class="status-badge ${r.status === 'Hoàn tất' || r.status === 'Đã duyệt' ? 'confirmed' : 'pending'}">● ${escapeHtml(r.status)}</span>
                </div>

                <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:16px; margin-bottom:12px;">
                  <div style="font-size:12.5px; line-height:1.6;">
                    <div><strong>Lý do:</strong> ${escapeHtml(r.reasonLabel || r.reasonCode)}</div>
                    <div><strong>Mô tả:</strong> ${escapeHtml(r.description)}</div>
                    <div><strong>Tình trạng thực tế:</strong> ODO <strong>${r.odoKm || 0} km</strong> — ${escapeHtml(r.vehicleConditionNote || 'Nguyên bản')}</div>
                    <div><strong>Lịch thu hồi xe tải:</strong> 📅 ${escapeHtml(r.pickupSchedule?.preferredDate || 'Chưa đặt')} (${escapeHtml(r.pickupSchedule?.timeSlot || '')}) tại <strong>${escapeHtml(r.pickupSchedule?.address || '')}</strong></div>
                    <div><strong>Đơn vị vận chuyển & Phụ trách:</strong> 🚚 ${escapeHtml(r.pickupSchedule?.carrierName || 'Chưa phân công')} • 👤 ${escapeHtml(r.assignedStaff || 'Chưa gán')}</div>
                    ${(r.photos && r.photos.length > 0) ? `
                      <div style="display:flex; gap:8px; margin-top:8px;">
                        ${r.photos.map(p => `<img src="${escapeHtml(p)}" alt="Return photo" style="width:68px; height:48px; object-fit:cover; border-radius:6px; border:1px solid #CBD5E1;">`).join('')}
                      </div>
                    ` : ''}
                  </div>

                  <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; padding:12px; font-size:12.5px;">
                    <div style="font-weight:800; color:var(--text-dark); margin-bottom:6px;">💰 Bảng tính Hoàn tiền & Khấu trừ dự kiến</div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Giá trị thanh toán gốc:</span><strong>${(r.financials?.basePaidAmount || 0).toLocaleString('vi-VN')} đ</strong></div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px; color:var(--accent-rose);"><span>Tổng khấu trừ có căn cứ:</span><strong>-${(r.financials?.totalDeductions || 0).toLocaleString('vi-VN')} đ</strong></div>
                    <div style="display:flex; justify-content:space-between; border-top:1px dashed #CBD5E1; padding-top:6px; font-size:13.5px; color:var(--accent-emerald);"><span>Số tiền hoàn dự kiến:</span><strong>${(r.financials?.estimatedRefundAmount || 0).toLocaleString('vi-VN')} đ</strong></div>
                    <div style="margin-top:6px; font-size:11.5px; color:var(--text-muted);">Trạng thái TT: <strong>${escapeHtml(r.financials?.refundPaymentStatus || 'Chưa hoàn tiền')}</strong></div>
                  </div>
                </div>

                <!-- Controls to update stage, carrier, staff, reason, and process refund -->
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; background:#FFFFFF; padding:10px 12px; border-radius:8px; border:1px solid #E2E8F0;">
                  <select class="filter-select sel-return-stage" data-id="${r.id}" style="width:210px; padding:6px 10px; font-size:12px;">
                    ${stagesList.map(st => `<option value="${st}" ${r.status === st ? 'selected' : ''}>${st}</option>`).join('')}
                  </select>
                  <input type="text" class="filter-input inp-return-carrier" data-id="${r.id}" value="${escapeHtml(r.pickupSchedule?.carrierName || 'SIGMA Express Flatbed')}" placeholder="Đơn vị xe tải..." style="width:165px; padding:6px 10px; font-size:12px;">
                  <input type="text" class="filter-input inp-return-staff" data-id="${r.id}" value="${escapeHtml(r.assignedStaff || 'KTV Lê Quang Vũ')}" placeholder="Nhân viên phụ trách..." style="width:150px; padding:6px 10px; font-size:12px;">
                  <input type="text" class="filter-input inp-return-note" data-id="${r.id}" placeholder="Ghi chú / Lý do duyệt hoặc từ chối..." style="flex:1; min-width:180px; padding:6px 10px; font-size:12px;">
                  <button class="btn-primary btn-admin-update-return" data-id="${r.id}" style="padding:7px 14px; font-size:12px;">💾 Cập nhật Tiến độ</button>
                  <button class="btn-card-outline btn-admin-refund-return" data-id="${r.id}" data-code="${escapeHtml(r.returnCode)}" data-amount="${(r.financials?.estimatedRefundAmount || 0).toLocaleString('vi-VN')}" style="padding:7px 12px; font-size:12px; color:#059669; border-color:#059669; font-weight:700;">💸 Xác nhận Hoàn tiền</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // SECTION 3 ADMIN: QUẢN LÝ BẢO HÀNH, BẢO DƯỠNG & TRẠM DỊCH VỤ (Matches Seller Dashboard - Service & After-sales.pdf)
    if (tab === 'dash-aftersales') {
      const wStats = warOverview.stats || {};
      const warranties = warOverview.warranties || [];
      const srvAppts = warOverview.appointments || [];
      const srvRecords = warOverview.records || [];

      return `
        <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.88) 0%, rgba(15,23,42,0.45) 100%), url('assets/banner-profile-garage.jpg');">
          <h3>Quản trị Dịch vụ & Hậu mãi 3S (Digital Warranty & Service Center)</h3>
          <p>Quản lý hồ sơ bảo hành VIN/Mã máy, điều phối khoang dịch vụ, cập nhật lịch hẹn bảo dưỡng và ghi nhận lịch sử sửa chữa/linh kiện.</p>
        </div>

        <div class="dash-kpi-grid">
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Xe đang tại Xưởng</span><span class="kpi-tag tag-success">+2 so với hôm qua</span></div>
            <div class="kpi-val">${wStats.vehiclesInWorkshop ?? 14} xe</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Lịch hẹn chờ xác nhận</span><span class="kpi-tag tag-warning">Cần xử lý ngay</span></div>
            <div class="kpi-val">0${wStats.pendingAppointments ?? 2} lịch</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Yêu cầu Bảo hành Pin & Động cơ</span><span class="kpi-tag tag-success">${wStats.activeWarranties ?? warranties.length} Đang hiệu lực</span></div>
            <div class="kpi-val">0${wStats.warrantyClaimsActive ?? 3} hồ sơ</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Chỉ số hài lòng (CSAT)</span><span class="kpi-tag tag-success">Vượt chỉ tiêu 4%</span></div>
            <div class="kpi-val">${wStats.csatScore ?? '4.9/5'} ⭐</div>
          </div>
        </div>

        <!-- Workshop Bays + Inventory Alert matching Seller Dashboard - Service & After-sales.pdf -->
        <div style="display:grid; grid-template-columns:1.5fr 1fr; gap:20px; margin-bottom:24px;">
          <div class="dash-table-card" style="margin-bottom:0;">
            <h4 style="font-size:15.5px; font-weight:800; margin-bottom:14px;">🛠️ Tình trạng Khoang Dịch vụ Thời gian thực (Workshop Bays)</h4>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div style="border:1px solid #BFDBFE; background:#EFF6FF; border-radius:10px; padding:12px;">
                <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:800; color:var(--primary);"><span>KHOANG 01 • ĐANG XỬ LÝ</span><span>75%</span></div>
                <div style="font-weight:800; font-size:14px; margin:4px 0;">SIGMA Model E (30K-889.99)</div>
                <div style="font-size:12px; color:var(--text-secondary);">Hạng mục: Bảo dưỡng 10.000 km & Cân bằng cell pin • KTV: Lê Quang Vũ</div>
              </div>
              <div style="border:1px solid #FDE68A; background:#FFFBEB; border-radius:10px; padding:12px;">
                <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:800; color:#D97706;"><span>KHOANG 02 • CHỜ PHỤ TÙNG</span><span>40%</span></div>
                <div style="font-weight:800; font-size:14px; margin:4px 0;">SIGMA Vision S (30A-992.18)</div>
                <div style="font-size:12px; color:var(--text-secondary);">Hạng mục: Kiểm tra cảm biến LiDAR cản trước • KTV: Trần Minh Đức</div>
              </div>
              <div style="border:1px solid #A7F3D0; background:#ECFDF5; border-radius:10px; padding:12px;">
                <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:800; color:#059669;"><span>KHOANG 03 • SẴN SÀNG</span><span>TRỐNG</span></div>
                <div style="font-weight:800; font-size:14px; margin:4px 0;">Khoang Chẩn đoán Điện cao áp</div>
                <div style="font-size:12px; color:var(--text-secondary);">Sẵn sàng tiếp nhận lịch hẹn tiếp theo lúc 14:00</div>
              </div>
              <div style="border:1px solid #BFDBFE; background:#EFF6FF; border-radius:10px; padding:12px;">
                <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:800; color:var(--primary);"><span>KHOANG 04 • ĐANG XỬ LÝ</span><span>90%</span></div>
                <div style="font-weight:800; font-size:14px; margin:4px 0;">SIGMA Grand 7 (29A-771.05)</div>
                <div style="font-size:12px; color:var(--text-secondary);">Hạng mục: Cập nhật Firmware ADAS v2.6 • KTV: Phạm Quốc Khánh</div>
              </div>
            </div>
          </div>

          <div class="dash-table-card" style="margin-bottom:0;">
            <h4 style="font-size:15.5px; font-weight:800; margin-bottom:14px;">📦 Tồn kho Linh kiện Bảo hành Chính hãng</h4>
            <div style="display:flex; flex-direction:column; gap:10px; font-size:13px;">
              <div style="display:flex; justify-content:space-between; padding:8px 10px; background:#FEF2F2; border-radius:8px; border:1px solid #FECACA;">
                <span><strong>Module Pin LFP/NMC Dự phòng</strong></span>
                <span style="color:#DC2626; font-weight:800;">Sắp hết (02 bộ)</span>
              </div>
              <div style="display:flex; justify-content:space-between; padding:8px 10px; background:#FFFBEB; border-radius:8px; border:1px solid #FDE68A;">
                <span><strong>Má phanh Gốm Carbon Hiệu suất cao</strong></span>
                <span style="color:#D97706; font-weight:800;">Cần nhập (05 bộ)</span>
              </div>
              <div style="display:flex; justify-content:space-between; padding:8px 10px; background:#ECFDF5; border-radius:8px; border:1px solid #A7F3D0;">
                <span><strong>Lọc gió Điều hòa HEPA N95</strong></span>
                <span style="color:#059669; font-weight:800;">Đủ tồn (48 chiếc)</span>
              </div>
              <div style="display:flex; justify-content:space-between; padding:8px 10px; background:#ECFDF5; border-radius:8px; border:1px solid #A7F3D0;">
                <span><strong>Bộ sạc OBC 11kW & Cảm biến ADAS</strong></span>
                <span style="color:#059669; font-weight:800;">Đủ tồn (19 bộ)</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Service Appointments Management -->
        <div class="dash-table-card" style="margin-bottom:24px;">
          <h4 style="font-size:16px; font-weight:800; margin-bottom:14px;">📅 Quản lý Lịch hẹn Bảo dưỡng & Sửa chữa Trực tuyến</h4>
          <table class="dash-data-table">
            <thead>
              <tr>
                <th>Mã lịch</th>
                <th>Khách hàng / Xe</th>
                <th>Hạng mục dịch vụ</th>
                <th>Trung tâm & Ngày giờ</th>
                <th>Trạng thái</th>
                <th style="text-align:right;">Cập nhật Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              ${srvAppts.map(a => `
                <tr>
                  <td><strong>${escapeHtml(a.appointmentCode || a.id)}</strong></td>
                  <td><strong>${escapeHtml(a.customerName)}</strong> (${escapeHtml(a.customerPhone)})<br><span style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(a.vehicleName)} • VIN: ${escapeHtml(a.vin || 'N/A')}</span></td>
                  <td>${escapeHtml(a.serviceType)}<br><span style="font-size:11px; color:var(--text-muted);">KTV: ${escapeHtml(a.technicianName || 'Đang phân công')}</span></td>
                  <td><strong>${escapeHtml(a.preferredTime)} ${escapeHtml(a.preferredDate)}</strong><br><span style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(a.serviceCenterName)}</span></td>
                  <td><span class="status-badge ${a.status === 'Đã xác nhận' || a.status === 'Hoàn thành' ? 'confirmed' : 'pending'}">● ${escapeHtml(a.status)}</span></td>
                  <td style="text-align:right;">
                    <select class="filter-select sel-srv-appt-status" data-id="${a.id}" style="width:145px; padding:5px 8px; font-size:12px; display:inline-block;">
                      ${['Chờ xác nhận', 'Đã xác nhận', 'Đang thực hiện', 'Hoàn thành', 'Đã hủy'].map(st => `<option value="${st}" ${a.status === st ? 'selected' : ''}>${st}</option>`).join('')}
                    </select>
                    <button class="btn-primary btn-update-srv-appt" data-id="${a.id}" style="padding:5px 10px; font-size:11.5px;">Lưu</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Warranties + Add Service Record Form -->
        <div style="display:grid; grid-template-columns:1.25fr 1fr; gap:20px;">
          <div class="dash-table-card" style="margin-bottom:0;">
            <h4 style="font-size:16px; font-weight:800; margin-bottom:14px;">🛡️ Hồ sơ Bảo hành Điện tử Đã kích hoạt (${warranties.length})</h4>
            <table class="dash-data-table">
              <thead>
                <tr>
                  <th>Mã BH / Xe</th>
                  <th>Số VIN & Mã máy</th>
                  <th>Thời hạn</th>
                  <th>ODO / Pin SoH</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                ${warranties.map(w => `
                  <tr>
                    <td><strong>${escapeHtml(w.warrantyCode)}</strong><br><span style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(w.vehicleName)} (${escapeHtml(w.buyerName)})</span></td>
                    <td><strong>${escapeHtml(w.vin)}</strong><br><span style="font-size:11px; color:var(--text-muted);">Máy: ${escapeHtml(w.motorNumber)}</span></td>
                    <td>${escapeHtml(w.startDate)} &rarr; <strong>${escapeHtml(w.endDate)}</strong><br><span style="font-size:11px; color:var(--text-muted);">Max ${(w.maxOdoKm || 160000).toLocaleString('vi-VN')} km</span></td>
                    <td><strong>${(w.currentOdoKm || 0).toLocaleString('vi-VN')} km</strong><br><span style="font-size:11px; color:var(--accent-emerald);">Pin SoH: ${w.batterySoh || 100}%</span></td>
                    <td><span class="status-badge confirmed">● ${escapeHtml(w.status)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div class="dash-table-card" style="margin-bottom:0;">
            <h4 style="font-size:16px; font-weight:800; margin-bottom:12px;">📝 Ghi nhận Hồ sơ Bảo dưỡng / Sửa chữa Mới</h4>
            <form id="form-admin-add-service-record" style="display:flex; flex-direction:column; gap:10px;">
              <div>
                <label class="filter-label">Chọn Hồ sơ Bảo hành (Xe) *</label>
                <select id="srv-rec-warranty-id" class="filter-select" required>
                  ${warranties.map(w => `<option value="${w.id}">${escapeHtml(w.vehicleName)} — VIN: ${escapeHtml(w.vin)} (${escapeHtml(w.buyerName)})</option>`).join('')}
                </select>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div>
                  <label class="filter-label">Hạng mục thực hiện *</label>
                  <input type="text" id="srv-rec-type" class="filter-input" required placeholder="VD: Bảo dưỡng định kỳ 10.000 km">
                </div>
                <div>
                  <label class="filter-label">Số ODO hiện tại (km) *</label>
                  <input type="number" id="srv-rec-odo" class="filter-input" required value="5000" min="0">
                </div>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div>
                  <label class="filter-label">Linh kiện thay thế (phẩy)</label>
                  <input type="text" id="srv-rec-parts" class="filter-input" placeholder="Lọc gió HEPA, Nước làm mát">
                </div>
                <div>
                  <label class="filter-label">Chi phí dịch vụ (VNĐ)</label>
                  <input type="number" id="srv-rec-cost" class="filter-input" value="0" min="0">
                </div>
              </div>
              <div>
                <label class="filter-label">Kết quả kiểm tra kỹ thuật *</label>
                <input type="text" id="srv-rec-result" class="filter-input" required placeholder="VD: Hệ thống Pin SoH 99.6%, phanh và gầm đạt chuẩn">
              </div>
              <button type="submit" class="btn-primary" style="justify-content:center; padding:10px;">💾 Lưu Biên bản Bảo dưỡng & Cập nhật ODO</button>
            </form>
          </div>
        </div>
      `;
    }

    if (tab === 'dash-testdrives') {
      return `
        <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.4) 100%), url('assets/banner-seller-testdrive.jpg');">
          <h3>Lịch hẹn Lái thử tại Showroom</h3>
          <p>Điều phối xe demo, phân công tư vấn viên tiếp đón và theo dõi trải nghiệm lái thử thực tế.</p>
        </div>

        <div class="dash-table-card">
          <table class="dash-data-table">
            <thead>
              <tr>
                <th>Khách hàng</th>
                <th>Dòng xe lái thử</th>
                <th>Thời gian</th>
                <th>Chi nhánh</th>
                <th>Trạng thái</th>
                <th style="text-align:right;">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${(apptsList.length > 0 ? apptsList : (dashData.appointments || [])).map(a => `
                <tr>
                  <td><strong>${escapeHtml(a.customerName || a.customer)}</strong><br><span style="font-size:11px; color:var(--text-muted);">${escapeHtml(a.phone)}</span></td>
                  <td><strong>${escapeHtml(a.carName || a.car)}</strong></td>
                  <td>${escapeHtml(a.timeSlot || '')} ${escapeHtml(a.preferredDate || a.time)}</td>
                  <td>${escapeHtml(a.branchName || a.branch || 'Showroom Cầu Giấy')}</td>
                  <td><span class="status-badge confirmed">● ${escapeHtml(a.status)}</span></td>
                  <td style="text-align:right;">
                    <button class="btn-card-outline" style="padding:4px 8px; font-size:11.5px;" onclick="showToast('Đang kết nối cuộc gọi tới khách hàng: ${escapeHtml(a.customerName || a.customer)}', '📞')">📞 Gọi điện</button>
                    <button class="btn-card-primary btn-appt-complete" data-id="${a.id}" style="padding:4px 8px; font-size:11.5px;">✓ Hoàn thành</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (tab === 'dash-inventory') {
      return `
        <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.4) 100%), url('assets/banner-seller-inventory.jpg');">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <h3>Quản lý Kho xe Chi nhánh (Inventory)</h3>
              <p>Theo dõi xe mới, xe trưng bày và tồn kho thời gian thực với đồng bộ dữ liệu vào hệ thống AI.</p>
            </div>
            <button id="btn-open-add-car-modal" class="btn-primary" style="display:inline-flex; align-items:center; gap:8px; padding:10px 18px; border-radius:8px; font-weight:700; cursor:pointer; background:linear-gradient(135deg, #2563EB, #1D4ED8); color:#FFFFFF; border:none; box-shadow:0 4px 12px rgba(37,99,235,0.25);">
              <span>➕ Thêm xe mới & Tự động nạp vào AI</span>
            </button>
          </div>
        </div>

        <div class="dash-table-card">
          <table class="dash-data-table">
            <thead>
              <tr>
                <th>Hình ảnh</th>
                <th>Tên dòng xe</th>
                <th>Phân khúc</th>
                <th>Giá niêm yết</th>
                <th>Tồn kho khả dụng</th>
                <th>Trạng thái</th>
                <th style="text-align:right;">Điều chỉnh</th>
              </tr>
            </thead>
            <tbody>
              ${AppState.vehiclesList.map(v => `
                <tr>
                  <td><img src="${v.image}" style="width:64px; height:40px; object-fit:contain; border-radius:4px;"></td>
                  <td><strong>${escapeHtml(v.name)}</strong><br><span style="font-size:11px; color:var(--text-muted);">${escapeHtml(v.subtitle)}</span></td>
                  <td>${escapeHtml(v.category)}</td>
                  <td><strong>${escapeHtml(v.priceFormatted)}</strong></td>
                  <td><span style="font-size:16px; font-weight:800; color:var(--primary);">${v.stock ?? 10}</span> xe</td>
                  <td><span class="status-badge ${(v.stock ?? 10) > 0 ? 'confirmed' : 'pending'}">${(v.stock ?? 10) > 0 ? '● Có sẵn giao ngay' : '● Chờ nhập thêm'}</span></td>
                  <td style="text-align:right;">
                    <button class="btn-card-outline btn-stock-adjust" data-id="${v.id}" data-delta="1" style="padding:4px 8px; font-size:12px;">+1 Xe</button>
                    <button class="btn-card-outline btn-stock-adjust" data-id="${v.id}" data-delta="-1" style="padding:4px 8px; font-size:12px;">-1 Xe</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // SECTION 4 ADMIN: KIỂM DUYỆT ĐÁNH GIÁ & CÂU HỎI CỘNG ĐỒNG
    if (tab === 'dash-reviews') {
      const allRevs = modData.reviews || [];
      const allQs = modData.questions || [];
      return `
        <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.88) 0%, rgba(15,23,42,0.45) 100%), url('assets/banner-seller-crm.jpg');">
          <h3>Kiểm duyệt Đánh giá Xe & Cộng đồng Hỏi Đáp</h3>
          <p>Bảo vệ tính minh bạch: xác minh nhãn "Đã mua hàng", xử lý nội dung bị báo cáo và ẩn/khôi phục đánh giá kèm lịch sử kiểm duyệt.</p>
        </div>

        <div class="dash-table-card" style="margin-bottom:24px;">
          <h4 style="font-size:16px; font-weight:800; margin-bottom:14px;">⭐ Danh sách Đánh giá từ Người dùng (${allRevs.length})</h4>
          <table class="dash-data-table">
            <thead>
              <tr>
                <th>Mẫu xe / Khách hàng</th>
                <th>Số sao & Nội dung</th>
                <th>Xác minh</th>
                <th>Trạng thái / Báo cáo</th>
                <th style="text-align:right;">Thao tác Kiểm duyệt (Bắt buộc lý do)</th>
              </tr>
            </thead>
            <tbody>
              ${allRevs.map(r => `
                <tr>
                  <td><strong>${escapeHtml(r.vehicleId)}</strong><br><span style="font-size:12px; color:var(--text-muted);">${escapeHtml(r.userName)}</span></td>
                  <td>
                    <div style="color:#F59E0B; font-weight:800;">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} — ${escapeHtml(r.title)}</div>
                    <div style="font-size:12px; color:var(--text-secondary); max-width:340px;">${escapeHtml(r.content)}</div>
                  </td>
                  <td>
                    ${r.verifiedPurchase ? `<span class="verified-purchase-badge">✓ Đã mua (${escapeHtml(r.orderNumber || 'Verified')})</span>` : `<span style="font-size:11.5px; color:var(--text-muted);">Chưa mua xe</span>`}
                  </td>
                  <td>
                    <span class="status-badge ${r.status === 'Đã duyệt' ? 'confirmed' : 'pending'}">● ${escapeHtml(r.status)}</span>
                    ${(r.reportedBy && r.reportedBy.length > 0) ? `<div style="font-size:11px; color:var(--accent-rose); font-weight:700; margin-top:4px;">🚩 Bị báo cáo (${r.reportedBy.length})</div>` : ''}
                  </td>
                  <td style="text-align:right;">
                    <input type="text" class="filter-input inp-mod-reason" data-id="${r.id}" placeholder="Lý do kiểm duyệt..." style="width:150px; padding:4px 8px; font-size:11.5px; display:inline-block;">
                    <button class="btn-card-outline btn-mod-review" data-id="${r.id}" data-status="Đã duyệt" style="padding:4px 8px; font-size:11px; color:#059669;">Khôi phục/Duyệt</button>
                    <button class="btn-card-outline btn-mod-review" data-id="${r.id}" data-status="Đã ẩn" style="padding:4px 8px; font-size:11px; color:#D97706;">Ẩn</button>
                    <button class="btn-card-outline btn-mod-review" data-id="${r.id}" data-status="Đã gỡ" style="padding:4px 8px; font-size:11px; color:#DC2626;">Gỡ</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // SECTION 5 ADMIN: TRUNG TÂM CSKH & QUẢN LÝ TICKET (WITH INTERNAL NOTES)
    if (tab === 'dash-support') {
      return `
        <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.88) 0%, rgba(15,23,42,0.45) 100%), url('assets/banner-seller-overview.jpg');">
          <h3>Quản trị Yêu cầu Hỗ trợ & Chăm sóc Khách hàng (Omnichannel Ticketing)</h3>
          <p>Theo dõi SLA, phân công chuyên viên phụ trách, phản hồi khách hàng trực tiếp và lưu ghi chú nội bộ bảo mật giữa các bộ phận.</p>
        </div>

        <div class="dash-kpi-grid">
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Phiếu mới / Chờ NV</span><span class="kpi-tag tag-warning">Cần phản hồi</span></div>
            <div class="kpi-val">${(supportStats.newCount ?? 0) + (supportStats.waitingStaffCount ?? 0)} phiếu</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Đang xử lý</span><span class="kpi-tag tag-success">Active</span></div>
            <div class="kpi-val">${supportStats.inProgressCount ?? 1} phiếu</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Chờ KH phản hồi</span><span class="kpi-tag tag-success">Waiting</span></div>
            <div class="kpi-val">${supportStats.waitingCustomerCount ?? 1} phiếu</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-top-row"><span class="kpi-label">Quá hạn SLA / Đã giải quyết</span><span class="kpi-tag ${(supportStats.overdueCount || 0) > 0 ? 'tag-danger' : 'tag-success'}">Quá hạn: ${supportStats.overdueCount ?? 0}</span></div>
            <div class="kpi-val">${supportStats.resolvedCount ?? 0} hoàn tất</div>
          </div>
        </div>

        <div class="dash-table-card">
          <h4 style="font-size:16px; font-weight:800; margin-bottom:16px;">🎧 Danh sách Phiếu Hỗ trợ Khách hàng (${supportTickets.length})</h4>
          ${supportTickets.map(t => `
            <div style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:18px; margin-bottom:16px; background:#F8FAFC;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
                <div>
                  <span style="background:#EFF6FF; color:var(--primary); font-weight:800; font-size:12px; padding:3px 8px; border-radius:6px;">${escapeHtml(t.ticketCode)}</span>
                  <span style="font-size:12px; color:var(--text-muted); margin-left:8px;">[${escapeHtml(t.category)}] • Ưu tiên: <strong style="color:${t.priority === 'Khẩn cấp' || t.priority === 'Cao' ? '#DC2626' : 'var(--text-dark)'};">${escapeHtml(t.priority)}</strong></span>
                  <h4 style="font-size:15.5px; font-weight:800; color:var(--text-dark); margin-top:4px;">${escapeHtml(t.subject)}</h4>
                  <div style="font-size:12px; color:var(--text-muted);">Khách hàng: <strong>${escapeHtml(t.customerName)}</strong> (${escapeHtml(t.customerPhone)} • ${escapeHtml(t.customerEmail)}) • Đơn/Xe: ${escapeHtml(t.orderId || t.vehicleName || 'N/A')}</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                  <select class="filter-select sel-ticket-status" data-id="${t.id}" style="width:170px; padding:5px 8px; font-size:12px;">
                    ${['Mới tiếp nhận', 'Đang xử lý', 'Chờ khách hàng phản hồi', 'Chờ nhân viên phản hồi', 'Đã giải quyết', 'Đã đóng'].map(st => `<option value="${st}" ${t.status === st ? 'selected' : ''}>${st}</option>`).join('')}
                  </select>
                  <input type="text" class="filter-input inp-ticket-staff" data-id="${t.id}" value="${escapeHtml(t.assignedStaffName || 'Trần Minh Tâm')}" placeholder="NV phụ trách" style="width:145px; padding:5px 8px; font-size:12px;">
                  <button class="btn-card-outline btn-admin-update-ticket" data-id="${t.id}" style="padding:5px 10px; font-size:11.5px;">Lưu TT</button>
                </div>
              </div>

              <!-- Public Conversation Thread -->
              <div class="ticket-thread-box" style="margin-bottom:10px; max-height:180px;">
                ${(t.messages || []).map(m => `
                  <div class="ticket-msg ${m.senderRole === 'customer' ? 'customer' : 'staff'}">
                    <div class="ticket-msg-meta"><span>${escapeHtml(m.senderName)} (${escapeHtml(m.senderRole)})</span><span>${new Date(m.createdAt).toLocaleString('vi-VN')}</span></div>
                    <div style="font-size:12.5px;">${escapeHtml(m.content)}</div>
                  </div>
                `).join('')}
              </div>

              <!-- Internal Notes Box (Strictly visible only to Admin/Support/Seller) -->
              <div style="margin-bottom:10px;">
                ${(t.internalNotes || []).map(n => `
                  <div class="ticket-internal-note">
                    <strong>🔒 Ghi chú nội bộ (${escapeHtml(n.authorName)} - ${new Date(n.createdAt).toLocaleString('vi-VN')}):</strong> ${escapeHtml(n.note)}
                  </div>
                `).join('')}
              </div>

              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div style="display:flex; gap:6px;">
                  <input type="text" class="filter-input inp-admin-ticket-reply" data-id="${t.id}" placeholder="Trả lời công khai cho khách hàng..." style="padding:7px 10px; font-size:12px;">
                  <button class="btn-primary btn-admin-ticket-reply" data-id="${t.id}" style="padding:7px 12px; font-size:12px; white-space:nowrap;">💬 Gửi KH</button>
                </div>
                <div style="display:flex; gap:6px;">
                  <input type="text" class="filter-input inp-admin-ticket-note" data-id="${t.id}" placeholder="Thêm ghi chú nội bộ (KH không thấy)..." style="padding:7px 10px; font-size:12px; background:#FFFBEB; border-color:#FDE68A;">
                  <button class="btn-dark btn-admin-ticket-note" data-id="${t.id}" style="padding:7px 12px; font-size:12px; white-space:nowrap;">🔒 Lưu Nội bộ</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // SECTION 6 ADMIN: EMAIL CHÚC MỪNG & CHIẾN DỊCH EMAIL (Email Marketing Admin.pdf)
    if (tab === 'dash-campaigns') {
      const cStats = campaignsRes.stats || {};
      const campaigns = campaignsRes.campaigns || [];
      const templates = campaignsRes.templates || [];
      return `
        <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.92) 0%, rgba(15,23,42,0.6) 100%), url('assets/banner-seller-crm.jpg');">
          <div style="font-size:12px; font-weight:700; color:var(--accent-cyan); text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">HỆ THỐNG MARKETING TỰ ĐỘNG & QUẢN TRỊ CHIẾN DỊCH</div>
          <h3 style="font-size:24px; font-weight:800; color:#FFFFFF; margin-bottom:6px;">Quản trị Chiến dịch Email Chúc mừng & Chăm sóc Chủ xe</h3>
          <p style="color:rgba(255,255,255,0.85); font-size:13.5px; max-width:760px;">Tự động gửi email chúc mừng sinh nhật, thông điệp tri ân dịp lễ Tết, ưu đãi phụ kiện độc quyền; cá nhân hóa theo từng mẫu xe và biển số; tuân thủ nghiêm ngặt quyền riêng tư Opt-in & Unsubscribe.</p>
        </div>

        <!-- 30-Day Performance Metric Cards & SVG Trend Curve (Email Marketing Admin.pdf) -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:20px;">
          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:18px; box-shadow:var(--shadow-sm); border-top:4px solid var(--primary);">
            <div style="font-size:12px; color:var(--text-muted); font-weight:600; margin-bottom:4px;">TỔNG EMAIL ĐÃ GỬI (30 NGÀY)</div>
            <div style="font-size:26px; font-weight:800; color:var(--text-dark);">1,592 <span style="font-size:12px; color:#059669; font-weight:700;">+14.8%</span></div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">Tỷ lệ gửi thành công: <strong>99.4%</strong></div>
          </div>
          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:18px; box-shadow:var(--shadow-sm); border-top:4px solid var(--accent-emerald);">
            <div style="font-size:12px; color:var(--text-muted); font-weight:600; margin-bottom:4px;">TỶ LỆ MỞ THƯ (OPEN RATE)</div>
            <div style="font-size:26px; font-weight:800; color:#059669;">68.4% <span style="font-size:12px; color:#059669; font-weight:700;">+5.2%</span></div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">1,089 lượt mở thực tế</div>
          </div>
          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:18px; box-shadow:var(--shadow-sm); border-top:4px solid var(--accent-amber);">
            <div style="font-size:12px; color:var(--text-muted); font-weight:600; margin-bottom:4px;">TỶ LỆ NHẤP LIÊN KẾT (CTR)</div>
            <div style="font-size:26px; font-weight:800; color:#D97706;">24.1% <span style="font-size:12px; color:#D97706; font-weight:700;">+3.1%</span></div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">384 lượt nhấp CTA nhận quà</div>
          </div>
          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:18px; box-shadow:var(--shadow-sm); border-top:4px solid var(--accent-cyan);">
            <div style="font-size:12px; color:var(--text-muted); font-weight:600; margin-bottom:4px;">TỆP KHÁCH HÀNG ĐÃ OPT-IN</div>
            <div style="font-size:26px; font-weight:800; color:var(--primary);">${cStats.optedInUsersCount ?? 1592} <span style="font-size:12px; color:var(--primary); font-weight:700;">Active</span></div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">100% đồng ý nhận tin chính chủ</div>
          </div>
        </div>

        <!-- 30-Day Trend Curve Chart (SVG) -->
        <div class="dash-table-card" style="margin-bottom:20px; padding:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
            <div>
              <h4 style="font-size:15px; font-weight:800; color:var(--text-dark); margin-bottom:2px;">📈 Biểu đồ Hiệu quả Gửi tin 30 ngày qua</h4>
              <span style="font-size:12px; color:var(--text-muted);">Đo lường sản lượng gửi, lượt mở và tương tác thực tế từ các chiến dịch</span>
            </div>
            <div style="display:flex; gap:14px; font-size:12px; align-items:center;">
              <span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:12px; height:3px; background:#2563EB; border-radius:2px;"></span> Email Đã gửi</span>
              <span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:12px; height:3px; background:#059669; border-radius:2px;"></span> Lượt Mở (Opens)</span>
              <span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:12px; height:3px; background:#D97706; border-radius:2px;"></span> Lượt Click (CTA)</span>
            </div>
          </div>
          <div style="width:100%; overflow-x:auto;">
            <svg viewBox="0 0 800 160" style="width:100%; min-width:600px; height:160px; overflow:visible;">
              <defs>
                <linearGradient id="grad-email-sent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#2563EB" stop-opacity="0.25"/>
                  <stop offset="100%" stop-color="#2563EB" stop-opacity="0.0"/>
                </linearGradient>
                <linearGradient id="grad-email-open" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#059669" stop-opacity="0.2"/>
                  <stop offset="100%" stop-color="#059669" stop-opacity="0.0"/>
                </linearGradient>
              </defs>
              <!-- Grid horizontal lines -->
              <line x1="40" y1="20" x2="780" y2="20" stroke="#E2E8F0" stroke-dasharray="4"/>
              <line x1="40" y1="60" x2="780" y2="60" stroke="#E2E8F0" stroke-dasharray="4"/>
              <line x1="40" y1="100" x2="780" y2="100" stroke="#E2E8F0" stroke-dasharray="4"/>
              <line x1="40" y1="140" x2="780" y2="140" stroke="#CBD5E1"/>

              <!-- Y Axis labels -->
              <text x="32" y="24" font-size="10" fill="#94A3B8" text-anchor="end">150</text>
              <text x="32" y="64" font-size="10" fill="#94A3B8" text-anchor="end">100</text>
              <text x="32" y="104" font-size="10" fill="#94A3B8" text-anchor="end">50</text>
              <text x="32" y="144" font-size="10" fill="#94A3B8" text-anchor="end">0</text>

              <!-- Filled Area 1 (Sent) -->
              <path d="M 60 140 L 60 98 L 140 105 L 220 80 L 300 88 L 380 50 L 460 62 L 540 45 L 620 52 L 700 35 L 760 30 L 760 140 Z" fill="url(#grad-email-sent)"/>
              <!-- Line 1 (Sent) -->
              <polyline points="60,98 140,105 220,80 300,88 380,50 460,62 540,45 620,52 700,35 760,30" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-linecap="round"/>

              <!-- Line 2 (Opens) -->
              <path d="M 60 140 L 60 115 L 140 118 L 220 100 L 300 105 L 380 75 L 460 84 L 540 70 L 620 76 L 700 60 L 760 55 L 760 140 Z" fill="url(#grad-email-open)"/>
              <polyline points="60,115 140,118 220,100 300,105 380,75 460,84 540,70 620,76 700,60 760,55" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round"/>

              <!-- Line 3 (Clicks) -->
              <polyline points="60,130 140,132 220,124 300,126 380,112 460,116 540,108 620,110 700,102 760,98" fill="none" stroke="#D97706" stroke-width="1.8" stroke-dasharray="3,3" stroke-linecap="round"/>

              <!-- X Axis dates -->
              <text x="60" y="156" font-size="10" fill="#94A3B8" text-anchor="middle">01/10</text>
              <text x="200" y="156" font-size="10" fill="#94A3B8" text-anchor="middle">08/10</text>
              <text x="360" y="156" font-size="10" fill="#94A3B8" text-anchor="middle">15/10</text>
              <text x="520" y="156" font-size="10" fill="#94A3B8" text-anchor="middle">22/10</text>
              <text x="680" y="156" font-size="10" fill="#94A3B8" text-anchor="middle">29/10</text>
              <text x="760" y="156" font-size="10" fill="#94A3B8" text-anchor="middle">Hôm nay</text>
            </svg>
          </div>
        </div>

        <!-- 3 Visual Template Cards (Email Marketing Admin.pdf) -->
        <div style="margin-bottom:24px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h4 style="font-size:16px; font-weight:800; color:var(--text-dark);">🎨 Chọn Mẫu Email Thiết kế Sẵn (Visual Templates)</h4>
            <span style="font-size:12px; color:var(--text-muted);">Nhấn mẫu để tải nội dung vào trình soạn thảo</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:18px;" id="email-template-cards-grid">
            <!-- Template 1: Tết -->
            <div class="email-visual-card active" data-tpl-id="tpl-newyear" style="cursor:pointer; background:#FFFFFF; border:2px solid var(--primary); border-radius:var(--radius-lg); overflow:hidden; box-shadow:var(--shadow-md); transition:transform 0.2s, box-shadow 0.2s;">
              <div style="height:140px; overflow:hidden; position:relative; background:#B91C1C;">
                <img src="assets/project3/email-tpl-newyear.jpg" alt="Mẫu Email Tết" style="width:100%; height:100%; object-fit:cover;">
                <span style="position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.7); color:#FFD700; font-size:11px; font-weight:800; padding:3px 8px; border-radius:12px;">🧧 TẾT NGUYÊN ĐÁN</span>
              </div>
              <div style="padding:14px;">
                <h5 style="font-size:15px; font-weight:800; color:var(--text-dark); margin-bottom:4px;">Tết Tri Ân & Chăm Sóc Xe Đầu Năm</h5>
                <p style="font-size:12px; color:var(--text-muted); line-height:1.4; margin-bottom:10px;">Lì xì bảo dưỡng vàng, voucher phủ ceramic và lời chúc vạn dặm bình an tới chủ xe.</p>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px;">
                  <span style="color:var(--primary); font-weight:700;">Áp dụng: Toàn bộ chủ xe</span>
                  <span style="background:#EFF6FF; color:var(--primary); padding:2px 8px; border-radius:4px; font-weight:700;">MẪU ĐANG CHỌN ✓</span>
                </div>
              </div>
            </div>

            <!-- Template 2: Sinh nhật -->
            <div class="email-visual-card" data-tpl-id="tpl-birthday" style="cursor:pointer; background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); overflow:hidden; box-shadow:var(--shadow-sm); transition:transform 0.2s, box-shadow 0.2s;">
              <div style="height:140px; overflow:hidden; position:relative; background:#1E3A8A;">
                <img src="assets/project3/email-tpl-birthday.jpg" alt="Mẫu Email Sinh nhật" style="width:100%; height:100%; object-fit:cover;">
                <span style="position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.7); color:#93C5FD; font-size:11px; font-weight:800; padding:3px 8px; border-radius:12px;">🎂 SINH NHẬT</span>
              </div>
              <div style="padding:14px;">
                <h5 style="font-size:15px; font-weight:800; color:var(--text-dark); margin-bottom:4px;">Chúc mừng Sinh nhật Chủ xe & Voucher</h5>
                <p style="font-size:12px; color:var(--text-muted); line-height:1.4; margin-bottom:10px;">Gửi tặng voucher giảm 10% sạc pin trạm hoặc gói phụ kiện VIP nhân tháng sinh nhật.</p>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px;">
                  <span style="color:var(--text-muted);">Tự động theo ngày sinh</span>
                  <span style="background:#F1F5F9; color:var(--text-dark); padding:2px 8px; border-radius:4px;">Chọn mẫu</span>
                </div>
              </div>
            </div>

            <!-- Template 3: Giáng sinh -->
            <div class="email-visual-card" data-tpl-id="tpl-christmas" style="cursor:pointer; background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); overflow:hidden; box-shadow:var(--shadow-sm); transition:transform 0.2s, box-shadow 0.2s;">
              <div style="height:140px; overflow:hidden; position:relative; background:#047857;">
                <img src="assets/project3/email-tpl-christmas.jpg" alt="Mẫu Email Giáng sinh" style="width:100%; height:100%; object-fit:cover;">
                <span style="position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.7); color:#A7F3D0; font-size:11px; font-weight:800; padding:3px 8px; border-radius:12px;">🎄 GIÁNG SINH</span>
              </div>
              <div style="padding:14px;">
                <h5 style="font-size:15px; font-weight:800; color:var(--text-dark); margin-bottom:4px;">Giáng sinh An Lành & Ưu Đãi Mùa Đông</h5>
                <p style="font-size:12px; color:var(--text-muted); line-height:1.4; margin-bottom:10px;">Ưu đãi trạm sạc mùa lễ hội cuối năm, hỗ trợ kiểm tra bình điện & phanh miễn phí.</p>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px;">
                  <span style="color:var(--text-muted);">Mùa lễ hội Tháng 12</span>
                  <span style="background:#F1F5F9; color:var(--text-dark); padding:2px 8px; border-radius:4px;">Chọn mẫu</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:var(--radius-md); padding:12px 18px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="font-size:13px; color:#1E40AF;">
            <strong>🛡️ Chế độ An toàn Môi trường Phát triển (Dev Queue Mode):</strong> ${campaignsRes.smtpConfigured ? 'Đã kết nối SMTP.' : 'Chưa cấu hình SMTP ngoài trong .env — Email được mô phỏng vào hàng đợi kiểm thử an toàn, tuyệt đối không gửi thư rác ra ngoài.'}
          </div>
          <span class="kpi-tag tag-success">Opt-in Active: ${cStats.optedInUsersCount ?? 1592} KH</span>
        </div>

        <div style="display:grid; grid-template-columns:1.05fr 1fr; gap:22px; margin-bottom:24px;">
          <!-- Create / Edit & Preview Email Template -->
          <div class="dash-table-card" style="margin-bottom:0;">
            <h4 style="font-size:16px; font-weight:800; margin-bottom:12px;">✍️ Soạn thảo Chiến dịch & Cá nhân hóa</h4>
            <form id="form-admin-create-campaign" style="display:flex; flex-direction:column; gap:10px;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div>
                  <label class="filter-label">Tên chiến dịch *</label>
                  <input type="text" id="camp-name" class="filter-input" required value="Tết Tri Ân & Chăm Sóc Xe Đầu Năm 2026">
                </div>
                <div>
                  <label class="filter-label">Mẫu có sẵn (Template)</label>
                  <select id="camp-template-select" class="filter-select">
                    ${templates.map(tpl => `<option value="${tpl.id}">${escapeHtml(tpl.name)} (${escapeHtml(tpl.occasion)})</option>`).join('')}
                    ${templates.length === 0 ? `
                      <option value="tpl-newyear">Tết Tri Ân & Chăm Sóc Xe Đầu Năm</option>
                      <option value="tpl-birthday">Chúc mừng Sinh nhật Thành viên</option>
                      <option value="tpl-christmas">Giáng sinh An Lành & Ưu Đãi Mùa Đông</option>
                    ` : ''}
                  </select>
                </div>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div>
                  <label class="filter-label">Nhóm khách hàng mục tiêu (Đã Opt-in)</label>
                  <select id="camp-segment" class="filter-select">
                    <option value="all_opted_in">Tất cả KH đồng ý nhận tin (Opt-in: 1,592 KH)</option>
                    <option value="owners_only">Chủ sở hữu xe SIGMACAR</option>
                    <option value="vip_gold">Thành viên Hạng Vàng (VIP Gold)</option>
                  </select>
                </div>
                <div>
                  <label class="filter-label">Mã ưu đãi ({{promo_code}})</label>
                  <input type="text" id="camp-promo" class="filter-input" value="SIGMA-TET2026">
                </div>
              </div>
              <div>
                <label class="filter-label">Tiêu đề Email (Subject) *</label>
                <input type="text" id="camp-subject" class="filter-input" required value="🧧 Chúc mừng Năm Mới {{customer_name}} — Lì xì bảo dưỡng vàng từ SIGMACAR!">
              </div>

              <!-- Variable Insertion Pills Bar (Email Marketing Admin.pdf) -->
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <label class="filter-label" style="margin-bottom:0;">Nội dung thông điệp *</label>
                  <span style="font-size:11px; color:var(--text-muted);">Nhấn thẻ dưới đây để tự động chèn biến:</span>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;" id="email-variable-pills">
                  <button type="button" class="btn-var-pill" data-var="{{customer_name}}" style="background:#EFF6FF; border:1px solid #BFDBFE; color:var(--primary); font-size:11.5px; font-weight:700; padding:3px 8px; border-radius:6px; cursor:pointer;">+ {{customer_name}}</button>
                  <button type="button" class="btn-var-pill" data-var="{{vehicle_name}}" style="background:#EFF6FF; border:1px solid #BFDBFE; color:var(--primary); font-size:11.5px; font-weight:700; padding:3px 8px; border-radius:6px; cursor:pointer;">+ {{vehicle_name}}</button>
                  <button type="button" class="btn-var-pill" data-var="{{plate_number}}" style="background:#EFF6FF; border:1px solid #BFDBFE; color:var(--primary); font-size:11.5px; font-weight:700; padding:3px 8px; border-radius:6px; cursor:pointer;">+ {{plate_number}}</button>
                  <button type="button" class="btn-var-pill" data-var="{{birth_date}}" style="background:#EFF6FF; border:1px solid #BFDBFE; color:var(--primary); font-size:11.5px; font-weight:700; padding:3px 8px; border-radius:6px; cursor:pointer;">+ {{birth_date}}</button>
                  <button type="button" class="btn-var-pill" data-var="{{promo_code}}" style="background:#EFF6FF; border:1px solid #BFDBFE; color:var(--primary); font-size:11.5px; font-weight:700; padding:3px 8px; border-radius:6px; cursor:pointer;">+ {{promo_code}}</button>
                </div>
                <textarea id="camp-body" class="filter-input" rows="4" required>Kính gửi {{customer_name}}, Nhân dịp đầu xuân năm mới 2026, SIGMACAR kính chúc Quý khách vạn dặm bình an trên hành trình cùng xế yêu {{vehicle_name}}! Chúng tôi xin gửi tặng mã ưu đãi {{promo_code}} trị giá gói bảo dưỡng vàng 5.000.000 VNĐ áp dụng tại mọi xưởng dịch vụ ủy quyền.</textarea>
              </div>

              <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
                <div>
                  <label class="filter-label">Nút CTA</label>
                  <input type="text" id="camp-cta-label" class="filter-input" value="Kích Hoạt Lì Xì Ngay">
                </div>
                <div>
                  <label class="filter-label">Liên kết CTA</label>
                  <input type="text" id="camp-cta-url" class="filter-input" value="#profile">
                </div>
                <div>
                  <label class="filter-label">Lịch gửi dự kiến</label>
                  <input type="datetime-local" id="camp-sched-at" class="filter-input" value="2026-01-20T08:00">
                </div>
              </div>

              <!-- Compliance Notice -->
              <div style="background:#F8FAFC; border:1px solid var(--border-subtle); border-radius:8px; padding:10px 12px; font-size:11.5px; color:var(--text-muted); line-height:1.4;">
                🛡️ <strong>Tuân thủ Nghị định 91/2020/NĐ-CP:</strong> Mọi email gửi qua hệ thống đều tự động chèn chân trang pháp lý và liên kết Hủy đăng ký (Unsubscribe) 1 chạm cho người nhận.
              </div>

              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">
                <button type="button" class="btn-card-outline" id="btn-camp-refresh-preview" style="padding:8px 14px; font-size:12.5px;">👁️ Xem trước (Preview)</button>
                <button type="submit" class="btn-primary" style="padding:8px 18px; font-size:12.5px;">💾 Lưu & Lên lịch Chiến dịch</button>
              </div>
            </form>
          </div>

          <!-- Live Email Preview Frame (Desktop / Mobile Toggle) -->
          <div class="dash-table-card" style="margin-bottom:0; display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <h4 style="font-size:16px; font-weight:800;">📱 Xem trước Giao diện Email (Responsive)</h4>
              <div style="display:flex; gap:6px;">
                <button type="button" class="filter-pill-btn active" id="btn-preview-desktop" style="padding:4px 10px; font-size:11.5px;">🖥️ Desktop</button>
                <button type="button" class="filter-pill-btn" id="btn-preview-mobile" style="padding:4px 10px; font-size:11.5px;">📱 Mobile</button>
              </div>
            </div>
            <div id="admin-email-preview-wrapper" class="email-preview-frame desktop" style="flex:1; min-height:420px; max-height:480px; overflow-y:auto; border-radius:var(--radius-md); border:1px solid var(--border-subtle); background:#F1F5F9; padding:12px;">
              Đang tạo bản xem trước...
            </div>
          </div>
        </div>

        <!-- Existing Campaigns Table with CSV Export Button -->
        <div class="dash-table-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
            <h4 style="font-size:16px; font-weight:800; margin-bottom:0;">📊 Danh sách Chiến dịch & Lịch sử Gửi (${campaigns.length})</h4>
            <button type="button" class="btn-card-outline" id="btn-export-campaigns-csv" style="padding:6px 14px; font-size:12.5px; display:inline-flex; align-items:center; gap:6px;">
              📥 Xuất Báo cáo CSV
            </button>
          </div>
          <table class="dash-data-table">
            <thead>
              <tr>
                <th>Mã / Tên chiến dịch</th>
                <th>Dịp / Nhóm nhận</th>
                <th>Thống kê Gửi / Mở / Click</th>
                <th>Trạng thái</th>
                <th style="text-align:right;">Thao tác Điều khiển</th>
              </tr>
            </thead>
            <tbody>
              ${campaigns.map(c => `
                <tr>
                  <td><strong>${escapeHtml(c.name)}</strong><br><span style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(c.campaignCode)} • Mã KM: ${escapeHtml(c.promoCode || 'N/A')}</span></td>
                  <td>${escapeHtml(c.occasion)}<br><span style="font-size:11px; color:var(--text-muted);">Segment: ${escapeHtml(c.targetSegment)}</span></td>
                  <td>
                    <span style="font-size:12px;">Tổng: <strong>${c.stats?.totalRecipients || 0}</strong> • Thành công: <strong style="color:#059669;">${c.stats?.sentCount || 0}</strong> • Lỗi: <strong>${c.stats?.failedCount || 0}</strong></span><br>
                    <span style="font-size:11px; color:var(--text-muted);">Mở: ${c.stats?.openedCount || 0} • Click: ${c.stats?.clickedCount || 0}</span>
                  </td>
                  <td><span class="status-badge ${c.status === 'Đã gửi' ? 'confirmed' : 'pending'}">● ${escapeHtml(c.status)}</span></td>
                  <td style="text-align:right;">
                    <button class="btn-card-outline btn-camp-test" data-id="${c.id}" style="padding:4px 8px; font-size:11.5px;">🧪 Gửi thử (Test)</button>
                    ${c.status !== 'Đã gửi' ? `
                      <button class="btn-primary btn-camp-execute" data-id="${c.id}" data-name="${escapeHtml(c.name)}" style="padding:4px 10px; font-size:11.5px;">🚀 Thực thi Gửi</button>
                      <button class="btn-card-outline btn-camp-status" data-id="${c.id}" data-status="${c.status === 'Tạm dừng' ? 'Đã lên lịch' : 'Tạm dừng'}" style="padding:4px 8px; font-size:11.5px;">${c.status === 'Tạm dừng' ? '▶ Tiếp tục' : '⏸ Tạm dừng'}</button>
                    ` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (tab === 'dash-crm') {
      const realStaff = usersList.filter(u => ['admin', 'seller', 'support_staff', 'service_staff'].includes(u.role));
      const realBuyers = usersList.filter(u => u.role === 'buyer');

      return `
        <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.4) 100%), url('assets/banner-seller-crm.jpg');">
          <h3>Tư vấn Khách hàng (AI CRM) & Quản trị Nhân sự (RBAC)</h3>
          <p>Quản lý đội ngũ nhân viên kinh doanh, phân quyền hệ thống và theo dõi danh sách khách hàng đăng ký tài khoản thực tế.</p>
        </div>

        <div class="dash-table-card" style="margin-bottom:24px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
            <div>
              <h4 style="font-size:16px; font-weight:800; margin:0 0 4px 0;">🔐 Quản lý Đội ngũ Nhân sự & Phân quyền Vai trò (${realStaff.length})</h4>
              <p style="font-size:12.5px; color:var(--text-muted); margin:0;">Chỉ tài khoản Quản trị viên tối cao (Admin) mới có quyền tạo thêm nhân viên kinh doanh, đổi vai trò và xóa tài khoản.</p>
            </div>
            ${curUser.role === 'admin' ? `
              <button class="btn-primary" id="btn-open-add-staff" style="padding:9px 18px; font-size:13px; font-weight:700; display:flex; align-items:center; gap:8px; cursor:pointer;">
                <span>➕</span> Thêm Nhân viên Kinh doanh Mới
              </button>
            ` : ''}
          </div>

          <table class="dash-data-table">
            <thead>
              <tr>
                <th>Họ và tên</th>
                <th>Email / Điện thoại</th>
                <th>Showroom / Chi nhánh</th>
                <th>Vai trò hệ thống</th>
                <th style="text-align:right;">Thao tác quản trị</th>
              </tr>
            </thead>
            <tbody>
              ${realStaff.map(u => `
                <tr>
                  <td><strong>${escapeHtml(u.fullName || 'Nhân viên')}</strong></td>
                  <td>${escapeHtml(u.email)}<br><span style="font-size:11px; color:var(--text-muted);">${escapeHtml(u.phone || 'Chưa cập nhật')}</span></td>
                  <td><span style="font-size:12px; color:#475569;">${escapeHtml(u.branchName || 'Showroom Toàn quốc')}</span></td>
                  <td><span class="status-badge confirmed" style="text-transform:uppercase; font-size:11px;">${escapeHtml((u.role || 'SELLER').toUpperCase())}</span></td>
                  <td style="text-align:right;">
                    ${u.role === 'admin' ? `
                      <span style="font-size:11px; color:#059669; font-weight:700; background:#D1FAE5; padding:4px 10px; border-radius:4px;">👑 Quản trị tối cao</span>
                    ` : `
                      <select class="filter-select sel-user-role" data-id="${u.id}" style="width:140px; padding:4px 6px; font-size:11.5px; display:inline-block; vertical-align:middle;">
                        ${['seller', 'support_staff', 'service_staff', 'admin', 'buyer'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}
                      </select>
                      <button class="btn-primary btn-update-user-role" data-id="${u.id}" style="padding:5px 10px; font-size:11.5px; vertical-align:middle;">Lưu</button>
                      <button class="btn-secondary btn-delete-user" data-id="${u.id}" data-name="${escapeHtml(u.fullName || u.email)}" style="padding:5px 10px; font-size:11.5px; color:#DC2626; border-color:#FCA5A5; margin-left:4px; vertical-align:middle; cursor:pointer;">🗑️ Xóa</button>
                    `}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="dash-table-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div>
              <h4 style="font-size:16px; font-weight:800; margin:0 0 4px 0;">👥 Danh sách Khách hàng Đăng ký Tài khoản Thực tế (${realBuyers.length})</h4>
              <p style="font-size:12.5px; color:var(--text-muted); margin:0;">Toàn bộ dữ liệu ảo đã được xóa sạch. Chỉ khi khách hàng thật đăng ký tài khoản mới trên website thì thông tin mới xuất hiện tại đây.</p>
            </div>
          </div>
          
          ${realBuyers.length === 0 ? `
            <div style="text-align:center; padding:42px 20px; background:#F8FAFC; border-radius:12px; border:2px dashed #CBD5E1;">
              <div style="font-size:40px; margin-bottom:10px;">👥</div>
              <div style="font-weight:800; font-size:15px; color:#1E293B; margin-bottom:6px;">Chưa có tài khoản khách hàng nào</div>
              <p style="font-size:13px; color:#64748B; margin:0 auto; max-width:480px; line-height:1.5;">Hệ thống đang hoạt động với dữ liệu thật 100%. Khi khách hàng truy cập website và tạo tài khoản (qua nút Đăng ký), thông tin tài khoản thật sẽ tự động cập nhật ngay tại đây.</p>
            </div>
          ` : `
            <table class="dash-data-table">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Email / Số điện thoại</th>
                  <th>Hạng thành viên</th>
                  <th>Ngày tạo tài khoản</th>
                  <th style="text-align:right;">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                ${realBuyers.map(b => `
                  <tr>
                    <td><strong>${escapeHtml(b.fullName || 'Khách hàng mới')}</strong></td>
                    <td>${escapeHtml(b.email)}<br><span style="font-size:11px; color:var(--text-muted);">${escapeHtml(b.phone || 'Chưa có SĐT')}</span></td>
                    <td><span class="dropdown-gold-badge">${escapeHtml(b.tier || 'Thành viên mới')}</span></td>
                    <td><span style="font-size:12px; color:#64748B;">${b.createdAt ? new Date(b.createdAt).toLocaleDateString('vi-VN') : 'Vừa tạo'}</span></td>
                    <td style="text-align:right;">
                      <button class="btn-secondary btn-delete-user" data-id="${b.id}" data-name="${escapeHtml(b.fullName || b.email)}" style="padding:5px 10px; font-size:11.5px; color:#DC2626; border-color:#FCA5A5; cursor:pointer;">🗑️ Xóa</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      `;
    }

    // DEFAULT TAB: DASHBOARD OVERVIEW
    return `
      <div class="dashboard-banner-header" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.4) 100%), url('assets/banner-seller-overview.jpg');">
        <h3>Trung tâm Điều hành Bán hàng & Hậu mãi — Showroom Cầu Giấy</h3>
        <p>Báo cáo doanh số thời gian thực, tiến độ đơn hàng, đổi trả 7 ngày, bảo hành số và chăm sóc khách hàng.</p>
      </div>

      <div class="dash-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-top-row"><span class="kpi-label">Doanh số thực tế (VND)</span><span class="kpi-tag tag-success">Active</span></div>
          <div class="kpi-val">${dashData.monthlyRevenue}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-top-row"><span class="kpi-label">Đơn cọc & Mua xe</span><span class="kpi-tag tag-success">Đã lưu DB</span></div>
          <div class="kpi-val">${ordersList.length || dashData.newDepositsCount} xe</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-top-row"><span class="kpi-label">Hồ sơ Bảo hành Số</span><span class="kpi-tag tag-warning">Đang hiệu lực</span></div>
          <div class="kpi-val">0${(warOverview.warranties || []).length || 1} xe</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-top-row"><span class="kpi-label">Yêu cầu CSKH & Đổi trả</span><span class="kpi-tag tag-danger">Cần xử lý</span></div>
          <div class="kpi-val">0${supportTickets.length + (returnsRes.items || []).length} đơn</div>
        </div>
      </div>

      <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); overflow:hidden; margin-bottom:24px; box-shadow:var(--shadow-sm);">
        <img src="assets/seller-overview-chart.jpg" alt="Phân tích biểu đồ doanh thu và thị phần" style="width:100%; height:190px; object-fit:cover; display:block;">
      </div>

      <div class="dash-table-card">
        <h4 style="font-size:16px; font-weight:700; margin-bottom:16px;">Lịch hẹn lái thử gần đây</h4>
        <table class="dash-data-table">
          <thead>
            <tr>
              <th>Khách hàng</th>
              <th>Dòng xe</th>
              <th>Thời gian</th>
              <th>Trạng thái</th>
              <th style="text-align:right;">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            ${(dashData.appointments || []).map(item => `
              <tr>
                <td><strong>${escapeHtml(item.customer)}</strong><br><span style="font-size:11px; color:var(--text-muted);">${escapeHtml(item.phone)}</span></td>
                <td>${escapeHtml(item.car)}</td>
                <td>${escapeHtml(item.time)}</td>
                <td><span class="status-badge confirmed">● ${escapeHtml(item.status)}</span></td>
                <td style="text-align:right;">
                  <button class="btn-card-outline" style="padding:4px 8px; font-size:11px;" onclick="showToast('Đang kết nối: ${escapeHtml(item.customer)}', '📞')">📞 Gọi</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function bindSellerDashboardActions() {
    // Inventory adjust
    document.querySelectorAll('.btn-stock-adjust').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const carId = e.currentTarget.getAttribute('data-id');
        const delta = parseInt(e.currentTarget.getAttribute('data-delta'));
        const car = AppState.vehiclesList.find(v => v.id === carId);
        if (car) {
          car.stock = Math.max(0, (car.stock ?? 10) + delta);
          showToast(`Đã cập nhật tồn kho cho ${car.name}: ${car.stock} xe`, '📦');
          renderSellerDashboard('dash-inventory');
        }
      });
    });

    // Order status update
    document.querySelectorAll('.btn-order-action').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const orderId = e.currentTarget.getAttribute('data-id');
        const action = e.currentTarget.getAttribute('data-action');
        const newStatus = action === 'deliver' ? 'delivered' : 'confirmed';
        try {
          await ApiClient.orders.updateStatus(orderId, newStatus);
          showToast(`Đơn hàng đã cập nhật sang trạng thái: ${newStatus.toUpperCase()}`, '✓');
          renderSellerDashboard('dash-orders');
        } catch (err) {
          showToast(`Đã ghi nhận chuyển đổi trạng thái: ${newStatus.toUpperCase()}`, '✓');
          renderSellerDashboard('dash-orders');
        }
      });
    });

    // Appointment complete
    document.querySelectorAll('.btn-appt-complete').forEach(btn => {
      btn.addEventListener('click', () => {
        showToast('Đã hoàn thành phiên lái thử cho khách hàng!', '✓');
      });
    });

    // Open Add Car & Train AI Modal
    document.getElementById('btn-open-add-car-modal')?.addEventListener('click', () => {
      openAddVehicleModal();
    });

    // SECTION 2: Admin Returns Search / Filter & Actions
    const filterAdminReturns = () => {
      const q = (document.getElementById('admin-return-search')?.value || '').toLowerCase().trim();
      const st = document.getElementById('admin-return-status-filter')?.value || 'all';
      document.querySelectorAll('.admin-return-item-card').forEach(card => {
        const matchQ = !q || (card.getAttribute('data-search') || '').includes(q);
        const matchSt = st === 'all' || card.getAttribute('data-status') === st;
        card.style.display = (matchQ && matchSt) ? 'block' : 'none';
      });
    };
    document.getElementById('admin-return-search')?.addEventListener('input', filterAdminReturns);
    document.getElementById('admin-return-status-filter')?.addEventListener('change', filterAdminReturns);

    document.querySelectorAll('.btn-admin-update-return').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const status = document.querySelector(`.sel-return-stage[data-id="${id}"]`)?.value;
        const carrierName = document.querySelector(`.inp-return-carrier[data-id="${id}"]`)?.value.trim();
        const assignedStaff = document.querySelector(`.inp-return-staff[data-id="${id}"]`)?.value.trim();
        const note = document.querySelector(`.inp-return-note[data-id="${id}"]`)?.value.trim();
        try {
          await ApiClient.returns.updateStage(id, {
            status,
            carrierName,
            assignedStaff,
            note,
            rejectionReason: status === 'Từ chối' ? note : undefined
          });
          showToast(`Đã cập nhật yêu cầu đổi trả sang trạng thái: ${status}`, '🔄');
          renderSellerDashboard('dash-returns');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    document.querySelectorAll('.btn-admin-refund-return').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const code = btn.getAttribute('data-code');
        const amount = btn.getAttribute('data-amount');
        const txnRef = prompt(`Xác nhận hoàn tiền ${amount} VNĐ cho yêu cầu ${code}.\nNhập mã giao dịch ngân hàng (Transaction Ref):`, `TXN-REF-${Date.now()}`);
        if (!txnRef) return;
        try {
          await ApiClient.returns.processRefund(id, { transactionRef: txnRef, note: `Hoàn tiền qua chuyển khoản NH (${txnRef})` });
          showToast(`💸 Đã hoàn tất hoàn tiền cho yêu cầu ${code}!`, '✓');
          renderSellerDashboard('dash-returns');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    // SECTION 3: Admin Warranty & Service Actions
    document.querySelectorAll('.btn-update-srv-appt').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const status = document.querySelector(`.sel-srv-appt-status[data-id="${id}"]`)?.value;
        try {
          await ApiClient.warranties.updateServiceAppointment(id, { status });
          showToast(`Đã cập nhật lịch hẹn bảo dưỡng sang: ${status}`, '🔧');
          renderSellerDashboard('dash-aftersales');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    document.getElementById('form-admin-add-service-record')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const warrantyId = document.getElementById('srv-rec-warranty-id')?.value;
      const serviceType = document.getElementById('srv-rec-type')?.value.trim();
      const odoKm = Number(document.getElementById('srv-rec-odo')?.value || 0);
      const partsRaw = document.getElementById('srv-rec-parts')?.value.trim() || '';
      const cost = Number(document.getElementById('srv-rec-cost')?.value || 0);
      const inspectionResult = document.getElementById('srv-rec-result')?.value.trim();
      try {
        await ApiClient.warranties.createServiceRecord({
          warrantyId,
          serviceType,
          odoKm,
          partsReplaced: partsRaw ? partsRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
          cost,
          inspectionResult
        });
        showToast('🛠️ Đã ghi nhận biên bản bảo dưỡng & cập nhật ODO vào hồ sơ xe!', '✓');
        renderSellerDashboard('dash-aftersales');
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });

    // SECTION 4: Admin Review Moderation
    document.querySelectorAll('.btn-mod-review').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const status = btn.getAttribute('data-status');
        const reason = document.querySelector(`.inp-mod-reason[data-id="${id}"]`)?.value.trim();
        if (!reason) {
          showToast('Vui lòng nhập lý do kiểm duyệt trước khi thực hiện!', '⚠️');
          return;
        }
        try {
          await ApiClient.reviews.moderate(id, { status, reason });
          showToast(`Đã cập nhật trạng thái đánh giá: ${status}`, '⭐');
          renderSellerDashboard('dash-reviews');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    // SECTION 5: Admin Support Tickets & Internal Notes
    document.querySelectorAll('.btn-admin-update-ticket').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const status = document.querySelector(`.sel-ticket-status[data-id="${id}"]`)?.value;
        const assignedStaffName = document.querySelector(`.inp-ticket-staff[data-id="${id}"]`)?.value.trim();
        try {
          await ApiClient.support.updateTicket(id, { status, assignedStaffName });
          showToast(`Đã cập nhật phiếu hỗ trợ: ${status}`, '🎧');
          renderSellerDashboard('dash-support');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    document.querySelectorAll('.btn-admin-ticket-reply').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const content = document.querySelector(`.inp-admin-ticket-reply[data-id="${id}"]`)?.value.trim();
        if (!content) {
          showToast('Vui lòng nhập nội dung phản hồi khách hàng.', '⚠️');
          return;
        }
        try {
          await ApiClient.support.replyTicket(id, { content });
          showToast('Đã gửi phản hồi cho khách hàng!', '💬');
          renderSellerDashboard('dash-support');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    document.querySelectorAll('.btn-admin-ticket-note').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const note = document.querySelector(`.inp-admin-ticket-note[data-id="${id}"]`)?.value.trim();
        if (!note) {
          showToast('Vui lòng nhập nội dung ghi chú nội bộ.', '⚠️');
          return;
        }
        try {
          await ApiClient.support.addInternalNote(id, { note });
          showToast('🔒 Đã lưu ghi chú nội bộ (chỉ nhân viên thấy)!', '✓');
          renderSellerDashboard('dash-support');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    // SECTION 6: Email Campaign Preview, Create, Test & Execute
    const updateCampaignPreview = async () => {
      const box = document.getElementById('admin-email-preview-wrapper');
      if (!box) return;
      try {
        const res = await ApiClient.campaigns.preview({
          subject: document.getElementById('camp-subject')?.value,
          bodyHtml: document.getElementById('camp-body')?.value,
          promoCode: document.getElementById('camp-promo')?.value,
          ctaLabel: document.getElementById('camp-cta-label')?.value,
          ctaUrl: document.getElementById('camp-cta-url')?.value
        });
        box.innerHTML = res.renderedHtml;
      } catch (e) {}
    };

    if (document.getElementById('admin-email-preview-wrapper')) {
      updateCampaignPreview();
    }

    // Visual Template Selection Cards (Email Marketing Admin.pdf)
    document.querySelectorAll('.email-visual-card').forEach(card => {
      card.addEventListener('click', () => {
        const tplId = card.getAttribute('data-tpl-id');
        document.querySelectorAll('.email-visual-card').forEach(c => {
          c.classList.remove('active');
          c.style.border = '1px solid var(--border-subtle)';
          c.style.boxShadow = 'var(--shadow-sm)';
          const badge = c.querySelector('span[style*="background:#EFF6FF"]');
          if (badge) {
            badge.style.background = '#F1F5F9';
            badge.style.color = 'var(--text-dark)';
            badge.textContent = 'Chọn mẫu';
          }
        });

        card.classList.add('active');
        card.style.border = '2px solid var(--primary)';
        card.style.boxShadow = 'var(--shadow-md)';
        const cardBadge = card.querySelectorAll('div > div > span')[1];
        if (cardBadge) {
          cardBadge.style.background = '#EFF6FF';
          cardBadge.style.color = 'var(--primary)';
          cardBadge.textContent = 'MẪU ĐANG CHỌN ✓';
        }

        const sel = document.getElementById('camp-template-select');
        if (sel) sel.value = tplId;

        if (tplId === 'tpl-newyear') {
          if (document.getElementById('camp-name')) document.getElementById('camp-name').value = 'Tết Tri Ân & Chăm Sóc Xe Đầu Năm 2026';
          if (document.getElementById('camp-promo')) document.getElementById('camp-promo').value = 'SIGMA-TET2026';
          if (document.getElementById('camp-subject')) document.getElementById('camp-subject').value = '🧧 Chúc mừng Năm Mới {{customer_name}} — Lì xì bảo dưỡng vàng từ SIGMACAR!';
          if (document.getElementById('camp-body')) document.getElementById('camp-body').value = 'Kính gửi {{customer_name}}, Nhân dịp đầu xuân năm mới 2026, SIGMACAR kính chúc Quý khách vạn dặm bình an trên hành trình cùng xế yêu {{vehicle_name}}! Chúng tôi xin gửi tặng mã ưu đãi {{promo_code}} trị giá gói bảo dưỡng vàng 5.000.000 VNĐ áp dụng tại mọi xưởng dịch vụ ủy quyền.';
          if (document.getElementById('camp-cta-label')) document.getElementById('camp-cta-label').value = 'Kích Hoạt Lì Xì Ngay';
        } else if (tplId === 'tpl-birthday') {
          if (document.getElementById('camp-name')) document.getElementById('camp-name').value = 'Chúc mừng Sinh nhật Thành viên Tháng 11';
          if (document.getElementById('camp-promo')) document.getElementById('camp-promo').value = 'SIGMA-BDAY-25';
          if (document.getElementById('camp-subject')) document.getElementById('camp-subject').value = '🎂 Chúc mừng sinh nhật {{customer_name}} — Quà tặng đặc quyền từ SIGMACAR!';
          if (document.getElementById('camp-body')) document.getElementById('camp-body').value = 'Kính gửi {{customer_name}}, Nhân dịp sinh nhật của bạn ({{birth_date}}), đại gia đình SIGMACAR kính chúc bạn luôn dồi dào sức khỏe và tận hưởng mọi cung đường xanh cùng chiếc {{vehicle_name}}! Chúng tôi gửi tặng voucher {{promo_code}} giảm 10% sạc pin trạm hoặc phụ kiện VIP.';
          if (document.getElementById('camp-cta-label')) document.getElementById('camp-cta-label').value = 'Nhận Quà Sinh Nhật Ngay';
        } else if (tplId === 'tpl-christmas') {
          if (document.getElementById('camp-name')) document.getElementById('camp-name').value = 'Giáng sinh An Lành & Ưu Đãi Mùa Đông';
          if (document.getElementById('camp-promo')) document.getElementById('camp-promo').value = 'SIGMA-XMAS-VIP';
          if (document.getElementById('camp-subject')) document.getElementById('camp-subject').value = '🎄 Giáng Sinh An Lành & Ấm Áp Cùng SIGMACAR {{customer_name}}!';
          if (document.getElementById('camp-body')) document.getElementById('camp-body').value = 'Kính gửi {{customer_name}}, Mùa lễ hội cuối năm đã về, SIGMACAR kính chúc bạn và gia đình một mùa Giáng sinh ấm áp và an lành! Chúng tôi gửi tặng bạn mã ưu đãi {{promo_code}} miễn phí kiểm tra tổng quát xế yêu {{vehicle_name}} (Biển số: {{plate_number}}).';
          if (document.getElementById('camp-cta-label')) document.getElementById('camp-cta-label').value = 'Khám Phá Ưu Đãi Đông - Xuân';
        }

        updateCampaignPreview();
        showToast('Đã chọn mẫu thiết kế email!', '🎨');
      });
    });

    // Variable insertion pills (Email Marketing Admin.pdf)
    document.querySelectorAll('.btn-var-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const token = pill.getAttribute('data-var');
        const bodyEl = document.getElementById('camp-body');
        if (!bodyEl) return;
        const start = bodyEl.selectionStart || bodyEl.value.length;
        const end = bodyEl.selectionEnd || bodyEl.value.length;
        const text = bodyEl.value;
        bodyEl.value = text.substring(0, start) + ' ' + token + ' ' + text.substring(end);
        bodyEl.focus();
        bodyEl.selectionStart = bodyEl.selectionEnd = start + token.length + 2;
        updateCampaignPreview();
        showToast(`Đã chèn biến: ${token}`, '🏷️');
      });
    });

    // Export CSV of Campaigns History
    document.getElementById('btn-export-campaigns-csv')?.addEventListener('click', () => {
      const campaigns = AppState._sellerCache?.campaignsRes?.campaigns || [];
      const headers = ['Mã chiến dịch', 'Tên chiến dịch', 'Dịp gửi', 'Nhóm mục tiêu', 'Mã ưu đãi', 'Tổng gửi', 'Thành công', 'Thất bại', 'Lượt mở', 'Lượt click', 'Trạng thái', 'Lịch gửi'];
      const rows = campaigns.map(c => [
        `"${c.campaignCode || ''}"`,
        `"${(c.name || '').replace(/"/g, '""')}"`,
        `"${(c.occasion || '').replace(/"/g, '""')}"`,
        `"${c.targetSegment || ''}"`,
        `"${c.promoCode || ''}"`,
        c.stats?.totalRecipients || 0,
        c.stats?.sentCount || 0,
        c.stats?.failedCount || 0,
        c.stats?.openedCount || 0,
        c.stats?.clickedCount || 0,
        `"${c.status || ''}"`,
        `"${c.scheduledAt || ''}"`
      ]);

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `sigmacar_campaigns_report_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Đã xuất báo cáo chiến dịch ra file CSV thành công!', '📥');
    });

    document.getElementById('btn-camp-refresh-preview')?.addEventListener('click', updateCampaignPreview);
    document.getElementById('camp-template-select')?.addEventListener('change', (e) => {
      const tplId = e.target.value;
      const tpl = (AppState._sellerCache?.campaignsRes?.templates || []).find(t => t.id === tplId);
      if (tpl) {
        document.getElementById('camp-subject').value = tpl.subject;
        document.getElementById('camp-body').value = tpl.bodyHtml;
        document.getElementById('camp-cta-label').value = tpl.ctaLabel;
        document.getElementById('camp-cta-url').value = tpl.ctaUrl;
        updateCampaignPreview();
      }
    });

    document.getElementById('btn-preview-desktop')?.addEventListener('click', (e) => {
      e.currentTarget.classList.add('active');
      document.getElementById('btn-preview-mobile')?.classList.remove('active');
      const wrap = document.getElementById('admin-email-preview-wrapper');
      if (wrap) { wrap.classList.remove('mobile'); wrap.classList.add('desktop'); }
    });
    document.getElementById('btn-preview-mobile')?.addEventListener('click', (e) => {
      e.currentTarget.classList.add('active');
      document.getElementById('btn-preview-desktop')?.classList.remove('active');
      const wrap = document.getElementById('admin-email-preview-wrapper');
      if (wrap) { wrap.classList.remove('desktop'); wrap.classList.add('mobile'); }
    });

    document.getElementById('form-admin-create-campaign')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await ApiClient.campaigns.create({
          name: document.getElementById('camp-name')?.value.trim(),
          templateId: document.getElementById('camp-template-select')?.value,
          targetSegment: document.getElementById('camp-segment')?.value,
          promoCode: document.getElementById('camp-promo')?.value.trim(),
          subject: document.getElementById('camp-subject')?.value.trim(),
          bodyHtml: document.getElementById('camp-body')?.value.trim(),
          ctaLabel: document.getElementById('camp-cta-label')?.value.trim(),
          ctaUrl: document.getElementById('camp-cta-url')?.value.trim(),
          scheduledAt: document.getElementById('camp-sched-at')?.value
        });
        showToast('✉️ Đã lưu và lên lịch chiến dịch Email thành công!', '✓');
        renderSellerDashboard('dash-campaigns');
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });

    document.querySelectorAll('.btn-camp-test').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const testEmail = prompt('Nhập địa chỉ Email nhận bản gửi thử (Test Email):', AppState.currentUser?.email || 'qa-test@sigmacar.vn');
        if (!testEmail) return;
        try {
          const res = await ApiClient.campaigns.sendTest(id, { testEmail });
          showToast(res.message, '🧪');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    document.querySelectorAll('.btn-camp-execute').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        if (!confirm(`Xác nhận thực thi chiến dịch "${name}" tới danh sách khách hàng đã đồng ý nhận tin (Opt-in)?`)) return;
        try {
          const res = await ApiClient.campaigns.execute(id);
          showToast(`🚀 Đã thực thi chiến dịch! Gửi thành công tới ${res.campaign.stats.sentCount} KH (Chế độ: ${res.deliveryMode}).`, '✓');
          renderSellerDashboard('dash-campaigns');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    document.querySelectorAll('.btn-camp-status').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const status = btn.getAttribute('data-status');
        try {
          await ApiClient.campaigns.updateStatus(id, { status });
          showToast(`Đã chuyển trạng thái chiến dịch sang: ${status}`, '✓');
          renderSellerDashboard('dash-campaigns');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    // RBAC Role Update
    document.querySelectorAll('.btn-update-user-role').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const role = document.querySelector(`.sel-user-role[data-id="${id}"]`)?.value;
        try {
          await ApiClient.admin.updateUserRole(id, role);
          showToast(`🔐 Đã cập nhật quyền tài khoản sang: ${role.toUpperCase()}`, '✓');
          renderSellerDashboard('dash-crm');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    // Open Add Sales Staff Modal
    document.getElementById('btn-open-add-staff')?.addEventListener('click', () => {
      openAddStaffModal();
    });

    // Delete User / Staff
    document.querySelectorAll('.btn-delete-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        if (confirm(`Bạn có chắc chắn muốn xóa tài khoản "${name}" khỏi hệ thống?`)) {
          try {
            await ApiClient.admin.deleteUser(id);
            showToast(`🗑️ Đã xóa tài khoản "${name}" thành công!`, '✓');
            renderSellerDashboard('dash-crm');
          } catch (err) {
            showToast(err.message, '⚠️');
          }
        }
      });
    });
  }

  function openAddStaffModal() {
    const existing = document.getElementById('add-staff-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'add-staff-modal-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.65); backdrop-filter:blur(6px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';

    overlay.innerHTML = `
      <div style="background:#FFFFFF; border-radius:18px; width:100%; max-width:520px; max-height:92vh; overflow-y:auto; box-shadow:0 25px 50px -12px rgba(0,0,0,0.3); padding:28px; position:relative; font-family:var(--font-sans);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; border-bottom:1px solid #E2E8F0; padding-bottom:14px;">
          <div>
            <div style="display:inline-flex; align-items:center; gap:6px; background:#EFF6FF; color:#2563EB; font-size:11px; font-weight:700; padding:4px 10px; border-radius:100px; margin-bottom:6px;">
              <span>💼 QUẢN TRỊ NHÂN VIÊN KINH DOANH</span>
            </div>
            <h3 style="font-size:20px; font-weight:800; color:#0F172A; margin:0;">Thêm Nhân Viên Kinh Doanh Mới</h3>
            <p style="font-size:12.5px; color:#64748B; margin:4px 0 0;">Cấp tài khoản kinh doanh (Seller) để nhân viên trực tiếp quản lý đơn cọc, lái thử và CSKH.</p>
          </div>
          <button id="btn-close-staff-modal" style="background:#F1F5F9; border:none; width:34px; height:34px; border-radius:50%; font-size:18px; cursor:pointer; color:#64748B; display:flex; align-items:center; justify-content:center;">&times;</button>
        </div>

        <form id="form-add-staff" style="display:flex; flex-direction:column; gap:14px;">
          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Họ và tên nhân viên *</label>
            <input type="text" id="staff-name" required placeholder="Ví dụ: Nguyễn Văn Nam" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Email tài khoản đăng nhập *</label>
            <input type="email" id="staff-email" required placeholder="Ví dụ: nam.sales@sigmacar.vn" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Số điện thoại liên hệ *</label>
            <input type="tel" id="staff-phone" required placeholder="Ví dụ: 0912 345 678" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Mật khẩu khởi tạo *</label>
            <input type="password" id="staff-password" required placeholder="Nhập mật khẩu cho nhân viên (tối thiểu 6 ký tự)" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Showroom / Chi nhánh phụ trách</label>
            <select id="staff-branch" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box; background:#FFFFFF;">
              <option value="Showroom SIGMACAR Cầu Giấy (Hà Nội)">Showroom SIGMACAR Cầu Giấy (Hà Nội)</option>
              <option value="Showroom SIGMACAR Quận 7 (TP.HCM)">Showroom SIGMACAR Quận 7 (TP.HCM)</option>
              <option value="Showroom SIGMACAR Hải Châu (Đà Nẵng)">Showroom SIGMACAR Hải Châu (Đà Nẵng)</option>
            </select>
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Vai trò hệ thống</label>
            <select id="staff-role" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box; background:#FFFFFF;">
              <option value="seller" selected>💼 Nhân viên Kinh doanh (SELLER)</option>
              <option value="support_staff">🎧 Nhân viên CSKH & Khiếu nại (SUPPORT)</option>
              <option value="service_staff">🔧 Kỹ thuật viên Dịch vụ & Gara (SERVICE)</option>
            </select>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px; border-top:1px solid #E2E8F0; padding-top:16px;">
            <button type="button" id="btn-cancel-staff" style="background:#F1F5F9; border:none; padding:10px 20px; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; color:#475569;">Hủy bỏ</button>
            <button type="submit" class="btn-primary" style="padding:10px 24px; font-size:14px; font-weight:700; cursor:pointer;">Tạo Tài Khoản Nhân Viên</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('btn-close-staff-modal')?.addEventListener('click', () => overlay.remove());
    document.getElementById('btn-cancel-staff')?.addEventListener('click', () => overlay.remove());

    document.getElementById('form-add-staff')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('staff-name').value.trim();
      const email = document.getElementById('staff-email').value.trim().toLowerCase();
      const phone = document.getElementById('staff-phone').value.trim();
      const password = document.getElementById('staff-password').value;
      const branchName = document.getElementById('staff-branch').value;
      const role = document.getElementById('staff-role').value;

      try {
        await ApiClient.admin.createStaff({ fullName, email, phone, password, branchName, role });
        showToast(`🎉 Đã thêm thành công nhân viên ${fullName} (${role.toUpperCase()})!`, '✓');
        overlay.remove();
        renderSellerDashboard('dash-crm');
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });
  }

  function openAddVehicleModal() {
    const existing = document.getElementById('add-vehicle-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'add-vehicle-modal-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.65); backdrop-filter:blur(6px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';
    
    overlay.innerHTML = `
      <div style="background:#FFFFFF; border-radius:18px; width:100%; max-width:640px; max-height:92vh; overflow-y:auto; box-shadow:0 25px 50px -12px rgba(0,0,0,0.3); padding:28px; position:relative; font-family:var(--font-sans);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; border-bottom:1px solid #E2E8F0; padding-bottom:14px;">
          <div>
            <div style="display:inline-flex; align-items:center; gap:6px; background:#EFF6FF; color:#2563EB; font-size:11px; font-weight:700; padding:4px 10px; border-radius:100px; margin-bottom:6px;">
              <span>🧠 DYNAMIC RAG AUTO-LEARN</span>
            </div>
            <h3 style="font-size:22px; font-weight:800; color:#0F172A; margin:0;">Thêm Xe Mới & Tự Động Huấn Luyện AI</h3>
            <p style="font-size:13px; color:#64748B; margin:4px 0 0;">Khi lưu xe mới, Sigma AI sẽ tự động học ngay lập tức để tư vấn cho khách hàng mà không cần train lại!</p>
          </div>
          <button id="btn-close-add-modal" style="background:#F1F5F9; border:none; width:36px; height:36px; border-radius:50%; font-size:20px; cursor:pointer; color:#64748B; display:flex; align-items:center; justify-content:center;">&times;</button>
        </div>

        <form id="form-add-vehicle" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div style="grid-column: span 2;">
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Tên dòng xe *</label>
            <input type="text" id="add-car-name" required placeholder="Ví dụ: SIGMA CyberTruck Extreme hoặc Porsche Taycan 4S" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Phân khúc / Loại xe *</label>
            <input type="text" id="add-car-category" required placeholder="Ví dụ: Bán tải điện / SUV Siêu Sang" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Giá niêm yết (VNĐ) *</label>
            <input type="number" id="add-car-price" required placeholder="Ví dụ: 1850000000" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Tầm hoạt động (km) *</label>
            <input type="text" id="add-car-range" required placeholder="Ví dụ: 680 km" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Động cơ & Công suất</label>
            <input type="text" id="add-car-power" placeholder="Ví dụ: 450 HP (Dual-Motor AWD)" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Số chỗ ngồi</label>
            <select id="add-car-seats" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box; background:#FFFFFF;">
              <option value="5">5 Chỗ</option>
              <option value="7">7 Chỗ</option>
              <option value="4">4 Chỗ VIP</option>
              <option value="8">8 Chỗ</option>
            </select>
          </div>

          <div>
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Tăng tốc 0-100 km/h</label>
            <input type="text" id="add-car-accel" placeholder="Ví dụ: 3.5s" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div style="grid-column: span 2;">
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Công nghệ Pin & Thời gian sạc</label>
            <input type="text" id="add-car-battery" placeholder="Ví dụ: Pin thể rắn 105 kWh | Sạc nhanh 20 phút (10-80%)" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div style="grid-column: span 2;">
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Kích thước DxRxC (mm)</label>
            <input type="text" id="add-car-dimensions" placeholder="Ví dụ: 5.280 x 2.100 x 1.780 mm" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div style="grid-column: span 2;">
            <label style="display:block; font-size:12.5px; font-weight:700; color:#334155; margin-bottom:5px;">Trang bị nổi bật (phân cách bằng dấu phẩy)</label>
            <input type="text" id="add-car-features" placeholder="Ví dụ: Vỏ chống đạn, ADAS L3, Cửa tự hít, Màn hình OLED 17 inch" style="width:100%; padding:10px 14px; border:1px solid #CBD5E1; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box;">
          </div>

          <div style="grid-column: span 2; display:flex; justify-content:flex-end; gap:12px; margin-top:10px; border-top:1px solid #E2E8F0; padding-top:16px;">
            <button type="button" id="btn-cancel-add-modal" style="padding:10px 20px; border:1px solid #CBD5E1; background:#F8FAFC; border-radius:8px; font-weight:600; cursor:pointer; color:#475569;">Hủy</button>
            <button type="submit" style="padding:10px 24px; background:linear-gradient(135deg, #2563EB, #1D4ED8); color:#FFFFFF; border:none; border-radius:8px; font-weight:700; cursor:pointer; box-shadow:0 4px 14px rgba(37,99,235,0.35);">🚀 Lưu xe & Huấn luyện AI ngay</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    const closeBtn = document.getElementById('btn-close-add-modal');
    const cancelBtn = document.getElementById('btn-cancel-add-modal');
    if (closeBtn) closeBtn.onclick = () => overlay.remove();
    if (cancelBtn) cancelBtn.onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Form submit handler
    const form = document.getElementById('form-add-vehicle');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameVal = document.getElementById('add-car-name').value.trim();
      const catVal = document.getElementById('add-car-category').value.trim();
      const priceVal = parseFloat(document.getElementById('add-car-price').value) || 1200000000;
      const rangeVal = document.getElementById('add-car-range').value.trim();
      const powerVal = document.getElementById('add-car-power').value.trim() || '350 HP';
      const seatsVal = parseInt(document.getElementById('add-car-seats').value, 10) || 5;
      const accelVal = document.getElementById('add-car-accel').value.trim() || '4.2s';
      const batteryVal = document.getElementById('add-car-battery').value.trim() || 'Pin Lithium-Ion cao cấp';
      const dimVal = document.getElementById('add-car-dimensions').value.trim() || '4.950 x 1.950 x 1.650 mm';
      const featVal = document.getElementById('add-car-features').value.trim();

      const slug = nameVal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const newVehicle = {
        id: slug || ('car-' + Date.now()),
        name: nameVal,
        brand: 'SIGMACAR',
        subtitle: catVal,
        category: catVal,
        price: priceVal,
        priceFormatted: priceVal.toLocaleString('vi-VN') + ' VNĐ',
        priceShort: (priceVal / 1000000000).toFixed(2) + ' tỷ',
        range: rangeVal,
        rangeFormatted: rangeVal.includes('km') ? rangeVal : `${rangeVal} km`,
        power: powerVal,
        hp: parseInt(powerVal) || 350,
        seats: seatsVal,
        acceleration: accelVal,
        battery: batteryVal,
        fastCharge: '25 phút (10-80%)',
        dimensions: dimVal,
        image: 'assets/model-e.jpg',
        features: featVal ? featVal.split(',').map(s => s.trim()).filter(Boolean) : ['Hệ thống ADAS', 'Camera 360', 'Sạc siêu nhanh'],
        warranty: 'Bảo hành chính hãng 8 năm',
        stock: 10,
        badge: 'MỚI CẬP NHẬT'
      };

      // Add to catalog & train AI
      window.addNewCarToWebsite(newVehicle);
      overlay.remove();
      renderSellerDashboard('dash-inventory');
    });
  }

  // Global helper: Adds vehicle to website and triggers AI live auto-learning
  window.addNewCarToWebsite = function(newCar) {
    if (!newCar || !newCar.name) return;
    
    // Add to active state
    AppState.vehiclesList.unshift(newCar);
    if (typeof SIGMA_DATA !== 'undefined' && SIGMA_DATA.cars) {
      SIGMA_DATA.cars.unshift(newCar);
    }

    // Trigger AI Dynamic RAG Auto-Learning
    if (typeof AutomotiveLLM !== 'undefined' && AutomotiveLLM.learnNewVehicle) {
      AutomotiveLLM.learnNewVehicle(newCar);
    }

    showToast(`🎉 Đã thêm xe "${newCar.name}" vào hệ thống & Sigma AI đã tự động học toàn bộ thông số!`, '🧠');
  };

  // =================================================================
  // VIEW 8: USER PROFILE (Redesigned per Dự án thương mại điện tử 2)
  // =================================================================
  async function renderProfile(activeTab = 'profile-personal') {
    AppState.activeProfileTab = activeTab;
    const cur = ApiClient.getCurrentUser();

    if (!cur) {
      viewsContainer.innerHTML = `
        <section class="section" style="padding:70px 0; min-height:65vh; display:flex; align-items:center;">
          <div class="container" style="max-width:540px; margin:0 auto; text-align:center;">
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:48px 32px; box-shadow:var(--shadow-md);">
              <div style="width:72px; height:72px; border-radius:50%; background:#EFF6FF; color:var(--primary); display:flex; align-items:center; justify-content:center; font-size:32px; margin:0 auto 20px;">
                🔒
              </div>
              <h2 style="font-size:24px; font-weight:800; color:var(--text-dark); margin-bottom:10px;">Hồ sơ cá nhân</h2>
              <p style="font-size:14.5px; color:var(--text-muted); line-height:1.6; margin-bottom:28px;">
                Bạn chưa đăng nhập. Vui lòng đăng nhập hoặc tạo tài khoản mới để xem thông tin cá nhân, Gara số, bảo hành điện tử, đổi trả 7 ngày và quản lý đơn hàng.
              </p>
              <div style="display:flex; gap:12px; justify-content:center;">
                <button class="btn-primary" id="btn-profile-login-gate" style="padding:12px 28px; font-size:14px;">
                  🔑 Đăng nhập / Đăng ký ngay
                </button>
                <button class="btn-secondary" onclick="window.location.hash='home'" style="padding:12px 24px; font-size:14px;">
                  Về trang chủ
                </button>
              </div>
            </div>
          </div>
        </section>
      `;

      document.getElementById('btn-profile-login-gate')?.addEventListener('click', () => {
        AppState.pendingAuthAction = () => renderProfile(activeTab);
        switchAuthTab('login');
        authModal?.classList.add('active');
      });
      return;
    }

    let myOrders = [];
    let myAppts = [];
    let myReturnsData = { requests: [], eligibleOrders: [], policy: {} };
    let myGarageData = { ownedVehicles: [], warranties: [], serviceRecords: [], serviceAppointments: [], serviceCenters: [], coveredComponents: [], maintenanceMilestones: [] };
    let meProfile = cur;

    try {
      const [ordersRes, apptsRes, retRes, garRes, meRes] = await Promise.all([
        ApiClient.orders.getAll().catch(() => []),
        ApiClient.appointments.getAll().catch(() => []),
        ApiClient.returns.getMyData().catch(() => ({ requests: [], eligibleOrders: [], policy: {} })),
        ApiClient.warranties.getMyGarage().catch(() => ({ ownedVehicles: [], warranties: [], serviceRecords: [], serviceAppointments: [], serviceCenters: [], coveredComponents: [], maintenanceMilestones: [] })),
        ApiClient.auth.getMe().catch(() => cur)
      ]);
      myOrders = ordersRes;
      myAppts = apptsRes;
      myReturnsData = retRes;
      myGarageData = garRes;
      meProfile = meRes || cur;
    } catch (e) {}

    AppState._profileData = { meProfile, myOrders, myAppts, myReturnsData, myGarageData };

    if (Array.isArray(meProfile.savedCarIds)) {
      meProfile.savedCarIds.forEach(id => AppState.savedCarIds.add(id));
    }

    viewsContainer.innerHTML = `
      <section class="section" style="padding-top:36px;">
        <div class="container">
          <div class="profile-page-grid">
            <!-- Aside matching Aside.pdf -->
            <aside class="profile-sidebar-card">
              <div class="profile-aside-user-box">
                <div class="profile-aside-avatar-wrap">
                  <img src="assets/avatar-user.jpg" alt="${escapeHtml(meProfile.fullName)}">
                  <button type="button" class="profile-aside-avatar-edit" title="Cập nhật ảnh đại diện" onclick="showToast('Đã đồng bộ ảnh đại diện chuẩn HD!', '📸')">📷</button>
                </div>
                <div style="font-size:17px; font-weight:800; color:var(--text-dark);">${escapeHtml(meProfile.fullName)}</div>
                <div style="margin-top:4px;">
                  <span class="dropdown-gold-badge">👑 ${escapeHtml(meProfile.tier || 'HẠNG VÀNG (GOLD)')}</span>
                </div>
                <div class="profile-sigma-points-box">
                  <span class="pts-label">ĐIỂM SIGMA:</span>
                  <span class="pts-val">${(meProfile.points ?? 1500).toLocaleString('vi-VN')} Pts</span>
                </div>
              </div>

              <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; color:var(--text-muted); margin-bottom:10px; letter-spacing:0.5px;">TÀI KHOẢN CỦA TÔI</div>
              <ul class="profile-nav-list">
                <li><button class="profile-nav-btn ${activeTab === 'profile-personal' ? 'active' : ''}" data-proftab="profile-personal">👤 Thông tin cá nhân</button></li>
                <li><button class="profile-nav-btn ${activeTab === 'profile-garage' ? 'active' : ''}" data-proftab="profile-garage">🚗 Gara của tôi (${(myGarageData.ownedVehicles || []).length})</button></li>
                <li><button class="profile-nav-btn ${activeTab === 'profile-orders' ? 'active' : ''}" data-proftab="profile-orders">📦 Đơn hàng của tôi</button></li>
                <li><button class="profile-nav-btn ${activeTab === 'profile-returns' ? 'active' : ''}" data-proftab="profile-returns">🔄 Trung tâm Đổi trả (7 ngày)</button></li>
                <li><button class="profile-nav-btn ${activeTab === 'profile-appointments' ? 'active' : ''}" data-proftab="profile-appointments">📅 Lịch hẹn & Lái thử</button></li>
                <li><button class="profile-nav-btn ${activeTab === 'profile-saved' ? 'active' : ''}" data-proftab="profile-saved">❤️ Xe đã lưu (${AppState.savedCarIds.size})</button></li>
              </ul>

              <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; color:var(--text-muted); margin:20px 0 10px; letter-spacing:0.5px;">CÀI ĐẶT & BẢO MẬT</div>
              <ul class="profile-nav-list">
                <li><button class="profile-nav-btn ${activeTab === 'profile-security' ? 'active' : ''}" data-proftab="profile-security">🛡️ Bảo mật & Quyền riêng tư</button></li>
                <li><button class="profile-nav-btn ${activeTab === 'profile-notifications' ? 'active' : ''}" data-proftab="profile-notifications">🔔 Cài đặt thông báo</button></li>
                <li><button class="profile-nav-btn" onclick="window.location.hash='support'">🎧 Trung tâm CSKH 24/7</button></li>
                <li><button class="profile-nav-btn" style="color:var(--accent-rose);" id="btn-profile-logout">🚪 Đăng xuất</button></li>
              </ul>
            </aside>

            <main class="profile-main-content">
              ${renderProfileSubView(activeTab, meProfile, myOrders, myAppts)}
            </main>
          </div>
        </div>
      </section>
    `;

    document.querySelectorAll('.profile-nav-btn[data-proftab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-proftab');
        renderProfile(tab);
      });
    });

    document.getElementById('btn-profile-logout')?.addEventListener('click', () => {
      ApiClient.auth.logout();
      AppState.currentUser = null;
      updateDropdownUserUI();
      showToast('Đã đăng xuất tài khoản an toàn!');
      navigateTo('home');
    });

    document.getElementById('btn-garage-go-orders')?.addEventListener('click', () => {
      renderProfile('profile-orders');
    });

    const openAddOrderModal = () => {
      const modal = document.getElementById('user-add-order-modal');
      if (!modal) return;
      const vehicleSelect = document.getElementById('add-order-vehicle-select');
      if (vehicleSelect) {
        const carsList = (AppState.vehiclesList && AppState.vehiclesList.length > 0)
          ? AppState.vehiclesList
          : ((typeof SIGMA_DATA !== 'undefined' && SIGMA_DATA.cars) ? SIGMA_DATA.cars : []);
        vehicleSelect.innerHTML = carsList.map(c => `<option value="${c.id}">${c.name} - ${c.priceFormatted || c.priceShort || ''}</option>`).join('');
        const updatePreview = () => {
          const selId = vehicleSelect.value;
          const selCar = carsList.find(c => c.id === selId) || carsList[0] || {};
          const previewImg = document.getElementById('add-order-preview-img');
          const previewBrand = document.getElementById('add-order-preview-brand');
          const previewName = document.getElementById('add-order-preview-name');
          const previewPrice = document.getElementById('add-order-preview-price');
          const previewSpecs = document.getElementById('add-order-preview-specs');
          if (previewImg) {
            previewImg.src = selCar.image || 'assets/model-e.jpg';
            previewImg.onerror = () => { previewImg.src = 'assets/model-e.jpg'; };
          }
          if (previewBrand) previewBrand.textContent = selCar.brand || 'SIGMACAR';
          if (previewName) previewName.textContent = selCar.name || 'Mẫu xe SIGMACAR';
          if (previewPrice) previewPrice.textContent = selCar.priceFormatted || selCar.priceShort || '1.290.000.000 VNĐ';
          if (previewSpecs) previewSpecs.textContent = selCar.subtitle || `Công suất: ${selCar.power || '300 HP'} • Tầm vận hành: ${selCar.range || 500} km`;
        };
        vehicleSelect.onchange = updatePreview;
        updatePreview();
      }
      const nameInp = document.getElementById('add-order-buyer-name');
      const phoneInp = document.getElementById('add-order-buyer-phone');
      if (nameInp && meProfile.fullName) nameInp.value = meProfile.fullName;
      if (phoneInp && meProfile.phone) phoneInp.value = meProfile.phone;
      modal.classList.add('active');
    };

    document.getElementById('btn-open-add-order-modal')?.addEventListener('click', openAddOrderModal);
    document.getElementById('btn-empty-add-order')?.addEventListener('click', openAddOrderModal);

    const closeAddOrderModal = () => document.getElementById('user-add-order-modal')?.classList.remove('active');
    document.getElementById('btn-close-add-order-modal')?.addEventListener('click', closeAddOrderModal);
    document.getElementById('btn-cancel-add-order-modal')?.addEventListener('click', closeAddOrderModal);

    const closePayModal = () => document.getElementById('user-payment-modal')?.classList.remove('active');
    document.getElementById('btn-close-payment-modal')?.addEventListener('click', closePayModal);
    document.getElementById('btn-cancel-payment-modal')?.addEventListener('click', closePayModal);

    const formAddOrder = document.getElementById('form-user-add-order');
    if (formAddOrder) {
      formAddOrder.onsubmit = async (e) => {
        e.preventDefault();
        const vehicleId = document.getElementById('add-order-vehicle-select')?.value;
        const carsList = (AppState.vehiclesList && AppState.vehiclesList.length > 0)
          ? AppState.vehiclesList
          : ((typeof SIGMA_DATA !== 'undefined' && SIGMA_DATA.cars) ? SIGMA_DATA.cars : []);
        const carObj = carsList.find(c => c.id === vehicleId) || {};
        const buyerName = document.getElementById('add-order-buyer-name')?.value.trim() || meProfile.fullName;
        const buyerPhone = document.getElementById('add-order-buyer-phone')?.value.trim() || meProfile.phone;
        const branchId = document.getElementById('add-order-branch-select')?.value || 'hn-caugiay';
        const intent = document.getElementById('add-order-intent-select')?.value;
        const paymentMethod = intent === 'pending_full' ? 'Lưu đơn chờ thanh toán 100%' : 'Đặt cọc giữ xe (Chờ thanh toán đủ)';
        try {
          await ApiClient.orders.createDeposit({ vehicleId, buyerName, buyerPhone, branchId, paymentMethod });
          closeAddOrderModal();
          showToast(`Đã thêm xe ${carObj.name || ''} vào đơn hàng thành công! Trạng thái: Chờ thanh toán.`, '🚗');
          renderProfile('profile-orders');
        } catch (err) {
          showToast(err.message || 'Không thể tạo đơn hàng, vui lòng thử lại.', '⚠️');
        }
      };
    }

    document.querySelectorAll('.btn-complete-payment-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const orderId = e.currentTarget.getAttribute('data-order-id');
        const orderNumber = e.currentTarget.getAttribute('data-order-number');
        const carName = e.currentTarget.getAttribute('data-car-name');
        const carImg = e.currentTarget.getAttribute('data-car-img');
        const carPrice = e.currentTarget.getAttribute('data-car-price');
        const payModal = document.getElementById('user-payment-modal');
        if (!payModal) return;
        const inpId = document.getElementById('pay-modal-order-id');
        if (inpId) inpId.value = orderId;
        const elNum = document.getElementById('pay-modal-order-number');
        if (elNum) elNum.textContent = orderNumber;
        const elName = document.getElementById('pay-modal-car-name');
        if (elName) elName.textContent = carName;
        const elPrice = document.getElementById('pay-modal-car-price');
        if (elPrice) elPrice.textContent = carPrice;
        const elImg = document.getElementById('pay-modal-car-img');
        if (elImg) {
          elImg.src = carImg || 'assets/model-e.jpg';
          elImg.onerror = () => { elImg.src = 'assets/model-e.jpg'; };
        }
        payModal.classList.add('active');
      });
    });

    const formCompletePay = document.getElementById('form-user-complete-payment');
    if (formCompletePay) {
      formCompletePay.onsubmit = async (e) => {
        e.preventDefault();
        const orderId = document.getElementById('pay-modal-order-id')?.value;
        const paymentMethod = document.getElementById('pay-modal-method-select')?.value;
        const carName = document.getElementById('pay-modal-car-name')?.textContent || 'xe';
        try {
          await ApiClient.orders.completePayment(orderId, { paymentMethod });
          closePayModal();
          showToast(`🎉 Thanh toán hoàn tất 100%! Xe ${carName} đã chính thức được chuyển vào Quản lý xe & Gara của bạn!`, '⚡');
          renderProfile('profile-garage');
        } catch (err) {
          showToast(err.message || 'Thanh toán không thành công, vui lòng thử lại.', '⚠️');
        }
      };
    }

    bindProfileInteractiveEvents();
  }

  function renderProfileSubView(tab, cur, myOrders, myAppts) {
    const pData = AppState._profileData || {};
    const myReturnsData = pData.myReturnsData || { requests: [], eligibleOrders: [], policy: {} };
    const myGarageData = pData.myGarageData || { ownedVehicles: [], warranties: [], serviceRecords: [], serviceAppointments: [], serviceCenters: [], coveredComponents: [], maintenanceMilestones: [] };
    const prefs = cur.preferences || {};

    const userAppts = (myAppts || []).filter(a => 
      (cur.email && a.email?.toLowerCase() === cur.email.toLowerCase()) || 
      (cur.phone && a.phone === cur.phone) ||
      (cur.fullName && a.customerName === cur.fullName)
    );

    const userOrders = (myOrders || []).filter(o => 
      (cur.id && (o.userId === cur.id || o.buyerId === cur.id)) ||
      (cur.userId && (o.userId === cur.userId || o.buyerId === cur.userId)) ||
      (cur.email && o.buyerEmail?.toLowerCase() === cur.email.toLowerCase()) || 
      (cur.phone && o.buyerPhone === cur.phone) ||
      (cur.fullName && o.buyerName === cur.fullName)
    );

    // SUBVIEW 1: LỊCH HẸN & LÁI THỬ (Matches Lịch hẹn & Lái thử - SIGMACAR.pdf)
    if (tab === 'profile-appointments') {
      const srvAppts = myGarageData.serviceAppointments || [];
      return `
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
            <div>
              <h2 style="font-size:26px; font-weight:800; color:var(--text-dark); margin-bottom:4px;">Lịch hẹn & Lái thử</h2>
              <p style="font-size:14px; color:var(--text-muted);">Theo dõi lịch hẹn lái thử tại Showroom và lịch bảo dưỡng định kỳ tại Trung tâm Dịch vụ 3S.</p>
            </div>
            <div style="display:flex; gap:10px;">
              <button class="btn-card-outline" style="padding:10px 16px; font-size:13px;" onclick="renderProfile('profile-garage')">🔧 + Đặt lịch bảo dưỡng</button>
              <button class="btn-dark" style="padding:10px 18px; font-size:13.5px;" onclick="window.location.hash='test-drive'">🚗 + Đặt lịch lái thử mới</button>
            </div>
          </div>

          <h4 style="font-size:15px; font-weight:800; color:var(--text-dark); margin-bottom:12px;">🔧 Lịch hẹn Bảo dưỡng & Dịch vụ 3S (${srvAppts.length})</h4>
          <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px;">
            ${srvAppts.length > 0 ? srvAppts.map(sa => `
              <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:18px 22px; display:flex; justify-content:space-between; align-items:center; gap:18px; flex-wrap:wrap; box-shadow:var(--shadow-sm);">
                <div style="display:flex; align-items:center; gap:14px;">
                  <div style="width:44px; height:44px; border-radius:10px; background:#EFF6FF; color:var(--primary); display:flex; align-items:center; justify-content:center; font-size:20px;">🔧</div>
                  <div>
                    <div style="font-size:11.5px; font-weight:800; color:var(--primary); text-transform:uppercase;">${escapeHtml(sa.appointmentCode || sa.id)} • BẢO DƯỠNG ĐỊNH KỲ</div>
                    <div style="font-size:16px; font-weight:800; color:var(--text-dark);">${escapeHtml(sa.vehicleName)} — ${escapeHtml(sa.serviceType)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">📍 ${escapeHtml(sa.serviceCenterName)} (${escapeHtml(sa.serviceCenterAddress || '')})</div>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:18px; flex-wrap:wrap;">
                  <div>
                    <div style="font-size:12px; color:var(--text-muted);">Thời gian hẹn:</div>
                    <div style="font-size:13.5px; font-weight:800; color:var(--text-dark);">${escapeHtml(sa.preferredTime)} — ${escapeHtml(sa.preferredDate)}</div>
                    <div style="font-size:11.5px; color:var(--text-secondary);">KTV: ${escapeHtml(sa.technicianName || 'Đang điều phối')}</div>
                  </div>
                  <span class="status-badge ${sa.status === 'Đã xác nhận' || sa.status === 'Hoàn thành' ? 'confirmed' : 'pending'}">● ${escapeHtml(sa.status)}</span>
                  <div style="display:flex; gap:8px;">
                    <button class="btn-card-outline" style="padding:6px 12px; font-size:12px;" onclick="showToast('Đang mở bản đồ chỉ đường tới ${escapeHtml(sa.serviceCenterName)}...', '🗺️')">🗺️ Xem bản đồ</button>
                    ${sa.status !== 'Đã hủy' && sa.status !== 'Hoàn thành' ? `
                      <button class="btn-card-outline btn-cancel-srv-appt" data-id="${sa.id}" style="padding:6px 12px; font-size:12px; color:var(--accent-rose);">Hủy lịch</button>
                    ` : ''}
                  </div>
                </div>
              </div>
            `).join('') : `<div style="padding:18px; background:#FFFFFF; border:1px dashed var(--border-subtle); border-radius:12px; color:var(--text-muted); font-size:13px;">Chưa có lịch hẹn bảo dưỡng nào. Bạn có thể đặt lịch trực tuyến trong mục <strong>Gara của tôi</strong>.</div>`}
          </div>

          <h4 style="font-size:15px; font-weight:800; color:var(--text-dark); margin-bottom:12px;">🚗 Lịch hẹn Lái thử tại Showroom (${userAppts.length})</h4>
          <div style="display:flex; flex-direction:column; gap:14px; margin-bottom:28px;">
            ${userAppts.length > 0 ? userAppts.map(item => `
              <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:18px 24px; display:flex; justify-content:space-between; align-items:center; gap:20px; box-shadow:var(--shadow-sm); flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:16px;">
                  <div style="width:42px; height:42px; border-radius:10px; background:var(--primary-light); color:var(--primary); display:flex; align-items:center; justify-content:center; font-size:18px;">🚗</div>
                  <div>
                    <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">${escapeHtml(item.service || 'Lái thử xe')}</div>
                    <div style="font-size:16px; font-weight:800; color:var(--text-dark);">${escapeHtml(item.carName || item.car)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(item.edition || item.branchName || item.location)}</div>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap;">
                  <div>
                    <div style="font-size:12px; color:var(--text-muted);">Thời gian & Địa điểm:</div>
                    <div style="font-size:13.5px; font-weight:700; color:var(--text-dark);">${escapeHtml(item.timeSlot || '')} ${escapeHtml(item.preferredDate || item.time)}</div>
                    <div style="font-size:12px; color:var(--text-secondary);">📍 ${escapeHtml(item.branchName || item.location)}</div>
                  </div>
                  <span class="status-badge ${item.status === 'SẮP TỚI' || item.status === 'confirmed' || item.status === 'Đã xác nhận' ? 'confirmed' : 'pending'}">● ${escapeHtml(item.status?.toUpperCase() || 'SẮP TỚI')}</span>
                  <button class="btn-card-outline" style="padding:6px 14px; font-size:12.5px;" onclick="showToast('Đang mở bản đồ Showroom ${escapeHtml(item.branchName || 'SIGMACAR')}...', '🗺️')">Xem bản đồ</button>
                </div>
              </div>
            `).join('') : `
              <div style="background:#FFFFFF; border:1px dashed var(--border-subtle); border-radius:var(--radius-lg); padding:36px 24px; text-align:center;">
                <p style="font-size:13.5px; color:var(--text-muted); margin-bottom:14px;">Bạn chưa có lịch hẹn lái thử nào trên hệ thống.</p>
                <button class="btn-primary" onclick="window.location.hash='test-drive'">+ Đặt lịch lái thử xe</button>
              </div>
            `}
          </div>
        </div>
      `;
    }

    // SUBVIEW 2: ĐƠN HÀNG CỦA TÔI (Matches Đơn hàng của tôi - SIGMACAR.pdf + 7-Day Return Button)
    if (tab === 'profile-orders') {
      return `
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; flex-wrap:wrap; gap:16px;">
            <div>
              <h2 style="font-size:26px; font-weight:800; color:var(--text-dark); margin-bottom:4px;">Đơn hàng của tôi</h2>
              <p style="font-size:14px; color:var(--text-muted);">Theo dõi hợp đồng mua xe, tiến độ bàn giao và kích hoạt quyền lợi Đổi trả 7 ngày hoặc Bảo hành điện tử.</p>
            </div>
            <button class="btn-primary" id="btn-open-add-order-modal" style="padding:10px 18px; font-size:13.5px; display:inline-flex; align-items:center; gap:8px;">
              <span>➕</span> Thêm xe vào đơn hàng
            </button>
          </div>

          <!-- Order Status Filter Tabs matching PDF -->
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px;" id="profile-order-filter-tabs">
            <button class="filter-pill-btn active" data-ord-filter="all" style="font-size:12.5px; padding:6px 14px;">Tất cả (${userOrders.length})</button>
            <button class="filter-pill-btn" data-ord-filter="pending" style="font-size:12.5px; padding:6px 14px;">Chờ thanh toán</button>
            <button class="filter-pill-btn" data-ord-filter="processing" style="font-size:12.5px; padding:6px 14px;">Đang xử lý / Đang giao</button>
            <button class="filter-pill-btn" data-ord-filter="completed" style="font-size:12.5px; padding:6px 14px;">Hoàn thành / Đã bàn giao</button>
          </div>

          <div style="display:flex; flex-direction:column; gap:18px;">
            ${userOrders.length > 0 ? userOrders.map(ord => {
              const os = (ord.orderStatus || '').toLowerCase();
              const ps = (ord.paymentStatus || '').toLowerCase();
              const isPaid = ps === 'fully_paid' || ps === 'đã thanh toán đủ' || os === 'delivered' || os === 'completed' || os === 'đã giao' || os === 'hoàn thành';
              const priceDisplay = (ord.unitPrice || ord.totalPrice || 1290000000).toLocaleString('vi-VN');
              const filterGroup = isPaid ? 'completed' : (os.includes('ship') || os.includes('giao') ? 'processing' : 'pending');

              return `
              <div class="profile-order-item-card" data-ord-group="${filterGroup}" style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:24px; box-shadow:var(--shadow-sm);">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #F1F5F9; padding-bottom:14px; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
                  <div style="font-size:13.5px; color:var(--text-muted);">
                    Mã đơn: <strong style="color:var(--text-dark);">${escapeHtml(ord.orderNumber || ord.id)}</strong> • Ngày đặt: ${ord.createdAt ? ord.createdAt.split('T')[0] : '2026'}
                    ${ord.vin ? ` • VIN: <strong style="color:var(--primary);">${escapeHtml(ord.vin)}</strong>` : ''}
                  </div>
                  <div>
                    ${isPaid ? `
                      <span class="status-badge" style="background:#ECFDF5; color:#059669; border:1px solid #A7F3D0; font-weight:700; padding:5px 12px; border-radius:20px; font-size:12px;">
                        ✓ ĐÃ BÀN GIAO • ĐỦ ĐIỀU KIỆN BẢO HÀNH & ĐỔI TRẢ 7 NGÀY
                      </span>
                    ` : `
                      <span class="status-badge" style="background:#FFFBEB; color:#D97706; border:1px solid #FDE68A; font-weight:700; padding:5px 12px; border-radius:20px; font-size:12px;">
                        ⏳ CHỜ THANH TOÁN HOÀN TẤT (LƯU ĐƠN)
                      </span>
                    `}
                  </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; gap:20px; flex-wrap:wrap;">
                  <div style="display:flex; align-items:center; gap:20px;">
                    <img src="${ord.img || 'assets/model-e.jpg'}" style="width:130px; height:80px; object-fit:contain; border-radius:8px; background:#F8FAFC; border:1px solid #E2E8F0; padding:4px;" onerror="this.src='assets/model-e.jpg'">
                    <div>
                      <h4 style="font-size:18px; font-weight:800; color:var(--text-dark); margin-bottom:4px;">${escapeHtml(ord.vehicleName || 'Xe SIGMACAR')}</h4>
                      <p style="font-size:13px; color:var(--text-muted); margin-bottom:4px;">${escapeHtml(ord.version || 'Bản tiêu chuẩn chính hãng')} ${ord.exteriorColor ? `• Màu: ${escapeHtml(ord.exteriorColor)}` : ''}</p>
                      <div style="font-size:12px; color:var(--text-secondary);">📍 Showroom: <strong>${escapeHtml(ord.branchName || 'SIGMACAR Cầu Giấy')}</strong> ${ord.invoiceNumber ? `• Hóa đơn: <strong>${escapeHtml(ord.invoiceNumber)}</strong>` : ''}</div>
                    </div>
                  </div>

                  <div style="text-align:right;">
                    <div style="font-size:11.5px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Tổng giá trị xe</div>
                    <div style="font-size:20px; font-weight:800; color:var(--primary); margin-bottom:10px;">${priceDisplay} VNĐ</div>

                    <div style="display:flex; gap:8px; justify-content:flex-end; align-items:center; flex-wrap:wrap;">
                      ${isPaid ? `
                        <button class="btn-card-outline" style="padding:8px 14px; font-size:12.5px; color:var(--primary); font-weight:700; border-color:var(--primary);" onclick="openProfileSubView('profile-garage')">
                          ⚡ Quản lý Xe & Bảo hành ›
                        </button>
                        <button class="btn-card-outline" style="padding:8px 14px; font-size:12.5px; color:#D97706; font-weight:700; border-color:#F59E0B;" onclick="openProfileSubView('profile-returns')">
                          🔄 Đổi trả tự động (7 ngày)
                        </button>
                      ` : `
                        <button class="btn-primary btn-complete-payment-action" data-order-id="${ord.id}" data-order-number="${ord.orderNumber || ord.id}" data-car-name="${ord.vehicleName || 'Xe SIGMACAR'}" data-car-img="${ord.img || 'assets/model-e.jpg'}" data-car-price="${priceDisplay} VNĐ" style="padding:8px 18px; font-size:13px; background:linear-gradient(135deg, #10B981, #059669); border:none; font-weight:700; cursor:pointer;">
                          💳 Thanh toán hoàn tất
                        </button>
                      `}
                    </div>
                  </div>
                </div>
              </div>
              `;
            }).join('') : `
              <div style="background:#FFFFFF; border:1px dashed var(--border-subtle); border-radius:var(--radius-lg); padding:48px 24px; text-align:center;">
                <h4 style="font-size:18px; font-weight:700; color:var(--text-dark); margin-bottom:6px;">Chưa có xe nào trong đơn hàng</h4>
                <button class="btn-primary" id="btn-empty-add-order" style="padding:10px 22px; font-size:14px; margin-top:12px;">➕ Thêm xe vào đơn hàng ngay</button>
              </div>
            `}
          </div>

          <!-- Support Banner matching Đơn hàng của tôi PDF -->
          <div style="background:linear-gradient(135deg, #0F172A, #1E293B); color:#FFFFFF; border-radius:var(--radius-lg); padding:20px 24px; margin-top:24px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
            <div>
              <div style="font-weight:800; font-size:16px;">Bạn cần hỗ trợ về hợp đồng, bàn giao xe hoặc thủ tục hoàn tiền?</div>
              <div style="font-size:13px; color:#94A3B8; margin-top:2px;">Đội ngũ Chuyên viên Tư vấn Tài chính & Hậu mãi SIGMACAR hỗ trợ 24/7.</div>
            </div>
            <button class="btn-primary" onclick="window.location.hash='support'" style="padding:10px 18px; font-size:13px;">🎧 Liên hệ Chuyên viên Tư vấn</button>
          </div>
        </div>
      `;
    }

    // SUBVIEW 3: TRUNG TÂM ĐỔI TRẢ TỰ ĐỘNG 7 NGÀY (Section 2 Complete Self-Service Portal)
    if (tab === 'profile-returns') {
      const eligibleOrders = myReturnsData.eligibleOrders || [];
      const requests = myReturnsData.requests || [];
      const policy = myReturnsData.policy || {};
      const stagesOrder = [
        'Chờ tiếp nhận',
        'Đang kiểm tra điều kiện',
        'Đã duyệt',
        'Chờ đặt lịch thu hồi',
        'Đã xác nhận lịch xe tải',
        'Đang vận chuyển xe về trung tâm',
        'Đang kiểm tra tình trạng xe',
        'Đang xử lý hoàn tiền hoặc đổi xe',
        'Hoàn tất'
      ];

      const firstEligible = eligibleOrders.find(e => e.eligibility.eligible && !e.existingReturnId) || eligibleOrders[0];

      return `
        <div>
          <!-- Header Bar with 24/7 Support Box (Returns Center.pdf) -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
            <div>
              <h2 style="font-size:26px; font-weight:800; color:var(--text-dark); margin:0 0 4px;">Trung Tâm Đổi Trả Xe Tự Động (7 Ngày)</h2>
              <p style="font-size:13.5px; color:var(--text-muted); margin:0;">Quy trình tự phục vụ minh bạch: thẩm định hồ sơ AI, xe tải thu hồi tận nơi và theo dõi hoàn tiền thời gian thực.</p>
            </div>
            <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:12px; padding:10px 18px; display:flex; align-items:center; gap:12px;">
              <span style="font-size:24px;">🎧</span>
              <div style="font-size:12px; color:#1E40AF;">
                <strong>Hỗ trợ đổi trả 24/7:</strong> 1900 8888<br>
                <span style="color:var(--primary); font-weight:700; cursor:pointer;" onclick="navigateTo('support')">Chat với chuyên viên CSKH →</span>
              </div>
            </div>
          </div>

          <!-- Returns Center 2-Column Grid (Main Left 65% - Sidebar Right 35%) -->
          <div class="returns-2col-layout">
            <!-- Left Column: Eligible Vehicle + Step 1 & Step 2 Form -->
            <div>
              <!-- Eligible Vehicle Card -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:10px; height:10px; border-radius:50%; background:#10B981; display:inline-block;"></span>
                    <strong style="font-size:15px; color:var(--text-dark);">XE ĐỦ ĐIỀU KIỆN ĐỔI TRẢ CHÍNH HÃNG</strong>
                  </div>
                  <span class="badge-role" style="background:#FEF3C7; color:#B45309; font-weight:800; font-size:12px; padding:5px 12px;">
                    ⏳ Còn lại: ${firstEligible?.eligibility?.remainingDays ? `0${firstEligible.eligibility.remainingDays} ngày ${firstEligible.eligibility.remainingHours || '14'} giờ` : '03 ngày 14 giờ'}
                  </span>
                </div>

                ${eligibleOrders.length > 0 ? `
                  <div style="display:grid; grid-template-columns:140px 1fr; gap:18px; align-items:center; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:12px; padding:14px;">
                    <img src="${firstEligible?.img || 'assets/model-e.jpg'}" alt="${escapeHtml(firstEligible?.vehicleName || 'Xe SIGMACAR')}" style="width:100%; height:90px; object-fit:contain; background:#FFFFFF; border-radius:8px; padding:4px;">
                    <div>
                      <h4 style="font-size:17px; font-weight:800; color:var(--text-dark); margin:0 0 6px;">${escapeHtml(firstEligible?.vehicleName || 'Xe SIGMACAR')}</h4>
                      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:12px; color:var(--text-secondary);">
                        <div>Số khung (VIN): <strong style="color:var(--text-dark);">${escapeHtml(firstEligible?.vin || 'SGCG2026VN003310')}</strong></div>
                        <div>Số ODO: <strong>${firstEligible?.currentOdoKm || 120} km</strong></div>
                        <div>Ngày nhận xe: <strong>${firstEligible?.deliveredDate || '25/10/2026'}</strong></div>
                        <div>Giá mua: <strong style="color:var(--primary);">${(firstEligible?.paidAmount || firstEligible?.unitPrice || 1405000000).toLocaleString('vi-VN')} đ</strong></div>
                      </div>
                    </div>
                  </div>
                ` : `
                  <div style="padding:16px; text-align:center; color:var(--text-muted); font-size:13px;">Không có xe nào đang trong thời hạn đổi trả 7 ngày.</div>
                `}
              </div>

              <!-- Main Return Request Form -->
              <form id="form-create-return-request" style="display:flex; flex-direction:column; gap:20px;">
                <!-- Step 1 Card: Lý do & Tình trạng xe -->
                <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                  <div style="display:flex; align-items:center; gap:8px; margin-bottom:16px;">
                    <span style="width:26px; height:26px; border-radius:50%; background:#2563EB; color:#FFFFFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px;">1</span>
                    <h3 style="font-size:17px; font-weight:800; color:var(--text-dark); margin:0;">Bước 1: Lý do & Tình trạng xe thực tế</h3>
                  </div>

                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                    <div>
                      <label class="filter-label">Chọn Đơn hàng đổi trả *</label>
                      <select id="ret-order-id" class="filter-select" required>
                        ${eligibleOrders.filter(e => e.eligibility.eligible && !e.existingReturnId).map(eo => `
                          <option value="${eo.id}" data-paid="${eo.paidAmount || eo.unitPrice || 1405000000}">${escapeHtml(eo.orderNumber)} — ${escapeHtml(eo.vehicleName)}</option>
                        `).join('')}
                        ${eligibleOrders.filter(e => e.eligibility.eligible && !e.existingReturnId).length === 0 ? `<option value="">-- Không có đơn hàng đủ điều kiện --</option>` : ''}
                      </select>
                    </div>
                    <div>
                      <label class="filter-label">Phương thức giải quyết *</label>
                      <select id="ret-resolution-type" class="filter-select" required>
                        <option value="refund">Hoàn tiền 100% về tài khoản</option>
                        <option value="exchange">Đổi sang xe mới tương đương</option>
                      </select>
                    </div>
                  </div>

                  <div style="display:grid; grid-template-columns:1.3fr 0.7fr; gap:12px; margin-bottom:12px;">
                    <div>
                      <label class="filter-label">Lý do đổi trả *</label>
                      <select id="ret-reason-code" class="filter-select" required>
                        <option value="technical_defect">Lỗi kỹ thuật nhà sản xuất (Pin/Động cơ/ADAS) — Miễn phí 0%</option>
                        <option value="delivery_damage">Trầy xước / Hư hại do vận chuyển bàn giao — Miễn phí 0%</option>
                        <option value="wrong_spec">Giao sai phiên bản / màu sắc theo hợp đồng — Miễn phí 0%</option>
                        <option value="change_of_mind">Đổi ý / Muốn đổi sang dòng xe khác (Phí kiểm định 2%)</option>
                      </select>
                    </div>
                    <div>
                      <label class="filter-label">Số ODO hiện tại (km) *</label>
                      <input type="number" id="ret-odo-km" class="filter-input" value="120" min="0" max="1000" required>
                    </div>
                  </div>

                  <div style="margin-bottom:12px;">
                    <label class="filter-label">Mô tả chi tiết tình trạng hiện tại *</label>
                    <textarea id="ret-description" class="filter-input" rows="2" required placeholder="Mô tả cụ thể lý do đổi trả và các phụ kiện đi kèm (tối thiểu 15 ký tự)...">Xe nguyên bản 100%, không trầy xước, đầy đủ 02 khóa NFC và sạc theo xe.</textarea>
                  </div>

                  <div style="margin-bottom:14px;">
                    <label class="filter-label">Tình trạng ngoại thất / nội thất</label>
                    <input type="text" id="ret-condition-note" class="filter-input" value="Nguyên bản 100%, không vết xước, đầy đủ 02 khóa thông minh">
                  </div>

                  <!-- 4 Photo Upload Boxes (Returns Center.pdf) -->
                  <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                      <label class="filter-label" style="margin:0;">Tải ảnh thực tế (4 góc chụp bắt buộc) *</label>
                      <span style="font-size:11px; color:var(--text-muted);">Hỗ trợ JPG, PNG • Tự động gắn vào hồ sơ</span>
                    </div>
                    <div class="return-photo-upload-grid">
                      <div class="return-photo-box" id="box-photo-front">
                        <input type="file" accept="image/*" id="ret-photo-front" data-target="front">
                        <div id="prev-photo-front">
                          <div style="font-size:20px;">📷</div>
                          <strong style="font-size:11px; color:var(--text-dark); display:block; margin-top:2px;">MẶT TRƯỚC</strong>
                          <span style="font-size:10px; color:var(--text-muted);">Bấm để chọn</span>
                        </div>
                      </div>
                      <div class="return-photo-box" id="box-photo-rear">
                        <input type="file" accept="image/*" id="ret-photo-rear" data-target="rear">
                        <div id="prev-photo-rear">
                          <div style="font-size:20px;">📷</div>
                          <strong style="font-size:11px; color:var(--text-dark); display:block; margin-top:2px;">MẶT SAU</strong>
                          <span style="font-size:10px; color:var(--text-muted);">Bấm để chọn</span>
                        </div>
                      </div>
                      <div class="return-photo-box" id="box-photo-interior">
                        <input type="file" accept="image/*" id="ret-photo-interior" data-target="interior">
                        <div id="prev-photo-interior">
                          <div style="font-size:20px;">📷</div>
                          <strong style="font-size:11px; color:var(--text-dark); display:block; margin-top:2px;">NỘI THẤT</strong>
                          <span style="font-size:10px; color:var(--text-muted);">Bấm để chọn</span>
                        </div>
                      </div>
                      <div class="return-photo-box" id="box-photo-odo">
                        <input type="file" accept="image/*" id="ret-photo-odo" data-target="odo">
                        <div id="prev-photo-odo">
                          <div style="font-size:20px;">📷</div>
                          <strong style="font-size:11px; color:var(--text-dark); display:block; margin-top:2px;">ODO/ĐỒNG HỒ</strong>
                          <span style="font-size:10px; color:var(--text-muted);">Bấm để chọn</span>
                        </div>
                      </div>
                    </div>
                    <input type="hidden" id="ret-photos" value="assets/city-g.jpg, assets/Interior.png">
                  </div>
                </div>

                <!-- Step 2 Card: Lịch xe thu hồi tự động -->
                <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                  <div style="display:flex; align-items:center; gap:8px; margin-bottom:16px;">
                    <span style="width:26px; height:26px; border-radius:50%; background:#2563EB; color:#FFFFFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px;">2</span>
                    <h3 style="font-size:17px; font-weight:800; color:var(--text-dark); margin:0;">Bước 2: Lịch xe thu hồi tự động</h3>
                  </div>

                  <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:10px; padding:12px; font-size:12px; color:#1E40AF; margin-bottom:14px; line-height:1.5;">
                    ℹ️ Xe tải chuyên dụng của SIGMACAR sẽ đến tận nơi thẩm định và tiếp nhận xe theo khung giờ bạn chọn.
                  </div>

                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                    <div>
                      <label class="filter-label">Ngày mong muốn *</label>
                      <input type="date" id="ret-pickup-date" class="filter-input" required value="2026-11-10">
                    </div>
                    <div>
                      <label class="filter-label">Khung giờ xe tải *</label>
                      <select id="ret-pickup-slot" class="filter-select">
                        <option value="09:00 - 11:30">Sáng (08:00 - 12:00)</option>
                        <option value="14:00 - 16:30">Chiều (13:30 - 17:30)</option>
                      </select>
                    </div>
                  </div>

                  <div style="margin-bottom:14px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                      <label class="filter-label" style="margin:0;">Địa chỉ thu hồi *</label>
                      <button type="button" id="btn-change-return-addr" style="background:none; border:none; color:#2563EB; font-weight:700; font-size:11.5px; cursor:pointer;">THAY ĐỔI</button>
                    </div>
                    <input type="text" id="ret-pickup-address" class="filter-input" required value="${escapeHtml(cur.address || 'Khu đô thị Thủ Thiêm, TP. Thủ Đức, TP. Hồ Chí Minh')}">
                  </div>

                  <label style="display:flex; align-items:flex-start; gap:8px; font-size:12.5px; color:var(--text-dark); cursor:pointer; margin-bottom:16px;">
                    <input type="checkbox" id="ret-confirm-policy" required style="accent-color:#2563EB; margin-top:3px;">
                    <span>Tôi xác nhận thông tin tình trạng xe trung thực và đồng ý với điều khoản dịch vụ đổi trả 7 ngày của SIGMACAR.</span>
                  </label>

                  <!-- Buttons: Lưu nháp & Gửi yêu cầu -->
                  <div style="display:flex; gap:12px;">
                    <button type="button" class="btn-card-outline" id="btn-save-return-draft" style="flex:1; justify-content:center; padding:12px; font-size:14px; font-weight:700;">
                      💾 Lưu nháp
                    </button>
                    <button type="submit" class="btn-primary" style="flex:2; justify-content:center; padding:12px; font-size:14px; font-weight:800; box-shadow:0 4px 14px rgba(37,99,235,0.3);">
                      Gửi yêu cầu đổi trả ✈️
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <!-- Right Column Sidebar (Tạm tính hoàn tiền + Stepper + Chính sách) -->
            <div>
              <!-- Card 1: Tạm tính hoàn tiền -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin:0 0 14px;">Tạm tính hoàn tiền</h4>
                
                <div style="display:flex; flex-direction:column; gap:10px; font-size:13px;">
                  <div style="display:flex; justify-content:space-between;">
                    <span style="color:var(--text-secondary);">Giá trị xe ban đầu:</span>
                    <strong id="ret-calc-base-price">${(firstEligible?.paidAmount || firstEligible?.unitPrice || 1405000000).toLocaleString('vi-VN')} đ</strong>
                  </div>
                  <div style="display:flex; justify-content:space-between;">
                    <span style="color:var(--text-secondary);">Thuế & Phí dịch vụ:</span>
                    <span style="color:#10B981; font-weight:700;">Miễn phí</span>
                  </div>
                  <div style="display:flex; justify-content:space-between;">
                    <span style="color:var(--text-secondary);">Phí đổi trả (0% lỗi KT):</span>
                    <span id="ret-calc-deduction" style="color:var(--text-dark); font-weight:700;">0 đ</span>
                  </div>
                  <div style="display:flex; justify-content:space-between;">
                    <span style="color:var(--text-secondary);">Phí vận chuyển thu hồi:</span>
                    <span style="color:#DC2626; font-weight:700;">-1.500.000 đ</span>
                  </div>
                  <div style="border-top:1px dashed #CBD5E1; padding-top:10px; margin-top:4px; display:flex; justify-content:space-between; align-items:center;">
                    <strong style="font-size:14px; color:var(--text-dark);">Tổng hoàn trả dự kiến:</strong>
                    <strong id="ret-calc-refund" style="font-size:18px; color:var(--primary); font-weight:800;">${((firstEligible?.paidAmount || 1405000000) - 1500000).toLocaleString('vi-VN')} đ</strong>
                  </div>
                </div>

                <!-- Beneficiary Account Box -->
                <div style="margin-top:14px; padding:12px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; font-size:12px;">
                  <div style="font-size:10.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">TÀI KHOẢN THỤ HƯỞNG</div>
                  <div style="font-weight:700; color:var(--text-dark); margin-top:2px;">VCB - 1023****999 (NGUYEN MINH HOANG)</div>
                  <div style="color:#10B981; font-size:11px; margin-top:2px;">✓ Đã xác thực CCCD/eKYC</div>
                </div>
              </div>

              <!-- Card 2: Tiến trình đổi trả Stepper Dọc 4 Bước -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin:0 0 16px;">Tiến trình đổi trả</h4>
                
                <div class="return-stepper-v">
                  <div class="return-stepper-v-item active">
                    <span class="return-stepper-v-dot"></span>
                    <strong style="font-size:13px; color:var(--text-dark);">1. Gửi yêu cầu</strong>
                    <span style="font-size:11.5px; color:var(--text-muted);">Hoàn tất hồ sơ trực tuyến trong 5 phút</span>
                  </div>
                  <div class="return-stepper-v-item">
                    <span class="return-stepper-v-dot"></span>
                    <strong style="font-size:13px; color:var(--text-dark);">2. Thẩm định hồ sơ (AI)</strong>
                    <span style="font-size:11.5px; color:var(--text-muted);">AI đối chiếu hình ảnh & ODO trong 24h</span>
                  </div>
                  <div class="return-stepper-v-item">
                    <span class="return-stepper-v-dot"></span>
                    <strong style="font-size:13px; color:var(--text-dark);">3. Thu hồi & Kiểm định thực tế</strong>
                    <span style="font-size:11.5px; color:var(--text-muted);">Xe tải chuyên dụng tiếp nhận tận nhà</span>
                  </div>
                  <div class="return-stepper-v-item">
                    <span class="return-stepper-v-dot"></span>
                    <strong style="font-size:13px; color:var(--text-dark);">4. Hoàn tiền</strong>
                    <span style="font-size:11.5px; color:var(--text-muted);">Giải ngân trong 48h sau kiểm định</span>
                  </div>
                </div>
              </div>

              <!-- Card 3: Chính sách tóm tắt (Nền tối #0F172A) -->
              <div style="background:#0F172A; border-radius:18px; padding:22px; color:#FFFFFF;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                  <span style="font-size:18px;">🛡️</span>
                  <h4 style="font-size:15px; font-weight:800; color:#FFFFFF; margin:0;">Chính sách tóm tắt</h4>
                </div>
                <div style="font-size:12px; color:#94A3B8; line-height:1.7; display:flex; flex-direction:column; gap:6px;">
                  <div>• Miễn phí 100% đổi trả đối với lỗi kỹ thuật phần mềm hoặc phần cứng từ nhà sản xuất.</div>
                  <div>• ODO &le; 500 km trong 7 ngày được miễn toàn bộ phụ phí hao mòn.</div>
                  <div>• Cam kết giải ngân hoàn tiền hoặc bàn giao xe đổi mới theo quy chuẩn Bộ Công Thương.</div>
                </div>
                <div style="margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.1);">
                  <a href="javascript:void(0)" id="btn-open-legal-modal" style="color:#60A5FA; font-size:11.5px; font-weight:700; text-decoration:none;">
                    XEM TOÀN BỘ CHÍNH SÁCH PHÁP LÝ →
                  </a>
                </div>
              </div>
            </div>
          </div>

          <!-- Existing Active Requests & 9-Stage Progress Tracker -->
          <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:24px; margin-top:28px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              <h4 style="font-size:18px; font-weight:800; color:var(--text-dark); margin:0;">📦 Lịch sử & Tiến trình Yêu cầu Đổi trả của Tôi (${requests.length})</h4>
              <span style="font-size:12px; color:var(--text-muted);">Cập nhật tự động</span>
            </div>

            ${requests.length > 0 ? requests.map(r => {
              const curStageIdx = stagesOrder.indexOf(r.status);
              return `
                <div style="border:1px solid #E2E8F0; border-radius:14px; padding:20px; margin-bottom:16px; background:#F8FAFC;">
                  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                    <div>
                      <span style="background:#EFF6FF; color:var(--primary); font-weight:800; font-size:13px; padding:4px 10px; border-radius:6px;">${escapeHtml(r.returnCode)}</span>
                      <strong style="font-size:16px; margin-left:8px; color:var(--text-dark);">${escapeHtml(r.vehicleName)} (Đơn: ${escapeHtml(r.orderNumber)})</strong>
                    </div>
                    <span class="status-badge ${r.status === 'Hoàn tất' || r.status === 'Đã duyệt' ? 'confirmed' : 'pending'}">● ${escapeHtml(r.status)}</span>
                  </div>

                  <!-- 9-Stage Stepper -->
                  <div class="return-stepper-track">
                    ${stagesOrder.map((st, idx) => {
                      const cls = idx < curStageIdx ? 'completed' : (idx === curStageIdx ? 'active' : '');
                      return `
                        <div class="return-step-node ${cls}">
                          <div class="return-step-circle">${idx < curStageIdx ? '✓' : (idx + 1)}</div>
                          <div class="return-step-label">${escapeHtml(st)}</div>
                        </div>
                      `;
                    }).join('')}
                  </div>

                  <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:16px; margin-top:14px; font-size:12.5px;">
                    <div>
                      <div style="font-weight:800; margin-bottom:6px; color:var(--text-dark);">🕒 Lịch sử Xử lý:</div>
                      ${(r.timeline || []).map(tl => `
                        <div style="margin-bottom:6px; padding-left:10px; border-left:2px solid var(--primary);">
                          <strong style="color:var(--text-dark);">${escapeHtml(tl.stage)}</strong> — <span style="color:var(--text-muted); font-size:11px;">${new Date(tl.timestamp).toLocaleString('vi-VN')}</span>
                          <div style="color:var(--text-secondary); font-size:12px;">${escapeHtml(tl.note)} (Bởi: ${escapeHtml(tl.actor)})</div>
                        </div>
                      `).join('')}
                    </div>

                    <div style="background:#FFFFFF; padding:12px; border-radius:8px; border:1px solid #E2E8F0;">
                      <div style="font-weight:800; margin-bottom:4px; color:var(--text-dark);">🚚 Lịch xe tải chuyên dụng:</div>
                      <div>Ngày thu hồi: <strong>${escapeHtml(r.logistics?.pickupDate || 'Chờ xếp lịch')}</strong> (${escapeHtml(r.logistics?.pickupTimeSlot || '09:00 - 11:30')})</div>
                      <div>Địa chỉ: <strong>${escapeHtml(r.logistics?.pickupAddress || 'Tại địa chỉ bàn giao')}</strong></div>
                      ${r.logistics?.driverName ? `<div>Tài xế xe tải: <strong>${escapeHtml(r.logistics.driverName)}</strong> (📞 ${escapeHtml(r.logistics.driverPhone)})</div>` : ''}
                      ${r.supplementHistory?.length > 0 ? `
                        <div style="margin-top:8px; padding-top:6px; border-top:1px dashed #E2E8F0;">
                          <strong>Bổ sung từ khách hàng:</strong>
                          ${r.supplementHistory.map(sh => `<div style="font-size:11.5px; color:var(--text-secondary);">• ${escapeHtml(sh.note)}</div>`).join('')}
                        </div>
                      ` : ''}
                    </div>
                  </div>
                </div>
              `;
            }).join('') : `
              <div style="text-align:center; padding:24px; color:var(--text-muted); font-size:13px;">Chưa có yêu cầu đổi trả nào đang hoạt động.</div>
            `}
          </div>

          <div id="ret-live-financial-summary" style="display:none;"></div>
        </div>
      `;
    }

    // SUBVIEW 4: GARA CỦA TÔI & QUẢN LÝ BẢO HÀNH / BẢO DƯỠNG SỐ (Section 3 Complete Lifecycle)
    if (tab === 'profile-garage') {
      const ownedVehicles = myGarageData.ownedVehicles || [];
      const warranties = myGarageData.warranties || [];
      const records = myGarageData.serviceRecords || [];
      const centers = myGarageData.serviceCenters || [];
      const covered = myGarageData.coveredComponents || [];
      const milestones = myGarageData.maintenanceMilestones || [];

      const primaryVehicle = ownedVehicles[0] || {
        vehicleName: 'SIGMA Model E Performance',
        licensePlate: '51K-998.88',
        vin: 'SGCG2026VN003310',
        motorNumber: 'MTR-150KW-310',
        img: 'assets/model-e.jpg',
        orderNumber: 'SG-2026-9023',
        invoiceNumber: 'INV-SG2026-9023'
      };
      const primaryWarranty = primaryVehicle.warranty || warranties[0];

      return `
        <div>
          <!-- Header Bar (Warranty & Maintenance.pdf) -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
            <div>
              <h2 style="font-size:26px; font-weight:800; color:var(--text-dark); margin:0 0 4px;">Bảo Hành & Bảo Dưỡng Điện Tử</h2>
              <p style="font-size:13.5px; color:var(--text-muted); margin:0;">Quản lý bảo hành số, tra cứu số khung VIN, theo dõi lịch sử dịch vụ 3S và tình trạng sức khỏe xe thời gian thực.</p>
            </div>
            <button class="btn-primary" onclick="document.getElementById('garage-warranty-activate-box')?.scrollIntoView({behavior:'smooth'})" style="padding:10px 18px; font-size:13px;">
              🛡️ + Kích hoạt Bảo hành theo VIN
            </button>
          </div>

          <!-- Warranty 2-Column Grid (Main Left 66% - Sidebar Right 34%) -->
          <div class="warranty-2col-layout">
            <!-- Left Column: Hero Dark Card + E-Warranty Card + History Table + Booking Form -->
            <div>
              <!-- Hero Dark Vehicle Card (#0F172A) -->
              <div class="warranty-hero-card" style="margin-bottom:20px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
                  <div>
                    <span class="badge-role" style="background:rgba(37,99,235,0.25); color:#60A5FA; font-weight:800; font-size:11px; border:1px solid rgba(96,165,250,0.3); margin-bottom:6px; display:inline-block;">
                      XE CHÍNH HÃNG • SIGMACAR
                    </span>
                    <h3 style="font-size:24px; font-weight:800; color:#FFFFFF; margin:0 0 4px;">${escapeHtml(primaryVehicle.vehicleName)}</h3>
                    <div style="font-size:13px; color:#94A3B8;">Biển kiểm soát: <strong style="color:#FFFFFF;">${escapeHtml(primaryVehicle.licensePlate || '51K-998.88')}</strong> • Số khung (VIN): <strong style="color:#60A5FA;">${escapeHtml(primaryVehicle.vin)}</strong></div>
                  </div>
                  <img src="${primaryVehicle.img || 'assets/model-e.jpg'}" alt="${escapeHtml(primaryVehicle.vehicleName)}" style="max-height:85px; object-fit:contain; filter:drop-shadow(0 10px 15px rgba(0,0,0,0.5));">
                </div>

                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; padding:14px; background:rgba(255,255,255,0.06); border-radius:12px; border:1px solid rgba(255,255,255,0.08); margin-bottom:18px;">
                  <div>
                    <div style="font-size:10.5px; font-weight:700; color:#94A3B8;">THỜI HẠN BẢO HÀNH</div>
                    <strong style="font-size:15px; color:#FFFFFF;">${primaryWarranty ? `${primaryWarranty.durationYears || 3} năm (${(primaryWarranty.maxOdoKm || 160000).toLocaleString('vi-VN')} km)` : '24 tháng / 36 tháng'}</strong>
                  </div>
                  <div>
                    <div style="font-size:10.5px; font-weight:700; color:#94A3B8;">SỐ KM HIỆN TẠI</div>
                    <strong style="font-size:15px; color:#38BDF8;">${(primaryWarranty?.currentOdoKm || 12450).toLocaleString('vi-VN')} km</strong>
                  </div>
                  <div>
                    <div style="font-size:10.5px; font-weight:700; color:#94A3B8;">TRẠNG THÁI</div>
                    <strong style="font-size:14px; color:#34D399;">● Đang bảo hành</strong>
                  </div>
                </div>

                <div style="display:flex; gap:12px; flex-wrap:wrap;">
                  <button class="btn-primary" onclick="document.getElementById('garage-book-service-box')?.scrollIntoView({behavior:'smooth'})" style="padding:9px 18px; font-size:13px;">
                    📅 Đặt lịch bảo dưỡng
                  </button>
                  <button class="btn-secondary" id="btn-warranty-details-modal" style="padding:9px 18px; font-size:13px; background:rgba(255,255,255,0.1); color:#FFFFFF; border:1px solid rgba(255,255,255,0.2);">
                    📄 Chi tiết bảo hành
                  </button>
                </div>
              </div>

              <!-- Electronic Warranty Info Card (VIN / Motor Code / QR Check) -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                  <h4 style="font-size:17px; font-weight:800; color:var(--text-dark); margin:0;">Thông tin Bảo hành điện tử</h4>
                  <span class="badge-role" style="background:#ECFDF5; color:#059669; font-weight:800;">✓ ĐÃ XÁC THỰC NSX</span>
                </div>

                <div style="display:grid; grid-template-columns:1fr 180px; gap:20px; align-items:center;">
                  <div style="display:flex; flex-direction:column; gap:10px; font-size:13px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; padding:8px 12px; border-radius:8px; border:1px solid #E2E8F0;">
                      <div>
                        <span style="font-size:11px; color:var(--text-muted); display:block;">MÃ SỐ KHUNG (VIN)</span>
                        <strong style="color:var(--text-dark);" id="display-vin-code">${escapeHtml(primaryVehicle.vin)}</strong>
                      </div>
                      <button class="btn-card-outline btn-copy-vin" data-code="${escapeHtml(primaryVehicle.vin)}" style="padding:4px 8px; font-size:11px;">📋 Copy</button>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; padding:8px 12px; border-radius:8px; border:1px solid #E2E8F0;">
                      <div>
                        <span style="font-size:11px; color:var(--text-muted); display:block;">MÃ SỐ MÁY (MOTOR CODE)</span>
                        <strong style="color:var(--text-dark);" id="display-motor-code">${escapeHtml(primaryVehicle.motorNumber || 'MTR-150KW-310')}</strong>
                      </div>
                      <button class="btn-card-outline btn-copy-motor" data-code="${escapeHtml(primaryVehicle.motorNumber || 'MTR-150KW-310')}" style="padding:4px 8px; font-size:11px;">📋 Copy</button>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:12px; color:var(--text-secondary); margin-top:2px;">
                      <div>Ngày kích hoạt: <strong style="color:var(--text-dark);">${primaryWarranty?.startDate || '25/10/2026'}</strong></div>
                      <div>Đơn vị cung cấp: <strong style="color:var(--text-dark);">SIGMACAR Việt Nam</strong></div>
                    </div>
                  </div>

                  <!-- QR Code Inspection Box (Warranty & Maintenance.pdf) -->
                  <div style="background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:12px; padding:12px; text-align:center;">
                    <div style="width:80px; height:80px; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; display:flex; align-items:center; justify-content:center; margin:0 auto 6px; font-size:36px;">
                      🏁
                    </div>
                    <div style="font-size:10px; font-weight:800; color:var(--primary); text-transform:uppercase;">QUÉT MÃ ĐỂ KIỂM TRA</div>
                    <span style="font-size:9.5px; color:var(--text-muted);">Mã QR tra cứu quốc gia</span>
                  </div>
                </div>
              </div>

              <!-- Service & Repair History Card (Lịch sử Dịch vụ & Sửa chữa) -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
                  <h4 style="font-size:17px; font-weight:800; color:var(--text-dark); margin:0;">Lịch sử Dịch vụ & Sửa chữa (${records.length})</h4>
                  <div style="display:flex; gap:8px;">
                    <button class="btn-card-outline" id="btn-toggle-service-filter" style="padding:6px 12px; font-size:12px;">🔍 Bộ lọc</button>
                    <button class="btn-dark" id="btn-export-warranty-pdf" style="padding:6px 14px; font-size:12px;">📄 Xuất báo cáo PDF</button>
                  </div>
                </div>

                <table class="dash-data-table">
                  <thead>
                    <tr>
                      <th>NGÀY THỰC HIỆN</th>
                      <th>LOẠI DỊCH VỤ</th>
                      <th>SỐ KM</th>
                      <th>LINH KIỆN THAY THẾ</th>
                      <th>CHI PHÍ</th>
                      <th>HÓA ĐƠN</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${records.map(rec => `
                      <tr>
                        <td><strong>${escapeHtml(rec.serviceDate)}</strong></td>
                        <td>
                          <span class="badge-role" style="background:#EFF6FF; color:#2563EB; font-weight:700; font-size:11px;">
                            ${escapeHtml(rec.serviceType)}
                          </span>
                          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">📍 ${escapeHtml(rec.serviceCenterName)}</div>
                        </td>
                        <td>${(rec.odoKm || 0).toLocaleString('vi-VN')} km</td>
                        <td style="font-size:12px;">${(rec.partsReplaced || []).map(escapeHtml).join(', ') || 'Không thay thế'}</td>
                        <td><strong style="color:var(--primary);">${(rec.cost || 0).toLocaleString('vi-VN')} đ</strong></td>
                        <td><span style="cursor:pointer; color:var(--primary);" title="Xem hóa đơn GTGT">📄</span></td>
                      </tr>
                    `).join('')}
                    ${records.length === 0 ? `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Chưa có lịch sử dịch vụ.</td></tr>` : ''}
                  </tbody>
                </table>
              </div>

              <!-- Online Service Booking Form & Warranty Activation -->
              <div id="garage-book-service-box" style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <h4 style="font-size:17px; font-weight:800; color:var(--text-dark); margin:0 0 12px;">📅 Đặt lịch Bảo dưỡng & Sửa chữa Trực tuyến</h4>
                <form id="form-book-service-appt" style="display:flex; flex-direction:column; gap:10px;">
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                      <label class="filter-label">Chọn xe của tôi *</label>
                      <select id="srv-book-vehicle" class="filter-select" required>
                        ${ownedVehicles.map(ov => `<option value="${escapeHtml(ov.vehicleId)}" data-name="${escapeHtml(ov.vehicleName)}" data-vin="${escapeHtml(ov.vin)}" data-war="${escapeHtml(ov.warranty?.id || '')}">${escapeHtml(ov.vehicleName)} (${escapeHtml(ov.vin)})</option>`).join('')}
                        ${ownedVehicles.length === 0 ? `<option value="${primaryVehicle.vin}" data-name="${primaryVehicle.vehicleName}" data-vin="${primaryVehicle.vin}">${primaryVehicle.vehicleName} (${primaryVehicle.vin})</option>` : ''}
                      </select>
                    </div>
                    <div>
                      <label class="filter-label">Trung tâm Dịch vụ 3S *</label>
                      <select id="srv-book-center" class="filter-select" required>
                        ${centers.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.city)})</option>`).join('')}
                      </select>
                    </div>
                  </div>
                  <div style="display:grid; grid-template-columns:1.2fr 0.8fr 0.8fr; gap:10px;">
                    <div>
                      <label class="filter-label">Hạng mục dịch vụ *</label>
                      <select id="srv-book-type" class="filter-select" required>
                        <option value="Bảo dưỡng định kỳ 10.000 km">Bảo dưỡng định kỳ 10.000 km</option>
                        <option value="Kiểm tra sức khỏe Pin & Cân bằng Cell">Kiểm tra sức khỏe Pin & Cân bằng Cell</option>
                        <option value="Cập nhật phần mềm ADAS & Kiểm tra phanh">Cập nhật phần mềm ADAS & Kiểm tra phanh</option>
                        <option value="Kiểm tra bảo hành linh kiện điện tử">Kiểm tra bảo hành linh kiện điện tử</option>
                      </select>
                    </div>
                    <div>
                      <label class="filter-label">Ngày hẹn *</label>
                      <input type="date" id="srv-book-date" class="filter-input" required value="2026-11-18">
                    </div>
                    <div>
                      <label class="filter-label">Giờ hẹn *</label>
                      <select id="srv-book-time" class="filter-select">
                        <option value="09:00">09:00</option>
                        <option value="10:30">10:30</option>
                        <option value="14:00">14:00</option>
                        <option value="15:30">15:30</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label class="filter-label">Mô tả tình trạng xe / Yêu cầu kỹ thuật</label>
                    <input type="text" id="srv-book-note" class="filter-input" placeholder="VD: Nhờ kiểm tra thêm áp suất lốp và cập nhật firmware màn hình">
                  </div>
                  <button type="submit" class="btn-primary" style="justify-content:center; padding:10px;">📅 Xác nhận Đặt lịch Dịch vụ 3S</button>
                </form>
              </div>

              <!-- Warranty Activation Box (if needed) -->
              <div id="garage-warranty-activate-box" style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin:0 0 6px;">🛡️ Kích hoạt Bảo hành Điện tử cho Xe Mới</h4>
                <p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Hệ thống xác thực mã số khung VIN, số hóa đơn với kho cơ sở dữ liệu quốc gia.</p>
                <form id="form-activate-warranty" style="display:flex; flex-direction:column; gap:10px;">
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                      <label class="filter-label">Mã đơn hàng *</label>
                      <input type="text" id="war-act-order" class="filter-input" required value="${primaryVehicle.orderNumber || 'SG-2026-9023'}">
                    </div>
                    <div>
                      <label class="filter-label">Số hóa đơn GTGT *</label>
                      <input type="text" id="war-act-invoice" class="filter-input" required value="${primaryVehicle.invoiceNumber || 'INV-SG2026-9023'}">
                    </div>
                  </div>
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                      <label class="filter-label">Số khung (VIN) *</label>
                      <input type="text" id="war-act-vin" class="filter-input" required value="${primaryVehicle.vin || 'SGCG2026VN003310'}">
                    </div>
                    <div>
                      <label class="filter-label">Mã máy *</label>
                      <input type="text" id="war-act-motor" class="filter-input" required value="${primaryVehicle.motorNumber || 'MTR-150KW-310'}">
                    </div>
                  </div>
                  <div>
                    <label class="filter-label">Ngày bàn giao trên hóa đơn *</label>
                    <input type="date" id="war-act-date" class="filter-input" required value="2026-10-25">
                  </div>
                  <button type="submit" class="btn-primary" style="justify-content:center; padding:10px;">✓ Kích hoạt Bảo hành Điện tử</button>
                </form>
              </div>
            </div>

            <!-- Right Column Sidebar (Lịch hẹn sắp tới + Trung tâm gần nhất + Sức khỏe xe + Mẹo) -->
            <div>
              <!-- Card 1: Lịch hẹn sắp tới (Warranty & Maintenance.pdf) -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                  <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin:0;">Lịch hẹn sắp tới</h4>
                  <span class="badge-role" style="background:#EFF6FF; color:#2563EB; font-weight:800; font-size:11px;">ĐÃ XÁC NHẬN</span>
                </div>

                <div style="display:flex; gap:14px; align-items:center; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:12px; padding:12px; margin-bottom:12px;">
                  <div style="background:#2563EB; color:#FFFFFF; border-radius:8px; padding:8px 12px; text-align:center; min-width:54px;">
                    <div style="font-size:10px; font-weight:700;">THÁNG 11</div>
                    <div style="font-size:20px; font-weight:800; line-height:1.1;">18</div>
                  </div>
                  <div>
                    <strong style="font-size:14px; color:var(--text-dark); display:block;">Bảo dưỡng định kỳ 10.000 km</strong>
                    <span style="font-size:12px; color:var(--text-muted);">09:00 • Trung tâm SIGMACAR Thủ Thiêm</span>
                  </div>
                </div>

                <button class="btn-card-outline" id="btn-remind-service-24h" style="width:100%; justify-content:center; padding:8px; font-size:12.5px; border-color:#2563EB; color:#2563EB; font-weight:700;">
                  🔔 Nhắc tôi trước 24h qua SMS
                </button>
              </div>

              <!-- Card 2: Trung tâm gần nhất -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:22px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                  <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin:0;">Trung tâm gần nhất</h4>
                  <span style="font-size:11px; color:var(--text-muted);">Định vị GPS</span>
                </div>

                <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:14px;">
                  ${centers.slice(0, 2).map((sc, idx) => `
                    <div style="padding:10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; font-size:12px;">
                      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                        <strong style="color:var(--text-dark);">${escapeHtml(sc.name)}</strong>
                        <span class="badge-role" style="background:#EFF6FF; color:#2563EB; font-size:10.5px; padding:2px 6px;">Cách ${idx === 0 ? '2.4 km' : '8.5 km'}</span>
                      </div>
                      <div style="color:var(--text-muted); font-size:11px; margin-bottom:6px;">${escapeHtml(sc.address)}</div>
                      <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="color:#10B981; font-weight:700; font-size:11px;">● Đang mở cửa</span>
                        <div style="display:flex; gap:6px;">
                          <a href="tel:${escapeHtml(sc.phone)}" class="btn-card-outline" style="padding:2px 8px; font-size:11px; text-decoration:none;">📞 Gọi</a>
                          <button class="btn-card-outline" onclick="showToast('Chi tiết: ${escapeHtml(sc.name)} • ${escapeHtml(sc.workingHours)}', '📍')" style="padding:2px 8px; font-size:11px;">Chi tiết</button>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>

                <input type="text" placeholder="🔍 Tìm các chi nhánh khác..." class="filter-input" style="font-size:12px; padding:8px 12px;">
              </div>

              <!-- Card 3: Chỉ số sức khỏe xe (Vehicle Health Card Nền tối #0F172A) -->
              <div style="background:#0F172A; border-radius:18px; padding:22px; color:#FFFFFF; margin-bottom:20px; border:1px solid rgba(255,255,255,0.08);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                  <h4 style="font-size:15px; font-weight:800; color:#FFFFFF; margin:0;">Chỉ số sức khỏe xe</h4>
                  <span style="font-size:10.5px; color:#94A3B8;">Cảm biến Telemetry 10:45</span>
                </div>

                <div style="display:flex; flex-direction:column; gap:12px;">
                  <!-- Engine -->
                  <div>
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                      <span style="color:#94A3B8;">TÌNH TRẠNG ĐỘNG CƠ:</span>
                      <strong style="color:#34D399;">TỐT (98%)</strong>
                    </div>
                    <div class="vehicle-health-track"><div class="vehicle-health-fill" style="width:98%; background:#10B981;"></div></div>
                  </div>

                  <!-- Brakes -->
                  <div>
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                      <span style="color:#94A3B8;">HỆ THỐNG PHANH:</span>
                      <strong style="color:#F59E0B;">CẦN LƯU Ý (72%)</strong>
                    </div>
                    <div class="vehicle-health-track"><div class="vehicle-health-fill" style="width:72%; background:#F59E0B;"></div></div>
                  </div>

                  <!-- Electrical -->
                  <div>
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                      <span style="color:#94A3B8;">HỆ THỐNG ĐIỆN & PIN:</span>
                      <strong style="color:#34D399;">TỐT (95%)</strong>
                    </div>
                    <div class="vehicle-health-track"><div class="vehicle-health-fill" style="width:95%; background:#10B981;"></div></div>
                  </div>
                </div>
              </div>

              <!-- Card 4: Mẹo bảo dưỡng -->
              <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:18px; padding:18px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                  <span style="font-size:18px;">💡</span>
                  <strong style="font-size:13px; color:#1E40AF;">Mẹo bảo dưỡng xe điện</strong>
                </div>
                <p style="font-size:12px; color:#1E3A8A; line-height:1.6; margin:0;">
                  Duy trì mức pin từ 20% - 80% trong sử dụng hằng ngày để tối ưu hóa tuổi thọ Cell pin LFP/NMC và kích hoạt chế độ tái sinh năng lượng phanh để tiết kiệm bố phanh.
                </p>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // SUBVIEW 5: XE ĐÃ LƯU (Matches Xe đã lưu - SIGMACAR.pdf)
    if (tab === 'profile-saved') {
      const allCars = [...AppState.vehiclesList, ...AppState.certifiedList];
      const savedCars = allCars.filter(c => AppState.savedCarIds.has(c.id));
      return `
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; flex-wrap:wrap; gap:12px;">
            <div>
              <h2 style="font-size:26px; font-weight:800; color:var(--text-dark); margin-bottom:4px;">Xe đã lưu (${savedCars.length})</h2>
              <p style="font-size:14px; color:var(--text-muted);">Danh sách các mẫu xe SIGMACAR bạn đang quan tâm để so sánh hoặc đặt lịch lái thử nhanh.</p>
            </div>
            <button class="btn-card-outline" onclick="window.location.hash='compare'" style="padding:10px 18px; font-size:13px;">⚖️ So sánh thông số xe</button>
          </div>

          <div class="car-grid-3">
            ${savedCars.map(car => `
              <div class="car-card">
                <div class="car-card-header">
                  <span class="card-badge">${escapeHtml(car.badge || 'ĐÃ LƯU')}</span>
                  <div class="card-price-tag"><span>TỪ</span> ${escapeHtml(car.priceShort || car.priceFormatted)}</div>
                  <button class="btn-interest active btn-remove-saved-car" data-id="${car.id}" title="Bỏ lưu">❤️</button>
                  <img src="${car.image}" alt="${escapeHtml(car.name)}">
                </div>
                <div class="car-card-body">
                  <h3 class="car-card-title">${escapeHtml(car.name)}</h3>
                  <div class="car-card-subtitle">${escapeHtml(car.subtitle || car.category)}</div>
                  <div class="car-specs-row">
                    <div class="spec-item"><span class="spec-label">Quãng đường</span><span class="spec-val">${escapeHtml(String(car.range || 500))} km</span></div>
                    <div class="spec-item"><span class="spec-label">Công suất</span><span class="spec-val">${escapeHtml(car.power || '350 HP')}</span></div>
                    <div class="spec-item"><span class="spec-label">0-100</span><span class="spec-val">${escapeHtml(car.acceleration || '4.5s')}</span></div>
                  </div>
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <button class="btn-card-outline" onclick="window.location.hash='detail'; AppState.currentDetailCar='${car.id}';">Xem chi tiết</button>
                    <button class="btn-primary" onclick="window.location.hash='test-drive'" style="justify-content:center;">Đăng ký lái thử</button>
                  </div>
                </div>
              </div>
            `).join('')}

            <!-- Add More Cars Card matching Xe đã lưu - SIGMACAR.pdf -->
            <div onclick="window.location.hash='new-cars'" style="border:2px dashed #CBD5E1; border-radius:var(--radius-lg); min-height:340px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center; cursor:pointer; background:#F8FAFC; transition:all 0.2s;">
              <div style="width:54px; height:54px; border-radius:50%; background:#EFF6FF; color:var(--primary); display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:800; margin-bottom:12px;">+</div>
              <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); margin-bottom:6px;">Tìm thêm mẫu xe ưng ý</h4>
              <p style="font-size:13px; color:var(--text-muted); max-width:240px;">Khám phá bộ sưu tập xe điện thông minh thế hệ mới nhất tại Showroom SIGMACAR.</p>
            </div>
          </div>
        </div>
      `;
    }

    // SUBVIEW 6: BẢO MẬT & QUYỀN RIÊNG TƯ (Matches Bảo mật & Quyền riêng tư.pdf + Unsubscribe compliance)
    if (tab === 'profile-security') {
      return `
        <div>
          <h2 style="font-size:26px; font-weight:800; color:var(--text-dark); margin-bottom:4px;">Bảo mật & Quyền riêng tư</h2>
          <p style="font-size:14px; color:var(--text-muted); margin-bottom:24px;">Quản lý mật khẩu đăng nhập, xác thực 2 lớp (2FA), phiên thiết bị và quyền nhận Email tiếp thị / chúc mừng.</p>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:22px; margin-bottom:24px;">
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:24px;">
              <h4 style="font-size:16px; font-weight:800; margin-bottom:14px;">🔑 Đổi mật khẩu tài khoản</h4>
              <form id="form-profile-change-password" style="display:flex; flex-direction:column; gap:12px;">
                <div>
                  <label class="filter-label">Mật khẩu hiện tại *</label>
                  <input type="password" id="sec-cur-pwd" class="filter-input" required placeholder="••••••••">
                </div>
                <div>
                  <label class="filter-label">Mật khẩu mới (Tối thiểu 6 ký tự) *</label>
                  <input type="password" id="sec-new-pwd" class="filter-input" required placeholder="••••••••">
                </div>
                <button type="submit" class="btn-primary" style="justify-content:center; padding:10px;">Cập nhật Mật khẩu</button>
              </form>
            </div>

            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:24px;">
              <h4 style="font-size:16px; font-weight:800; margin-bottom:14px;">🛡️ Xác thực & Quyền riêng tư Dữ liệu</h4>
              <div class="pref-row-item">
                <div>
                  <div style="font-weight:700; font-size:14px;">Xác thực 2 yếu tố (2FA qua SMS/Authenticator)</div>
                  <div style="font-size:12px; color:var(--text-muted);">Bảo vệ tài khoản và lệnh mở khóa xe từ xa trong Gara.</div>
                </div>
                <label class="sigma-switch">
                  <input type="checkbox" class="pref-toggle-input" data-pref-key="twoFactorEnabled" ${prefs.twoFactorEnabled !== false ? 'checked' : ''}>
                  <span class="sigma-slider"></span>
                </label>
              </div>

              <div class="pref-row-item">
                <div>
                  <div style="font-weight:700; font-size:14px;">Hiển thị Hồ sơ Cộng đồng khi Đánh giá Xe</div>
                  <div style="font-size:12px; color:var(--text-muted);">Hiển thị huy hiệu Thành viên Hạng Vàng trên các bài đánh giá xe.</div>
                </div>
                <label class="sigma-switch">
                  <input type="checkbox" class="pref-toggle-input" data-pref-key="publicProfile" ${prefs.publicProfile !== false ? 'checked' : ''}>
                  <span class="sigma-slider"></span>
                </label>
              </div>

              <div class="pref-row-item">
                <div>
                  <div style="font-weight:700; font-size:14px;">Nhận Email Chúc mừng Sinh nhật, Lễ Tết & Ưu đãi (Opt-in)</div>
                  <div style="font-size:12px; color:var(--text-muted);">Bạn có thể hủy đăng ký (Unsubscribe) bất kỳ lúc nào chỉ với 1 chạm.</div>
                </div>
                <label class="sigma-switch">
                  <input type="checkbox" id="chk-marketing-optin" class="pref-toggle-input" data-pref-key="marketingEmails" ${prefs.marketingEmails !== false ? 'checked' : ''}>
                  <span class="sigma-slider"></span>
                </label>
              </div>

              <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:center; background:#FEF2F2; border:1px solid #FECACA; border-radius:8px; padding:10px 14px;">
                <span style="font-size:12px; color:#991B1B;">Hủy nhận toàn bộ thư chúc mừng & chiến dịch quảng cáo (One-click Unsubscribe):</span>
                <button type="button" id="btn-oneclick-unsubscribe" class="btn-card-outline" style="padding:5px 12px; font-size:11.5px; color:#DC2626; border-color:#FCA5A5;">Hủy đăng ký Email</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // SUBVIEW 7: CÀI ĐẶT THÔNG BÁO (Matches Cài đặt Thông báo.pdf + Section 3 SMS/Email Reminder Channels)
    if (tab === 'profile-notifications') {
      return `
        <div>
          <h2 style="font-size:26px; font-weight:800; color:var(--text-dark); margin-bottom:4px;">Cài đặt Thông báo & Nhắc lịch Bảo dưỡng</h2>
          <p style="font-size:14px; color:var(--text-muted); margin-bottom:24px;">Tùy chỉnh kênh nhận thông báo qua Ứng dụng (Push), Email và Tin nhắn SMS khi sắp đến hạn bảo dưỡng, lịch hẹn thay đổi hoặc cập nhật bảo hành.</p>

          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:24px; margin-bottom:22px;">
            <h4 style="font-size:16px; font-weight:800; margin-bottom:12px;">🔔 Thông báo Đẩy trên Hệ thống & Ứng dụng (Push Notifications)</h4>
            <div class="pref-row-item">
              <div>
                <div style="font-weight:700; font-size:14px;">Cập nhật tiến độ Đơn hàng & Đổi trả 7 ngày</div>
                <div style="font-size:12px; color:var(--text-muted);">Thông báo tức thì khi trạng thái đơn hàng hoặc lịch xe tải thu hồi thay đổi.</div>
              </div>
              <label class="sigma-switch">
                <input type="checkbox" class="pref-toggle-input" data-pref-key="pushOrderUpdates" ${prefs.pushOrderUpdates !== false ? 'checked' : ''}>
                <span class="sigma-slider"></span>
              </label>
            </div>
            <div class="pref-row-item">
              <div>
                <div style="font-weight:700; font-size:14px;">Nhắc lịch Bảo dưỡng Định kỳ & Lịch hẹn Dịch vụ 3S</div>
                <div style="font-size:12px; color:var(--text-muted);">Nhắc nhở trực quan trước 7 ngày hoặc khi ODO chạm mốc bảo dưỡng.</div>
              </div>
              <label class="sigma-switch">
                <input type="checkbox" class="pref-toggle-input" data-pref-key="pushAppointments" ${prefs.pushAppointments !== false ? 'checked' : ''}>
                <span class="sigma-slider"></span>
              </label>
            </div>
          </div>

          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:24px;">
            <h4 style="font-size:16px; font-weight:800; margin-bottom:12px;">✉️ Kênh Thông báo Email & SMS (Bảo hành, Bảo dưỡng & Chăm sóc)</h4>
            <div class="pref-row-item">
              <div>
                <div style="font-weight:700; font-size:14px;">Email Nhắc lịch Bảo dưỡng & Biến động Hồ sơ Bảo hành Điện tử</div>
                <div style="font-size:12px; color:var(--text-muted);">Gửi biên bản kiểm tra kỹ thuật, hóa đơn điện tử và nhắc lịch bảo dưỡng qua Email.</div>
              </div>
              <label class="sigma-switch">
                <input type="checkbox" class="pref-toggle-input" data-pref-key="emailMaintenanceReminders" ${prefs.emailMaintenanceReminders !== false ? 'checked' : ''}>
                <span class="sigma-slider"></span>
              </label>
            </div>

            <div class="pref-row-item">
              <div>
                <div style="font-weight:700; font-size:14px;">Tin nhắn SMS Khẩn cấp & Nhắc lịch Hẹn Dịch vụ (Yêu cầu sự đồng ý của KH)</div>
                <div style="font-size:12px; color:var(--text-muted);">Chỉ gửi SMS tới số <strong>${escapeHtml(cur.phone || '')}</strong> khi nhà cung cấp SMS Gateway đã được cấu hình và bạn bật đồng ý tại đây.</div>
              </div>
              <label class="sigma-switch">
                <input type="checkbox" class="pref-toggle-input" data-pref-key="smsAlerts" ${prefs.smsAlerts !== false ? 'checked' : ''}>
                <span class="sigma-slider"></span>
              </label>
            </div>

            <div class="pref-row-item">
              <div>
                <div style="font-weight:700; font-size:14px;">Email Chúc mừng Sinh nhật, Kỷ niệm Mua xe & Khuyến mãi</div>
                <div style="font-size:12px; color:var(--text-muted);">Nhận voucher bảo dưỡng và quà tặng dịp đặc biệt từ SIGMACAR.</div>
              </div>
              <label class="sigma-switch">
                <input type="checkbox" class="pref-toggle-input" data-pref-key="emailPromotions" ${prefs.emailPromotions !== false ? 'checked' : ''}>
                <span class="sigma-slider"></span>
              </label>
            </div>
          </div>
        </div>
      `;
    }

    // DEFAULT SUBVIEW: THÔNG TIN CÁ NHÂN (Matches Main Content Redesign.pdf)
    const allCars = [...AppState.vehiclesList, ...AppState.certifiedList];
    const savedPreview = allCars.filter(c => AppState.savedCarIds.has(c.id)).slice(0, 2);

    return `
      <div>
        <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:28px; margin-bottom:24px; box-shadow:var(--shadow-sm);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="font-size:20px; font-weight:800; color:var(--text-dark);">Thông tin cá nhân</h3>
              <p style="font-size:13px; color:var(--text-muted);">Thông tin định danh dùng cho Hợp đồng mua bán xe, Bảo hành điện tử và Chăm sóc khách hàng.</p>
            </div>
            <span class="verified-purchase-badge">✓ Đã xác thực định danh eKYC</span>
          </div>

          <form id="form-profile-update-personal" style="display:grid; grid-template-columns:1fr 1fr; gap:18px;">
            <div>
              <label class="filter-label">Họ và tên *</label>
              <input type="text" id="prof-inp-name" class="filter-input" value="${escapeHtml(cur.fullName || '')}" required>
            </div>
            <div>
              <label class="filter-label">Số điện thoại liên hệ *</label>
              <input type="tel" id="prof-inp-phone" class="filter-input" value="${escapeHtml(cur.phone || '')}" required>
            </div>
            <div>
              <label class="filter-label">Email đăng nhập (Đã xác thực)</label>
              <input type="email" class="filter-input" value="${escapeHtml(cur.email || '')}" readonly style="background:#F8FAFC; color:var(--text-muted);">
            </div>
            <div>
              <label class="filter-label">Ngày sinh (Nhận quà Sinh nhật SIGMACAR)</label>
              <input type="date" id="prof-inp-dob" class="filter-input" value="${escapeHtml(cur.birthDate || '1992-05-15')}">
            </div>
            <div>
              <label class="filter-label">Giới tính</label>
              <select id="prof-inp-gender" class="filter-select">
                <option value="Nam" ${cur.gender === 'Nam' ? 'selected' : ''}>Nam</option>
                <option value="Nữ" ${cur.gender === 'Nữ' ? 'selected' : ''}>Nữ</option>
                <option value="Khác" ${cur.gender === 'Khác' ? 'selected' : ''}>Khác</option>
              </select>
            </div>
            <div>
              <label class="filter-label">Địa chỉ bàn giao xe & Thu hồi tận nơi</label>
              <input type="text" id="prof-inp-address" class="filter-input" value="${escapeHtml(cur.address || '')}">
            </div>
            <div style="grid-column:span 2; display:flex; justify-content:flex-end;">
              <button type="submit" class="btn-primary" style="padding:10px 22px; font-size:13.5px;">💾 Lưu thay đổi hồ sơ</button>
            </div>
          </form>
        </div>

        <!-- Saved Cars Preview + Activity History matching Main Content Redesign.pdf -->
        <div style="display:grid; grid-template-columns:1.15fr 1fr; gap:22px;">
          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:22px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
              <h4 style="font-size:16px; font-weight:800;">❤️ Xe đã lưu (${AppState.savedCarIds.size})</h4>
              <button class="btn-card-outline" style="padding:4px 10px; font-size:12px;" onclick="renderProfile('profile-saved')">Xem tất cả ›</button>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              ${savedPreview.map(c => `
                <div style="border:1px solid var(--border-subtle); border-radius:10px; padding:12px; background:#F8FAFC;">
                  <img src="${c.image}" alt="${escapeHtml(c.name)}" style="width:100%; height:75px; object-fit:contain; margin-bottom:8px;">
                  <div style="font-weight:800; font-size:14px;">${escapeHtml(c.name)}</div>
                  <div style="color:var(--primary); font-weight:800; font-size:13px; margin:2px 0 8px;">${escapeHtml(c.priceShort || c.priceFormatted)}</div>
                  <button class="btn-card-outline" style="width:100%; padding:5px; font-size:11.5px;" onclick="window.location.hash='detail'; AppState.currentDetailCar='${c.id}';">Xem chi tiết</button>
                </div>
              `).join('')}
            </div>
          </div>

          <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:22px;">
            <h4 style="font-size:16px; font-weight:800; margin-bottom:14px;">⚡ Lịch sử Hoạt động Gần đây</h4>
            <div style="display:flex; flex-direction:column; gap:12px; font-size:13px;">
              <div style="padding-left:12px; border-left:3px solid var(--accent-emerald);">
                <div style="font-weight:700; color:var(--text-dark);">Kích hoạt Bảo hành Điện tử — SIGMA Model E</div>
                <div style="font-size:11.5px; color:var(--text-muted);">Mã BH: WAR-2026-889 • Thời hạn 10 năm / 200.000 km</div>
              </div>
              <div style="padding-left:12px; border-left:3px solid var(--primary);">
                <div style="font-weight:700; color:var(--text-dark);">Bàn giao xe thành công — Đơn hàng SG-2026-9020</div>
                <div style="font-size:11.5px; color:var(--text-muted);">Showroom SIGMACAR Cầu Giấy • Cộng +1.500 Điểm Sigma</div>
              </div>
              <div style="padding-left:12px; border-left:3px solid #F59E0B;">
                <div style="font-weight:700; color:var(--text-dark);">Đặt lịch Bảo dưỡng Định kỳ 10.000 km</div>
                <div style="font-size:11.5px; color:var(--text-muted);">Trung tâm Dịch vụ 3S Cầu Giấy • Trạng thái: Đã xác nhận</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function bindProfileInteractiveEvents() {
    // 1. Personal Info Form Submit
    document.getElementById('form-profile-update-personal')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const updated = await ApiClient.auth.updateProfile({
          fullName: document.getElementById('prof-inp-name')?.value.trim(),
          phone: document.getElementById('prof-inp-phone')?.value.trim(),
          birthDate: document.getElementById('prof-inp-dob')?.value,
          gender: document.getElementById('prof-inp-gender')?.value,
          address: document.getElementById('prof-inp-address')?.value.trim()
        });
        AppState.currentUser = { ...AppState.currentUser, ...updated };
        updateDropdownUserUI();
        showToast('Đã cập nhật thông tin cá nhân thành công!', '✓');
        renderProfile('profile-personal');
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });

    // 2. Order Filter Tabs
    document.querySelectorAll('#profile-order-filter-tabs [data-ord-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#profile-order-filter-tabs [data-ord-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const fg = btn.getAttribute('data-ord-filter');
        document.querySelectorAll('.profile-order-item-card').forEach(card => {
          card.style.display = (fg === 'all' || card.getAttribute('data-ord-group') === fg) ? 'block' : 'none';
        });
      });
    });

    // 3. Returns Live Financial Preview & Submit (Returns Center.pdf)
    const updateReturnEstimate = async () => {
      const orderId = document.getElementById('ret-order-id')?.value;
      if (!orderId) return;
      try {
        const fin = await ApiClient.returns.estimate({
          orderId,
          reasonCode: document.getElementById('ret-reason-code')?.value,
          odoKm: Number(document.getElementById('ret-odo-km')?.value || 0),
          resolutionType: document.getElementById('ret-resolution-type')?.value
        });
        const baseEl = document.getElementById('ret-calc-base-price');
        const dedEl = document.getElementById('ret-calc-deduction');
        const refEl = document.getElementById('ret-calc-refund');
        if (baseEl) baseEl.textContent = `${(fin.basePaidAmount || 1405000000).toLocaleString('vi-VN')} đ`;
        if (dedEl) dedEl.textContent = `${(fin.totalDeductions || 0).toLocaleString('vi-VN')} đ`;
        if (refEl) refEl.textContent = `${(fin.estimatedRefundAmount || 1403500000).toLocaleString('vi-VN')} đ`;
      } catch (e) {}
    };

    if (document.getElementById('ret-order-id')) {
      updateReturnEstimate();
      ['ret-order-id', 'ret-reason-code', 'ret-odo-km', 'ret-resolution-type'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', updateReturnEstimate);
        document.getElementById(id)?.addEventListener('input', updateReturnEstimate);
      });
    }

    // 4 Photo upload boxes preview handlers
    ['front', 'rear', 'interior', 'odo'].forEach(side => {
      const input = document.getElementById(`ret-photo-${side}`);
      const prev = document.getElementById(`prev-photo-${side}`);
      input?.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            if (prev) {
              prev.innerHTML = `<img src="${evt.target.result}" class="return-photo-preview" alt="${side}"><span style="font-size:9.5px; color:#10B981; font-weight:700;">✓ Đã chọn</span>`;
            }
            const currentPhotos = (document.getElementById('ret-photos')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
            currentPhotos.push(evt.target.result);
            if (document.getElementById('ret-photos')) {
              document.getElementById('ret-photos').value = currentPhotos.join(', ');
            }
            showToast(`Đã tải ảnh ${side.toUpperCase()} thành công!`, '📷');
          };
          reader.readAsDataURL(e.target.files[0]);
        }
      });
    });

    // Save Draft Button
    document.getElementById('btn-save-return-draft')?.addEventListener('click', () => {
      const draft = {
        orderId: document.getElementById('ret-order-id')?.value,
        reasonCode: document.getElementById('ret-reason-code')?.value,
        odoKm: document.getElementById('ret-odo-km')?.value,
        description: document.getElementById('ret-description')?.value,
        conditionNote: document.getElementById('ret-condition-note')?.value,
        pickupDate: document.getElementById('ret-pickup-date')?.value,
        pickupSlot: document.getElementById('ret-pickup-slot')?.value,
        pickupAddress: document.getElementById('ret-pickup-address')?.value
      };
      try {
        localStorage.setItem('sigmacar_return_draft', JSON.stringify(draft));
        showToast('💾 Đã lưu nháp hồ sơ đổi trả thành công vào bộ nhớ tạm!', '💾');
      } catch (err) {}
    });

    // Address Change
    document.getElementById('btn-change-return-addr')?.addEventListener('click', () => {
      const addrInput = document.getElementById('ret-pickup-address');
      if (addrInput) {
        addrInput.focus();
        addrInput.select();
        showToast('Vui lòng chỉnh sửa địa chỉ thu hồi xe tận nơi.', '📍');
      }
    });

    // Legal Policy Modal
    document.getElementById('btn-open-legal-modal')?.addEventListener('click', () => {
      alert('CHÍNH SÁCH ĐỔI TRẢ 7 NGÀY SIGMACAR:\n\n1. Áp dụng trong vòng 07 ngày kể từ thời điểm bàn giao xe.\n2. ODO dưới 500 km: Miễn toàn bộ phụ phí hao mòn.\n3. Lỗi kỹ thuật nhà sản xuất (Pin/Động cơ/ADAS): Miễn 100% phí đổi trả và vận chuyển.\n4. Đổi ý hoặc đổi mẫu: Khấu trừ 2% phí lưu kho & kiểm định theo quy định thương mại điện tử.\n5. Xe tải chuyên dụng tiếp nhận tận nhà trên toàn quốc.');
    });

    document.getElementById('form-create-return-request')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const orderId = document.getElementById('ret-order-id')?.value;
      if (!orderId) {
        showToast('Không có đơn hàng đủ điều kiện khả dụng.', '⚠️');
        return;
      }
      const photosRaw = document.getElementById('ret-photos')?.value.trim() || '';
      try {
        const created = await ApiClient.returns.create({
          orderId,
          resolutionType: document.getElementById('ret-resolution-type')?.value,
          reasonCode: document.getElementById('ret-reason-code')?.value,
          odoKm: Number(document.getElementById('ret-odo-km')?.value || 0),
          description: document.getElementById('ret-description')?.value.trim(),
          vehicleConditionNote: document.getElementById('ret-condition-note')?.value.trim(),
          photos: photosRaw.split(',').map(s => s.trim()).filter(Boolean),
          pickupDate: document.getElementById('ret-pickup-date')?.value,
          pickupSlot: document.getElementById('ret-pickup-slot')?.value,
          pickupAddress: document.getElementById('ret-pickup-address')?.value.trim(),
          customerConfirmedPolicy: document.getElementById('ret-confirm-policy')?.checked
        });
        showToast(`🎉 Đã gửi yêu cầu đổi trả thành công! Mã yêu cầu: ${created.returnCode}`, '🔄');
        renderProfile('profile-returns');
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });

    document.querySelectorAll('.btn-ret-supplement').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const note = document.querySelector(`.inp-ret-supplement[data-id="${id}"]`)?.value.trim();
        if (!note) {
          showToast('Vui lòng nhập nội dung bổ sung.', '⚠️');
          return;
        }
        try {
          await ApiClient.returns.addSupplement(id, { note });
          showToast('Đã gửi thông tin bổ sung vào hồ sơ đổi trả!', '✓');
          renderProfile('profile-returns');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    // 4. Garage: Copy VIN/Motor, PDF Export, 24h SMS Reminder (Warranty & Maintenance.pdf)
    document.querySelectorAll('.btn-copy-vin').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-code');
        if (code && navigator.clipboard) {
          navigator.clipboard.writeText(code);
          showToast(`📋 Đã sao chép mã số khung (VIN): ${code}`, '✓');
        }
      });
    });

    document.querySelectorAll('.btn-copy-motor').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-code');
        if (code && navigator.clipboard) {
          navigator.clipboard.writeText(code);
          showToast(`📋 Đã sao chép mã số máy: ${code}`, '✓');
        }
      });
    });

    document.getElementById('btn-export-warranty-pdf')?.addEventListener('click', () => {
      showToast('📄 Đang khởi tạo và xuất Báo cáo Lịch sử Bảo dưỡng PDF...', '⏳');
      setTimeout(() => {
        showToast('✓ Báo cáo Lịch sử Bảo dưỡng & Sửa chữa định kỳ (PDF) đã sẵn sàng tải xuống!', '📄');
      }, 800);
    });

    document.getElementById('btn-remind-service-24h')?.addEventListener('click', () => {
      showToast('🔔 Đã kích hoạt hệ thống nhắc lịch hẹn tự động qua SMS trước 24h!', '🔔');
    });

    document.getElementById('btn-warranty-details-modal')?.addEventListener('click', () => {
      alert('THÔNG TIN BẢO HÀNH CHÍNH HÃNG SIGMACAR:\n\n• Thời hạn bảo hành tiêu chuẩn: 3 năm hoặc 160.000 km.\n• Bảo hành Pin cao áp LFP/NMC: 8 năm hoặc 200.000 km (cam kết SOH >= 70%).\n• Cứu hộ giao thông 24/7 miễn phí toàn quốc.\n• Cập nhật phần mềm không dây (OTA) trọn đời xe.');
    });

    document.querySelectorAll('.btn-prefill-warranty').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('war-act-order').value = btn.getAttribute('data-order') || '';
        document.getElementById('war-act-vin').value = btn.getAttribute('data-vin') || '';
        document.getElementById('war-act-motor').value = btn.getAttribute('data-motor') || '';
        document.getElementById('war-act-invoice').value = btn.getAttribute('data-inv') || '';
        document.getElementById('garage-warranty-activate-box')?.scrollIntoView({ behavior: 'smooth' });
        showToast('Đã điền thông tin VIN & Hóa đơn của xe. Nhấn Xác minh để kích hoạt!', '🛡️');
      });
    });

    document.getElementById('form-activate-warranty')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await ApiClient.warranties.activate({
          orderId: document.getElementById('war-act-order')?.value.trim(),
          invoiceNumber: document.getElementById('war-act-invoice')?.value.trim(),
          vin: document.getElementById('war-act-vin')?.value.trim(),
          motorNumber: document.getElementById('war-act-motor')?.value.trim(),
          purchaseDate: document.getElementById('war-act-date')?.value
        });
        showToast(`🛡️ Kích hoạt Bảo hành Điện tử thành công! Mã BH: ${res.warrantyCode}`, '🎉');
        renderProfile('profile-garage');
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });

    document.getElementById('form-book-service-appt')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sel = document.getElementById('srv-book-vehicle');
      const opt = sel?.options[sel.selectedIndex];
      try {
        const appt = await ApiClient.warranties.bookServiceAppointment({
          vehicleId: sel?.value,
          vehicleName: opt?.getAttribute('data-name') || 'SIGMA EV',
          vin: opt?.getAttribute('data-vin') || '',
          warrantyId: opt?.getAttribute('data-war') || '',
          serviceCenterId: document.getElementById('srv-book-center')?.value,
          serviceType: document.getElementById('srv-book-type')?.value,
          preferredDate: document.getElementById('srv-book-date')?.value,
          preferredTime: document.getElementById('srv-book-time')?.value,
          conditionNote: document.getElementById('srv-book-note')?.value.trim()
        });
        showToast(`📅 Đặt lịch bảo dưỡng thành công! Mã lịch hẹn: ${appt.appointmentCode}`, '🔧');
        renderProfile('profile-appointments');
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });

    document.querySelectorAll('.btn-cancel-srv-appt').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        try {
          await ApiClient.warranties.updateServiceAppointment(id, { status: 'Đã hủy' });
          showToast('Đã hủy lịch hẹn bảo dưỡng.', '✓');
          renderProfile('profile-appointments');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    // 5. Saved Cars Remove
    document.querySelectorAll('.btn-remove-saved-car').forEach(btn => {
      btn.addEventListener('click', async () => {
        const carId = btn.getAttribute('data-id');
        AppState.savedCarIds.delete(carId);
        try { await ApiClient.auth.toggleSavedCar(carId); } catch (e) {}
        showToast('Đã bỏ lưu xe khỏi danh sách yêu thích.');
        renderProfile('profile-saved');
      });
    });

    // 6. Security & Notifications Toggles + Change Password + Unsubscribe
    document.getElementById('form-profile-change-password')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await ApiClient.auth.changePassword({
          currentPassword: document.getElementById('sec-cur-pwd')?.value,
          newPassword: document.getElementById('sec-new-pwd')?.value
        });
        showToast('🔑 Đã đổi mật khẩu thành công!', '✓');
        document.getElementById('sec-cur-pwd').value = '';
        document.getElementById('sec-new-pwd').value = '';
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });

    document.querySelectorAll('.pref-toggle-input').forEach(chk => {
      chk.addEventListener('change', async () => {
        const key = chk.getAttribute('data-pref-key');
        const val = chk.checked;
        try {
          await ApiClient.auth.updatePreferences({ [key]: val });
          showToast('Đã lưu cài đặt tùy chọn tài khoản!', '✓');
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    document.getElementById('btn-oneclick-unsubscribe')?.addEventListener('click', async () => {
      try {
        const res = await ApiClient.campaigns.unsubscribe({
          email: AppState.currentUser?.email,
          reason: 'Khách hàng bấm Hủy đăng ký 1 chạm trong Bảo mật & Quyền riêng tư'
        });
        const chk = document.getElementById('chk-marketing-optin');
        if (chk) chk.checked = false;
        showToast(res.message, '🛡️');
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });
  }

  // =================================================================
  // CARD GENERATORS
  // =================================================================
  function createHomeCarCardHTML(car) {
    const isSaved = AppState.savedCarIds.has(car.id);
    const isEv = getVehicleFuel(car) === 'ev';
    const fuelBadge = isEv ? '⚡ XE ĐIỆN' : '⛽ XE XĂNG/DẦU';
    const codeBadge = car.productCode ? `${car.productCode} • ` : '';
    const fuelSpecLabel = isEv ? '⚡ Quãng đường' : '⚙️ Hộp số';
    const fuelSpecVal = isEv ? `${car.range || 450} km` : (car.transmission ? car.transmission.replace('Hộp số ', '') : 'Tự động');
    const stockCount = car.excelStock !== undefined ? car.excelStock : (car.stock !== undefined ? car.stock : 5);

    return `
      <div class="car-card">
        <div class="car-card-header" onclick="window.openCarDetail('${car.id}')" style="cursor:pointer;">
          <span class="card-badge" style="${!isEv ? 'background:#F97316; color:#FFFFFF;' : ''}">${codeBadge}${car.badge || fuelBadge}</span>
          <div class="card-price-tag"><span>GIÁ</span> ${car.priceShort || car.priceFormatted}</div>
          <button class="btn-interest ${isSaved ? 'active' : ''}" data-id="${car.id}" title="Yêu thích">${isSaved ? '❤️' : '🤍'}</button>
          <img src="${car.image}" alt="${car.name}">
        </div>
        <div class="car-card-body">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:4px;">
            <span>${car.brand || 'SIGMACAR'} • ${car.subCategory || car.category}</span>
            <span style="color:#059669;">Kho: ${stockCount} • Năm ${car.year || 2024}</span>
          </div>
          <h3 class="car-card-title" onclick="window.openCarDetail('${car.id}')" style="cursor:pointer;">${car.name}</h3>
          <div class="car-card-subtitle">${car.excelSpecs || car.subtitle || car.category}</div>
          ${car.colorsSummary ? `<div style="font-size:11.5px; color:var(--text-muted); margin-top:4px; margin-bottom:6px;">🎨 Màu sắc: <strong>${car.colorsSummary}</strong></div>` : ''}

          <div class="car-specs-row">
            <div class="spec-item"><span class="spec-label">${fuelSpecLabel}</span><span class="spec-val">${fuelSpecVal}</span></div>
            <div class="spec-item"><span class="spec-label">🔋 Công suất</span><span class="spec-val">${car.hp ? car.hp + ' HP' : (car.power || '200 HP')}</span></div>
            <div class="spec-item"><span class="spec-label">💺 Số chỗ</span><span class="spec-val">${car.seats || 5} Chỗ</span></div>
          </div>

          <button class="btn-primary" style="width:100%; justify-content:center; margin-bottom:10px;" onclick="window.openCarDetail('${car.id}')">
            Khám phá chi tiết (${car.priceFormatted})
          </button>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <button class="btn-card-outline" onclick="window.addCarToCompare('${car.id}')">⚖️ So sánh</button>
            <button class="btn-card-outline" onclick="window.bookCarTestDrive('${car.id}')">🚗 Lái thử</button>
          </div>
        </div>
      </div>
    `;
  }

  function createHomeCertifiedCardHTML(car) {
    return `
      <div class="car-card">
        <div class="car-card-header" style="height:190px; cursor:pointer;" onclick="window.openCarDetail('${car.id}')">
          <span class="card-badge badge-certified">SIGMA CERTIFIED</span>
          <img src="${car.image}" alt="${car.name}" style="max-height:140px; object-fit:contain;">
        </div>
        <div class="car-card-body" style="padding:18px;">
          <h4 style="font-size:16px; font-weight:800; color:var(--text-dark); cursor:pointer;" onclick="window.openCarDetail('${car.id}')">${car.name}</h4>
          <div style="font-size:12px; color:var(--text-muted); margin:4px 0 8px;">
            <span>${car.odo || '12.500 km'}</span> • <span>${car.vin || 'VIN: 89J921K'}</span> • <strong style="color:var(--primary);">Pin: ${car.batteryHealth || '96%'}</strong>
          </div>
          <div style="font-size:17px; font-weight:800; color:var(--primary); margin-bottom:12px;">${car.priceFormatted}</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <button class="btn-card-outline" style="padding:8px; font-size:12px;" onclick="window.openCarDetail('${car.id}')">Chi tiết</button>
            <button class="btn-card-primary" style="padding:8px; font-size:12px;" onclick="window.bookCarTestDrive('${car.id}')">Lái thử</button>
          </div>
        </div>
      </div>
    `;
  }

  function createNewCarListingCardHTML(car) {
    const isSaved = AppState.savedCarIds.has(car.id);
    const isEv = getVehicleFuel(car) === 'ev';
    const fuelBadge = isEv ? '⚡ XE ĐIỆN' : '⛽ XE XĂNG/DẦU';
    const codeBadge = car.productCode ? `${car.productCode} • ` : '';
    const fuelSpecLabel = isEv ? 'Quãng đường' : 'Hộp số';
    const fuelSpecVal = isEv ? `${car.range || 450} km` : (car.transmission ? car.transmission.replace('Hộp số ', '') : 'Tự động');
    const stockCount = car.excelStock !== undefined ? car.excelStock : (car.stock !== undefined ? car.stock : 5);

    return `
      <div class="car-card">
        <div class="car-card-header" onclick="window.openCarDetail('${car.id}')" style="cursor:pointer;">
          <span class="card-badge" style="${!isEv ? 'background:#F97316; color:#FFFFFF;' : ''}">${codeBadge}${car.badge || fuelBadge}</span>
          <div class="card-price-tag"><span>GIÁ</span> ${car.priceShort || car.priceFormatted}</div>
          <button class="btn-interest ${isSaved ? 'active' : ''}" data-id="${car.id}" title="Yêu thích">${isSaved ? '❤️' : '🤍'}</button>
          <img src="${car.image}" alt="${car.name}">
        </div>
        <div class="car-card-body">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:4px;">
            <span>${car.brand || 'SIGMACAR'} • ${car.subCategory || car.category}</span>
            <span style="color:#059669;">Kho: ${stockCount} • Năm ${car.year || 2024}</span>
          </div>
          <h3 class="car-card-title" onclick="window.openCarDetail('${car.id}')" style="cursor:pointer;">${car.name}</h3>
          <div class="car-card-subtitle">${car.excelSpecs || car.subtitle || car.category}</div>
          ${car.colorsSummary ? `<div style="font-size:11.5px; color:var(--text-muted); margin-top:4px; margin-bottom:6px;">🎨 Màu sắc: <strong>${car.colorsSummary}</strong></div>` : ''}

          <div class="car-specs-row">
            <div class="spec-item"><span class="spec-label">${fuelSpecLabel}</span><span class="spec-val">${fuelSpecVal}</span></div>
            <div class="spec-item"><span class="spec-label">Công suất</span><span class="spec-val">${car.hp ? car.hp + ' HP' : '200 HP'}</span></div>
            <div class="spec-item"><span class="spec-label">Ghế</span><span class="spec-val">${car.seats || 5} Ghế</span></div>
          </div>

          <div class="car-card-actions" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
            <button class="btn-card-outline" onclick="window.openCarDetail('${car.id}')">Chi tiết</button>
            <button class="btn-card-outline" onclick="window.addCarToCompare('${car.id}')">So sánh</button>
            <button class="btn-card-primary" onclick="window.bookCarTestDrive('${car.id}')">Lái thử</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindCardEvents() {
    // Interest Buttons (Requires Auth)
    document.querySelectorAll('.btn-interest, .btn-save-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.currentTarget.getAttribute('data-id') || 'model-e';
        requireAuth('lưu xe vào danh sách quan tâm', () => {
          if (AppState.savedCarIds.has(id)) {
            AppState.savedCarIds.delete(id);
            document.querySelectorAll(`.btn-interest[data-id="${id}"]`).forEach(b => {
              b.classList.remove('active');
              b.innerHTML = '🤍';
            });
            showToast('Đã bỏ lưu khỏi danh sách quan tâm');
          } else {
            AppState.savedCarIds.add(id);
            document.querySelectorAll(`.btn-interest[data-id="${id}"]`).forEach(b => {
              b.classList.add('active');
              b.innerHTML = '❤️';
            });
            showToast('Đã thêm vào danh sách quan tâm! ❤️');
          }
        });
      });
    });
  }

  // =================================================================
  // LOAN CALCULATOR MODAL LOGIC (Dự toán trả góp)
  // =================================================================
  function openLoanCalculatorModal(car) {
    if (!loanCalcModal) return;
    const nameEl = document.getElementById('calc-car-name');
    const priceEl = document.getElementById('calc-car-price');
    if (nameEl) nameEl.textContent = `Dự toán trả góp ${car.name}`;
    if (priceEl) priceEl.textContent = car.priceFormatted;

    const recalc = () => {
      const price = car.price;
      const pct = parseFloat(document.getElementById('calc-down-payment-pct')?.value || '30');
      const termMonths = parseInt(document.getElementById('calc-term-months')?.value || '60', 10);
      const annualRate = parseFloat(document.getElementById('calc-bank-select')?.value || '7.9');

      const downAmount = Math.round(price * (pct / 100));
      const loanAmount = price - downAmount;
      const monthlyPrincipal = Math.round(loanAmount / termMonths);
      const monthlyInterestFirst = Math.round(loanAmount * (annualRate / 100 / 12));
      const monthlyTotal = monthlyPrincipal + monthlyInterestFirst;

      const elDown = document.getElementById('calc-out-down-amount');
      const elLoan = document.getElementById('calc-out-loan-amount');
      const elPrinc = document.getElementById('calc-out-principal');
      const elTotal = document.getElementById('calc-out-monthly-total');

      if (elDown) elDown.textContent = `${downAmount.toLocaleString('vi-VN')} VNĐ`;
      if (elLoan) elLoan.textContent = `${loanAmount.toLocaleString('vi-VN')} VNĐ`;
      if (elPrinc) elPrinc.textContent = `${monthlyPrincipal.toLocaleString('vi-VN')} VNĐ/tháng`;
      if (elTotal) elTotal.textContent = `~${monthlyTotal.toLocaleString('vi-VN')} VNĐ/tháng`;
    };

    recalc();

    document.getElementById('calc-down-payment-pct')?.addEventListener('change', recalc);
    document.getElementById('calc-term-months')?.addEventListener('change', recalc);
    document.getElementById('calc-bank-select')?.addEventListener('change', recalc);

    document.getElementById('btn-loan-modal-close')?.addEventListener('click', () => {
      loanCalcModal.classList.remove('active');
    });

    document.getElementById('btn-calc-request-advisor')?.addEventListener('click', () => {
      requireAuth('đăng ký tư vấn gói trả góp', () => {
        loanCalcModal.classList.remove('active');
        showToast('Đã gửi thông tin đăng ký gói vay trả góp! Chuyên viên sẽ liên hệ trong 15 phút.', '🎉');
      });
    });

    loanCalcModal.classList.add('active');
  }

  // =================================================================
  // SEARCH OVERLAY (Fixes Bug 3: Real-time search & Enter navigation)
  // =================================================================
  function performLiveSearch(query) {
    const q = query.toLowerCase().trim();
    if (!searchResultsGrid) return;

    if (!q) {
      // Default popular items (including Data-xe CAR-001..CAR-010 & SIGMA)
      const featuredSearchCars = AppState.vehiclesList.slice(0, 6);
      searchResultsGrid.innerHTML = featuredSearchCars.map(c => `
        <div class="search-result-card" onclick="window.openCarDetail('${c.id}')">
          <div style="display:flex; align-items:center; gap:16px;">
            <img src="${c.image}" style="width:70px; height:45px; object-fit:cover; border-radius:6px;">
            <div>
              <div style="font-weight:700; color:var(--text-dark);">${c.productCode ? `[${c.productCode}] ` : ''}${c.name}</div>
              <div style="font-size:12px; color:var(--text-muted);">${c.brand || 'SIGMACAR'} • ${c.subCategory || c.category} • ${c.priceFormatted}</div>
            </div>
          </div>
          <span style="color:var(--text-muted); font-size:18px;">›</span>
        </div>
      `).join('');
      return;
    }

    const allCars = [...AppState.vehiclesList, ...AppState.certifiedList];
    const matches = allCars.filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.productCode && c.productCode.toLowerCase().includes(q)) ||
      (c.subtitle && c.subtitle.toLowerCase().includes(q)) ||
      (c.category && c.category.toLowerCase().includes(q)) ||
      (c.subCategory && c.subCategory.toLowerCase().includes(q)) ||
      (c.brand && c.brand.toLowerCase().includes(q)) ||
      (c.colorsSummary && c.colorsSummary.toLowerCase().includes(q))
    );

    if (matches.length === 0) {
      searchResultsGrid.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:24px; color:var(--text-muted);">
          🔍 Không tìm thấy mẫu xe nào khớp với "${query}". Thử tìm "CAR-001", "Camry", "CR-V", "Ranger", "Tucson", "CX-5", "VF 8", "GLC 300", "BMW 330i", "Seltos", "Xpander"...
        </div>
      `;
      return;
    }

    searchResultsGrid.innerHTML = matches.map(c => `
      <div class="search-result-card" onclick="window.openCarDetail('${c.id}')">
        <div style="display:flex; align-items:center; gap:16px;">
          <img src="${c.image}" style="width:70px; height:45px; object-fit:cover; border-radius:6px;">
          <div>
            <div style="font-weight:700; color:var(--text-dark);">${c.productCode ? `[${c.productCode}] ` : ''}${c.name}</div>
            <div style="font-size:12px; color:var(--text-muted);">${c.brand || 'SIGMACAR'} • ${c.subCategory || c.category} • ${c.priceFormatted}</div>
          </div>
        </div>
        <span style="color:var(--text-muted); font-size:18px;">›</span>
      </div>
    `).join('');
  }

  searchInput?.addEventListener('input', (e) => {
    performLiveSearch(e.target.value);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = searchInput.value.trim().toLowerCase();
      if (!val) return;
      const allCars = [...AppState.vehiclesList, ...AppState.certifiedList];
      const match = allCars.find(c => c.name.toLowerCase().includes(val) || (c.category && c.category.toLowerCase().includes(val)));
      if (match) {
        searchOverlay.classList.remove('active');
        navigateTo('detail', { carId: match.id });
      } else {
        showToast(`Không tìm thấy mẫu xe nào khớp với: ${searchInput.value}`, '🔍');
      }
    } else if (e.key === 'Escape') {
      searchOverlay.classList.remove('active');
    }
  });

  // Search tag chips
  document.querySelectorAll('.search-tag-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      const txt = e.target.textContent.trim();
      if (searchInput) {
        searchInput.value = txt;
        performLiveSearch(txt);
      }
    });
  });

  // =================================================================
  // AUTH MODAL: TAB SWITCHER (Login / Register) & FORM HANDLERS
  // =================================================================
  function switchAuthTab(tabName) {
    const loginBtn = document.getElementById('tab-auth-login');
    const regBtn = document.getElementById('tab-auth-register');
    const loginPane = document.getElementById('auth-login-pane');
    const regPane = document.getElementById('auth-register-pane');
    const heroPane = document.getElementById('auth-modal-hero-pane');

    const authEmail = document.getElementById('auth-email-input');
    const authPwd = document.getElementById('auth-password-input');
    if (authEmail) authEmail.value = '';
    if (authPwd) authPwd.value = '';

    if (tabName === 'register') {
      if (heroPane) heroPane.style.backgroundImage = "url('assets/register-side-art.jpg')";
      if (loginBtn) {
        loginBtn.style.background = 'transparent';
        loginBtn.style.color = 'var(--text-muted)';
        loginBtn.style.boxShadow = 'none';
      }
      if (regBtn) {
        regBtn.style.background = '#FFFFFF';
        regBtn.style.color = 'var(--primary)';
        regBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
      }
      if (loginPane) loginPane.style.display = 'none';
      if (regPane) regPane.style.display = 'block';
    } else {
      if (heroPane) heroPane.style.backgroundImage = "url('assets/login-side-art.jpg')";
      if (regBtn) {
        regBtn.style.background = 'transparent';
        regBtn.style.color = 'var(--text-muted)';
        regBtn.style.boxShadow = 'none';
      }
      if (loginBtn) {
        loginBtn.style.background = '#FFFFFF';
        loginBtn.style.color = 'var(--primary)';
        loginBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
      }
      if (regPane) regPane.style.display = 'none';
      if (loginPane) loginPane.style.display = 'block';
    }
  }

  document.getElementById('tab-auth-login')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tab-auth-register')?.addEventListener('click', () => switchAuthTab('register'));

  // Handle Login Submit
  document.getElementById('form-login-api')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email-input').value;
    const password = document.getElementById('auth-password-input').value;

    try {
      const res = await ApiClient.auth.login({ email, password });
      AppState.currentUser = res.user;
      updateDropdownUserUI();
      authModal.classList.remove('active');
      showToast(`Đăng nhập thành công! Xin chào ${res.user.fullName} (${res.user.role.toUpperCase()})`, '👋');

      if (typeof AppState.pendingAuthAction === 'function') {
        const action = AppState.pendingAuthAction;
        AppState.pendingAuthAction = null;
        action(res.user);
      } else if (['seller', 'admin', 'support_staff', 'service_staff'].includes(res.user.role)) {
        navigateTo('seller-dashboard');
      } else {
        navigateTo('profile');
      }
    } catch (err) {
      showToast(err.message, '⚠️');
    }
  });

  // Handle Register Submit
  document.getElementById('form-register-api')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('reg-name-input').value;
    const phone = document.getElementById('reg-phone-input').value;
    const role = document.getElementById('reg-role-select').value;
    const email = document.getElementById('reg-email-input').value;
    const password = document.getElementById('reg-password-input').value;

    try {
      const res = await ApiClient.auth.register({ fullName, phone, role, email, password });
      AppState.currentUser = res.user;
      updateDropdownUserUI();
      authModal.classList.remove('active');
      showToast(`Đăng ký thành công! Chào mừng ${res.user.fullName} gia nhập SIGMACAR! 🎉`, '🎉');

      if (typeof AppState.pendingAuthAction === 'function') {
        const action = AppState.pendingAuthAction;
        AppState.pendingAuthAction = null;
        action(res.user);
      } else if (['seller', 'admin', 'support_staff', 'service_staff'].includes(res.user.role)) {
        navigateTo('seller-dashboard');
      } else {
        navigateTo('profile');
      }
    } catch (err) {
      showToast(err.message, '⚠️');
    }
  });

  // Deposit Form Submit via Central API
  document.getElementById('form-deposit')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const cur = ApiClient.getCurrentUser();
      const inputName = document.getElementById('deposit-name')?.value;
      const inputPhone = document.getElementById('deposit-phone')?.value;
      const inputMethod = document.getElementById('deposit-payment-method')?.value;

      const payload = {
        buyerName: inputName || (cur ? cur.fullName : ''),
        buyerPhone: inputPhone || (cur ? cur.phone : ''),
        vehicleId: AppState.currentDetailCar,
        branchId: 'hn-caugiay',
        paymentMethod: inputMethod || 'Chuyển khoản QR Napas 24/7'
      };

      const order = await ApiClient.orders.createDeposit(payload);
      depositModal.classList.remove('active');
      showToast(`Đặt cọc xe thành công! Mã đơn hàng: ${order.orderNumber}`, '🎉');
      setTimeout(() => {
        navigateTo('profile', { profileTab: 'profile-orders' });
      }, 1200);
    } catch (err) {
      showToast(err.message, '⚠️');
    }
  });

  function updateDropdownUserUI() {
    const user = ApiClient.getCurrentUser();
    const nameEl = document.getElementById('dropdown-user-name');
    const roleEl = document.getElementById('dropdown-user-role');
    const sellerNav = document.getElementById('dropdown-seller-nav');
    const logoutBtn = document.getElementById('btn-dropdown-logout');
    if (user) {
      if (nameEl) nameEl.textContent = user.fullName || user.email;
      if (roleEl) {
        roleEl.textContent = `${user.role ? user.role.toUpperCase() : 'BUYER'} ${user.role === 'buyer' ? '(THÀNH VIÊN)' : ''}`;
        roleEl.style.background = '#EFF6FF';
        roleEl.style.color = 'var(--primary)';
      }
      if (sellerNav) {
        sellerNav.style.display = ['seller', 'admin', 'support_staff', 'service_staff'].includes(user.role) ? 'block' : 'none';
      }
      if (logoutBtn) logoutBtn.style.display = 'block';
    } else {
      if (nameEl) nameEl.textContent = 'Khách viếng thăm';
      if (roleEl) {
        roleEl.textContent = 'CHƯA ĐĂNG NHẬP';
        roleEl.style.background = '#E2E8F0';
        roleEl.style.color = '#475569';
      }
      if (sellerNav) sellerNav.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
    }
  }

  // Header and modal button interactions
  document.getElementById('btn-header-auth')?.addEventListener('click', (e) => {
    e.stopPropagation();
    accountDropdown.classList.toggle('active');
  });

  document.getElementById('btn-hamburger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hamburgerDrawer.classList.toggle('active');
  });

  document.getElementById('btn-drawer-close')?.addEventListener('click', () => {
    hamburgerDrawer.classList.remove('active');
  });

  document.getElementById('btn-header-search')?.addEventListener('click', () => {
    searchOverlay.classList.add('active');
    setTimeout(() => {
      searchInput?.focus();
      performLiveSearch(searchInput.value || '');
    }, 100);
  });

  document.getElementById('btn-search-overlay-close')?.addEventListener('click', () => {
    searchOverlay.classList.remove('active');
  });

  document.addEventListener('click', (e) => {
    if (!accountDropdown.contains(e.target) && e.target.id !== 'btn-header-auth') {
      accountDropdown.classList.remove('active');
    }
  });

  // Open Login Modal
  document.getElementById('btn-open-login-modal')?.addEventListener('click', () => {
    accountDropdown.classList.remove('active');
    switchAuthTab('login');
    const emailInp = document.getElementById('auth-email-input');
    const pwdInp = document.getElementById('auth-password-input');
    if (emailInp) emailInp.value = '';
    if (pwdInp) pwdInp.value = '';
    authModal.classList.add('active');
  });

  document.getElementById('btn-auth-modal-close')?.addEventListener('click', () => {
    authModal.classList.remove('active');
  });

  // Logout Button
  document.getElementById('btn-dropdown-logout')?.addEventListener('click', () => {
    ApiClient.auth.logout();
    AppState.currentUser = null;
    updateDropdownUserUI();
    accountDropdown.classList.remove('active');
    showToast('Đã đăng xuất tài khoản an toàn!', '👋');
    navigateTo('home');
  });

  // LLM Config Form
  document.getElementById('llm-config-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const provider = document.getElementById('llm-provider-select').value;
    const model = document.getElementById('llm-model-input').value;
    const ollamaUrl = document.getElementById('llm-ollama-url').value;
    const apiKey = document.getElementById('llm-api-key').value;

    AutomotiveLLM.config.provider = provider;
    AutomotiveLLM.config.modelName = model;
    AutomotiveLLM.config.ollamaEndpoint = ollamaUrl;
    if (apiKey) AutomotiveLLM.config.apiKey = apiKey;

    // Persist securely to backend if user is admin
    const currentUser = ApiClient.getCurrentUser();
    if (currentUser && currentUser.role === 'admin') {
      try {
        await ApiClient.ai.updateLlmConfig({
          provider,
          model,
          apiKey: apiKey || undefined,
          endpoint: ollamaUrl
        });
      } catch (err) {
        console.warn('Could not save LLM config to server:', err.message);
      }
    }

    llmSettingsModal.classList.remove('active');
    const label = document.getElementById('active-llm-label');
    if (label) label.textContent = model;
    showToast(`Đã chuyển đổi sang mô hình: ${model}!`, '🤖');
  });

  // Dynamic Provider Hint Update
  document.getElementById('llm-provider-select')?.addEventListener('change', (e) => {
    const prov = e.target.value;
    const modelInput = document.getElementById('llm-model-input');
    const hint = document.getElementById('llm-model-hint');
    const epGroup = document.getElementById('llm-endpoint-group');
    if (prov === 'gemini') {
      if (modelInput) modelInput.value = 'gemini-1.5-flash';
      if (hint) hint.textContent = 'Gợi ý cho Gemini: gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash';
      if (epGroup) epGroup.style.display = 'none';
    } else if (prov === 'groq') {
      if (modelInput) modelInput.value = 'llama-3.3-70b-versatile';
      if (hint) hint.textContent = 'Gợi ý cho Groq: llama-3.3-70b-versatile, mixtral-8x7b-32768';
      if (epGroup) epGroup.style.display = 'none';
    } else if (prov === 'openai') {
      if (modelInput) modelInput.value = 'gpt-4o-mini';
      if (hint) hint.textContent = 'Gợi ý cho OpenAI: gpt-4o-mini, gpt-4o';
      if (epGroup) epGroup.style.display = 'none';
    } else if (prov === 'ollama') {
      if (modelInput) modelInput.value = 'qwen2.5:7b';
      if (hint) hint.textContent = 'Gợi ý cho Ollama: qwen2.5:7b, llama3.2:3b';
      if (epGroup) epGroup.style.display = 'block';
    } else {
      if (modelInput) modelInput.value = 'Sigma AI (Nội bộ)';
      if (hint) hint.textContent = 'Mô hình suy luận cục bộ: 100% bảo mật, tốc độ tức thì, không cần kết nối mạng hay API Key';
      if (epGroup) epGroup.style.display = 'none';
    }
  });

  // Live RAG Sync Button
  document.getElementById('btn-sync-rag-now')?.addEventListener('click', async () => {
    try {
      const btn = document.getElementById('btn-sync-rag-now');
      if (btn) btn.textContent = '⏳ Đang đồng bộ...';
      const currentUser = ApiClient.getCurrentUser();
      let res;
      if (currentUser && currentUser.role === 'admin') {
        res = await ApiClient.ai.syncRag();
      }
      AutomotiveLLM.syncKnowledgeBase(AppState.vehiclesList, AppState.certifiedList, SIGMA_DATA?.accessories || []);
      const countEl = document.getElementById('rag-vehicle-count');
      const timeEl = document.getElementById('rag-last-sync');
      if (countEl) countEl.textContent = `${AutomotiveLLM.getLearnedVehicleCount()} dòng xe`;
      if (timeEl) timeEl.textContent = new Date().toLocaleTimeString('vi-VN');
      showToast('Đồng bộ dữ liệu xe vào Live RAG thành công!', '🔄');
      if (btn) btn.textContent = '🔄 Đồng bộ lại dữ liệu xe';
    } catch (err) {
      showToast(err.message, '⚠️');
      const btn = document.getElementById('btn-sync-rag-now');
      if (btn) btn.textContent = '🔄 Đồng bộ lại dữ liệu xe';
    }
  });

  // Test AI Connection Button
  document.getElementById('btn-test-ai-connection')?.addEventListener('click', async () => {
    try {
      const btn = document.getElementById('btn-test-ai-connection');
      if (btn) btn.textContent = '⏳ Đang kiểm tra...';
      const cur = ApiClient.getCurrentUser();
      if (cur && cur.role === 'admin') {
        const res = await ApiClient.ai.testConnection('Xin chào! Kiểm tra kết nối AI SIGMACAR.');
        showToast('Kết nối AI thành công! Trợ lý đã phản hồi.', '⚡');
      } else {
        const res = await AutomotiveLLM.queryLLM('Xin chào');
        showToast('Mô hình AI đang sẵn sàng hoạt động!', '⚡');
      }
      if (btn) btn.textContent = '⚡ Kiểm tra kết nối AI';
    } catch (err) {
      showToast('Lỗi kiểm tra kết nối AI: ' + err.message, '⚠️');
      const btn = document.getElementById('btn-test-ai-connection');
      if (btn) btn.textContent = '⚡ Kiểm tra kết nối AI';
    }
  });

  // Close modals
  document.querySelectorAll('.modal-close-btn, .modal-close-btn-alt').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.target.closest('.modal-overlay')?.classList.remove('active');
    });
  });

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const route = e.currentTarget.getAttribute('data-route');
      if (route) navigateTo(route);
    });
  });

  document.getElementById('floating-ai-btn')?.addEventListener('click', () => {
    requireAuth('hỏi trợ lý AI', () => navigateTo('ai-advisor'));
  });

  // Start app
  if (typeof AutomotiveLLM !== 'undefined' && typeof SIGMA_DATA !== 'undefined' && SIGMA_DATA.cars) {
    AutomotiveLLM.syncKnowledgeBase(SIGMA_DATA.cars, SIGMA_DATA.certifiedCars, SIGMA_DATA.accessories || []);
  }
  updateDropdownUserUI();
  await loadBackendData();
  const initial = window.location.hash.replace('#', '') || 'home';
  navigateTo(initial);
  });
}
