// backend/domain/constants.js
// Business domain constants, roles, and state definitions for SIGMACAR

const ROLES = {
  BUYER: 'buyer',
  SELLER: 'seller',
  SUPPORT_STAFF: 'support_staff',
  SERVICE_STAFF: 'service_staff',
  ADMIN: 'admin'
};

const ORDER_STATUS = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed'
};

const PAYMENT_STATUS = {
  UNPAID: 'Unpaid',
  DEPOSIT_PAID: 'Deposit_Paid',
  FULLY_PAID: 'Fully_Paid',
  REFUNDED: 'Refunded',
  FAILED: 'Failed'
};

const APPOINTMENT_STATUS = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  IN_PROGRESS: 'Đang thực hiện',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
  NO_SHOW: 'Không đến'
};

const TICKET_STATUS = {
  OPEN: 'Chờ tiếp nhận',
  IN_PROGRESS: 'Đang xử lý',
  WAITING_CUSTOMER: 'Chờ khách phản hồi',
  WAITING_STAFF: 'Chờ nhân viên phản hồi',
  RESOLVED: 'Đã giải quyết',
  CLOSED: 'Đã đóng'
};

const TICKET_PRIORITY = {
  LOW: 'Thấp',
  NORMAL: 'Bình thường',
  HIGH: 'Cao',
  URGENT: 'Khẩn cấp'
};

// 9 Progressive Return Stages (as specified in Master Prompt section 2)
const RETURN_STATUS = {
  PENDING_RECEIPT: 'Chờ tiếp nhận',
  CHECKING_CONDITIONS: 'Đang kiểm tra điều kiện',
  APPROVED: 'Đã duyệt yêu cầu',
  REJECTED: 'Từ chối tiếp nhận',
  AWAITING_SCHEDULE: 'Chờ đặt lịch thu hồi',
  TRUCK_CONFIRMED: 'Đã xác nhận lịch xe tải',
  IN_TRANSIT: 'Đang vận chuyển xe về trung tâm',
  INSPECTING_VEHICLE: 'Đang kiểm tra tình trạng xe',
  REFUND_PROCESSING: 'Đang xử lý hoàn tiền hoặc đổi xe',
  COMPLETED: 'Hoàn tất'
};

const RETURN_STAGES_ORDER = [
  'Chờ tiếp nhận',
  'Đang kiểm tra điều kiện',
  'Đã duyệt yêu cầu',
  'Chờ đặt lịch thu hồi',
  'Đã xác nhận lịch xe tải',
  'Đang vận chuyển xe về trung tâm',
  'Đang kiểm tra tình trạng xe',
  'Đang xử lý hoàn tiền hoặc đổi xe',
  'Hoàn tất'
];

const RETURN_REASONS = [
  { id: 'tech_issue', label: 'Lỗi kỹ thuật hệ thống pin / động cơ điện' },
  { id: 'mismatch_spec', label: 'Tính năng hoặc thông số không đúng mô tả' },
  { id: 'exchange_model', label: 'Nhu cầu đổi sang mẫu xe / phiên bản khác' },
  { id: 'charging_inconvenience', label: 'Không thuận tiện lắp đặt trụ sạc tại nhà' },
  { id: 'personal_change', label: 'Thay đổi kế hoạch tài chính cá nhân' },
  { id: 'other', label: 'Lý do khác' }
];

const WARRANTY_STATUS = {
  ACTIVE: 'Đang hiệu lực',
  EXPIRED: 'Hết hạn',
  PENDING_VERIFICATION: 'Chờ xác thực số khung',
  VOIDED: 'Mất hiệu lực (Vi phạm chính sách)'
};

const WARRANTY_COVERED_COMPONENTS = [
  { name: 'Khối Pin Cao Áp (HV Battery Pack)', duration: '8 năm hoặc 160.000 km', coverage: 'Bảo hành dung lượng ≥ 75%, thay mới Cell pin lỗi' },
  { name: 'Động cơ điện (Electric Motor Drive Unit)', duration: '5 năm hoặc 150.000 km', coverage: 'Bảo hành toàn bộ cụm Stator, Rotor và hệ dẫn động' },
  { name: 'Biến tần & Bộ điều khiển (Inverter & MCU)', duration: '5 năm hoặc 150.000 km', coverage: 'Bảo hành lỗi phần cứng điều áp và bảng mạch công suất' },
  { name: 'Hệ thống Quản lý Nhiệt (Thermal Management)', duration: '5 năm hoặc 120.000 km', coverage: 'Bảo hành bơm nhiệt, két giải nhiệt và cảm biến nhiệt độ' },
  { name: 'Hệ thống Trợ lái ADAS & Cảm biến LiDAR/Radar', duration: '3 năm hoặc 100.000 km', coverage: 'Bảo hành cảm biến, camera và ECU tự hành' },
  { name: 'Hệ thống Khung gầm, Treo khí nén & Thước lái', duration: '3 năm hoặc 100.000 km', coverage: 'Bảo hành lỗi cơ khí do nhà sản xuất' }
];

