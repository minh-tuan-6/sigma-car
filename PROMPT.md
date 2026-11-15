# TỔNG HỢP PROMPT THEO PHONG CÁCH SINH VIÊN (27 CHỨC NĂNG) & KIỂM KÊ CÔNG NGHỆ / MÃ NGUỒN MỞ (`PROMPT.md`)

> **Dự án:** Sàn Thương mại Điện tử Ô tô Điện Thông minh **SIGMACAR**  
> **Mục đích tài liệu:**  
> 1. Cung cấp bộ **Prompt đơn giản theo đúng văn phong sinh viên làm đồ án** cho từng chức năng trong **27 nhóm chức năng (`1.2.1` → `1.2.27`)** (kèm prompt tổng khởi tạo dự án và prompt tạo dữ liệu demo hài hước) để có thể tái tạo hoặc yêu cầu AI sinh ra đúng tính năng đó.  
> 2. Thống kê và dẫn chứng toàn bộ **công nghệ, chuẩn kỹ thuật (Apple ARKit / AR Quick Look, Pixar USDZ, Khronos glTF/Draco, WebXR...)**, **thư viện mã nguồn mở (Open Source)** và **tài liệu tham khảo** mà dự án thực tế đang sử dụng.

---

## PHẦN 1: BỘ PROMPT ĐƠN GIẢN GIỐNG SINH VIÊN VIẾT CHO 27 CHỨC NĂNG

### 💡 Prompt 0: Prompt Khởi Tạo Khung Đồ Án Tổng Thể (Base Project)
> *"Mình đang làm đồ án môn Nhập môn CNTT / Thương mại điện tử về một web bán ô tô điện tên là **SIGMACAR**. Bạn code giúp mình một trang web Single-Page App bằng HTML, CSS, JavaScript thuần (không dùng React để dễ chạy trực tiếp) kết hợp backend Node.js và chạy được trên Cloudflare Workers + D1 nhé. Giao diện làm kiểu hiện đại, tông màu tối (Dark Mode) pha xanh điện (Electric Blue) giống web hãng xe sang. Có thanh menu chuyển trang mượt bằng dấu `#` (`#home`, `#new-cars`, `#certified`, `#detail`, `#compare`, `#ai-advisor`, `#cart`, `#checkout`, `#profile`, `#seller-dashboard`) và có sẵn dữ liệu các mẫu xe điện/xe xăng để bấm vào xem được luôn."*

---

### Nhóm 1: Khám Phá, Tư Vấn AI & Công Cụ Tính Toán (`1.2.1` – `1.2.5`)

#### 1.2.1. AI Personalized Vehicle Advisor (Trợ lý AI Tư vấn Xe Cá nhân hóa)
- **Prompt kiểu sinh viên (Ngắn gọn, tự nhiên):**
  > *"Làm cho mình trang **AI Tư vấn chọn xe (`#ai-advisor`)**. Cho người dùng nhập chiều cao, cân nặng, ngân sách hiện có, mỗi ngày đi bao nhiêu km, hay đi đường phố hay đèo dốc, và có nút tải lên 2 tấm ảnh: ảnh dáng người với ảnh chụp chỗ đỗ xe hoặc cốp xe ở nhà. Khi bấm 'Phân tích', AI sẽ chấm điểm độ hợp (`Match Score %`) rồi gợi ý ra Top 2–3 chiếc xe hợp nhất trong shop, giải thích rõ vì sao xe đó vừa với chiều cao yên, công suất máy đủ khỏe và pin đủ đi cả ngày, đồng thời kiểm tra xem kích thước xe có đỗ vừa cái sân/gara trong ảnh không."*
- **Gợi ý câu nối thêm nếu muốn có Chatbot:**
  > *"Thêm luôn một khung chat AI ở bên cạnh để khách gõ hỏi tự nhiên kiểu 'nhà 5 người ngân sách 1 tỷ mua xe gì' thì chatbot lấy đúng dữ liệu xe trong shop ra trả lời và hiện thẻ xe bấm vào xem chi tiết được luôn."*

#### 1.2.2. Smart Comparison Matrix (Bảng So Sánh Xe Thông Minh)
- **Prompt kiểu sinh viên:**
  > *"Code giúp mình chức năng **So sánh xe (`#compare`)**. Trên mỗi thẻ xe có nút 'So sánh', cho phép chọn từ 2 đến 4 xe cùng lúc (hiện một thanh nhỏ ở góc dưới màn hình). Khi bấm vào trang So sánh thì kẻ bảng đặt các xe nằm cạnh nhau để đọ thông số: giá bán, trọng lượng, tải trọng, công suất động cơ, dung lượng pin, quãng đường đi được 1 lần sạc, thời gian sạc nhanh, tốc độ tối đa và bảo hành. Thêm nút gạt 'Chỉ hiện điểm khác nhau' và tô màu nổi bật (highlight) thông số nào ngon nhất ở từng dòng cho dễ nhìn."*

#### 1.2.3. TCO Calculator (Công Cụ Tính Tổng Chi Phí Sở Hữu 5 Năm)
- **Prompt kiểu sinh viên:**
  > *"Làm giúp mình công cụ **Tính chi phí nuôi xe TCO trong 5 năm (`#tco`)**. Cho khách chọn 1 chiếc xe điện trong shop để so sánh với xe chạy xăng và so với tiền đi Grab/Be hằng ngày. Cho khách kéo thanh trượt số km đi mỗi ngày (tự nhân ra km/tháng), nhập giá điện và giá xăng. Web sẽ tự cộng tiền mua xe ban đầu, tiền sạc điện/đổ xăng, tiền bảo dưỡng định kỳ, bảo hiểm rồi vẽ biểu đồ cột so sánh 5 năm xem đi xe điện tiết kiệm được bao nhiêu triệu đồng, kèm nút lưu kết quả tính này vào Gara cá nhân."*

