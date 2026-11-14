// backend/application/local-ai/sigma-brain.js
// "Sigma Brain" — the rule-based reasoning core of the built-in (free, no API key) assistant.
//
// It understands Vietnamese with or without diacritics, finds cars by name / model / nickname, remembers the
// conversation (pronouns like "xe này", "hai chiếc trên", "chiếc thứ 2", refinements like "rẻ hơn", "còn xe điện
// thì sao"), searches the live catalog with scoring + progressive relaxation, compares cars, answers spec questions,
// computes loan payments (FinancingService) and running costs (TcoService), and explains EV / financing / site topics.
//
// Honesty rules: every number about a car comes from the catalog; missing data is reported as "chưa công bố".
// Returns { text, recommendation? } or null when it has nothing useful (caller then falls back).

'use strict';

const T = require('./text');
const { findTopic } = require('./knowledge');

const NA = 'chưa công bố';
const FUEL_LABEL = { ev: '⚡ Thuần điện', hybrid: '🔄 Hybrid', gas: '⛽ Xăng' };
const FUEL_SHORT = { ev: 'thuần điện', hybrid: 'hybrid', gas: 'động cơ xăng' };
const LUX_BRANDS = ['rolls-royce', 'maybach', 'lucid', 'porsche', 'land rover', 'lamborghini', 'ferrari', 'bugatti'];
const SINGLE_TOKEN_STOP = new Set(['plus', 'concept', 'cho', 'air', 'tail', 'boat', 'model', 'sv', 'rs', 'n', 'r', 's', 'q', 'ii', 'xe', 'new', 'edition', 'sport', 'lp', 'type', 'euro', 'sir', 'carrera']);

const GENERIC_TOKENS = new Set(['cho', 'plus', 'concept', 'xe', 'new', 'edition', 'ban', 'phien']);

const splitAlnum =(s) => s.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim();
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const firstNumber = (s) => { const m = String(s || '').replace(',', '.').match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };
const uniq = (arr) => [...new Set(arr)];

// ----------------------------------------------------------------------------------------------------------------
// Catalog view
// ----------------------------------------------------------------------------------------------------------------
function fuelOf(v) {
  const f = String(v.fuel || '').toLowerCase();
  if (f === 'ev' || f === 'electric') return 'ev';
  if (f === 'hybrid') return 'hybrid';
  if (f === 'gas' || f === 'ice' || f === 'petrol' || f === 'diesel') return 'gas';
  return num(v.range) ? 'ev' : 'gas';
}

function toCar(v) {
  const dims = v.dimensionsDetail || {};
  const ev = v.evSpecs || {};
  return {
    raw: v,
    id: v.id,
    name: String(v.name || v.id),
    brand: String(v.brand || ''),
    category: String(v.category || ''),
    fuel: fuelOf(v),
    price: num(v.salePrice) || num(v.price),
    listPrice: num(v.price),
    priceText: v.salePriceFormatted || v.priceFormatted || (num(v.price) ? T.formatVnd(v.price) : 'Liên hệ'),
    range: num(v.range) || num(ev.rangeKm),
    hp: num(v.hp),
    seats: num(v.seats),
    accel: firstNumber(v.acceleration),
    accelText: v.acceleration || null,
    topSpeed: firstNumber(v.topSpeed),
    lengthMm: num(dims.lengthMm),
    year: num(v.year),
    stock: Number.isFinite(Number(v.stockQuantity)) ? Number(v.stockQuantity) : (Number.isFinite(Number(v.stock)) ? Number(v.stock) : null),
    drive: String(v.drive || ''),
    isDemo: !!v.isDemo
  };
}

function buildIndex(vehicles) {
  const cars = (vehicles || []).filter(v => v && v.id && !v.archived && !v.deletedAt).map(toCar);
  const brands = uniq(cars.map(c => T.fold(c.brand)).filter(Boolean));
  const aliasMap = new Map(); // alias -> Set(carId)
  const add = (alias, id) => {
    const a = splitAlnum(T.norm(alias)).replace(/[.,]$/, '');
    if (!a || a.length < 2) return;
    if (!aliasMap.has(a)) aliasMap.set(a, new Set());
    aliasMap.get(a).add(id);
  };
  for (const c of cars) {
    const full = c.name;
    const noParen = full.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    const brandF = T.fold(c.brand);
    let model = splitAlnum(T.norm(noParen));
    if (brandF && model.startsWith(brandF + ' ')) model = model.slice(brandF.length + 1);
    add(full, c.id); add(noParen, c.id); add(c.id.replace(/-/g, ' '), c.id);
    (full.match(/\(([^)]*)\)/g) || []).forEach(p => { const inner = p.slice(1, -1); if (/[a-z]/i.test(inner) && /\d/.test(inner)) add(inner, c.id); });
    const toks = model.split(' ').filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      for (let j = i + 1; j <= toks.length; j++) {
        const gram = toks.slice(i, j).join(' ');
        // "porsche 911", "vinfast vf 3": brand + start of the model name is always a safe alias
        if (brandF && i === 0) add(`${brandF} ${gram}`, c.id);
        if (j - i === 1) {
          const t = toks[i];
          if (SINGLE_TOKEN_STOP.has(t) || /^\d+([.,]\d+)?$/.test(t) || t.length < 3) continue;
        }
        // a phrase made only of numbers / seat words / single letters ("7 cho", "plus 7 cho", "4 s") is not a name
        if (toks.slice(i, j).every(t => /^\d+([.,]\d+)?$/.test(t) || GENERIC_TOKENS.has(t) || t.length === 1)) continue;
        add(gram, c.id);
        if (brandF) add(`${brandF} ${gram}`, c.id);
      }
    }
  }
  // a brand with a single model in the showroom names that car ("lucid", "maybach", "bugatti")
  for (const b of brands) {
    const own = cars.filter(c => T.fold(c.brand) === b);
    if (own.length === 1 && b.length >= 4) add(b, own[0].id);
  }
  // Single tokens that are generic words in Vietnamese queries
  for (const bad of ['dien', 'gia', 'cho', 'mau', 'sang', 'the thao']) aliasMap.delete(bad);
  const aliases = [...aliasMap.entries()].map(([alias, ids]) => ({ alias, ids: [...ids], len: alias.length })).sort((a, b) => b.len - a.len);
  return { cars, byId: new Map(cars.map(c => [c.id, c])), brands, aliases };
}

/** car mentions in text, ordered by position; ambiguous aliases yield { group: [...] } */
function findCars(index, text) {
  const q = ` ${splitAlnum(T.norm(text))} `;
  const taken = [];
  const hits = [];
  for (const a of index.aliases) {
    let from = 0;
    for (;;) {
      const at = q.indexOf(` ${a.alias} `, from);
      if (at < 0) break;
      const s = at + 1; const e = s + a.alias.length;
      from = e;
      if (taken.some(([x, y]) => s < y && e > x)) continue;
      taken.push([s, e]);
      hits.push({ pos: s, ids: a.ids, alias: a.alias });
    }
  }
  hits.sort((x, y) => x.pos - y.pos);
  const out = [];
  for (const h of hits) {
    if (h.ids.length === 1) {
      const car = index.byId.get(h.ids[0]);
      if (car && !out.some(o => o.car && o.car.id === car.id)) out.push({ car, pos: h.pos });
    } else {
      out.push({ group: h.ids.map(id => index.byId.get(id)).filter(Boolean), alias: h.alias, pos: h.pos });
    }
  }
  return out;
}

const carsOnly = (mentions) => mentions.filter(m => m.car).map(m => m.car);

function findBrand(index, q) {
  for (const b of index.brands.slice().sort((a, b2) => b2.length - a.length)) {
    if (b && ` ${q} `.includes(` ${b} `)) return b;
  }
  if (/\bvin\b/.test(q)) return index.brands.find(b => b === 'vinfast');
  if (/\b(roll royce|rolls royce|rr)\b/.test(q)) return index.brands.find(b => b.startsWith('rolls'));
  if (/\b(merc|mercedes)\b/.test(q)) return index.brands.find(b => b === 'maybach');
  return undefined;
}

