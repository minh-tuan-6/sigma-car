/**
 * js/ar-manifest.js - Centralized AR & 3D Model Registry
 */
const SIGMA_AR_MANIFEST = {
  version: '2.0.0',
  vehicles: [
  {
    "carId": "honda-civic-eg6-1991",
    "carName": "Honda Civic SiR-II (EG6)",
    "brand": "Honda",
    "glbUrl": "assets/models/honda_civic_eg6_1991.glb",
    "dimensionsMeters": {
      "length": 4.07,
      "width": 1.695,
      "height": 1.35
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Đỏ Thể Thao Milano Red",
        "hex": "#DC2626"
      },
      {
        "name": "Trắng Ngọc Frost White",
        "hex": "#F8FAFC"
      },
      {
        "name": "Đen Flint Black Metallic",
        "hex": "#0F172A"
      },
      {
        "name": "Xanh Ngọc Captiva Blue",
        "hex": "#0284C7"
      }
    ]
  },
  {
    "carId": "honda-civic-type-r-2018",
    "carName": "Honda Civic Type R (FK8)",
    "brand": "Honda",
    "glbUrl": "assets/models/honda_civic_type_r_2018.glb",
    "dimensionsMeters": {
      "length": 4.557,
      "width": 1.877,
      "height": 1.434
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Trắng Championship White",
        "hex": "#F1F5F9"
      },
      {
        "name": "Đỏ Rallye Red",
        "hex": "#EF4444"
      },
      {
        "name": "Xanh Boost Blue Pearl",
        "hex": "#0284C7"
      },
      {
        "name": "Đen Crystal Black Pearl",
        "hex": "#0F172A"
      }
    ]
  },
  {
    "carId": "bugatti-chiron",
    "carName": "Bugatti Chiron",
    "brand": "Bugatti",
    "glbUrl": "assets/models/bugatti_chiron.glb",
    "dimensionsMeters": {
      "length": 4.544,
      "width": 2.038,
      "height": 1.212
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Xanh Bugatti Atlantic Blue",
        "hex": "#1E3A8A"
      },
      {
        "name": "Đen Carbon Dạ Kim",
        "hex": "#0B0F19"
      },
      {
        "name": "Bạc Pháp French Racing Blue & Chrome",
        "hex": "#38BDF8"
      }
    ]
  },
  {
    "carId": "ferrari-f50-1995",
    "carName": "Ferrari F50",
    "brand": "Ferrari",
    "glbUrl": "assets/models/ferrari_f50_1995.glb",
    "dimensionsMeters": {
      "length": 4.48,
      "width": 1.986,
      "height": 1.12
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Đỏ Truyền Thống Rosso Corsa",
        "hex": "#DC2626"
      },
      {
        "name": "Vàng Giallo Modena",
        "hex": "#FACC15"
      },
      {
        "name": "Đen Nero",
        "hex": "#0B0F19"
      }
    ]
  },
  {
    "carId": "honda-civic-rs",
    "carName": "Honda Civic RS",
    "brand": "Honda",
    "glbUrl": "assets/models/honda_civic_rs.glb",
    "dimensionsMeters": {
      "length": 4.678,
      "width": 1.802,
      "height": 1.415
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Đỏ Thể Thao Ignite Red Metallic",
        "hex": "#DC2626"
      },
      {
        "name": "Trắng Ngọc Trai Platinum White Pearl",
        "hex": "#F8FAFC"
      },
      {
        "name": "Đen Ánh Độc Tôn Crystal Black Pearl",
        "hex": "#0F172A"
      },
      {
        "name": "Xám Xi Măng Meteoroid Gray",
        "hex": "#64748B"
      }
    ]
  },
  {
    "carId": "honda-accord-euro-r",
    "carName": "Honda Accord Euro-R (CL7)",
    "brand": "Honda",
    "glbUrl": "assets/models/honda_accord_euro_r.glb",
    "dimensionsMeters": {
      "length": 4.665,
      "width": 1.76,
      "height": 1.445
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Trắng Ngọc Arctic White Pearl",
        "hex": "#F8FAFC"
      },
      {
        "name": "Xanh Ánh Kim Nighthawk Blue Pearl",
        "hex": "#1E3A8A"
      },
      {
        "name": "Bạc Satin Silver Metallic",
        "hex": "#94A3B8"
      }
    ]
  },
  {
    "carId": "honda-prelude-bp1",
    "carName": "Honda Prelude Concept (BP1)",
    "brand": "Honda",
    "glbUrl": "assets/models/honda_prelude_bp1.glb",
    "dimensionsMeters": {
      "length": 4.3,
      "width": 1.79,
      "height": 1.3
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Trắng Băng Bắc Cực Glacier White",
        "hex": "#F1F5F9"
      },
      {
        "name": "Đỏ Thể Thao Cherry Red Pearl",
        "hex": "#B91C1C"
      },
      {
        "name": "Xanh Navy Dạ Quang Deep Pearl Blue",
        "hex": "#1E293B"
      }
    ]
  },
  {
    "carId": "hyundai-elantra-n-2024",
    "carName": "Hyundai Elantra N (2024)",
    "brand": "Hyundai",
    "glbUrl": "assets/models/hyundai_elantra_n_2024.glb",
    "dimensionsMeters": {
      "length": 4.675,
      "width": 1.825,
      "height": 1.415
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Xanh Hiệu Năng Performance Blue",
        "hex": "#38BDF8"
      },
      {
        "name": "Đen Bóng Abyss Black Pearl",
        "hex": "#0F172A"
      },
      {
        "name": "Trắng Atlas White",
        "hex": "#F8FAFC"
      },
      {
        "name": "Xám Xi Măng Cyber Gray Metallic",
        "hex": "#64748B"
      }
    ]
  },
  {
    "carId": "lamborghini-aventador-sv",
    "carName": "Lamborghini Aventador LP750-4 SV",
    "brand": "Lamborghini",
    "glbUrl": "assets/models/lamborghini_aventador_sv.glb",
    "dimensionsMeters": {
      "length": 4.835,
      "width": 2.03,
      "height": 1.136
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Đỏ Thể Thao Rosso Bia",
        "hex": "#B91C1C"
      },
      {
        "name": "Vàng Giallo Orion",
        "hex": "#FACC15"
      },
      {
        "name": "Cam Arancio Atlas",
        "hex": "#F97316"
      },
      {
        "name": "Xanh Lá Verde Ithaca",
        "hex": "#22C55E"
      }
    ]
  },
  {
    "carId": "lamborghini-terzo-millennio",
    "carName": "Lamborghini Terzo Millennio",
    "brand": "Lamborghini",
    "glbUrl": "assets/models/lamborghini_terzo_millennio.glb",
    "dimensionsMeters": {
      "length": 4.8,
      "width": 2.1,
      "height": 1.05
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Xám Thép Carbon X-Concept",
        "hex": "#334155"
      },
      {
        "name": "Cam Neon Terzo Orange",
        "hex": "#EA580C"
      }
    ]
  },
  {
    "carId": "land-rover-defender-110",
    "carName": "Land Rover Defender 110",
    "brand": "Land Rover",
    "glbUrl": "assets/models/land_rover_defender_110.glb",
    "dimensionsMeters": {
      "length": 5.018,
      "width": 2.008,
      "height": 1.967
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Xanh Rêu Địa Hình Pangea Green",
        "hex": "#4D7C0F"
      },
      {
        "name": "Xám Gondwana Stone",
        "hex": "#78716C"
      },
      {
        "name": "Đen Santorini Black",
        "hex": "#0F172A"
      },
      {
        "name": "Trắng Fuji White",
        "hex": "#F8FAFC"
      }
    ]
  },
  {
    "carId": "lucid-air-sapphire",
    "carName": "Lucid Air Sapphire",
    "brand": "Lucid",
    "glbUrl": "assets/models/lucid_air_sapphire.glb",
    "dimensionsMeters": {
      "length": 4.975,
      "width": 1.939,
      "height": 1.41
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Xanh Sapphire Lam Bảo Sapphire Blue",
        "hex": "#1D4ED8"
      },
      {
        "name": "Đen Stealth Black Onyx",
        "hex": "#0B0F19"
      }
    ]
  },
  {
    "carId": "maybach-exelero-2005",
    "carName": "Maybach Exelero",
    "brand": "Maybach",
    "glbUrl": "assets/models/maybach_exelero_2005.glb",
    "dimensionsMeters": {
      "length": 5.89,
      "width": 2.14,
      "height": 1.39
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Đen Quý Tộc Piano Black Gloss",
        "hex": "#0B0F19"
      }
    ]
  },
  {
    "carId": "porsche-911-carrera-4s-2024",
    "carName": "Porsche 911 Carrera 4S (992)",
    "brand": "Porsche",
    "glbUrl": "assets/models/porsche_911_carrera_4s_2024.glb",
    "dimensionsMeters": {
      "length": 4.519,
      "width": 1.852,
      "height": 1.3
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Xám Phấn Crayon / Chalk",
        "hex": "#E2E8F0"
      },
      {
        "name": "Đỏ Thể Thao Guards Red",
        "hex": "#DC2626"
      },
      {
        "name": "Vàng Racing Yellow",
        "hex": "#FACC15"
      },
      {
        "name": "Xanh Biển Shark Blue",
        "hex": "#0284C7"
      },
      {
        "name": "Đen Ánh Kim Jet Black Metallic",
        "hex": "#0F172A"
      }
    ]
  },
  {
    "carId": "rolls-royce-boat-tail",
    "carName": "Rolls-Royce Boat Tail",
    "brand": "Rolls-Royce",
    "glbUrl": "assets/models/rolls_royce_boat_tail.glb",
    "dimensionsMeters": {
      "length": 5.8,
      "width": 2.05,
      "height": 1.55
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Xanh Đại Dương Ocean Blue Metallic",
        "hex": "#1E3A8A"
      },
      {
        "name": "Gỗ Cung Đình Caleidolegno Wood & Pearl",
        "hex": "#451A03"
      }
    ]
  },
  {
    "carId": "subaru-impreza-2024",
    "carName": "Subaru Impreza RS (2024)",
    "brand": "Subaru",
    "glbUrl": "assets/models/subaru_impreza_2024.glb",
    "dimensionsMeters": {
      "length": 4.48,
      "width": 1.78,
      "height": 1.48
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Xanh Đua Subaru Oasis Blue",
        "hex": "#0284C7"
      },
      {
        "name": "Đỏ Thể Thao Pure Red",
        "hex": "#DC2626"
      },
      {
        "name": "Xám Magnetite Gray Metallic",
        "hex": "#475569"
      },
      {
        "name": "Trắng Crystal White Pearl",
        "hex": "#F8FAFC"
      }
    ]
  },
  {
    "carId": "suzuki-ciaz-2021",
    "carName": "Suzuki Ciaz (2021)",
    "brand": "Suzuki",
    "glbUrl": "assets/models/suzuki_ciaz_2021.glb",
    "dimensionsMeters": {
      "length": 4.49,
      "width": 1.73,
      "height": 1.475
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Trắng Ngọc Trai Pearl Snow White",
        "hex": "#F8FAFC"
      },
      {
        "name": "Đen Ánh Kim Mineral Gray",
        "hex": "#0F172A"
      },
      {
        "name": "Nâu Hoàng Gia Dignity Brown",
        "hex": "#78350F"
      }
    ]
  },
  {
    "carId": "tesla-cybertruck",
    "carName": "Tesla Cybertruck",
    "brand": "Tesla",
    "glbUrl": "assets/models/tesla_cybertruck.glb",
    "dimensionsMeters": {
      "length": 5.682,
      "width": 2.2,
      "height": 1.791
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Thép Không Gỉ 30X Nguyên Bản (Stainless Steel)",
        "hex": "#94A3B8"
      },
      {
        "name": "Đen Satin Chiến Thuật (Satin Stealth Black)",
        "hex": "#1E293B"
      },
      {
        "name": "Trắng Satin Bắc Cực (Satin Ceramic White)",
        "hex": "#F1F5F9"
      },
      {
        "name": "Xanh Rêu Quân Đội (Tactical Green Wrap)",
        "hex": "#3F6212"
      }
    ]
  },
  {
    "carId": "tesla-roadster-2",
    "carName": "Tesla Roadster 2.0",
    "brand": "Tesla",
    "glbUrl": "assets/models/tesla_roadster_2.glb",
    "dimensionsMeters": {
      "length": 4.45,
      "width": 1.95,
      "height": 1.2
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Đỏ Thể Thao Tesla Red Multi-Coat",
        "hex": "#DC2626"
      },
      {
        "name": "Bạc Midnight Silver Metallic",
        "hex": "#94A3B8"
      },
      {
        "name": "Trắng Ngọc Pearl White",
        "hex": "#F8FAFC"
      }
    ]
  },
  {
    "carId": "toyota-camry",
    "carName": "Toyota Camry 2.5Q",
    "brand": "Toyota",
    "glbUrl": "assets/models/toyota_camry.glb",
    "dimensionsMeters": {
      "length": 4.885,
      "width": 1.84,
      "height": 1.445
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Trắng Ngọc Trai (089)",
        "hex": "#F8FAFC"
      },
      {
        "name": "Đen Ánh Kim (218)",
        "hex": "#0F172A"
      },
      {
        "name": "Đỏ Ánh Kim (3T3)",
        "hex": "#B91C1C"
      },
      {
        "name": "Ghi Bạc (1D4)",
        "hex": "#94A3B8"
      }
    ]
  },
  {
    "carId": "vinfast-fadil",
    "carName": "VinFast Fadil",
    "brand": "VinFast",
    "glbUrl": "assets/models/vinfast_fadil.glb",
    "dimensionsMeters": {
      "length": 3.676,
      "width": 1.632,
      "height": 1.53
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Trắng Brahminy White",
        "hex": "#F8FAFC"
      },
      {
        "name": "Đỏ Mystique Red",
        "hex": "#DC2626"
      },
      {
        "name": "Xám Neptune Grey",
        "hex": "#64748B"
      },
      {
        "name": "Cam Action Orange",
        "hex": "#EA580C"
      }
    ]
  },
  {
    "carId": "vinfast-lux-a20",
    "carName": "VinFast Lux A2.0",
    "brand": "VinFast",
    "glbUrl": "assets/models/vinfast_lux_a20.glb",
    "dimensionsMeters": {
      "length": 4.973,
      "width": 1.9,
      "height": 1.5
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Trắng Brahminy White",
        "hex": "#F8FAFC"
      },
      {
        "name": "Đen Jet Black",
        "hex": "#0F172A"
      },
      {
        "name": "Đỏ Mystique Red",
        "hex": "#B91C1C"
      },
      {
        "name": "Xanh Cormorant Brown",
        "hex": "#1E3A8A"
      }
    ]
  },
  {
    "carId": "vinfast-vf3",
    "carName": "VinFast VF 3",
    "brand": "VinFast",
    "glbUrl": "assets/models/vinfast_vf3.glb",
    "dimensionsMeters": {
      "length": 3.19,
      "width": 1.679,
      "height": 1.622
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Vàng Nắng Mai (Zenith Yellow)",
        "hex": "#FACC15"
      },
      {
        "name": "Xanh Lá Tươi Mát (Mint Green)",
        "hex": "#86EFAC"
      },
      {
        "name": "Hồng Phấn Ngọt Ngào (Rose Pink)",
        "hex": "#F472B6"
      },
      {
        "name": "Xanh Biển Năng Động (Electric Blue)",
        "hex": "#38BDF8"
      },
      {
        "name": "Trắng Tinh Khôi (Infinity White)",
        "hex": "#F8FAFC"
      }
    ]
  },
  {
    "carId": "vinfast-vf9",
    "carName": "VinFast VF 9 Plus 7 Chỗ",
    "brand": "VinFast",
    "glbUrl": "assets/models/vinfast_vf9.glb",
    "dimensionsMeters": {
      "length": 5.118,
      "width": 2.254,
      "height": 1.696
    },
    "readiness": "verified",
    "paintColors": [
      {
        "name": "Xanh Thẫm VinFast Blue",
        "hex": "#1E3A8A"
      },
      {
        "name": "Trắng Brahminy White",
        "hex": "#F8FAFC"
      },
      {
        "name": "Đen Jet Black",
        "hex": "#0F172A"
      },
      {
        "name": "Xám Xi Măng Desat Silver",
        "hex": "#94A3B8"
      }
    ]
  }
],
  isVehicleArVerified: function(carId) {
    return this.vehicles.some(v => v.carId === carId);
  },
  getVehicleArConfig: function(carId, colorIdx = 0) {
    const v = this.vehicles.find(item => item.carId === carId) || this.vehicles[0];
    const paint = (v.paintColors && v.paintColors[colorIdx]) ? v.paintColors[colorIdx] : (v.paintColors && v.paintColors[0]) ? v.paintColors[0] : { name: 'Mặc định', hex: '#94A3B8' };
    return {
      carId: v.carId,
      carName: v.carName,
      glbUrl: v.glbUrl,
      dimensionsMeters: v.dimensionsMeters,
      readiness: v.readiness,
      paintMaterial: paint
    };
  }
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIGMA_AR_MANIFEST };
}