#### 1.2.4. Smart Vehicle Discovery (Tìm Kiếm & Bộ Lọc Xe Thông Minh)
- **Prompt kiểu sinh viên:**
  > *"Ở trang danh sách **Dòng xe mới (`#new-cars`)** và **Xe qua sử dụng (`#certified`)**, làm cho mình thanh tìm kiếm và bộ lọc nhiều tiêu chí: lọc theo hãng xe, kiểu dáng (SUV, Sedan, Hatchback, Bán tải), loại nhiên liệu (Điện, Hybrid, Xăng), khoảng giá tiền, quãng đường đi được tối thiểu, số chỗ ngồi và công suất máy. Thêm ô sắp xếp theo giá thấp đến cao, cao đến thấp, xe tiết kiệm chi phí nhất và xe hợp với mình nhất. Trên mỗi thẻ xe có nút trái tim để bấm lưu vào danh sách Yêu thích."*

#### 1.2.5. Product Detail Page - PDP (Trang Chi Tiết Sản Phẩm)
- **Prompt kiểu sinh viên:**
  > *"Thiết kế cho mình **Trang chi tiết xe (`#detail`)** thật xịn khi bấm vào một mẫu xe. Phần đầu hiện bộ ảnh ngoại thất/nội thất có phóng to xem nét, nút bật khung xoay 3D 360 độ ngay trên trang và nút chọn các phiên bản (`Trims`) hoặc đổi màu sơn xe. Phần dưới hiện đầy đủ bảng thông số kỹ thuật (công suất, pin, tốc độ, chiều cao yên/khoảng sáng gầm, tải trọng), kiểm tra xem showroom Hà Nội / Đà Nẵng / TP.HCM còn mấy chiếc, bảng tính nhanh phí lăn bánh, câu hỏi thường gặp (FAQ), mục đánh giá của người mua và các nút: Đặt cọc, Thêm vào giỏ, Tính trả góp, Đặt lịch lái thử, Xem AR."*

---

### Nhóm 2: Trải Nghiệm 3D, Thực Tế Tăng Cường AR & Gói Phụ Kiện (`1.2.6` – `1.2.8`)

#### 1.2.6. 3D Product Configurator (Phòng Trưng Bày & Cấu Hình Xe 3D Thời Gian Thực)
- **Prompt kiểu sinh viên:**
  > *"Mình muốn làm một **Showroom 3D 360 độ (`#vr-ar` / `#configurator`)** dùng thư viện Three.js để tải file mô hình xe `.glb` lên xoay mọi góc và phóng to thu nhỏ bằng chuột. Cho phép người dùng bấm chọn đổi màu sơn bóng như xe thật, đổi kiểu mâm xe (lazang), bấm nút bật/tắt đèn pha, mở/đóng cửa xe, chuyển góc camera vào ngồi thử khoang lái nội thất và gắn các chấm tròn (hotspot) trên thân xe bấm vào hiện thông tin. Khi đổi màu hay chọn mâm/phụ kiện thì giá tiền cập nhật theo thời gian thực và có nút Lưu cấu hình hoặc Đặt cọc ngay giữ nguyên màu đã chọn."*

#### 1.2.7. AR / VR Experience (Trải Nghiệm Đặt Xe Thực Tế Tăng Cường AR 1:1)
- **Prompt kiểu sinh viên:**
  > *"Làm cho mình trang **Xem xe ngoài đời thật bằng AR (`ar.html`)** theo đúng kích thước thật 1:1. Khi mở trên iPhone hoặc iPad bằng Safari, dùng công nghệ **Apple AR Quick Look (ARKit)** với thẻ `<a rel="ar">` mở file `.usdz` (hoặc tự chuyển từ file `.glb` sang `.usdz` theo đúng màu sơn khách đang chọn) để khách đặt chiếc xe ngay trên nền sân nhà mình và khóa không cho bóp méo tỉ lệ (`allowsContentScaling=0`). Nếu khách mở trên máy tính thì hiển thị mô hình 3D xoay được kèm mã QR để lấy điện thoại iPhone quét mở AR ngay."*

#### 1.2.8. Smart Bundle (Gói Combo Phụ Kiện Thông Minh)
- **Prompt kiểu sinh viên:**
  > *"Tạo cho mình mục **Mua kèm gói phụ kiện thông minh (`#bundles`)**. Khi khách chọn một chiếc xe, gợi ý sẵn 4 gói combo theo nhu cầu: 'Combo đi học', 'Combo đi làm', 'Combo giao hàng' và 'Combo gia đình' (gồm bộ sạc treo tường Wallbox, camera hành trình, phim cách nhiệt, thảm sàn, bảo hiểm thân vỏ, gói cứu hộ...). Khách tích chọn càng nhiều món (từ 2, 3, 4 món trở lên) thì hệ thống tự động giảm giá combo 5%, 10%, 15% và có nút 'Thêm nguyên gói vào giỏ hàng'."*

---

### Nhóm 3: Lái Thử, Đặt Hàng, Đăng Ký Biển Số, Giỏ Hàng & Trả Góp (`1.2.9` – `1.2.15`)