// ----------------------------------------------------------------------------------------------------------------
// Criteria
// ----------------------------------------------------------------------------------------------------------------
function parseCriteria(index, raw, q) {
  const budget = T.extractBudget(q);
  const fuel = T.extractFuel(q, raw);
  return {
    maxPrice: budget.maxPrice, minPrice: budget.minPrice, around: budget.around, monthlyMax: budget.monthlyMax,
    seats: T.extractSeats(q),
    fuel: fuel.want, excludeFuel: fuel.exclude,
    category: T.extractCategory(q),
    brand: findBrand(index, q),
    usages: T.extractUsages(q),
    sort: T.extractSort(q),
    minRange: T.extractMinRange(q),
    minPower: T.extractMinPower(q),
    inStock: /\b(con hang|co san|giao ngay|san xe)\b/.test(q) || undefined
  };
}

const CRIT_KEYS = ['maxPrice', 'minPrice', 'monthlyMax', 'seats', 'fuel', 'category', 'brand', 'minRange', 'minPower', 'inStock'];
function hasCriteria(c) {
  return CRIT_KEYS.some(k => c[k] !== undefined) || (c.excludeFuel && c.excludeFuel.length) || (c.usages && c.usages.length) || !!c.sort;
}

function describeCriteria(c) {
  const parts = [];
  if (c.fuel) parts.push(c.fuel === 'ev' ? 'xe điện' : FUEL_SHORT[c.fuel]);
  if (c.excludeFuel && c.excludeFuel.length) parts.push(`không phải ${c.excludeFuel.map(f => FUEL_SHORT[f]).join('/')}`);
  if (c.category) parts.push(c.category === 'Siêu Xe' ? 'siêu xe' : c.category);
  if (c.seats) parts.push(`${c.seats} chỗ`);
  if (c.brand) parts.push(`hãng ${c.brandLabel || c.brand}`);
  if (c.around) parts.push(`tầm ${T.formatMoneyShort(c.around)}`);
  else {
    if (c.minPrice && c.maxPrice) parts.push(`từ ${T.formatMoneyShort(c.minPrice)} đến ${T.formatMoneyShort(c.maxPrice)}`);
    else if (c.maxPrice) parts.push(`dưới ${T.formatMoneyShort(c.maxPrice)}`);
    else if (c.minPrice) parts.push(`trên ${T.formatMoneyShort(c.minPrice)}`);
  }
  if (c.monthlyMax) parts.push(`trả góp ≤ ${T.formatMoneyShort(c.monthlyMax)}/tháng`);
  if (c.minRange) parts.push(`đi được ≥ ${c.minRange} km/lần sạc`);
  if (c.minPower) parts.push(`≥ ${c.minPower} HP`);
  const U = { family: 'cho gia đình', city: 'đi phố', longtrip: 'đi đường dài', offroad: 'đi địa hình', sport: 'thể thao', luxury: 'sang trọng', business: 'chạy dịch vụ', firstcar: 'xe đầu tiên', eco: 'tiết kiệm' };
  (c.usages || []).forEach(u => parts.push(U[u]));
  return parts.filter(Boolean).join(', ');
}

/** largest car price whose loan (defaults) keeps the monthly payment ≤ monthlyMax */
function maxPriceForMonthly(monthlyMax, terms = {}) {
  const down = (terms.downPaymentPercent ?? 30) / 100;
  const n = terms.termMonths || 60;
  const r = ((terms.annualRate ?? 7.9) / 100) / 12;
  const principal = r > 0 ? monthlyMax * (1 - Math.pow(1 + r, -n)) / r : monthlyMax * n;
  return Math.round(principal / (1 - down));
}

function passes(car, c, skip = new Set()) {
  if (!skip.has('price')) {
    if (c.maxPrice && !(car.price && car.price <= c.maxPrice)) return false;
    if (c.minPrice && !(car.price && car.price >= c.minPrice)) return false;
    if (c.monthlyMax && !(car.price && car.price <= maxPriceForMonthly(c.monthlyMax))) return false;
  }
  if (!skip.has('seats') && c.seats && !(car.seats && car.seats >= c.seats)) return false;
  if (!skip.has('fuel')) {
    if (c.fuel && car.fuel !== c.fuel) return false;
    if (c.excludeFuel && c.excludeFuel.includes(car.fuel)) return false;
  }
  if (!skip.has('category') && c.category && car.category !== c.category) return false;
  if (!skip.has('brand') && c.brand && T.fold(car.brand) !== c.brand) return false;
  if (!skip.has('range') && c.minRange && !(car.fuel === 'ev' && car.range && car.range >= c.minRange)) return false;
  if (!skip.has('power') && c.minPower && !(car.hp && car.hp >= c.minPower)) return false;
  if (!skip.has('stock') && c.inStock && !(car.stock > 0)) return false;
  return true;
}

function scoreCar(car, c) {
  let s = 0;
  const reasons = [];
  const U = new Set(c.usages || []);
  const isSuper = car.category === 'Siêu Xe';
  if (U.has('family')) {
    if (car.seats >= 7) { s += 3; reasons.push(`${car.seats} chỗ rộng rãi cho cả nhà`); } else if (car.seats >= 5) { s += 2; reasons.push(`${car.seats} chỗ đủ cho gia đình`); } else s -= 2;
    if (car.category === 'SUV' || car.category === 'Sedan') s += 1;
    if (isSuper || car.category === 'Coupe') s -= 3;
  }
  if (U.has('city')) {
    if (car.lengthMm && car.lengthMm < 4200) { s += 2; reasons.push(`nhỏ gọn (dài ${car.lengthMm.toLocaleString('vi-VN')} mm), dễ xoay trở trong phố`); }
    else if (car.lengthMm && car.lengthMm > 5000) s -= 1;
    if (car.category === 'Hatchback') s += 1;
    if (car.fuel !== 'gas') { s += 1; reasons.push('vận hành êm, tiết kiệm khi kẹt xe'); }
    if (isSuper || car.category === 'Pickup') s -= 3;
  }
  if (U.has('longtrip')) {
    if (car.fuel === 'ev') { if (car.range >= 450) { s += 2; reasons.push(`tầm hoạt động ${car.range} km`); } else if (car.range && car.range < 250) s -= 2; }
    else { s += 1.5; reasons.push('đổ nhiên liệu nhanh, không phụ thuộc trạm sạc'); }
    if (car.category === 'SUV' || car.category === 'Sedan') s += 1;
  }
  if (U.has('offroad')) {
    if (car.category === 'SUV' || car.category === 'Pickup') s += 3; else s -= 2;
    if (/awd|4wd|4 banh/.test(T.fold(car.drive))) { s += 2; reasons.push('dẫn động 4 bánh'); }
  }
  if (U.has('sport')) {
    if (car.hp) s += Math.min(3, car.hp / 250);
    if (car.accel && car.accel < 5.5) { s += 2; reasons.push(`0-100 km/h ${car.accelText}`); }
    if (car.hp >= 300) reasons.push(`${car.hp} HP`);
  }
  if (U.has('luxury')) {
    if (LUX_BRANDS.includes(T.fold(car.brand))) { s += 2; reasons.push(`thương hiệu hạng sang ${car.brand}`); }
    if (car.price >= 3e9) s += 1.5;
  }
  if (U.has('business')) {
    if (car.price && car.price <= 8e8) s += 2; else s -= 1;
    if (car.seats >= 5) s += 1;
    if (car.fuel !== 'gas') { s += 1; reasons.push('chi phí nhiên liệu thấp khi chạy nhiều'); }
    if (isSuper) s -= 5;
  }
  if (U.has('firstcar')) {
    if (car.price && car.price <= 7e8) { s += 2; reasons.push('giá dễ tiếp cận'); }
    if (car.hp && car.hp < 200) s += 1;
    if (car.category === 'Hatchback') s += 1;
    if (isSuper) s -= 5;
  }
  if (U.has('eco')) {
    if (car.fuel === 'ev') { s += 2; reasons.push('chi phí năng lượng thấp'); } else if (car.fuel === 'hybrid') { s += 2; reasons.push('tiết kiệm xăng nhờ hybrid'); }
    if (car.price && car.price < 1e9) s += 1;
  }
  if (c.seats && car.seats === c.seats) s += 1;
  if (c.maxPrice && car.price) s += 1.5 * (car.price / c.maxPrice); // use the budget well
  if (c.around && car.price) s += 2 - Math.min(2, Math.abs(car.price - c.around) / c.around * 4);
  if (c.sort === 'price-asc-soft' && car.price) s -= car.price / 2e9;
  if (car.stock > 0) s += 0.3;
  if (car.isDemo) s -= 0.2;
  return { score: s, reasons: uniq(reasons) };
}

