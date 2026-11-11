# THÔNG TIN MẪU XE: HONDA HONDA CIVIC SIR-II (EG6) (1991)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
honda-civic-eg6-1991/
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

- **Mã sản phẩm**: `HND-EG6-91`
- **Thương hiệu**: Honda
- **Tên mẫu xe**: Honda Civic SiR-II (EG6)
- **Phiên bản**: SiR-II VTEC (1991)
- **Năm sản xuất**: 1991
- **Phân khúc**: Hatchback (Hatchback Thể Thao JDM Huyền Thoại)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **450.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 1.6L B16A DOHC VTEC Hút khí tự nhiên (Redline 8.200 rpm)
- **Công suất cực đại**: 170 HP (125 kW) @ 7.800 rpm
- **Mô-men xoắn cực đại**: 157 Nm @ 7.300 rpm
- **Tăng tốc (0 - 100 km/h)**: 7.2s
- **Tốc độ tối đa**: 215 km/h
- **Hộp số**: Số sàn 5 cấp (5-Speed Manual)
- **Hệ dẫn động**: FWD / Cầu trước
- **Số chỗ ngồi**: 4 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.070 x 1.695 x 1.350 mm
- **Chiều dài cơ sở**: 2.570 mm
- **Khoảng sáng gầm xe**: 140 mm
- **Bảo hành**: Bảo dưỡng định kỳ 6 tháng hoặc 5.000 km cho xe cổ sưu tầm

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/honda_civic_eg6_1991.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