const MAINTENANCE_MILESTONES = [
  { km: 1000, months: 1, title: 'Kiểm tra chạy rà đầu tiên (1.000 km / 1 tháng)', items: ['Kiểm tra lực siết bu-lông gầm', 'Quét chẩn đoán mã lỗi ECU', 'Kiểm tra áp suất và cân bằng động 4 bánh', 'Kiểm tra mức nước làm mát pin cao áp'], costEstimated: 'Miễn phí 100%' },
  { km: 10000, months: 6, title: 'Bảo dưỡng Cấp 1 (10.000 km / 6 tháng)', items: ['Vệ sinh và kiểm tra hệ thống phanh tái sinh', 'Thay lọc gió điều hòa kháng khuẩn', 'Cập nhật firmware OTA hệ thống xe', 'Đo dung lượng và cân bằng Cell pin'], costEstimated: '850.000 VNĐ' },
  { km: 20000, months: 12, title: 'Bảo dưỡng Cấp 2 (20.000 km / 12 tháng)', items: ['Đảo lốp và căn chỉnh góc đặt bánh xe', 'Kiểm tra dầu cầu / hộp giảm tốc', 'Thay dầu phanh chuyên dụng cho xe điện', 'Kiểm tra gioăng cao su cách âm'], costEstimated: '1.450.000 VNĐ' },
  { km: 40000, months: 24, title: 'Bảo dưỡng Cấp 3 (40.000 km / 24 tháng)', items: ['Thay dung dịch làm mát Pin cao áp chuyên dụng', 'Thay dầu bôi trơn hộp giảm tốc', 'Bảo dưỡng hệ thống treo khí nén', 'Kiểm định an toàn hệ thống sạc DC'], costEstimated: '2.800.000 VNĐ' },
  { km: 80000, months: 48, title: 'Bảo dưỡng Cấp 4 (80.000 km / 48 tháng)', items: ['Đại tu kiểm tra toàn diện cụm dẫn động điện', 'Thay toàn bộ các loại chất lỏng và lọc', 'Hiệu chuẩn lại hệ thống camera LiDAR ADAS', 'Đánh giá tuổi thọ khối Pin theo chuẩn quốc tế'], costEstimated: '4.200.000 VNĐ' }
];

const SHOWROOM_BRANCHES = [
  { id: 'hn-caugiay', name: 'Showroom SIGMACAR Cầu Giấy (Hà Nội)', city: 'Hà Nội', address: 'Số 68 Xuân Thủy, Cầu Giấy, Hà Nội', phone: '024 3888 6688', isServiceCenter: true },
  { id: 'hn-mydinh', name: 'Showroom SIGMACAR Mỹ Đình (Hà Nội)', city: 'Hà Nội', address: 'Số 8 Lê Quang Đạo, Mỹ Đình, Nam Từ Liêm, Hà Nội', phone: '024 3999 5599', isServiceCenter: true },
  { id: 'hcm-q7', name: 'Showroom SIGMACAR Quận 7 (TP.HCM)', city: 'TP.HCM', address: 'Số 101 Nguyễn Thị Thập, Tân Phú, Quận 7, TP.HCM', phone: '028 3777 8899', isServiceCenter: true },
  { id: 'hcm-thuduc', name: 'Showroom SIGMACAR Thủ Đức (TP.HCM)', city: 'TP.HCM', address: 'Số 12 Võ Văn Ngân, Phường Bình Thọ, TP. Thủ Đức, TP.HCM', phone: '028 3666 4433', isServiceCenter: true },
  { id: 'dn-haichau', name: 'Showroom SIGMACAR Đà Nẵng', city: 'Đà Nẵng', address: 'Số 234 Nguyễn Văn Linh, Hải Châu, Đà Nẵng', phone: '0236 3555 777', isServiceCenter: true }
];

const SERVICE_CENTERS = SHOWROOM_BRANCHES.map(b => ({
  ...b,
  workingHours: '08:00 - 18:00 (Thứ 2 - Chủ Nhật)',
  servicesSupported: ['Bảo dưỡng định kỳ', 'Kiểm tra pin cao áp', 'Sửa chữa bảo hành', 'Cân chỉnh góc lái điện tử', 'Thay thế phụ tùng chính hãng', 'Trạm sạc siêu nhanh 180kW']
}));

const CAMPAIGN_CATEGORIES = {
  BIRTHDAY: 'Chúc mừng Sinh nhật',
  TET: 'Tết Giáp Thìn & Xuân Tri Ân',
  HOLIDAY: 'Ưu đãi Ngày lễ & Sự kiện',
  POST_PURCHASE: 'Chào mừng Chủ xe mới & Gói đặc quyền',
  MAINTENANCE_REMINDER: 'Nhắc lịch Bảo dưỡng & Kiểm tra Pin'
};

const CAMPAIGN_STATUS = {
  DRAFT: 'Bản nháp',
  SCHEDULED: 'Đã lên lịch',
  SENDING: 'Đang gửi',
  SENT: 'Hoàn tất',
  PAUSED: 'Tạm dừng',
  CANCELLED: 'Đã hủy'
};

module.exports = {
  ROLES,
  ORDER_STATUS,
  PAYMENT_STATUS,
  APPOINTMENT_STATUS,
  TICKET_STATUS,
  TICKET_PRIORITY,
  RETURN_STATUS,
  RETURN_STAGES_ORDER,
  RETURN_REASONS,
  WARRANTY_STATUS,
  WARRANTY_COVERED_COMPONENTS,
  MAINTENANCE_MILESTONES,
  SHOWROOM_BRANCHES,
  SERVICE_CENTERS,
  CAMPAIGN_CATEGORIES,
  CAMPAIGN_STATUS
};