const SORTERS = {
  'price-asc': (a, b) => (a.price || Infinity) - (b.price || Infinity),
  'price-desc': (a, b) => (b.price || 0) - (a.price || 0),
  'hp-desc': (a, b) => (b.hp || 0) - (a.hp || 0),
  'accel-asc': (a, b) => (a.accel || Infinity) - (b.accel || Infinity),
  'range-desc': (a, b) => (b.range || 0) - (a.range || 0),
  'seats-desc': (a, b) => (b.seats || 0) - (a.seats || 0),
  'topspeed-desc': (a, b) => (b.topSpeed || 0) - (a.topSpeed || 0),
  'year-desc': (a, b) => (b.year || 0) - (a.year || 0)
};
const SORT_LABEL = {
  'price-asc': 'giá thấp nhất', 'price-desc': 'giá cao nhất', 'hp-desc': 'mạnh nhất', 'accel-asc': 'tăng tốc nhanh nhất',
  'range-desc': 'đi xa nhất mỗi lần sạc', 'seats-desc': 'nhiều chỗ nhất', 'topspeed-desc': 'tốc độ tối đa cao nhất', 'year-desc': 'đời mới nhất'
};
const sortValue = (car, sort) => ({
  'price-asc': car.priceText, 'price-desc': car.priceText, 'hp-desc': car.hp ? `${car.hp} HP` : NA,
  'accel-asc': car.accelText || NA, 'range-desc': car.range ? `${car.range} km` : NA, 'seats-desc': car.seats ? `${car.seats} chỗ` : NA,
  'topspeed-desc': car.raw.topSpeed || NA, 'year-desc': car.year || NA
}[sort]);

function rank(cars, c) {
  const scored = cars.map(car => ({ car, ...scoreCar(car, c) }));
  if (c.sort && SORTERS[c.sort]) {
    if (c.sort === 'range-desc') scored.splice(0, scored.length, ...scored.filter(x => x.car.fuel === 'ev'));
    scored.sort((x, y) => SORTERS[c.sort](x.car, y.car));
  } else scored.sort((x, y) => y.score - x.score || (x.car.price || 0) - (y.car.price || 0));
  return scored;
}

// ----------------------------------------------------------------------------------------------------------------
// Formatting helpers
// ----------------------------------------------------------------------------------------------------------------
function card(car, badge) {
  return {
    carId: car.id,
    name: car.name,
    badge: badge || 'GỢI Ý TỪ SIGMA AI',
    category: `${car.category || 'Ô tô'} • ${car.fuel === 'ev' ? 'Thuần điện' : car.fuel === 'hybrid' ? 'Hybrid' : 'Động cơ xăng'}`,
    price: car.priceText,
    range: car.range ? `${car.range} km` : 'Chưa công bố',
    batteryHealth: car.raw.measuredBatterySoH ? `${car.raw.measuredBatterySoH}%` : 'Chưa đo kiểm thực tế',
    seats: car.seats ? `${car.seats} Chỗ` : 'Chưa công bố'
  };
}

function oneLine(car) {
  const bits = [car.priceText, FUEL_SHORT[car.fuel], car.seats ? `${car.seats} chỗ` : null, car.hp ? `${car.hp} HP` : null, car.fuel === 'ev' && car.range ? `${car.range} km/lần sạc` : null];
  return `**${car.name}** — ${bits.filter(Boolean).join(' • ')}${car.stock === 0 ? ' • ⚠️ tạm hết hàng' : ''}`;
}

function overview(car) {
  const r = car.raw;
  const lines = [`🚘 **${car.name}**${r.subtitle ? ` — ${r.subtitle}` : ''}`, ''];
  lines.push(`• **Giá:** ${car.priceText}${r.priceNote ? ` _(${r.priceNote})_` : ''}`);
  lines.push(`• **Phân khúc:** ${car.category || NA} • ${FUEL_LABEL[car.fuel]}${car.year ? ` • đời ${car.year}` : ''}`);
  lines.push(`• **Công suất:** ${r.power || (car.hp ? `${car.hp} HP` : NA)}${r.torque ? ` • mô-men xoắn ${r.torque}` : ''}`);
  lines.push(`• **Tăng tốc 0-100 km/h:** ${car.accelText || NA} • **Tốc độ tối đa:** ${r.topSpeed || NA}`);
  if (car.fuel === 'ev') lines.push(`• **Pin / tầm hoạt động:** ${(r.evSpecs && r.evSpecs.batteryCapacity) || r.battery || NA} • ${car.range ? `${car.range} km` : NA}`);
  lines.push(`• **Số chỗ:** ${car.seats || NA} • **Hộp số:** ${r.transmission || NA} • **Dẫn động:** ${r.drive || NA}`);
  if (r.warranty) lines.push(`• **Bảo hành:** ${r.warranty}`);
  lines.push(`• **Tình trạng:** ${car.stock > 0 ? `còn ${car.stock} xe` : car.stock === 0 ? 'tạm hết hàng' : NA}`);
  if (r.description) lines.push('', r.description);
  lines.push('', 'Bạn muốn tôi **so sánh** với mẫu khác, **tính trả góp** hay **ước tính chi phí nuôi xe** mỗi tháng?');
  return lines.join('\n');
}

// attribute questions about a specific car
const ATTRS = [
  ['charge', /\b(sac|bao lau thi day|nap day)\b/],
  ['price', /\b(gia|bao nhieu tien|bao tien|het bao nhieu|tien)\b/],
  ['range', /\b(tam hoat dong|quang duong|di duoc bao xa|bao nhieu km|di duoc bao nhieu|range|di xa)\b/],
  ['battery', /\b(pin|dung luong|kwh)\b/],
  ['power', /\b(cong suat|ma luc|hp|kw|manh khong|manh bao nhieu|dong co)\b/],
  ['torque', /\b(mo men|momen|torque|nm)\b/],
  ['accel', /\b(0.100|0 100|tang toc|bao nhieu giay)\b/],
  ['topspeed', /\b(toc do toi da|toc do cao nhat|chay nhanh bao nhieu|max speed)\b/],
  ['seats', /\b(may cho|bao nhieu cho|cho ngoi|so cho|may ghe)\b/],
  ['warranty', /\b(bao hanh)\b/],
  ['colors', null], // handled on raw text ("màu" vs "mẫu" fold to the same word)
  ['stock', /\b(con hang|ton kho|co san|het hang|con xe|con bao nhieu xe|giao ngay)\b/],
  ['dims', /\b(kich thuoc|dai rong cao|chieu dai|chieu rong|chieu cao|gam xe|khoang sang|truc co so)\b/],
  ['weight', /\b(trong luong|nang bao nhieu|can nang|bao nhieu kg)\b/],
  ['features', /\b(tinh nang|trang bi|option|tien nghi|cong nghe gi|co gi hay|an toan)\b/],
  ['transmission', /\b(hop so|so tu dong|so san)\b/],
  ['drive', /\b(dan dong|awd|4wd|fwd|rwd|cau sau|cau truoc|2 cau)\b/],
  ['year', /\b(nam san xuat|doi nam|doi xe|ra mat nam)\b/]
];

