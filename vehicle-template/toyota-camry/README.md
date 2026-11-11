# THÔNG TIN MẪU XE: TOYOTA TOYOTA CAMRY 2.5Q (2024)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
toyota-camry/
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

- **Mã sản phẩm**: `TOY-CAM-25Q`
- **Thương hiệu**: Toyota
- **Tên mẫu xe**: Toyota Camry 2.5Q
- **Phiên bản**: 2.5Q Dynamic Force (Thế hệ mới)
- **Năm sản xuất**: 2024
- **Phân khúc**: Sedan (Sedan Hạng D Doanh Nhân Cao Cấp)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **1.405.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 2.5L 4 xi-lanh DOHC VVT-iE Dynamic Force (A25A-FKS)
- **Công suất cực đại**: 207 HP (152 kW) @ 6.600 rpm
- **Mô-men xoắn cực đại**: 250 Nm @ 5.000 rpm
- **Tăng tốc (0 - 100 km/h)**: 8.2s
- **Tốc độ tối đa**: 215 km/h
- **Hộp số**: Tự động 8 cấp (Direct Shift 8AT) tích hợp lẫy chuyển số
- **Hệ dẫn động**: FWD / Cầu trước
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.885 x 1.840 x 1.445 mm
- **Chiều dài cơ sở**: 2.825 mm
- **Khoảng sáng gầm xe**: 140 mm
- **Bảo hành**: 5 năm hoặc 150.000 km chính hãng Toyota Việt Nam

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/toyota_camry.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
