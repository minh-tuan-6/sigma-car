# THÔNG TIN MẪU XE: HONDA HONDA ACCORD EURO-R (CL7) (2006)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
honda-accord-euro-r/
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

- **Mã sản phẩm**: `HND-CL7-ER`
- **Thương hiệu**: Honda
- **Tên mẫu xe**: Honda Accord Euro-R (CL7)
- **Phiên bản**: CL7 Euro-R JDM Spec
- **Năm sản xuất**: 2006
- **Phân khúc**: Sedan (Sedan Thể Thao Hiệu Năng Cao JDM)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **950.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 2.0L K20A DOHC i-VTEC Hút khí tự nhiên (Nắp máy đỏ Red Top)
- **Công suất cực đại**: 220 HP (162 kW) @ 8.000 rpm
- **Mô-men xoắn cực đại**: 206 Nm @ 6.000 rpm
- **Tăng tốc (0 - 100 km/h)**: 6.7s
- **Tốc độ tối đa**: 235 km/h
- **Hộp số**: Số sàn 6 cấp (6-Speed Manual với cần số nhôm tiện nguyên khối)
- **Hệ dẫn động**: FWD / Cầu trước + Helical Limited Slip Differential (LSD)
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.665 x 1.760 x 1.445 mm
- **Chiều dài cơ sở**: 2.670 mm
- **Khoảng sáng gầm xe**: 140 mm
- **Bảo hành**: Kiểm định 176 điểm chính hãng SIGMACAR Certified

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/honda_accord_euro_r.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
