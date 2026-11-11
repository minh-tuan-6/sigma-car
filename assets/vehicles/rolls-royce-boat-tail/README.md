# THÔNG TIN MẪU XE: ROLLS-ROYCE ROLLS-ROYCE BOAT TAIL (2024)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
rolls-royce-boat-tail/
│
├── vehicle.json                  # Schema thông số kỹ thuật chuẩn v1.0.0
├── README.md                     # Tài liệu giới thiệu & nguồn dữ liệu xe
│
├── images/                       # Bộ ảnh độ phân giải cao đã phân loại
│   ├── exterior/                 # Ảnh chụp ngoại thất (góc 3/4 trước, hông xe, đuôi xe)
│   ├── interior/                 # Ảnh chụp nội thất khoang lái & hành khách
│   ├── dashboard/                # Vô lăng, cụm đồng hồ & màn hình điều khiển
│   ├── engine/                   # Động cơ / Cụm mô tơ điện / Khung gầm
│   ├── specifications/           # Kích thước, sơ đồ kỹ thuật
│   └── gallery/                  # Bộ ảnh tổng hợp
│
├── 3d/                           # Mô hình 3D tương tác AR/VR
│   └── model.glb                 # File 3D chuẩn glTF 2.0 PBR
│
├── documents/                    # Tài liệu chính hãng
│   ├── specifications.pdf        # Thông số kỹ thuật chi tiết
│   └── warranty.pdf              # Chính sách bảo hành
│
└── data/
    └── data.txt                  # Dữ liệu nguồn trích xuất từ nhà sản xuất
```

---

## 2. Thông số kỹ thuật chính

- **Mã sản phẩm**: `RR-BT-01`
- **Thương hiệu**: Rolls-Royce
- **Tên mẫu xe**: Rolls-Royce Boat Tail
- **Phiên bản**: Coachbuild Độc Bản Xa Xỉ Nhất Thế Giới (Chỉ 3 Chiếc)
- **Năm sản xuất**: 2024
- **Phân khúc**: Siêu Xe (Kiệt Tác Xe Coachbuild Đắt Nhất Lịch Sử Thế Giới)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **650.000.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 6.75L V12 Twin-Turbo danh tiếng của Rolls-Royce
- **Công suất cực đại**: 563 HP (420 kW) @ 5.000 rpm
- **Mô-men xoắn cực đại**: 900 Nm @ 1.700 rpm
- **Tăng tốc (0 - 100 km/h)**: 5.2s (Vận hành êm ái như bay trên thảm thần Magic Carpet Ride)
- **Tốc độ tối đa**: 250 km/h (Giới hạn điện tử)
- **Hộp số**: Tự động 8 cấp ZF hỗ trợ định vị vệ tinh
- **Hệ dẫn động**: RWD / Cầu sau
- **Số chỗ ngồi**: 4 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 5.800 x 2.050 x 1.550 mm
- **Chiều dài cơ sở**: 3.450 mm
- **Khoảng sáng gầm xe**: 150 mm
- **Bảo hành**: Dịch vụ hậu mãi riêng của Hoàng gia Rolls-Royce Bespoke

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/rolls_royce_boat_tail.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