#### 1.2.9. Book a Test Drive (Đặt Lịch Lái Thử Xe)
- **Prompt kiểu sinh viên:**
  > *"Làm cho mình chức năng **Đặt lịch hẹn lái thử xe (`#test-drive`)**. Cho khách chọn mẫu xe muốn thử, chọn hình thức lái thử tại Showroom (Hà Nội, Đà Nẵng, TP.HCM) hoặc mang xe đến tận nhà, chọn ngày và khung giờ còn trống. Hệ thống phải kiểm tra xem khung giờ đó ở showroom đã kín chỗ chưa; nếu đặt thành công thì tạo mã hẹn, gửi thông báo xác nhận và cho phép khách đổi lịch hoặc hủy lịch trong trang cá nhân."*

#### 1.2.10. Flexible Ordering & Payment (Đặt Hàng & Thanh Toán Linh Hoạt)
- **Prompt kiểu sinh viên:**
  > *"Ở bước đặt mua xe, làm cho mình **3 hình thức thanh toán linh hoạt**: (1) Đặt cọc giữ xe trước (cho chọn cọc cố định 50 triệu hoặc cọc 5%–10% giá xe), (2) Thanh toán toàn bộ 100% giá trị xe (tặng thêm ưu đãi giảm giá trả thẳng), và (3) Mua xe trả góp qua ngân hàng. Hỗ trợ chọn các cổng thanh toán như quét mã QR chuyển khoản ngân hàng, thẻ quốc tế hoặc ví điện tử, có kiểm tra bảo mật webhook để đơn hàng tự động chuyển sang trạng thái Đã thanh toán."*

#### 1.2.11. Registration Services (Dịch Vụ Đăng Ký Lăn Bánh & Bấm Biển Số Trọn Gói)
- **Prompt kiểu sinh viên:**
  > *"Viết giúp mình module **Tính phí lăn bánh & Dịch vụ đăng ký biển số hộ (`#registration`)**. Cho khách chọn tỉnh/thành phố đăng ký (Hà Nội, TP.HCM hay các tỉnh khác) và loại biển số. Hệ thống tự tính: lệ phí trước bạ (xe điện được miễn 0%, xe xăng/hybrid tính 10%–12%), tiền biển số (20 triệu ở HN/HCM, 1 triệu ở tỉnh), phí đăng kiểm, phí bảo trì đường bộ, bảo hiểm trách nhiệm dân sự và phí dịch vụ đi bấm biển trọn gói, rồi cho phép cộng thẳng vào đơn hàng lúc thanh toán."*

#### 1.2.12. Cart & Checkout (Giỏ Hàng Đồng Bộ & Quy Trình Thanh Toán 4 Bước)
- **Prompt kiểu sinh viên:**
  > *"Làm cho mình **Giỏ hàng (`#cart`) và trang Thanh toán (`#checkout`)**. Giỏ hàng lưu được cả xe, màu sơn/mâm đã chọn ở 3D, gói combo phụ kiện và dịch vụ đăng ký biển số; khi khách đăng nhập thì tự gộp giỏ hàng lúc chưa đăng nhập vào tài khoản. Trang Checkout chia làm các bước rõ ràng: Kiểm tra giỏ hàng & nhập mã giảm giá → Nhập thông tin nhận xe / chọn showroom → Chọn hình thức đặt cọc/trả thẳng/trả góp → Xác nhận đặt hàng. Lúc bấm đặt hàng phải tự khóa giữ chỗ tồn kho để không bị2 người mua trùng 1 chiếc xe cuối cùng."*

#### 1.2.13. Smart Financing (Tính Vay Mua Xe Trả Góp & Gợi Ý Theo Thu Nhập)
- **Prompt kiểu sinh viên:**
  > *"Làm cho mình bảng **Tính trả góp mua xe thông minh (`Smart Financing`)**. Cho khách chọn số tiền trả trước (từ 10% đến 80%), thời hạn vay (12 đến 84 tháng), lãi suất ngân hàng, cách tính lãi theo dư nợ giảm dần hoặc trả đều mỗi tháng, và nhập thu nhập hàng tháng của khách. Hệ thống sẽ tính ra số tiền gốc + lãi phải đóng từng tháng, cảnh báo nếu tiền trả góp vượt quá 40% thu nhập, gợi ý các mẫu xe vừa túi tiền và có nút nộp hồ sơ đăng ký vay trực tuyến luôn."*

#### 1.2.14. Live Order Tracking (Theo Dõi Tiến Độ Đơn Hàng Trực Tiếp)
- **Prompt kiểu sinh viên:**
  > *"Tạo giao diện **Theo dõi tiến độ đơn hàng (`Live Order Tracking`)** giống như theo dõi đơn Shopee nhưng dành cho mua ô tô. Hiển thị thanh tiến trình 5 bước: Đã đặt cọc → Đã xác nhận đơn → Đang chuẩn bị xe & kiểm tra kỹ thuật (PDI) → Sẵn sàng bàn giao / Đang vận chuyển → Hoàn tất bàn giao. Hiển thị rõ số khung VIN của chiếc xe được gán cho khách, hợp đồng mua bán điện tử, biên bản bàn giao và thời gian cập nhật từng bước."*