function detectAttrs(q, raw) {
  const r = String(raw || '').toLowerCase();
  const found = [];
  for (const [k, re] of ATTRS) {
    if (k === 'colors') { if (/màu|mau sac|colour|color/.test(r)) found.push(k); continue; }
    if (re.test(q)) found.push(k);
  }
  // "sạc" mentions in a battery-capacity question should not hide the battery answer and vice versa
  return uniq(found);
}

function answerAttr(car, attr) {
  const r = car.raw;
  const ev = r.evSpecs || {};
  const d = r.dimensionsDetail || {};
  switch (attr) {
    case 'price': return `💰 **Giá ${car.name}:** **${car.priceText}**${r.salePrice && r.priceFormatted && r.salePriceFormatted ? ` (giá niêm yết ${r.priceFormatted})` : ''}${r.priceNote ? `\n_${r.priceNote}_` : ''}`;
    case 'range': return car.fuel === 'ev'
      ? `🛣️ **Tầm hoạt động ${car.name}:** **${car.range ? `${car.range} km` : NA}** mỗi lần sạc đầy (theo công bố của hãng; thực tế thường đạt ~75–90% tùy cách lái và điều hòa).`
      : `⛽ **${car.name}** là xe ${FUEL_SHORT[car.fuel]} nên không có "tầm hoạt động pin"; quãng đường phụ thuộc dung tích bình nhiên liệu (hãng ${r.fuelTank ? `công bố ${r.fuelTank}` : 'chưa công bố trên hệ thống'}).`;
    case 'battery': return car.fuel === 'ev'
      ? `🔋 **Pin ${car.name}:** ${ev.batteryCapacity || r.battery || NA}${ev.architecture ? ` • ${ev.architecture}` : ''}.`
      : `**${car.name}** dùng ${FUEL_SHORT[car.fuel]}${car.fuel === 'hybrid' ? ' (có pin hybrid cỡ nhỏ, tự sạc khi phanh/chạy)' : ', không dùng pin kéo'}.`;
    case 'charge': return car.fuel === 'ev'
      ? `⚡ **Sạc ${car.name}:** ${ev.fastCharge || 'hãng chưa công bố thời gian sạc nhanh trên hệ thống'}.${ev.batteryCapacity ? ` Với pin ${ev.batteryCapacity.split('(')[0].trim()}, sạc AC 11 kW tại nhà mất khoảng ${Math.max(1, Math.round((firstNumber(ev.batteryCapacity) || 0) / 11))} giờ từ cạn đến đầy (ước tính).` : ''}`
      : `**${car.name}** là xe ${FUEL_SHORT[car.fuel]} nên không cần sạc${car.fuel === 'hybrid' ? ' – pin hybrid tự nạp khi phanh tái sinh và khi động cơ hoạt động' : ' – chỉ cần đổ nhiên liệu khoảng 5 phút'}.`;
    case 'power': return `🏎️ **Công suất ${car.name}:** ${r.power || (car.hp ? `${car.hp} HP` : NA)}${r.engine ? `\n• Động cơ: ${r.engine}` : ''}`;
    case 'torque': return `🔩 **Mô-men xoắn ${car.name}:** ${r.torque || NA}`;
    case 'accel': return `⏱️ **${car.name} tăng tốc 0-100 km/h:** ${car.accelText || NA}`;
    case 'topspeed': return `🏁 **Tốc độ tối đa ${car.name}:** ${r.topSpeed || NA}`;
    case 'seats': return `💺 **${car.name}** có **${car.seats || NA} chỗ ngồi**.`;
    case 'warranty': return `🛡️ **Bảo hành ${car.name}:** ${r.warranty || (r.warrantyDetail && r.warrantyDetail.policy) || NA}. Sau khi nhận xe, bạn kích hoạt & tra cứu theo VIN trong **Gara của tôi**.`;
    case 'colors': {
      const cs = Array.isArray(r.colors) ? r.colors.map(x => (typeof x === 'string' ? x : x && x.name)).filter(Boolean) : [];
      return cs.length ? `🎨 **Màu ${car.name}:** ${cs.join(', ')}.` : `🎨 Màu sắc ${car.name}: ${r.colorsSummary || NA}.`;
    }
    case 'stock': return car.stock > 0 ? `📦 **${car.name}** hiện **còn ${car.stock} xe** tại hệ thống SIGMA CAR.` : car.stock === 0 ? `📦 **${car.name}** đang **tạm hết hàng** – bạn vẫn có thể đặt cọc giữ chỗ hoặc để lại thông tin để được báo khi có xe.` : `📦 Tình trạng kho ${car.name}: ${NA}.`;
    case 'dims': return `📐 **Kích thước ${car.name}:** ${d.overall || r.dimensions || NA}${d.wheelbase || r.wheelbase ? ` • trục cơ sở ${d.wheelbase || r.wheelbase}` : ''}${d.groundClearance || r.groundClearance ? ` • khoảng sáng gầm ${d.groundClearance || r.groundClearance}` : ''}`;
    case 'weight': return `⚖️ **Trọng lượng ${car.name}:** ${d.curbWeight || r.curbWeight || NA}`;
    case 'features': {
      const fs = Array.isArray(r.features) ? r.features.slice(0, 6) : [];
      return fs.length ? `✨ **Trang bị nổi bật ${car.name}:**\n${fs.map(f => `• ${f}`).join('\n')}` : `✨ Trang bị ${car.name}: ${NA}.`;
    }
    case 'transmission': return `⚙️ **Hộp số ${car.name}:** ${r.transmission || NA}`;
    case 'drive': return `🛞 **Dẫn động ${car.name}:** ${r.drive || NA}`;
    case 'year': return `📅 **${car.name}** đời **${car.year || NA}**.`;
    default: return null;
  }
}

function compareText(cars) {
  const cs = cars.slice(0, 3);
  const row = (label, f) => `| ${label} | ${cs.map(f).join(' | ')} |`;
  const lines = [
    `📊 **So sánh ${cs.map(c => c.name).join(' vs ')}:**`, '',
    `| Tiêu chí | ${cs.map(c => `**${c.name}**`).join(' | ')} |`,
    `|---|${cs.map(() => '---').join('|')}|`,
    row('Giá', c => c.priceText),
    row('Phân khúc', c => c.category || NA),
    row('Nhiên liệu', c => FUEL_SHORT[c.fuel]),
    row('Công suất', c => (c.hp ? `${c.hp} HP` : NA)),
    row('Mô-men xoắn', c => c.raw.torque ? String(c.raw.torque).split('(')[0].trim() : NA),
    row('0-100 km/h', c => c.accelText ? String(c.accelText).split('(')[0].trim() : NA),
    row('Tầm hoạt động/quãng đường', c => (c.fuel === 'ev' ? (c.range ? `${c.range} km` : NA) : 'theo bình nhiên liệu')),
    row('Số chỗ', c => (c.seats ? `${c.seats} chỗ` : NA)),
    row('Dẫn động', c => (c.drive ? c.drive.split('/')[0].trim() : NA)),
    row('Bảo hành', c => (c.raw.warranty ? String(c.raw.warranty).split('&')[0].trim() : NA))
  ];
  const v = [];
  const H = cs.length > 2 ? 'nhất' : 'hơn';
  const best = (key, better) => { const ok = cs.filter(c => c[key]); if (ok.length < 2) return null; return ok.reduce((a, b) => (better(a[key], b[key]) ? a : b)); };
  const cheap = best('price', (a, b) => a < b); if (cheap) v.push(`💰 **Rẻ ${H}:** ${cheap.name}`);
  const strong = best('hp', (a, b) => a > b); if (strong) v.push(`🏎️ **Mạnh ${H}:** ${strong.name} (${strong.hp} HP)`);
  const quick = best('accel', (a, b) => a < b); if (quick) v.push(`⏱️ **Tăng tốc nhanh ${H}:** ${quick.name}`);
  const roomy = best('seats', (a, b) => a > b); if (roomy && cs.some(c => c.seats !== roomy.seats)) v.push(`👨‍👩‍👧 **Nhiều chỗ ${H}:** ${roomy.name}`);
  const evs = cs.filter(c => c.fuel === 'ev');
  if (evs.length && evs.length < cs.length) v.push(`⚡ **Chi phí năng lượng thấp ${H}:** ${evs.map(c => c.name).join(', ')} (xe điện)`);
  lines.push('', '**Nhận định nhanh:**', ...v.map(x => `• ${x}`));
  const kinds = uniq(cs.map(c => c.category));
  if (kinds.length > 1) lines.push('', `Lưu ý: các mẫu thuộc phân khúc khác nhau (${kinds.join(' / ')}) nên phù hợp nhu cầu khác nhau. Cho tôi biết bạn ưu tiên **giá, sức mạnh, số chỗ hay chi phí nuôi xe**, tôi sẽ chốt lựa chọn phù hợp nhất.`);
  return lines.join('\n');
}

