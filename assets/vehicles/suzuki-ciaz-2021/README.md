# THÔNG TIN MẪU XE: SUZUKI SUZUKI CIAZ (2021) (2021)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
suzuki-ciaz-2021/
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

- **Mã sản phẩm**: `SZK-CIZ-21`
- **Thương hiệu**: Suzuki
- **Tên mẫu xe**: Suzuki Ciaz (2021)
- **Phiên bản**: 1.4L AT Nhập Khẩu Thái Lan
- **Năm sản xuất**: 2021
- **Phân khúc**: Sedan (Sedan Hạng B Rộng Rãi Tiết Kiệm Nhiên Liệu Nhất)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **534.900.000 VNĐ**
- **Động cơ / Hệ truyền động**: 1.4L K14B 4 xi-lanh thẳng hàng 16 van VVT
- **Công suất cực đại**: 91 HP (68 kW) @ 6.000 rpm
- **Mô-men xoắn cực đại**: 130 Nm @ 4.400 rpm
- **Tăng tốc (0 - 100 km/h)**: 11.8s
- **Tốc độ tối đa**: 175 km/h
- **Hộp số**: Tự động 4 cấp (4-Speed Automatic)
- **Hệ dẫn động**: FWD / Cầu trước
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.490 x 1.730 x 1.475 mm
- **Chiều dài cơ sở**: 2.650 mm (Rộng nhất phân khúc B)
- **Khoảng sáng gầm xe**: 160 mm
- **Bảo hành**: 5 năm hoặc 150.000 km cho động cơ & hộp số

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/suzuki_ciaz_2021.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