#### 1.2.15. Self-service Return (Tự Gửi Yêu Cầu Đổi / Trả & Hoàn Tiền Đặt Cọc)
- **Prompt kiểu sinh viên:**
  > *"Trong phần lịch sử đơn hàng của khách, làm thêm nút **Yêu cầu Hủy cọc / Đổi trả xe (`Self-service Return`)**. Hệ thống tự kiểm tra chính sách xem đơn hàng có đủ điều kiện đổi trả/hoàn cọc không (theo số ngày và số km ODO đã đi), cho khách chọn lý do, viết mô tả, tải ảnh minh họa lên và theo dõi các bước từ lúc Gửi yêu cầu → Nhân viên thẩm định → Duyệt hoàn tiền → Đã hoàn tiền về tài khoản."*

---

### Nhóm 4: Hậu Mãi, Bảo Hành Số, Trạm Sạc, Gara Cá Nhân, Đánh Giá & CSKH (`1.2.16` – `1.2.20`)

#### 1.2.16. Digital Warranty & Maintenance (Bảo Hành Điện Tử & Đặt Lịch Bảo Dưỡng)
- **Prompt kiểu sinh viên:**
  > *"Làm cho mình phân hệ **Sổ bảo hành điện tử & Bảo dưỡng định kỳ**. Khi đơn hàng giao xe hoàn tất, hệ thống tự động kích hoạt bảo hành theo số VIN (ví dụ 8–10 năm hoặc 160.000 km). Khách có thể tra cứu thời hạn bảo hành xe và pin, xem các mốc nhắc bảo dưỡng định kỳ (12.000 km, 24.000 km...), chọn trung tâm dịch vụ gần nhất để đặt lịch bảo dưỡng/sửa chữa và xem lại toàn bộ lịch sử những lần xe đã vào xưởng thay thế phụ tùng gì."*

#### 1.2.17. Battery & Charging Ecosystem (Hệ Sinh Thái Pin & Bản Đồ Trạm Sạc / Đổi Pin)
- **Prompt kiểu sinh viên:**
  > *"Tạo cho mình trang **Hệ sinh thái Pin & Trạm sạc (`#charging`)**. Hiển thị danh sách và bản đồ các trạm sạc nhanh DC, sạc tiêu chuẩn AC và cả **trạm đổi pin nhanh**, cho lọc theo thành phố và loại đầu cắm (`CCS2`, `Type 2`), hiện số trụ đang trống. Thêm bảng thông tin chính sách **Thuê pin vs Mua đứt pin**, công cụ ước tính nhanh tiền sạc đầy 1 bình pin so với tiền đổ xăng, và nút bấm chuyển đơn giá điện của trạm sạc đó sang trang tính TCO."*

#### 1.2.18. My Garage (Gara Cá Nhân Của Tôi)
- **Prompt kiểu sinh viên:**
  > *"Trong trang cá nhân (`#profile`), làm một tab tên là **Gara của tôi (`My Garage`)**. Ở đây gom tất cả mọi thứ liên quan đến xe của khách vào một chỗ: danh sách xe khách đang sở hữu (kèm ảnh xe, số VIN, tình trạng sức khỏe pin SoH %, nhắc lịch bảo dưỡng sắp tới), danh sách xe bấm Yêu thích, các bản thiết kế phối màu 3D đã lưu, lịch sử các lần nhờ AI tư vấn chọn xe và các bảng tính chi phí TCO mà khách đã lưu lại."*

#### 1.2.19. Customer Reviews & Community (Đánh Giá Sản Phẩm & Hỏi Đáp Cộng Đồng)
- **Prompt kiểu sinh viên:**
  > *"Ở cuối trang chi tiết xe, làm cho mình mục **Đánh giá của khách hàng & Hỏi đáp (Q&A)**. Khách có thể chấm từ 1 đến 5 sao, viết nhận xét, đăng kèm hình ảnh thực tế và bấm nút 'Hữu ích' hoặc 'Báo cáo' bình luận. Đặc biệt, hệ thống phải tự kiểm tra xem tài khoản đó đã có đơn hàng mua mẫu xe này hoàn tất chưa; nếu mua thật rồi thì tự động gắn nhãn **'✓ Đã mua xe xác minh'** (hoặc **'✓ Đã mua hàng xác minh · Demo'** nếu là đơn hàng giả lập). Bên cạnh có tab Hỏi & Đáp để khách đặt câu hỏi về xe và nhân viên đại lý vào trả lời."*

#### 1.2.20. Customer Support Center (Trung Tâm Hỗ Trợ Khách Hàng & Ticket)
- **Prompt kiểu sinh viên:**
  > *"Làm cho mình **Trung tâm Hỗ trợ & CSKH (`#support`)**. Có mục Câu hỏi thường gặp (FAQ) chia theo chủ đề tìm kiếm nhanh, khung chat AI hỗ trợ tức thì, và form **Gửi phiếu yêu cầu hỗ trợ (Support Ticket)** cho phép chọn danh mục (Kỹ thuật, Thanh toán, Đơn hàng, Bảo hành), mức độ ưu tiên, đính kèm mã đơn hàng và ảnh chụp. Khách có thể tra cứu trạng thái xử lý phiếu hỗ trợ và nhắn tin trao đổi qua lại với nhân viên chăm sóc khách hàng."*

---

### Nhóm 5: Hệ Thống Quản Trị Dành Cho Seller & Admin (`1.2.21` – `1.2.27`)