// ----------------------------------------------------------------------------------------------------------------
// Conversation memory (derived from history each turn — stateless server)
// ----------------------------------------------------------------------------------------------------------------
function readContext(index, history) {
  const ctx = { cars: [], lastList: [], lastUserCriteria: null, lastUserText: '' };
  const msgs = Array.isArray(history) ? history.slice(-12) : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i] || {};
    const text = String(m.text || m.content || '');
    if (!text) continue;
    const found = carsOnly(findCars(index, text));
    const isUser = !(m.role === 'assistant' || m.role === 'model' || m.role === 'ai' || m.role === 'bot');
    if (!ctx.lastList.length && !isUser && found.length >= 2) ctx.lastList = found;
    for (const c of found) if (!ctx.cars.some(x => x.id === c.id)) ctx.cars.push({ ...c, _msg: i });
    if (isUser && !ctx.lastUserCriteria) {
      const q = T.norm(text);
      const crit = parseCriteria(index, text, q);
      if (hasCriteria(crit)) { ctx.lastUserCriteria = crit; ctx.lastUserText = text; }
    }
  }
  // cars of the most recent message that mentioned cars come first, in their order of mention
  if (ctx.cars.length) {
    const newest = Math.max(...ctx.cars.map(c => c._msg));
    const recent = msgs[newest] ? carsOnly(findCars(index, String(msgs[newest].text || msgs[newest].content || ''))) : [];
    ctx.recentCars = recent.length ? recent : ctx.cars.slice(0, 1);
  } else ctx.recentCars = [];
  return ctx;
}

const PRONOUN = /\b(xe nay|chiec nay|chiec do|xe do|mau nay|mau do|no co|no di|no sac|cua no|nó|chiec xe nay|chiec tren|xe tren|xe vua roi|chiec vua roi|em nay|con nay)\b/;
const PLURAL_PRONOUN = /\b(hai chiec|2 chiec|hai xe|2 xe|hai mau|2 mau|ca hai|cac xe tren|nhung xe tren|cac mau tren|ba chiec|3 chiec|may chiec tren)\b/;
const REFINE = /^(con|the con|vay con|neu|hay la|thay vao do|con xe|con mau)\b|\b(thi sao|the nao|duoc khong|thi co|re hon|dat hon|manh hon|nho hon|lon hon|rong hon|tiet kiem hon|xa hon|khac di|mau khac|xe khac|lua chon khac|nua khong|them xe)\b/;

