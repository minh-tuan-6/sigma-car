# THÔNG TIN MẪU XE: HONDA HONDA PRELUDE CONCEPT (BP1) (2026)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
honda-prelude-bp1/
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

- **Mã sản phẩm**: `HND-PRL-26`
- **Thương hiệu**: Honda
- **Tên mẫu xe**: Honda Prelude Concept (BP1)
- **Phiên bản**: e:HEV Hybrid Sports Coupe
- **Năm sản xuất**: 2026
- **Phân khúc**: Coupe (Xe Thể Thao 2 Cửa Thế Hệ Mới e:HEV)
- **Nhiên liệu**: Hybrid (Xăng + Điện)
- **Giá niêm yết**: **1.350.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 2.0L Atkinson Cycle 4 xi-lanh kết hợp 2 Mô-tơ điện e:HEV
- **Công suất cực đại**: 212 HP (156 kW), Hệ thống e:HEV 2 Mô-tơ điện
- **Mô-men xoắn cực đại**: 315 Nm @ 0 - 2.000 rpm
- **Tăng tốc (0 - 100 km/h)**: 6.4s
- **Tốc độ tối đa**: 220 km/h
- **Hộp số**: Hộp số thể thao e-CVT giả lập cấp số với lẫy chuyển số
- **Hệ dẫn động**: FWD / Cầu trước
- **Số chỗ ngồi**: 4 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.300 x 1.790 x 1.300 mm
- **Chiều dài cơ sở**: 2.575 mm
- **Khoảng sáng gầm xe**: 130 mm
- **Bảo hành**: 5 năm hoặc 150.000 km cho toàn bộ hệ thống Pin & Hybrid e:HEV

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/honda_prelude_bp1.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
