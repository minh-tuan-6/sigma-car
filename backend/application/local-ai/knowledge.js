// backend/application/local-ai/knowledge.js
// Curated automotive + SIGMA CAR site knowledge for the local engine. Each topic: id, match (folded text regex),
// optional `priority` (higher wins), and an answer. Answers are general guidance — never vehicle-specific specs
// (those always come from the live catalog).

'use strict';

const TOPICS = [
  {
    id: 'lfp-vs-nmc', priority: 3,
    match: /\b(lfp|nmc|nca|lithium iron|lithium sat|pin sat|ternary|pin tam nguyen|lfp va nmc|nmc va lfp|hoa hoc pin|loai pin|cong nghe pin)\b/,
    text: [
      '🔋 **Công nghệ pin LFP (Lithium Iron Phosphate – LiFePO₄)** và so sánh với **NMC** (Nickel-Mangan-Cobalt):',
      '',
      '| Tiêu chí | LFP (Lithium sắt phốt phát) | NMC (Ternary) |',
      '|---|---|---|',
      '| Mật độ năng lượng | Thấp hơn (~160–200 Wh/kg) | Cao hơn (~220–280 Wh/kg) → đi xa hơn với cùng khối lượng |',
      '| Tuổi thọ chu kỳ | Rất cao, thường **3.000–6.000 chu kỳ** | Khoảng 1.500–2.500 chu kỳ |',
      '| An toàn nhiệt | **Rất an toàn**, khó xảy ra thoát nhiệt (thermal runaway) | Nhạy nhiệt hơn, cần hệ quản lý nhiệt tốt |',
      '| Sạc đầy 100% | Có thể sạc 100% thường xuyên | Nên giữ 20–80% cho sử dụng hằng ngày |',
      '| Trời lạnh | Hao hụt công suất rõ hơn | Chịu lạnh tốt hơn |',
      '| Giá thành | Rẻ hơn, không dùng cobalt | Đắt hơn |',
      '',
      '**Tóm lại:** LFP phù hợp xe đô thị/xe dịch vụ cần bền, an toàn, chi phí thấp; NMC phù hợp xe cần tầm hoạt động dài và hiệu năng cao.'
    ].join('\n')
  },
  {
    id: 'charging-basics', priority: 2,
    match: /\b(sac ac|sac dc|sac cham|sac nhanh|sac tai nha|wallbox|sac bao lau|bao lau thi day|thoi gian sac|sac day|cong sac|ccs2|tram sac la gi|kw sac|sac qua dem|cach sac)\b/,
    text: [
      '⚡ **Thời gian sạc xe điện phụ thuộc vào 3 yếu tố:** dung lượng pin (kWh), công suất bộ sạc (kW) và công suất tối đa xe nhận được.',
      '',
      '• **Sạc AC tại nhà (3,7–11 kW):** sạc đầy pin thường mất **6–12 giờ** (qua đêm). Công thức gần đúng: *thời gian ≈ dung lượng pin ÷ công suất sạc*.',
      '• **Sạc nhanh DC (50–350 kW):** từ **10% → 70–80% chỉ khoảng 20–40 phút** tùy xe. Đoạn 80–100% chậm lại để bảo vệ pin.',
      '• **Mẹo:** sạc hằng ngày ở mức 20–80%, chỉ sạc 100% trước chuyến đi xa; hạn chế sạc nhanh DC liên tục khi pin còn nóng.',
      '',
      'Bạn có thể xem bản đồ trạm sạc & điểm đổi pin trong mục **Trạm sạc** trên website, hoặc hỏi tôi "*[tên xe] sạc nhanh bao lâu*" để xem thông số sạc chính hãng của từng mẫu.'
    ].join('\n')
  },
  {
    id: 'battery-health', priority: 2,
    match: /\b(soh|suc khoe pin|chai pin|tuoi tho pin|pin xuong cap|pin dung duoc bao lau|thay pin|bao duong pin|giu pin|pin co ben)\b/,
    text: [
      '🩺 **Sức khỏe pin (SoH – State of Health)** là tỷ lệ dung lượng còn lại so với pin mới.',
      '',
      '• Pin xe điện hiện đại thường giữ **~80–90% sau 8–10 năm** hoặc 160.000–200.000 km; nhiều hãng bảo hành pin 8–10 năm.',
      '• **Yếu tố làm pin chai nhanh:** sạc nhanh DC liên tục, thường xuyên để pin 0% hoặc 100% lâu, đỗ xe dưới nắng gắt.',
      '• **Cách giữ pin bền:** sạc 20–80% hằng ngày, đỗ nơi râm mát, cập nhật phần mềm quản lý pin (BMS).',
      '',
      'Với xe đã qua sử dụng, SIGMA CAR hiển thị **SoH đo kiểm thực tế** (nếu có) trên trang chi tiết xe; mục **Gara của tôi** cho phép theo dõi lịch sử pin.'
    ].join('\n')
  },
  {
    id: 'real-range', priority: 2,
    match: /\b(tam hoat dong thuc te|quang duong thuc te|di thuc te|wltp|nedc|epa|hao pin|ton pin|bat dieu hoa|dieu hoa ton pin|hao dien)\b/,
    text: [
      '🛣️ **Tầm hoạt động công bố vs thực tế:**',
      '',
      '• Con số hãng công bố theo chu trình thử (NEDC > WLTP > EPA – NEDC thường "lạc quan" nhất). Thực tế ở Việt Nam thường đạt **~75–90%** con số WLTP.',
      '• **Làm giảm tầm hoạt động:** chạy cao tốc >100 km/h, bật điều hòa mạnh (≈5–10%), chở nặng, lốp non, thời tiết nóng/lạnh.',
      '• **Tăng tầm hoạt động:** bật phanh tái sinh mức cao, giữ tốc độ đều 60–80 km/h, làm mát xe trước khi rút sạc (pre-conditioning).',
      '',
      'Điều hòa trên xe điện dùng máy nén điện nên **làm mát rất nhanh** ngay khi bật, kể cả lúc xe đứng yên – không cần nổ máy như xe xăng.'
    ].join('\n')
  },
  {
    id: 'ev-vs-gas', priority: 2,
    match: /\b(xe dien hay xe xang|xe xang hay xe dien|nen mua xe dien|co nen mua xe dien|uu nhuoc diem xe dien|xe dien co tot|dien hay xang|xang hay dien|xe dien co ben)\b/,
    text: [
      '⚖️ **Xe điện hay xe xăng?** Tóm tắt nhanh:',
      '',
      '**Xe điện (EV)** – ✅ chi phí năng lượng thấp (thường chỉ ~1/3–1/2 tiền xăng), bảo dưỡng ít (không thay dầu, ít chi tiết hao mòn), êm, tăng tốc tức thì. ⚠️ Cần chỗ sạc ổn định, đi đường dài phải tính trạm sạc, giá mua ban đầu thường cao hơn.',
      '',
      '**Xe xăng** – ✅ đổ nhiên liệu 5 phút, đi đâu cũng có cây xăng, giá xe lựa chọn đa dạng. ⚠️ Tốn nhiên liệu và bảo dưỡng định kỳ nhiều hơn.',
      '',
      '**Hybrid** – nằm giữa: tiết kiệm xăng rõ rệt trong phố mà không phụ thuộc trạm sạc.',
      '',
      '👉 Nếu bạn có chỗ sạc tại nhà và chạy chủ yếu trong phố → EV thường có lợi. Cho tôi biết **quãng đường mỗi ngày** và **ngân sách**, tôi sẽ gợi ý cụ thể và ước tính chi phí vận hành.'
    ].join('\n')
  },
  {
    id: 'hybrid', priority: 2,
    match: /\b(hybrid la gi|xe hybrid|hev la gi|phev la gi|mild hybrid|xe lai la gi|e-cvt la gi|hybrid co tot)\b/,
    text: [
      '🔄 **Xe Hybrid** kết hợp động cơ xăng + mô-tơ điện + pin nhỏ:',
      '',
      '• **HEV (full hybrid):** tự sạc qua phanh tái sinh và động cơ, không cần cắm sạc; tiết kiệm nhiên liệu 20–40% trong phố.',
      '• **PHEV (plug-in hybrid):** pin lớn hơn, cắm sạc được, đi thuần điện ~40–80 km rồi mới dùng xăng.',
      '• **Mild hybrid (MHEV):** mô-tơ nhỏ chỉ hỗ trợ khởi động/tăng tốc, tiết kiệm ít hơn.',
      '',
      'Hybrid phù hợp người chạy nhiều trong phố nhưng chưa có chỗ sạc cố định.'
    ].join('\n')
  },
  {
    id: 'drivetrain', priority: 2,
    match: /\b(awd la gi|4wd la gi|fwd la gi|rwd la gi|dan dong la gi|cau truoc va cau sau|awd va 4wd|xe 2 cau|dan dong 4 banh la gi)\b/,
    text: [
      '🛞 **Các kiểu dẫn động:**',
      '',
      '• **FWD (cầu trước):** nhẹ, tiết kiệm, rộng khoang cabin – phổ biến trên xe phổ thông.',
      '• **RWD (cầu sau):** cân bằng trọng lượng tốt, cảm giác lái thể thao.',
      '• **AWD (4 bánh toàn thời gian/tự động):** bám đường tốt khi mưa, đường trơn; tăng tốc mạnh.',
      '• **4WD (2 cầu, thường có số phụ):** chuyên địa hình, lội nước, leo dốc – xe bán tải, SUV off-road.'
    ].join('\n')
  },
  {
    id: 'adas', priority: 2,
    match: /\b(adas|hỗ trợ lái|ho tro lai|giu lan|kiem soat hanh trinh|acc la gi|phanh khan cap|tu lai|lane keeping|autopilot|level 2)\b/,
    text: [
      '🛡️ **ADAS (hệ thống hỗ trợ lái nâng cao)** thường gồm:',
      '',
      '• **ACC** – ga tự động thích ứng giữ khoảng cách xe trước',
      '• **LKA/LCA** – hỗ trợ giữ làn / chuyển làn',
      '• **AEB** – phanh khẩn cấp tự động',
      '• **BSM, RCTA** – cảnh báo điểm mù, cảnh báo phương tiện cắt ngang khi lùi',
      '',
      'ADAS **Level 2** vẫn yêu cầu người lái giữ tay trên vô-lăng và chịu trách nhiệm hoàn toàn. Hỏi tôi "*[tên xe] có tính năng gì*" để xem trang bị của từng mẫu.'
    ].join('\n')
  },
  {
    id: 'ev-maintenance', priority: 2,
    match: /\b(bao duong xe dien|xe dien bao duong|bao duong dinh ky|chi phi bao duong|thay dau|bao duong bao nhieu)\b/,
    text: [
      '🔧 **Bảo dưỡng xe điện vs xe xăng:**',
      '',
      '• **Xe điện:** không thay dầu máy, lọc nhớt, bugi, dây curoa. Chủ yếu kiểm tra phanh, lốp, nước làm mát pin, lọc gió điều hòa, cập nhật phần mềm → chi phí thường **thấp hơn 30–50%**.',
      '• **Xe xăng:** thay dầu mỗi 5.000–10.000 km, bảo dưỡng lớn theo mốc 40.000/80.000 km.',
      '',
      'Bạn có thể đặt lịch bảo dưỡng và theo dõi nhắc lịch trong mục **Gara của tôi**.'
    ].join('\n')
  },
  {
    id: 'rolling-cost', priority: 2,
    match: /\b(lan banh|chi phi lan banh|truoc ba|phi truoc ba|bien so|dang kiem|phi duong bo|bao hiem bat buoc|thue truoc ba)\b/,
    text: [
      '🧾 **Chi phí lăn bánh** = giá xe + các khoản bắt buộc:',
      '',
      '• **Lệ phí trước bạ:** thường 10–12% giá xe với xe xăng (tùy tỉnh); xe điện đang được **ưu đãi theo chính sách hiện hành** (đã từng miễn 100%) – nên kiểm tra quy định mới nhất tại thời điểm mua.',
      '• **Phí biển số:** từ vài trăm nghìn đến ~20 triệu tùy khu vực.',
      '• **Đăng kiểm, phí bảo trì đường bộ, bảo hiểm TNDS bắt buộc:** vài triệu đồng/năm.',
      '• **Bảo hiểm vật chất (tự nguyện):** khoảng 1,2–1,8% giá xe/năm.',
      '',
      'Con số chính xác do cơ quan nhà nước và đơn vị bảo hiểm quyết định; trang **TCO / chi phí sở hữu** của website giúp ước tính chi phí vận hành nhiều năm.'
    ].join('\n')
  },
  {
    id: 'loan-basics', priority: 1,
    match: /\b(vay mua xe|tra gop la gi|thu tuc vay|ho so vay|lai suat vay|vay ngan hang|dieu kien vay|du no giam dan|lai phang)\b/,
    text: [
      '🏦 **Mua xe trả góp – điều cần biết:**',
      '',
      '• Thường **trả trước 20–30%**, vay phần còn lại trong **3–8 năm**.',
      '• **Dư nợ giảm dần (annuity/gốc đều):** lãi tính trên số dư còn lại → tổng lãi thấp hơn. **Lãi phẳng (flat):** lãi tính trên số vay ban đầu → nghe rẻ nhưng tổng lãi cao hơn.',
      '• Hồ sơ: CCCD, giấy tờ chứng minh thu nhập, hộ khẩu/xác nhận cư trú; xe thường được thế chấp chính xe đang mua.',
      '• Nguyên tắc an toàn: **khoản trả hằng tháng ≤ 30–40% thu nhập**.',
      '',
      'Hỏi tôi "*trả góp [tên xe] trả trước 30% trong 5 năm*" để tôi tính ngay số tiền hằng tháng, hoặc dùng **Máy tính trả góp** trên trang chi tiết xe.'
    ].join('\n')
  },
  // ---- SIGMA CAR site help -------------------------------------------------------------------------------------
  {
    id: 'site-test-drive', priority: 4,
    match: /\b(lai thu|dang ky lai thu|dat lich lai thu|test drive|thu xe)\b/,
    text: '🚗 **Đăng ký lái thử:** mở trang chi tiết xe → bấm **"Đặt lịch lái thử"** → chọn chi nhánh, ngày và khung giờ còn trống. Bạn sẽ nhận thông báo xác nhận; nhân viên showroom có thể đổi trạng thái sang *Đã xác nhận / Hoàn thành*. Bạn có thể xem và hủy lịch trong **Tài khoản → Lịch hẹn**.'
  },
  {
    id: 'site-deposit', priority: 4,
    match: /\b(dat coc|coc xe|tien coc|thanh toan|cach thanh toan|nhan giu|tra tien|thanh toan the nao|chuyen khoan)\b/,
    text: '💳 **Đặt cọc & thanh toán trên SIGMA CAR:** chọn xe → **Đặt cọc** hoặc **Mua ngay** → điền thông tin → hộp xác nhận hiện ra *"Xác nhận trả [số tiền]?"* → **nhấn giữ nút xanh lá 5 giây** để hoàn tất. Đây là **cổng thanh toán mô phỏng (sandbox)** dành cho trải nghiệm demo – không trừ tiền thật. Sau khi thanh toán, đơn hàng hiển thị trong **Tài khoản → Đơn hàng**.'
  },
  {
    id: 'site-return', priority: 4,
    match: /\b(doi tra|tra xe|hoan tien|tra hang|chinh sach doi|refund)\b/,
    text: '↩️ **Đổi trả:** SIGMA CAR hỗ trợ yêu cầu đổi trả trong **7 ngày** kể từ khi nhận hàng (áp dụng theo điều kiện trong chính sách). Vào **Tài khoản → Đơn hàng → Yêu cầu đổi trả**, chọn lý do và đính kèm ảnh. Bộ phận CSKH sẽ xét duyệt và cập nhật trạng thái cho bạn.'
  },
  {
    id: 'site-warranty', priority: 4,
    match: /\b(tra cuu bao hanh|kich hoat bao hanh|so vin|ma vin|bao hanh o dau|kiem tra bao hanh)\b/,
    text: '🛡️ **Bảo hành:** sau khi xe được bàn giao, bạn có thể **kích hoạt và tra cứu bảo hành theo số VIN** trong mục **Gara của tôi**. Thời hạn bảo hành cụ thể khác nhau theo từng mẫu – hỏi tôi "*[tên xe] bảo hành bao lâu*" để xem chính sách chính hãng.'
  },
  {
    id: 'site-charging-map', priority: 4,
    match: /\b(tram sac o dau|ban do tram sac|tim tram sac|doi pin|tram doi pin|cho sac gan)\b/,
    text: '🗺️ **Trạm sạc & đổi pin:** mở mục **Trạm sạc** trên thanh menu để xem bản đồ trạm sạc, công suất, trạng thái và điểm đổi pin. Mục này cũng có thông tin hệ sinh thái pin và ước tính thời gian sạc.'
  },
  {
    id: 'site-ar', priority: 4,
    match: /\b(\bar\b|thuc te tang cuong|xem xe 3d|xem 3d|xem xe trong nha|360 do|vr)\b/,
    text: '🕶️ **Xem xe 3D / AR:** trên trang chi tiết xe, bấm **"Xem 3D"** để xoay 360° và đổi màu; trên điện thoại hỗ trợ, bấm **"Xem AR"** để đặt chiếc xe kích thước thật ngay trong không gian của bạn.'
  },
  {
    id: 'site-compare', priority: 3,
    match: /\b(cach so sanh|trang so sanh|so sanh tren web|cong cu so sanh)\b/,
    text: '📊 **So sánh xe:** bấm nút **"So sánh"** trên thẻ xe (tối đa vài mẫu cùng lúc) rồi mở trang **So sánh** để xem bảng thông số song song. Hoặc hỏi thẳng tôi: "*So sánh VinFast VF 9 và Land Rover Defender*".'
  },
  {
    id: 'site-tco', priority: 3,
    match: /\b(tco|chi phi so huu|tong chi phi so huu|cong cu tinh chi phi)\b/,
    text: '🧮 **Chi phí sở hữu (TCO):** trang **TCO** cho phép nhập quãng đường mỗi ngày, mức tiêu thụ, giá điện/xăng để ước tính chi phí vận hành theo tháng/năm/5 năm và lưu kết quả vào Gara. Bạn cũng có thể hỏi tôi: "*Chi phí nuôi VinFast VF 3 mỗi tháng nếu đi 40 km/ngày*".'
  }
];

/** pick the best matching topic (highest priority, then earliest match) */
function findTopic(folded) {
  let best = null;
  for (const t of TOPICS) {
    const m = folded.match(t.match);
    if (!m) continue;
    const score = (t.priority || 1) * 1000 - m.index;
    if (!best || score > best.score) best = { topic: t, score };
  }
  return best ? best.topic : null;
}

module.exports = { TOPICS, findTopic };