// ----------------------------------------------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------------------------------------------
function createBrain({ getVehicles, FinancingService, TcoService } = {}) {
  let cache = { src: null, len: -1, stamp: '', index: null };
  function getIndex() {
    const list = (typeof getVehicles === 'function' ? getVehicles() : []) || [];
    const stamp = list.length ? `${list.length}:${list[0].id}:${list[list.length - 1].id}:${list.map(v => v.price).join(',').length}` : '0';
    if (cache.src !== list || cache.stamp !== stamp) cache = { src: list, stamp, index: buildIndex(list) };
    return cache.index;
  }

  function search(index, crit, opts = {}) {
    const all = index.cars;
    const label = describeCriteria(crit);
    const matches = all.filter(c => passes(c, crit));
    const intro = opts.intro || '';
    if (matches.length) {
      const ranked = rank(matches, crit);
      const top = ranked.slice(0, opts.limit || 3);
      const lines = [];
      if (intro) lines.push(intro);
      if (crit.sort && SORT_LABEL[crit.sort]) {
        lines.push(`🏆 **Xe ${SORT_LABEL[crit.sort]}${label ? ` (${label})` : ''} trong showroom:**`, '');
        top.forEach((x, i) => lines.push(`${i + 1}. ${oneLine(x.car)} → **${sortValue(x.car, crit.sort)}**`));
      } else {
        const hard = CRIT_KEYS.some(k => crit[k] !== undefined) || (crit.excludeFuel && crit.excludeFuel.length);
        lines.push(hard
          ? `🔎 Tôi tìm thấy **${matches.length} mẫu xe**${label ? ` phù hợp tiêu chí **${label}**` : ''}. ${matches.length > top.length ? `Đây là ${top.length} lựa chọn tốt nhất:` : ''}`
          : `🔎 Dựa trên nhu cầu **${label}**, đây là ${top.length} mẫu phù hợp nhất trong showroom:`, '');
        top.forEach((x, i) => {
          lines.push(`${i + 1}. ${oneLine(x.car)}`);
          if (x.reasons.length) lines.push(`   ↳ ${x.reasons.slice(0, 3).join('; ')}`);
        });
      }
      // few hits under a price cap → also show what is just above the budget (≤ +20%)
      if (matches.length < 3 && crit.maxPrice && !crit.sort) {
        const near = all.filter(c => !matches.includes(c) && c.price > crit.maxPrice && c.price <= crit.maxPrice * 1.2 && passes(c, crit, new Set(['price'])))
          .sort(SORTERS['price-asc']).slice(0, 2);
        if (near.length) {
          lines.push('', `💡 **Nhỉnh hơn ngân sách một chút:**`);
          near.forEach(c => lines.push(`• ${oneLine(c)} _(+${T.formatMoneyShort(c.price - crit.maxPrice)})_`));
        }
      }
      if (crit.monthlyMax && FinancingService) {
        const loan = safeLoan(top[0].car.price, {});
        if (loan) lines.push('', `💳 Ví dụ **${top[0].car.name}**: trả trước 30% (${T.formatMoneyShort(loan.downPaymentAmount)}), vay 5 năm lãi 7,9%/năm → **~${T.formatVnd(loan.monthlyPayment)}/tháng**.`);
      }
      const pick = top[0].car;
      lines.push('', `👉 Gợi ý nổi bật: **${pick.name}**. Bạn muốn xem chi tiết, so sánh ${top[1] ? `với **${top[1].car.name}**` : 'với mẫu khác'} hay tính trả góp?`);
      return { text: lines.join('\n'), recommendation: card(pick, crit.sort ? 'XẾP HẠNG SIGMA AI' : 'PHÙ HỢP NHẤT'), list: top.map(x => x.car) };
    }

    // nothing matches → explain and relax intelligently
    const lines = [];
    if (intro) lines.push(intro);
    lines.push(`Hiện showroom **chưa có mẫu nào** đáp ứng đồng thời: **${label || 'các tiêu chí bạn nêu'}**.`);
    let pick = null;
    const priceSet = crit.maxPrice || crit.minPrice || crit.monthlyMax;
    // A) keep everything but the price
    if (priceSet) {
      const a = all.filter(c => passes(c, crit, new Set(['price'])));
      if (a.length) {
        const nearest = a.slice().sort((x, y) => Math.abs((x.price || 0) - (crit.maxPrice || crit.minPrice || 0)) - Math.abs((y.price || 0) - (crit.maxPrice || crit.minPrice || 0))).slice(0, 2);
        lines.push('', `🔼 **Nếu linh hoạt ngân sách** (giữ các tiêu chí khác):`);
        nearest.forEach(c => {
          const diff = crit.maxPrice && c.price > crit.maxPrice ? ` _(cao hơn ngân sách ${T.formatMoneyShort(c.price - crit.maxPrice)})_` : '';
          lines.push(`• ${oneLine(c)}${diff}`);
        });
        pick = pick || nearest[0];
      }
    }
    // B) keep the price, relax the other constraints one by one (least important first)
    const order = ['stock', 'power', 'range', 'category', 'brand', 'seats', 'fuel'];
    const skip = new Set();
    let b = [];
    for (const k of order) {
      skip.add(k);
      b = all.filter(c => passes(c, crit, skip));
      if (b.length) break;
    }
    if (b.length && (priceSet || !pick)) {
      const NAME = { stock: 'tình trạng kho', power: 'công suất', range: 'tầm hoạt động', category: 'kiểu dáng', brand: 'hãng xe', fuel: 'loại nhiên liệu', seats: 'số chỗ' };
      const relaxed = [...skip].filter(k => crit[{ power: 'minPower', range: 'minRange', stock: 'inStock' }[k] || k] !== undefined || (k === 'fuel' && crit.excludeFuel && crit.excludeFuel.length));
      const ranked = rank(b, { ...crit, seats: skip.has('seats') ? undefined : crit.seats }).slice(0, 3);
      lines.push('', `${priceSet ? '💡 **Nếu giữ nguyên ngân sách**' : '💡 **Lựa chọn gần nhất**'}${relaxed.length ? ` (nới lỏng ${relaxed.map(k => NAME[k]).join(', ')})` : ''}:`);
      ranked.forEach(x => lines.push(`• ${oneLine(x.car)}`));
      pick = pick || ranked[0].car;
      if (!priceSet) pick = ranked[0].car;
    }
    if (!pick) {
      const cheapest = all.filter(c => c.price).sort(SORTERS['price-asc'])[0];
      if (cheapest) { lines.push('', `Mẫu có giá dễ tiếp cận nhất hiện tại là ${oneLine(cheapest)}.`); pick = cheapest; }
    }
    lines.push('', 'Bạn muốn ưu tiên giữ **ngân sách** hay giữ **tiêu chí xe**? Tôi sẽ lọc lại chính xác hơn.');
    return { text: lines.join('\n'), recommendation: pick ? card(pick, 'LỰA CHỌN GẦN NHẤT') : undefined, list: [] };
  }

  function safeLoan(price, terms) {
    if (!FinancingService || !price) return null;
    try {
      return FinancingService.calculateLoan({
        vehiclePrice: price,
        downPaymentPercent: terms.downPaymentPercent ?? 30,
        annualInterestRatePercent: terms.annualRate ?? 7.9,
        termMonths: terms.termMonths || 60
      });
    } catch (_) { return null; }
  }

  function loanAnswer(car, q) {
    const terms = T.extractLoanTerms(q);
    const loan = safeLoan(car.price, terms);
    if (!loan) return null;
    const income = T.extractMoney(q).find(m => /thu nhap|luong|kiem duoc/.test(q.slice(Math.max(0, m.start - 20), m.start)));
    const lines = [
      `💳 **Dự toán trả góp ${car.name}** (giá ${car.priceText}):`, '',
      `• Trả trước **${loan.downPaymentPercent}%**: **${T.formatVnd(loan.downPaymentAmount)}**`,
      `• Số tiền vay: ${T.formatVnd(loan.financedPrincipal)} trong **${loan.termMonths} tháng** (${Math.round(loan.termMonths / 12 * 10) / 10} năm), lãi **${loan.annualInterestRate}%/năm** (dư nợ giảm dần)`,
      `• **Trả mỗi tháng: ~${T.formatVnd(loan.monthlyPayment)}**`,
      `• Tổng tiền lãi: ${T.formatVnd(loan.totalInterest)}`
    ];
    if (income) {
      const ratio = loan.monthlyPayment / income.value;
      lines.push('', ratio <= 0.4
        ? `✅ Với thu nhập ${T.formatMoneyShort(income.value)}/tháng, khoản trả góp chiếm ~${Math.round(ratio * 100)}% – trong ngưỡng an toàn (≤ 40%).`
        : `⚠️ Với thu nhập ${T.formatMoneyShort(income.value)}/tháng, khoản trả góp chiếm ~${Math.round(ratio * 100)}% – vượt ngưỡng an toàn 40%. Nên tăng trả trước hoặc kéo dài kỳ hạn.`);
    }
    const alt = safeLoan(car.price, { ...terms, termMonths: Math.min(96, (loan.termMonths || 60) + 24) });
    if (alt) lines.push('', `Nếu kéo dài lên ${alt.termMonths} tháng: ~${T.formatVnd(alt.monthlyPayment)}/tháng.`);
    lines.push('', `_${loan.disclaimer}_`, 'Bạn có thể đổi tỷ lệ trả trước, kỳ hạn, lãi suất – ví dụ: "*trả trước 40% trong 7 năm lãi 8,5%*".');
    return { text: lines.join('\n'), recommendation: card(car, 'DỰ TOÁN TRẢ GÓP') };
  }

  function tcoAnswer(car, q) {
    if (!TcoService) return null;
    const daily = T.extractDailyKm(q) || 40;
    let est;
    try { est = TcoService.estimate({ vehicleId: car.id, monthlyKm: daily * 30 }); } catch (_) { return null; }
    const lines = [`🧮 **Chi phí vận hành ước tính ${car.name}** (đi ~${daily} km/ngày ≈ ${daily * 30} km/tháng):`, ''];
    if (est.monthlyEnergy !== null && est.monthlyEnergy !== undefined) lines.push(`• Tiền điện: **~${T.formatVnd(est.monthlyEnergy)}/tháng** (${est.inputsUsed.kWhPer100Km} kWh/100 km × ${Number(est.inputsUsed.electricityVndPerKwh).toLocaleString('vi-VN')} đ/kWh)`);
    if (est.monthlyFuel !== null && est.monthlyFuel !== undefined) lines.push(`• Tiền xăng: **~${T.formatVnd(est.monthlyFuel)}/tháng** (${est.inputsUsed.litersPer100Km} L/100 km × ${Number(est.inputsUsed.fuelVndPerLiter).toLocaleString('vi-VN')} đ/L)`);
    lines.push(`• Bảo dưỡng dự kiến: ~${T.formatVnd(est.annualMaintenance)}/năm`);
    lines.push(`• **Tổng vận hành: ~${T.formatVnd(est.annualOperating)}/năm** • 5 năm: ~${T.formatMoneyShort(est.fiveYearOperating)}`);
    if (est.missingCatalogSpecs && est.missingCatalogSpecs.length) lines.push('', '_Hãng chưa công bố mức tiêu thụ trên hệ thống nên tôi dùng mức trung bình phân khúc – hãy nhập số thực tế tại trang **TCO** để chính xác hơn._');
    lines.push('', 'Chưa gồm bảo hiểm, phí đường bộ, gửi xe. Muốn tính với quãng đường khác? Ví dụ: "*mỗi ngày đi 80 km*".');
    return { text: lines.join('\n'), recommendation: card(car, 'CHI PHÍ VẬN HÀNH') };
  }

  function answer({ message, history = [], currentUser = null } = {}) {
    const raw = String(message || '').trim();
    if (!raw) return null;
    const q = T.norm(raw);
    const index = getIndex();
    const ctx = readContext(index, history);
    const mentions = findCars(index, raw);
    let cars = carsOnly(mentions);
    const groups = mentions.filter(m => m.group);
    const crit = parseCriteria(index, raw, q);
    if (crit.brand) { const b = index.cars.find(c => T.fold(c.brand) === crit.brand); crit.brandLabel = b ? b.brand : crit.brand; }

    // pronouns / ordinals → cars from context
    const ord = T.extractOrdinal(q);
    if (!cars.length && ord !== undefined) {
      const list = ctx.lastList.length ? ctx.lastList : ctx.recentCars;
      const pickOrd = ord === 'last' ? list[list.length - 1] : list[ord];
      if (pickOrd) cars = [pickOrd];
    }
    if (!cars.length && PLURAL_PRONOUN.test(q) && ctx.cars.length >= 2) {
      const n = /\b(ba|3)\b/.test(q) ? 3 : 2;
      cars = (ctx.lastList.length >= 2 ? ctx.lastList : ctx.recentCars.length >= 2 ? ctx.recentCars : ctx.cars).slice(0, n);
    }
    const usesPronoun = PRONOUN.test(q) || /^(the )?no\b/.test(q) || /\bno (co|di|sac|ton|chay|bao|gia|manh|nang|dat|re|duoc|la|thi|tang|an|uong|het|can|mat)\b/.test(q);

    const wantsCompare = /\b(so sanh|so voi|khac nhau|khac gi|vs|versus|hon kem|chon xe nao|nen chon|nen lay|hay hon|tot hon)\b/.test(q) || (cars.length >= 2 && /\b(hay|hoac)\b/.test(q));
    const wantsLoan = /\b(tra gop|vay|tra truoc|lai suat|gop moi thang|tra hang thang|moi thang tra|tra moi thang|tra gop moi thang)\b/.test(q);
    const wantsTco = /\b(chi phi van hanh|chi phi nuoi|nuoi xe|tien dien|tien xang|ton bao nhieu tien|ton xang|ton dien|het bao nhieu tien dien|chi phi su dung|chi phi moi thang|chi phi hang thang)\b/.test(q);
    const searchWords = /\b(tim|goi y|tu van|de xuat|nen mua|muon mua|can mua|xe nao|mau nao|loai nao|chiec nao|co xe|liet ke|danh sach|cac xe|nhung xe|xe gi|recommend|chon giup)\b/.test(q);

    // ---- 1. social ---------------------------------------------------------------------------------------------
    if (/^(cam on|thank|thanks|cam on ban|tks|ty|ok cam on|cam on nhieu)\b/.test(q) && q.length < 40) {
      return { text: 'Rất vui được giúp bạn! 😊 Nếu cần so sánh thêm, tính trả góp hay đặt lịch lái thử, cứ nhắn tôi nhé.' };
    }
    if (/^(tam biet|bye|hen gap lai|chao tam biet)\b/.test(q)) return { text: 'Tạm biệt bạn! Chúc bạn sớm chọn được chiếc xe ưng ý. Hẹn gặp lại tại SIGMA CAR 🚗' };
    if (/\b(ban la ai|ban ten gi|ban lam duoc gi|ban giup duoc gi|ban co the lam gi|tro ly ao|gioi thieu ve ban|chuc nang cua ban)\b/.test(q)) {
      return { text: capabilities(index) };
    }
    if (/^(chao|xin chao|hello|hi|hey|alo|chao ban|helo)\b/.test(q) && q.split(' ').length <= 6) {
      const name = currentUser && (currentUser.fullName || currentUser.name);
      return { text: `Xin chào${name ? ` ${name}` : ' bạn'}! Tôi là **Sigma AI** – trợ lý tư vấn xe của SIGMA CAR. Tôi có thể giúp gì cho bạn hôm nay?\n\nVí dụ bạn có thể hỏi:\n• "*Tìm xe điện dưới 1 tỷ cho gia đình*"\n• "*So sánh VinFast VF 9 và Land Rover Defender*"\n• "*Trả góp Toyota Camry trả trước 30% trong 5 năm*"\n• "*Chi phí nuôi VF 3 nếu đi 40 km/ngày*"` };
    }
    if (/\b(ban khoe khong|ban co khoe|dang lam gi|ban o dau)\b/.test(q)) return { text: 'Tôi luôn sẵn sàng 24/7! 😄 Bạn đang tìm hiểu mẫu xe nào hay cần tôi gợi ý theo ngân sách không?' };
    if (/\b(ke chuyen cuoi|chuyen cuoi|joke|noi dua)\b/.test(q)) return { text: '😄 Vì sao xe điện không bao giờ cãi nhau? – Vì nó luôn **giữ được bình tĩnh**… à nhầm, **giữ được pin**! Bạn có muốn tôi tìm một chiếc xe khiến bạn vui thật sự không?' };

    // ---- 2. ambiguous model names ("civic") -----------------------------------------------------------------------
    if (!cars.length && groups.length && !searchWords && !hasCriteria(crit)) {
      const g = groups[0].group;
      return { text: `Showroom đang có **${g.length} mẫu** khớp với "${groups[0].alias}":\n\n${g.map((c, i) => `${i + 1}. ${oneLine(c)}`).join('\n')}\n\nBạn đang quan tâm chiếc nào? (có thể trả lời "*chiếc thứ 2*")`, recommendation: card(g[0], 'NHIỀU LỰA CHỌN'), _list: g };
    }
    if (!cars.length && groups.length) cars = []; // fall through to search with brand/group below

    // ---- 3. compare ---------------------------------------------------------------------------------------------
    if (wantsCompare) {
      let pool = cars.slice();
      if (pool.length < 2 && groups.length) pool = pool.concat(groups[0].group.filter(c => !pool.some(p => p.id === c.id)));
      if (pool.length === 1 && ctx.recentCars.length) pool = pool.concat(ctx.recentCars.filter(c => c.id !== pool[0].id).slice(0, 1));
      if (pool.length < 2 && (usesPronoun || PLURAL_PRONOUN.test(q) || /\b(tren|vua roi)\b/.test(q)) && ctx.cars.length >= 2) pool = (ctx.lastList.length >= 2 ? ctx.lastList : ctx.cars).slice(0, 2);
      if (pool.length >= 2) return { text: compareText(pool), recommendation: card(pool[0], 'SO SÁNH') };
      if (pool.length === 1) {
        const similar = rank(index.cars.filter(c => c.id !== pool[0].id && c.category === pool[0].category), { maxPrice: pool[0].price ? pool[0].price * 1.4 : undefined }).slice(0, 1).map(x => x.car);
        if (similar.length) return { text: `Bạn chưa nêu mẫu thứ hai nên tôi so sánh **${pool[0].name}** với mẫu cùng phân khúc gần nhất:\n\n${compareText([pool[0], similar[0]])}`, recommendation: card(pool[0], 'SO SÁNH') };
      }
      if (!hasCriteria(crit)) return { text: 'Bạn muốn so sánh những mẫu nào? Ví dụ: "*So sánh Tesla Cybertruck và Toyota Camry*". Tôi so sánh được tối đa 3 xe cùng lúc theo giá, công suất, tầm hoạt động, số chỗ, dẫn động và bảo hành.' };
    }

    // which car is "this"?
    const subject = cars[0] || ((usesPronoun || !hasCriteria(crit)) && ctx.recentCars[0]) || null;

    // ---- 4. financing ---------------------------------------------------------------------------------------------
    if (wantsLoan) {
      if (subject && (cars.length || usesPronoun || !crit.monthlyMax)) { const a = loanAnswer(subject, q); if (a) return a; }
      if (crit.monthlyMax) {
        const cap = maxPriceForMonthly(crit.monthlyMax, T.extractLoanTerms(q));
        return search(index, { ...crit }, { intro: `💳 Với khoản trả góp **≤ ${T.formatMoneyShort(crit.monthlyMax)}/tháng** (trả trước 30%, vay 5 năm, lãi 7,9%), bạn mua được xe giá tới khoảng **${T.formatMoneyShort(cap)}**.\n` });
      }
      const topic = findTopic('vay mua xe');
      return { text: topic.text };
    }

    // ---- 5. running cost --------------------------------------------------------------------------------------------
    const tcoCar = subject || (!searchWords && ctx.recentCars[0]) || null;
    if (wantsTco && tcoCar) { const a = tcoAnswer(tcoCar, q); if (a) return a; }

    // ---- 6. a specific car: attribute or overview ------------------------------------------------------------------
    const attrs = detectAttrs(q, raw);
    if (subject && (cars.length || usesPronoun) && !(searchWords && hasCriteria(crit) && !cars.length)) {
      if (attrs.length) {
        const parts = attrs.slice(0, 4).map(a => answerAttr(subject, a)).filter(Boolean);
        if (parts.length) {
          const follow = subject.fuel === 'ev' && !attrs.includes('charge') ? '\n\nCần thêm thông tin về sạc, trả góp hay chi phí nuôi xe không?' : '\n\nBạn muốn xem thêm thông số khác, so sánh hay đặt lịch lái thử?';
          return { text: parts.join('\n\n') + follow, recommendation: card(subject, 'XE ĐANG XEM') };
        }
      }
      if (cars.length || usesPronoun) {
        // "có tốt không", "review", or just the name → overview (+ topical note)
        return { text: overview(subject), recommendation: card(subject, 'THÔNG TIN XE') };
      }
    }

    // ---- 7. general knowledge & site help ---------------------------------------------------------------------------
    const topic = findTopic(q);
    if (topic && !(searchWords && hasCriteria(crit))) return { text: topic.text };

    // ---- 8. refine the previous search ------------------------------------------------------------------------------
    let finalCrit = crit;
    if (ctx.lastUserCriteria && REFINE.test(q)) {
      finalCrit = mergeCriteria(ctx.lastUserCriteria, crit, q, ctx);
    }

    // ---- 9. search / recommend / rank ------------------------------------------------------------------------------
    if (hasCriteria(finalCrit) || searchWords) {
      if (!hasCriteria(finalCrit)) {
        // "tư vấn cho tôi một chiếc xe" — ask the 3 key questions, show a diverse shortlist
        const diverse = diverseShortlist(index.cars);
        return {
          text: `Để tư vấn chính xác, bạn cho tôi biết 3 điều nhé:\n1. **Ngân sách** (ví dụ: dưới 800 triệu, tầm 1,5 tỷ, hoặc trả góp ~15 triệu/tháng)\n2. **Số chỗ / ai đi cùng** (đi một mình, gia đình 5 hay 7 người)\n3. **Nhu cầu chính** (đi phố, đường dài, chạy dịch vụ, thể thao, sang trọng) và bạn thích **xe điện, xăng hay hybrid**\n\nTrong lúc đó, đây là vài mẫu tiêu biểu ở các tầm giá:\n${diverse.map(c => `• ${oneLine(c)}`).join('\n')}`,
          recommendation: diverse[0] ? card(diverse[0], 'GỢI Ý NHANH') : undefined
        };
      }
      const res = search(index, finalCrit, { intro: finalCrit !== crit ? `🔁 Tôi lọc lại dựa trên yêu cầu trước của bạn${describeCriteria(finalCrit) ? ` (**${describeCriteria(finalCrit)}**)` : ''}:\n` : '' });
      return { text: res.text, recommendation: res.recommendation };
    }

    // ---- 10. a car topic without car/criteria (e.g. "sạc bao lâu" after talking about a car not in catalog) --------
    if (/\b(sac|pin)\b/.test(q)) return { text: findTopic('thoi gian sac').text };

    return null;
  }

  return { answer, _internals: { buildIndex: () => getIndex(), findCars: (t) => findCars(getIndex(), t) } };
}