#### 1.2.21. Product & Inventory Management (Quản Lý Sản Phẩm, Tồn Kho Đa Chi Nhánh & Khuyến Mãi)
- **Prompt kiểu sinh viên:**
  > *"Trong trang **Quản trị (`#seller-dashboard`)**, làm cho mình tab **Quản lý Xe, Kho hàng & Khuyến mãi**. Cho phép Admin thêm/sửa/ẩn mẫu xe, quản lý danh sách phụ kiện và tạo mã giảm giá theo % hoặc số tiền. Ở bảng Kho hàng, hiển thị số lượng xe đang có sẵn, đang giữ chỗ đặt cọc và số lượng theo từng màu sơn tại từng chi nhánh Showroom (Hà Nội, Đà Nẵng, TP.HCM). Nhân viên chi nhánh nào chỉ được chỉnh kho của chi nhánh đó, khi kho sắp hết thì báo cảnh báo đỏ và lưu lại lịch sử nhập/xuất kho."*

#### 1.2.22. Order & Customer Management (Quản Lý Đơn Hàng, Bàn Giao VIN & Hồ Sơ Khách Hàng)
- **Prompt kiểu sinh viên:**
  > *"Làm tab **Quản lý Đơn hàng & Khách hàng (CRM)** cho nhân viên đại lý. Nhân viên có thể lọc đơn hàng theo trạng thái, duyệt xác nhận thanh toán, gán số khung VIN thực tế cho xe của khách, tích chọn biên bản kiểm tra xe trước khi giao (PDI Checklist) và bấm hoàn tất bàn giao xe để sinh hợp đồng điện tử. Bên cạnh đó xem được danh sách khách hàng của chi nhánh, lịch sử mua xe, hồ sơ vay trả góp và danh sách lịch hẹn lái thử để bấm xác nhận hoặc hoàn tất."*

#### 1.2.23. After-sales Management (Quản Lý Hậu Mãi, Xưởng Dịch Vụ, Phụ Tùng & Đổi Trả)
- **Prompt kiểu sinh viên:**
  > *"Làm cho mình khu vực **Quản lý Hậu mãi & Xưởng dịch vụ** trong trang Admin/Seller. Bao gồm: tiếp nhận lịch hẹn bảo dưỡng của khách, mở lệnh sửa chữa trong xưởng (`Workshop Jobs`), phân công kỹ thuật viên và khoang sửa chữa, trừ số lượng phụ tùng trong kho (`Parts Ledger`) khi thay thế và cho phép nhập thêm phụ tùng mới. Đồng thời có bảng xử lý yêu cầu bảo hành (Warranty Claims) và duyệt yêu cầu đổi trả / hoàn tiền cho khách."*

#### 1.2.24. Analytics Dashboard (Bảng Điều Khiển Thống Kê Doanh Thu & Phễu Chuyển Đổi)
- **Prompt kiểu sinh viên:**
  > *"Vẽ cho mình **Dashboard Thống kê kinh doanh (`Analytics Dashboard`)** có các thẻ KPI tổng doanh thu, tổng tiền đặt cọc, số đơn hàng thành công, tỉ lệ hủy đơn và thời gian xử lý trung bình. Vẽ biểu đồ doanh thu theo thời gian, biểu đồ phễu chuyển đổi (từ lúc khách Xem xe → Mở 3D/AR → Đặt lịch lái thử → Thêm vào giỏ → Thanh toán), bảng xếp hạng Top mẫu xe bán chạy nhất, thống kê theo từng chi nhánh showroom và có nút Xuất báo cáo ra file CSV."*

#### 1.2.25. Content & Security Management (Quản Trị Nội Dung CMS, Duyệt Bình Luận & Bảo Mật)
- **Prompt kiểu sinh viên:**
  > *"Làm cho mình phần **Quản trị Nội dung (CMS) & Bảo mật hệ thống**. Cho phép Admin soạn thảo, lưu nháp và xuất bản các bài viết tin tức, banner trang chủ, câu hỏi FAQ và các trang chính sách (bảo hành, đổi trả, bảo mật) có lưu lịch sử phiên bản. Thêm bảng kiểm duyệt để ẩn/hiện các đánh giá hoặc câu hỏi vi phạm của người dùng. Về bảo mật, mật khẩu phải mã hóa an toàn, chống tạo đơn trùng lặp bằng Idempotency Key và có bảng xem lại Nhật ký hệ thống (`Audit Logs`) ghi rõ ai vừa sửa dữ liệu gì."*

#### 1.2.26. Email Marketing & Notifications (Chiến Dịch Email Marketing & Thông Báo Tự Động)
- **Prompt kiểu sinh viên:**
  > *"Làm cho mình chức năng **Thông báo tự động & Chiến dịch Email Marketing**. Mỗi khi khách đặt cọc, đổi trạng thái đơn hàng, đặt lịch lái thử hay tới hạn bảo dưỡng thì hệ thống tự bắn thông báo vào biểu tượng quả chuông trên web và đưa vào hàng đợi gửi email. Trong trang Admin, cho phép tạo chiến dịch gửi thông báo/email khuyến mãi theo nhóm khách hàng (khách đã mua xe, khách mới đăng ký, khách VIP), theo dõi số lượng gửi thành công/thất bại và tôn trọng tùy chọn từ chối nhận quảng cáo của khách."*

