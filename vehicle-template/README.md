# HƯỚNG DẪN SỬ DỤNG CHUẨN NHẬP XE MỚI (`vehicle-template`)

Hệ thống **Vehicle Import Template** được thiết kế để chuẩn hóa quy trình thêm mới hoặc cập nhật bất kỳ mẫu xe ô tô nào (Ô tô điện EV, Ô tô xăng/dầu/hybrid, Sedan, SUV, MPV, Bán tải Pickup, Compact, Xe phổ thông hoặc Xe cao cấp) vào nền tảng thương mại điện tử **SIGMACAR**.

---

## 1. Cấu trúc Thư mục Chuẩn (`vehicle-template/`)

Mỗi mẫu xe được đóng gói trong một thư mục độc lập theo cấu trúc sau:

```text
vehicle-template/
│
├── vehicle.json                  # File dữ liệu cấu hình & thông số kỹ thuật chuẩn (JSON)
├── README.md                     # Tài liệu hướng dẫn sử dụng
│
├── images/                       # Thư mục chứa hình ảnh gốc chất lượng cao (JPG, PNG, WEBP, SVG)
│   ├── exterior/                 # Ảnh ngoại thất (góc 3/4 trước, ngang hông, đuôi xe, mâm, đèn...)
│   ├── interior/                 # Ảnh nội thất (khoang ghế trước/sau, chất liệu da, cửa sổ trời...)
│   ├── dashboard/                # Ảnh khoang lái, vô lăng, màn hình trung tâm, HUD
│   ├── engine/                   # Ảnh khoang động cơ, cụm mô-tơ điện, khung gầm hoặc pin
│   ├── specifications/           # Ảnh bản vẽ kích thước kỹ thuật (blueprint), bảng thông số
│   └── gallery/                  # Ảnh thực tế, lifestyle, chụp ngoại cảnh tổng hợp
│
├── 3d/                           # Thư mục tài nguyên 3D tương tác & AR/VR
│   ├── model.glb                 # File mô hình 3D chuẩn glTF 2.0 nhị phân (.glb) hoặc nén (.zip)
│   └── textures/                 # Các file texture đi kèm mô hình 3D (nếu tách rời)
│
└── documents/                    # Thư mục tài liệu đính kèm (PDF, TXT, MD)
    ├── specifications.pdf        # Brochure / Tài liệu thông số kỹ thuật chi tiết
    └── warranty.pdf              # Chính sách bảo hành & hướng dẫn bảo dưỡng
```

> **Lưu ý quan trọng & Quy tắc ảnh bìa (Cover Image):**
> * **Tự động nhận diện ảnh bìa:** Hệ thống tự động ưu tiên nhận diện file ảnh bìa đại diện cho xe từ thư mục folder theo thứ tự:
>   1. Đường dẫn khai báo trong `images.thumbnail` hoặc `images.cover` trong `vehicle.json`.
>   2. File có tên chứa từ khóa `cover`, `bia`, `thumbnail`, `hero`, `main`, `front` với định dạng ảnh thật (`.jpg`, `.jpeg`, `.png`, `.webp`) trong `images/exterior/` hoặc `images/`.
>   3. Ảnh định dạng raster (`.jpg`, `.png`, `.webp`) đầu tiên tìm thấy trong thư mục ngoại thất `exterior/`.
> * **Không bắt buộc tất cả các file hoặc thư mục con phải tồn tại.** Công cụ nhập xe (`scripts/import_vehicle.js`) được thiết kế chịu lỗi (fault-tolerant) và hỗ trợ đầy đủ các folder thiếu dữ liệu.
> * Nếu thiếu `vehicle.json`, hệ thống sẽ tự động quét và trích xuất thông số từ các file văn bản có sẵn trong folder (như `data/data.txt`, `*.txt`, `*.md`) mà **không tự bịa đặt** giá bán hay thông số không có nguồn.
> * Nếu file 3D được nén trong `.zip` (ví dụ `3Dmodel/*.zip` hoặc `3d/*.zip`), công cụ sẽ tự động giải nén và lấy file `.glb` cùng `textures/`.
> * Nếu folder có mô hình 3D `.glb` nhưng chưa có ảnh chụp ngoại thất, hệ thống hỗ trợ kết xuất (render) ảnh studio trực tiếp từ lưới 3D thật của xe.

