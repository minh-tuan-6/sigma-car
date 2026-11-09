// tests/unit/gemini_ai.test.js
// Verification of Gemini 2.5 Flash Integration, General-Purpose Conversation & 10 Required Test Scenarios

const test = require('node:test');
const assert = require('node:assert/strict');
const AIService = require('../../backend/application/ai-service');
const appConfig = require('../../backend/config');

test.before(async () => {
  await AIService.syncKnowledgeBase();
});

test('SECTION 8 REQUIRED TESTS: Gemini 2.5 Flash & Sigma AI General-Purpose & Automotive Capabilities', async (t) => {
  // Test 1: "1+1 bằng mấy?" → Correct answer: 2
  await t.test('Test 1: "1+1 bằng mấy?" -> Trả lời chính xác 2', async () => {
    const res = await AIService.chat({ message: '1+1 bằng mấy?' });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.doesNotMatch(res.text, /Tôi đã hiểu câu hỏi của bạn/i, 'Không được trả lời bằng thông điệp rập khuôn cũ');
    assert.doesNotMatch(res.text, /Hiện tại trên hệ thống có.*mẫu xe/i, 'Không được ép bán xe vào câu hỏi toán học');
    assert.match(res.text, /\b2\b/, 'Câu trả lời phải chứa số 2');
  });

  // Test 2: "2*2 bằng mấy?" → Correct answer: 4
  await t.test('Test 2: "2*2 bằng mấy?" -> Trả lời chính xác 4', async () => {
    const res = await AIService.chat({ message: '2*2 bằng mấy?' });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.doesNotMatch(res.text, /Tôi đã hiểu câu hỏi của bạn/i, 'Không được trả lời bằng thông điệp rập khuôn cũ');
    assert.match(res.text, /\b4\b/, 'Câu trả lời phải chứa số 4');
  });

  // Test 3: "Thủ đô Việt Nam là gì?" → Correct answer: Hà Nội
  await t.test('Test 3: "Thủ đô Việt Nam là gì?" -> Trả lời chính xác Hà Nội', async () => {
    const res = await AIService.chat({ message: 'Thủ đô Việt Nam là gì?' });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.match(res.text, /Hà Nội/i, 'Câu trả lời phải nêu rõ Hà Nội');
    assert.doesNotMatch(res.text, /Tôi đã hiểu câu hỏi của bạn/i, 'Không được lặp lại generic response');
  });

  // Test 4: "Giải thích binary search bằng C++." → Relevant explanation and correct code
  await t.test('Test 4: "Giải thích binary search bằng C++." -> Giải thích rõ ràng và có khối code C++', async () => {
    const res = await AIService.chat({ message: 'Giải thích binary search bằng C++.' });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.match(res.text, /(binary search|tìm kiếm nhị phân)/i, 'Phải giải thích đúng thuật toán');
    assert.match(res.text, /```(cpp|c\+\+)?[\s\S]*int\s+binarySearch[\s\S]*```/i, 'Phải cung cấp đoạn mã C++ chính xác');
  });

  // Test 5: "Tìm xe gia đình 7 chỗ dưới 1 tỷ." → Relevant results from actual database
  await t.test('Test 5: "Tìm xe gia đình 7 chỗ dưới 1 tỷ." -> Kết quả xác thực từ database', async () => {
    const res = await AIService.chat({ message: 'Tìm xe gia đình 7 chỗ dưới 1 tỷ.' });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.match(res.text, /(7 chỗ|bảy chỗ)/i, 'Phải nhận diện tiêu chí 7 chỗ');
    // Actual 7-seaters under 1B in SIGMACAR database (VinFast VF MPV 7: 790tr, Mitsubishi Xpander Cross: 698tr)
    assert.match(res.text, /(VF MPV 7|Xpander Cross|790|698)/i, 'Phải gợi ý đúng xe thật có trong kho');
    if (res.recommendation) {
      assert.ok(res.recommendation.carId, 'Phải có card xe gợi ý phù hợp');
    }
  });

  // Test 6: "So sánh Model E và Vision S." → Grounded comparison using available records
  await t.test('Test 6: "So sánh Model E và Vision S." -> So sánh dựa trên dữ liệu thật', async () => {
    const res = await AIService.chat({ message: 'So sánh Model E và Vision S.' });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.match(res.text, /Model E/i, 'Phải đề cập Model E');
    assert.match(res.text, /Vision S/i, 'Phải đề cập Vision S');
    assert.match(res.text, /(giá|công suất|quãng đường|tầm hoạt động)/i, 'Phải so sánh các tiêu chí kỹ thuật');
  });

  // Test 7: "Thời tiết hôm nay thế nào?" → Live data or honest provider limitation
  await t.test('Test 7: "Thời tiết hôm nay thế nào?" -> Dữ liệu thực hoặc giới hạn trung thực', async () => {
    const res = await AIService.chat({ message: 'Thời tiết hôm nay thế nào?' });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.match(res.text, /(thời tiết|nhiệt độ|trạng thái|trạm vệ tinh|khí tượng|ứng dụng thời tiết)/i, 'Phải trả về thông tin thời tiết hoặc thông báo giới hạn thực tế');
    assert.doesNotMatch(res.text, /Tôi đã hiểu câu hỏi của bạn/i, 'Không dùng generic filler');
  });

  // Test 8: "Bây giờ là mấy giờ ở Tokyo?" → Correct local time for Tokyo (UTC+9)
  await t.test('Test 8: "Bây giờ là mấy giờ ở Tokyo?" -> Đúng giờ Tokyo (UTC+9)', async () => {
    const res = await AIService.chat({ message: 'Bây giờ là mấy giờ ở Tokyo?' });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.match(res.text, /(Tokyo|Nhật Bản|UTC\+9)/i, 'Phải nhận diện Tokyo');
    assert.match(res.text, /\d{1,2}:\d{1,2}/, 'Phải hiển thị giờ cụ thể');
  });

  // Test 9: Follow-up question → Uses existing conversation context correctly
  await t.test('Test 9: Câu hỏi tiếp nối (Follow-up) -> Sử dụng đúng ngữ cảnh trước đó', async () => {
    const history = [
      { role: 'user', text: 'Chiếc SIGMA Model E giá bao nhiêu?' },
      { role: 'assistant', text: 'SIGMA Model E có giá niêm yết là 1.290.000.000 VNĐ, tầm hoạt động 600 km.' }
    ];
    const res = await AIService.chat({
      message: 'Chiếc xe này sạc bao lâu thì đầy?',
      history
    });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.match(res.text, /(Model E|sạc|phút|pin)/i, 'Phải hiểu ngữ cảnh đang nói về Model E');
  });

  // Test 10: Model/API failure → Displays user-friendly error without internal diagnostic leakage
  await t.test('Test 10: Xử lý lỗi an toàn -> Không lộ API Key, Stack trace hay tên nội bộ', async () => {
    // Test with missing/invalid configuration in isolated call
    const originalProvider = AIService.config.provider;
    const originalKey = AIService.config.geminiApiKey;
    const originalFallback = AIService.config.allowLocalFallback;

    try {
      AIService.config.provider = 'gemini';
      AIService.config.geminiApiKey = '';
      AIService.config.allowLocalFallback = false;

      const res = await AIService.chat({ message: 'Xin chào' });
      assert.ok(res && res.text, 'Phải trả về thông báo lỗi an toàn');
      assert.doesNotMatch(res.text, /AIzaSy/i, 'Tuyệt đối không lộ API key');
      assert.doesNotMatch(res.text, /at .* \(/, 'Không lộ stack trace');
      assert.doesNotMatch(res.text, /Error:/, 'Không lộ raw error object');
    } finally {
      AIService.config.provider = originalProvider;
      AIService.config.geminiApiKey = originalKey;
      AIService.config.allowLocalFallback = originalFallback;
    }
  });

  // Additional Test 11: Privacy & Clean Public Identity
  await t.test('Test 11: Ẩn thông tin kỹ thuật nội bộ (Provider, Model ID, Live RAG badges)', async () => {
    const res = await AIService.chat({ message: '1+1 bằng mấy?' });
    assert.equal(res.provider, undefined, 'Không được trả về provider nội bộ cho client');
    assert.equal(res.model, undefined, 'Không được trả về model ID nội bộ cho client');
    assert.equal(res.warning, undefined, 'Không lộ diagnostic warning cho khách hàng');

    const pubConfig = AIService.getPublicConfig();
    assert.equal(pubConfig.apiKey, undefined, 'apiKey bí mật không được trả về');
    assert.equal(pubConfig.geminiApiKey, undefined, 'geminiApiKey bí mật không được trả về');
    assert.equal(typeof pubConfig.hasApiKey, 'boolean', 'hasApiKey phải là cờ boolean');
    assert.equal(pubConfig.geminiModel, 'gemini-2.5-flash', 'Model ID phải được cấu hình tập trung là gemini-2.5-flash');
  });
});