function mergeCriteria(prev, cur, q, ctx) {
  const m = { ...prev, usages: uniq([...(prev.usages || []), ...(cur.usages || [])]), excludeFuel: uniq([...(prev.excludeFuel || []), ...(cur.excludeFuel || [])]) };
  for (const k of ['maxPrice', 'minPrice', 'around', 'monthlyMax', 'seats', 'fuel', 'category', 'brand', 'brandLabel', 'minRange', 'minPower', 'inStock', 'sort']) {
    if (cur[k] !== undefined) m[k] = cur[k];
  }
  if (cur.fuel) m.excludeFuel = m.excludeFuel.filter(f => f !== cur.fuel);
  const ref = (ctx.lastList[0] || ctx.recentCars[0] || null);
  if (/\bre hon\b/.test(q) && cur.maxPrice === undefined) { m.maxPrice = ref && ref.price ? Math.round(ref.price * 0.95) : (m.maxPrice ? Math.round(m.maxPrice * 0.8) : undefined); m.around = undefined; m.minPrice = undefined; }
  if (/\bdat hon\b/.test(q) && cur.minPrice === undefined) { m.minPrice = ref && ref.price ? Math.round(ref.price * 1.05) : m.maxPrice; m.maxPrice = undefined; m.around = undefined; }
  if (/\bmanh hon\b/.test(q) && ref && ref.hp) m.minPower = ref.hp + 1;
  if (/\b(rong hon|nhieu cho hon)\b/.test(q) && ref && ref.seats) m.seats = ref.seats + 1;
  if (/\b(xa hon)\b/.test(q) && ref && ref.range) m.minRange = ref.range + 1;
  return m;
}

