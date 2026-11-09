# DỰ ÁN THƯƠNG MẠI ĐIỆN TỬ: SIGMACAR (ELECTRIC & CERTIFIED)
> **Môn học:** Nhập môn Công nghệ Thông tin  
> **Nền tảng:** Sàn thương mại điện tử ô tô điện thông minh & xe lướt đạt chuẩn chính hãng (Certified Pre-Owned) tích hợp trợ lý trí tuệ nhân tạo (Sigma AI Assistant).

---

## 🌟 1. Giới thiệu tổng quan
**SIGMACAR** là nền tảng thương mại điện tử tiên phong trong lĩnh vực di chuyển thuần điện tại Việt Nam, mang đến giải pháp mua bán ô tô trực tuyến minh bạch, hiện đại và chuẩn mực cao cấp:
1. **Dòng xe mới (New Cars):** Phân phối độc quyền các mẫu xe thuần điện cao cấp thế hệ tiếp theo (SIGMA Model E, SIGMA Vision S, SIGMA City G, SIGMA X-Series GT).
2. **Xe qua sử dụng chính hãng (Certified Pre-Owned):** Cam kết quy trình kiểm định 176 điểm nghiêm ngặt, chính sách "3 Không" (không đâm đụng, không ngập nước, không tua ODO) và bảo hành pin/động cơ chính hãng.
3. **Trợ lý trí tuệ nhân tạo (Sigma AI Assistant):** Hệ thống AI đa phương thức hỗ trợ tư vấn dòng xe theo ngân sách, phân tích sở thích cá nhân hóa, và **đo lường kích thước gara qua AR** để đảm bảo xe vừa vặn chỗ đỗ.
4. **Hệ thống Quản trị Đại lý (Seller Dashboard):** Quản lý doanh số, đơn cọc xe trực tuyến, lịch hẹn lái thử và chăm sóc khách hàng.

---

## 🚀 2. Hướng dẫn khởi chạy ứng dụng

### Cách 1: Chạy bằng máy chủ cục bộ (Khuyên dùng)
Dự án đã tích hợp sẵn một máy chủ Web siêu nhẹ:
```bash
node server.js
```
Mở trình duyệt bất kỳ (Chrome, Edge, Firefox, Cốc Cốc) và truy cập:
👉 **`http://localhost:3000`**

### Cách 2: Mở trực tiếp file HTML
Bạn có thể mở trực tiếp file [`index.html`](file:///d:/Project%20nh%E1%BA%ADp%20m%C3%B4n%20cntt/index.html) bằng cách click đúp chuột trên trình duyệt.

---

## 📱 3. Danh sách các màn hình & Chức năng chi tiết

| Đường dẫn (Hash) | Tên màn hình | Chức năng chính |
|---|---|---|
| `#home` | **Trang chủ (Home Page)** | Hero banner xe điện, thanh tìm kiếm nhanh, showcase dòng xe mới, xe Certified Pre-Owned, banner Sigma AI Experience, đánh giá khách hàng, chân trang. |
| `#new-cars` | **Dòng xe mới** | Bộ lọc phân khúc (SUV, Sedan, Compact), nguồn năng lượng, bộ cấu hình 3D xe trực quan, đánh giá khách hàng. |
| `#certified` | **Xe qua sử dụng chính hãng** | Danh mục xe lướt đạt chuẩn kiểm định 176 điểm, kiểm tra sức khỏe pin (>92%), số ODO, số VIN, gói SIGMACAR Care (bảo hành 12-24 tháng, cứu hộ 24/7, cam kết mua lại). |
| `#detail` | **Chi tiết xe (Vehicle Detail)** | Visualizer chọn màu 3D ngoại thất, thông số kỹ thuật (WLTP, công suất, pin), công nghệ ADAS, dự toán trả góp, nút đặt cọc trực tuyến. |
| `#ai-advisor` | **Sigma AI Tư Vấn Thông Minh** | Trợ lý chatbot thông minh đa phương thức, phân tích ngân sách, tính điểm Match Score %, và **quét ảnh gara đo lường AR** xem xe có đỗ vừa không. |
| `#compare` | **So sánh xe** | Đối chiếu thông số kỹ thuật đồng thời tối đa 3 xe (giá bán, kích thước, hiệu suất động cơ, dung lượng pin, thời gian sạc, tính năng an toàn). |
| `#seller-dashboard` | **Quản lý Đại lý (Seller)** | Thống kê doanh số tháng (4.28 tỷ), biểu đồ doanh thu Canvas, biểu đồ phân khúc hình tròn Donut, quản lý đơn cọc và danh sách lịch hẹn lái thử. |
| `#profile` | **Trang cá nhân & Gara** | Hồ sơ Gold Member, quản lý xe đang sở hữu trong gara (tình trạng pin, lịch bảo dưỡng kế tiếp), lịch sử hoạt động, danh sách xe đã lưu yêu thích. |

---

## 🤖 4. Điểm nhấn tính năng Trí tuệ Nhân tạo (Sigma AI)
- **Natural Language Understanding (NLU):** Hiểu các câu hỏi tự nhiên về ngân sách ("dưới 1 tỷ", "khoảng 1.5 tỷ"), mục đích sử dụng ("xe cho gia đình 5 người", "xe đi làm trong phố"), và pin/trạm sạc.
- **Match Score Card:** Tự động tính toán độ tương thích của xe và hiển thị card xe tương tác ngay trong khung chat kèm nút xem chi tiết và so sánh.
- **AR Garage Dimension Check:** Giả lập công nghệ AR quét kích thước gara (dài x rộng x cao), đối chiếu với kích thước vật lý của xe (Dài 4.975mm, Rộng 1.964mm) và đưa ra kết luận xe đỗ vừa vặn cùng cảnh báo điểm mù an toàn.
- **Lưu lịch sử hội thoại:** Cho phép xem lại các phiên tư vấn trước đó ("Xe gia đình 7 chỗ", "Ngân sách 1.5 tỷ SUV", "Phân tích gara chung cư").

---

## 🛠️ 5. Cấu trúc thư mục mã nguồn
```text
Project nhập môn cntt/
├── assets/                          # Kho tài nguyên hình ảnh trích xuất chuẩn Figma
│   ├── hero-bg.jpg                  # Ảnh nền Hero Banner
│   ├── model-e.jpg                  # Ảnh xe SIGMA Model E (SUV)
│   ├── vision-s.jpg                 # Ảnh xe SIGMA Vision S (Sedan GT)
│   ├── city-g.jpg                   # Ảnh xe SIGMA City G (Compact)
│   ├── x-series.jpg                 # Ảnh xe SIGMA X-Series GT
│   ├── car-certified-*.jpg          # Ảnh xe qua sử dụng chính hãng
│   └── avatar-*.jpg                 # Ảnh đại diện người dùng, chuyên viên, AI
├── css/
│   └── style.css                    # Toàn bộ CSS Design System (Tone Xanh Electric, Dark UI, Responsive)
├── js/
│   ├── data.js                      # CSDL tập trung (Xe mới, CPO, Thông số, Đại lý, User Profile)
│   ├── ai-engine.js                 # Bộ xử lý logic Trợ lý AI (Intent, AR Garage, Match Score)
│   └── app.js                       # Controller SPA, Router, Modal, Chart Canvas, Micro-interactions
├── Dự án thương mại điện tử/        # Thư mục gốc chứa 26 bản vẽ PDF export từ Figma
├── index.html                       # Trang giao diện chính của ứng dụng
├── server.js                        # Máy chủ Node.js cục bộ
└── README.md                        # Tài liệu hướng dẫn dự án
```
