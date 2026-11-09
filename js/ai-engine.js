// Sigma Intelligent Assistant (Sigma AI Engine)
// Specialized automotive AI consultant for SIGMACAR

const SigmaAIEngine = {
  // AI conversation history starts clean and is only populated when user chats
  historySessions: [],

  // Current active conversation
  currentSessionId: null,

  // Process user input and return intelligent response
  generateResponse(query) {
    const q = query.toLowerCase().trim();

    // 1. Phân tích gara / kích thước
    if (q.includes("gara") || q.includes("kích thước") || q.includes("đỗ xe") || q.includes("chiều dài") || q.includes("vừa không")) {
      return {
        text: `Chào bạn! Tôi đã phân tích thông số không gian garage của bạn qua mô hình không gian đa chiều:\n\n• **Kích thước xe SIGMA Model E:** 4.975 mm (Dài) x 1.964 mm (Rộng) x 1.680 mm (Cao).\n• **Bán kính quay vòng:** 5.4m cực kỳ linh hoạt.\n• **Hệ thống hỗ trợ:** Tích hợp **Sigma Remote Park Assist** cho phép xe tự động lùi vào gara chật hẹp bằng cách điều khiển qua smartphone mà bạn không cần ngồi trong xe.\n\nBạn có muốn tải ảnh chụp thực tế vị trí đỗ xe để AI quét điểm mù và tính góc cua chuẩn xác không?`,
        arScan: {
          garageLength: "5.50 m (Chuẩn căn hộ)",
          garageWidth: "2.60 m (Chuẩn ô đỗ)",
          carLength: "4.975 m",
          carWidth: "1.964 m",
          result: "Xe đỗ vừa vặn hoàn hảo - Đạt chuẩn an toàn AR",
          status: "success"
        }
      };
    }

    // 2. So sánh xe
    if (q.includes("so sánh") || (q.includes("model e") && q.includes("vision s"))) {
      return {
        text: `Tôi đã lập bảng phân tích so sánh chuyên sâu giữa **SIGMA Model E** và **SIGMA Vision S** cho bạn:\n\n1. **SIGMA Model E (SUV - 1.290 tỷ):**\n   - Phù hợp gia đình, gầm cao 185mm vượt địa hình êm ái.\n   - Tầm hoạt động: 600 km, công suất 320 kW (430 HP).\n   - Khoang cabin thoáng, cốp chứa đồ lớn.\n\n2. **SIGMA Vision S (Sedan GT - 2.150 tỷ):**\n   - Dành cho người đam mê tốc độ và sự sang trọng tột bậc.\n   - Tăng tốc 0-100 km/h: 3.2s, tầm hoạt động: 680 km, công suất 450 kW (600 HP).\n   - Màn hình Hyper-Display 31 inch và treo khí nén thông minh.`,
        recommendation: {
          carId: "model-e",
          name: "SIGMA Model E vs Vision S",
          badge: "BẢNG SO SÁNH TRỰC TIẾP",
          category: "SUV ĐA DỤNG vs SEDAN ĐẲNG CẤP",
          price: "1.290 tỷ vs 2.150 tỷ",
          range: "600 km vs 680 km",
          batteryHealth: "100%",
          seats: "5 Chỗ"
        },
        action: "compare"
      };
    }

    // 3. Ngân sách dưới 1 tỷ / xe tiết kiệm
    if (q.includes("dưới 1 tỷ") || q.includes("tiết kiệm") || q.includes("rẻ") || q.includes("700") || q.includes("800") || q.includes("city")) {
      return {
        text: `Với ngân sách tối ưu dưới 1 tỷ đồng, mẫu xe hoàn hảo nhất dành cho bạn là **SIGMA City G (Urban Smart EV)** chỉ từ **720 triệu** (xe mới) hoặc các dòng **Model E siêu lướt Certified**.\n\n**Ưu điểm vượt trội của City G:**\n- Chi phí sạc chỉ khoảng 250.000 VNĐ cho 400 km di chuyển trong phố.\n- Bán kính quay vòng 4.9m giúp luồn lách cực nhẹ nhàng trên phố giờ cao điểm.\n- Miễn 100% lệ phí trước bạ và bảo hành pin 8 năm chính hãng.`,
        recommendation: {
          carId: "city-g",
          name: "SIGMA City G",
          badge: "99% MATCH SCORE",
          category: "URBAN MOBILITY HATCHBACK",
          price: "720 triệu",
          range: "400 km",
          batteryHealth: "100%",
          seats: "5 Ghế Đô thị"
        }
      };
    }

    // 4. Tìm xe gia đình / 7 chỗ / SUV
    if (q.includes("gia đình") || q.includes("7 chỗ") || q.includes("5 người") || q.includes("suv") || q.includes("rộng")) {
      return {
        text: `Chào bạn! Dựa trên nhu cầu phục vụ gia đình, tiêu chí an toàn, độ êm ái và không gian rộng rãi là số 1. Tôi đề xuất mẫu **SIGMA Model E (Certified Luxury SUV)**:\n\n• **Điểm tương thích:** 98% Match Score.\n• **An toàn:** Đạt chuẩn 5 sao EURO NCAP với 7 túi khí và gói tự hành ADAS Cấp 2+ bảo vệ cả nhà trên mọi nẻo đường.\n• **Tiện nghi:** Cửa sổ trời toàn cảnh, dàn âm thanh 16 loa và hệ thống điều hòa kháng bụi mịn PM2.5 bảo vệ sức khỏe con trẻ.`,
        recommendation: {
          carId: "model-e",
          name: "SIGMA Model E (Certified)",
          badge: "98% MATCH SCORE",
          category: "CERTIFIED LUXURY SUV",
          price: "1.050 tỷ",
          range: "520 km",
          batteryHealth: "96%",
          seats: "5 Ghế Rộng rãi"
        }
      };
    }

    // 5. Pin, trạm sạc & bảo hành
    if (q.includes("pin") || q.includes("sạc") || q.includes("bảo hành") || q.includes("trạm sạc")) {
      return {
        text: `Hệ sinh thái năng lượng của SIGMACAR cam kết an tâm tuyệt đối:\n\n1. **Độ bền Pin:** Tế bào pin thể rắn Silicon-Carbide giữ được trên 90% dung lượng sau 8 năm sử dụng hoặc 200.000 km.\n2. **Hạ tầng sạc:** Hơn 1.500 trạm sạc siêu nhanh 250kW - 350kW phủ khắp 63 tỉnh thành Việt Nam. Sạc từ 10% lên 80% chỉ trong **20 - 25 phút**.\n3. **Chính sách SIGMACAR Care:**\n   - Bảo hành toàn xe 5 năm.\n   - Bảo hành cụm Pin động cơ 8 năm không giới hạn km.\n   - Cứu hộ và sạc pin di động 24/7 khẩn cấp miễn phí.`,
        recommendation: {
          carId: "model-e",
          name: "SIGMA Battery & Care Ecosystem",
          badge: "TIÊU CHUẨN QUỐC TẾ",
          category: "AN TÂM 100% VẬN HÀNH",
          price: "Bảo hành 8 năm",
          range: "1.500+ Trạm sạc",
          batteryHealth: "Chuẩn > 92%",
          seats: "Hỗ trợ 24/7"
        }
      };
    }

    // 6. Default intelligent advisory
    return {
      text: `Cảm ơn câu hỏi của bạn! Là **Sigma AI**, tôi có thể phân tích tức thì mọi khía cạnh mua sắm và sở hữu xe:\n\n• Tư vấn lựa chọn dòng xe theo ngân sách cá nhân hóa.\n• So sánh chi phí vận hành xe điện vs xe xăng truyền thống (tiết kiệm tới 65% chi phí nhiên liệu & bảo dưỡng).\n• Hướng dẫn quy trình đặt cọc trực tuyến và đăng ký lái thử tận nhà.\n• Ước tính phương án tài chính trả góp chỉ từ 8.5 triệu/tháng.\n\nBạn hãy cho tôi biết mức ngân sách hoặc nhu cầu sử dụng cụ thể nhé!`,
      recommendation: {
        carId: "model-e",
        name: "SIGMA Model E",
        badge: "ĐỀ XUẤT NỔI BẬT",
        category: "SMART ELECTRIC SUV",
        price: "1.290 tỷ",
        range: "600 km",
        batteryHealth: "100%",
        seats: "5 Ghế Rộng rãi"
      }
    };
  },

  // Simulated garage analysis when uploading photo
  simulateGarageAnalysis() {
    return {
      text: `[HỆ THỐNG AR VỪA HOÀN TẤT QUÉT ẢNH GARA]\n\nTôi đã tái lập bản đồ 3D từ ảnh chụp gara của bạn:\n• Chiều dài khả dụng: **5.65 m**\n• Chiều rộng lọt lòng: **2.75 m**\n• Chiều cao trần: **2.40 m**\n\n**Kết luận:** Xe **SIGMA Model E (4.975m x 1.964m)** hoàn toàn vừa vặn! Khi đỗ vào, bạn sẽ có:\n- Khoảng trống trước sau an toàn: **0.67m**.\n- Khoảng cách mở cửa 2 bên: **0.39m** mỗi bên, vừa đủ chuẩn mở cửa bước xuống êm ái.\n- Đề xuất: Kích hoạt tính năng **Auto Reverse Parking** trên chìa khóa thông minh để xe tự lùi vào vị trí.`,
      arScan: {
        garageLength: "5.65 m",
        garageWidth: "2.75 m",
        carLength: "4.975 m",
        carWidth: "1.964 m",
        result: "Đỗ xe an toàn - Vừa vặn hoàn hảo",
        status: "success"
      }
    };
  }
};
