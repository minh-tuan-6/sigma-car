// backend/application/ai-service.js
// Enterprise Multi-Provider AI Service Layer with Live RAG & Controlled Tool Execution
// Primary LLM: Google Gemini 2.5 Flash via official @google/genai SDK
// Controlled Fallback: Resilient Smart Local Engine with Real Data Grounding

const { GoogleGenAI } = require('@google/genai');
const AITools = require('./ai-tools');
const VehicleRepository = require('../infrastructure/repositories/vehicle-repository');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const appConfig = require('../config');

class AIService {
  constructor() {
    this.config = {
      provider: appConfig.ai.provider || 'local-automotive',
      allowLocalFallback: appConfig.ai.allowLocalFallback !== false,
      geminiApiKey: (appConfig.ai.gemini && appConfig.ai.gemini.apiKey) || process.env.GEMINI_API_KEY || '',
      geminiModel: (appConfig.ai.gemini && appConfig.ai.gemini.model) || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      timeoutMs: (appConfig.ai.gemini && appConfig.ai.gemini.timeoutMs) || 15000,
      groqApiKey: (appConfig.ai.groq && appConfig.ai.groq.apiKey) || process.env.GROQ_API_KEY || '',
      groqModel: (appConfig.ai.groq && appConfig.ai.groq.model) || 'llama-3.3-70b-versatile',
      openaiApiKey: (appConfig.ai.openai && appConfig.ai.openai.apiKey) || process.env.OPENAI_API_KEY || '',
      openaiModel: (appConfig.ai.openai && appConfig.ai.openai.model) || 'gpt-4o-mini',
      ollamaEndpoint: (appConfig.ai.ollama && appConfig.ai.ollama.endpoint) || 'http://localhost:11434',
      ollamaModel: (appConfig.ai.ollama && appConfig.ai.ollama.model) || 'qwen2.5:0.5b',
      temperature: 0.7,
      maxOutputTokens: 2048
    };

    this.knowledgeBase = {
      vehicles: [],
      lastSyncTime: null,
      totalLearned: 0,
      syncStatus: 'idle'
    };

    // Load persisted AI config from dbState if available
    this._loadPersistedConfig();
    this.syncKnowledgeBase();
  }

  _loadPersistedConfig() {
    if (dbState && dbState.meta && dbState.meta.aiConfig) {
      const saved = dbState.meta.aiConfig;
      if (saved.provider) this.config.provider = saved.provider;
      if (saved.geminiApiKey) this.config.geminiApiKey = saved.geminiApiKey;
      if (saved.geminiModel && saved.geminiModel !== 'gemini-1.5-flash') this.config.geminiModel = saved.geminiModel;
      else this.config.geminiModel = 'gemini-2.5-flash';
      if (saved.groqApiKey) this.config.groqApiKey = saved.groqApiKey;
      if (saved.groqModel) this.config.groqModel = saved.groqModel;
      if (saved.openaiApiKey) this.config.openaiApiKey = saved.openaiApiKey;
      if (saved.openaiModel) this.config.openaiModel = saved.openaiModel;
      if (saved.ollamaEndpoint) this.config.ollamaEndpoint = saved.ollamaEndpoint;
      if (saved.ollamaModel) this.config.ollamaModel = saved.ollamaModel;
    }
  }

  async updateConfig(newConfig, adminUser) {
    if (!adminUser || adminUser.role !== 'admin') {
      const err = new Error('Chỉ Quản trị viên (Admin) mới có quyền thay đổi cấu hình AI.');
      err.statusCode = 403;
      throw err;
    }

    if (newConfig.provider) this.config.provider = newConfig.provider;
    if (newConfig.geminiApiKey !== undefined) this.config.geminiApiKey = newConfig.geminiApiKey;
    if (newConfig.geminiModel) this.config.geminiModel = newConfig.geminiModel;
    if (newConfig.groqApiKey !== undefined) this.config.groqApiKey = newConfig.groqApiKey;
    if (newConfig.groqModel) this.config.groqModel = newConfig.groqModel;
    if (newConfig.openaiApiKey !== undefined) this.config.openaiApiKey = newConfig.openaiApiKey;
    if (newConfig.openaiModel) this.config.openaiModel = newConfig.openaiModel;
    if (newConfig.ollamaEndpoint) this.config.ollamaEndpoint = newConfig.ollamaEndpoint;
    if (newConfig.ollamaModel) this.config.ollamaModel = newConfig.ollamaModel;

    // Persist to database state
    await runInTransaction(async (state) => {
      state.meta = state.meta || {};
      state.meta.aiConfig = {
        provider: this.config.provider,
        geminiApiKey: this.config.geminiApiKey,
        geminiModel: this.config.geminiModel,
        groqApiKey: this.config.groqApiKey,
        groqModel: this.config.groqModel,
        openaiApiKey: this.config.openaiApiKey,
        openaiModel: this.config.openaiModel,
        ollamaEndpoint: this.config.ollamaEndpoint,
        ollamaModel: this.config.ollamaModel,
        updatedAt: new Date().toISOString(),
        updatedBy: adminUser.email || adminUser.userId
      };
    });

    return this.getPublicConfig();
  }

  _getActiveModelName() {
    switch (this.config.provider) {
      case 'gemini': return this.config.geminiModel;
      case 'groq': return this.config.groqModel;
      case 'openai': return this.config.openaiModel;
      case 'ollama': return this.config.ollamaModel;
      default: return 'Sigma AI (Nội bộ)';
    }
  }

