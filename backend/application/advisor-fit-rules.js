// backend/application/advisor-fit-rules.js
// AI Advisor fit rules for daily distance, driver height and weight (PLAN.md T3.1).
// The catalog has no headroom, seat or payload data, so height/weight only ever add ADVISORY reasons or notes and a
// small score nudge; they never exclude a vehicle. Daily distance is checked against the published EV range.

const TALL_CM = 185;
const SHORT_CM = 155;
const HEAVY_KG = 100;
const ROOMY_CATEGORIES = new Set(['SUV', 'Pickup', 'MPV', 'Truck']);
const LOW_SLUNG_CATEGORIES = new Set(['Siêu Xe', 'Coupe']);

function overallHeightMm(v) {
  const d = v && v.dimensionsDetail;
  const n = d ? Number(d.heightMm) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @returns {{ scoreDelta: number, reasons: string[], notes: string[] }}
 */
function evaluateFit(vehicle, prefs = {}) {
  const out = { scoreDelta: 0, reasons: [], notes: [] };
  if (!vehicle) return out;
  const dailyKm = Number(prefs.dailyKm);
  const heightCm = Number(prefs.heightCm);
  const weightKg = Number(prefs.weightKg);
  const range = Number(vehicle.range);
  const hMm = overallHeightMm(vehicle);

  if (Number.isFinite(dailyKm) && dailyKm > 0 && vehicle.fuel === 'ev') {
    if (!(range > 0)) {
      out.notes.push('Chưa công bố tầm hoạt động để đối chiếu quãng đường hằng ngày');
    } else if (range >= dailyKm * 3) {
      out.scoreDelta += 8;
      out.reasons.push(`Tầm hoạt động ${range} km đủ cho ~${Math.floor(range / dailyKm)} ngày với ${dailyKm} km/ngày`);
    } else if (range < dailyKm * 1.2) {
      out.scoreDelta -= 15;
      out.notes.push(`Tầm hoạt động ${range} km sát hoặc thấp hơn nhu cầu ${dailyKm} km/ngày — cần sạc mỗi ngày`);
    } else {
      out.notes.push(`Với ${dailyKm} km/ngày cần sạc khoảng mỗi ${Math.max(1, Math.floor(range / dailyKm))} ngày`);
    }
  }

  if (Number.isFinite(heightCm) && heightCm > 0) {
    if (heightCm >= TALL_CM) {
      if (ROOMY_CATEGORIES.has(vehicle.category) || (hMm !== null && hMm >= 1600)) {
        out.scoreDelta += 4;
        out.reasons.push(`Thân xe cao${hMm ? ` (${hMm.toLocaleString('vi-VN')} mm)` : ''} thường thoải mái hơn cho người cao ${heightCm} cm (tham khảo)`);
      } else if (LOW_SLUNG_CATEGORIES.has(vehicle.category) || (hMm !== null && hMm < 1300)) {
        out.scoreDelta -= 4;
        out.notes.push(`Xe dáng thấp${hMm ? ` (${hMm.toLocaleString('vi-VN')} mm)` : ''}: người cao ${heightCm} cm nên lái thử để kiểm tra khoảng trống đầu`);
      }
    } else if (heightCm <= SHORT_CM && (ROOMY_CATEGORIES.has(vehicle.category) || (hMm !== null && hMm >= 1750))) {
      out.notes.push(`Xe gầm/thân cao: người cao ${heightCm} cm nên thử tư thế lái và tầm nhìn`);
    }
  }

  if (Number.isFinite(weightKg) && weightKg >= HEAVY_KG && LOW_SLUNG_CATEGORIES.has(vehicle.category)) {
    out.notes.push('Ghế thể thao ôm sát: nên ngồi thử để kiểm tra độ thoải mái');
  }

  if ((Number.isFinite(heightCm) && heightCm > 0) || (Number.isFinite(weightKg) && weightKg > 0)) {
    out.notes.push('Chưa có số liệu khoảng trống đầu/ghế chính thức — gợi ý theo dáng xe chỉ mang tính tham khảo');
  }
  return out;
}

module.exports = { evaluateFit, TALL_CM, SHORT_CM, HEAVY_KG };