#### 1.2.27. Role & Permission Management (Phân Quyền Người Dùng RBAC Theo Chi Nhánh)
- **Prompt kiểu sinh viên:**
  > *"Thiết kế hệ thống **Phân quyền tài khoản (`Guest`, `Buyer`, `Seller`, `Admin`)** thật chặt chẽ. Khách tự đăng ký ngoài trang chủ thì mặc định luôn là `Buyer` (chỉ xem và sửa được đơn hàng, gara, hồ sơ của chính mình). `Seller` do Admin tạo và gắn với một chi nhánh cụ thể (ví dụ Showroom Cầu Giấy hoặc Quận 1) nên chỉ quản lý được kho, đơn hàng và lịch lái thử của chi nhánh đó. `Admin` có toàn quyền, có thể đổi quyền hoặc khóa tài khoản nhân viên/khách hàng (khi khóa thì tự động đăng xuất ngay lập tức), và có chốt chặn không cho phép tự khóa hoặc hạ quyền Admin cuối cùng của hệ thống."*

---

### 🎭 Prompt Bổ Sung: Tạo Dữ Liệu Demo Hài Hước ("Meme Sinh Viên")
- **Prompt kiểu sinh viên:**
  > *"Viết cho mình một script tự động tạo **dữ liệu giả lập (Demo Data)** thật đông vui để lúc mình thuyết trình đồ án nhìn web như đang có hàng trăm khách mua thật. Tạo khoảng 80 tài khoản khách hàng có tên tiếng Việt hài hước kiểu meme như: **Nguyễn Văn Tốc Độ, Trần Thị Bốc Đầu, Lê Văn Hết Pin, Phạm Văn Full Bình, Đặng Thị Quên Sạc, Hoàng Văn Vượt Đèn Đỏ, Nguyễn Thị Một Vạch Pin, Lý Văn Chạy Deadline, Phan Văn Cạn Ví...** Tạo luôn khoảng 120 đơn hàng demo đã mua xe thành công và 200 bình luận đánh giá từ 1 đến 5 sao vừa hài hước vừa chân thật (có hiện nhãn **'✓ Đã mua hàng xác minh · Demo'**). Nhớ đánh dấu `isDemo: true` cho tất cả dữ liệu giả này để không bị cộng nhầm vào báo cáo doanh thu thật của cửa hàng nhé!"*

---

## PHẦN 2: KIỂM KÊ TÀI LIỆU THAM KHẢO, DỰ ÁN OPEN SOURCE & CÔNG NGHỆ SỬ DỤNG TRONG DỰ ÁN

Qua quá trình rà soát toàn bộ mã nguồn, cấu hình `package.json`, `scripts/vendor_ar_libs.js`, `js/vendor/`, `js/libs/`, các tài liệu kỹ thuật trong `docs/` (`APPLE_AR_ARCHITECTURE.md`, `AR_IMPLEMENTATION_PLAN.md`, `CLOUDFLARE_WORKERS_AUDIT.md`, `CLOUDFLARE_D1_MIGRATION_PLAN.md`) và các thư mục dữ liệu gốc (`Dự án thương mại điện tử/`, `about car/`), dự án **SIGMACAR** có sử dụng và tham chiếu đến các **công nghệ cốt lõi, thư viện mã nguồn mở (Open Source) và tài nguyên thiết kế** sau đây:

---

### 1. Công Nghệ Thực Tế Tăng Cường (AR) & Đồ Họa 3D (ARKit, Quick Look, USDZ, glTF, WebGL)

Dự án **CÓ sử dụng trực tiếp hệ sinh thái AR của Apple (ARKit / AR Quick Look)** và các chuẩn đồ họa 3D mở quốc tế. Cụ thể:

| Công nghệ / Chuẩn kỹ thuật | Đơn vị phát triển | Bằng chứng trong dự án (`File:Line`) | Vai trò & Cách sử dụng thực tế trong SIGMACAR |
|---|---|---|---|
| **Apple ARKit & Apple AR Quick Look** | Apple Inc. | `docs/APPLE_AR_ARCHITECTURE.md:1-159`<br>`js/ar/apple/quick-look.js`<br>`js/ar/apple/apple-ar-support.js`<br>`ar.html:24-27` | Sử dụng trình xem **AR Quick Look** tích hợp sẵn trong Safari trên iOS/iPadOS (chạy trên nền **ARKit** native của Apple) thông qua cơ chế thẻ `<a rel="ar"><img /></a>` và kiểm tra tính năng bằng `a.relList.supports('ar')`. Hỗ trợ nhận diện mặt phẳng ngang (sàn nhà/mặt đường), ánh sáng môi trường thực tế, đổ bóng và khóa tỉ lệ xe 1:1 ngoài đời thực bằng tham số fragment `#allowsContentScaling=0` và `#canonicalWebPageURL`. |
| **Pixar Universal Scene Description (`.usdz` / USDA)** | Pixar Animation Studios & Apple | `scripts/build_usdz.js`<br>`js/ar/apple/usdz-builder.js`<br>`js/ar/apple/usdz-resolver.js`<br>`data/usdz-assets.json`<br>`_headers` (`model/vnd.usdz+zip`) | Chuẩn định dạng 3D bắt buộc của Apple AR Quick Look. Dự án vừa có pipeline dựng sẵn **58 file `.usdz`** cho 24 mẫu xe (`npm run usdz:build`), vừa có cơ chế tự động chuyển đổi trực tiếp từ `.glb` sang `.usdz` ngay trên thiết bị iPhone/iPad theo màu sơn khách chọn. |
| **Khronos glTF 2.0 / GLB (`model/gltf-binary`)** | The Khronos Group | `assets/models/*.glb` (24 mẫu xe)<br>`js/car-3d-viewer.js`<br>`js/ar/models/*` | Định dạng mô hình 3D nhị phân chuẩn mở dùng cho cả Showroom 3D 360° và làm nguồn dữ liệu gốc để xuất sang `.usdz`. |
| **WebXR Device API (`immersive-vr`)** | W3C Immersive Web Working Group | `js/car-3d-viewer.js`<br>`docs/APPLE_AR_ARCHITECTURE.md:141` | Sử dụng trong `js/car-3d-viewer.js` để hỗ trợ chế độ xem thực tế ảo (`immersive-vr`) trên kính VR chuyên dụng; trong khi phần AR camera trên di động được chuyển hẳn sang chuẩn Apple AR Quick Look. |
| **Google `<model-viewer>`** (Thế hệ AR v1 / Legacy Vendored) | Google Inc. (Apache-2.0 License) | `js/libs/model-viewer.min.js`<br>`AR_IMPLEMENTATION_PLAN.md:58, 88` | Thư viện Web Component mã nguồn mở của Google (`@google/model-viewer`) từng được tích hợp ở phiên bản kiến trúc AR đầu tiên (`ar-modes="webxr scene-viewer quick-look"`) và hiện vẫn còn lưu file bundle trong `js/libs/model-viewer.min.js`, trước khi trang `ar.html` được nâng cấp sang kiến trúc chuyên biệt `js/ar/**` dùng Three.js r170 + Apple AR Quick Look. |

