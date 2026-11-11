# THÔNG TIN MẪU XE: LAMBORGHINI LAMBORGHINI TERZO MILLENNIO (2030)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
lamborghini-terzo-millennio/
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

- **Mã sản phẩm**: `LAM-TM-30`
- **Thương hiệu**: Lamborghini
- **Tên mẫu xe**: Lamborghini Terzo Millennio
- **Phiên bản**: Hypercar Thuần Điện Thiên Niên Kỷ Thứ 3
- **Năm sản xuất**: 2030
- **Phân khúc**: Siêu Xe (Siêu Xe Điện Tương Lai Sợi Carbon Tự Chữa Lành)
- **Nhiên liệu**: Điện thuần (EV)
- **Giá niêm yết**: **90.000.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 4 Động cơ điện tích hợp trong bánh xe (In-wheel Electric Motors)
- **Công suất cực đại**: 1.000 HP (4 Mô-tơ điện đặt tại 4 bánh xe)
- **Mô-men xoắn cực đại**: 1.500 Nm tức thì
- **Tăng tốc (0 - 100 km/h)**: 1.9s
- **Tốc độ tối đa**: 380 km/h
- **Hộp số**: Hộp số điện tử truyền động trực tiếp 4 bánh
- **Hệ dẫn động**: AWD / Dẫn động 4 bánh toàn thời gian điều hướng mô-men xoắn Torque Vectoring độc lập
- **Số chỗ ngồi**: 2 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.800 x 2.100 x 1.050 mm
- **Chiều dài cơ sở**: 2.750 mm
- **Khoảng sáng gầm xe**: 100 mm
- **Bảo hành**: Dự án nghiên cứu công nghệ tương lai hợp tác cùng Viện MIT Hoa Kỳ

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/lamborghini_terzo_millennio.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
