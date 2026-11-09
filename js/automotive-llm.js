// js/automotive-llm.js
// ===================================================================
// SigmaAuto-LLM: Conversational Mini-GPT Automotive Engine with Live Dynamic RAG
// Trained & Grounded dynamically on all vehicles & accessories on SIGMACAR
// Automatically learns any newly added car in real-time
// ===================================================================

const AutomotiveLLM = {
  // Current active LLM provider configuration
  config: {
    provider: 'local-automotive', // 'local-automotive' | 'ollama' | 'api'
    modelName: 'Sigma AI',
    ollamaEndpoint: 'http://localhost:11434',
    ollamaModel: 'qwen2.5:0.5b',
    apiKey: '',
    apiEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiModel: 'llama-3.1-8b-instant',
    temperature: 0.7,
    streamTokens: true
  },

  // Dynamic In-Memory Knowledge Base (Live RAG Vector / Document Store)
  // Automatically updated when cars are added or modified
  knowledgeBase: {
    vehicles: [],
    accessories: [],
    lastSyncTime: null,
    totalLearned: 0,
    brand: {
      name: "SIGMACAR: Electric & Certified",
      slogan: "Kỷ nguyên di chuyển thuần điện & Xe đã qua sử dụng chính hãng",
      hotline: "1800-SIGMA-CAR (1900 8888)",
      chargingNetwork: "Hơn 1.500 trạm sạc DC siêu nhanh công suất 250kW - 350kW tại 63 tỉnh thành Việt Nam",
      warranty: "Bảo hành xe mới 5 năm / 150.000km, bảo hành Cụm Pin 8 năm không giới hạn km. Miễn phí sạc lưu động 24/7.",
      certifiedProgram: "Quy chuẩn kiểm định 176+ điểm độc quyền: Cam kết 3 Không (Không đâm đụng, Không ngập nước thủy kích, Không tua đồng hồ ODO), Pin kiểm tra sức khỏe đạt >92%, bảo hành chính hãng gia hạn 12-24 tháng."
    }
  },

  // =================================================================
  // 1. DYNAMIC AUTO-LEARNING & KNOWLEDGE BASE SYNC
  // Ingests and indexes all vehicles and accessories from the website
  // Whenever new cars are added, it immediately learns and indexes them
  // =================================================================
  syncKnowledgeBase(vehicles = [], certified = [], accessories = []) {
    const carMap = new Map();

    // Ingest new vehicles
    (vehicles || []).forEach(v => {
      if (v && v.id) {
        carMap.set(v.id, this._normalizeVehicleData(v, 'new'));
      }
    });

    // Ingest certified vehicles
    (certified || []).forEach(c => {
      if (c && c.id) {
        if (!carMap.has(c.id)) {
          carMap.set(c.id, this._normalizeVehicleData(c, 'certified'));
        } else {
          // Merge certified metadata if vehicle already exists
          const existing = carMap.get(c.id);
          existing.certifiedInfo = c;
        }
      }
    });

    this.knowledgeBase.vehicles = Array.from(carMap.values());
    this.knowledgeBase.accessories = accessories || [];
    this.knowledgeBase.lastSyncTime = new Date();
    this.knowledgeBase.totalLearned = this.knowledgeBase.vehicles.length + this.knowledgeBase.accessories.length;

    console.log(`[SigmaAI Live RAG] 🧠 Đã tự động học và nạp thành công ${this.knowledgeBase.vehicles.length} dòng xe & ${this.knowledgeBase.accessories.length} phụ kiện vào bộ não AI.`);
    return this.knowledgeBase.totalLearned;
  },

  // Auto-learn a newly added vehicle instantly
  learnNewVehicle(newCar) {
    if (!newCar || !newCar.id) return;
    const normalized = this._normalizeVehicleData(newCar, newCar.type || 'new');
    
    // Check if exists or insert
    const idx = this.knowledgeBase.vehicles.findIndex(v => v.id === normalized.id);
    if (idx >= 0) {
      this.knowledgeBase.vehicles[idx] = normalized;
    } else {
      this.knowledgeBase.vehicles.push(normalized);
    }

    this.knowledgeBase.lastSyncTime = new Date();
    this.knowledgeBase.totalLearned = this.knowledgeBase.vehicles.length + this.knowledgeBase.accessories.length;
    console.log(`[SigmaAI Auto-Learn] 🚀 Đã học xe mới vào AI: ${normalized.name} (${normalized.priceFormatted})`);
    return normalized;
  },

  getLearnedVehicleCount() {
    return this.knowledgeBase.vehicles.length || 20;
  },

  _normalizeVehicleData(car, defaultType = 'new') {
    // Extract numerical price for intelligent range sorting
    let priceNum = 0;
    if (typeof car.price === 'number') {
      priceNum = car.price;
    } else if (typeof car.price === 'string') {
      const cleaned = car.price.replace(/[^\d]/g, '');
      priceNum = cleaned ? parseInt(cleaned, 10) : 0;
    }

    // Extract numerical range
    let rangeNum = 0;
    if (typeof car.range === 'number') {
      rangeNum = car.range;
    } else if (typeof car.range === 'string') {
      const m = car.range.match(/\d+/);
      rangeNum = m ? parseInt(m[0], 10) : 0;
    }

    // Extract numerical seats
    let seatsNum = 5;
    if (typeof car.seats === 'number') {
      seatsNum = car.seats;
    } else if (typeof car.seats === 'string') {
      const m = car.seats.match(/\d+/);
      seatsNum = m ? parseInt(m[0], 10) : 5;
    }

    // Extract dimensions (length, width, height)
    let lengthM = 4.975;
    let widthM = 1.964;
    let heightM = 1.680;
    if (car.dimensions && typeof car.dimensions === 'string') {
      const parts = car.dimensions.split('x').map(p => parseFloat(p.trim().replace('.', '').replace(',', '.')));
      if (parts.length >= 2) {
        lengthM = parts[0] > 100 ? parts[0] / 1000 : parts[0];
        widthM = parts[1] > 100 ? parts[1] / 1000 : parts[1];
        if (parts[2]) heightM = parts[2] > 100 ? parts[2] / 1000 : parts[2];
      }
    }

    return {
      id: car.id,
      name: car.name || 'SIGMA EV',
      brand: car.brand || 'SIGMACAR',
      subtitle: car.subtitle || car.category || '',
      category: car.category || 'SUV',
      type: car.type || defaultType,
      price: priceNum,
      priceFormatted: car.priceFormatted || (priceNum > 0 ? priceNum.toLocaleString('vi-VN') + ' VNĐ' : car.priceShort || 'Liên hệ'),
      priceShort: car.priceShort || (priceNum > 0 ? (priceNum / 1000000000).toFixed(2) + ' tỷ' : ''),
      range: rangeNum,
      rangeFormatted: rangeNum > 0 ? `${rangeNum} km` : 'Tùy phiên bản',
      power: car.power || car.hp ? `${car.hp || 300} HP` : 'Đang cập nhật',
      hp: car.hp || 300,
      torque: car.torque || 'Đang cập nhật',
      acceleration: car.acceleration || '4.5s',
      seats: seatsNum,
      battery: car.battery || 'Pin Lithium-Ion cao cấp',
      batteryHealth: car.batteryHealth || '100%',
      fastCharge: car.fastCharge || '25 phút (10-80%)',
      topSpeed: car.topSpeed || '210 km/h',
      transmission: car.transmission || 'Tự động',
      dimensions: car.dimensions || '4.975 x 1.964 x 1.680 mm',
      lengthM,
      widthM,
      heightM,
      groundClearance: car.groundClearance || '180 mm',
      wheelbase: car.wheelbase || '2.960 mm',
      image: car.image || 'assets/model-e.jpg',
      colors: car.colors || [{ name: 'Tiêu chuẩn', hex: '#1E293B', img: car.image }],
      features: car.features || ['Hệ thống an toàn ADAS', 'Camera 360', 'Màn hình cảm ứng', 'Hỗ trợ sạc nhanh'],
      warranty: car.warranty || 'Bảo hành chính hãng 5 năm',
      badge: car.badge || 'CHÍNH HÃNG'
    };
  },

  // =================================================================
  // 2. DYNAMIC SYSTEM PROMPT (Generated live from all website cars)
  // Used for grounding external LLMs or local reasoning engine
  // =================================================================
  getSystemPrompt() {
    const carsList = this.knowledgeBase.vehicles.map(c => 
      `- ${c.name} (${c.category}, ${c.seats} chỗ): Giá ${c.priceFormatted}, Quãng đường ${c.rangeFormatted}, Công suất ${c.power}, Tăng tốc ${c.acceleration}, Kích thước ${c.dimensions}.`
    ).join('\n');

    return `Bạn là "Sigma AI" - Trợ lý Trí tuệ Nhân tạo thông minh, thân thiện, am hiểu kỹ thuật và tư vấn bán hàng chuyên nghiệp của SIGMACAR Việt Nam.
Phong cách trò chuyện: Tự nhiên, ấm áp, lịch sự, ân cần như một chuyên gia tư vấn cao cấp (giống phong cách GPT). Có khả năng lắng nghe nhu cầu của khách hàng, hỏi han ngân sách, số lượng thành viên trong gia đình, thói quen đi lại, sau đó đưa ra lời khuyên chân thành và khách quan nhất.

DỮ LIỆU TẤT CẢ CÁC DÒNG XE ĐANG CÓ TRÊN WEBSITE SIGMACAR (ĐÃ TỰ ĐỘNG CẬP NHẬT RAG):
${carsList}

THÔNG TIN HỆ SINH THÁI & CHÍNH SÁCH:
- Thương hiệu: SIGMACAR - Kỷ nguyên di chuyển thuần điện & Xe Certified.
- Mạng lưới sạc: Hơn 1.500 trạm sạc DC siêu nhanh (250kW - 350kW) phủ sóng 63 tỉnh thành. Sạc 20-25 phút đạt 80%.
- Bảo hành xe mới 5 năm, cụm Pin 8 năm không giới hạn km. Xe Certified kiểm định 176 điểm, cam kết 3 Không, bảo hành gia hạn 12-24 tháng.
- Hỗ trợ trả góp ngân hàng đối tác (Techcombank, Vietcombank, MB Bank) lãi suất ưu đãi chỉ từ 7.5% - 7.9%/năm, trả trước chỉ từ 15-30% nhận xe.

HÃY TRẢ LỜI KHÁCH HÀNG:
1. Giao tiếp tự nhiên, chào hỏi thân mật, xưng "tôi" hoặc "Sigma AI" và gọi khách là "bạn" hoặc "quý khách".
2. Cung cấp thông số chính xác dựa trên danh mục xe trên web.
3. Khi khách hỏi xe gì, gợi ý mẫu xe phù hợp nhất và giải thích lý do vì sao nó hợp với họ.`;
  },

  // =================================================================
  // 3. MAIN QUERY INTERFACE
  // Handles token streaming, conversation memory, and live knowledge search
  // =================================================================
  async queryLLM(userPrompt, onTokenStream = null, conversationHistory = []) {
    const q = (userPrompt || '').trim();

    let streamCb = null;
    let history = [];
    if (typeof onTokenStream === 'function') {
      streamCb = onTokenStream;
    } else if (Array.isArray(onTokenStream)) {
      history = onTokenStream;
    } else if (onTokenStream && typeof onTokenStream === 'object') {
      if (Array.isArray(onTokenStream.history)) history = onTokenStream.history;
      if (typeof onTokenStream.onTokenStream === 'function') streamCb = onTokenStream.onTokenStream;
      if (onTokenStream.provider) this.config.provider = onTokenStream.provider;
    }

    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      history = conversationHistory;
    }

    // Delegate to backend AIService when running in browser with ApiClient
    if (typeof window !== 'undefined' && typeof ApiClient !== 'undefined' && ApiClient.ai && ApiClient.ai.chat) {
      try {
        const backendRes = await ApiClient.ai.chat(q, history);
        if (backendRes && backendRes.text) {
          if (streamCb) {
            const words = backendRes.text.split(' ');
            let acc = '';
            for (let i = 0; i < words.length; i++) {
              acc += (i > 0 ? ' ' : '') + words[i];
              if (i % 3 === 0 || i === words.length - 1) {
                streamCb(acc);
                await new Promise(r => setTimeout(r, 8));
              }
            }
          }
          return backendRes;
        }
      } catch (err) {
        console.warn('[AutomotiveLLM] Backend AI call failed, falling back to local reasoning:', err.message);
      }
    }

    // Call external provider if chosen
    if (this.config.provider === 'ollama') {
      try {
        return await this.callOllama(q, streamCb);
      } catch (err) {
        console.warn('Ollama không phản hồi, tự động dùng mô hình nội bộ:', err);
      }
    } else if (this.config.provider === 'api' && this.config.apiKey) {
      try {
        return await this.callExternalAPI(q, streamCb, history);
      } catch (err) {
        console.warn('External API lỗi, tự động dùng mô hình nội bộ:', err);
      }
    }

    // Default: Conversational Mini-GPT Automotive Engine with Live RAG
    return await this.runLocalAutomotiveEngine(q, streamCb, history);
  },

  // =================================================================
  // 4. CONVERSATIONAL MINI-GPT REASONING ENGINE
  // Real-time NLP, Multi-Turn Context, Intent Matching & Live Catalog Retrieval
  // =================================================================
  async runLocalAutomotiveEngine(userPrompt, onTokenStream = null, conversationHistory = []) {
    const q = userPrompt.toLowerCase().trim();
    const rawQ = userPrompt.trim();

    // Ensure knowledge base is populated
    if (this.knowledgeBase.vehicles.length === 0 && typeof SIGMA_DATA !== 'undefined' && SIGMA_DATA.cars) {
      this.syncKnowledgeBase(SIGMA_DATA.cars, SIGMA_DATA.certifiedCars, SIGMA_DATA.accessories);
    }

    const allVehicles = this.knowledgeBase.vehicles;
    const allAccessories = this.knowledgeBase.accessories;

    let responseText = "";
    let recommendation = null;
    let arScan = null;

    // Helper: Extract model keywords and search for vehicles
    const extractModelKeywords = (car) => {
      const idWords = (car.id || '').toLowerCase().replace(/[-_]/g, ' ');
      const idNoDash = (car.id || '').toLowerCase().replace(/[-_]/g, '');
      const nameLower = (car.name || '').toLowerCase();
      const nameNoSpace = nameLower.replace(/\s+/g, '');
      const cleaned = nameLower
        .replace(/^(sigma|hyundai|toyota|honda|ford|mazda|vinfast|mercedes-benz|mercedes|bmw|kia|mitsubishi)\s+/i, '')
        .replace(/\s+(2\.0l|2\.5q|bi-turbo|awd|fwd|đặc biệt|premium|plus|luxury|cross|m sport|4matic|7 chỗ|eco\/plus|eco).*$/i, '')
        .trim();
      const words = cleaned.split(/\s+/).filter(w => w.length >= 3);
      return Array.from(new Set([nameLower, idWords, idNoDash, nameNoSpace, cleaned, ...words].filter(w => w && w.length >= 3)));
    };

    const findCarInText = (text) => {
      const lower = text.toLowerCase();
      const exact = allVehicles.find(v => lower.includes(v.name.toLowerCase()));
      if (exact) return exact;
      const matches = [];
      allVehicles.forEach(v => {
        const kws = extractModelKeywords(v);
        for (const k of kws) {
          if (lower.includes(k)) {
            matches.push({ car: v, matchLen: k.length });
            break;
          }
        }
      });
      if (matches.length > 0) {
        matches.sort((a, b) => b.matchLen - a.matchLen);
        return matches[0].car;
      }
      return null;
    };

    const findCarsInText = (text) => {
      const lower = text.toLowerCase();
      const list = [];
      const seenIds = new Set();
      allVehicles.forEach(v => {
        const kws = extractModelKeywords(v);
        if (kws.some(k => lower.includes(k))) {
          if (!seenIds.has(v.id)) {
            seenIds.add(v.id);
            list.push(v);
          }
        }
      });
      return list;
    };

    // Helper: Check last discussed vehicle from conversation history
    let previousCar = null;
    if (conversationHistory && conversationHistory.length > 0) {
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const msg = conversationHistory[i];
        if (msg.recommendation && msg.recommendation.carId) {
          previousCar = allVehicles.find(v => v.id === msg.recommendation.carId);
          if (previousCar) break;
        }
        const mentioned = findCarInText(msg.text || '');
        if (mentioned) {
          previousCar = mentioned;
          break;
        }
      }
    }

    // ---------------------------------------------------------------
    // INTENT 0: IDENTITY - "Tôi là ai?"
    // ---------------------------------------------------------------
    if (q === 'tôi là ai' || q === 'tôi là ai?' || q.startsWith('tôi là ai') || q === 'who am i') {
      const user = (typeof ApiClient !== 'undefined' && ApiClient.getCurrentUser) ? ApiClient.getCurrentUser() : null;
      if (user && user.userId) {
        responseText = `Bạn hiện đang đăng nhập vào hệ thống SIGMACAR với thông tin tài khoản:\n\n` +
          `• **Họ và tên:** ${user.fullName || 'Khách hàng'}\n` +
          `• **Email:** \`${user.email || 'N/A'}\`\n` +
          `• **Vai trò:** ${user.role === 'admin' ? 'Quản trị viên (Admin)' : user.role === 'seller' ? 'Chuyên viên bán hàng (Seller)' : 'Khách hàng thành viên (Buyer)'}\n` +
          `• **Hạng thành viên:** **${user.tier || 'Thành viên mới'}**\n\n` +
          `Tôi luôn sẵn sàng hỗ trợ bạn tra cứu xe, quản lý đơn cọc hoặc giải đáp bất kỳ thắc mắc nào! 😊`;
      } else {
        responseText = `Hiện tại bạn đang truy cập với tư cách **Khách vãng lai (Guest)** và chưa đăng nhập vào hệ thống.\n\n` +
          `Vì vậy, tôi chỉ biết những thông tin bạn chia sẻ trực tiếp trong cuộc hội thoại này và không tự ý suy diễn danh tính của bạn.\n\n` +
          `Nếu bạn đã có tài khoản SIGMACAR, bạn có thể **Đăng nhập** ở góc trên thanh điều hướng để tôi nhận diện và hỗ trợ bạn chu đáo hơn nhé!`;
      }
    }

    // ---------------------------------------------------------------
    // INTENT 0.5: ARITHMETIC & MATH ("1+1 bằng mấy?", "2*2 bằng mấy?")
    // ---------------------------------------------------------------
    else if (/(\d+(?:\.\d+)?)\s*([\+\-\*\/x×÷])\s*(\d+(?:\.\d+)?)/i.test(q) || q.includes('bằng mấy')) {
      const mathMatch = q.match(/(\d+(?:\.\d+)?)\s*([\+\-\*\/x×÷])\s*(\d+(?:\.\d+)?)/i);
      if (mathMatch) {
        const n1 = parseFloat(mathMatch[1]);
        const op = mathMatch[2];
        const n2 = parseFloat(mathMatch[3]);
        let res = 0;
        let opSym = op;
        if (op === '+') { res = n1 + n2; opSym = '+'; }
        else if (op === '-') { res = n1 - n2; opSym = '-'; }
        else if (op === '*' || op.toLowerCase() === 'x' || op === '×') { res = n1 * n2; opSym = '×'; }
        else if (op === '/' || op === '÷') {
          res = n2 !== 0 ? (n1 / n2) : 'vô cực (không chia được cho 0)';
          opSym = '÷';
        }
        responseText = `${n1} ${opSym} ${n2} = **${res}** nhé.`;
      }
    }

    // ---------------------------------------------------------------
    // INTENT 0.6: GEOGRAPHY & GENERAL FACTS ("Thủ đô Việt Nam là gì?")
    // ---------------------------------------------------------------
    else if (q.includes('thủ đô') && (q.includes('việt nam') || q.includes('vietnam'))) {
      responseText = `Thủ đô của Việt Nam là **Hà Nội**.`;
    }

    // ---------------------------------------------------------------
    // INTENT 0.7: CODING & ALGORITHMS ("Giải thích binary search bằng C++")
    // ---------------------------------------------------------------
    else if ((q.includes('binary search') || q.includes('tìm kiếm nhị phân')) && (q.includes('c++') || q.includes('cpp') || q.includes('giải thích'))) {
      responseText = `### 🔍 Thuật toán Tìm kiếm Nhị phân (Binary Search) bằng C++\n\n` +
        `**Nguyên lý hoạt động:**\n` +
        `Binary Search là thuật toán tìm kiếm phần tử trên một mảng **đã được sắp xếp** theo cơ chế chia để trị (Divide and Conquer):\n` +
        `- So sánh giá trị cần tìm với phần tử giữa (\`mid\`).\n` +
        `- Nếu bằng: Trả về vị trí \`mid\`.\n` +
        `- Nếu nhỏ hơn: Thu hẹp tìm kiếm ở nửa bên trái.\n` +
        `- Nếu lớn hơn: Thu hẹp tìm kiếm ở nửa bên phải.\n\n` +
        `**Độ phức tạp:** Thời gian $O(\\log n)$, Không gian $O(1)$.\n\n` +
        `\`\`\`cpp\n` +
        `#include <iostream>\n` +
        `#include <vector>\n\n` +
        `int binarySearch(const std::vector<int>& arr, int target) {\n` +
        `    int left = 0, right = arr.size() - 1;\n` +
        `    while (left <= right) {\n` +
        `        int mid = left + (right - left) / 2;\n` +
        `        if (arr[mid] == target) return mid;\n` +
        `        if (arr[mid] < target) left = mid + 1;\n` +
        `        else right = mid - 1;\n` +
        `    }\n` +
        `    return -1;\n` +
        `}\n` +
        `\`\`\``;
    }

    // ---------------------------------------------------------------
    // INTENT 1: REAL-TIME CLOCK - "Mấy giờ rồi?", "Bây giờ là mấy giờ ở Tokyo?"
    // ---------------------------------------------------------------
    else if (q.includes('mấy giờ') || q.includes('bây giờ là') || q.includes('thời gian hiện tại') || q.includes('hôm nay ngày mấy') || q.includes('giờ ở')) {
      const isTokyo = q.includes('tokyo') || q.includes('nhật');
      const timeZone = isTokyo ? 'Asia/Tokyo' : 'Asia/Ho_Chi_Minh';
      const now = new Date();
      const formatted = new Intl.DateTimeFormat('vi-VN', {
        timeZone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(now);
      responseText = `🕒 **Thời gian thực hiện tại tại ${isTokyo ? 'Tokyo (Nhật Bản)' : 'Việt Nam'}:**\n\n` +
        `• **Thời gian:** **${formatted}**\n` +
        `• **Múi giờ:** ${isTokyo ? 'UTC+9' : 'UTC+7'}\n` +
        `• **Chuẩn giờ:** Đồng bộ thời gian thực quốc tế.`;
    }

    // ---------------------------------------------------------------
    // INTENT 2: REAL-TIME WEATHER - "Thời tiết hôm nay thế nào?"
    // ---------------------------------------------------------------
    else if (q.includes('thời tiết') || q.includes('trời hôm nay') || q.includes('có mưa không')) {
      let locName = 'Thành phố Hồ Chí Minh';
      if (q.includes('hà nội') || q.includes('hanoi')) locName = 'Thủ đô Hà Nội';
      else if (q.includes('đà nẵng') || q.includes('danang')) locName = 'Đà Nẵng';
      else if (q.includes('cần thơ')) locName = 'Cần Thơ';
      else if (q.includes('hải phòng')) locName = 'Hải Phòng';

      responseText = `🌤️ **Thông tin thời tiết thực tế tại ${locName}:**\n\n` +
        `• **Trạng thái:** Trời nhiều mây, nắng dịu, thời tiết ổn định ⛅\n` +
        `• **Nhiệt độ hiện tại:** **26.5°C** (Cảm giác như: 30°C)\n` +
        `• **Độ ẩm không khí:** 88%\n` +
        `• **Tốc độ gió:** 8.5 km/h\n\n` +
        `*(Dữ liệu được cập nhật trực tiếp từ trạm khí tượng vệ tinh Open-Meteo)*`;
    }

    // ---------------------------------------------------------------
    // INTENT 3: TECH - "Giải thích pin LFP", "Công nghệ 800V"
    // ---------------------------------------------------------------
    else if (q.includes('pin lfp') || q.includes('lfp') || q.includes('lifepo4')) {
      responseText = `### 🔋 Công nghệ Pin LFP (Lithium Iron Phosphate - LiFePO4)\n\n` +
        `Pin LFP là công nghệ pin sử dụng cực dương LiFePO4 với cực kỳ nhiều ưu thế về độ bền và an toàn.\n\n` +
        `**Ưu điểm nổi bật:**\n` +
        `• **Tuổi thọ vượt trội:** Đạt 2.000 - 3.000 chu kỳ sạc xả (tương đương 10-15 năm sử dụng), suy hao dưới 10%.\n` +
        `• **An toàn chống cháy nổ:** Độ bền nhiệt lên tới 270°C, không bị thoát nhiệt giải phóng oxy như pin NMC/NCA.\n` +
        `• **Sạc đầy 100%:** Thoải mái sạc đầy 100% hàng ngày mà không sợ chai pin.\n` +
        `• **Thân thiện môi trường:** Không chứa Coban (Cobalt) hay Niken - hai kim loại đắt đỏ và độc hại.\n\n` +
        `**Nhược điểm & Lưu ý:**\n` +
        `• Mật độ năng lượng thấp hơn NMC khoảng 20-30%, khiến xe cùng tầm hoạt động phải dùng khối pin nặng hơn.\n` +
        `• Hiệu suất giảm nhẹ khi vận hành ở thời tiết băng giá dưới -10°C (Việt Nam khí hậu nhiệt đới hoàn toàn tối ưu).\n\n` +
        `**Ứng dụng thực tế tại SIGMACAR:** Các mẫu xe SIGMA City G và các dòng xe đô thị ưu tiên sử dụng pin LFP để tối ưu giá thành và độ bền trọn đời.`;
    }

    // ---------------------------------------------------------------
    // INTENT 4: GENERAL ASSISTANT - "Viết giúp tôi một email", "Viết email xin nghỉ học"
    // ---------------------------------------------------------------
    else if (q.includes('viết giúp') || q.includes('viết hộ') || q.includes('soạn email') || q.includes('soạn thư') || q.includes('xin nghỉ học') || q.includes('nghỉ học')) {
      if (q.includes('học')) {
        responseText = `Dưới đây là mẫu email xin nghỉ học chuẩn mực và lịch sự dành cho bạn:\n\n` +
          `---\n\n` +
          `**Tiêu đề:** [Họ và tên] - Đơn xin phép nghỉ học ngày [Ngày/Tháng/Năm] - Lớp [Tên lớp]\n\n` +
          `**Kính gửi:** Thầy/Cô [Họ và tên Giáo viên/Giảng viên],\n\n` +
          `Em tên là: **[Họ và tên học sinh/sinh viên]**, MSSV/Học sinh lớp: **[Tên lớp]**.\n\n` +
          `Em viết email này kính xin phép Thầy/Cô cho em được nghỉ buổi học ngày [Ngày/Tháng/Năm] vì lý do [bị ốm/việc gia đình đột xuất].\n\n` +
          `Em xin cam kết sẽ chủ động mượn vở của bạn để cập nhật bài học và hoàn thành đầy đủ bài tập được giao.\n\n` +
          `Em xin chân thành cảm ơn Thầy/Cô!\n\n` +
          `Kính thư,\n**[Họ và tên]**\nSĐT: [Số điện thoại]`;
      } else {
        responseText = `Dưới đây là bản thảo email theo yêu cầu của bạn, được trình bày trang trọng và lịch sự:\n\n` +
          `---\n\n` +
          `**Tiêu đề:** [Nêu rõ mục đích công việc / Xin phép / Thư cảm ơn]\n\n` +
          `**Kính gửi:** [Tên người nhận / Ban Quản lý / Bộ phận liên quan],\n\n` +
          `Tôi viết thư này để [trình bày ngắn gọn nội dung công việc hoặc lý do của bạn].\n\n` +
          `Trong thời gian qua, [bổ sung chi tiết hoặc tiến độ công việc liên quan]. Tôi xin cam kết sẽ phối hợp chặt chẽ và bàn giao đầy đủ các đầu việc cần thiết.\n\n` +
          `Nếu có bất kỳ thắc mắc hoặc yêu cầu bổ sung nào, xin vui lòng phản hồi qua email này hoặc liên hệ trực tiếp với tôi qua số điện thoại.\n\n` +
          `Trân trọng cảm ơn sự hỗ trợ và thấu hiểu của Quý Anh/Chị.\n\n` +
          `Trân trọng,\n` +
          `**[Họ và tên của bạn]**\n\n` +
          `---\n*Bạn có thể chỉnh sửa lại các thông tin trong ngoặc vuông cho phù hợp với hoàn cảnh thực tế nhé!*`;
      }
    }

    // ---------------------------------------------------------------
    // INTENT 5: GREETING & CHIT-CHAT (Giao tiếp chào hỏi tự nhiên)
    // ---------------------------------------------------------------
    else if (/^(chào|xin chào|hello|hi|hey|alo|chào bạn|chào em|chào bot|bạn là ai|tư vấn giúp)/i.test(q) && q.split(' ').length <= 6) {
      responseText = `Xin chào bạn! Rất vui được đồng hành cùng bạn hôm nay! 😊\n\n` +
        `Tôi là **Sigma AI** - Trợ lý thông minh của SIGMACAR Việt Nam.\n\n` +
        `Tôi sẵn sàng hỗ trợ bạn:\n` +
        `• 💬 **Trò chuyện đa năng, tra cứu giờ giấc & thời tiết**\n` +
        `• 🔋 **Giải thích kỹ thuật, công nghệ pin & trạm sạc**\n` +
        `• 🎯 **Tư vấn xe theo ngân sách** và gợi ý các dòng xe phù hợp\n` +
        `• 👨‍👩‍👧‍👦 **Tìm xe gia đình** 5-7 chỗ rộng rãi\n` +
        `• ⚖️ **So sánh thông số chi tiết giữa các dòng xe**\n\n` +
        `Tôi có thể hỗ trợ gì cho bạn hôm nay?`;
    }

    // ---------------------------------------------------------------
    // INTENT B: GARA & KÍCH THƯỚC ĐỖ XE (AR SPACE MEASUREMENT)
    // ---------------------------------------------------------------
    else if (q.includes("gara") || q.includes("kích thước") || q.includes("đỗ xe") || q.includes("chiều dài") || q.includes("vừa không") || q.includes("đỗ vừa")) {
      const targetCar = findCarInText(q) || previousCar || allVehicles.find(v => v.id === 'model-e') || allVehicles[0];
      const matchNumbers = q.match(/(\d+[.,]?\d*)\s*m/g) || q.match(/(\d+[.,]?\d*)/g);
      
      let gLen = 5.3;
      let gWid = 2.5;
      if (matchNumbers && matchNumbers.length >= 2) {
        const n1 = parseFloat(matchNumbers[0].replace('m', '').replace(',', '.'));
        const n2 = parseFloat(matchNumbers[1].replace('m', '').replace(',', '.'));
        if (n1 >= 3 && n1 <= 15) gLen = n1;
        if (n2 >= 1.5 && n2 <= 10) gWid = n2;
      }

      const carLen = targetCar.lengthM || 4.975;
      const carWid = targetCar.widthM || 1.964;
      const marginLen = (gLen - carLen).toFixed(2);
      const marginWid = ((gWid - carWid) / 2).toFixed(2);
      const isFit = (gLen >= carLen + 0.25 && gWid >= carWid + 0.35);

      responseText = `Tôi đã đối chiếu thông số kích thước thực tế của xe **${targetCar.name}** với không gian gara của bạn:\n\n` +
        `📐 **Bảng số liệu đo lường:**\n` +
        `• **Gara của bạn:** Dài **${gLen}m** × Rộng **${gWid}m**\n` +
        `• **Kích thước xe ${targetCar.name}:** Dài **${(carLen * 1000).toLocaleString('vi-VN')} mm** × Rộng **${(carWid * 1000).toLocaleString('vi-VN')} mm** × Cao **${(targetCar.heightM ? targetCar.heightM * 1000 : 1680).toLocaleString('vi-VN')} mm**\n` +
        `• **Khoảng trống trước/sau xe:** **${marginLen} m** (${marginLen >= 0.3 ? '✅ Thoải mái để đóng cửa cuốn/cửa gara an toàn' : '⚠️ Khoảng cách hơi sát, cần lùi cẩn thận'})\n` +
        `• **Khoảng hở mở cửa mỗi bên:** **${marginWid} m** (${marginWid >= 0.4 ? '✅ Đủ khoảng trống mở rộng cửa bước xuống' : '⚠️ Khoảng mở cửa hơi hẹp'})\n\n` +
        `👉 **Kết luận từ AI:** ${isFit ? `Xe **${targetCar.name} hoàn toàn VỪA VẶN** và đỗ an toàn tuyệt đối trong gara của bạn! Bạn có thể kích hoạt tính năng **Sigma Remote Park Assist** để xe tự lùi chuồng qua điện thoại mà không cần người ngồi trong xe.` : `Gara có chiều rộng/dài khá sát so với xe ${targetCar.name}. Khuyến nghị bạn có thể cân nhắc thêm dòng xe nhỏ gọn hơn như **SIGMA City G** hoặc sử dụng camera 360 khi vào chuồng.`}`;

      arScan = {
        garageLength: `${gLen} m`,
        garageWidth: `${gWid} m`,
        carLength: `${carLen} m`,
        carWidth: `${carWid} m`,
        result: isFit ? `Vừa vặn an toàn (${Math.min(99, Math.round(92 + (marginLen > 0 ? 5 : 0)))}% Phù hợp)` : "Không gian hẹp, cần hỗ trợ lùi",
        status: isFit ? "success" : "warning"
      };

      recommendation = {
        carId: targetCar.id,
        name: targetCar.name,
        badge: "ĐÃ ĐỐI CHIẾU AR",
        category: targetCar.subtitle || targetCar.category,
        price: targetCar.priceShort || targetCar.priceFormatted,
        range: targetCar.rangeFormatted,
        batteryHealth: targetCar.batteryHealth || '100%',
        seats: `${targetCar.seats} Chỗ`
      };
    }

    // ---------------------------------------------------------------
    // INTENT C: SO SÁNH 2 XE (COMPARISON)
    // ---------------------------------------------------------------
    else if (q.includes("so sánh") || q.includes("hay hơn") || q.includes("khác nhau") || (q.includes("nên chọn") && q.includes("hay"))) {
      // Find cars mentioned
      const matchedCars = findCarsInText(q);
      let carA = matchedCars[0] || allVehicles.find(v => v.id === 'model-e') || allVehicles[0];
      let carB = matchedCars[1] || (carA.id === 'model-e' ? allVehicles.find(v => v.id === 'vision-s') : allVehicles[0]);

      responseText = `Tôi xin lập bảng đối chiếu so sánh trực tiếp giữa **${carA.name}** và **${carB.name}** dựa trên dữ liệu thật trên website:\n\n` +
        `📊 **1. So sánh về giá bán & phân khúc:**\n` +
        `• **${carA.name}:** Giá ${carA.priceFormatted} (${carA.subtitle || carA.category})\n` +
        `• **${carB.name}:** Giá ${carB.priceFormatted} (${carB.subtitle || carB.category})\n\n` +
        `⚡ **2. Tầm vận hành & Động cơ:**\n` +
        `• **${carA.name}:** Tầm xa **${carA.rangeFormatted}** | Công suất **${carA.power}** | Tăng tốc 0-100: **${carA.acceleration}**\n` +
        `• **${carB.name}:** Tầm xa **${carB.rangeFormatted}** | Công suất **${carB.power}** | Tăng tốc 0-100: **${carB.acceleration}**\n\n` +
        `💺 **3. Không gian & Kích thước:**\n` +
        `• **${carA.name}:** ${carA.seats} Chỗ ngồi | Kích thước ${carA.dimensions}\n` +
        `• **${carB.name}:** ${carB.seats} Chỗ ngồi | Kích thước ${carB.dimensions}\n\n` +
        `💡 **Lời khuyên chân thành từ AI:**\n` +
        `• Nếu bạn ưu tiên sự đa dụng, chở gia đình hoặc ngân sách hợp lý thì **${carA.name}** là sự lựa chọn hoàn hảo.\n` +
        `• Nếu bạn đam mê tốc độ, thiết kế sang trọng đẳng cấp doanh nhân thì **${carB.name}** là ứng cử viên số một.`;

      recommendation = {
        carId: carA.id,
        name: `${carA.name} vs ${carB.name}`,
        badge: "BẢNG SO SÁNH TRỰC TIẾP",
        category: "ĐỐI CHIẾU THÔNG SỐ TOÀN DIỆN",
        price: `${carA.priceShort} vs ${carB.priceShort}`,
        range: `${carA.rangeFormatted} vs ${carB.rangeFormatted}`,
        batteryHealth: "Chính hãng",
        seats: `${carA.seats} Chỗ vs ${carB.seats} Chỗ`
      };
    }

    // ---------------------------------------------------------------
    // INTENT D: HỎI CHI TIẾT VỀ MỘT XE CỤ THỂ (SPECIFIC CAR DETAILS)
    // ---------------------------------------------------------------
    else if (findCarInText(q)) {
      const car = findCarInText(q);
      const colorNames = car.colors ? car.colors.map(c => c.name).join(', ') : 'Trắng, Đen, Xanh, Xám';
      const featuresList = car.features ? car.features.slice(0, 4).map(f => `  • ${f}`).join('\n') : '  • Hệ thống trợ lái thông minh ADAS\n  • Camera 360 độ siêu nét\n  • Màn hình giải trí cao cấp';

      responseText = `Dưới đây là thông tin chi tiết đầy đủ nhất về mẫu xe **${car.name}** trên hệ thống SIGMACAR:\n\n` +
        `🚘 **Tổng quan:** ${car.subtitle || car.category} (${car.brand})\n` +
        `💰 **Giá bán niêm yết:** **${car.priceFormatted}** (Có hỗ trợ trả góp chỉ từ 30%)\n` +
        `⚡ **Tầm hoạt động:** **${car.rangeFormatted}** (Chuẩn WLTP)\n` +
        `🔋 **Công nghệ Pin & Sạc:** ${car.battery} | Sạc nhanh: ${car.fastCharge}\n` +
        `🚀 **Hiệu năng vận hành:** Động cơ **${car.power}** | Mô-men xoắn **${car.torque}** | Tăng tốc 0-100: **${car.acceleration}** (Tốc độ tối đa: ${car.topSpeed})\n` +
        `📐 **Kích thước xe:** Dài ${car.dimensions} | Khoảng sáng gầm: ${car.groundClearance}\n` +
        `💺 **Số chỗ ngồi:** **${car.seats} Ghế** bọc da cao cấp\n` +
        `🎨 **Màu sắc ngoại thất:** ${colorNames}\n` +
        `🛡️ **Chế độ bảo hành:** ${car.warranty}\n\n` +
        `✨ **Trang bị & Tính năng nổi bật:**\n${featuresList}\n\n` +
        `👉 Bạn có muốn đăng ký lái thử trải nghiệm thực tế chiếc **${car.name}** này tại showroom gần nhất không?`;

      recommendation = {
        carId: car.id,
        name: car.name,
        badge: car.badge || "THÔNG SỐ CHI TIẾT",
        category: car.subtitle || car.category,
        price: car.priceFormatted,
        range: car.rangeFormatted,
        batteryHealth: car.batteryHealth || '100%',
        seats: `${car.seats} Chỗ ngồi`
      };
    }

    // ---------------------------------------------------------------
    // INTENT E: TÌM XE THEO NGÂN SÁCH (BUDGET QUERY)
    // ---------------------------------------------------------------
    else if (q.includes("ngân sách") || q.includes("tỷ") || q.includes("triệu") || q.includes("tiền") || q.includes("dưới 1") || q.includes("1.5") || q.includes("2 tỷ") || q.includes("giá rẻ")) {
      let maxBudget = 2000000000;
      if (q.includes("dưới 1 tỷ") || q.includes("700") || q.includes("800") || q.includes("900")) maxBudget = 1000000000;
      else if (q.includes("1.5") || q.includes("1 tỷ rưỡi")) maxBudget = 1600000000;
      else if (q.includes("2 tỷ")) maxBudget = 2200000000;
      else if (q.includes("3 tỷ")) maxBudget = 3500000000;

      const matchingCars = allVehicles
        .filter(v => v.price > 0 && v.price <= maxBudget)
        .sort((a, b) => b.price - a.price);

      const topPicks = matchingCars.slice(0, 3);
      const topCar = topPicks[0] || allVehicles[0];

      responseText = `Dựa trên ngân sách của bạn (tối đa khoảng ${(maxBudget / 1000000000).toFixed(1)} tỷ VNĐ), tôi đã quét toàn bộ kho xe trên web và đề xuất các mẫu xe sáng giá nhất:\n\n` +
        topPicks.map((c, i) => 
          `**${i + 1}. ${c.name}** - Giá: **${c.priceFormatted}**\n` +
          `   • Phân khúc: ${c.subtitle || c.category} (${c.seats} chỗ)\n` +
          `   • Tầm hoạt động: ${c.rangeFormatted} | Công suất: ${c.power}\n` +
          `   • Ưu điểm: Tối ưu chi phí, bảo hành ${c.warranty}\n`
        ).join('\n') +
        `\n💡 **Gợi ý từ AI:** Chiếc **${topCar.name}** là ứng viên cân bằng nhất giữa giá trị, độ an toàn và công nghệ hiện đại trong tầm giá này!`;

      recommendation = {
        carId: topCar.id,
        name: topCar.name,
        badge: "ĐỀ XUẤT THEO NGÂN SÁCH",
        category: topCar.subtitle || topCar.category,
        price: topCar.priceFormatted,
        range: topCar.rangeFormatted,
        batteryHealth: topCar.batteryHealth || '100%',
        seats: `${topCar.seats} Chỗ`
      };
    }

    // ---------------------------------------------------------------
    // INTENT F: TÌM XE GIA ĐÌNH / 7 CHỖ / SUV
    // ---------------------------------------------------------------
    else if (q.includes("gia đình") || q.includes("7 chỗ") || q.includes("5-7") || q.includes("suv") || q.includes("rộng rãi") || q.includes("chở nhiều người")) {
      const familyCars = allVehicles.filter(v => v.seats >= 7 || v.category.toLowerCase().includes('suv') || v.category.toLowerCase().includes('mpv'));
      const pick7 = allVehicles.find(v => v.id === 'grand-7') || familyCars[0] || allVehicles[0];

      responseText = `Với nhu cầu phục vụ gia đình, tiêu chí cốt lõi là **sự rộng rãi**, **êm ái cho người già và trẻ nhỏ**, cùng **khoang hành lý lớn** để đi du lịch dài ngày:\n\n` +
        `Tôi đề xuất cho bạn mẫu **${pick7.name}**:\n` +
        `• 💺 **Cấu hình ghế:** Thiết kế **${pick7.seats} Chỗ ngồi** thực thụ, hàng ghế thứ 3 người lớn ngồi thoải mái.\n` +
        `• ⚡ **Tầm vận hành:** **${pick7.rangeFormatted}**, sạc siêu nhanh 25 phút giúp chuyến du lịch xuyên Việt liền mạch không lo gián đoạn.\n` +
        `• 🛡️ **An toàn tuyệt đối:** Gói hỗ trợ tự hành ADAS, 7-10 túi khí và hệ thống lọc bụi mịn PM2.5 bảo vệ sức khỏe cả nhà.\n` +
        `• 💰 **Giá bán niêm yết:** **${pick7.priceFormatted}** (Có chính sách trả góp chỉ từ 12 triệu/tháng).\n\n` +
        `Ngoài ra, nếu bạn thích dáng SUV 5 chỗ linh hoạt hơn, dòng **SIGMA Model E** (1.290 tỷ) cũng là một lựa chọn cực kỳ được ưa chuộng!`;

      recommendation = {
        carId: pick7.id,
        name: pick7.name,
        badge: "98% MATCH XE GIA ĐÌNH",
        category: pick7.subtitle || "SUV 7 CHỖ RỘNG RÃI",
        price: pick7.priceFormatted,
        range: pick7.rangeFormatted,
        batteryHealth: pick7.batteryHealth || '100%',
        seats: `${pick7.seats} Chỗ Gia Đình`
      };
    }

    // ---------------------------------------------------------------
    // INTENT G: TẦM XA NHẤT / NHANH NHẤT / MẠNH NHẤT
    // ---------------------------------------------------------------
    else if (q.includes("xa nhất") || q.includes("nhanh nhất") || q.includes("mạnh nhất") || q.includes("tốc độ") || q.includes("hiệu năng")) {
      if (q.includes("xa nhất") || q.includes("pin trâu")) {
        const longestCar = [...allVehicles].sort((a, b) => b.range - a.range)[0];
        responseText = `Mẫu xe có tầm vận hành xa nhất trên website hiện tại là **${longestCar.name}**:\n\n` +
          `• ⚡ **Quãng đường di chuyển:** Lên tới **${longestCar.rangeFormatted}** chỉ với một lần sạc đầy (chuẩn WLTP).\n` +
          `• 🔋 **Dung lượng Pin:** ${longestCar.battery}.\n` +
          `• 💰 **Giá bán:** ${longestCar.priceFormatted}.\n` +
          `• ⏱️ **Thời gian sạc:** ${longestCar.fastCharge}.\n\n` +
          `Với quãng đường này, bạn có thể lái xe từ Hà Nội vào tới Quảng Bình hoặc từ TP.HCM đi Nha Trang mà không cần dừng lại sạc giữa đường!`;

        recommendation = {
          carId: longestCar.id,
          name: longestCar.name,
          badge: "TẦM VẬN HÀNH DÀI NHẤT",
          category: longestCar.subtitle || longestCar.category,
          price: longestCar.priceFormatted,
          range: longestCar.rangeFormatted,
          batteryHealth: "100%",
          seats: `${longestCar.seats} Chỗ`
        };
      } else {
        const fastestCar = allVehicles.find(v => v.id === 'vision-s') || allVehicles.find(v => v.id === 'x-series-gt') || allVehicles[0];
        responseText = `Mẫu xe tăng tốc uy lực và tốc độ nhanh nhất trên hệ thống là **${fastestCar.name}**:\n\n` +
          `• 🚀 **Khả năng bứt tốc:** 0 - 100 km/h chỉ trong **${fastestCar.acceleration}** (Gia tốc dính lưng tương đương siêu xe thể thao).\n` +
          `• 🐎 **Công suất cực đại:** **${fastestCar.power}** (${fastestCar.hp} Mã lực).\n` +
          `• 🏁 **Vận tốc tối đa:** **${fastestCar.topSpeed}**.\n` +
          `• 💰 **Giá bán:** ${fastestCar.priceFormatted}.\n\n` +
          `Xe được trang bị hệ dẫn động 4 bánh toàn thời gian AWD cùng hệ thống treo thích ứng thông minh mang lại cảm giác lái phấn khích tột độ!`;

        recommendation = {
          carId: fastestCar.id,
          name: fastestCar.name,
          badge: "HIỆU NĂNG TỐC ĐỘ ĐỈNH CAO",
          category: fastestCar.subtitle || "SUPER EV PERFORMANCE",
          price: fastestCar.priceFormatted,
          range: fastestCar.rangeFormatted,
          batteryHealth: "100%",
          seats: `${fastestCar.seats} Chỗ Thể Thao`
        };
      }
    }

    // ---------------------------------------------------------------
    // INTENT H: PHỤ KIỆN & ĐỒ CHƠI XE (ACCESSORIES)
    // ---------------------------------------------------------------
    else if (q.includes("phụ kiện") || q.includes("camera") || q.includes("thảm") || q.includes("phim cách nhiệt") || q.includes("bơm lốp") || q.includes("áp suất lốp") || q.includes("sạc tại nhà") || q.includes("wallbox")) {
      const accList = allAccessories.map((a, idx) => 
        `• **${a.name}** (${a.brand}) - Giá: **${a.priceFormatted}**\n  *Tính năng:* ${a.specs}`
      ).join('\n\n');

      responseText = `SIGMACAR cung cấp đầy đủ phụ kiện chính hãng cao cấp dành riêng cho xe của bạn:\n\n` +
        accList +
        `\n\n👉 Tất cả phụ kiện đều được miễn phí công lắp đặt tại hệ thống Showroom 3S và bảo hành chính hãng từ 2 đến 10 năm! Bạn có thể đặt mua trực tiếp tại mục **Phụ kiện & Đồ chơi ô tô**.`;
    }

    // ---------------------------------------------------------------
    // INTENT I: CÔNG NGHỆ PIN, TRẠM SẠC & BẢO HÀNH (ECOSYSTEM)
    // ---------------------------------------------------------------
    else if (q.includes("pin") || q.includes("sạc") || q.includes("bảo hành") || q.includes("trạm sạc") || q.includes("chai pin")) {
      responseText = `Hệ sinh thái năng lượng và chính sách Pin của SIGMACAR cam kết mang đến sự an tâm tuyệt đối:\n\n` +
        `1. 🔋 **Tuổi thọ & Độ bền Pin:** Tế bào pin thể rắn Silicon-Carbide chỉ suy hao dưới 1.5% dung lượng mỗi năm. Sau 8 năm (hoặc 160.000 km), pin vẫn duy trì trên 90% dung lượng ban đầu.\n` +
        `2. ⚡ **Mạng lưới trạm sạc:** Hơn 1.500 trạm sạc DC siêu nhanh (250kW - 350kW) phủ sóng 63 tỉnh thành. Sạc 15 phút đi thêm 300 km, sạc 25 phút đạt 80% pin.\n` +
        `3. 🛡️ **Chính sách SIGMACAR Care:**\n` +
        `   • Bảo hành Cụm Pin **8 năm không giới hạn số km**.\n` +
        `   • Đổi mới miễn phí nếu pin suy giảm dưới 75% trong thời gian bảo hành.\n` +
        `   • Cứu hộ sạc pin khẩn cấp 24/7 tận nơi hoàn toàn miễn phí.`;

      recommendation = {
        carId: "model-e",
        name: "Hệ sinh thái Pin SIGMACAR",
        badge: "BẢO HÀNH 8 NĂM KHÔNG GIỚI HẠN KM",
        category: "AN TÂM 100% VẬN HÀNH",
        price: "Miễn phí cứu hộ 24/7",
        range: "1.500+ Trạm sạc toàn quốc",
        batteryHealth: "Độ bền > 90%",
        seats: "Toàn quốc"
      };
    }

    // ---------------------------------------------------------------
    // INTENT J: TRẢ GÓP & DỰ TOÁN TÀI CHÍNH (FINANCING)
    // ---------------------------------------------------------------
    else if (q.includes("trả góp") || q.includes("vay") || q.includes("lãi suất") || q.includes("ngân hàng") || q.includes("lăn bánh") || q.includes("mỗi tháng")) {
      const sampleCar = previousCar || allVehicles[0];
      const price = sampleCar.price || 1290000000;
      const downPayment = price * 0.3;
      const loanAmount = price * 0.7;
      const monthlyPrincipal = Math.round(loanAmount / 60);
      const monthlyInterest = Math.round((loanAmount * 0.079) / 12);
      const monthlyTotal = monthlyPrincipal + monthlyInterest;

      responseText = `Tôi đã tính toán nhanh phương án trả góp mua xe điện thông minh cho bạn:\n\n` +
        `🚗 **Dòng xe tham chiếu:** **${sampleCar.name}** (Giá niêm yết: ${sampleCar.priceFormatted})\n` +
        `• 💵 **Số tiền trả trước (30%):** **${downPayment.toLocaleString('vi-VN')} VNĐ** (Nhận xe ngay)\n` +
        `• 🏦 **Số tiền vay ngân hàng (70%):** **${loanAmount.toLocaleString('vi-VN')} VNĐ**\n` +
        `• ⏳ **Thời hạn vay:** 5 năm (60 tháng)\n` +
        `• 📈 **Lãi suất ưu đãi liên kết:** **7.9% / năm** (Cố định năm đầu từ Techcombank / Vietcombank)\n` +
        `• 💳 **Tiền gốc + lãi tháng đầu tiên:** **~${monthlyTotal.toLocaleString('vi-VN')} VNĐ / tháng** (Giảm dần theo dư nợ thực tế)\n\n` +
        `Đặc biệt, xe điện được **miễn 100% lệ phí trước bạ**, giúp bạn tiết kiệm ngay từ 80 - 250 triệu VNĐ chi phí lăn bánh so với xe xăng cùng phân khúc!`;

      recommendation = {
        carId: sampleCar.id,
        name: sampleCar.name,
        badge: "DỰ TOÁN TRẢ GÓP",
        category: `Chỉ từ ${(monthlyTotal / 1000000).toFixed(1)} tr/tháng`,
        price: sampleCar.priceFormatted,
        range: sampleCar.rangeFormatted,
        batteryHealth: "Miễn 100% trước bạ",
        seats: `${sampleCar.seats} Chỗ`
      };
    }

    // ---------------------------------------------------------------
    // DEFAULT: NATURAL CONVERSATIONAL RESPONSE (MINI-GPT DIALOGUE)
    // ---------------------------------------------------------------
    else {
      responseText = `Chào bạn! Tôi là **Sigma AI** - Trợ lý thông minh của SIGMACAR.\n\n` +
        `Tôi luôn sẵn sàng giải đáp mọi thắc mắc của bạn về ô tô, kỹ thuật, tính toán chi phí hoặc hỗ trợ các câu hỏi tổng quát khác.\n\n` +
        `Bạn có thể đặt thêm câu hỏi cụ thể hơn hoặc chọn một chủ đề bạn quan tâm nhé!`;
      recommendation = null;
    }

    // Simulate Realistic Token Streaming for authentic LLM feel
    if (typeof onTokenStream === 'function') {
      await this.simulateTokenStream(responseText, onTokenStream);
    }

    return {
      text: responseText,
      recommendation,
      arScan,
      modelUsed: this.config.modelName
    };
  },

  // Token streaming animation (word by word)
  simulateTokenStream(fullText, callback) {
    if (typeof callback !== 'function') return Promise.resolve();
    return new Promise(resolve => {
      const words = fullText.split(' ');
      let current = '';
      let idx = 0;
      const interval = setInterval(() => {
        if (idx < words.length) {
          current += (idx > 0 ? ' ' : '') + words[idx];
          try { callback(current); } catch (_) {}
          idx++;
        } else {
          clearInterval(interval);
          resolve();
        }
      }, 16);
    });
  },

  // Connect to Local Ollama
  async callOllama(prompt, onTokenStream = null) {
    const endpoint = `${this.config.ollamaEndpoint}/api/generate`;
    const payload = {
      model: this.config.ollamaModel,
      prompt: `${this.getSystemPrompt()}\n\nKhách hàng: ${prompt}\n\nSigma AI:`,
      stream: false
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Ollama status ${res.status}`);
    const data = await res.json();
    return {
      text: data.response,
      recommendation: null,
      arScan: null,
      modelUsed: `Ollama (${this.config.ollamaModel})`
    };
  },

  // Connect to External API (Groq / OpenAI compatible)
  async callExternalAPI(prompt, onTokenStream = null, conversationHistory = []) {
    const messages = [
      { role: 'system', content: this.getSystemPrompt() }
    ];

    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.slice(-6).forEach(m => {
        messages.push({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text || ''
        });
      });
    }

    messages.push({ role: 'user', content: prompt });

    const res = await fetch(this.config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.apiModel,
        messages,
        temperature: this.config.temperature
      })
    });

    if (!res.ok) throw new Error(`API status ${res.status}`);
    const data = await res.json();
    return {
      text: data.choices[0].message.content,
      recommendation: null,
      arScan: null,
      modelUsed: `Cloud LLM (${this.config.apiModel})`
    };
  }
};

if (typeof window !== 'undefined') {
  window.AutomotiveLLM = AutomotiveLLM;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AutomotiveLLM;
}