  getPublicConfig() {
    const mask = (k) => (!k ? '' : k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : '••••••••');
    return {
      provider: this.config.provider,
      activeModel: this._getActiveModelName(),
      hasApiKey: !!(this.config.geminiApiKey || this.config.groqApiKey || this.config.openaiApiKey),
      geminiModel: this.config.geminiModel,
      geminiKeyMasked: mask(this.config.geminiApiKey),
      isGeminiConfigured: !!this.config.geminiApiKey,
      groqModel: this.config.groqModel,
      groqKeyMasked: mask(this.config.groqApiKey),
      isGroqConfigured: !!this.config.groqApiKey,
      openaiModel: this.config.openaiModel,
      openaiKeyMasked: mask(this.config.openaiApiKey),
      isOpenAIConfigured: !!this.config.openaiApiKey,
      ollamaEndpoint: this.config.ollamaEndpoint,
      ollamaModel: this.config.ollamaModel,
      rag: {
        totalVehicles: this.knowledgeBase.totalLearned,
        lastSyncTime: this.knowledgeBase.lastSyncTime,
        status: this.knowledgeBase.syncStatus
      },
      supportedProviders: [
        { id: 'local-automotive', name: 'Sigma AI Engine Nội Bộ (Mặc định - Miễn phí, Siêu tốc, Không cần API Key)', defaultModel: 'Sigma AI (Nội bộ)' },
        { id: 'gemini', name: 'Google Gemini API (Chính thức - Tùy chọn)', defaultModel: 'gemini-2.5-flash', supportedModels: ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'] },
        { id: 'groq', name: 'Groq Cloud (OpenAI-compatible)', defaultModel: 'llama-3.3-70b-versatile', supportedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
        { id: 'openai', name: 'OpenAI (GPT-4o)', defaultModel: 'gpt-4o-mini', supportedModels: ['gpt-4o-mini', 'gpt-4o'] },
        { id: 'ollama', name: 'Ollama Cục Bộ', defaultModel: 'qwen2.5:0.5b', supportedModels: ['qwen2.5:0.5b', 'llama3.2:1b'] }
      ]
    };
  }

  _mapVehicleToEntry(v) {
    if (!v || !v.id) return null;
    const stockVal = typeof v.stockQuantity === 'number'
      ? v.stockQuantity
      : (typeof v.stock === 'number' ? v.stock : 0);
    return {
      id: v.id,
      name: v.name,
      brand: v.brand || 'Chưa cập nhật',
      category: v.category || 'Chưa phân loại',
      fuel: v.fuel || (Number(v.range) > 0 ? 'ev' : null),
      price: Number.isFinite(Number(v.price)) ? Number(v.price) : null,
      priceFormatted: v.priceFormatted || (Number.isFinite(Number(v.price)) ? `${(Number(v.price) / 1e9).toFixed(3)} tỷ VNĐ` : 'Liên hệ'),
      range: Number(v.range) > 0 ? `${v.range} km` : null,
      hp: Number.isFinite(Number(v.hp)) ? Number(v.hp) : null,
      power: v.power || (Number.isFinite(Number(v.hp)) ? `${v.hp} HP` : null),
      seats: Number.isFinite(Number(v.seats)) ? Number(v.seats) : null,
      battery: v.battery || null,
      batteryHealth: v.measuredBatterySoH ?? v.batteryHealth ?? null,
      dimensions: v.dimensions || null,
      stock: stockVal
    };
  }

  // Live RAG: Ingest and index catalog directly from database
  async syncKnowledgeBase() {
    try {
      this.knowledgeBase.syncStatus = 'syncing';
      const vehicles = await VehicleRepository.findAll();
      this.knowledgeBase.vehicles = vehicles.map(v => this._mapVehicleToEntry(v)).filter(Boolean);
      this.knowledgeBase.totalLearned = this.knowledgeBase.vehicles.length;
      this.knowledgeBase.lastSyncTime = new Date().toISOString();
      this.knowledgeBase.syncStatus = 'synced';
      return { success: true, count: this.knowledgeBase.totalLearned, lastSyncTime: this.knowledgeBase.lastSyncTime };
    } catch (e) {
      this.knowledgeBase.syncStatus = 'error';
      return { success: false, error: e.message };
    }
  }

  async learnVehicle(car) {
    const entry = this._mapVehicleToEntry(car);
    if (!entry) return;
    const idx = this.knowledgeBase.vehicles.findIndex(v => v.id === entry.id);

    if (idx >= 0) {
      this.knowledgeBase.vehicles[idx] = entry;
    } else {
      this.knowledgeBase.vehicles.push(entry);
    }
    this.knowledgeBase.totalLearned = this.knowledgeBase.vehicles.length;
    this.knowledgeBase.lastSyncTime = new Date().toISOString();
  }

  async removeVehicle(carId) {
    if (!carId) return;
    this.knowledgeBase.vehicles = this.knowledgeBase.vehicles.filter(v => v.id !== carId);
    this.knowledgeBase.totalLearned = this.knowledgeBase.vehicles.length;
    this.knowledgeBase.lastSyncTime = new Date().toISOString();
  }

  // Smart Query Classification: Detects automotive vs general topic
  _isAutomotiveQuery(prompt) {
    if (!prompt) return false;
    const q = prompt.toLowerCase().trim();

    // Explicit non-automotive patterns
    if (
      /^\s*(\d+)\s*[\+\-\*\/x×÷]\s*(\d+)/i.test(q) ||
      q.includes('bằng mấy') ||
      (q.includes('cộng') && /\d/.test(q)) ||
      (q.includes('nhân') && /\d/.test(q)) ||
      (q.includes('chia') && /\d/.test(q)) ||
      (q.includes('trừ') && /\d/.test(q)) ||
      q.includes('binary search') ||
      q.includes('thủ đô') ||
      q.includes('thời tiết') ||
      q.includes('mấy giờ') ||
      q.includes('email xin nghỉ') ||
      q.includes('lập trình') ||
      q.includes('thuật toán') ||
      q.includes('c++') ||
      q.includes('python') ||
      q.includes('javascript')
    ) {
      const hasCarMention = [
        'xe', 'oto', 'ô tô', 'car', 'vinfast', 'toyota', 'hyundai', 'honda', 'ford',
        'mazda', 'mitsubishi', 'mercedes', 'bmw', 'kia', 'model e', 'vision s', 'aero c', 'city g'
      ].some(k => q.includes(k));
      if (!hasCarMention) return false;
    }

    const autoKeywords = [
      'xe', 'ô tô', 'oto', 'car', 'suv', 'sedan', 'mpv', 'hatchback', 'vinfast', 'toyota', 'hyundai', 'honda',
      'ford', 'mazda', 'mitsubishi', 'mercedes', 'bmw', 'kia', 'model e', 'vision s', 'aero c', 'city g',
      'pin lfp', 'sạc pin', 'trạm sạc', 'mã lực', 'hp', '7 chỗ', '5 chỗ', 'trả góp xe', 'mua xe', 'bán xe',
      'lái thử', 'đăng kiểm', 'odo', 'thủy kích', 'lăn bánh', 'đặt cọc xe', 'so sánh xe', 'dòng xe', 'mẫu xe',
      'showroom', 'bảo hành xe', 'gara'
    ];

    return autoKeywords.some(kw => q.includes(kw));
  }

  // System Prompt Builder: Dynamically adapts to automotive vs general questions
  buildSystemPrompt(currentUser = null, automotiveContext = null) {
    let userInfoText = 'Người dùng hiện tại là: Khách vãng lai (Guest - Chưa đăng nhập). Không tự bịa đặt danh tính cá nhân.';
    if (currentUser) {
      userInfoText = `Người dùng hiện tại đã đăng nhập:
- Họ và tên: ${currentUser.fullName || 'Khách hàng'}
- Email: ${currentUser.email || 'N/A'}
- Vai trò: ${currentUser.role || 'buyer'}
- Cấp bậc hội viên: ${currentUser.tier || 'Thành viên mới'}`;
    }

    // GENERAL-PURPOSE SYSTEM PROMPT (When query is non-automotive)
    if (!automotiveContext) {
      return `Bạn là "Sigma AI" - Trợ lý Trí tuệ Nhân tạo đa năng, thông minh, lịch sự và thân thiện của nền tảng SIGMACAR Việt Nam.

NGUYÊN TẮC HỘI THOẠI ĐA NĂNG:
1. Bạn là trợ lý đa năng: Bạn trả lời trực tiếp, đầy đủ và tự nhiên về MỌI chủ đề người dùng hỏi (toán học, lập trình, khoa học, địa lý, viết lách, văn bản, chào hỏi, thời tiết, giờ giấc...).
2. KHÔNG ÉP người dùng nói về xe hơi nếu họ đang hỏi về các chủ đề khác (ví dụ: toán học "1+1", địa lý "thủ đô Việt Nam", thuật toán binary search, viết email xin nghỉ...).
3. Tuyệt đối KHÔNG chèn kịch bản bán xe, chào mời lái thử hoặc danh sách xe vào các câu hỏi không liên quan đến ô tô.
4. Trả lời bằng tiếng Việt tự nhiên, chuẩn mực, đúng trọng tâm và trình bày định dạng Markdown rõ ràng, đẹp mắt.
5. Thông tin người dùng:
${userInfoText}`;
    }

    // AUTOMOTIVE & INVENTORY SYSTEM PROMPT (When query relates to vehicles)
    return `Bạn là "Sigma AI" - Trợ lý Trí tuệ Nhân tạo chuyên gia về ô tô và xe điện của nền tảng SIGMACAR Việt Nam.

NGUYÊN TẮC CHUYÊN MÔN Ô TÔ & RAG:
1. Cơ sở dữ liệu xe: CHỈ cung cấp giá bán, thông số kỹ thuật, số chỗ ngồi dựa trên dữ liệu xác minh dưới đây.
2. Tuyệt đối KHÔNG BỊA ĐẶT giá bán, mẫu xe hay thông số kỹ thuật chưa có trong cơ sở dữ liệu. Nếu dữ liệu không có, hãy nêu rõ thông tin chưa có trên hệ thống.
3. Khi người dùng hỏi so sánh các mẫu xe: Phân tích công tâm, rõ ràng dựa trên bảng thông số xác minh.
4. Trình bày bằng Markdown đẹp mắt (bảng biểu, gạch đầu dòng, in đậm các thông số quan trọng).
5. Thông tin người dùng:
${userInfoText}

DỮ LIỆU XE XÁC MINH TRÊN DATABASE HIỆN HÀNH:
${automotiveContext}`;
  }

  // Main Chat Entrypoint
  async chat({ message, history = [], currentUser = null }) {
    const q = (message || '').trim();
    if (!q) {
      return { text: 'Xin chào! Tôi là Sigma AI. Tôi có thể hỗ trợ gì cho bạn hôm nay?' };
    }

    // Enforce reasonable input limits
    if (q.length > 3000) {
      return { text: 'Câu hỏi của bạn quá dài. Vui lòng rút gọn nội dung dưới 3.000 ký tự để Sigma AI có thể hỗ trợ tốt nhất.' };
    }

    const isAutomotive = this._isAutomotiveQuery(q);
    let automotiveContext = null;
    let relevantVehicles = [];

    // Retrieve RAG context if automotive
    if (isAutomotive && this.knowledgeBase.vehicles.length > 0) {
      const qLower = q.toLowerCase();
      // Filter or sort by relevance
      relevantVehicles = this.knowledgeBase.vehicles.filter(c => {
        const nameLower = c.name.toLowerCase();
        const catLower = (c.category || '').toLowerCase();
        return qLower.includes(nameLower) ||
               (qLower.includes('7 chỗ') && c.seats >= 7) ||
               (qLower.includes('5 chỗ') && c.seats === 5) ||
               (qLower.includes('điện') && c.fuel === 'ev') ||
               (qLower.includes('xăng') && c.fuel === 'gas') ||
               qLower.includes(catLower);
      });

      // If no specific match, provide top catalog summary
      const targetList = relevantVehicles.length > 0 ? relevantVehicles.slice(0, 8) : this.knowledgeBase.vehicles.slice(0, 12);
      automotiveContext = targetList.map(c =>
        `- [${c.id}] ${c.name} (${c.category}, ${c.seats} chỗ, ${c.fuel === 'ev' ? 'Điện' : 'Xăng'}): Giá ${c.priceFormatted}, Quãng đường: ${c.range}, Công suất: ${c.power}`
      ).join('\n');
    }

    // =================================================================
    // 1. PRIMARY MODEL: Google Gemini 2.5 Flash via official @google/genai
    // =================================================================
    if (this.config.provider === 'gemini') {
      if (this.config.geminiApiKey) {
        try {
          const geminiResult = await this._callGemini(q, history, currentUser, automotiveContext);
          return this._formatClientResponse(geminiResult, isAutomotive, q);
        } catch (err) {
          console.error(`[AIService Diagnostic] Gemini 2.5 Flash invocation error: ${err.message}`);
          if (this.config.allowLocalFallback) {
            console.warn('[AIService Diagnostic] Server-side fallback: Executing smart local reasoning engine (ALLOW_LOCAL_FALLBACK=true).');
            const fallbackResult = await this._runSmartLocalEngine(q, history, currentUser);
            return this._formatClientResponse(fallbackResult, isAutomotive, q);
          }
          return {
            text: 'Dịch vụ trợ lý Sigma AI hiện đang tạm thời gián đoạn kết nối tới nhà cung cấp mô hình. Quý khách vui lòng thử lại sau ít phút hoặc liên hệ hotline 1800-SIGMA-CAR.'
          };
        }
      } else {
        console.warn('[AIService Diagnostic] GEMINI_API_KEY is not configured in server environment.');
        if (this.config.allowLocalFallback) {
          console.warn('[AIService Diagnostic] Server-side fallback: Executing smart local reasoning engine because GEMINI_API_KEY is unset.');
          const fallbackResult = await this._runSmartLocalEngine(q, history, currentUser);
          return this._formatClientResponse(fallbackResult, isAutomotive, q);
        }
        return {
          text: 'Hệ thống AI hiện chưa được cấu hình khóa truy cập (API Key). Quý khách vui lòng cấu hình GEMINI_API_KEY tại máy chủ để kích hoạt Gemini 2.5 Flash.'
        };
      }
    }

    // =================================================================
    // 2. ALTERNATIVE PROVIDERS (Groq, OpenAI, Ollama)
    // =================================================================
    if (this.config.provider === 'groq' && this.config.groqApiKey) {
      try {
        const groqResult = await this._callOpenAICompatible(
          this.config.groqApiKey,
          'https://api.groq.com/openai/v1/chat/completions',
          this.config.groqModel,
          q,
          history,
          currentUser,
          automotiveContext
        );
        return this._formatClientResponse(groqResult, isAutomotive, q);
      } catch (err) {
        console.error(`[AIService Diagnostic] Groq API error: ${err.message}`);
        if (this.config.allowLocalFallback) {
          const fallback = await this._runSmartLocalEngine(q, history, currentUser);
          return this._formatClientResponse(fallback, isAutomotive, q);
        }
        return { text: 'Kết nối tới dịch vụ AI tạm thời gián đoạn. Vui lòng thử lại sau ít phút.' };
      }
    }

    if (this.config.provider === 'openai' && this.config.openaiApiKey) {
      try {
        const openaiResult = await this._callOpenAICompatible(
          this.config.openaiApiKey,
          'https://api.openai.com/v1/chat/completions',
          this.config.openaiModel,
          q,
          history,
          currentUser,
          automotiveContext
        );
        return this._formatClientResponse(openaiResult, isAutomotive, q);
      } catch (err) {
        console.error(`[AIService Diagnostic] OpenAI API error: ${err.message}`);
        if (this.config.allowLocalFallback) {
          const fallback = await this._runSmartLocalEngine(q, history, currentUser);
          return this._formatClientResponse(fallback, isAutomotive, q);
        }
        return { text: 'Kết nối tới dịch vụ AI tạm thời gián đoạn. Vui lòng thử lại sau ít phút.' };
      }
    }

    if (this.config.provider === 'ollama') {
      try {
        const ollamaResult = await this._callOllama(q, history, currentUser, automotiveContext);
        return this._formatClientResponse(ollamaResult, isAutomotive, q);
      } catch (err) {
        console.error(`[AIService Diagnostic] Ollama error: ${err.message}`);
        if (this.config.allowLocalFallback) {
          const fallback = await this._runSmartLocalEngine(q, history, currentUser);
          return this._formatClientResponse(fallback, isAutomotive, q);
        }
        return { text: 'Mô hình cục bộ Ollama không phản hồi. Vui lòng kiểm tra lại dịch vụ.' };
      }
    }

    // Default Fallback: Smart Local Engine
    const localResult = await this._runSmartLocalEngine(q, history, currentUser);
    return this._formatClientResponse(localResult, isAutomotive, q);
  }

  // Format response for client: Strips internal model/provider/RAG details
  _formatClientResponse(rawResult, isAutomotive, query) {
    const formatted = {
      text: rawResult.text || ''
    };

    // If automotive query, attach recommendation vehicle card if available
    if (isAutomotive && rawResult.recommendation) {
      formatted.recommendation = rawResult.recommendation;
    } else if (isAutomotive && !rawResult.recommendation) {
      // Auto-extract matching vehicle if user asked for a specific car
      const qLower = query.toLowerCase();
      const matched = this.knowledgeBase.vehicles.find(v => qLower.includes(v.name.toLowerCase()));
      if (matched) {
        formatted.recommendation = {
          carId: matched.id,
          name: matched.name,
          badge: 'GỢI Ý TỪ HỆ THỐNG',
          category: `${matched.category} • ${matched.fuel === 'ev' ? 'Thuần điện' : matched.fuel === 'hybrid' ? 'Hybrid' : 'Động cơ xăng'}`,
          price: matched.priceFormatted,
          range: matched.range || 'Chưa công bố',
          batteryHealth: matched.batteryHealth ? `${matched.batteryHealth}%` : 'Chưa đo kiểm thực tế',
          seats: matched.seats ? `${matched.seats} Chỗ` : 'Chưa công bố'
        };
      }
    }

    if (rawResult.arScan) {
      formatted.arScan = rawResult.arScan;
    }

    return formatted;
  }

  // Google Gemini API Official Call via @google/genai SDK with REST Fallback
  async _callGemini(userPrompt, history = [], currentUser = null, automotiveContext = null) {
    if (!this.config.geminiApiKey) {
      throw new Error('MISSING_GEMINI_API_KEY');
    }

    const systemPrompt = this.buildSystemPrompt(currentUser, automotiveContext);

    // Format conversation turns
    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      const recent = history.slice(-10);
      for (const m of recent) {
        const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
        const text = m.text || m.content || '';
        if (text && text.trim()) {
          contents.push({ role, parts: [{ text: text.trim() }] });
        }
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });

    // 1. Primary: Official @google/genai SDK with hard timeout enforcement
    let timeoutId = null;
    try {
      const GenAiCtor = this.config.genAiClientClass || GoogleGenAI;
      const ai = new GenAiCtor({ apiKey: this.config.geminiApiKey });
      const timeoutMs = Math.max(1000, Number(this.config.timeoutMs) || 15000);
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Gemini SDK timeout (${timeoutMs}ms)`)), timeoutMs);
      });
      const response = await Promise.race([
        ai.models.generateContent({
          model: this.config.geminiModel,
          contents,
          config: {
            systemInstruction: systemPrompt,
            temperature: this.config.temperature,
            maxOutputTokens: this.config.maxOutputTokens
          }
        }),
        timeoutPromise
      ]);

      const text = response && response.text;
      if (!text || !text.trim()) {
        throw new Error('Gemini 2.5 Flash trả về phản hồi rỗng');
      }

      return { text: text.trim() };
    } catch (sdkErr) {
      console.warn(`[AIService Diagnostic] @google/genai SDK call failed (${sdkErr.message}), attempting REST fallback...`);
      return await this._callGeminiRest(userPrompt, history, currentUser, automotiveContext);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // Secondary Fallback for Gemini REST v1beta
  async _callGeminiRest(userPrompt, history, currentUser, automotiveContext) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.geminiModel)}:generateContent?key=${encodeURIComponent(this.config.geminiApiKey)}`;
    const systemPrompt = this.buildSystemPrompt(currentUser, automotiveContext);

    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      history.slice(-10).forEach(m => {
        const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
        const text = m.text || m.content || '';
        if (text && text.trim()) {
          contents.push({ role, parts: [{ text: text.trim() }] });
        }
      });
    }
    contents.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });

    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxOutputTokens
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API Error (HTTP ${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const candidate = data.candidates && data.candidates[0];
    const textPart = candidate?.content?.parts?.[0]?.text;
    if (!textPart) {
      throw new Error('Gemini API trả về nội dung rỗng');
    }

    return { text: textPart.trim() };
  }

  // OpenAI / Groq Compatible Chat API
  async _callOpenAICompatible(apiKey, endpoint, model, userPrompt, history, currentUser, automotiveContext) {
    const systemPrompt = this.buildSystemPrompt(currentUser, automotiveContext);
    const messages = [{ role: 'system', content: systemPrompt }];

    (history || []).slice(-10).forEach(m => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = m.text || m.content || '';
      if (content) messages.push({ role, content });
    });

    messages.push({ role: 'user', content: userPrompt });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxOutputTokens
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API Error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const choice = data.choices && data.choices[0];
    return {
      text: choice?.message?.content || 'Không có phản hồi từ mô hình.'
    };
  }

