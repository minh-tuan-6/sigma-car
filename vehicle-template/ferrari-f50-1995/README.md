# THÔNG TIN MẪU XE: FERRARI FERRARI F50 (1995)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
ferrari-f50-1995/
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

- **Mã sản phẩm**: `FER-F50-95`
- **Thương hiệu**: Ferrari
- **Tên mẫu xe**: Ferrari F50
- **Phiên bản**: Kỷ Niệm 50 Năm Ferrari (1995)
- **Năm sản xuất**: 1995
- **Phân khúc**: Siêu Xe (Siêu Xe F1 Cho Đường Phố (Chỉ 349 Chiếc Toàn Cầu))
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **85.000.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 4.7L V12 DOHC 60 van (Phát triển trực tiếp từ động cơ Ferrari F1 Tipo 036)
- **Công suất cực đại**: 520 HP (382 kW) @ 8.500 rpm
- **Mô-men xoắn cực đại**: 471 Nm @ 6.500 rpm
- **Tăng tốc (0 - 100 km/h)**: 3.87s
- **Tốc độ tối đa**: 325 km/h
- **Hộp số**: Số sàn 6 cấp có rãnh chuyển số kim loại (6-Speed Gated Manual)
- **Hệ dẫn động**: RWD / Cầu sau
- **Số chỗ ngồi**: 2 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.480 x 1.986 x 1.120 mm
- **Chiều dài cơ sở**: 2.580 mm
- **Khoảng sáng gầm xe**: 110 mm
- **Bảo hành**: Chứng chỉ Ferrari Classiche xác thực nguyên bản 100%

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/ferrari_f50_1995.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