---

### 2. Các Dự Án & Thư Viện Mã Nguồn Mở (Open Source Libraries)

Toàn bộ các thư viện mã nguồn mở được khai báo trong `package.json` hoặc được đóng gói trực tiếp (vendored) vào `js/vendor/` và `js/libs/` qua `scripts/vendor_ar_libs.js`:

| Tên dự án Open Source | Phiên bản | Giấy phép (License) | Đường dẫn trong Repository | Mục đích sử dụng |
|---|---|---|---|---|
| **Three.js** (`mrdoob/three.js`) | `r170` (`0.170.0`) & `r128` | **MIT License** (`js/vendor/three/LICENSE`) | `package.json:38`<br>`js/vendor/three/three.module.min.js`<br>`js/libs/three.min.js` | Engine đồ họa 3D WebGL cốt lõi cho Showroom 360° (`js/car-3d-viewer.js`) và trang chuẩn bị mô hình AR (`js/ar/`). |
| **Three.js Addons (JSM)** (`GLTFLoader`, `OrbitControls`, `RoomEnvironment`, `USDZExporter`, `BufferGeometryUtils`) | `0.170.0` | **MIT License** | `js/vendor/three/addons/**`<br>`scripts/vendor_ar_libs.js:18-37` | Nạp mô hình `.glb`, điều khiển camera xoay quanh xe, tạo ánh sáng phản chiếu PBR Studio và xuất file `.usdz` chuẩn Pixar/Apple ngay trên trình duyệt. |
| **Google Draco 3D Compression** (`google/draco`) | Vendored via Three.js | **Apache-2.0 License** | `js/vendor/three/addons/libs/draco/gltf/draco_decoder.wasm`<br>`js/libs/draco/` | Giải nén hình học 3D (mesh geometry compression) bằng WebAssembly giúp giảm dung lượng tải các file `.glb` ô tô độ chi tiết cao. |
| **Basis Universal & KTX2 Transcoder** (`BinomialLLC/basis_universal`) | Vendored via Three.js | **Apache-2.0 License** | `js/vendor/three/addons/libs/basis/basis_transcoder.wasm`<br>`loaders/KTX2Loader.js` | Giải mã texture nén GPU chuẩn KTX2/Basis bằng WebAssembly. |
| **meshoptimizer** (`zeux/meshoptimizer`) & **zstddec** | Vendored via Three.js | **MIT License** | `js/vendor/three/addons/libs/meshopt_decoder.module.js`<br>`zstddec.module.js` | Giải mã các mô hình glTF sử dụng chuẩn nén `EXT_meshopt_compression`. |
| **fflate** (`101arrowz/fflate`) | Vendored via Three.js | **MIT License** | `js/vendor/three/addons/libs/fflate.module.js` | Thư viện đóng gói ZIP tốc độ cao bằng JavaScript thuần, được `USDZExporter` dùng để đóng gói cấu trúc USDA + ảnh texture thành gói `.usdz` không nén (uncompressed zip theo đặc tả Apple). |
| **qrcode-generator** (`kazuhikoarase/qrcode-generator`) | `1.4.4` | **MIT License** | `package.json:37`<br>`js/vendor/qrcode/qrcode.js`<br>`js/ar/ui/qr-code.js` | Tạo mã QR SVG ngay phía client khi người dùng mở trang AR trên máy tính (Desktop), giúp quét mã bằng camera iPhone/iPad để chuyển thẳng sang Apple AR Quick Look. |
| **Google Gen AI SDK** (`googleapis/js-genai` — `@google/genai`) | `^2.31.0` | **Apache-2.0 License** | `package.json:33`<br>`backend/application/ai-service.js:10` | SDK chính thức của Google để kết nối mô hình **Gemini 2.5 Flash** phục vụ Trợ lý AI tư vấn xe (Live RAG, Function Calling / Tool Execution và phân tích ảnh). |
| **Playwright Core** (`microsoft/playwright`) | `1.49.1` | **Apache-2.0 License** | `package.json:36`<br>`scripts/build_usdz.js`<br>`tests/e2e/ar-flow.e2e.js` | Điều khiển trình duyệt Chromium headless để chạy pipeline chuyển đổi hàng loạt `.glb` → `.usdz` (`npm run usdz:build`) và chạy kiểm thử tự động E2E cho luồng AR. |
| **Cloudflare Wrangler** (`cloudflare/workers-sdk`) | `4.154.0` | **MIT / Apache-2.0** | `package.json:39`<br>`wrangler.api.toml` | Công cụ CLI phát triển, kiểm thử cục bộ (`workerd` runtime) và triển khai Cloudflare Workers + cơ sở dữ liệu Cloudflare D1. |