function diverseShortlist(cars) {
  const priced = cars.filter(c => c.price && c.price <= 1e10 && c.category !== 'Siêu Xe').sort(SORTERS['price-asc']);
  if (priced.length <= 4) return priced;
  const picks = [priced[0], priced[Math.floor(priced.length * 0.3)], priced[Math.floor(priced.length * 0.6)], priced[priced.length - 1]];
  return uniq(picks).filter(Boolean);
}

function capabilities(index) {
  return [
    `Tôi là **Sigma AI** – trợ lý ảo của SIGMA CAR, chạy ngay trên máy chủ (miễn phí, không cần API key) và đọc trực tiếp **${index.cars.length} mẫu xe** đang có trong showroom. Tôi có thể:`,
    '',
    '• 🔎 **Tìm & gợi ý xe** theo ngân sách, số chỗ, xe điện/xăng/hybrid, kiểu dáng, nhu cầu (gia đình, đi phố, đường dài, dịch vụ…)',
    '• 📊 **So sánh** 2–3 mẫu xe theo giá, công suất, tầm hoạt động, số chỗ, bảo hành',
    '• 📋 **Tra thông số**: giá, pin, sạc, 0-100 km/h, kích thước, màu, tồn kho…',
    '• 💳 **Tính trả góp** và 🧮 **chi phí nuôi xe** hằng tháng',
    '• 🔋 Giải thích kiến thức xe điện: pin LFP/NMC, sạc AC/DC, SoH, tầm hoạt động thực tế…',
    '• 🧭 Hướng dẫn **lái thử, đặt cọc, đổi trả, bảo hành** trên website',
    '',
    'Tôi nhớ ngữ cảnh cuộc trò chuyện, nên bạn có thể hỏi tiếp kiểu "*xe này sạc bao lâu?*", "*chiếc thứ 2 thì sao?*", "*rẻ hơn nữa*".'
  ].join('\n');
}

module.exports = { createBrain, _test: { buildIndex, findCars, parseCriteria, passes, maxPriceForMonthly, readContext } };
