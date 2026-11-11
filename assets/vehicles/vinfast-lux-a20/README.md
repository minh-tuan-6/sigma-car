# THÔNG TIN MẪU XE: VINFAST VINFAST LUX A2.0 (2022)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
vinfast-lux-a20/
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

- **Mã sản phẩm**: `VNF-LUXA-22`
- **Thương hiệu**: VinFast
- **Tên mẫu xe**: VinFast Lux A2.0
- **Phiên bản**: 2.0L Turbo Cao Cấp (Premium 228 HP)
- **Năm sản xuất**: 2022
- **Phân khúc**: Sedan (Sedan Hạng E Khung Gầm BMW & Pininfarina)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **680.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 2.0L DOHC Turbo 4 xi-lanh thẳng hàng (Nền tảng động cơ BMW N20)
- **Công suất cực đại**: 228 HP (168 kW) @ 5.000 - 6.000 rpm
- **Mô-men xoắn cực đại**: 350 Nm @ 1.750 - 4.500 rpm
- **Tăng tốc (0 - 100 km/h)**: 7.1s
- **Tốc độ tối đa**: 240 km/h
- **Hộp số**: Tự động 8 cấp ZF (Đức)
- **Hệ dẫn động**: RWD / Cầu sau (Dẫn động cầu sau thể thao)
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.973 x 1.900 x 1.500 mm
- **Chiều dài cơ sở**: 2.968 mm (Chuẩn sedan hạng E)
- **Khoảng sáng gầm xe**: 150 mm
- **Bảo hành**: Bảo hành chính hãng 10 năm hoặc 200.000 km của VinFast

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/vinfast_lux_a20.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