---

### 3. Nền Tảng Đám Mây, AI Providers & Tiêu Chuẩn Bảo Mật / Hạ Tầng

1. **Hạ tầng Cloudflare Serverless:**
   - **Cloudflare Pages & Pages Functions** (`functions/api/v1/[[path]].js`, `_headers`, `_redirects`): Hosting tài nguyên tĩnh kèm reverse proxy qua Service Binding `SIGMA_API`.
   - **Cloudflare Workers Runtime (`workerd`)** (`backend/cloudflare/worker.mjs`, `runtime.js`, `node-http-shim.js`): Chạy toàn bộ REST API backend không cần máy chủ truyền thống.
   - **Cloudflare D1 (Serverless SQLite)** (`backend/infrastructure/d1/migrations/0001_state_store.sql`, `0002_incremental_sync.sql`, `d1-state-store.js`): Cơ sở dữ liệu quan hệ kết hợp lưu trữ JSON document với cơ chế kiểm soát xung đột phiên bản (Optimistic Concurrency Control) và đồng bộ vi sai (Incremental Sync).
   - **Cloudflare R2 Object Storage** (`scripts/upload_usdz.js`): Hỗ trợ lưu trữ các file `.usdz` có dung lượng lớn hơn giới hạn 25 MiB của Cloudflare Pages.
2. **Hệ thống Đa Nhà Cung Cấp AI (Multi-Provider LLM Architecture — `backend/application/ai-service.js`):**
   - **Google Gemini API** (`gemini-2.5-flash` qua `@google/genai`).
   - **Groq Cloud API** (`llama-3.3-70b-versatile` — Meta Llama 3.3 mã nguồn mở chạy trên hạ tầng Groq).
   - **OpenAI API** (`gpt-4o-mini`).
   - **Ollama Local LLM** (`http://localhost:11434`, mặc định model mã nguồn mở `qwen2.5:0.5b` của Alibaba Cloud Qwen).
   - **Sigma Local Automotive Brain** (`backend/application/local-ai/sigma-brain.js`): Bộ suy luận tiếng Việt nội bộ hoạt động 100% offline không cần API key.
3. **Chuẩn Mật Mã & Bảo Mật Node.js / Web Crypto (`backend/infrastructure/security.js`):**
   - Sử dụng thư viện chuẩn `node:crypto` (tương thích `nodejs_compat` trên Cloudflare Workers): băm mật khẩu bằng **scrypt**, ký token phiên và webhook bằng **HMAC-SHA256**, tạo mã định danh ngẫu nhiên an toàn bằng `crypto.randomUUID()`.

---

### 4. Tài Liệu Thiết Kế & Nguồn Dữ Liệu Tham Khảo Nội Bộ Trong Kho Lưu Trữ

Bên cạnh các thư viện mã nguồn mở và công nghệ quốc tế, trong thư mục dự án còn lưu trữ rõ nguồn gốc thiết kế giao diện và dữ liệu xe:

1. **Bản thiết kế giao diện gốc xuất từ Figma (`Dự án thương mại điện tử/`, `Dự án thương mại điện tử 2/`, `Dự án thương mại điện tử 3/`):**
   - Chứa 26 bản vẽ PDF/hình ảnh xuất từ Figma (Header, Home, New Cars, Certified Pre-Owned, Vehicle Detail, AI Advisor, Compare, Seller Dashboard, User Profile...) được tham chiếu trực tiếp trong `README.md:56-72` và comment của `index.html:15-58`.
2. **Cơ sở dữ liệu thông số xe & linh kiện (`about car/Data-xe.xlsx` & `about car/SIGMACAR_Vehicle_Component_Database.xlsx`):**
   - Bảng dữ liệu Excel tổng hợp thông số kỹ thuật, kích thước vật lý, dung lượng pin, công suất và cấu hình của 24+ mẫu xe thực tế (VinFast VF 3, VF 8, VF 9, Fadil, Lux A2.0, Tesla Cybertruck, Tesla Roadster 2, Lucid Air Sapphire, Porsche 911 Carrera 4S, Lamborghini Aventador SV, Lamborghini Terzo Millennio, Ferrari F50, Bugatti Chiron, Rolls-Royce Boat Tail, Maybach Exelero, Land Rover Defender 110, Honda Civic Type R, Civic RS, Civic EG6, Accord Euro R, Prelude, Hyundai Elantra N, Toyota Camry, Subaru Impreza, Suzuki Ciaz).
3. **Bộ quy chuẩn đóng gói xe & 3D (`vehicle-template/` & `assets/models/*.glb`):**
   - Định nghĩa cấu trúc chuẩn `vehicle.json` để đồng bộ hóa thông số xe, hình ảnh theo góc chụp và mô hình 3D `.glb` / `.usdz` vào toàn hệ thống.