---

## 2. Đặc tả Schema `vehicle.json`

Mọi trường trong `vehicle.json` đều có kiểu dữ liệu tường minh. Các trường không áp dụng cho dòng xe cụ thể (ví dụ `evSpecs` đối với xe xăng/dầu) được phép đặt giá trị `null` hoặc bỏ trống.

| Trường dữ liệu | Kiểu dữ liệu | Bắt buộc | Mô tả chi tiết |
| :--- | :--- | :---: | :--- |
| `id` | `string` | Có | Mã định danh duy nhất dạng slug (VD: `"tesla-cybertruck"`, `"toyota-camry"`). |
| `productCode` | `string \| null` | Không | Mã quản trị kho (VD: `"CAR-011"`, `"TSL-CT"`). Tự động sinh nếu để `null`. |
| `brand` | `string` | Có | Tên thương hiệu (VD: `"Tesla"`, `"VinFast"`, `"Toyota"`, `"BMW"`). |
| `name` | `string` | Có | Tên thương mại của mẫu xe (VD: `"Tesla Cybertruck"`). |
| `version` | `string \| null` | Không | Tên phiên bản tiêu chuẩn hiển thị (VD: `"Dual-Motor AWD / Cyberbeast"`). |
| `trims` | `array \| null` | Không | Danh sách các phiên bản (RWD, AWD, Performance...) kèm giá và thông số riêng. |
| `year` | `number` | Có | Năm sản xuất / Model Year (VD: `2025`, `2026`). |
| `price` | `number` | Có | Giá bán chính thức hoặc giá tham khảo quy đổi bằng VNĐ (VD: `7500000000`). |
| `salePrice` | `number \| null` | Không | Giá khuyến mãi bằng VNĐ (để `null` nếu không có khuyến mãi). |
| `category` | `string` | Có | Phân loại kiểu dáng: `"Sedan"`, `"SUV"`, `"MPV"`, `"Pickup"`, `"Compact"`. |
| `subCategory` | `string \| null` | Không | Phân loại chi tiết (VD: `"Bán tải Thuần Điện"`, `"SUV 7 Chỗ"`). |
| `fuel` | `string` | Có | Nhiên liệu: `"ev"` (Điện), `"gas"` (Xăng), `"diesel"` (Dầu), `"hybrid"` (Hybrid). |
| `engine` | `string \| null` | Không | Cấu hình động cơ / Mô-tơ (VD: `"Tri-Motor AWD"` hoặc `"2.5L 4 xi-lanh"`). |
| `power` | `string \| null` | Không | Mô tả tóm tắt công suất & truyền động. |
| `hp` | `number \| null` | Không | Công suất cực đại tính bằng mã lực (HP) (VD: `845`). |
| `torque` | `string \| null` | Không | Mô-men xoắn cực đại (VD: `"500 Nm"` hoặc `"10.296 lb-ft"`). |
| `acceleration` | `string \| null` | Không | Thời gian tăng tốc 0-100 km/h (hoặc 0-96 km/h) (VD: `"2.6s"`). |
| `topSpeed` | `string \| null` | Không | Vận tốc tối đa (VD: `"209 km/h"`). |
| `transmission` | `string \| null` | Không | Hộp số (VD: `"Tự động 10 cấp"` hoặc `"Hộp số điện tử 1 cấp"`). |
| `drive` | `string \| null` | Không | Hệ dẫn động (`"AWD"`, `"RWD"`, `"FWD"`, `"4x4"`). |
| `dimensions` | `object \| string` | Không | Kích thước tổng thể (`overall`, `lengthMm`, `widthMm`, `heightMm`, `wheelbase`, `groundClearance`, `curbWeight`, `payloadCapacity`, `towingCapacity`, `cargoVolume`). |
| `seats` | `number` | Có | Số chỗ ngồi (VD: `5`, `7`). |
| `colors` | `array` | Không | Danh sách màu sơn (`[{ "name": "...", "hex": "#...", "img": "..." }]`). |
| `evSpecs` | `object \| null` | Không | Dành riêng cho xe điện: `batteryCapacity`, `rangeKm`, `rangeExtendedKm`, `fastCharge`, `architecture`, `v2x`. Đặt `null` nếu là xe xăng/dầu. |
| `fuelConsumption`| `object \| null` | Không | Mức tiêu thụ nhiên liệu/điện năng (`combined`, `urban`, `highway`). |
| `safetyFeatures` | `array<string>` | Không | Danh sách trang bị an toàn & khung gầm. |
| `comfortFeatures`| `array<string>` | Không | Danh sách tiện nghi nội thất, màn hình, âm thanh. |
| `warranty` | `object \| string`| Không | Chính sách bảo hành xe và pin. |
| `description` | `string` | Không | Bài viết giới thiệu tổng quan về mẫu xe. |
| `images` | `object` | Không | Đường dẫn ảnh phân loại theo `thumbnail`, `exterior`, `interior`, `dashboard`, `engine`, `specifications`, `gallery`. |
| `model3d` | `object \| null` | Không | Cấu hình 3D/AR/VR (`enabled`, `glbPath`, `arSupported`, `vrSupported`, `scale`, `initialAngle`, `hotspots`). |
| `documents` | `object \| null` | Không | Đường dẫn tài liệu `specificationsPdf`, `warrantyPdf`. |
| `businessStatus` | `object` | Không | Trạng thái kinh doanh (`isAvailable`, `statusText`, `stock`, `badge`, `officialUrl`). |

