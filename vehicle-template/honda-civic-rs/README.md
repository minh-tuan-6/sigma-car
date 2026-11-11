# THÔNG TIN MẪU XE: HONDA HONDA CIVIC RS (2025)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
honda-civic-rs/
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

- **Mã sản phẩm**: `HND-CVRS-25`
- **Thương hiệu**: Honda
- **Tên mẫu xe**: Honda Civic RS
- **Phiên bản**: RS 1.5L VTEC Turbo (Thế hệ mới 2025)
- **Năm sản xuất**: 2025
- **Phân khúc**: Sedan (Sedan Thể Thao Hạng C Phổ Biến Nhất)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **889.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 1.5L DOHC VTEC Turbo 4 xi-lanh thẳng hàng
- **Công suất cực đại**: 178 HP (131 kW) @ 6.000 rpm
- **Mô-men xoắn cực đại**: 240 Nm @ 1.700 - 4.500 rpm
- **Tăng tốc (0 - 100 km/h)**: 7.8s
- **Tốc độ tối đa**: 210 km/h
- **Hộp số**: Vô cấp CVT thể thao tích hợp lẫy chuyển số
- **Hệ dẫn động**: FWD / Cầu trước
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.678 x 1.802 x 1.415 mm
- **Chiều dài cơ sở**: 2.735 mm
- **Khoảng sáng gầm xe**: 134 mm
- **Bảo hành**: 3 năm hoặc 100.000 km chính hãng Honda

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/honda_civic_rs.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
