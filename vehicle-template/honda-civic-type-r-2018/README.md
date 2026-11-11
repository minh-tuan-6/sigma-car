# THÔNG TIN MẪU XE: HONDA HONDA CIVIC TYPE R (FK8) (2018)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
honda-civic-type-r-2018/
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

- **Mã sản phẩm**: `HND-FK8-18`
- **Thương hiệu**: Honda
- **Tên mẫu xe**: Honda Civic Type R (FK8)
- **Phiên bản**: FK8 Turbocharged Hot Hatch
- **Năm sản xuất**: 2018
- **Phân khúc**: Hatchback (Hatchback Hiệu Năng Cao Cỡ Nhỏ)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **2.399.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 2.0L VTEC Turbo K20C1 (Tăng áp cuộn đôi Single-Scroll)
- **Công suất cực đại**: 310 HP (228 kW) @ 6.500 rpm
- **Mô-men xoắn cực đại**: 400 Nm @ 2.500 - 4.500 rpm
- **Tăng tốc (0 - 100 km/h)**: 5.7s
- **Tốc độ tối đa**: 272 km/h
- **Hộp số**: Số sàn 6 cấp (6-Speed Manual với tính năng tự vù ga Rev-Matching)
- **Hệ dẫn động**: FWD / Cầu trước + Vi sai chống trượt Helical LSD
- **Số chỗ ngồi**: 4 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.557 x 1.877 x 1.434 mm
- **Chiều dài cơ sở**: 2.699 mm
- **Khoảng sáng gầm xe**: 132 mm
- **Bảo hành**: 3 năm hoặc 100.000 km chính hãng Honda Việt Nam

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/honda_civic_type_r_2018.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
