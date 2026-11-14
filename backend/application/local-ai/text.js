// backend/application/local-ai/text.js
// Vietnamese text understanding for the local Sigma AI engine: accent-insensitive normalisation and extraction of
// money, budgets, seats, fuel, body type, usage, ranking requests, loan terms and daily distance.
// Pure functions, no I/O (cheap enough for the 10 ms Workers Free CPU budget).

'use strict';

/** lower-case, strip Vietnamese diacritics, đ → d */
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}

/** folded text with punctuation collapsed to spaces (keeps . , % / - inside numbers) */
function norm(s) {
  return fold(s)
    .replace(/[^a-z0-9.,%/\-\s]/g, ' ')
    .replace(/(\D)[.,](?=\s|$)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (q, re) => re.test(q);

/** "1,5" → 1.5, "1.500" (thousands) → 1500, "2.169.000.000" → 2169000000 */
function parseNumber(raw) {
  const s = String(raw);
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  return Number(s.replace(',', '.'));
}

/**
 * Money mentions in folded text, with their position.
 * Supports "1 ty", "1,5 ty", "1 ty 2" (=1.2 tỷ), "1 ty 250 trieu", "800 trieu", "800tr", "800 cu", "2.169.000.000 d".
 */
function extractMoney(q) {
  const out = [];
  const used = [];
  const overlaps = (a, b) => used.some(([x, y]) => a < y && b > x);
  const push = (value, start, end) => { if (Number.isFinite(value) && value > 0 && !overlaps(start, end)) { out.push({ value, start, end }); used.push([start, end]); } };

  const tyRe = /(\d+(?:[.,]\d+)?)\s*(?:ty|ti)\b(?:\s*(\d{1,3})\s*(trieu|tr|cu)\b|\s*(\d{1,3})\b(?!\s*(?:km|cho|hp|ma luc|nam|thang|%|kw|nguoi|xe|chiec)))?/g;
  let m;
  while ((m = tyRe.exec(q))) {
    let v = parseNumber(m[1]) * 1e9;
    if (m[2]) v += Number(m[2]) * 1e6;
    else if (m[4]) v += Number(`0.${m[4]}`) * 1e9;
    push(v, m.index, m.index + m[0].length);
  }
  const trRe = /(\d+(?:[.,]\d+)?)\s*(?:trieu|tr|cu)\b/g;
  while ((m = trRe.exec(q))) push(parseNumber(m[1]) * 1e6, m.index, m.index + m[0].length);
  const rawRe = /(\d{1,3}(?:[.,]\d{3}){2,})\s*(?:d|dong|vnd)?\b/g;
  while ((m = rawRe.exec(q))) push(parseNumber(m[1]), m.index, m.index + m[0].length);
  return out.sort((a, b) => a.start - b.start);
}

const MAX_WORDS = /(duoi|khong qua|khong vuot qua|toi da|it hon|nho hon|thap hon|re hon|tro xuong|chi co|co khoang|ngan sach|tam duoi|khong hon|budget|max)\s*$/;
const MIN_WORDS = /(tren|hon|it nhat|toi thieu|lon hon|cao hon|tu)\s*$/;
const AROUND_WORDS = /(khoang|tam|chung|quanh|xap xi|co tam|tam tam)\s*$/;
const MONTHLY_AFTER = /^\s*(\/\s*thang|moi thang|mot thang|1 thang|hang thang|thang)\b/;
const MONTHLY_BEFORE = /(moi thang|hang thang|tra gop|gop|thang tra|tra moi thang)\s*(?:khoang|tam|duoi|toi da|chi)?\s*$/;

/**
 * Budget from money mentions:
 *  { minPrice, maxPrice, monthlyMax, around }  (any may be undefined)
 */
function extractBudget(q) {
  const money = extractMoney(q);
  const res = {};
  if (!money.length) return res;

  // "từ A đến B", "A - B", "giữa A và B"
  if (money.length >= 2) {
    const [a, b] = money;
    const between = q.slice(a.end, b.start);
    const before = q.slice(Math.max(0, a.start - 12), a.start);
    if (/^\s*(den|toi|-|va|~)\s*$/.test(between) && (/(tu|giua|khoang)\s*$/.test(before) || /-|den|toi/.test(between))) {
      res.minPrice = Math.min(a.value, b.value);
      res.maxPrice = Math.max(a.value, b.value);
      return res;
    }
  }

  for (const mm of money) {
    const before = q.slice(Math.max(0, mm.start - 24), mm.start);
    const after = q.slice(mm.end, mm.end + 16);
    if (MONTHLY_AFTER.test(after) || MONTHLY_BEFORE.test(before)) { res.monthlyMax = mm.value; continue; }
    if (/^\s*(tro len|tro di|tro ra)/.test(after) || (MIN_WORDS.test(before) && !/(re hon|it hon|nho hon|thap hon|khong hon)\s*$/.test(before))) {
      if (!/tro xuong/.test(after)) { res.minPrice = mm.value; continue; }
    }
    if (AROUND_WORDS.test(before) && !MAX_WORDS.test(before)) {
      res.around = mm.value;
      res.minPrice = Math.round(mm.value * 0.8);
      res.maxPrice = Math.round(mm.value * 1.12);
      continue;
    }
    // "dưới X", "X trở xuống", or a bare amount the customer states as budget
    res.maxPrice = mm.value;
  }
  return res;
}

const WORD_NUMBERS = { hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9 };

function extractSeats(q) {
  let m = q.match(/(\d{1,2})\s*(?:cho|ghe|nguoi)\b/);
  if (m) return Number(m[1]);
  m = q.match(/\b(hai|ba|bon|nam|sau|bay|tam|chin)\s*cho\b/);
  if (m) return WORD_NUMBERS[m[1]];
  return undefined;
}

/** fuel wanted / excluded; uses the original (accented) lower-case text where folding is ambiguous */
function extractFuel(q, raw) {
  const r = String(raw || '').toLowerCase();
  const res = { want: undefined, exclude: [] };
  const neg = /(khong|ko|k|cha|khong phai|tranh|ngoai)\s*(muon|thich|can|dung|chon|lay|phai)?\s*(xe\s*)?/;
  const evRe = /(xe |thuần |chạy |ô tô |oto )điện|\bev\b|\bđiện\b(?! thoại| năng lượng mặt trời)|thuần điện|electric/;
  const gasRe = /xăng|động cơ đốt trong|máy xăng|diesel|dầu\b/;
  const hyRe = /hybrid|hy-brid|xe lai\b|lai điện|hev\b|phev/;
  const checkNeg = (re, kind) => {
    const idx = r.search(re);
    if (idx < 0) return false;
    const before = fold(r.slice(Math.max(0, idx - 22), idx));
    if (neg.test(before) && /(khong|ko|cha|tranh|ngoai)/.test(before)) { res.exclude.push(kind); return true; }
    return false;
  };
  const evNeg = checkNeg(evRe, 'ev');
  const gasNeg = checkNeg(gasRe, 'gas');
  const hyNeg = checkNeg(hyRe, 'hybrid');
  if (!hyNeg && hyRe.test(r)) res.want = 'hybrid';
  else if (!evNeg && evRe.test(r)) res.want = 'ev';
  else if (!gasNeg && gasRe.test(r)) res.want = 'gas';
  if (!res.want && has(q, /\b(xe dien|thuan dien|chay dien)\b/) && !evNeg) res.want = 'ev';
  return res;
}

const CATEGORY_PATTERNS = [
  ['SUV', /\b(suv|gam cao|crossover|cuv)\b/],
  ['Sedan', /\b(sedan|xe 4 cua|xe bon cua)\b/],
  ['Hatchback', /\b(hatchback|xe nho|co nho|xe do thi|mini|xe co nho)\b/],
  ['Pickup', /\b(ban tai|pickup|pick up|pick-up)\b/],
  ['Coupe', /\b(coupe|xe 2 cua|xe hai cua)\b/],
  ['Siêu Xe', /\b(sieu xe|hypercar|supercar|xe dua|sieu sang the thao)\b/]
];

function extractCategory(q) {
  for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(q)) return cat;
  return undefined;
}

const USAGE_PATTERNS = [
  ['family', /\b(gia dinh|vo con|bo me|nha dong|dong nguoi|ca nha|cho con|tre nho|em be)\b/],
  ['city', /\b(di pho|do thi|noi thanh|noi do|di lam|di cho|thanh pho|duong dong|ket xe|ngo nho|hem nho)\b/],
  ['longtrip', /\b(duong dai|di xa|di tinh|cao toc|phuot|du lich|ve que|xuyen viet|road trip)\b/],
  ['offroad', /\b(off ?road|dia hinh|duong xau|leo nui|loi nuoc|duong dat|vung nui)\b/],
  ['sport', /\b(the thao|toc do|tang toc|manh me|dam me|cam giac lai|boc|dua)\b/],
  ['luxury', /\b(sang trong|doanh nhan|dang cap|vip|hang sang|tiep khach|sang chanh)\b/],
  ['business', /\b(chay dich vu|grab|taxi|be\b|xanh sm|kinh doanh van tai|chay xe|cong nghe)\b/],
  ['firstcar', /\b(lan dau|xe dau tien|sinh vien|moi ra truong|moi di lam|tap lai|moi lay bang)\b/],
  ['eco', /\b(tiet kiem|it ton|chi phi thap|re nuoi|nuoi xe re|kinh te|tiet kiem nhien lieu)\b/]
];

function extractUsages(q) {
  return USAGE_PATTERNS.filter(([, re]) => re.test(q)).map(([u]) => u);
}

const SORT_PATTERNS = [
  ['price-asc', /\b(re nhat|gia thap nhat|thap nhat|mem nhat|it tien nhat|gia tot nhat|hop ly nhat|vua tui tien nhat)\b/],
  ['price-desc', /\b(dat nhat|dat tien nhat|gia cao nhat|mac nhat|xa xi nhat|dat do nhat)\b/],
  ['hp-desc', /\b(manh nhat|cong suat lon nhat|nhieu ma luc nhat|khoe nhat)\b/],
  ['accel-asc', /\b(nhanh nhat|tang toc nhanh nhat|boc nhat|0.100 nhanh nhat)\b/],
  ['range-desc', /\b(di xa nhat|tam hoat dong xa nhat|quang duong xa nhat|chay xa nhat|pin trau nhat)\b/],
  ['seats-desc', /\b(nhieu cho nhat|rong nhat|cho ngoi nhieu nhat)\b/],
  ['topspeed-desc', /\b(toc do toi da cao nhat|chay nhanh nhat|toc do cao nhat)\b/],
  ['year-desc', /\b(moi nhat|doi moi nhat|ra mat gan nhat)\b/]
];

function extractSort(q) {
  for (const [s, re] of SORT_PATTERNS) if (re.test(q)) return s;
  if (/\b(gia hop ly|gia mem|gia re|re thoi|khong qua dat|binh dan|vua tui tien)\b/.test(q)) return 'price-asc-soft';
  return undefined;
}

function extractMinRange(q) {
  const m = q.match(/(?:di|chay|tam hoat dong|quang duong|di duoc|it nhat|tren)\s*(?:duoc\s*)?(?:tren|it nhat|toi thieu)?\s*(\d{2,4})\s*km\b(?!\s*(?:\/|moi|mot)\s*(?:ngay|thang))/);
  return m ? Number(m[1]) : undefined;
}

function extractMinPower(q) {
  const m = q.match(/(?:tren|it nhat|toi thieu|tu)?\s*(\d{2,4})\s*(?:hp|ma luc|mã lực)\b/);
  return m ? Number(m[1]) : undefined;
}

function extractDailyKm(q) {
  let m = q.match(/(\d{1,4})\s*km\s*(?:\/|moi|mot|1)\s*ngay/);
  if (m) return Number(m[1]);
  m = q.match(/(?:moi ngay|hang ngay|mot ngay|1 ngay)\s*(?:di|chay)?\s*(?:khoang|tam|chung)?\s*(\d{1,4})\s*km/);
  if (m) return Number(m[1]);
  m = q.match(/(\d{2,5})\s*km\s*(?:\/|moi|mot|1)\s*thang/);
  if (m) return Math.round(Number(m[1]) / 30);
  return undefined;
}

/** loan terms: down payment %, term in months, annual rate % */
function extractLoanTerms(q) {
  const out = {};
  let m = q.match(/tra truoc\s*(?:khoang|tam)?\s*(\d{1,2}(?:[.,]\d+)?)\s*%/) || q.match(/(\d{1,2})\s*%\s*(?:tra truoc|von|doi ung)/);
  if (m) out.downPaymentPercent = parseNumber(m[1]);
  m = q.match(/(\d{1,2})\s*nam\b(?!\s*(?:cho|tuoi|san xuat))/);
  if (m && /(vay|gop|ky han|trong|tra|thoi han)/.test(q)) out.termMonths = Number(m[1]) * 12;
  m = q.match(/(\d{1,3})\s*thang\b/);
  if (m && /(vay|gop|ky han|trong|thoi han)/.test(q) && !out.termMonths && Number(m[1]) >= 6) out.termMonths = Number(m[1]);
  m = q.match(/lai(?: suat)?\s*(?:khoang|tam)?\s*(\d{1,2}(?:[.,]\d+)?)\s*%/);
  if (m) out.annualRate = parseNumber(m[1]);
  return out;
}

/** ordinal reference to a previously listed car: "chiếc thứ 2", "xe đầu tiên", "xe cuối" → 0-based index or 'last' */
function extractOrdinal(q) {
  let m = q.match(/(?:chiec|xe|mau|lua chon|so)\s*(?:thu|so)\s*(\d|hai|ba|bon|nam|nhat)\b/);
  if (m) return m[1] === 'nhat' ? 0 : (WORD_NUMBERS[m[1]] || Number(m[1])) - 1;
  if (/(chiec|xe|mau|lua chon)\s*(dau tien|dau|so 1)\b/.test(q)) return 0;
  if (/(chiec|xe|mau|lua chon)\s*(cuoi cung|cuoi)\b/.test(q)) return 'last';
  return undefined;
}

function formatMoneyShort(v) {
  if (!Number.isFinite(v) || v <= 0) return 'chưa công bố';
  if (v >= 1e9) {
    const ty = v / 1e9;
    return `${ty.toLocaleString('vi-VN', { maximumFractionDigits: ty >= 100 ? 0 : 2 })} tỷ`;
  }
  return `${Math.round(v / 1e6).toLocaleString('vi-VN')} triệu`;
}

const formatVnd = (v) => `${Math.round(Number(v) || 0).toLocaleString('vi-VN')} đ`;

module.exports = {
  fold, norm, has, parseNumber,
  extractMoney, extractBudget, extractSeats, extractFuel, extractCategory, extractUsages, extractSort,
  extractMinRange, extractMinPower, extractDailyKm, extractLoanTerms, extractOrdinal,
  formatMoneyShort, formatVnd
};
