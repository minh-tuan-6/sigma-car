# THÔNG TIN MẪU XE: PORSCHE PORSCHE 911 CARRERA 4S (992) (2024)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
porsche-911-carrera-4s-2024/
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

- **Mã sản phẩm**: `POR-992-4S`
- **Thương hiệu**: Porsche
- **Tên mẫu xe**: Porsche 911 Carrera 4S (992)
- **Phiên bản**: 992 Carrera 4S Twin-Turbo AWD
- **Năm sản xuất**: 2024
- **Phân khúc**: Siêu Xe (Xe Thể Thao Biểu Tượng Nước Đức)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **8.850.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 3.0L Boxer 6 xi-lanh nằm ngang (Flat-6) Twin-Turbo
- **Công suất cực đại**: 450 HP (331 kW) @ 6.500 rpm
- **Mô-men xoắn cực đại**: 530 Nm @ 2.300 - 5.000 rpm
- **Tăng tốc (0 - 100 km/h)**: 3.4s (với gói Sport Chrono Package)
- **Tốc độ tối đa**: 306 km/h
- **Hộp số**: Ly hợp kép 8 cấp PDK lừng danh
- **Hệ dẫn động**: AWD / Dẫn động 4 bánh chủ động Porsche Traction Management (PTM)
- **Số chỗ ngồi**: 4 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.519 x 1.852 x 1.300 mm
- **Chiều dài cơ sở**: 2.450 mm
- **Khoảng sáng gầm xe**: 120 mm (Nâng hạ trục trước Front Axle Lift)
- **Bảo hành**: 4 năm chính hãng Porsche Việt Nam không giới hạn số km

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/porsche_911_carrera_4s_2024.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
