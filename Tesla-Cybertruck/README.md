# THÔNG TIN MẪU XE: TESLA CYBERTRUCK (2025)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
Tesla-Cybertruck/
│
├── vehicle.json                  # Schema thông số kỹ thuật chuẩn v1.0.0
├── README.md                     # Tài liệu giới thiệu & nguồn dữ liệu xe
│
├── images/                       # Bộ ảnh đa góc nhìn độ phân giải gốc
│   ├── exterior/                 # Ảnh ngoại thất: hero-front-34, rear-vault-34, side-profile
│   ├── interior/                 # Ảnh nội thất khoang hành khách (cabin-overview)
│   ├── dashboard/                # Khoang lái kỹ thuật số, vô lăng Yoke/Squircle & màn hình 18.5"
│   ├── engine/                   # Khung gầm kiến trúc điện 800V & cụm mô-tơ Dual/Tri-Motor
│   ├── specifications/           # Bản vẽ kỹ thuật & kích thước tổng thể (dimensions-blueprint)
│   └── gallery/                  # Ảnh sân khấu showroom & phong cách
│
├── 3d/                           # Tài nguyên mô hình 3D tương tác AR/VR
│   ├── model.glb                 # Mô hình 3D chuẩn glTF 2.0 PBR (407 KB, 8 vật liệu PBR)
│   └── textures/                 # Texture bề mặt & tiếp xúc mặt đất (internal_ground_ao_texture.jpeg)
│
├── documents/                    # Tài liệu chính hãng
│   ├── specifications.pdf        # Thông số kỹ thuật chi tiết các phiên bản (RWD, AWD, Cyberbeast)
│   └── warranty.pdf              # Chính sách bảo hành khung gầm & khối pin 8 năm
│
└── data/
    └── data.txt                  # Dữ liệu trích xuất nguồn từ Tesla Inc.
```

---

## 2. Thông số kỹ thuật chính

- **Thương hiệu**: Tesla
- **Tên xe**: Tesla Cybertruck
- **Phiên bản**: All-Wheel Drive (Dual-Motor) & Cyberbeast (Tri-Motor)
- **Năm sản xuất**: 2025
- **Phân loại**: Bán tải thuần điện (Pickup / EV)
- **Giá tham khảo**: 7.500.000.000 VNĐ (Phiên bản Dual-Motor AWD nhập khẩu tư nhân)
- **Khung vỏ Exoskeleton**: Thép không gỉ siêu cứng cán nguội 30X (Ultra-Hard 30X Cold-Rolled Stainless Steel) chống đạn súng ngắn phổ thông (9mm, .45 ACP).
- **Kính Armor Glass**: Chịu va đập tốc độ cao, cách âm phòng thu.
- **Công suất cực đại**: 845 HP (Cyberbeast) / 600 HP (AWD)
- **Tăng tốc 0-96 km/h**: 2.6 giây (Cyberbeast Beast Mode) / 4.1 giây (AWD)
- **Quãng đường di chuyển**: 547 km (AWD) / 515 km (Cyberbeast) / Lên tới 755 km với Range Extender.
- **Hệ thống lái**: Steer-by-Wire (không trục lái cơ học) + Đánh lái 4 bánh (4-Wheel Steering).
- **Hệ thống treo**: Treo khí nén thích ứng nâng/hạ gầm tới 443 mm.
- **Trạm phát điện di động**: PowerShare 11.5 kW cấp điện cho ngôi nhà (V2H) hoặc sạc xe sang xe (V2V).

---

## 3. Quy trình Tích hợp Tự động

Thư mục này được đồng bộ vào website SIGMACAR bằng công cụ:
```bash
# Kiểm tra hợp lệ (Dry-Run):
node scripts/import_vehicle.js ./Tesla-Cybertruck --dry-run

# Nhập và cập nhật Showroom:
node scripts/import_vehicle.js ./Tesla-Cybertruck
```
Hệ thống tự động phát hiện mã ID `tesla-cybertruck`, cập nhật bản ghi mà không tạo trùng lặp.