---

## 3. Quy trình Nhập Xe Mới vào Website

### Cách 1: Nhập một thư mục xe cụ thể
Chạy lệnh sau tại thư mục gốc của dự án:

```bash
node scripts/import_vehicle.js "<đường-dẫn-tới-folder-xe>"
```

**Ví dụ thực tế:**
```bash
# Nhập mẫu xe từ thư mục Tesla-Cybertruck
node scripts/import_vehicle.js ./Tesla-Cybertruck

# Kiểm tra thử (Dry-run) không ghi đè database
node scripts/import_vehicle.js ./vehicle-template --dry-run
```

### Cách 2: Những việc công cụ `import_vehicle.js` tự động thực hiện
1. **Đọc & Phân tích:** Kiểm tra `vehicle.json`. Nếu chưa có `vehicle.json`, tự động phân tích ngữ nghĩa từ các file tài liệu (`data.txt`, `README.md`...) trong thư mục để tạo `vehicle.json` chuẩn.
2. **Xử lý Mô hình 3D (`.glb`):** Tự động tìm file `.glb` (hoặc giải nén từ `.zip`), kiểm tra header nhị phân `glTF 2.0`, sao chép vào `assets/models/<id>.glb` và kích hoạt tính năng **Showroom 3D 360° + VR + AR** cho đúng mẫu xe đó.
3. **Phân loại & Bảo toàn Chất lượng Ảnh:** Sao chép nguyên bản (`byte-for-byte`) toàn bộ ảnh sang `assets/vehicles/<id>/images/...` giữ nguyên độ phân giải gốc. Nếu thư mục chưa có ảnh chụp mà có file `.glb`, tự động kết xuất bộ ảnh Studio chất lượng cao từ mô hình 3D thật.
4. **Chống trùng lặp (Idempotent Upsert):** Đối chiếu `id` và `(brand + name)` với danh sách xe hiện có trong Showroom. Nếu xe đã tồn tại, chỉ cập nhật bổ sung mà không tạo bản ghi trùng.
5. **Đồng bộ Toàn diện:** Cập nhật đồng bộ vào:
   * `js/data.js` (Frontend Showroom, Bộ lọc Hãng/Dòng xe/Nhiên liệu/Giá, Tìm kiếm, So sánh, AI Advisor).
   * `backend/infrastructure/storage-engine.js` & `data/sigmacar_store.json` (Backend API & Database).
6. **Kiểm soát Chất lượng (QA) & Build:** Tự động kiểm tra tính hợp lệ của JSON, đường dẫn ảnh, đường dẫn 3D, kiểm tra trùng ID và chạy `node scripts/build_dist.js` để đóng gói bản phân phối `dist/`.