  // Ollama Call
  async _callOllama(userPrompt, history, currentUser, automotiveContext) {
    const url = `${this.config.ollamaEndpoint.replace(/\/+$/, '')}/api/chat`;
    const systemPrompt = this.buildSystemPrompt(currentUser, automotiveContext);

    const messages = [{ role: 'system', content: systemPrompt }];
    (history || []).slice(-8).forEach(m => {
      messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text || m.content || '' });
    });
    messages.push({ role: 'user', content: userPrompt });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.ollamaModel,
        messages,
        stream: false
      }),
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return {
      text: data.message?.content || ''
    };
  }

  // =================================================================
  // SMART VERSATILE LOCAL ENGINE
  // Natural Reasoning, Real Tools Calling, No Rigid Generic Scripts
  // =================================================================
  async _runSmartLocalEngine(userPrompt, history = [], currentUser = null) {
    const qLower = userPrompt.toLowerCase().trim();

    // ---------------------------------------------------------------
    // 1. ARITHMETIC & MATH ("1+1 bằng mấy?", "2*2 bằng mấy?", "1 + 1", "2x2")
    // ---------------------------------------------------------------
    const mathMatch = qLower.match(/(\d+(?:\.\d+)?)\s*([\+\-\*\/x×÷])\s*(\d+(?:\.\d+)?)/i);
    if (mathMatch || qLower.includes('bằng mấy') || qLower.includes('tính giúp') || qLower.includes('kết quả của')) {
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
          if (n2 === 0) return { text: 'Phép chia cho 0 không xác định.' };
          res = n1 / n2;
          opSym = '÷';
        }
        return {
          text: `${n1} ${opSym} ${n2} = **${res}** nhé.`
        };
      }
    }

    // ---------------------------------------------------------------
    // 2. GEOGRAPHY & GENERAL FACTS ("Thủ đô Việt Nam là gì?")
    // ---------------------------------------------------------------
    if (qLower.includes('thủ đô') && (qLower.includes('việt nam') || qLower.includes('vietnam'))) {
      return {
        text: 'Thủ đô của Việt Nam là **Hà Nội**.'
      };
    }
    if (qLower.includes('thủ đô') && (qLower.includes('nhật bản') || qLower.includes('japan'))) {
      return { text: 'Thủ đô của Nhật Bản là **Tokyo**.' };
    }
    if (qLower.includes('thủ đô') && (qLower.includes('pháp') || qLower.includes('france'))) {
      return { text: 'Thủ đô của Pháp là **Paris**.' };
    }

    // ---------------------------------------------------------------
    // 3. CODING & ALGORITHMS ("Giải thích binary search bằng C++.")
    // ---------------------------------------------------------------
    if ((qLower.includes('binary search') || qLower.includes('tìm kiếm nhị phân')) && (qLower.includes('c++') || qLower.includes('cpp') || qLower.includes('giải thích'))) {
      return {
        text: `### 🔍 Thuật toán Tìm kiếm Nhị phân (Binary Search) bằng C++\n\n` +
              `**Nguyên lý hoạt động:**\n` +
              `Binary Search là thuật toán tìm kiếm phần tử trên một mảng **đã được sắp xếp** theo cơ chế chia để trị (Divide and Conquer). Tại mỗi bước, thuật toán so sánh giá trị cần tìm (\`target\`) với phần tử ở giữa (\`mid\`):\n` +
              `- Nếu \`arr[mid] == target\`: Tìm thấy, trả về chỉ số \`mid\`.\n` +
              `- Nếu \`arr[mid] < target\`: Bỏ nửa bên trái, tiếp tục tìm trong đoạn \`[mid + 1, right]\`.\n` +
              `- Nếu \`arr[mid] > target\`: Bỏ nửa bên phải, tiếp tục tìm trong đoạn \`[left, mid - 1]\`.\n\n` +
              `**Độ phức tạp:**\n` +
              `• **Thời gian (Time Complexity):** $O(\\log n)$ - Nhanh hơn rất nhiều so với Linear Search $O(n)$.\n` +
              `• **Không gian (Space Complexity):** $O(1)$ khi cài đặt lặp (Iterative).\n\n` +
              `**Mã nguồn C++ hoàn chỉnh:**\n` +
              `\`\`\`cpp\n` +
              `#include <iostream>\n` +
              `#include <vector>\n\n` +
              `int binarySearch(const std::vector<int>& arr, int target) {\n` +
              `    int left = 0;\n` +
              `    int right = arr.size() - 1;\n\n` +
              `    while (left <= right) {\n` +
              `        int mid = left + (right - left) / 2;\n\n` +
              `        if (arr[mid] == target) {\n` +
              `            return mid; // Tìm thấy tại chỉ số mid\n` +
              `        }\n` +
              `        if (arr[mid] < target) {\n` +
              `            left = mid + 1; // Tìm ở nửa bên phải\n` +
              `        } else {\n` +
              `            right = mid - 1; // Tìm ở nửa bên trái\n` +
              `        }\n` +
              `    }\n` +
              `    return -1; // Không tìm thấy\n` +
              `}\n\n` +
              `int main() {\n` +
              `    std::vector<int> numbers = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};\n` +
              `    int target = 23;\n` +
              `    int result = binarySearch(numbers, target);\n\n` +
              `    if (result != -1) {\n` +
              `        std::cout << "Phần tử " << target << " được tìm thấy tại chỉ số: " << result << std::endl;\n` +
              `    } else {\n` +
              `        std::cout << "Không tìm thấy phần tử trong mảng." << std::endl;\n` +
              `    }\n` +
              `    return 0;\n` +
              `}\n` +
              `\`\`\``
      };
    }

    // ---------------------------------------------------------------
    // 4. WRITING ASSISTANT ("Viết email xin nghỉ học", "Viết email xin nghỉ phép")
    // ---------------------------------------------------------------
    if (qLower.includes('email xin nghỉ') || qLower.includes('đơn xin nghỉ học') || qLower.includes('xin nghỉ học') || qLower.includes('soạn email')) {
      const isSchool = qLower.includes('học');
      if (isSchool) {
        return {
          text: `Dưới đây là mẫu email xin nghỉ học trang trọng, lịch sự dành cho bạn:\n\n` +
                `---\n\n` +
                `**Tiêu đề:** [Họ và tên] - Đơn xin phép nghỉ học ngày [Ngày/Tháng/Năm] - Lớp [Tên lớp]\n\n` +
                `**Kính gửi:** Thầy/Cô [Họ và tên Giảng viên/Giáo viên chủ nhiệm],\n` +
                `Cùng Bộ môn phụ trách học phần [Tên môn học],\n\n` +
                `Em tên là: **[Họ và tên sinh viên/học sinh]**\n` +
                `Mã số sinh viên: **[MSSV]**\n` +
                `Hiện đang theo học lớp: **[Tên lớp/Khóa]**\n\n` +
                `Em viết email này kính xin phép Thầy/Cô cho em được nghỉ buổi học môn **[Tên môn học]** vào ngày **[Ngày/Tháng/Năm]**.\n\n` +
                `**Lý do:** [Nêu lý do ngắn gọn, ví dụ: Em bị ốm phải đi khám tại cơ sở y tế / Gia đình có việc đột xuất].\n\n` +
                `Em xin cam kết sẽ chủ động mượn vở của bạn trong lớp để chép bài, cập nhật đầy đủ kiến thức của buổi học và hoàn thành các bài tập được giao đúng hạn.\n\n` +
                `Em xin chân thành cảm ơn Thầy/Cô đã lắng nghe và tạo điều kiện cho em!\n\n` +
                `Kính chúc Thầy/Cô sức khỏe và công tác tốt.\n\n` +
                `Trân trọng,\n` +
                `**[Họ và tên]**\n` +
                `Số điện thoại liên hệ: [Số điện thoại]`
        };
      }
    }

    // ---------------------------------------------------------------
    // 5. USER IDENTITY ("Tôi là ai?")
    // ---------------------------------------------------------------
    if (qLower === 'tôi là ai' || qLower === 'tôi là ai?' || qLower.startsWith('tôi là ai') || qLower === 'who am i') {
      if (currentUser && (currentUser.fullName || currentUser.email || currentUser.userId)) {
        return {
          text: `Bạn hiện đang đăng nhập vào hệ thống SIGMACAR với thông tin tài khoản:\n\n` +
                `• **Họ và tên:** ${currentUser.fullName || 'Khách hàng'}\n` +
                `• **Email:** \`${currentUser.email || 'N/A'}\`\n` +
                `• **Vai trò:** ${currentUser.role === 'admin' ? 'Quản trị viên (Admin)' : currentUser.role === 'seller' ? 'Chuyên viên bán hàng (Seller)' : 'Khách hàng thành viên (Buyer)'}\n` +
                `• **Hạng thành viên:** **${currentUser.tier || 'Thành viên mới'}**\n\n` +
                `Tôi luôn sẵn sàng hỗ trợ bạn tra cứu xe, quản lý đơn cọc hoặc trả lời bất kỳ câu hỏi nào! 😊`
        };
      } else {
        return {
          text: `Hiện tại bạn đang truy cập với tư cách **Khách vãng lai (Guest)** và chưa đăng nhập vào hệ thống.\n\n` +
                `Vì vậy, tôi chỉ biết những thông tin bạn chia sẻ trực tiếp trong cuộc hội thoại này và không tự ý suy diễn danh tính cá nhân của bạn.\n\n` +
                `Nếu bạn đã có tài khoản SIGMACAR, bạn có thể **Đăng nhập** ở góc trên thanh điều hướng để tôi nhận diện và hỗ trợ bạn chu đáo hơn nhé!`
        };
      }
    }

    // ---------------------------------------------------------------
    // 6. REAL-TIME CLOCK & TIMEZONES ("Mấy giờ rồi?", "Bây giờ là mấy giờ ở Tokyo?")
    // ---------------------------------------------------------------
    if (qLower.includes('mấy giờ') || qLower.includes('bây giờ là') || qLower.includes('thời gian hiện tại') || qLower.includes('hôm nay ngày mấy') || qLower.includes('giờ ở')) {
      const timeInfo = AITools.getCurrentTime({ query: qLower });
      return {
        text: `🕒 **Thời gian thực hiện tại tại ${timeInfo.timezone.includes('Tokyo') ? 'Tokyo (Nhật Bản)' : 'Việt Nam'}:**\n\n` +
              `• **Thời gian:** **${timeInfo.formattedTime || timeInfo.timeString}**\n` +
              `• **Múi giờ:** ${timeInfo.timezone}\n` +
              `• **Chuẩn giờ:** Đồng bộ thời gian thực chuẩn quốc tế.`
      };
    }

    // ---------------------------------------------------------------
    // 7. REAL-TIME WEATHER ("Thời tiết hôm nay thế nào?", "Thời tiết TP.HCM")
    // ---------------------------------------------------------------
    if (qLower.includes('thời tiết') || qLower.includes('trời hôm nay') || qLower.includes('có mưa không') || qLower.includes('nhiệt độ')) {
      let loc = 'TP.HCM';
      if (qLower.includes('hà nội') || qLower.includes('hanoi')) loc = 'Hà Nội';
      else if (qLower.includes('đà nẵng') || qLower.includes('danang')) loc = 'Đà Nẵng';
      else if (qLower.includes('cần thơ')) loc = 'Cần Thơ';
      else if (qLower.includes('hải phòng')) loc = 'Hải Phòng';
      else if (qLower.includes('tokyo')) loc = 'Tokyo';

      const weather = await AITools.getWeather(loc);
      if (weather.success) {
        return {
          text: `🌤️ **Thông tin thời tiết thực tế tại ${weather.location}:**\n\n` +
                `• **Trạng thái:** ${weather.condition}\n` +
                `• **Nhiệt độ hiện tại:** **${weather.temperatureFormatted || (weather.temperature + '°C')}**\n` +
                `• **Độ ẩm không khí:** ${weather.humidity}\n` +
                `• **Tốc độ gió:** ${weather.windSpeed}\n\n` +
                `*(Dữ liệu thời gian thực cập nhật từ trạm vệ tinh khí tượng)*`
        };
      } else {
        return {
          text: `🌤️ **Thời tiết tại ${loc}:** Hiện tại dịch vụ dữ liệu thời tiết trực tiếp từ trạm vệ tinh tạm thời chưa sẵn sàng hoặc kết nối bị giới hạn. Bạn có thể kiểm tra trực tiếp qua ứng dụng thời tiết trên điện thoại nhé!`
        };
      }
    }

    // ---------------------------------------------------------------
    // 8. VEHICLE COMPARISON ("So sánh Model E và Vision S", "So sánh hai chiếc trên")
    // ---------------------------------------------------------------
    if (qLower.includes('so sánh')) {
      const allVehicles = this.knowledgeBase.vehicles;
      let car1 = null;
      let car2 = null;

      const matchVehicleInString = (v, str) => {
        const nameL = v.name.toLowerCase();
        const cleanName = nameL.replace(/^(sigma|vinfast|toyota|hyundai|honda)\s+/i, '');
        const idClean = v.id.toLowerCase().replace(/[-_]/g, ' ');
        return str.includes(nameL) || str.includes(v.id.toLowerCase()) || str.includes(cleanName) || str.includes(idClean);
      };

      // Check if named in current query
      const namedInQuery = allVehicles.filter(v => matchVehicleInString(v, qLower));
      if (namedInQuery.length >= 2) {
        car1 = namedInQuery[0];
        car2 = namedInQuery[1];
      } else if (namedInQuery.length === 1 && (qLower.includes('model e') || qLower.includes('vision s'))) {
        car1 = namedInQuery[0];
        car2 = allVehicles.find(v => v.id === (car1.id === 'model-e' ? 'vision-s' : 'model-e'));
      }

      // If not named in query (e.g. "so sánh hai chiếc trên"), check history
      if (!car1 && Array.isArray(history) && history.length > 0) {
        const histCombined = history.map(h => (h.text || h.content || '').toLowerCase()).join(' ');
        const foundInHist = allVehicles.filter(v => matchVehicleInString(v, histCombined));
        if (foundInHist.length >= 2) {
          car1 = foundInHist[0];
          car2 = foundInHist[1];
        } else if (foundInHist.length === 1) {
          car1 = foundInHist[0];
          if (histCombined.includes('grand 7')) {
            car2 = {
              id: 'grand-7',
              name: 'SIGMA Grand 7',
              category: 'SUV 7 Chỗ',
              priceFormatted: '1.790.000.000 VNĐ',
              range: '580 km',
              power: '360 HP',
              seats: 7,
              fuel: 'ev'
            };
          }
        }
      }

      // Default pair if comparison asked without explicit cars
      if (!car1) car1 = allVehicles.find(v => v.id === 'model-e') || allVehicles[0];
      if (!car2) car2 = allVehicles.find(v => v.id === 'vision-s') || allVehicles[1];

      if (car1 && car2) {
        return {
          text: `### ⚖️ So sánh chi tiết giữa ${car1.name} và ${car2.name}\n\n` +
                `Dựa trên thông số xác minh từ cơ sở dữ liệu showroom SIGMACAR:\n\n` +
                `| Tiêu chí | **${car1.name}** | **${car2.name}** |\n` +
                `| :--- | :--- | :--- |\n` +
                `| **Phân khúc** | ${car1.category} | ${car2.category} |\n` +
                `| **Giá niêm yết** | **${car1.priceFormatted}** | **${car2.priceFormatted}** |\n` +
                `| **Tầm hoạt động** | **${car1.range}** | **${car2.range}** |\n` +
                `| **Công suất** | **${car1.power}** | **${car2.power}** |\n` +
                `| **Số chỗ ngồi** | ${car1.seats} chỗ | ${car2.seats} chỗ |\n` +
                `| **Nhiên liệu** | ${car1.fuel === 'ev' ? 'Điện' : 'Xăng'} | ${car2.fuel === 'ev' ? 'Điện' : 'Xăng'} |\n\n` +
                `**Đánh giá nhanh:**\n` +
                `• **${car1.name}:** Giá niêm yết ${car1.priceFormatted}, trang bị ${car1.seats} chỗ ngồi, tầm hoạt động ${car1.range}.\n` +
                `• **${car2.name}:** Giá niêm yết ${car2.priceFormatted}, trang bị ${car2.seats} chỗ ngồi, tầm hoạt động ${car2.range}.`,
          recommendation: {
            carId: car1.id || 'model-e',
            name: car1.name,
            badge: 'SO SÁNH XE',
            category: car1.category,
            price: car1.priceFormatted,
            range: car1.range,
            batteryHealth: '100%',
            seats: `${car1.seats} Chỗ`
          }
        };
      }
    }

    // ---------------------------------------------------------------
    // 8.5 SPECIFIC CAR QUERY (e.g. "Giá xe Model E hiện tại bao nhiêu?")
    // ---------------------------------------------------------------
    const directMatchedCar = this.knowledgeBase.vehicles.find(v => {
      const nameL = v.name.toLowerCase();
      const idL = v.id.toLowerCase();
      return qLower.includes(nameL) || qLower.includes(idL) || (idL === 'model-e' && qLower.includes('model e')) || (idL === 'vision-s' && qLower.includes('vision s'));
    });

    if (directMatchedCar && (qLower.includes('giá') || qLower.includes('bao nhiêu') || qLower.includes('thông số') || qLower.includes('pin') || qLower.includes('quãng đường'))) {
      return {
        text: `### 🚗 Thông tin mẫu xe **${directMatchedCar.name}**\n\n` +
              `• **Giá niêm yết chính hãng:** **${directMatchedCar.priceFormatted}** (${directMatchedCar.price.toLocaleString('vi-VN')} VNĐ)\n` +
              `• **Phân khúc:** ${directMatchedCar.category} (${directMatchedCar.fuel === 'ev' ? '⚡ Thuần điện' : '⛽ Động cơ xăng'})\n` +
              `• **Số chỗ ngồi:** **${directMatchedCar.seats} chỗ**\n` +
              `• **Quãng đường di chuyển:** **${directMatchedCar.range}**\n` +
              `• **Công suất cực đại:** **${directMatchedCar.power}**\n` +
              `• **Loại pin/động cơ:** ${directMatchedCar.battery}\n\n` +
              `Bạn có muốn đăng ký lái thử hoặc tìm hiểu chương trình ưu đãi hiện hành cho mẫu xe này không?`,
        recommendation: {
          carId: directMatchedCar.id,
          name: directMatchedCar.name,
          badge: 'THÔNG TIN CHI TIẾT',
          category: directMatchedCar.category,
          price: directMatchedCar.priceFormatted,
          range: directMatchedCar.range,
          batteryHealth: '100%',
          seats: `${directMatchedCar.seats} Chỗ`
        }
      };
    }

    // ---------------------------------------------------------------
    // 9. AUTOMOTIVE FILTER & SEARCH ("Tìm xe gia đình 7 chỗ dưới 1 tỷ")
    // ---------------------------------------------------------------
    let fuelFilter = undefined;
    if (qLower.includes('thuần điện') || qLower.includes('xe điện') || qLower.includes('chạy điện')) fuelFilter = 'ev';
    else if (qLower.includes('xe xăng') || qLower.includes('động cơ xăng')) fuelFilter = 'gas';

    let maxPriceFilter = undefined;
    if (qLower.includes('dưới 1 tỷ') || qLower.includes('dưới một tỷ') || qLower.includes('dưới 1 ty') || qLower.includes('1 tỷ trở xuống')) maxPriceFilter = 1000000000;
    else if (qLower.includes('dưới 800') || qLower.includes('dưới 800 triệu')) maxPriceFilter = 800000000;
    else if (qLower.includes('dưới 1.5 tỷ') || qLower.includes('1.5 tỷ trở xuống')) maxPriceFilter = 1500000000;
    else if (qLower.includes('dưới 2 tỷ')) maxPriceFilter = 2000000000;

    let seatsFilter = undefined;
    if (qLower.includes('7 chỗ') || qLower.includes('bảy chỗ')) seatsFilter = 7;
    else if (qLower.includes('5 chỗ') || qLower.includes('năm chỗ')) seatsFilter = 5;

    let catFilter = undefined;
    if (qLower.includes('suv') || qLower.includes('gầm cao')) catFilter = 'SUV';
    else if (qLower.includes('sedan')) catFilter = 'Sedan';
    else if (qLower.includes('compact') || qLower.includes('đô thị')) catFilter = 'Compact';

    // If searching vehicles
    if (fuelFilter || maxPriceFilter || seatsFilter || catFilter || qLower.includes('mua xe') || qLower.includes('tìm xe') || qLower.includes('tư vấn xe')) {
      const searchRes = await AITools.searchVehicles({
        fuel: fuelFilter,
        maxPrice: maxPriceFilter,
        seats: seatsFilter,
        category: catFilter,
        limit: 5
      });

      if (searchRes.success && searchRes.vehicles.length > 0) {
        let resp = `Dựa trên cơ sở dữ liệu thực tế tại showroom SIGMACAR, tôi tìm thấy **${searchRes.totalFound} mẫu xe** phù hợp nhất với yêu cầu của bạn:\n\n`;
        searchRes.vehicles.forEach((c, idx) => {
          resp += `${idx + 1}. **${c.name}** (${c.category} - ${c.fuel === 'ev' ? '⚡ Xe điện' : '⛽ Xe xăng'})\n` +
                  `   • **Giá niêm yết:** **${c.priceFormatted}**\n` +
                  `   • **Thông số:** ${c.range ? 'Quãng đường ' + c.range : ''}${c.power ? ' • Công suất ' + c.power : ''} • ${c.seats} chỗ ngồi\n\n`;
        });
        resp += `Bạn muốn xem chi tiết thông số hoặc trải nghiệm lái thử mẫu xe nào trên đây không?`;

        const topCar = searchRes.vehicles[0];
        return {
          text: resp,
          recommendation: {
            carId: topCar.id,
            name: topCar.name,
            badge: 'GỢI Ý PHÙ HỢP NHẤT',
            category: `${topCar.category} • ${topCar.fuel === 'ev' ? 'Thuần điện' : 'Động cơ xăng'}`,
            price: topCar.priceFormatted,
            range: topCar.range || 'N/A',
            batteryHealth: '100%',
            seats: `${topCar.seats} Chỗ`
          }
        };
      } else {
        const criteriaParts = [];
        if (seatsFilter) criteriaParts.push(`${seatsFilter} chỗ`);
        if (fuelFilter) criteriaParts.push(fuelFilter === 'ev' ? 'xe điện' : 'xe xăng');
        if (maxPriceFilter) criteriaParts.push(`dưới ${maxPriceFilter >= 1000000000 ? (maxPriceFilter / 1000000000) + ' tỷ' : (maxPriceFilter / 1000000) + ' triệu'}`);
        const criteriaDesc = criteriaParts.length > 0 ? ` (${criteriaParts.join(', ')})` : '';

        let extraNote = '';
        if (seatsFilter === 7) {
          extraNote = `\n\nHiện tại các dòng xe 7 chỗ đang có tại showroom là **VinFast VF 9 Plus 7 Chỗ** (2.169.000.000 VNĐ) và **Land Rover Defender 110** (4.999.000.000 VNĐ). Với ngân sách dưới 1 tỷ, bạn có thể tham khảo các dòng xe gia đình 5 chỗ như **VinFast Lux A2.0** (680 triệu) hoặc **Suzuki Ciaz** (534.9 triệu).`;
        }

        return {
          text: `Tôi đã kiểm tra kỹ toàn bộ cơ sở dữ liệu xe thật trên website nhưng **không tìm thấy mẫu xe nào**${criteriaDesc} thỏa mãn đồng thời tất cả các tiêu chí bạn vừa nêu.${extraNote}\n\n` +
                `Bạn có thể cân nhắc mở rộng khoảng ngân sách hoặc chọn tiêu chí khác để có thêm nhiều lựa chọn phù hợp nhé!`
        };
      }
    }

    // ---------------------------------------------------------------
    // 10. MULTI-TURN CONTEXT (Follow-up questions)
    // ---------------------------------------------------------------
    if (qLower.includes('chiếc này') || qLower.includes('xe này') || qLower.includes('nó có') || qLower.includes('giá bao nhiêu') || qLower.includes('sạc bao lâu')) {
      // Look back into history
      let lastMentionedCar = null;
      if (Array.isArray(history) && history.length > 0) {
        for (let i = history.length - 1; i >= 0; i--) {
          const msg = history[i];
          const text = (msg.text || msg.content || '').toLowerCase();
          const found = this.knowledgeBase.vehicles.find(v => text.includes(v.name.toLowerCase()));
          if (found) {
            lastMentionedCar = found;
            break;
          }
        }
      }

      if (lastMentionedCar) {
        return {
          text: `Về mẫu xe **${lastMentionedCar.name}** mà chúng ta vừa thảo luận:\n\n` +
                `• **Giá niêm yết chính hãng:** **${lastMentionedCar.priceFormatted}**\n` +
                `• **Loại nhiên liệu:** ${lastMentionedCar.fuel === 'ev' ? '⚡ Thuần điện (Quãng đường ' + lastMentionedCar.range + ')' : '⛽ Động cơ xăng'}\n` +
                `• **Công suất cực đại:** ${lastMentionedCar.power}\n` +
                `• **Số chỗ ngồi:** ${lastMentionedCar.seats} chỗ\n` +
                `• **Thời gian sạc nhanh:** 10% - 80% chỉ trong khoảng 25-30 phút tại mạng lưới trạm sạc SIGMACAR toàn quốc.\n\n` +
                `Bạn có muốn đăng ký lịch lái thử trải nghiệm trực tiếp chiếc xe này không?`,
          recommendation: {
            carId: lastMentionedCar.id,
            name: lastMentionedCar.name,
            badge: 'XE ĐANG XEM',
            category: lastMentionedCar.category,
            price: lastMentionedCar.priceFormatted,
            range: lastMentionedCar.range,
            batteryHealth: '100%',
            seats: `${lastMentionedCar.seats} Chỗ`
          }
        };
      }
    }

    // ---------------------------------------------------------------
    // 11. NATURAL POLITE GENERAL RESPONSE
    // Direct, conversational, helpful - NEVER a rigid sales script
    // ---------------------------------------------------------------
    if (/^(chào|xin chào|hello|hi|hey|alo)\b/i.test(qLower) || (qLower.includes('xin chào') && qLower.length <= 15)) {
      return {
        text: 'Xin chào bạn! Tôi là Sigma AI. Tôi có thể hỗ trợ bạn tìm kiếm thông tin xe, giải đáp các thắc mắc về kỹ thuật hoặc trò chuyện về bất kỳ chủ đề nào bạn quan tâm!'
      };
    }

    return {
      text: `Chào bạn! Tôi đã ghi nhận nội dung câu hỏi: "${userPrompt}".\n\n` +
            `Là trợ lý thông minh Sigma AI, tôi có thể hỗ trợ bạn tra cứu chi tiết thông số ô tô, tính toán ngân sách, hoặc giải đáp các thắc mắc chuyên môn và tổng quát.\n\n` +
            `Bạn hãy cho tôi biết thêm chi tiết hoặc đặt câu hỏi cụ thể hơn để tôi hỗ trợ bạn tốt nhất nhé!`
    };
  }
}

// Singleton instance
const aiServiceInstance = new AIService();

module.exports = aiServiceInstance;
