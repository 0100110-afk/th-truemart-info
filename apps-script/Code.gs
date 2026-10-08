/**
 * TH TRUEMART — HỆ THỐNG QUẢN LÝ CỬA HÀNG / TÀI SẢN / SANAKY / BẢO DƯỠNG / ĐƠN GIÁ
 *
 * Bound Apps Script, đọc các sheet trong file hiện tại:
 *   DS CH        danh sách cửa hàng
 *   TAI SAN      tài sản theo cost center
 *   BAO DUONG    lịch sử bảo dưỡng
 *   CHI PHÍ      chi phí sự cố/sửa chữa (DAIKIN, PSMART, MINH HOÀNG, TD LIGHTING...)
 *   VAT TU       danh mục + tồn kho vật tư theo người giữ
 *   DON GIA BT   đơn giá Bảo trì   — đầu mục 1 cấp (I, II, III...)
 *   DON GIA XD   đơn giá Xây dựng  — đầu mục 2 cấp (I > 1, 2, 3...)
 *   DON GIA SNK  đơn giá Sanaky    — 1 cấp, có thêm gas/phụ phí
 *
 * Lịch sử sửa chữa Sanaky nằm ở MỘT FILE KHÁC — xem SANAKY_SPREADSHEET_ID.
 *
 * HAI QUY ƯỚC BẮT BUỘC NHỚ:
 *
 * 1. Đọc theo TÊN CỘT, không theo số thứ tự cột. Sheet đổi thứ tự cột thì code vẫn chạy;
 *    sheet đổi TIÊU ĐỀ cột thì sửa object COLS là đủ, không đụng phần còn lại.
 *
 * 2. Cột NGÀY đọc bằng getDisplayValues(), KHÔNG dùng Date object — Date object đi qua bước
 *    quy đổi múi giờ và làm lệch ngày 1 hôm.
 */

// ============================== CONFIG ==============================

const SHEET_STORES = 'DS CH';
const SHEET_ASSETS = 'TAI SAN';
const SHEET_MAINT  = 'BAO DUONG';
const SHEET_CHIPHI = 'CHI PHI';

const COLS = {
  // --- DS CH ---
  STORE_REGION: 'Miền',
  STORE_AREA: 'Khu vực',
  STORE_COST_CENTER: 'Cost center',
  STORE_ADDRESS: 'Địa chỉ',
  STORE_WARD: 'Xã/Phường',
  STORE_CITY: 'Thành Phố trực thuộc',
  STORE_TYPE: 'Loại cửa hàng',
  STORE_STATUS: 'Mở/đóng',
  STORE_SUPERVISOR: 'Giám sát',
  STORE_SUPERVISOR_MAIL: 'Mail Giám Sát',
  STORE_SUPERVISOR_PHONE: 'SĐTGS',
  STORE_ASM: 'ASM',
  STORE_ASM_MAIL: 'Mail ASM',
  STORE_ASM_PHONE: 'SĐT ASM',
  STORE_MANAGER: 'Cửa hàng trưởng',
  STORE_MANAGER_PHONE: 'Số điện thoại',
  STORE_EMAIL: 'Email cửa hàng',
  STORE_PHONE: 'Số điện thoại cửa hàng',
  STORE_OPEN_DAY: 'Ngày',
  STORE_OPEN_MONTH: 'Tháng',
  STORE_OPEN_YEAR: 'Năm',

  // --- TAI SAN ---
  ASSET_COST_CENTER: 'Cost center',
  ASSET_CODE: 'Mã tài sản',
  ASSET_NAME: 'Tên tài sản',
  ASSET_DATE: 'Ngày hoạt động',

  // --- BAO DUONG ---
  MAINT_ASSET_CODE: 'Code Tủ',
  MAINT_BRAND: 'Tên GSBH',
  MAINT_ADDRESS: 'Địa chỉ',
  MAINT_WARD: 'Phường',
  MAINT_CITY: 'TP/Tỉnh',
  MAINT_DATE: 'Ngày thực hiện',
  MAINT_TYPE: 'Loại Tủ',
  MAINT_SERVICE_CODE: 'Mã dịch vụ',
  MAINT_SUPPLIER: 'Nhà cung cấp',
  MAINT_DESC: 'Diễn giải',
  MAINT_COST: 'Chi phí',
  MAINT_NOTE: 'Ghi chú',

  // --- CHI PHÍ ---
  CP_COST_CENTER: 'Cost center',
  CP_STORE_NAME: 'Tên cửa hàng',
  CP_AREA: 'Khu vực',
  CP_ISSUE: 'Mô tả sự cố',
  CP_STAFF: 'NV phụ trách',
  CP_ITEM: 'Hạng mục/Vật tư',
  CP_ASSET_CODE: 'Mã thiết bị',
  CP_DATE: 'Ngày hoàn thành',
  CP_QTY: 'Số lượng',
  CP_COST: 'Tổng chi phí',
  CP_SUPPLIER: 'Nhà cung cấp',
  CP_ID: 'ID'            // cột ẩn cuối bảng CHI PHI, Sync.gs tự điền — định danh cố định của dòng
};

// ============================== WEB APP ENTRY ==============================

function doGet(e) {
  var ui = (e && e.parameter && e.parameter.ui) || '';
  var file = (ui === 'mobile') ? 'IndexMobile' : 'Index';
  // Favicon dùng chung với app Phiếu sửa chữa (đã deploy trên Vercel).
  // LƯU Ý: setFaviconUrl CHỈ có tác dụng khi mở thẳng URL /exec — khi nhúng
  // trong iframe (Sites, Data Studio...) trình duyệt lấy favicon của trang cha.
  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle('TH true mart · Hệ thống quản lý')
    .setFaviconUrl('https://th-truemart-repair-app.vercel.app/favicon-96.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================== LOW LEVEL SHEET ACCESS ==============================

function getSheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Không tìm thấy sheet "' + name + '". Kiểm tra lại tên sheet trong CONFIG.');
  return sh;
}

function sheetToObjects_(name, dateCols) {
  const sh = getSheet_(name);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return [];
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });

  let displayValues = null;
  const dateColIdx = {};
  if (dateCols && dateCols.length) {
    displayValues = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    headers.forEach(function (h, j) { if (dateCols.indexOf(h) > -1) dateColIdx[j] = true; });
  }

  const rows = values.slice(1);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isEmpty = r.every(function (c) { return c === '' || c === null; });
    if (isEmpty) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      obj[headers[j]] = (displayValues && dateColIdx[j]) ? displayValues[i + 1][j] : r[j];
    }
    obj.__row = i + 2;
    out.push(obj);
  }
  return out;
}

function stripAccents_(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function hasDiacritics_(str) {
  const s = String(str || '');
  return /[\u0300-\u036f]/.test(s.normalize('NFD')) || /đ|Đ/.test(s);
}

/** Các ký tự được coi là ranh giới từ trong địa chỉ / tên tiếng Việt */
const WORD_SEP_RE_ = /[\s,.;:\-\/()\[\]|_+]/;

/**
 * true nếu `needle` xuất hiện ở ĐẦU MỘT TỪ trong `hs` (cho phép khớp tiền tố: "hoa" khớp "hoang").
 * Cả hai tham số phải đã được chuẩn hoá (thường/bỏ dấu) trước khi gọi.
 */
function wordStartMatch_(hs, needle) {
  if (!needle) return true;
  let from = 0;
  for (;;) {
    const i = hs.indexOf(needle, from);
    if (i === -1) return false;
    if (i === 0 || WORD_SEP_RE_.test(hs.charAt(i - 1))) return true;
    from = i + 1;
  }
}

/**
 * So khớp tìm kiếm, bỏ dấu được.
 *
 * LỖI CŨ: đây là so khớp CHUỖI CON thuần, không biết ranh giới từ. Tìm "yen hoa" khớp luôn
 * "Nguyễn Hoàng" vì bỏ dấu ra "ngu[yen hoa]ng" -> kết quả tìm kiếm lẫn cửa hàng không liên quan.
 *
 * Nay tách truy vấn thành từng từ, MỖI TỪ phải khớp ở ĐẦU MỘT TỪ trong chuỗi đích:
 *   - "yen hoa" KHÔNG còn khớp "nguyen hoang" (yen nằm giữa từ)
 *   - "195 yen hoa" vẫn khớp "195 Yên Hòa, Phường Yên Hòa" như trước
 *   - "hoa" vẫn khớp "Hoàng" (khớp tiền tố ở đầu từ) — gõ dở vẫn ra kết quả
 *
 * NGOẠI LỆ cho từ toàn chữ số: mã cửa hàng / mã tài sản vẫn cho khớp giữa chuỗi, để gõ "0077"
 * vẫn tìm ra "303060077". Chữ số không gặp vấn đề âm tiết lồng nhau như tiếng Việt.
 */
function smartMatch_(haystack, query) {
  const q = String(query || '').trim();
  if (!q) return true;

  const withTone = hasDiacritics_(q);
  const hs = withTone ? String(haystack || '').toLowerCase() : stripAccents_(haystack);
  const qq = withTone ? q.toLowerCase() : stripAccents_(q);

  const tokens = qq.split(/\s+/).filter(function (t) { return t; });
  if (!tokens.length) return true;

  return tokens.every(function (t) {
    if (/^\d+$/.test(t)) return hs.indexOf(t) > -1;
    return wordStartMatch_(hs, t);
  });
}

function normalizeDate_(v) {
  if (v instanceof Date) {
    const tz = getSpreadsheetTimeZone_();
    return Utilities.formatDate(v, tz, 'dd/MM/yyyy');
  }
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return iso[3] + '/' + iso[2] + '/' + iso[1];
  }

  const vn = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (vn) {
    return pad2_(vn[1]) + '/' + pad2_(vn[2]) + '/' + vn[3];
  }

  return s;
}

var __ssTimeZoneCache_ = null;
function getSpreadsheetTimeZone_() {
  if (__ssTimeZoneCache_) return __ssTimeZoneCache_;
  try {
    __ssTimeZoneCache_ = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'GMT+7';
  } catch (e) {
    __ssTimeZoneCache_ = Session.getScriptTimeZone() || 'GMT+7';
  }
  return __ssTimeZoneCache_;
}

// ============================== CACHE (TĂNG TỐC ĐỘ TẢI) ==============================

/**
 * TTL cache tách theo mức độ biến động của dữ liệu.
 *
 * CACHE_TTL_FAST trước đây là 300 giây (5 phút). Với ứng dụng nội bộ lưu lượng thấp thì gần như
 * lượt truy cập nào cũng rơi vào cache đã hết hạn -> lần nào cũng phải đọc lại toàn bộ Google
 * Sheet, cache gần như vô tác dụng. Nay để 35 phút, CỐ Ý lớn hơn chu kỳ trigger 30 phút bên dưới
 * để trigger kịp nạp lại TRƯỚC KHI cache hết hạn.
 *
 * CACHE_TTL_SLOW (6 tiếng) dành cho Đơn giá — gần như không đổi. 21600 giây cũng chính là TRẦN
 * TỐI ĐA mà CacheService cho phép, không đặt cao hơn được.
 */
const CACHE_TTL_FAST = 2100;
const CACHE_TTL_SLOW = 21600;

/**
 * Kích thước mỗi mảnh khi cắt nhỏ giá trị cache.
 *
 * CacheService giới hạn 100KB MỖI KEY, tính theo BYTE chứ không phải ký tự. Chữ Việt có dấu nằm
 * ở dải U+1EA0–U+1EF9, trong UTF-8 tốn ĐÚNG 3 BYTE mỗi ký tự — mà địa chỉ cửa hàng và nội dung
 * công việc chính là loại dữ liệu app này lưu. Nên phải tính theo mức xấu nhất 3 byte/ký tự,
 * KHÔNG phải mức trung bình: 18.000 ký tự -> 54KB, còn biên 46%.
 *
 * Vượt trần thì putAll ném lỗi, bị try/catch nuốt im lặng, cache không ghi được lần nào mà không
 * có dấu hiệu nào báo ra ngoài — app vẫn chạy đúng, chỉ là chậm hẳn.
 */
const CACHE_CHUNK_SIZE = 18000;

function cacheGetJSON_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const metaRaw = cache.get(key + '__meta');
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);

    // Lấy tất cả chunk bằng MỘT lượt getAll thay vì gọi get() trong vòng lặp. Mỗi get() là một
    // lượt gọi dịch vụ riêng nên bản cũ tốn đúng n lượt cho n chunk.
    const keys = [];
    for (let i = 0; i < meta.n; i++) keys.push(key + '__' + i);
    const map = cache.getAll(keys);

    const parts = [];
    for (let i = 0; i < meta.n; i++) {
      const part = map[key + '__' + i];
      if (part === null || part === undefined) return null; // thiếu chunk -> coi như không có cache
      parts.push(part);
    }
    return JSON.parse(parts.join(''));
  } catch (e) {
    return null;
  }
}

function cacheSetJSON_(key, value, ttlSeconds) {
  try {
    const cache = CacheService.getScriptCache();
    const raw = JSON.stringify(value);
    const n = Math.max(1, Math.ceil(raw.length / CACHE_CHUNK_SIZE));
    const store = {};
    for (let i = 0; i < n; i++) {
      store[key + '__' + i] = raw.slice(i * CACHE_CHUNK_SIZE, (i + 1) * CACHE_CHUNK_SIZE);
    }
    store[key + '__meta'] = JSON.stringify({ n: n });
    cache.putAll(store, ttlSeconds);
    return true;
  } catch (e) {
    /* Hệ thống vẫn chạy đúng khi không ghi được cache, chỉ là chậm. NHƯNG bản cũ nuốt lỗi hoàn
       toàn nên khi chunk vượt trần 100KB thì cache chết im lặng suốt thời gian dài mà không ai
       biết. Nay ghi lại để getRefreshStatus() soi ra được. */
    Logger.log('cacheSetJSON_ THẤT BẠI cho key "' + key + '": ' + e.message);
    try {
      PropertiesService.getScriptProperties()
        .setProperty(PROP_CACHE_ERR, new Date().toISOString() + ' — ' + key + ': ' + e.message);
    } catch (e2) { /* bỏ qua */ }
    return false;
  }
}

function getCachedOrCompute_(key, ttlSeconds, computeFn, forceRefresh) {
  if (!forceRefresh) {
    const cached = cacheGetJSON_(key);
    if (cached !== null) return cached;
  }
  const value = computeFn();
  cacheSetJSON_(key, value, ttlSeconds);
  return value;
}

function getStoresCached_(forceRefresh) {
  return getCachedOrCompute_('stores_raw_v2', CACHE_TTL_FAST, function () {
    return sheetToObjects_(SHEET_STORES);
  }, forceRefresh);
}

function getAssetsCached_(forceRefresh) {
  return getCachedOrCompute_('assets_raw_v2', CACHE_TTL_FAST, function () {
    return sheetToObjects_(SHEET_ASSETS, [COLS.ASSET_DATE]);
  }, forceRefresh);
}

function getMaintCached_(forceRefresh) {
  return getCachedOrCompute_('maint_raw_v2', CACHE_TTL_FAST, function () {
    return sheetToObjects_(SHEET_MAINT, [COLS.MAINT_DATE]);
  }, forceRefresh);
}

/**
 * Chuẩn hoá số điện thoại Việt Nam.
 *
 * Bản cũ lọc bỏ mọi ký tự không phải chữ số rồi thêm "0" vào đầu nếu chưa có -> tiền tố quốc gia
 * bị hiểu nhầm thành một phần của số:
 *      "+84 912 345 678"  ->  "84912345678"  ->  "084912345678"   (SAI)
 * Nay bóc tiền tố (+84 / 0084 / 84) TRƯỚC khi xét.
 *
 * Nguyên tắc an toàn: không ra được số hợp lệ (10 hoặc 11 chữ số) thì TRẢ NGUYÊN CHUỖI GỐC. Thà
 * hiển thị đúng thứ người dùng đã nhập còn hơn bịa ra một số sai trông có vẻ hợp lệ. Điều này xử
 * lý luôn ô chứa 2 số ("0912345678 - 0987654321" -> 20 chữ số -> trả gốc).
 */
function formatPhone_(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';

  // Giữ lại dấu "+" để nhận diện tiền tố quốc tế, chỉ bỏ ký tự trang trí
  const cleaned = s.replace(/[\s.\-()]/g, '');
  const hasPlus = cleaned.charAt(0) === '+';
  let digits = hasPlus ? cleaned.substring(1) : cleaned;

  // Còn ký tự lạ (vd "/" ngăn 2 số, chữ "N/A"...) -> không đụng vào
  if (!/^\d+$/.test(digits)) return s;

  if (hasPlus && digits.indexOf('84') === 0) {
    digits = digits.substring(2);
  } else if (digits.indexOf('0084') === 0) {
    digits = digits.substring(4);
  } else if (digits.indexOf('84') === 0 && digits.length === 11) {
    // Chỉ cắt "84" trần khi tổng đúng 11 chữ số, để không cắt nhầm số nội địa bắt đầu bằng 84
    digits = digits.substring(2);
  }

  if (digits.charAt(0) !== '0') {
    /* Sheets hay làm rụng số 0 đầu khi ô lưu dạng SỐ. Hai ca hợp lệ:
         9 số            -> di động  ("912345678"  -> "0912345678")
         10 số, đầu là 2 -> cố định  ("2437917943" -> "02437917943")
       Sau quy hoạch 2017, MỌI mã vùng cố định VN đều bắt đầu bằng 2 và tổng luôn 11 chữ số kể cả
       số 0 đầu (024 + 8 số, 0296 + 7 số...). Di động rụng 0 chỉ còn 9 số, nên hai điều kiện không
       thể chồng lấn. Bản cũ thiếu nhánh thứ hai -> số cố định rơi vào `return s` và hiển thị
       thiếu hẳn số 0. */
    if (digits.length === 9) digits = '0' + digits;
    else if (digits.length === 10 && digits.charAt(0) === '2') digits = '0' + digits;
    else return s;
  }

  if (digits.length !== 10 && digits.length !== 11) return s;
  return digits;
}

function pad2_(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  return s.length === 1 ? '0' + s : s;
}

function extractYear_(v) {
  if (v instanceof Date) {
    const tz = getSpreadsheetTimeZone_();
    return Number(Utilities.formatDate(v, tz, 'yyyy'));
  }
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-\d{2}-\d{2}/);
  if (iso) return Number(iso[1]);
  const vn = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (vn) return Number(vn[3]);
  const y = s.match(/(\d{4})/);
  if (y) return Number(y[1]);
  return null;
}

/**
 * Chuẩn hoá mã cửa hàng (Cost center) để so khớp giữa các sheet khác nhau.
 *
 * Phải bỏ số 0 THỪA Ở ĐẦU: một sheet lưu "0025" dạng chữ, sheet khác lưu "25" dạng số vì Google
 * Sheets tự làm rụng số 0. Không xử lý thì các dòng lệch định dạng này không khớp cửa hàng nào
 * trong DS CH khi lọc theo Miền, nhưng vẫn được cộng vào "Toàn quốc" -> Toàn quốc > tổng các Miền.
 */
/**
 * KHOÁ XÁC ĐỊNH "MỘT LƯỢT SỬA CHỮA" — NGUỒN CHUẨN DUY NHẤT, dùng chung cho Dashboard và màn chi tiết.
 *
 * Trước đây mỗi bên tự dựng khoá riêng nên hai con số không bao giờ khớp:
 *   - Chi phí : Dashboard đếm TỪNG DÒNG sheet, còn mergeChiPhiRows_ gộp theo ngày+sự cố+nhân viên
 *               -> Dashboard đếm THỪA.
 *   - Sanaky  : Dashboard dùng cc+mã+ngày, còn mergeSanakyRepairs_ thêm cả ĐỊA CHỈ vào khoá.
 *               Địa chỉ là text gõ tay và đã được cc xác định rồi, nên chỉ cần gõ lệch một dấu
 *               phẩy là một lần sửa bị TÁCH ĐÔI -> màn chi tiết đếm THỪA.
 *
 * Vì sao chiPhiRepairKey_ phải có cost center trong khi mergeChiPhiRows_ trước đây không cần:
 * mergeChiPhiRows_ chỉ được gọi sau khi đã lọc về MỘT cửa hàng nên cc là hằng số. Nhưng Dashboard
 * đếm trên TOÀN BỘ cửa hàng — thiếu cc thì hai cửa hàng khác nhau cùng ngày, cùng nội dung sự cố,
 * cùng nhân viên sẽ bị gộp làm một.
 */
function chiPhiRepairKey_(costCenter, date, issue, staff) {
  return normalizeCC_(costCenter) + '||' + String(date || '').trim() +
         '||' + String(issue || '').trim() + '||' + String(staff || '').trim();
}

function sanakyRepairKey_(costCenter, assetCode, date) {
  return normalizeCC_(costCenter) + '||' + cleanCode_(assetCode) + '||' + String(date || '').trim();
}

function normalizeCC_(v) {
  let s = cleanCode_(v).toUpperCase();
  if (/^\d+$/.test(s)) {
    s = s.replace(/^0+(?=\d)/, '');
  }
  return s;
}

// ============================== DASHBOARD ==============================

const REGION_GROUP_LABELS = { MB: 'Miền Bắc', MT: 'Miền Trung', MN: 'Miền Nam' };
const REGION_GROUP_COLORS = { MB: '#2E9BE0', MT: '#E3A83B', MN: '#2C7A4B', KHAC: '#93A2AC' };

const STORE_TYPE_COLORS = {
  normal: '#2E90FA',
  flagship: '#7A2FA0',
  hero: '#F79009',
  cvshero: '#12B76A',
  cvs: '#2C7A4B',
  mini: '#5B8FA8',
  other: '#93A2AC'
};

function regionGroup_(region) {
  const raw = stripAccents_(region).toUpperCase().replace(/\s+/g, '');
  if (!raw) return 'KHAC';
  if (raw.indexOf('MB') === 0) return 'MB';
  if (raw.indexOf('MTR') === 0 || raw.indexOf('MT') === 0) return 'MT';
  if (raw.indexOf('MN') === 0) return 'MN';
  // Dự phòng: nhận diện thêm tên đầy đủ không dấu, vd "MIEN BAC"/"MIENBAC" (dùng cho cột
  // "Khu vực" của sheet CHI PHÍ, nơi giá trị thường ghi đầy đủ "Miền Bắc" thay vì viết tắt "MB").
  if (raw.indexOf('MIENBAC') === 0) return 'MB';
  if (raw.indexOf('MIENTRUNG') === 0) return 'MT';
  if (raw.indexOf('MIENNAM') === 0) return 'MN';
  return 'KHAC';
}

function regionGroupLabel_(region) {
  const g = regionGroup_(region);
  return REGION_GROUP_LABELS[g] || 'Khác';
}

/**
 * Bảng tra Miền theo 63 tỉnh/thành. Dùng bảng cố định thay vì suy từ DS CH vì DS CH ghi tên
 * NGẮN ("Hà Nội") còn BAO DUONG / Theo dõi SANAKY ghi ĐẦY ĐỦ ("Thành phố Hà Nội") — so khớp
 * trực tiếp không bao giờ trúng. Hàm chuẩn hoá bỏ tiền tố "Thành phố"/"Tỉnh"/"TP"/"T." để hai
 * cách ghi cùng quy về một khoá.
 */
const PROVINCE_REGION_TABLE_ = {
  MB: ['ha noi', 'hai phong', 'quang ninh', 'bac ninh', 'bac giang', 'hai duong', 'hung yen',
    'thai binh', 'nam dinh', 'ha nam', 'ninh binh', 'vinh phuc', 'phu tho', 'thai nguyen',
    'bac kan', 'bac can', 'cao bang', 'lang son', 'tuyen quang', 'ha giang', 'lao cai',
    'yen bai', 'dien bien', 'lai chau', 'son la', 'hoa binh'],
  MT: ['thanh hoa', 'nghe an', 'ha tinh', 'quang binh', 'quang tri', 'thua thien hue', 'hue',
    'da nang', 'quang nam', 'quang ngai', 'binh dinh', 'phu yen', 'khanh hoa', 'ninh thuan',
    'binh thuan', 'kon tum', 'gia lai', 'dak lak', 'dac lak', 'dak nong', 'dac nong', 'lam dong'],
  MN: ['ho chi minh', 'binh phuoc', 'tay ninh', 'binh duong', 'dong nai', 'ba ria vung tau',
    'long an', 'tien giang', 'ben tre', 'tra vinh', 'vinh long', 'dong thap', 'an giang',
    'kien giang', 'can tho', 'hau giang', 'soc trang', 'bac lieu', 'ca mau']
};

/** Bỏ các tiền tố hành chính ("Thành phố", "Tỉnh", "TP", "T.") trước khi so khớp tên Tỉnh/TP,
 * để "Thành phố Hà Nội" và "Hà Nội" đều quy về cùng 1 chuỗi chuẩn hoá "ha noi". */
function normalizeProvinceName_(text) {
  let s = stripAccents_(text);
  s = s.replace(/^(thanh pho|tp\.?|tinh|t\.)\s+/, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function provinceRegion_(provinceText) {
  const norm = normalizeProvinceName_(provinceText);
  if (!norm) return null;
  for (const g of ['MB', 'MT', 'MN']) {
    if (PROVINCE_REGION_TABLE_[g].indexOf(norm) > -1) return g;
  }
  // Dự phòng thêm: nếu không khớp chính xác (vd tên tỉnh có thêm số/ký tự lạ), thử so khớp
  // theo kiểu "chuỗi chứa" — 1 chiều, tên tỉnh trong bảng xuất hiện trong chuỗi đã chuẩn hoá.
  for (const g of ['MB', 'MT', 'MN']) {
    for (const p of PROVINCE_REGION_TABLE_[g]) {
      if (norm.indexOf(p) > -1) return g;
    }
  }
  return null;
}

/**
 * THÊM MỚI: các Cost center bắt đầu bằng số "5" là kho/LSC — theo quy ước nghiệp vụ,
 * mặc định thuộc Miền Bắc khi không xác định được Miền bằng cách nào khác.
 */
const LSC_DEFAULT_REGION_ = 'MB';
function isLscCC_(cc) {
  return String(cc || '').charAt(0) === '5';
}

/**
 * Suy Miền từ chuỗi ĐỊA CHỈ — dùng khi cột TP/Tỉnh trống hoặc ghi lạ. Hai chốt an toàn:
 *   (a) So khớp theo RANH GIỚI TỪ, tránh tên tỉnh ngắn lọt vào giữa từ khác.
 *   (b) Lấy tỉnh xuất hiện MUỘN NHẤT trong chuỗi — tên đường/phường hay trùng tên tỉnh khác
 *       ("Đường Bình Thuận, ... Tỉnh Tuyên Quang"), tỉnh thật luôn ở cuối địa chỉ.
 */
function regionFromAddress_(address) {
  const norm = ' ' + stripAccents_(address).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  if (norm.trim() === '') return null;
  let bestGroup = null, bestPos = -1;
  ['MB', 'MT', 'MN'].forEach(function (g) {
    PROVINCE_REGION_TABLE_[g].forEach(function (p) {
      const pos = norm.lastIndexOf(' ' + p + ' ');
      if (pos > bestPos) { bestPos = pos; bestGroup = g; }
    });
  });
  return bestGroup;
}

function storeTypeClass_(type) {
  const t = stripAccents_(type).replace(/\s+/g, '');
  if (t.indexOf('cvshero') > -1) return 'cvshero';
  if (t.indexOf('flagship') > -1) return 'flagship';
  if (t.indexOf('hero') > -1) return 'hero';
  if (t.indexOf('cvs') > -1) return 'cvs';
  if (t.indexOf('mini') > -1) return 'mini';
  if (t.indexOf('normal') > -1) return 'normal';
  return 'other';
}

function getDashboardData(forceRefresh, regionFilter, yearFilter) {
  if (forceRefresh) {
    getStoresCached_(true);
    getAssetsCached_(true);
    getMaintCached_(true);
    readSanakyRepairs_(true);
    getChiPhiCached_(true);
  }
  return computeDashboardData_(regionFilter, yearFilter);
}

function computeDashboardData_(regionFilter, yearFilter) {
  const yf = yearFilter ? Number(yearFilter) : null;

  let stores = getStoresCached_();
  if (regionFilter) {
    stores = stores.filter(function (s) { return regionGroup_(s[COLS.STORE_REGION]) === regionFilter; });
  }
  const allowedCC = new Set(stores.map(function (s) { return normalizeCC_(s[COLS.STORE_COST_CENTER]); }));
  const allowedAddrSet = new Set(stores.map(function (s) { return stripAccents_(s[COLS.STORE_ADDRESS]); }));

  // SỬA: đưa allKnownCCAll lên dùng chung cho cả Bảo dưỡng / Sanaky / Chi phí — là TOÀN BỘ
  // Cost center có trong DS CH (không lọc Miền), dùng để phân biệt "cửa hàng có thật nhưng
  // thuộc miền khác" (loại bỏ) với "cửa hàng/kho CHƯA đăng ký trong DS CH" (mồ côi — phải
  // suy luận Miền bằng chuỗi dự phòng thay vì loại thẳng).
  const allKnownCCAll = new Set(getStoresCached_().map(function (s) { return normalizeCC_(s[COLS.STORE_COST_CENTER]); }));

  let assets = getAssetsCached_();
  if (regionFilter) {
    assets = assets.filter(function (a) { return allowedCC.has(normalizeCC_(a[COLS.ASSET_COST_CENTER])); });
  }

  const allKnownAssetCodesAll = new Set(getAssetsCached_().map(function (a) { return String(a[COLS.ASSET_CODE]).trim(); }));

  let maint = getMaintCached_();
  if (regionFilter) {
    const allowedAssetCodes = new Set(assets.map(function (a) { return String(a[COLS.ASSET_CODE]).trim(); }));

    // SỬA: map Mã tài sản -> Cost center (toàn hệ thống, không lọc Miền) — để tra ngược
    // xem tài sản của 1 dòng bảo dưỡng thuộc cửa hàng nào.
    const ccByAssetCode = {};
    getAssetsCached_().forEach(function (a) {
      ccByAssetCode[String(a[COLS.ASSET_CODE]).trim()] = normalizeCC_(a[COLS.ASSET_COST_CENTER]);
    });

    maint = maint.filter(function (m) {
      const code = String(m[COLS.MAINT_ASSET_CODE]).trim();
      if (allowedAssetCodes.has(code)) return true;

      // SỬA LỖ HỔNG CHÍNH: trước đây dòng có mã tủ TỒN TẠI trong TAI SAN nhưng Cost center
      // của tài sản đó KHÔNG có trong DS CH (vd kho LSC 5030xxxxx) bị "return false" thẳng,
      // không được hưởng bước dự phòng nào -> mất khỏi bộ lọc Miền dù vẫn cộng vào Toàn quốc.
      if (allKnownAssetCodesAll.has(code)) {
        const cc = ccByAssetCode[code];
        if (allKnownCCAll.has(cc)) return false; // cửa hàng có thật, thuộc miền khác -> loại đúng
        if (isLscCC_(cc)) return regionFilter === LSC_DEFAULT_REGION_; // kho LSC -> mặc định MB
        // CC mồ côi khác -> rơi xuống chuỗi suy luận dự phòng bên dưới
      }

      // Chuỗi dự phòng: địa chỉ khớp DS CH -> cột TP/Tỉnh -> suy tỉnh từ chính chuỗi Địa chỉ.
      if (allowedAddrSet.has(stripAccents_(m[COLS.MAINT_ADDRESS]))) return true;
      const byCity = provinceRegion_(m[COLS.MAINT_CITY]);
      if (byCity) return byCity === regionFilter;
      const byAddr = regionFromAddress_(m[COLS.MAINT_ADDRESS]);
      if (byAddr) return byAddr === regionFilter;
      return false;
    });
  }

  let sanaky = readSanakyRepairs_();
  if (regionFilter) {
    sanaky = sanaky.filter(function (r) {
      const cc = normalizeCC_(r.costCenter);
      if (allowedCC.has(cc)) return true;
      if (allKnownCCAll.has(cc)) return false; // cửa hàng có thật, thuộc miền khác
      if (isLscCC_(cc)) return regionFilter === LSC_DEFAULT_REGION_; // kho LSC -> mặc định MB
      const byProv = provinceRegion_(r.province);
      if (byProv) return byProv === regionFilter;
      const byAddr = regionFromAddress_(r.address); // SỬA: thêm dự phòng suy tỉnh từ địa chỉ
      if (byAddr) return byAddr === regionFilter;
      return false;
    });
  }

  const totalStores = stores.length;
  const openStores = stores.filter(function (s) {
    return stripAccents_(s[COLS.STORE_STATUS]).indexOf('opn') === 0 || stripAccents_(s[COLS.STORE_STATUS]) === 'opnl';
  }).length;

  // C1: trước đây byRegion/byType được dựng theo THỨ TỰ DÒNG trong sheet, nên chỉ cần
  // sắp xếp lại "DS CH" là trục biểu đồ đổi theo (vd ra Miền Trung -> Miền Nam -> Miền Bắc).
  // Nay đếm vào map tạm rồi dựng lại theo thứ tự cố định.
  const regionCount = {};
  const typeCount = {};
  stores.forEach(function (s) {
    const region = regionGroupLabel_(s[COLS.STORE_REGION]);
    const type = s[COLS.STORE_TYPE] || 'Khác';
    regionCount[region] = (regionCount[region] || 0) + 1;
    typeCount[type] = (typeCount[type] || 0) + 1;
  });

  // Miền: luôn MB -> MT -> MN, nhóm lạ (nếu có) đẩy xuống cuối.
  const byRegion = {};
  ['MB', 'MT', 'MN'].forEach(function (g) {
    const label = REGION_GROUP_LABELS[g];
    if (regionCount[label] !== undefined) byRegion[label] = regionCount[label];
  });
  Object.keys(regionCount).forEach(function (label) {
    if (byRegion[label] === undefined) byRegion[label] = regionCount[label];
  });

  // Loại cửa hàng: sắp giảm dần theo số lượng để lát lớn nằm trước.
  const byType = {};
  Object.keys(typeCount)
    .sort(function (a, b) { return typeCount[b] - typeCount[a]; })
    .forEach(function (label) { byType[label] = typeCount[label]; });

  const regionColorMap = {};
  Object.keys(REGION_GROUP_LABELS).forEach(function (g) { regionColorMap[REGION_GROUP_LABELS[g]] = REGION_GROUP_COLORS[g]; });
  const byRegionColors = Object.keys(byRegion).map(function (label) { return regionColorMap[label] || REGION_GROUP_COLORS.KHAC; });

  const byTypeColors = Object.keys(byType).map(function (label) { return STORE_TYPE_COLORS[storeTypeClass_(label)] || STORE_TYPE_COLORS.other; });

  let maintCost = 0;
  let maintCount = 0;
  maint.forEach(function (m) {
    const y = extractYear_(m[COLS.MAINT_DATE]);
    if (yf && y !== yf) return;
    maintCost += Number(m[COLS.MAINT_COST]) || 0;
    maintCount += 1;
  });

  let sanakyCost = 0;
  let sanakyCount = 0;
  const sanakyRepairSet = new Set();
  sanaky.forEach(function (r) {
    const y = extractYear_(r.date);
    if (yf && y !== yf) return;
    sanakyCost += r.amount;
    sanakyRepairSet.add(sanakyRepairKey_(r.costCenter, r.assetCode, r.date));
  });
  sanakyCount = sanakyRepairSet.size;

    /**
   * Lọc CHI PHÍ theo Miền bằng BA điều kiện OR — chỉ dùng một điều kiện là thiếu:
   *   (a) cột "Khu vực" của chính dòng đó khớp Miền đang lọc. Đáng tin nhất vì nằm sẵn trên
   *       dòng dữ liệu, không phụ thuộc cửa hàng đã đăng ký trong DS CH hay chưa.
   *   (b) Cost center khớp một cửa hàng thuộc Miền đó trong DS CH — phòng khi (a) bị bỏ trống.
   *   (c) Cost center là kho LSC (mã đầu "5") chưa đăng ký trong DS CH và (a) cũng không nhận
   *       diện được -> mặc định Miền Bắc theo quy ước.
   *
   * Thiếu (a) và (c) thì các dòng có Cost center không tồn tại trong DS CH (kho tổng
   * "503000101", "303260001"...) bị loại khỏi mọi bộ lọc Miền, gây chênh "Toàn quốc" > "Miền Bắc".
   */
  let chiphi = getChiPhiCached_();
  if (regionFilter) {
    chiphi = chiphi.filter(function (r) {
      const areaG = regionGroup_(r[COLS.CP_AREA]);
      if (areaG === regionFilter) return true;
      const cc = normalizeCC_(r[COLS.CP_COST_CENTER]);
      if (allowedCC.has(cc)) return true;
      // Điều kiện (c): kho LSC chưa đăng ký, cột "Khu vực" cũng không nhận diện được.
      if (areaG === 'KHAC' && !allKnownCCAll.has(cc) && isLscCC_(cc)) {
        return regionFilter === LSC_DEFAULT_REGION_;
      }
      return false;
    });
  }
    /**
   * Tách "Chi phí sửa chữa" thành 2 thẻ theo đầu số Cost center: bắt đầu bằng "5" là kho/LSC,
   * còn lại là cửa hàng THS.
   */
    /* TIỀN cộng theo TỪNG DÒNG (đổi là sai tổng chi phí), nhưng SỐ LƯỢT đếm theo nhóm
     chiPhiRepairKey_ để khớp với mergeChiPhiRows_ ở màn chi tiết. Cost center nằm trong khoá nên
     mỗi nhóm thuộc đúng một cửa hàng -> phân loại THS/LSC không nhóm nào rơi vào cả hai xô. */
  let thsCost = 0, lscCost = 0;
  const thsSet = new Set(), lscSet = new Set();
  chiphi.forEach(function (r) {
    const y = extractYear_(r[COLS.CP_DATE]);
    if (yf && y !== yf) return;
    const cost = Number(r[COLS.CP_COST]) || 0;
    const cc = cleanCode_(r[COLS.CP_COST_CENTER]);
    const key = chiPhiRepairKey_(r[COLS.CP_COST_CENTER], normalizeDate_(r[COLS.CP_DATE]),
                                 r[COLS.CP_ISSUE], r[COLS.CP_STAFF]);
    if (cc.charAt(0) === '5') { lscCost += cost; lscSet.add(key); }
    else { thsCost += cost; thsSet.add(key); }
  });
  const thsCount = thsSet.size, lscCount = lscSet.size;

  const sources = [];
  maint.forEach(function (m) {
    sources.push({
      type: 'Bảo dưỡng',
      code: m[COLS.MAINT_ASSET_CODE],
      address: m[COLS.MAINT_ADDRESS],
      detail: m[COLS.MAINT_DESC],
      dateRaw: m[COLS.MAINT_DATE],
      date: normalizeDate_(m[COLS.MAINT_DATE]),
      supplier: m[COLS.MAINT_SUPPLIER],
      cost: Number(m[COLS.MAINT_COST]) || 0
    });
  });
  sanaky.forEach(function (r) {
    sources.push({
      type: 'Sanaky',
      code: r.assetCode,
      address: r.address,
      detail: r.repairItem,
      dateRaw: r.date,
      date: normalizeDate_(r.date),
      supplier: '',
      cost: r.amount
    });
  });
  const storeAddrByCC_ = {};
  stores.forEach(function (s) { storeAddrByCC_[normalizeCC_(s[COLS.STORE_COST_CENTER])] = s[COLS.STORE_ADDRESS]; });
  chiphi.forEach(function (r) {
    const cc = normalizeCC_(r[COLS.CP_COST_CENTER]);
    sources.push({
      type: chiPhiSupplierLabel_(r[COLS.CP_SUPPLIER]),
      code: r[COLS.CP_ASSET_CODE],
      address: storeAddrByCC_[cc] || r[COLS.CP_STORE_NAME] || '',
      detail: r[COLS.CP_ITEM],
      dateRaw: r[COLS.CP_DATE],
      date: normalizeDate_(r[COLS.CP_DATE]),
      supplier: r[COLS.CP_SUPPLIER],
      cost: Number(r[COLS.CP_COST]) || 0
    });
  });

  const recentCosts = sources
    .filter(function (s) { return s.dateRaw; })
    .sort(function (a, b) {
      const da = parseVnDate_(normalizeDate_(a.dateRaw));
      const db = parseVnDate_(normalizeDate_(b.dateRaw));
      return db - da;
    })
    /* Trả sẵn 300 dòng thay vì 10. Client render 10 dòng đầu rồi cuộn tới đâu nối thêm tới đó, nên
       KHÔNG phát sinh thêm lượt gọi server nào — đổi lại payload khối này to hơn ~30 lần. */
    .slice(0, 300)
    .map(function (s) {
      return { type: s.type, code: s.code, address: s.address, detail: s.detail, date: s.date, supplier: s.supplier, cost: s.cost };
    });

  return {
    totalStores: totalStores,
    openStores: openStores,
    totalAssets: assets.length,
    maintCost: maintCost,
    maintCount: maintCount,
    sanakyCost: sanakyCost,
    sanakyCount: sanakyCount,
    thsCost: thsCost,
    thsCount: thsCount,
    lscCost: lscCost,
    lscCount: lscCount,
    byRegion: byRegion,
    byRegionColors: byRegionColors,
    byType: byType,
    byTypeColors: byTypeColors,
    recentCosts: recentCosts
  };
}

// ============================== CỬA HÀNG ==============================

function searchStores(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const stores = getStoresCached_();

  /* HAI QUY TẮC KHỚP KHÁC NHAU, cố ý:
   *
   *  - MÃ CỬA HÀNG: chỉ khớp TOÀN BỘ, không khớp một phần. Gõ "0077" KHÔNG ra "303060077".
   *    Mã cửa hàng là định danh, khớp một phần chỉ tạo ra danh sách mơ hồ chứ không giúp được gì.
   *    So sánh qua normalizeCC_ nên "0025", "25" và " 25 " đều tìm ra cùng một cửa hàng — vẫn là
   *    khớp toàn bộ, chỉ bỏ qua số 0 thừa ở đầu cho thống nhất với phần còn lại của app.
   *
   *  - ĐỊA CHỈ / PHƯỜNG / TỈNH: khớp một phần theo ranh giới từ (smartMatch_). Bản cũ CHỈ tìm
   *    trong STORE_ADDRESS nên gõ tên phường hoặc tỉnh/TP không ra kết quả.
   *
   * Hai quy tắc này ĐỘC LẬP nhau: chuỗi toàn số không khớp mã cửa hàng nào vẫn được đem đi dò
   * địa chỉ như thường. Gõ "195" vẫn ra "195 Yên Hòa" — số nhà là một phần của địa chỉ.
   *
   * KHÔNG tìm theo người quản lý.
   */
  const qCC = normalizeCC_(raw);
  const scored = [];
  stores.forEach(function (s) {
    let score = -1;

    if (qCC && normalizeCC_(s[COLS.STORE_COST_CENTER]) === qCC) score = 0;   // mã: khớp TOÀN BỘ
    else if (smartMatch_(s[COLS.STORE_ADDRESS], raw)) score = 1;             // địa chỉ: một phần
    else if (smartMatch_([s[COLS.STORE_WARD], s[COLS.STORE_CITY]].join(' | '), raw)) score = 2;

    if (score >= 0) scored.push({ s: s, score: score });
  });

  // Khớp mã lên trước, rồi tới địa chỉ, cuối cùng là phường/tỉnh
  scored.sort(function (a, b) { return a.score - b.score; });

  return scored.slice(0, 60).map(function (x) {
    const s = x.s;
    return {
      costCenter: s[COLS.STORE_COST_CENTER],
      address: s[COLS.STORE_ADDRESS],
      ward: s[COLS.STORE_WARD],
      city: s[COLS.STORE_CITY],
      region: s[COLS.STORE_REGION],
      status: s[COLS.STORE_STATUS],
      type: s[COLS.STORE_TYPE],
      manager: s[COLS.STORE_MANAGER]
    };
  });
}

function getStoreDetail(costCenter) {
  const stores = getStoresCached_();
  /* MỤC 4: phải chuẩn hoá CẢ HAI VẾ. Bản cũ so chuỗi thô nên DS CH ghi "0025" còn nơi gọi truyền
     "25" là không tìm thấy, trong khi Dashboard vẫn tính đúng vì đã dùng normalizeCC_. */
  const ccNorm = normalizeCC_(costCenter);
  const found = stores.find(function (s) {
    return normalizeCC_(s[COLS.STORE_COST_CENTER]) === ccNorm;
  });
  if (!found) return null;
  return {
    costCenter: found[COLS.STORE_COST_CENTER],
    region: found[COLS.STORE_REGION],
    area: found[COLS.STORE_AREA],
    address: found[COLS.STORE_ADDRESS],
    ward: found[COLS.STORE_WARD],
    city: found[COLS.STORE_CITY],
    type: found[COLS.STORE_TYPE],
    status: found[COLS.STORE_STATUS],
    supervisor: found[COLS.STORE_SUPERVISOR],
    supervisorMail: found[COLS.STORE_SUPERVISOR_MAIL],
    supervisorPhone: formatPhone_(found[COLS.STORE_SUPERVISOR_PHONE]),
    asm: found[COLS.STORE_ASM],
    asmMail: found[COLS.STORE_ASM_MAIL],
    asmPhone: formatPhone_(found[COLS.STORE_ASM_PHONE]),
    manager: found[COLS.STORE_MANAGER],
    managerPhone: formatPhone_(found[COLS.STORE_MANAGER_PHONE]),
    email: found[COLS.STORE_EMAIL],
    phone: formatPhone_(found[COLS.STORE_PHONE]),
    openDay: found[COLS.STORE_OPEN_DAY],
    openMonth: found[COLS.STORE_OPEN_MONTH],
    openYear: found[COLS.STORE_OPEN_YEAR],
    openDate: (found[COLS.STORE_OPEN_DAY] && found[COLS.STORE_OPEN_MONTH] && found[COLS.STORE_OPEN_YEAR])
      ? (pad2_(found[COLS.STORE_OPEN_DAY]) + '/' + pad2_(found[COLS.STORE_OPEN_MONTH]) + '/' + found[COLS.STORE_OPEN_YEAR])
      : ''
  };
}

// ============================== TÀI SẢN ==============================

function searchAssetByCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return [];
  const assets = getAssetsCached_();
  const matches = assets.filter(function (a) {
    return smartMatch_(a[COLS.ASSET_CODE], raw);
  }).slice(0, 60);

  return matches.map(function (a) {
    const store = getStoreDetail(a[COLS.ASSET_COST_CENTER]);
    return {
      assetCode: a[COLS.ASSET_CODE],
      assetName: a[COLS.ASSET_NAME],
      costCenter: a[COLS.ASSET_COST_CENTER],
      activeDate: normalizeDate_(a[COLS.ASSET_DATE]),
      store: store
    };
  });
}

function getAssetsByStore(costCenter) {
  const assets = getAssetsCached_();
  const ccNorm = normalizeCC_(costCenter); // MỤC 4: DS CH "0025" vs TAI SAN "25"
  return assets
    .filter(function (a) {
      return normalizeCC_(a[COLS.ASSET_COST_CENTER]) === ccNorm;
    })
    .map(function (a) {
      return {
        assetCode: a[COLS.ASSET_CODE],
        assetName: a[COLS.ASSET_NAME],
        activeDate: normalizeDate_(a[COLS.ASSET_DATE])
      };
    });
}

// ============================== BẢO DƯỠNG ==============================

function getMaintenanceList(opts) {
  opts = opts || {};
  const q = String(opts.query || '').trim();
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Number(opts.pageSize) || 20;

  let rows = getMaintCached_();

  if (q) {
    rows = rows.filter(function (m) {
      const haystack = [
        m[COLS.MAINT_ASSET_CODE],
        m[COLS.MAINT_ADDRESS],
        m[COLS.MAINT_WARD],
        m[COLS.MAINT_CITY],
        m[COLS.MAINT_SUPPLIER],
        m[COLS.MAINT_TYPE],
        m[COLS.MAINT_SERVICE_CODE]
      ].join(' | ');
      return smartMatch_(haystack, q);
    });
  }

  rows = rows.slice().sort(function (a, b) {
    return parseVnDate_(normalizeDate_(b[COLS.MAINT_DATE])) - parseVnDate_(normalizeDate_(a[COLS.MAINT_DATE]));
  });

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize).map(function (m) {
    return {
      row: m.__row,
      assetCode: m[COLS.MAINT_ASSET_CODE],
      address: m[COLS.MAINT_ADDRESS],
      ward: m[COLS.MAINT_WARD],
      city: m[COLS.MAINT_CITY],
      date: normalizeDate_(m[COLS.MAINT_DATE]),
      type: m[COLS.MAINT_TYPE],
      serviceCode: m[COLS.MAINT_SERVICE_CODE],
      supplier: m[COLS.MAINT_SUPPLIER],
      desc: m[COLS.MAINT_DESC],
      cost: Number(m[COLS.MAINT_COST]) || 0,
      note: m[COLS.MAINT_NOTE]
    };
  });

  return { rows: pageRows, total: total, page: page, pageSize: pageSize };
}

function getMaintenanceByStore(costCenter) {
  const cc = normalizeCC_(costCenter); // MỤC 4
  const assets = getAssetsCached_();
  const assetCodesOfStore = assets
    .filter(function (a) { return normalizeCC_(a[COLS.ASSET_COST_CENTER]) === cc; })
    .map(function (a) { return String(a[COLS.ASSET_CODE]).trim(); });

  const allKnownAssetCodes = new Set(assets.map(function (a) { return String(a[COLS.ASSET_CODE]).trim(); }));
  const store = getStoreDetail(cc);
  const storeAddrNorm = store ? stripAccents_(store.address) : '';

  const maint = getMaintCached_();
  return maint
    .filter(function (m) {
      const code = String(m[COLS.MAINT_ASSET_CODE]).trim();
      if (assetCodesOfStore.indexOf(code) > -1) return true;
      if (!allKnownAssetCodes.has(code) && storeAddrNorm) {
        return stripAccents_(m[COLS.MAINT_ADDRESS]) === storeAddrNorm;
      }
      return false;
    })
    .sort(function (a, b) {
      return parseVnDate_(normalizeDate_(b[COLS.MAINT_DATE])) - parseVnDate_(normalizeDate_(a[COLS.MAINT_DATE]));
    })
    .map(function (m) {
      return {
        assetCode: m[COLS.MAINT_ASSET_CODE],
        date: normalizeDate_(m[COLS.MAINT_DATE]),
        type: m[COLS.MAINT_TYPE],
        serviceCode: m[COLS.MAINT_SERVICE_CODE],
        supplier: m[COLS.MAINT_SUPPLIER],
        desc: m[COLS.MAINT_DESC],
        cost: Number(m[COLS.MAINT_COST]) || 0,
        note: m[COLS.MAINT_NOTE]
      };
    });
}

function getMaintenanceByAsset(assetCode) {
  const code = String(assetCode || '').trim();
  const maint = getMaintCached_();
  return maint
    .filter(function (m) { return String(m[COLS.MAINT_ASSET_CODE]).trim() === code; })
    .sort(function (a, b) {
      return parseVnDate_(normalizeDate_(b[COLS.MAINT_DATE])) - parseVnDate_(normalizeDate_(a[COLS.MAINT_DATE]));
    })
    .map(function (m) {
      return {
        date: normalizeDate_(m[COLS.MAINT_DATE]),
        type: m[COLS.MAINT_TYPE],
        serviceCode: m[COLS.MAINT_SERVICE_CODE],
        supplier: m[COLS.MAINT_SUPPLIER],
        desc: m[COLS.MAINT_DESC],
        cost: Number(m[COLS.MAINT_COST]) || 0,
        note: m[COLS.MAINT_NOTE]
      };
    });
}

function quarterFromNote_(note) {
  const s = stripAccents_(note).toUpperCase();
  if (!s) return null;
  const roman = s.match(/QUY\s*(IV|III|II|I)\b/);
  if (roman) {
    const map = { I: 1, II: 2, III: 3, IV: 4 };
    if (map[roman[1]]) return map[roman[1]];
  }
  const q = s.match(/\bQ\s*([1-4])\b/);
  if (q) return Number(q[1]);
  return null;
}

const MAINT_CHART_TOP_SUPPLIERS = 5;

function getMaintenanceQuarterlyStats() {
  const maint = getMaintCached_();
  const quarterMap = {};
  const supplierCostTotals = {};

  maint.forEach(function (m) {
    const y = extractYear_(m[COLS.MAINT_DATE]);
    if (!y) return;

    let q = quarterFromNote_(m[COLS.MAINT_NOTE]);
    if (!q) {
      const norm = normalizeDate_(m[COLS.MAINT_DATE]);
      const parts = norm.split('/');
      const month = parts.length === 3 ? Number(parts[1]) : null;
      if (!month) return;
      q = Math.ceil(month / 3);
    }

    const key = y + '-Q' + q;
    const supplier = String(m[COLS.MAINT_SUPPLIER] || 'Không rõ').trim() || 'Không rõ';
    const cost = Number(m[COLS.MAINT_COST]) || 0;

    if (!quarterMap[key]) quarterMap[key] = { year: y, quarter: q, totalCost: 0, totalCount: 0, bySupplierCost: {}, bySupplierCount: {} };
    quarterMap[key].totalCost += cost;
    quarterMap[key].totalCount += 1;
    quarterMap[key].bySupplierCost[supplier] = (quarterMap[key].bySupplierCost[supplier] || 0) + cost;
    quarterMap[key].bySupplierCount[supplier] = (quarterMap[key].bySupplierCount[supplier] || 0) + 1;

    supplierCostTotals[supplier] = (supplierCostTotals[supplier] || 0) + cost;
  });

  const quarterKeys = Object.keys(quarterMap).sort(function (a, b) {
    const qa = quarterMap[a], qb = quarterMap[b];
    return (qa.year - qb.year) || (qa.quarter - qb.quarter);
  });

  const topSuppliers = Object.keys(supplierCostTotals)
    .sort(function (a, b) { return supplierCostTotals[b] - supplierCostTotals[a]; })
    .slice(0, MAINT_CHART_TOP_SUPPLIERS);
  const hasOthers = Object.keys(supplierCostTotals).length > topSuppliers.length;

  const labels = quarterKeys.map(function (k) { return 'Q' + quarterMap[k].quarter + '/' + quarterMap[k].year; });
  const totalCost = quarterKeys.map(function (k) { return quarterMap[k].totalCost; });
  const totalCount = quarterKeys.map(function (k) { return quarterMap[k].totalCount; });

  function buildSeries_(field) {
    const series = topSuppliers.map(function (name) {
      return { name: name, data: quarterKeys.map(function (k) { return quarterMap[k][field][name] || 0; }) };
    });
    if (hasOthers) {
      series.push({
        name: 'NCC khác',
        data: quarterKeys.map(function (k) {
          let sum = 0;
          Object.keys(quarterMap[k][field]).forEach(function (name) {
            if (topSuppliers.indexOf(name) === -1) sum += quarterMap[k][field][name];
          });
          return sum;
        })
      });
    }
    return series;
  }

  return {
    labels: labels,
    totalCost: totalCost,
    totalCount: totalCount,
    costSeries: buildSeries_('bySupplierCost'),
    countSeries: buildSeries_('bySupplierCount')
  };
}

// ============================== CHI PHÍ (SHEET "CHI PHÍ" TRONG CÙNG FILE) ==============================

function getChiPhiCached_(forceRefresh) {
  return getCachedOrCompute_('chiphi_raw_v2', CACHE_TTL_FAST, function () {
    return sheetToObjects_(SHEET_CHIPHI, [COLS.CP_DATE]);
  }, forceRefresh);
}

/**
 * PHẠM VI VẬT TƯ: chỉ NCC được đánh dấu "Trừ kho vật tư" trong sheet NCC THEO DÕI (mặc định TD
 * LIGHTING). Mọi thống kê và thao tác trừ kho phải lọc qua isVatTuRow_ trước.
 *
 * Bỏ lọc là trừ nhầm kho: một dòng PSMART ghi "Thay bóng đèn pha" sẽ khớp vật tư "Bóng đèn pha".
 */

/** Dòng CHI PHÍ có thuộc diện trừ kho vật tư không: NCC của dòng khớp một tab được đánh dấu
 *  "Trừ kho vật tư" trong sheet NCC THEO DÕI, và (nếu tab có "Trừ kho từ ngày") ngày hoàn thành
 *  không sớm hơn ngày đó. Sheet chưa có cột này -> chỉ TD LIGHTING, như trước. */
function isVatTuRow_(r) {
  const t = nccTabOf_(r[COLS.CP_SUPPLIER]);
  if (!t || !t.vattu) return false;
  if (!t.vattuFrom) return true;
  const d = parseVnDate_(normalizeDate_(r[COLS.CP_DATE]));
  const time = d && d.getTime ? d.getTime() : 0;
  return !!time && time >= t.vattuFrom;
}

/** Chuẩn hoá tên NCC để so khớp: bỏ dấu, viết hoa, bỏ mọi khoảng trắng. */
function supplierKey_(s) {
  return stripAccents_(String(s || '')).toUpperCase().replace(/\s+/g, '');
}

// ===== Tab NCC trong "Theo dõi chi phí sửa chữa" — cấu hình ở sheet NCC THEO DÕI =====
// Mỗi dòng: Tên tab | Nhận diện (không bắt buộc, nhiều từ cách nhau dấu phẩy). Dòng CHI PHÍ có
// cột "Nhà cung cấp" CHỨA một trong các từ nhận diện (không phân biệt hoa thường, dấu, khoảng
// trắng) thì vào tab đó; xét theo thứ tự dòng, không khớp tab nào -> "Khác".
// Sheet chưa có hoặc trống -> dùng 4 tab mặc định như trước.
const SHEET_NCC_TABS = 'NCC THEO DÕI';
const NCC_TABS_DEFAULT_ = ['DAIKIN', 'PSMART', 'Minh Hoàng', 'TD LIGHTING'];

function nccYes_(v) {
  return ['CO', 'X', 'TRUE', '1', 'YES', 'V'].indexOf(supplierKey_(v)) > -1;
}

function buildNccTabs_(names) {
  const seen = {};
  const tabs = [];
  names.forEach(function (n) {
    const label = String(n.label || '').trim();
    if (!label) return;
    const key = supplierKey_(label);
    if (!key || key === 'KHAC' || seen[key]) return;
    seen[key] = true;
    const words = String(n.match || '').split(/[,;\n]/).map(supplierKey_).filter(function (w) { return w; });
    let from = 0;
    if (n.vattuFrom) {
      const d = parseVnDate_(normalizeDate_(n.vattuFrom));
      from = d && d.getTime ? (d.getTime() || 0) : 0;
    }
    tabs.push({ key: key, label: label, words: words.length ? words : [key],
                vattu: n.vattu === undefined ? key === 'TDLIGHTING' : nccYes_(n.vattu), vattuFrom: from });
  });
  return tabs;
}

function readNccTabs_() {
  let rows = [];
  try { rows = sheetToObjects_(SHEET_NCC_TABS); } catch (e) { rows = []; }
  // Sheet cũ chưa có cột "Trừ kho vật tư" -> vattu undefined -> mặc định chỉ TD LIGHTING.
  const hasVattuCol = (rows || []).some(function (r) { return Object.prototype.hasOwnProperty.call(r, 'Trừ kho vật tư'); });
  const names = (rows || []).map(function (r) {
    return { label: r['Tên tab'], match: r['Nhận diện'],
             vattu: hasVattuCol ? r['Trừ kho vật tư'] : undefined, vattuFrom: r['Trừ kho từ ngày'] };
  });
  const tabs = buildNccTabs_(names);
  return tabs.length ? tabs : buildNccTabs_(NCC_TABS_DEFAULT_.map(function (l) { return { label: l }; }));
}

function getNccTabs_() {
  return getCachedOrCompute_('ncctabs_v1', CACHE_TTL_FAST, readNccTabs_);
}

/** Tab NCC mà tên nhà cung cấp khớp (theo thứ tự cấu hình), null nếu không khớp tab nào. */
function nccTabOf_(supplier) {
  const s = supplierKey_(supplier);
  if (!s) return null;
  const tabs = getNccTabs_();
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    for (let j = 0; j < t.words.length; j++) if (s.indexOf(t.words[j]) > -1) return t;
  }
  return null;
}

function chiPhiSupplierGroup_(supplier) {
  const t = nccTabOf_(supplier);
  return t ? t.key : 'khac';
}

function chiPhiSupplierLabel_(supplier) {
  const t = nccTabOf_(supplier);
  return t ? t.label : 'Khác';
}

function mapChiPhiRow_(r) {
  return {
    costCenter: r[COLS.CP_COST_CENTER], // cần cho chiPhiRepairKey_
    item: r[COLS.CP_ITEM],
    assetCode: r[COLS.CP_ASSET_CODE],
    issue: r[COLS.CP_ISSUE],
    staff: r[COLS.CP_STAFF],
    date: normalizeDate_(r[COLS.CP_DATE]),
    dateRaw: r[COLS.CP_DATE],
    qty: Number(r[COLS.CP_QTY]) || 0,
    cost: Number(r[COLS.CP_COST]) || 0,
    supplier: r[COLS.CP_SUPPLIER] || ''
  };
}

function mergeChiPhiRows_(rows) {
  const map = {};
  const order = [];
  rows.forEach(function (r) {
    const key = chiPhiRepairKey_(r.costCenter, r.date, r.issue, r.staff);
    if (!map[key]) {
      map[key] = { date: r.date, issue: r.issue, staff: r.staff, supplier: r.supplier, items: [], totalCost: 0 };
      order.push(key);
    }
    map[key].items.push({ item: r.item, assetCode: r.assetCode, qty: r.qty, cost: r.cost });
    map[key].totalCost += r.cost;
    if (r.supplier && !map[key].supplier) map[key].supplier = r.supplier;
  });
  return order.map(function (k) { return map[k]; });
}

function getChiPhiByStore(costCenter, group) {
  const cc = normalizeCC_(costCenter);
  let rows = getChiPhiCached_().filter(function (r) { return normalizeCC_(r[COLS.CP_COST_CENTER]) === cc; });
  if (group) rows = rows.filter(function (r) { return chiPhiSupplierGroup_(r[COLS.CP_SUPPLIER]) === group; });
  const mapped = rows.map(mapChiPhiRow_).sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });
  const merged = mergeChiPhiRows_(mapped);
  const totalCost = mapped.reduce(function (s, r) { return s + r.cost; }, 0);
  return { rows: merged, totalCost: totalCost, totalCount: merged.length };
}

function getChiPhiByAsset(assetCode, group) {
  const code = cleanCode_(assetCode);
  let rows = getChiPhiCached_().filter(function (r) { return cleanCode_(r[COLS.CP_ASSET_CODE]) === code; });
  if (group) rows = rows.filter(function (r) { return chiPhiSupplierGroup_(r[COLS.CP_SUPPLIER]) === group; });
  const mapped = rows.map(mapChiPhiRow_).sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });
  const merged = mergeChiPhiRows_(mapped);
  const totalCost = mapped.reduce(function (s, r) { return s + r.cost; }, 0);
  return { rows: merged, totalCost: totalCost, totalCount: merged.length };
}

// ============================== CHI PHÍ THS / LSC ==============================
// Hai trang riêng cho "Chi phí sửa chữa THS" (cửa hàng) và "Chi phí sửa chữa LSC" (kho — Cost
// center bắt đầu bằng "5"). Cùng cách chia, cùng cách lọc Miền và cùng cách đếm lượt với 2 thẻ
// trên Tổng quan, nên số tổng ở hai nơi luôn khớp nhau.

function chiPhiKindOf_(costCenter) {
  return cleanCode_(costCenter).charAt(0) === '5' ? 'lsc' : 'ths';
}

/** Lọc CHI PHÍ theo Miền — đúng 3 điều kiện OR như computeDashboardData_. */
function filterChiPhiByRegion_(rows, regionFilter) {
  if (!regionFilter) return rows;
  const allowedCC = new Set(getStoresCached_()
    .filter(function (s) { return regionGroup_(s[COLS.STORE_REGION]) === regionFilter; })
    .map(function (s) { return normalizeCC_(s[COLS.STORE_COST_CENTER]); }));
  const allKnownCCAll = new Set(getStoresCached_().map(function (s) { return normalizeCC_(s[COLS.STORE_COST_CENTER]); }));
  return rows.filter(function (r) {
    const areaG = regionGroup_(r[COLS.CP_AREA]);
    if (areaG === regionFilter) return true;
    const cc = normalizeCC_(r[COLS.CP_COST_CENTER]);
    if (allowedCC.has(cc)) return true;
    if (areaG === 'KHAC' && !allKnownCCAll.has(cc) && isLscCC_(cc)) return regionFilter === LSC_DEFAULT_REGION_;
    return false;
  });
}

function chiPhiKindRows_(kind) {
  return getChiPhiCached_().filter(function (r) { return chiPhiKindOf_(r[COLS.CP_COST_CENTER]) === kind; });
}

/** Các tháng có dữ liệu ("yyyy-mm", mới nhất trước) — dùng cho ô chọn Năm / Tháng. */
function getChiPhiKindMonthsAvailable(kind) {
  const set = {};
  chiPhiKindRows_(kind).forEach(function (r) {
    const key = sanakyMonthKey_(normalizeDate_(r[COLS.CP_DATE]));
    if (key) set[key] = true;
  });
  return Object.keys(set).sort().reverse();
}

/** Tên tab NCC đúng thứ tự cấu hình + "Khác" — dùng cho ô chọn Nhà cung cấp. */
function getChiPhiSupplierOptions() {
  return getNccTabs_().map(function (t) { return t.label; }).concat(['Khác']);
}

function chiPhiKindFiltered_(opts) {
  const kind = opts.kind === 'lsc' ? 'lsc' : 'ths';
  const year = String(opts.year || '').trim();
  const month = String(opts.month || '').trim();
  const supplier = String(opts.supplier || '').trim();
  let rows = filterChiPhiByRegion_(chiPhiKindRows_(kind), String(opts.region || '').trim());
  if (year) rows = rows.filter(function (r) { return extractYear_(r[COLS.CP_DATE]) === Number(year); });
  if (month) {
    const mm = pad2_(month);
    rows = rows.filter(function (r) {
      const k = sanakyMonthKey_(normalizeDate_(r[COLS.CP_DATE]));
      return k && k.split('-')[1] === mm;
    });
  }
  if (supplier) rows = rows.filter(function (r) { return chiPhiSupplierLabel_(r[COLS.CP_SUPPLIER]) === supplier; });
  return rows;
}

/** Danh sách dòng CHI PHÍ của trang THS / LSC — mỗi dòng sheet một hàng, đúng các cột của sheet,
 *  mới nhất trước, có phân trang. pageSize = 0 -> trả hết (dùng cho Xuất Excel). */
function getChiPhiKindRows(opts) {
  opts = opts || {};
  const q = String(opts.query || '').trim();
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = opts.pageSize === 0 ? 0 : (Number(opts.pageSize) || 50);
  let rows = chiPhiKindFiltered_(opts).map(function (r) {
    return {
      costCenter: cleanCode_(r[COLS.CP_COST_CENTER]),
      storeName: String(r[COLS.CP_STORE_NAME] || ''),
      area: String(r[COLS.CP_AREA] || ''),
      issue: String(r[COLS.CP_ISSUE] || ''),
      staff: String(r[COLS.CP_STAFF] || ''),
      item: String(r[COLS.CP_ITEM] || ''),
      assetCode: cleanCode_(r[COLS.CP_ASSET_CODE]),
      date: normalizeDate_(r[COLS.CP_DATE]),
      qty: Number(r[COLS.CP_QTY]) || 0,
      cost: Number(r[COLS.CP_COST]) || 0,
      supplier: String(r[COLS.CP_SUPPLIER] || '')
    };
  });
  if (q) {
    rows = rows.filter(function (m) {
      return smartMatch_([m.costCenter, m.storeName, m.issue, m.staff, m.item, m.assetCode, m.supplier].join(' | '), q);
    });
  }
  rows.sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });
  const total = rows.length;
  const totalCost = rows.reduce(function (s, r) { return s + r.cost; }, 0);
  const pageRows = pageSize ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;
  return { rows: pageRows, total: total, totalCost: totalCost, page: page, pageSize: pageSize || total };
}

function emptySupplierBucket_() {
  const b = { khac: { cost: 0, count: 0 } };
  getNccTabs_().forEach(function (t) { b[t.key] = { cost: 0, count: 0 }; });
  return b;
}

/** Danh sách tab NCC kèm số liệu, đúng thứ tự cấu hình; "Khác" luôn ở cuối. */
function supplierList_(bySupplier) {
  return getNccTabs_().map(function (t) {
    return { key: t.key, label: t.label, cost: bySupplier[t.key].cost, count: bySupplier[t.key].count };
  }).concat([{ key: 'khac', label: 'Khác', cost: bySupplier.khac.cost, count: bySupplier.khac.count }]);
}

function sumSuppliers_(bySupplier) {
  return Object.keys(bySupplier).reduce(function (s, k) { return s + bySupplier[k].cost; }, 0);
}

function getStoreCostSummary(costCenter) {
  const cc = String(costCenter || '').trim();
  const sanaky = getSanakyByStore(cc);
  const maintRows = getMaintenanceByStore(cc);
  const maintCost = maintRows.reduce(function (s, r) { return s + r.cost; }, 0);

  const ccNorm = normalizeCC_(cc);
  const cpRows = getChiPhiCached_().filter(function (r) { return normalizeCC_(r[COLS.CP_COST_CENTER]) === ccNorm; });
  const bySupplier = emptySupplierBucket_();
  cpRows.forEach(function (r) {
    const g = chiPhiSupplierGroup_(r[COLS.CP_SUPPLIER]);
    bySupplier[g].cost += Number(r[COLS.CP_COST]) || 0;
    bySupplier[g].count += 1;
  });

  const grandTotal = sanaky.totalCost + maintCost + sumSuppliers_(bySupplier);

  return {
    sanaky: { cost: sanaky.totalCost, count: sanaky.totalRepairs },
    maint: { cost: maintCost, count: maintRows.length },
    suppliers: supplierList_(bySupplier),
    khac: bySupplier.khac,
    grandTotal: grandTotal
  };
}

function getAssetCostSummary(assetCode) {
  const code = cleanCode_(assetCode);
  const sanaky = getSanakyByAsset(code);
  const maintRows = getMaintenanceByAsset(code);
  const maintCost = maintRows.reduce(function (s, r) { return s + r.cost; }, 0);

  const cpRows = getChiPhiCached_().filter(function (r) { return cleanCode_(r[COLS.CP_ASSET_CODE]) === code; });
  const bySupplier = emptySupplierBucket_();
  cpRows.forEach(function (r) {
    const g = chiPhiSupplierGroup_(r[COLS.CP_SUPPLIER]);
    bySupplier[g].cost += Number(r[COLS.CP_COST]) || 0;
    bySupplier[g].count += 1;
  });

  const grandTotal = sanaky.totalCost + maintCost + sumSuppliers_(bySupplier);

  return {
    sanaky: { cost: sanaky.totalCost, count: sanaky.totalRepairs },
    maint: { cost: maintCost, count: maintRows.length },
    suppliers: supplierList_(bySupplier),
    khac: bySupplier.khac,
    grandTotal: grandTotal
  };
}

function getAssetRepairHistory(assetCode) {
  const code = String(assetCode || '').trim();
  const rows = [];

  const sanaky = getSanakyByAsset(code);
  sanaky.rows.forEach(function (r) {
    rows.push({
      source: 'Sanaky',
      date: r.date,
      detail: r.items.map(function (it) { return it.repairItem; }).join(', '),
      supplier: '',
      cost: r.totalAmount
    });
  });

  const maintRows = getMaintenanceByAsset(code);
  maintRows.forEach(function (r) {
    rows.push({
      source: 'Bảo dưỡng',
      date: r.date,
      detail: r.desc,
      supplier: r.supplier,
      cost: r.cost
    });
  });

  const cp = getChiPhiByAsset(code);
  cp.rows.forEach(function (r) {
    rows.push({
      source: chiPhiSupplierLabel_(r.supplier),
      date: r.date,
      detail: r.items.map(function (it) { return it.item; }).join(', '),
      supplier: r.supplier,
      cost: r.totalCost
    });
  });

  rows.sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });
  const totalCost = rows.reduce(function (s, r) { return s + r.cost; }, 0);
  return { rows: rows, totalCost: totalCost, totalCount: rows.length };
}

function getStoreRepairHistory(costCenter) {
  const cc = String(costCenter || '').trim();
  const rows = [];

  const sanaky = getSanakyByStore(cc);
  sanaky.rows.forEach(function (r) {
    rows.push({
      source: 'Sanaky',
      date: r.date,
      items: r.items.map(function (it) { return { label: it.repairItem, assetCode: r.assetCode, cost: it.amount }; }),
      cost: r.totalAmount
    });
  });

  const maintRows = getMaintenanceByStore(cc);
  maintRows.forEach(function (r) {
    rows.push({
      source: 'Bảo dưỡng',
      date: r.date,
      items: [{ label: r.desc, assetCode: r.assetCode, cost: r.cost }],
      cost: r.cost
    });
  });

  const cp = getChiPhiByStore(cc);
  cp.rows.forEach(function (r) {
    rows.push({
      source: chiPhiSupplierLabel_(r.supplier),
      date: r.date,
      items: r.items.map(function (it) { return { label: it.item, assetCode: it.assetCode, cost: it.cost }; }),
      cost: r.totalCost
    });
  });

  rows.sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });
  const totalCost = rows.reduce(function (s, r) { return s + r.cost; }, 0);
  return { rows: rows, totalCost: totalCost, totalCount: rows.length };
}

// ============================== SANAKY (LỊCH SỬ SỬA CHỮA — TÍCH HỢP) ==============================

// Sanaky nay nằm NGAY TRONG file TM (tab "SANAKY") -> để trống ID là đọc file hiện tại.
const SANAKY_SPREADSHEET_ID = '';
const SANAKY_SHEET_NAME = 'SANAKY';

function getSanakySpreadsheet_() {
  if (!SANAKY_SPREADSHEET_ID) return SpreadsheetApp.getActive();
  try {
    return SpreadsheetApp.openById(SANAKY_SPREADSHEET_ID);
  } catch (e) {
    return SpreadsheetApp.getActive();
  }
}

function normalizeHeader_(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function findCol_(headers, names) {
  for (const name of names) {
    const n = normalizeHeader_(name);
    const exact = headers.findIndex(function (h) { return h === n; });
    if (exact !== -1) return exact;
  }
  for (const name of names) {
    const n = normalizeHeader_(name);
    const partial = headers.findIndex(function (h) { return h.indexOf(n) > -1; });
    if (partial !== -1) return partial;
  }
  return -1;
}

function sanakyToNumber_(value) {
  return Number(String(value || '0').replace(/[^\d]/g, '')) || 0;
}

function cleanCode_(value) {
  return String(value || '')
    .replace(/\.0$/, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Dựng Date từ 3 số ngày/tháng/năm, có KIỂM TRA NGƯỢC.
 *
 * Điểm mấu chốt: `new Date(2026, 1, 31)` KHÔNG trả NaN mà tự CUỘN TRÀN sang 03/03/2026. Vì vậy
 * chỉ kiểm tra isNaN là không đủ — phải dựng xong rồi so lại đủ 3 thành phần, lệch bất kỳ thành
 * phần nào tức là ngày gốc không tồn tại (31/02, 31/04, 29/02 của năm không nhuận...).
 */
function buildDateStrict_(y, month, day) {
  if (!(y >= 1000 && y <= 9999)) return null;
  if (!(month >= 1 && month <= 12)) return null;
  if (!(day >= 1 && day <= 31)) return null;
  const d = new Date(y, month - 1, day);
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() !== y || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/**
 * Trả về Date, hoặc new Date(0) khi không phân tích được / ngày không hợp lệ.
 * Giữ nguyên quy ước sentinel new Date(0) của bản cũ để sanakyWarrantyStatus_ và các phép sort
 * hiện có không phải sửa theo.
 *
 * LỖI CŨ: giao thẳng cho `new Date(y, m-1, d)` nên "31/02/2026" âm thầm thành 03/03/2026, kéo
 * theo tình trạng bảo hành sai và thứ tự sắp xếp sai.
 */
function parseVnDate_(str) {
  if (!str) return new Date(0);
  const s = normalizeDate_(str);
  const p = String(s).split('/');
  if (p.length !== 3) return new Date(0);
  const d = buildDateStrict_(Number(p[2]), Number(p[1]), Number(p[0]));
  return d || new Date(0);
}

function readSanakyRepairs_(forceRefresh) {
  return getCachedOrCompute_('sanaky_raw_v2', CACHE_TTL_FAST, function () {
    return readSanakyRepairsUncached_();
  }, forceRefresh);
}

function readSanakyRepairsUncached_() {
  const sh = getSanakySpreadsheet_().getSheetByName(SANAKY_SHEET_NAME);
  if (!sh) return [];
  const values = sh.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0].map(normalizeHeader_);

  const idx = {
    assetCode: findCol_(headers, ['ma thiet bi']),
    costCenter: findCol_(headers, ['ma ch']),
    address: findCol_(headers, ['dia chi']),
    province: findCol_(headers, ['tinh/tp', 'tinh']),
    date: findCol_(headers, ['ngay thuc hien']),
    cabinetType: findCol_(headers, ['loai tu']),
    paymentCode: findCol_(headers, ['ma thanh toan']),
    repairItem: findCol_(headers, ['hang muc sua chua']),
    qty: findCol_(headers, ['sl']),
    amount: findCol_(headers, ['thanh tien'])
  };

  return values.slice(1)
    .filter(function (r) {
      return idx.assetCode !== -1 && idx.costCenter !== -1 && r[idx.assetCode] && r[idx.costCenter];
    })
    .map(function (r) {
      return {
        assetCode: r[idx.assetCode],
        costCenter: cleanCode_(r[idx.costCenter]),
        address: idx.address !== -1 ? r[idx.address] : '',
        province: idx.province !== -1 ? r[idx.province] : '',
        date: idx.date !== -1 ? normalizeDate_(r[idx.date]) : '',
        cabinetType: idx.cabinetType !== -1 ? r[idx.cabinetType] : '',
        paymentCode: idx.paymentCode !== -1 ? r[idx.paymentCode] : '',
        repairItem: idx.repairItem !== -1 ? r[idx.repairItem] : '',
        qty: idx.qty !== -1 ? sanakyToNumber_(r[idx.qty]) : 0,
        amount: idx.amount !== -1 ? sanakyToNumber_(r[idx.amount]) : 0
      };
    });
}

function sanakyWarrantyStatus_(dateStr) {
  const d = parseVnDate_(dateStr);
  if (!dateStr || d.getTime() === new Date(0).getTime()) {
    return { ok: false, text: 'Không có ngày' };
  }
  const diffDays = Math.floor((new Date() - d) / (1000 * 60 * 60 * 24));
  if (diffDays <= 180) return { ok: true, text: 'Còn bảo hành' };
  return { ok: false, text: 'Hết bảo hành' };
}

function mergeSanakyRepairs_(rows) {
  const map = {};
  const order = [];
  rows.forEach(function (r) {
    // KHÔNG đưa r.address vào khoá: địa chỉ là text gõ tay, đã được costCenter xác định rồi.
    // Giữ lại chỉ khiến một lần sửa bị tách đôi khi địa chỉ gõ lệch.
    const key = sanakyRepairKey_(r.costCenter, r.assetCode, r.date);
    if (!map[key]) {
      map[key] = {
        assetCode: r.assetCode,
        costCenter: r.costCenter,
        address: r.address,
        date: r.date,
        cabinetType: r.cabinetType,
        items: [],
        totalAmount: 0
      };
      order.push(key);
    }
    map[key].items.push({ repairItem: r.repairItem, qty: r.qty, amount: r.amount });
    map[key].totalAmount += r.amount;
    if (r.cabinetType && !map[key].cabinetType) map[key].cabinetType = r.cabinetType;
  });
  return order.map(function (k) {
    const g = map[k];
    g.status = sanakyWarrantyStatus_(g.date);
    return g;
  });
}

function sanakyMonthKey_(dateStr) {
  const s = String(dateStr || '').trim();
  const p = s.split('/');
  if (p.length !== 3) return null;
  return p[2] + '-' + pad2_(p[1]);
}

function getSanakyYearsAvailable() {
  const repairs = readSanakyRepairs_();
  const set = {};
  repairs.forEach(function (r) {
    const y = extractYear_(r.date);
    if (y) set[y] = true;
  });
  return Object.keys(set).map(Number).sort(function (a, b) { return b - a; });
}

function getSanakyMonthsAvailable() {
  const repairs = readSanakyRepairs_();
  const set = {};
  repairs.forEach(function (r) {
    const key = sanakyMonthKey_(r.date);
    if (key) set[key] = true;
  });
  return Object.keys(set).sort().reverse();
}

function getSanakyDashboardData(yearFilter, monthFilter) {
  let repairs = readSanakyRepairs_();
  if (yearFilter) repairs = repairs.filter(function (r) { return extractYear_(r.date) === Number(yearFilter); });
  if (monthFilter) {
    const mm = pad2_(monthFilter);
    repairs = repairs.filter(function (r) {
      const k = sanakyMonthKey_(r.date);
      return k && k.split('-')[1] === mm;
    });
  }

  const totalDevices = new Set(repairs.map(function (r) { return r.assetCode; })).size;
  const repairSet = new Set(repairs.map(function (r) { return r.assetCode + '_' + r.date; }));
  const totalCost = repairs.reduce(function (s, r) { return s + r.amount; }, 0);

  const byStore = {};
  const byDevice = {};
  repairs.forEach(function (r) {
    if (!byStore[r.costCenter]) byStore[r.costCenter] = { key: r.costCenter, address: r.address, cost: 0, repairSet: new Set() };
    byStore[r.costCenter].cost += r.amount;
    byStore[r.costCenter].repairSet.add(r.assetCode + '_' + r.date);
    if (r.address) byStore[r.costCenter].address = r.address;

    if (/^\d+$/.test(String(r.assetCode || '').trim())) {
      if (!byDevice[r.assetCode]) byDevice[r.assetCode] = { key: r.assetCode, address: r.address, cost: 0, repairSet: new Set() };
      byDevice[r.assetCode].cost += r.amount;
      byDevice[r.assetCode].repairSet.add(r.date);
      if (r.address) byDevice[r.assetCode].address = r.address;
    }
  });

  function topN(obj, n) {
    return Object.values(obj)
      .sort(function (a, b) { return b.cost - a.cost; })
      .slice(0, n)
      .map(function (x) {
        return { key: x.key, address: x.address, cost: x.cost, count: x.repairSet.size };
      });
  }

  return {
    totalDevices: totalDevices,
    totalRepairs: repairSet.size,
    totalCost: totalCost,
    topStores: topN(byStore, 3),
    topDevices: topN(byDevice, 3)
  };
}

function getSanakyList(opts) {
  opts = opts || {};
  const q = String(opts.query || '').trim();
  const year = String(opts.year || '').trim();
  const month = String(opts.month || '').trim();
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Number(opts.pageSize) || 20;

  let rows = readSanakyRepairs_();

  if (year) rows = rows.filter(function (r) { return extractYear_(r.date) === Number(year); });
  if (month) {
    const mm = pad2_(month);
    rows = rows.filter(function (r) {
      const k = sanakyMonthKey_(r.date);
      return k && k.split('-')[1] === mm;
    });
  }

  if (q) {
    rows = rows.filter(function (r) {
      const haystack = [r.assetCode, r.costCenter, r.address, r.repairItem, r.cabinetType].join(' | ');
      return smartMatch_(haystack, q);
    });
  }

  rows = rows.slice().sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });
  rows = mergeSanakyRepairs_(rows);

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return { rows: pageRows, total: total, page: page, pageSize: pageSize };
}

function getSanakyByStore(costCenter) {
  /* MỤC 4: cleanCode_ chỉ bỏ khoảng trắng và ".0", KHÔNG cắt số 0 đầu — nên "0025" vẫn lệch "25".
     Chỉ normalizeCC_ mới cắt. */
  const cc = normalizeCC_(costCenter);
  const raw = readSanakyRepairs_()
    .filter(function (r) { return normalizeCC_(r.costCenter) === cc; })
    .sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });

  const rows = mergeSanakyRepairs_(raw);
  const totalCost = raw.reduce(function (s, r) { return s + r.amount; }, 0);
  return { rows: rows, totalCost: totalCost, totalRepairs: rows.length };
}

function getSanakyByAsset(assetCode) {
  const code = String(assetCode || '').trim();
  const raw = readSanakyRepairs_()
    .filter(function (r) { return String(r.assetCode).trim() === code; })
    .sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });

  const rows = mergeSanakyRepairs_(raw);
  const totalCost = raw.reduce(function (s, r) { return s + r.amount; }, 0);
  const cabinetType = raw.length ? raw[0].cabinetType : '';
  return { assetCode: code, cabinetType: cabinetType, rows: rows, totalCost: totalCost, totalRepairs: rows.length };
}

// ============================== ĐƠN GIÁ ==============================

const SHEET_DONGIA_BT = 'DON GIA BT';
const SHEET_DONGIA_XD = 'DON GIA XD';
const SHEET_DONGIA_SNK = 'DON GIA SNK';

// File "DG" mới (3 tab DON GIA BT / DON GIA XD / DON GIA SNK). Lấy ID trong URL: /d/<ID>/edit
const DONGIA_SPREADSHEET_ID = '1RFVctqPlPvLodhscIMxIMLrRgIEjSLLUlFUsqI2anSQ';

function getDongiaSpreadsheet_() {
  if (!DONGIA_SPREADSHEET_ID) return SpreadsheetApp.getActive();
  try {
    return SpreadsheetApp.openById(DONGIA_SPREADSHEET_ID);
  } catch (e) {
    return SpreadsheetApp.getActive();
  }
}

function buildHeaderIndex_(headers) {
  const idx = {};
  headers.forEach(function (h, i) {
    const key = stripAccents_(h).replace(/\s+/g, '_');
    idx[key] = i;
  });
  return idx;
}

function cellByKey_(row, idx, key) {
  if (idx[key] === undefined) return '';
  const v = row[idx[key]];
  return (v === null || v === undefined) ? '' : v;
}

function cellStrByKey_(row, idx, key) {
  const v = cellByKey_(row, idx, key);
  return v === '' ? '' : String(v).trim();
}

function cellNumByKey_(row, idx, key) {
  return Number(cellByKey_(row, idx, key)) || 0;
}

const ROMAN_RE_ = /^[IVXLCDM]+$/i;

function readDonGiaSingleLevel_(sheetName, extraFields) {
  const sh = getDongiaSpreadsheet_().getSheetByName(sheetName);
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const idx = buildHeaderIndex_(data[0]);

  const records = [];
  let currentGroup = '';

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const maImc = cellStrByKey_(row, idx, 'ma_imc') || cellStrByKey_(row, idx, 'imc');
    const noiDung = cellStrByKey_(row, idx, 'noi_dung') || cellStrByKey_(row, idx, 'noi_dung_cong_viec');
    if (!maImc && !noiDung) continue;

    if (ROMAN_RE_.test(maImc)) {
      currentGroup = noiDung;
      records.push({ isHeader: true, maImc: maImc, noiDung: noiDung, group: currentGroup });
    } else {
      const rec = {
        isHeader: false,
        maImc: maImc,
        noiDung: noiDung,
        dvt: cellStrByKey_(row, idx, 'dvt'),
        group: currentGroup
      };
      extraFields.forEach(function (f) { rec[f.key] = cellNumByKey_(row, idx, f.col); });
      records.push(rec);
    }
  }
  return records;
}

function readDonGiaXd_() {
  const sh = getDongiaSpreadsheet_().getSheetByName(SHEET_DONGIA_XD);
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const idx = buildHeaderIndex_(data[0]);

  const records = [];
  let currentGroup = '';
  let currentSubGroup = '';

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const maImc = cellStrByKey_(row, idx, 'imc');
    const noiDung = cellStrByKey_(row, idx, 'noi_dung_cong_viec');
    if (!maImc && !noiDung) continue;

    const isHeader = ROMAN_RE_.test(maImc);
    const isSubHeader = !isHeader && /^\d+$/.test(maImc);

    if (isHeader) {
      currentGroup = noiDung;
      currentSubGroup = '';
      records.push({ isHeader: true, maImc: maImc, noiDung: noiDung, group: currentGroup });
    } else if (isSubHeader) {
      currentSubGroup = noiDung;
      records.push({ isSubHeader: true, maImc: maImc, noiDung: noiDung, group: currentGroup, subGroup: currentSubGroup });
    } else {
      records.push({
        isHeader: false,
        maImc: maImc,
        noiDung: noiDung,
        yeuCau: cellStrByKey_(row, idx, 'yeu_cau_ky_thuat_va_vat_lieu'),
        dvt: cellStrByKey_(row, idx, 'dvt'),
        tongCong: cellNumByKey_(row, idx, 'don_gia'),
        group: currentGroup,
        subGroup: currentSubGroup
      });
    }
  }
  return records;
}

function getDonGiaData(category, forceRefresh) {
  category = (category === 'xd' || category === 'snk') ? category : 'bt';
  try {
    const records = getCachedOrCompute_('dongia_' + category + '_v1', CACHE_TTL_SLOW, function () {
      if (category === 'xd') {
        return readDonGiaXd_();
      }
      if (category === 'snk') {
        return readDonGiaSingleLevel_(SHEET_DONGIA_SNK, [
          { key: 'vatTu', col: 'vat_tu' },
          { key: 'gasPhinLoc', col: 'gas_+_phin_loc' },
          { key: 'nhanCong', col: 'nhan_cong' },
          { key: 'phuPhi', col: 'phu_phi_(van_chuyen/_di_lai)' },
          { key: 'tongCong', col: 'don_gia' }
        ]);
      }
      return readDonGiaSingleLevel_(SHEET_DONGIA_BT, [
        { key: 'vatTu', col: 'vat_tu' },
        { key: 'nhanCong', col: 'nhan_cong' },
        { key: 'tongCong', col: 'tong_cong' }
      ]);
    }, forceRefresh);
    return { success: true, records: records, category: category };
  } catch (err) {
    return { success: false, message: 'Đã xảy ra lỗi: ' + err.message };
  }
}

// ============================== VẬT TƯ (KHO VẬT TƯ THEO NGƯỜI GIỮ) ==============================

const SHEET_VATTU = 'VAT TU';
const VATTU_FIXED_COLS = 3;

function ensureVatTuSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_VATTU);
  if (sh) return sh;

  sh = ss.insertSheet(SHEET_VATTU);
  const holders = ['Nguyễn Duy Đức', 'Nguyễn Văn Thái', 'Vũ Quang Hưng', 'Tràng Nhật Hiển', 'Nguyễn Văn Kiên'];
  const headers = ['Mã vật tư', 'Tên vật tư', 'Yêu cầu kỹ thuật và vật liệu'].concat(holders);
  const seed = [
    ['602000283', 'Bóng đèn pha', 'Duhal CP06 30W 6500K', 3, 5, 2, 7, ''],
    ['604000599', 'Bóng âm trần D125', 'Philips DN027B G2 LED9', 7, 4, 12, 5, ''],
    ['603000128', 'Bóng âm trần D150', 'Philips DN027B G3 LED12', 7, 13, 12, 60, ''],
    ['603000125', 'Led dây hắt xanh', 'Nanoco', 8, 3, 16, 71, ''],
    ['603000124', 'Nguồn led dây', 'Nanoco', 8, 3, 3, '', ''],
    ['603000123', 'Loa báo động', '', 3, 7, '', '', ''],
    ['603000154', 'Dây điện 2*1.5mm', 'Cadivi', 204, '', '', '', ''],
    ['603000155', 'Dây điện 2*2.5mm', 'Cadivi', '', '', '', '', ''],
    ['602000289', 'Dây điện 2*4mm', 'Cadivi', 106, '', '', '', ''],
    ['603000130', 'Bảng thông báo camera', 'A5', 2, 5, '', '', 5],
    ['603000153', 'Đèn exit kết hợp sự cố', '', 60, 40, 60, 39, 6],
    ['603000152', 'Bình chữa cháy bột ABC 4kg', '', 5, 5, '', 5, ''],
    ['603000129', 'Tiêu lệnh PCCC', '', 4, 4, '', '', ''],
    ['603000126', 'Nguồn NB-12V-33A (400W)', '', 2, 4, '', 3, ''],
    ['602000273', 'Thẻ nhớ 128G', '', '', '', '', '', ''],
    ['602000272', 'Ổ cứng HDD 1TB', '', '', '', '', '', ''],
    ['602000269', 'Bộ nguồn Adapter 12V-5A', '', '', '', '', '', ''],
    ['603000127', 'Phụ kiện nối dài LD01.B 7W', '', '', '', '', '', '']
  ];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(2, 1, seed.length, headers.length).setValues(seed);
  return sh;
}

function getVatTuData() {
  const sh = ensureVatTuSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1) return { holders: [], materials: [] };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function (h) { return String(h || '').trim(); });
  const holders = headers.slice(VATTU_FIXED_COLS).filter(function (h) { return h; });

  const materials = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    if (!code && !name) continue;
    const qty = {};
    let total = 0;
    for (let c = VATTU_FIXED_COLS; c < headers.length; c++) {
      const holderName = headers[c];
      if (!holderName) continue;
      const v = Number(row[c]) || 0;
      qty[holderName] = v;
      total += v;
    }
    materials.push({ code: code, name: name, spec: String(row[2] || ''), qty: qty, total: total });
  }
  return { holders: holders, materials: materials };
}

/* ============ KHOÁ GHI VẬT TƯ ============
 *
 * Không khoá thì hai người thao tác gần như đồng thời là người sau ghi đè người trước, mất dữ
 * liệu âm thầm. Nặng nhất là addVatTuStock: ĐỌC tồn -> CỘNG -> GHI, hai lượt nhập kho chồng nhau
 * là một lô hàng biến mất không dấu vết.
 *
 * Quy ước đặt tên:
 *   hậu tố `_`     lõi KHÔNG khoá. Chỉ gọi từ trong server và chỉ khi phía gọi ĐANG GIỮ khoá.
 *   không hậu tố   vỏ bọc tự lấy khoá rồi gọi lõi. Đây là thứ client gọi.
 *
 * TUYỆT ĐỐI không để hàm có khoá gọi hàm có khoá: LockService không tái nhập (re-entrant), lồng
 * nhau là tự khoá chính mình cho tới khi hết thời gian chờ.
 *
 * Dùng CHUNG getScriptLock() với runVatTuAutoDeduction nên không thể vừa trừ tự động vừa nhập kho.
 */
function withVatTuLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('Có người khác đang cập nhật vật tư, vui lòng thử lại sau vài giây.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function saveVatTuItem_(item) {
  const sh = ensureVatTuSheet_();
  const code = String((item && item.code) || '').trim();
  if (!code) throw new Error('Thiếu mã vật tư.');
  const oldCode = String((item && item.oldCode) || '').trim();
  const lastRow = sh.getLastRow();

  if (lastRow >= 2) {
    const codes = sh.getRange(2, 1, lastRow - 1, 1).getValues()
      .map(function (r) { return String(r[0] || '').trim(); });

    const targetIdx = oldCode ? codes.indexOf(oldCode) : -1;
    if (oldCode && targetIdx === -1) throw new Error('Không tìm thấy vật tư "' + oldCode + '" để sửa.');

        /* Chống trùng mã ở CẢ hai nhánh. Bỏ sót nhánh SỬA là đổi mã thành một mã đã tồn tại được,
       tạo hai dòng trùng mã — từ đó mọi tra cứu bằng indexOf chỉ thấy dòng đầu, dòng sau thành
       dòng chết. */
    for (let i = 0; i < codes.length; i++) {
      if (i === targetIdx) continue;              // chính dòng đang sửa thì bỏ qua
      if (codes[i] === code) throw new Error('Mã vật tư "' + code + '" đã tồn tại.');
    }

    if (targetIdx > -1) {
      sh.getRange(targetIdx + 2, 1, 1, 3).setValues([[code, item.name || '', item.spec || '']]);
      return { success: true };
    }
  }

  const lastCol = Math.max(sh.getLastColumn(), VATTU_FIXED_COLS);
  const newRow = new Array(lastCol).fill('');
  newRow[0] = code; newRow[1] = item.name || ''; newRow[2] = item.spec || '';
  sh.getRange(sh.getLastRow() + 1, 1, 1, lastCol).setValues([newRow]);
  return { success: true };
}

function deleteVatTuItem_(code) {
  const sh = ensureVatTuSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { success: true };
  const codes = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = codes.length - 1; i >= 0; i--) {
    if (String(codes[i][0] || '').trim() === String(code).trim()) sh.deleteRow(i + 2);
  }
  return { success: true };
}

function moveVatTuItem_(code, direction) {
  const sh = ensureVatTuSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 3) return { success: true };
  const codes = sh.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0] || '').trim(); });
  const idx = codes.indexOf(String(code || '').trim());
  if (idx === -1) throw new Error('Không tìm thấy vật tư "' + code + '".');

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= codes.length) return { success: true };

  const rowA = idx + 2, rowB = targetIdx + 2;
  const rangeA = sh.getRange(rowA, 1, 1, lastCol).getValues();
  const rangeB = sh.getRange(rowB, 1, 1, lastCol).getValues();
  sh.getRange(rowA, 1, 1, lastCol).setValues(rangeB);
  sh.getRange(rowB, 1, 1, lastCol).setValues(rangeA);
  return { success: true };
}

function addVatTuHolder_(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Thiếu tên người giữ vật tư.');
  const sh = ensureVatTuSheet_();
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  if (headers.indexOf(n) > -1) throw new Error('Người "' + n + '" đã có trong danh sách.');
  sh.getRange(1, lastCol + 1).setValue(n);
  return { success: true };
}

function renameVatTuHolder_(oldName, newName) {
  const sh = ensureVatTuSheet_();
  const lastCol = sh.getLastColumn();
  const range = sh.getRange(1, 1, 1, lastCol);
  const headers = range.getValues()[0];
  const trimmed = headers.map(function (h) { return String(h || '').trim(); });
  const idx = trimmed.indexOf(String(oldName || '').trim());
  if (idx === -1) throw new Error('Không tìm thấy người "' + oldName + '".');
  const nn = String(newName || '').trim();
  if (!nn) throw new Error('Tên mới không được để trống.');

    /* Chống trùng tên. Hai cột cùng tiêu đề thì headers.indexOf() luôn trúng cột đầu, cột thứ hai
     thành cột chết: tồn kho ghi trong đó không bao giờ đọc ra và cũng không bao giờ bị trừ. */
  for (let i = 0; i < trimmed.length; i++) {
    if (i !== idx && trimmed[i] === nn) throw new Error('Người "' + nn + '" đã có trong danh sách.');
  }

  headers[idx] = nn;
  range.setValues([headers]);
  return { success: true };
}

function deleteVatTuHolder_(name) {
  const sh = ensureVatTuSheet_();
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  const idx = headers.indexOf(String(name || '').trim());
  if (idx === -1) throw new Error('Không tìm thấy người "' + name + '".');
  sh.deleteColumn(idx + 1);
  return { success: true };
}

function setVatTuQty_(code, holder, qty) {
  const sh = ensureVatTuSheet_();
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  const colIdx = headers.indexOf(String(holder || '').trim());
  if (colIdx === -1) throw new Error('Không tìm thấy người "' + holder + '".');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('Chưa có vật tư nào trong danh mục.');
  const codes = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < codes.length; i++) {
    if (String(codes[i][0] || '').trim() === String(code || '').trim()) {
      sh.getRange(i + 2, colIdx + 1).setValue(Number(qty) || 0);
      return { success: true };
    }
  }
  throw new Error('Không tìm thấy vật tư "' + code + '".');
}

function setVatTuQtyBulk_(holder, items) {
  const sh = ensureVatTuSheet_();
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  const colIdx = headers.indexOf(String(holder || '').trim());
  if (colIdx === -1) throw new Error('Không tìm thấy người "' + holder + '".');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('Chưa có vật tư nào trong danh mục.');
  const codes = sh.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0] || '').trim(); });

  const byCode = {};
  (items || []).forEach(function (it) { byCode[String(it.code || '').trim()] = Number(it.qty) || 0; });

  const colValues = sh.getRange(2, colIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < codes.length; i++) {
    if (byCode.hasOwnProperty(codes[i])) colValues[i][0] = byCode[codes[i]];
  }
  sh.getRange(2, colIdx + 1, lastRow - 1, 1).setValues(colValues);
  return { success: true };
}

/* ---- Vỏ bọc có khoá: đây là những hàm client được phép gọi ---- */
function saveVatTuItem(item) { return withVatTuLock_(function () { return saveVatTuItem_(item); }); }
function deleteVatTuItem(code) { return withVatTuLock_(function () { return deleteVatTuItem_(code); }); }
function moveVatTuItem(code, direction) { return withVatTuLock_(function () { return moveVatTuItem_(code, direction); }); }
function addVatTuHolder(name) { return withVatTuLock_(function () { return addVatTuHolder_(name); }); }
function renameVatTuHolder(oldName, newName) { return withVatTuLock_(function () { return renameVatTuHolder_(oldName, newName); }); }
function deleteVatTuHolder(name) { return withVatTuLock_(function () { return deleteVatTuHolder_(name); }); }
function setVatTuQty(code, holder, qty) { return withVatTuLock_(function () { return setVatTuQty_(code, holder, qty); }); }
function setVatTuQtyBulk(holder, items) { return withVatTuLock_(function () { return setVatTuQtyBulk_(holder, items); }); }

// ============================== VẬT TƯ — NHẬP KHO (CỘNG DỒN) & LỊCH SỬ NHẬP ==============================

const SHEET_VATTU_LOG = 'VAT TU NHAP KHO';

function ensureVatTuLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_VATTU_LOG);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_VATTU_LOG);
  sh.getRange(1, 1, 1, 5).setValues([['Ngày nhập', 'Mã vật tư', 'Tên vật tư', 'Số lượng nhập', 'Người giữ']]);
  return sh;
}

function addVatTuStock(holder, items) {
  return withVatTuLock_(function () {
    const data = getVatTuData();
    const byCode = {};
    data.materials.forEach(function (m) { byCode[m.code] = m; });

    const today = Utilities.formatDate(new Date(), getSpreadsheetTimeZone_(), 'dd/MM/yyyy');
    const logRows = [];

        /* Gom toàn bộ thay đổi rồi ghi MỘT lần. Gọi setVatTuQty trong vòng lặp thì mỗi vật tư là một
       lượt đọc lại header + toàn bộ cột mã rồi ghi đúng một ô — vừa chậm vừa không nguyên tử,
       lỗi giữa chừng để lại tồn kho sửa một nửa. */
    const newQty = {};
    (items || []).forEach(function (it) {
      const qty = Number(it.qty) || 0;
      if (qty <= 0) return;
      const mat = byCode[String(it.code || '').trim()];
      if (!mat) return;
      const current = mat.qty[holder] || 0;
      newQty[mat.code] = (newQty.hasOwnProperty(mat.code) ? newQty[mat.code] : current) + qty;
      logRows.push([today, mat.code, mat.name, qty, holder]);
    });

    const bulk = Object.keys(newQty).map(function (code) { return { code: code, qty: newQty[code] }; });
    if (bulk.length) setVatTuQtyBulk_(holder, bulk);

    if (logRows.length) {
      const sh = ensureVatTuLogSheet_();
      const startRow = sh.getLastRow() + 1;
      sh.getRange(startRow, 1, logRows.length, 1).setNumberFormat('@');
      sh.getRange(startRow, 1, logRows.length, 5).setValues(logRows);
    }
    return { success: true, itemsAdded: logRows.length };
  });
}

function getVatTuStockInHistory() {
  const sh = ensureVatTuLogSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const values = sh.getRange(2, 1, lastRow - 1, 5).getValues();
  return values
    .map(function (r) {
      return { date: normalizeDate_(r[0]), code: r[1], name: r[2], qty: Number(r[3]) || 0, holder: r[4] };
    })
    .sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });
}

/* ==================== KHỚP HẠNG MỤC CHI PHÍ VỚI DANH MỤC VẬT TƯ ====================
 *
 * Ô "Hạng mục" trên sheet CHI PHÍ do người dùng gõ tự do nên gần như không bao giờ trùng khít tên
 * trong danh mục vật tư. Ba kiểu lệch thường gặp:
 *    "Tiêu lệch PCCC"        vs "Tiêu lệnh PCCC"        -> sai chính tả 1 ký tự
 *    "Thay dây điện 2x1.5mm" vs "Dây điện 2*1.5mm"      -> khác ký hiệu quy cách
 *    "Nguồn tổ ong quảng cáo 12v" vs "Nguồn tổ ong 12V-33A" -> viết tắt / thêm bớt chữ
 *
 * BỐN NGUYÊN TẮC:
 *
 * 1. TRỌNG SỐ THEO ĐỘ HIẾM. Từ chỉ xuất hiện ở 1 vật tư ("33a", "128g", "ong") mang nhiều thông
 *    tin định danh hơn hẳn từ dùng chung ("nguồn", "dây", "điện"). Chấm đều nhau thì "Thay nguồn
 *    12V-33A" chỉ được 43% dù "33a" đã đủ chỉ đích danh.
 *
 * 2. CHẤM RIÊNG TÊN VÀ QUY CÁCH, LẤY CÁI CAO HƠN. Cột "Yêu cầu kỹ thuật" chính là nơi ghi các
 *    cách viết khác ("Cadivi hoặc tương đương 2x1.5mm"), nhưng gộp chung vào tên thì chữ mẫu
 *    "Cadivi hoặc tương đương" sẽ làm loãng điểm.
 *
 * 3. DUNG SAI SAI CHÍNH TẢ 1 KÝ TỰ, chỉ áp cho từ >= 4 chữ và KHÔNG CHỨA CHỮ SỐ. Chốt chặn này
 *    bắt buộc: nếu cho phép, "1.5mm" sẽ khớp "2.5mm" và trừ nhầm kho.
 *
 * 4. KHÔNG CẮT DẤU CHẤM khi tách từ, để "1.5mm" giữ nguyên một khối thay vì vỡ thành "1" + "5mm".
 *
 * Ngoài ra hạng nhất phải bỏ xa hạng nhì ít nhất VT_MATCH_MIN_GAP. Ô ghi "Thay dây điện 2mm" cho
 * cả ba loại dây điểm ngang nhau — chọn cái nào cũng là chọn bừa, nên dừng lại để người xác nhận.
 */
const VT_MATCH_MIN_SCORE = 0.60;
const VT_MATCH_MIN_GAP = 0.10;

/** Chuẩn hoá: "2x1.5mm" / "2 × 1.5mm" -> "2*1.5mm", rồi bỏ dấu và về chữ thường */
function normVatTu_(s) {
  return stripAccents_(String(s || '').replace(/(\d)\s*[x×]\s*(\d)/gi, '$1*$2'));
}

/** Tách từ. Cố ý KHÔNG cắt dấu chấm để giữ nguyên quy cách dạng "1.5mm". */
/* KHÔNG tách ở dấu '*'. Tách thì "3*2.5mm" vỡ thành "3" + "2.5mm", số sợi 3 thành con số trơ
   không mang thông tin -> "Dây điện 3x2.5mm" khớp nhầm "Dây điện 2*2.5mm". Giữ nguyên khối thì
   "3*2.5mm" và "2*2.5mm" là hai mã khác hẳn nhau. */
const VT_TOK_SEP_ = /[\s,;:\-\/()\[\]|_+]+/;
function vtTokens_(s) {
  const seen = {}, out = [];
  normVatTu_(s).split(VT_TOK_SEP_).forEach(function (t) {
    if (t && !seen[t]) { seen[t] = true; out.push(t); }
  });
  return out;
}

const VT_UNITS_ = ['mm','cm','m','w','v','a','b','g','gb','kg','tb','k','hp','inch'];
function vtNumUnitEq_(a, b) {
  const long  = a.length > b.length ? a : b;
  const short = a.length > b.length ? b : a;
  if (!/\d/.test(short)) return false;                      // vế ngắn phải có chữ số
  if (long.indexOf(short) !== 0) return false;
  return VT_UNITS_.indexOf(long.slice(short.length)) > -1;   // khác biệt CHỈ là hậu tố đơn vị
}

/* Mã quy cách = token vừa có chữ số vừa có chữ cái ("64g", "d125", "2*4mm", "12v").
   Ô hạng mục mang một mã mà vật tư không có -> LOẠI THẲNG vật tư đó, không chấm điểm. Thiếu
   chốt này thì "Thẻ nhớ 64G" khớp "Thẻ nhớ 128G" 67% và trừ nhầm kho. */
function vtIsSpecCode_(t) { return /\d/.test(t) && /[a-z]/.test(t); }
function vtSpecConflict_(inputTokens, allTok) {
  return inputTokens.some(function (a) {
    if (!vtIsSpecCode_(a)) return false;
    return !allTok.some(function (t) { return vtTokenEq_(a, t); });
  });
}

/** Sai lệch tối đa 1 ký tự. Từ có chữ số phải khớp TUYỆT ĐỐI. */
function vtTokenEq_(a, b) {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return vtNumUnitEq_(a, b);
  /* PHẢI xét độ dài CẢ HAI vế. Bản cũ chỉ chặn a.length < 4 nên "nong" (4 chữ) được phép khớp
     "ong" (3 chữ) -> "Mô tơ quạt dàn NÓNG tủ mát" khớp nhầm "Nguồn tổ ONG 12V-33A". */
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, err = 0;
  while (i < a.length && j < b.length) {
    if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
    if (++err > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return err + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Dựng sẵn bộ khớp MỘT LẦN cho cả danh mục: tách từ và tính trọng số độ hiếm.
 * Bắt buộc phải dựng ngoài vòng lặp — nếu tính lại cho từng dòng CHI PHÍ thì với hàng nghìn dòng
 * sẽ chậm không dùng được.
 */
function buildVatTuMatcher_(materials) {
  const prepared = materials.map(function (m) {
    const tn = vtTokens_(m.name), ts = vtTokens_(m.spec);
    return { m: m, name: normVatTu_(m.name), tn: tn, ts: ts, all: tn.concat(ts) };
  });
  const df = {};
  prepared.forEach(function (p) {
    const seen = {};
    p.all.forEach(function (t) { if (!seen[t]) { seen[t] = true; df[t] = (df[t] || 0) + 1; } });
  });
  const n = Math.max(1, prepared.length);
  const weight = function (t) { return Math.log(n / (df[t] || 1)) + 0.25; };
  /* known() phải so CHÍNH XÁC, KHÔNG dùng dung sai 1 ký tự.
     Dung sai đúng chỗ của nó là lúc CHẤM ĐIỂM (để "lệch" tìm về "lệnh"), nhưng dùng nó để trả lời
     "từ này có thuộc từ vựng vật tư không" thì sinh ra hàng loạt đồng nghĩa giả: thay≈cháy,
     mạng≈bảng, hỏng≈bóng. Từ đó "Thay led dây tủ mát" và "Dây cáp mạng" lọt qua chốt phạm vi. */
  const known = function (t) { return !!df[t]; };
  return { prepared: prepared, weight: weight, known: known };
}

function vtPartScore_(A, tokens, weight) {
  if (!tokens.length) return 0;
  let num = 0, den = 0;
  tokens.forEach(function (t) {
    const w = weight(t);
    den += w;
    if (A.some(function (a) { return vtTokenEq_(a, t); })) num += w;
  });
  return den ? num / den : 0;
}

const VT_REV_MIN_TOKENS_ = 2;
const VT_REV_MIN_COVER_ = 0.6;
function vtRevScore_(inputTokens, tokens, weight, known) {
  let num = 0, den = 0, cnt = 0;
  inputTokens.forEach(function (a) {
    if (!/\d/.test(a) && !known(a)) return;   // từ lạ, không có trong danh mục -> bỏ qua
    const w = weight(a);
    den += w; cnt++;
    if (tokens.some(function (t) { return vtTokenEq_(a, t); })) num += w;
  });
  /* Chỉ tin chiều ngược khi nhận ra được PHẦN LỚN ô hạng mục. "Cục nguồn đèn led tủ mát lớn" chỉ
     nhận ra 3/7 từ (nguon, den, led) — quá ít để kết luận, mà vừa đủ để khớp nhầm "Nguồn led dây". */
  if (cnt < VT_REV_MIN_TOKENS_ || cnt < inputTokens.length * VT_REV_MIN_COVER_) return 0;
  return den ? num / den : 0;
}

/**
 * Trả về { material, score, gap, exact } hoặc null.
 *  exact = true  -> tên danh mục nằm trọn trong ô hạng mục, chắc chắn đúng
 *  exact = false -> khớp theo điểm, người gọi tự quyết theo VT_MATCH_MIN_SCORE / _GAP
 */
function vtMatch_(matcher, freeText) {
  const hay = normVatTu_(freeText);
  if (!hay) return null;

  /* Tầng 1: tên danh mục nằm trọn trong ô hạng mục.
     VẪN PHẢI qua chốt mã quy cách. Bỏ qua là "Bóng đèn pha 50W" khớp thẳng "Bóng đèn pha" (tên nằm
     trọn trong ô) và trừ kho bóng 30W, dù 50W là loại khác hẳn. Tên dài nhất thắng ("gas R32" hơn
     "gas"); nếu hai tên KHÁC NHAU cùng dài nhất thì ô đang nhắc nhiều vật tư -> dừng, để người xác nhận. */
  const A0 = vtTokens_(freeText);
  let exact = null, exactLen = 0, exactTie = false;
  matcher.prepared.forEach(function (p) {
    if (!p.name || !wordStartMatch_(hay, p.name)) return;
    if (vtSpecConflict_(A0, p.all)) return;
    if (p.name.length > exactLen) { exact = p.m; exactLen = p.name.length; exactTie = false; }
    else if (p.name.length === exactLen && exact && p.m !== exact) { exactTie = true; }
  });
  if (exact && !exactTie) return { material: exact, score: 1, gap: 1, exact: true };

  const A = A0;

  /* ===== CHỐT CHẶN Ở TẦNG CAO: ô hạng mục có thuộc phạm vi vật tư không? =====
     Đếm xem bao nhiêu phần ô hạng mục là từ mà danh mục có biết. Nếu phần lớn nội dung là chữ lạ
     thì ô này đang mô tả một thứ KHÁC, không phải vật tư trong kho — dừng ngay, đừng chấm điểm.

     Không có chốt này thì "Cục nguồn đèn led tủ mát lớn" khớp nhầm "Nguồn led dây" 75%: chỉ 2 từ
     trùng (nguồn, led) nhưng vì tên danh mục ngắn (3 từ) nên tỉ lệ phủ vẫn cao. Tương tự
     "Phá dỡ móng các loại - Móng gạch" khớp nhầm "Bóng đèn pha" chỉ vì chữ "pha".

     Token có chữ số luôn được tính là "biết" — quy cách là thứ định danh mạnh nhất. */
  let knownCnt = 0;
  A.forEach(function (a) { if (/\d/.test(a) || matcher.known(a)) knownCnt++; });
  if (knownCnt < VT_REV_MIN_TOKENS_ || knownCnt < A.length * VT_REV_MIN_COVER_) return null;

  let best = null, bestScore = 0, secondScore = 0;
  matcher.prepared.forEach(function (p) {
    let sc = 0;
    if (!vtSpecConflict_(A, p.all)) {
      const fwd = Math.max(vtPartScore_(A, p.tn, matcher.weight),
                           vtPartScore_(A, p.ts, matcher.weight));
      const rev = Math.max(vtRevScore_(A, p.tn, matcher.weight, matcher.known),
                           vtRevScore_(A, p.ts, matcher.weight, matcher.known));
      sc = Math.max(fwd, rev);
    }
    if (sc > bestScore) { secondScore = bestScore; bestScore = sc; best = p.m; }
    else if (sc > secondScore) { secondScore = sc; }
  });
  if (!best) return null;
  return { material: best, score: bestScore, gap: bestScore - secondScore, exact: false };
}

/** true nếu kết quả đủ tin cậy để TỰ ĐỘNG TRỪ KHO */
function vtMatchAccepted_(res) {
  if (!res) return false;
  if (res.exact) return true;
  return res.score >= VT_MATCH_MIN_SCORE && res.gap >= VT_MATCH_MIN_GAP;
}

/** Giữ lại cho tương thích: chỉ trả vật tư khi đủ tin cậy */
function matchVatTuName_(freeText, materials) {
  const res = vtMatch_(buildVatTuMatcher_(materials), freeText);
  return vtMatchAccepted_(res) ? res.material : null;
}

function chiPhiMonthKey_(dateVal) {
  const y = extractYear_(dateVal);
  if (!y) return null;
  let month = null;
  const parts = normalizeDate_(dateVal).split('/');
  if (parts.length === 3) month = Number(parts[1]);
  if (!month) return null;
  return y + '-' + pad2_(month);
}

/* Ba hàm dựng bộ lọc dưới đây PHẢI lọc isVatTuSupplier_ giống getVatTuByStaffMonth và
   getVatTuTrackingList. Lệch phạm vi giữa dropdown và nội dung bảng thì tháng 7 có dòng PSMART ghi
   "Bóng đèn pha" sẽ hiện trong dropdown, chọn vào lại rỗng — nhìn như mất dữ liệu. */
function getVatTuYearsAvailable() {
  const rows = getChiPhiCached_();
  const data = getVatTuData();
  const matcher = buildVatTuMatcher_(data.materials);
  const set = {};
  rows.forEach(function (r) {
    if (!isVatTuRow_(r)) return;
    if (!vtMatchAccepted_(vtMatch_(matcher, r[COLS.CP_ITEM]))) return;
    const y = extractYear_(r[COLS.CP_DATE]);
    if (y) set[y] = true;
  });
  const years = Object.keys(set).map(Number).sort(function (a, b) { return b - a; });
  return years.length ? years : [new Date().getFullYear()];
}

function getVatTuMonthsAvailable() {
  const rows = getChiPhiCached_();
  const data = getVatTuData();
  const matcher = buildVatTuMatcher_(data.materials);
  const now = new Date();
  const curKey = now.getFullYear() + '-' + pad2_(now.getMonth() + 1);
  const set = {};
  rows.forEach(function (r) {
    if (!isVatTuRow_(r)) return;
    if (!vtMatchAccepted_(vtMatch_(matcher, r[COLS.CP_ITEM]))) return;
    const key = chiPhiMonthKey_(r[COLS.CP_DATE]);
    if (key && key <= curKey) set[key] = true;
  });
  const months = Object.keys(set).sort().reverse();
  return months.length ? months : [curKey];
}

function getVatTuByStaffMonth(yearFilter, monthFilter) {
  const data = getVatTuData();
  const matcher = buildVatTuMatcher_(data.materials);
  const rows = getChiPhiCached_();
  const byMaterial = {};
  const staffSet = {};

  rows.forEach(function (r) {
    if (!isVatTuRow_(r)) return;   // chỉ tính NCC vật tư
    if (yearFilter && extractYear_(r[COLS.CP_DATE]) !== Number(yearFilter)) return;
    if (monthFilter) {
      const key = chiPhiMonthKey_(r[COLS.CP_DATE]);
      if (!key || key.split('-')[1] !== pad2_(monthFilter)) return;
    }
    const res = vtMatch_(matcher, r[COLS.CP_ITEM]);
    if (!vtMatchAccepted_(res)) return;
    const match = res.material;
    const staff = String(r[COLS.CP_STAFF] || 'Không rõ').trim() || 'Không rõ';
    const qty = Number(r[COLS.CP_QTY]) || 0;

    if (!byMaterial[match.code]) byMaterial[match.code] = { code: match.code, name: match.name, byStaff: {}, total: 0 };
    byMaterial[match.code].byStaff[staff] = (byMaterial[match.code].byStaff[staff] || 0) + qty;
    byMaterial[match.code].total += qty;
    staffSet[staff] = true;
  });

  const staffList = Object.keys(staffSet).sort();
  const materials = [];
  data.materials.forEach(function (m) {
    if (byMaterial[m.code]) materials.push(byMaterial[m.code]);
  });
  return { staffList: staffList, materials: materials };
}

function getVatTuTrackingFilters() {
  const rows = getChiPhiCached_();
  const data = getVatTuData();
  const matcher = buildVatTuMatcher_(data.materials);
  const staffSet = {}, yearSet = {}, monthSet = {};
  rows.forEach(function (r) {
    /* Chỉ lọc theo NCC, KHÔNG lọc theo "khớp được vật tư" như hai hàm trên.
       Bảng theo dõi cố ý hiển thị cả dòng "Chưa khớp vật tư" (đó là tín hiệu cần xử lý), nên nếu
       dropdown loại bỏ những dòng đó thì chính các tháng đang có vấn đề lại không chọn được. */
    if (!isVatTuRow_(r)) return;
    const staff = String(r[COLS.CP_STAFF] || '').trim();
    if (staff) staffSet[staff] = true;
    const y = extractYear_(r[COLS.CP_DATE]);
    if (y) yearSet[y] = true;
    const mk = chiPhiMonthKey_(r[COLS.CP_DATE]);
    if (mk) monthSet[mk] = true;
  });
  return {
    staffList: Object.keys(staffSet).sort(),
    years: Object.keys(yearSet).map(Number).sort(function (a, b) { return b - a; }),
    monthsAvailable: Object.keys(monthSet).sort().reverse()
  };
}

/* ============ TRẠNG THÁI XUẤT KHO CỦA TỪNG DÒNG CHI PHÍ ============
 *
 *   Đã xuất kho     : khoá đã có trong sổ log — dù là trừ thật hay dòng lịch sử được đánh dấu lúc
 *                     khởi tạo. KHÔNG tách hai tình huống: người dùng không cần biết dòng này được
 *                     ghi nhận trước hay sau khi bật theo dõi, chỉ cần biết nó đã xong.
 *   Chờ xuất kho    : khớp đủ vật tư + người giữ + SL > 0, tồn đủ, chưa trừ. Nằm đây tới khi có
 *                     người bấm "Khớp vật tư" — trigger nền 30 phút CHỈ ĐỌC.
 *   Không đủ tồn    : SL yêu cầu > tồn hiện có. Không trừ một phần, không ghi log; treo tới khi
 *                     nhập thêm kho. Xem điểm 5 trong chú thích runVatTuAutoDeduction.
 *   Chưa khớp vật tư: không dò ra tên vật tư nào trong danh mục. Vì đã giới hạn trong NCC vật tư
 *                     (xem VATTU_SUPPLIER_GROUPS_) nên đây là tín hiệu THẬT: thiếu danh mục hoặc
 *                     hạng mục ghi lệch chữ. Phải xét TRƯỚC sổ log, nếu không toàn bộ dòng lịch
 *                     sử chưa khớp sẽ bị dán nhãn "Đã xuất kho" và tính năng thành vô nghĩa.
 *   Thiếu người giữ : không suy ra được người giữ từ ô NV.
 *   Thiếu số lượng  : SL bằng 0 hoặc để trống.
 *
 * KHÔNG còn nhãn "Khớp gần đúng" riêng. Nó chỉ nói lên CÁCH máy tìm ra vật tư, không nói lên dòng
 * đó đang ở đâu trong quy trình — mà đó mới là thứ cột trạng thái cần trả lời. Dòng khớp gần đúng
 * nay nằm ở "Chờ xuất kho" hoặc "Đã xuất kho" như mọi dòng khác; muốn kiểm tra máy khớp có đúng
 * không thì nhìn tên vật tư ở dòng phụ.
 */
const VT_ST_DONE = 'done';
const VT_ST_WAIT = 'wait';
const VT_ST_NO_HOLDER = 'no_holder';
const VT_ST_NO_QTY = 'no_qty';
const VT_ST_NO_ITEM = 'no_item';
const VT_ST_NO_STOCK = 'no_stock';

/**
 * Trả về { code, label, sub } cho một dòng CHI PHÍ.
 *
 * `sub` là dòng chữ xám nhỏ dưới thẻ, và cũng là cột "Vật tư khớp" khi xuất Excel — MỘT nguồn duy
 * nhất, không có bản thứ hai làm tooltip. Nội dung chỉ gồm TÊN VẬT TƯ trong danh mục, vì cột
 * "Hạng mục vật tư" giữ nguyên văn trên sheet nên nếu không có dòng này thì không đối chiếu được
 * máy khớp đúng hay sai.
 *
 * KHÔNG nhắc lại số lượng, tồn kho hay việc đã trừ/sẽ trừ: những số đó đã nằm ở các cột phía
 * trước và ở bảng tồn kho ngay trên cùng trang.
 *
 * KHÔNG hiện phần trăm khớp. Điểm được chấm hai chiều rồi lấy cái cao hơn, mà chiều ngược ("mọi
 * chữ đã gõ đều nằm trong tên này") gần như luôn ra 100% — nên con số đó không phân biệt được gì,
 * chỉ gây hiểu nhầm là hai chuỗi giống hệt nhau. Dòng nào máy không khớp nổi thì đã có nhãn riêng.
 */
function vatTuRowStatus_(mat, holder, qty, logEntry, matchRes, avail) {
  if (!mat) {
    const cand = (matchRes && matchRes.material) ? matchRes.material.name : '';
    return { code: VT_ST_NO_ITEM, label: 'Chưa khớp vật tư', sub: cand };
  }

  if (logEntry) return { code: VT_ST_DONE, label: 'Đã xuất kho', sub: mat.name };

  // Ba nhãn dưới đây tự nó đã nói hết vấn đề -> dòng phụ để TRỐNG cho đỡ rối.
  if (!holder)     return { code: VT_ST_NO_HOLDER, label: 'Thiếu người giữ', sub: '' };
  if (!(qty > 0))  return { code: VT_ST_NO_QTY,    label: 'Thiếu số lượng',  sub: '' };
  if (typeof avail === 'number' && qty > avail) {
    return { code: VT_ST_NO_STOCK, label: 'Không đủ tồn', sub: '' };
  }

  return { code: VT_ST_WAIT, label: 'Chờ xuất kho', sub: mat.name };
}

/** Mảng khoá vân tay, xếp ĐÚNG CHỈ SỐ với getChiPhiCached_(). Tính MD5 1 lần/TTL thay vì mỗi lần lật trang. */
function getChiPhiKeysCached_(forceRefresh) {
  return getCachedOrCompute_('chiphi_keys_v2', CACHE_TTL_FAST, function () {
    return buildChiPhiKeys_(getChiPhiCached_());
  }, forceRefresh);
}

/** Khoá vân tay kiểu cũ, xếp đúng chỉ số với getChiPhiCached_() — để nhận ra sổ log chưa đổi sang ID. */
function getChiPhiLegacyKeysCached_(forceRefresh) {
  return getCachedOrCompute_('chiphi_legacykeys_v1', CACHE_TTL_FAST, function () {
    return buildChiPhiLegacyKeys_(getChiPhiCached_());
  }, forceRefresh);
}

function readVatTuAutoLogMap_() {
  const sh = ensureVatTuAutoLogSheet_();
  const lastRow = sh.getLastRow();
  const map = {};
  if (lastRow < 2) return map;
  sh.getRange(2, 1, lastRow - 1, 6).getValues().forEach(function (r) {
    const k = String(r[0] || '');
    if (k) map[k] = { qty: Number(r[4]) || 0, holder: String(r[5] || '') };
  });
  return map;
}

function getVatTuAutoLogMapCached_(forceRefresh) {
  return getCachedOrCompute_('vattu_autolog_v1', CACHE_TTL_FAST, readVatTuAutoLogMap_, forceRefresh);
}


function getVatTuTrackingList(opts) {
  opts = opts || {};
  const q = String(opts.query || '').trim();
  const staff = String(opts.staff || '').trim();
  const year = String(opts.year || '').trim();
  const month = String(opts.month || '').trim();
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Number(opts.pageSize) || 20;
  const statusFilter = String(opts.status || '').trim();

  const data = getVatTuData();
  const stores = getStoresCached_();
  const addrByCC = {};
  stores.forEach(function (s) { addrByCC[normalizeCC_(s[COLS.STORE_COST_CENTER])] = s[COLS.STORE_ADDRESS]; });

  const cpRows = getChiPhiCached_();
  const keys = getChiPhiKeysCached_();       // xếp đúng chỉ số với cpRows
  /* Sổ log có thể còn khoá vân tay cũ (trước lần "Khớp vật tư" đầu tiên sau khi có cột ID) */
  const legacyKeys = getChiPhiLegacyKeysCached_();
  const logOf = function (i) { return logMap[keys[i]] || logMap[legacyKeys[i]]; };
  const logMap = getVatTuAutoLogMapCached_();
  const matcher = buildVatTuMatcher_(data.materials);   // dựng MỘT LẦN cho cả vòng lặp

    /* MÔ PHỎNG TRANH TỒN KHO — bảng này phải dự đoán ĐÚNG những gì nút "Khớp vật tư" sẽ làm.
     So từng dòng với tồn GỐC là sai: tồn 5, ba dòng cần 3/3/2 thì cả ba đều báo "Chờ xuất kho",
     trong khi thực tế dòng 2 sẽ không đủ. Nên giữ một bản sao tồn kho trong bộ nhớ và trừ dần y
     hệt runVatTuAutoDeduction, dùng CHUNG vtAllocOrder_ để hai bên không lệch thứ tự. */
  const simStock = {};
  data.materials.forEach(function (m) {
    simStock[m.code] = {};
    Object.keys(m.qty || {}).forEach(function (h) { simStock[m.code][h] = Number(m.qty[h]) || 0; });
  });

  const availByIdx = {};
  cpRows
    .map(function (r, i) { return { i: i, t: vtRowTime_(r[COLS.CP_DATE]) }; })
    .sort(vtAllocOrder_)
    .forEach(function (o) {
      const r = cpRows[o.i];
      if (!isVatTuRow_(r)) return;

      const res = vtMatch_(matcher, r[COLS.CP_ITEM]);
      const match = vtMatchAccepted_(res) ? res.material : null;
      if (!match) return;
      const holder = matchVatTuHolder_(r[COLS.CP_STAFF], data.holders);
      if (!holder) return;

      const avail = (simStock[match.code] && simStock[match.code][holder]) || 0;
      availByIdx[o.i] = avail;

            /* Dòng ĐÃ trong sổ log thì kho đã trừ từ trước — tồn hiện tại vốn đã phản ánh nó, trừ thêm
         lần nữa trong mô phỏng là đếm đôi. */
      if (logOf(o.i)) return;

      const qty = Number(r[COLS.CP_QTY]) || 0;
      if (qty > 0 && qty <= avail) simStock[match.code][holder] = avail - qty;
    });

  let rows = cpRows
    .map(function (r, i) {
      // Chỉ dòng của NCC vật tư mới thuộc phạm vi tab này
      if (!isVatTuRow_(r)) return null;

      /* Trong phạm vi TD LIGHTING thì dòng chưa khớp vật tư là tín hiệu THẬT (thiếu danh mục hoặc
         hạng mục ghi lệch chữ), nên luôn hiện và gắn nhãn "Chưa khớp vật tư" — không lọc bỏ, cũng
         không cần công tắc bật/tắt như bản trước. */
      const res = vtMatch_(matcher, r[COLS.CP_ITEM]);
      const match = vtMatchAccepted_(res) ? res.material : null;
      const holder = match ? matchVatTuHolder_(r[COLS.CP_STAFF], data.holders) : null;
      const qty = Number(r[COLS.CP_QTY]) || 0;
      const st = vatTuRowStatus_(match, holder, qty, logOf(i), res, availByIdx[i]);

      return {
        source: r[COLS.CP_SUPPLIER] || 'Khác',
        // NGUYÊN VĂN trên sheet CHI PHÍ. Bản cũ thay bằng tên danh mục nên khi bật khớp gần đúng
        // sẽ không còn đối chiếu được máy khớp đúng hay sai.
        item: String(r[COLS.CP_ITEM] || '').trim(),
        matchedName: match ? match.name : '',
        matched: !!match,
        qty: qty,
        staff: r[COLS.CP_STAFF],
        address: addrByCC[normalizeCC_(r[COLS.CP_COST_CENTER])] || r[COLS.CP_STORE_NAME] || '',
        date: normalizeDate_(r[COLS.CP_DATE]),
        dateRaw: r[COLS.CP_DATE],
        status: st.code,
        statusLabel: st.label,
        statusSub: st.sub || ''
      };
    })
    .filter(function (r) { return r; });

  /* Bộ đếm phải tính TRƯỚC khi lọc trạng thái. Nếu tính sau, bấm vào một thẻ là các thẻ khác về 0
     rồi biến mất, không chuyển sang trạng thái khác được nữa. */
  const countsAll = {};
  countsAll[VT_ST_DONE] = 0; countsAll[VT_ST_WAIT] = 0;
  countsAll[VT_ST_NO_HOLDER] = 0; countsAll[VT_ST_NO_QTY] = 0; countsAll[VT_ST_NO_ITEM] = 0;
  countsAll[VT_ST_NO_STOCK] = 0;
  rows.forEach(function (r) { countsAll[r.status] = (countsAll[r.status] || 0) + 1; });

  if (statusFilter) rows = rows.filter(function (r) { return r.status === statusFilter; });

  if (staff) rows = rows.filter(function (r) { return String(r.staff || '').trim() === staff; });
  if (year) rows = rows.filter(function (r) { return extractYear_(r.dateRaw) === Number(year); });
  if (month) rows = rows.filter(function (r) {
    const k = chiPhiMonthKey_(r.dateRaw);
    return k && k.split('-')[1] === pad2_(month);
  });

  if (q) {
    rows = rows.filter(function (r) {
      const haystack = [r.staff, r.item, r.source, r.address].join(' | ');
      return smartMatch_(haystack, q);
    });
  }

  rows = rows.sort(function (a, b) {
    return parseVnDate_(normalizeDate_(b.dateRaw)) - parseVnDate_(normalizeDate_(a.dateRaw));
  });

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize).map(function (r) {
    return {
      source: r.source, item: r.item, qty: r.qty, staff: r.staff, address: r.address, date: r.date,
      matched: r.matched, matchedName: r.matchedName,
      status: r.status, statusLabel: r.statusLabel, statusSub: r.statusSub
    };
  });

  return { rows: pageRows, total: total, page: page, pageSize: pageSize, counts: countsAll };
}

/**
 * trackOpts là bộ lọc riêng của tab "Theo dõi sử dụng" (staff/year/month/query). Tab đó chưa chọn
 * năm/tháng thì lấy theo bộ lọc chung ở đầu trang.
 *
 * PHẢI truyền đủ year/month/staff xuống getVatTuTrackingList, bỏ sót là sheet "TheoDoiSuDung" xuất
 * ra toàn bộ thời gian trong khi "TheoThang" lại đúng bộ lọc.
 */
function exportVatTuExcel(yearFilter, monthFilter, trackOpts) {
  trackOpts = trackOpts || {};
  /* KHÔNG mượn yearFilter/monthFilter của khối "Vật tư theo tháng" nữa.
     Trong giao diện, <option value=""> chính là "Tất cả" — tức chuỗi rỗng là một LỰA CHỌN, không
     phải "chưa chọn gì". Toán tử || coi chuỗi rỗng là falsy nên "Tất cả tháng" bị hiểu thành
     "chưa chọn" rồi mượn tháng của khối trên: màn hình hiện đủ 216 dòng mà Excel chỉ ra tháng 6.
     Hai khối có bộ lọc riêng thì phải xuất theo bộ lọc riêng. Mỗi sheet đã tự in dòng
     "Phạm vi lọc" ở đầu nên mở file ra là biết ngay sheet nào đang ở phạm vi nào. */
  const trackYear = String(trackOpts.year || '');
  const trackMonth = String(trackOpts.month || '');
  const trackStaff = String(trackOpts.staff || '');
  const trackQuery = String(trackOpts.query || '');

  const vt = getVatTuData();
  const byStaff = getVatTuByStaffMonth(yearFilter || '', monthFilter || '');
  const full = getVatTuTrackingList({
    query: trackQuery, staff: trackStaff, year: trackYear, month: trackMonth,
    status: String(trackOpts.status || ''),
    page: 1, pageSize: 100000
  });

  // Ghi rõ phạm vi lọc lên đầu mỗi sheet để người nhận file biết đang xem khoảng nào
  function scopeText(y, m, st, q) {
    const bits = ['Năm: ' + (y || 'Tất cả'), 'Tháng: ' + (m ? pad2_(m) : 'Tất cả')];
    if (st) bits.push('Nhân viên: ' + st);
    if (q) bits.push('Từ khoá: ' + q);
    return bits.join('  ·  ');
  }

  const tempSs = SpreadsheetApp.create('TAM_XUAT_VATTU_' + Date.now());
  try {
    const defaultSheet = tempSs.getSheets()[0];

    function writeSheet(name, headers, rows, scope) {
      const sh = tempSs.insertSheet(name);
      let r = 1;
      if (scope) {
        sh.getRange(1, 1, 1, headers.length).merge();
        sh.getRange(1, 1).setValue('Phạm vi lọc — ' + scope).setFontWeight('bold');
        r = 2;
      }
      sh.getRange(r, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      if (rows.length) sh.getRange(r + 1, 1, rows.length, headers.length).setValues(rows);
      sh.setFrozenRows(r);
    }

    writeSheet('TonKho', ['Mã vật tư', 'Tên vật tư', 'Yêu cầu kỹ thuật'].concat(vt.holders, ['Tổng']),
      vt.materials.map(function (m) {
        return [m.code, m.name, m.spec].concat(vt.holders.map(function (h) { return m.qty[h] || 0; }), [m.total]);
      }), 'Tồn kho tại thời điểm xuất file — không phụ thuộc bộ lọc tháng/năm');

    writeSheet('TheoThang', ['Tên vật tư'].concat(byStaff.staffList, ['Tổng']),
      byStaff.materials.map(function (m) {
        return [m.name].concat(byStaff.staffList.map(function (s) { return m.byStaff[s] || 0; }), [m.total]);
      }), scopeText(yearFilter, monthFilter, '', ''));

    writeSheet('TheoDoiSuDung',
      /* Cột cuối là TÊN VẬT TƯ trong danh mục mà máy khớp được — chính là dòng phụ hiện dưới thẻ
         trạng thái trên giao diện. Cột "Hạng mục vật tư" giữ nguyên văn trên sheet CHI PHÍ, nên
         phải có cột này mới đối chiếu được máy khớp đúng hay sai. Dòng "Chưa khớp vật tư" thì đây
         là ứng viên gần nhất, xem cột "Trạng thái" để biết. */
      ['Nguồn', 'Ngày hoàn thành', 'Hạng mục vật tư', 'Số lượng', 'NV Phụ trách', 'Địa chỉ', 'Trạng thái', 'Vật tư khớp'],
      full.rows.map(function (r) {
        return [r.source, r.date, r.item, r.qty, r.staff, r.address, r.statusLabel, r.statusSub];
      }),
      scopeText(trackYear, trackMonth, trackStaff, trackQuery));

    tempSs.deleteSheet(defaultSheet);
    SpreadsheetApp.flush();

    const url = 'https://docs.google.com/spreadsheets/d/' + tempSs.getId() + '/export?format=xlsx';
    const resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error('Không xuất được file Excel (mã lỗi ' + resp.getResponseCode() + ').');
    }
    const label = (yearFilter || monthFilter) ? ('_' + (yearFilter || 'tatca') + (monthFilter ? '-' + pad2_(monthFilter) : '')) : '';
    const blob = resp.getBlob().setName('VatTu' + label + '.xlsx');
    return { success: true, base64: Utilities.base64Encode(blob.getBytes()), filename: blob.getName() };
  } finally {
    try { DriveApp.getFileById(tempSs.getId()).setTrashed(true); } catch (e2) { /* bỏ qua nếu đã xoá */ }
  }
}

// ============================== VẬT TƯ — TỰ ĐỘNG TRỪ TỒN KHO THEO CHI PHÍ MỚI ==============================

const SHEET_VATTU_AUTO_LOG = 'VAT TU TU DONG TRU';
const PROP_AUTOLOG_VERSION = 'vattu_autolog_version';
const AUTOLOG_VERSION = 2;

function ensureVatTuAutoLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_VATTU_AUTO_LOG);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_VATTU_AUTO_LOG);
  sh.getRange(1, 1, 1, 6).setValues([['Khoá dòng', 'Ngày xử lý', 'Mã vật tư', 'Tên vật tư', 'Số lượng đã trừ', 'Người bị trừ']]);
  sh.hideSheet();
  return sh;
}

/**
 * VÂN TAY NỘI DUNG của một dòng CHI PHÍ — thay cho số dòng vật lý.
 *
 * LỖI CŨ NGHIÊM TRỌNG: bản trước dùng `r.__row` (số dòng trên sheet) làm khoá chống trùng. Số
 * dòng KHÔNG ổn định:
 *   - Sắp xếp lại sheet  -> dữ liệu cũ sang dòng khác -> bị TRỪ LẦN HAI.
 *   - Chèn/xoá một dòng  -> mọi dòng phía dưới đổi số -> trừ lại hàng loạt.
 *   - Dòng mới rơi đúng số dòng đã ghi log -> BỊ BỎ QUA vĩnh viễn.
 *
 * Vân tay dựng từ chính nội dung nên dữ liệu không đổi thì khoá không đổi, bất kể sheet có sắp
 * xếp hay chèn/xoá dòng.
 */
function chiPhiFingerprint_(r) {
  const parts = [
    normalizeCC_(r[COLS.CP_COST_CENTER]),
    cleanCode_(r[COLS.CP_ASSET_CODE]),
    normalizeDate_(r[COLS.CP_DATE]),
    String(r[COLS.CP_ITEM] || '').trim(),
    String(r[COLS.CP_ISSUE] || '').trim(),
    String(r[COLS.CP_STAFF] || '').trim(),
    String(Number(r[COLS.CP_QTY]) || 0),
    String(Number(r[COLS.CP_COST]) || 0)
  ].join('||');

  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts, Utilities.Charset.UTF_8);
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
  }
  return hex;
}

/**
 * Gắn số thứ tự cho các dòng TRÙNG NHAU HOÀN TOÀN.
 * Nếu CHI PHÍ có 2 dòng giống hệt nhau thì chúng cùng vân tay; không đánh số thì chỉ 1 dòng được
 * trừ. Số thứ tự phụ thuộc số lượng bản trùng chứ không phụ thuộc thứ tự dòng, nên tập khoá vẫn
 * giữ nguyên sau khi sắp xếp lại sheet.
 */
function buildChiPhiLegacyKeys_(cpRows) {
  const seen = {};
  return cpRows.map(function (r) {
    const fp = chiPhiFingerprint_(r);
    seen[fp] = (seen[fp] || 0) + 1;
    return fp + '#' + seen[fp];
  });
}

/** ID cố định của dòng CHI PHÍ (cột ẩn "ID" do Sync.gs tự điền); '' nếu dòng chưa có. */
function chiPhiRowId_(r) {
  return String((r && r[COLS.CP_ID]) || '').trim();
}

/**
 * Khoá của từng dòng CHI PHÍ để đánh dấu "đã trừ kho".
 * Dòng có ID cố định -> dùng ID: sửa nội dung dòng KHÔNG đổi khoá nên không bao giờ bị trừ lại.
 * Dòng chưa có ID (Sync.gs bản cũ chưa điền) -> dùng vân tay nội dung như trước.
 */
function buildChiPhiKeys_(cpRows) {
  const legacy = buildChiPhiLegacyKeys_(cpRows);
  return cpRows.map(function (r, i) { return chiPhiRowId_(r) || legacy[i]; });
}

function matchVatTuHolder_(staffFreeText, holders) {
  const hay = stripAccents_(staffFreeText);
  if (!hay) return null;
  let best = null, bestLen = 0;
  holders.forEach(function (h) {
    const name = stripAccents_(h);
    if (!name) return;
    if (wordStartMatch_(hay, name) && name.length > bestLen) { best = h; bestLen = name.length; }
  });
  return best;
}

/**
 * CHUYỂN ĐỔI MỘT LẦN từ khoá theo-số-dòng sang khoá theo-nội-dung.
 *
 * Log cũ ghi số dòng nên không suy ra được vân tay tương ứng. Theo phương án đã chốt: đánh dấu
 * TOÀN BỘ dòng CHI PHÍ hiện có là ĐÃ XỬ LÝ và KHÔNG trừ gì cả. An toàn tuyệt đối — không có nguy
 * cơ trừ trùng toàn bộ lịch sử. Đổi lại, các dòng trước đây chưa từng được trừ (do chưa khớp được
 * vật tư/người giữ) sẽ không được trừ bù; nếu cần thì chỉnh tay tồn kho cho các dòng đó.
 */
function migrateVatTuAutoLog_(cpRows, keys) {
  const props = PropertiesService.getScriptProperties();
  if (Number(props.getProperty(PROP_AUTOLOG_VERSION) || 0) >= AUTOLOG_VERSION) return false;

  const sh = ensureVatTuAutoLogSheet_();
  sh.clear();
  sh.getRange(1, 1, 1, 6).setValues([['Khoá dòng', 'Ngày xử lý', 'Mã vật tư', 'Tên vật tư', 'Số lượng đã trừ', 'Người bị trừ']]);

  const today = Utilities.formatDate(new Date(), getSpreadsheetTimeZone_(), 'dd/MM/yyyy');
  const rows = keys.map(function (k) {
    return [k, today, '', '(khởi tạo khoá nội dung — không trừ)', 0, ''];
  });
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, 6).setValues(rows);
  }
  props.setProperty(PROP_AUTOLOG_VERSION, String(AUTOLOG_VERSION));
  Logger.log('migrateVatTuAutoLog_: đã đánh dấu ' + rows.length + ' dòng CHI PHÍ là đã xử lý.');
  return true;
}

/**
 * Thứ tự TRANH TỒN KHO giữa các dòng chờ xử lý.
 *
 * Tồn 5, hai dòng mỗi dòng cần 3 -> dòng chạy trước lấy được hàng, dòng sau thành "không đủ tồn".
 * Nên thứ tự duyệt là quyết định nghiệp vụ, không phải tiểu tiết.
 *
 * Sắp theo NGÀY TĂNG DẦN: việc làm trước lấy tồn trước, kết quả không đổi dù sheet có bị sắp lại.
 * Chỉ số dòng làm tiêu chí phụ khi trùng ngày. Dòng không đọc được ngày đẩy xuống cuối.
 *
 * MUỐN QUAY VỀ THỨ TỰ SHEET: sửa thành `return a.i - b.i;`. Nhớ rằng getVatTuTrackingList dùng
 * CHUNG hàm này — sửa một chỗ là xong, nhưng đổi ở đây thì bảng theo dõi cũng đổi theo.
 */
function vtAllocOrder_(a, b) {
  const da = a.t, db = b.t;
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }
  return a.i - b.i;
}

/** Mốc thời gian để sắp xếp; null nếu ô ngày trống hoặc không đọc được.
 *  parseVnDate_ KHÔNG trả null khi thất bại — nó trả new Date(0). Nhận số 0 đó là ngày thật thì
 *  mọi dòng hỏng ngày thành "cũ nhất" và giành tồn trước tất cả. */
function vtRowTime_(dateRaw) {
  try {
    const t = parseVnDate_(normalizeDate_(dateRaw)).getTime();
    return (!t || isNaN(t)) ? null : t;
  } catch (e) {
    return null;
  }
}

/**
 * Tự động trừ tồn kho vật tư theo các dòng CHI PHÍ mới.
 * Chỉ chạy khi bấm nút "Khớp vật tư" trong tab Vật tư (có hỏi mật khẩu).
 *
 * Năm điểm cần nhớ:
 *  1) Khoá chống trùng là VÂN TAY NỘI DUNG, không phải số dòng (xem chiPhiFingerprint_).
 *  2) Có LockService — hai người bấm cùng lúc thì cả hai cùng đọc một danh sách đã xử lý -> TRỪ ĐÔI.
 *  3) Gom ghi bằng setVatTuQtyBulk_ theo từng người giữ, mỗi người đúng MỘT lần ghi cột.
 *  4) KHÔNG ghi log dòng chưa khớp được vật tư/người giữ. Ghi vào là dòng đó bị đánh dấu đã xử lý
 *     vĩnh viễn — sau này bổ sung danh mục cũng không bao giờ trừ được nữa.
 *  5) KHÔNG ĐỦ TỒN THÌ KHÔNG TRỪ GÌ CẢ. Trừ một phần mà log ghi số YÊU CẦU thì báo cáo nói xuất 5
 *     trong khi kho chỉ giảm 2. Dòng thiếu tồn để nguyên, không ghi log, hiện "Không đủ tồn";
 *     nhập thêm kho rồi bấm lại là trừ trọn vẹn.
 */
function runVatTuAutoDeduction() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, processed: 0, message: 'Một tiến trình trừ vật tư khác đang chạy, bỏ qua lần này.' };
  }

  try {
    // Dùng CHUNG nguồn cache với getVatTuTrackingList để hai bên không bao giờ lệch chỉ số.
    const cpRows = getChiPhiCached_();
    const data = getVatTuData();
    if (!cpRows.length || !data.materials.length || !data.holders.length) {
      return { success: true, processed: 0, skipped: 0, shorted: 0 };
    }

    const keys = getChiPhiKeysCached_();
    const legacyKeys = buildChiPhiLegacyKeys_(cpRows);   // sổ log cũ có thể còn khoá vân tay
    const matcher = buildVatTuMatcher_(data.materials);

    // Lần chạy đầu sau khi nâng cấp: chỉ đánh dấu, không trừ gì
    if (migrateVatTuAutoLog_(cpRows, keys)) {
      getVatTuAutoLogMapCached_(true);   // sổ log vừa đổi -> dựng lại ngay
      return { success: true, processed: 0, skipped: cpRows.length, shorted: 0, migrated: cpRows.length };
    }

    const logSheet = ensureVatTuAutoLogSheet_();
    const lastRow = logSheet.getLastRow();
    const processedKeys = new Set();
    if (lastRow >= 2) {
      logSheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r) {
        processedKeys.add(String(r[0]));
      });
    }

    const byCode = {};
    data.materials.forEach(function (m) { byCode[m.code] = m; });

    const today = Utilities.formatDate(new Date(), getSpreadsheetTimeZone_(), 'dd/MM/yyyy');
    const newLogRows = [];
    const pending = {};   // pending[holder][code] = số lượng còn lại sau khi trừ
    let processedCount = 0, skippedCount = 0, shortedCount = 0;
    /* Đếm RIÊNG tổng số dòng chưa khớp trên toàn bộ phạm vi, KỂ CẢ dòng đã đánh dấu xử lý.
       Bảng theo dõi đếm theo cách này (vatTuRowStatus_ xét !mat TRƯỚC sổ log) nên nếu chỉ trả về
       skippedCount — chỉ tính dòng MỚI — thì toast báo "1 dòng chưa khớp" trong khi bảng hiện 35,
       hai con số không đối chiếu được với nhau. */
    let unmatchedTotal = 0;

    /* Sắp theo ngày TRƯỚC khi duyệt. Giữ lại chỉ số gốc `i` vì keys[i] phải khớp đúng dòng. */
    const order = cpRows
      .map(function (r, i) { return { i: i, t: vtRowTime_(r[COLS.CP_DATE]) }; })
      .sort(vtAllocOrder_);

    order.forEach(function (o) {
      const i = o.i;
      const r = cpRows[i];
      const key = keys[i];

      /* Ngoài phạm vi NCC vật tư -> bỏ qua HOÀN TOÀN, không ghi log và không tính vào skipped.
         Đây không phải dòng lỗi, chỉ là dòng chi phí không liên quan tới kho vật tư. */
      if (!isVatTuRow_(r)) return;

      const res = vtMatch_(matcher, r[COLS.CP_ITEM]);
      const mat = vtMatchAccepted_(res) ? res.material : null;
      const holder = matchVatTuHolder_(r[COLS.CP_STAFF], data.holders);
      const qty = Number(r[COLS.CP_QTY]) || 0;
      const unmatched = (!mat || !holder || qty <= 0);
      if (unmatched) unmatchedTotal++;

      /* Chốt "đã xử lý" phải xét SAU khi khớp, để unmatchedTotal đếm được cả dòng cũ. Vẫn đứng
         TRƯỚC mọi thao tác ghi nên không có nguy cơ trừ kho hai lần. */
      if (processedKeys.has(key) || processedKeys.has(legacyKeys[i])) return;

      // Chưa khớp được -> BỎ QUA, KHÔNG ghi log, để lần sau bổ sung danh mục là trừ được
      if (unmatched) { skippedCount++; return; }

      const matRef = byCode[mat.code];
      const current = matRef.qty[holder] || 0;

            /* Không đủ -> bỏ qua nguyên dòng, tồn GIỮ NGUYÊN, không ghi log. Không "giữ chỗ" phần tồn
         còn lại: dòng nhỏ hơn đứng sau vẫn được lấy nốt. */
      if (qty > current) { shortedCount++; return; }

      const updated = current - qty;
      matRef.qty[holder] = updated;                       // cập nhật trong bộ nhớ

      if (!pending[holder]) pending[holder] = {};
      pending[holder][mat.code] = updated;                // ghi xuống sheet một lần ở cuối

      newLogRows.push([key, today, mat.code, mat.name, qty, holder]);
      processedCount++;
    });

    // Gom ghi: mỗi người giữ đúng MỘT lần ghi cột
    Object.keys(pending).forEach(function (holder) {
      const items = Object.keys(pending[holder]).map(function (code) {
        return { code: code, qty: pending[holder][code] };
      });
      // PHẢI gọi bản lõi `_`: hàm này đang GIỮ khoá, gọi bản có khoá là tự khoá chính mình.
      if (items.length) setVatTuQtyBulk_(holder, items);
    });

    if (newLogRows.length) {
      const startRow = logSheet.getLastRow() + 1;
      logSheet.getRange(startRow, 1, newLogRows.length, 2).setNumberFormat('@');
      logSheet.getRange(startRow, 1, newLogRows.length, 6).setValues(newLogRows);
    }

        /* BẮT BUỘC dựng lại cache sổ log ngay tại đây, nếu không các dòng vừa trừ xong vẫn hiện
       "Chờ xuất kho" cho tới khi cache hết hạn 35 phút — nhìn như hỏng. */
    getVatTuAutoLogMapCached_(true);

    return {
      success: true,
      processed: processedCount,
      skipped: skippedCount,
      shorted: shortedCount,
      unmatchedTotal: unmatchedTotal,
      scanned: cpRows.length
    };
  } finally {
    lock.releaseLock();
  }
}


// ============================== LÀM MỚI DỮ LIỆU ==============================

const PROP_CACHE_OK = 'cache_last_success';
const PROP_CACHE_ERR = 'cache_last_error';

const CACHE_KEYS_FAST_ = ['stores_raw_v2', 'assets_raw_v2', 'maint_raw_v2', 'chiphi_raw_v2',
                          'chiphi_keys_v2', 'chiphi_legacykeys_v1', 'ncctabs_v1', 'vattu_autolog_v1', 'sanaky_raw_v2'];
const CACHE_KEYS_SLOW_ = ['dongia_bt_v1', 'dongia_xd_v1', 'dongia_snk_v1'];

/** true nếu cache của key này còn sống */
function isCacheWarm_(key) {
  try { return !!CacheService.getScriptCache().get(key + '__meta'); } catch (e) { return false; }
}

/**
 * Mốc thời gian dữ liệu được nạp lại từ Google Sheet gần nhất — dùng cho dòng
 * "Cập nhật lần cuối" cạnh nút "Làm mới dữ liệu" trên giao diện.
 *
 * CHỈ đọc Script Property, TUYỆT ĐỐI không đọc sheet nào: hàm này chạy ngay lúc mở trang nên
 * phải nhẹ. Giá trị do recordCacheStatus_() ghi, tức là được cập nhật cả khi trigger nền
 * silentRefreshCache() chạy lẫn khi người dùng bấm "Làm mới dữ liệu".
 *
 * Trả về chuỗi ISO (UTC) hoặc null nếu chưa có lần nạp thành công nào. Việc đổi sang giờ Việt Nam
 * và định dạng HH:mm dd/MM/yyyy do phía client làm.
 */
function getDataLastUpdated() {
  try {
    return PropertiesService.getScriptProperties().getProperty(PROP_CACHE_OK) || null;
  } catch (e) {
    return null;
  }
}

function recordCacheStatus_(ok, message) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (ok) {
      props.setProperty(PROP_CACHE_OK, new Date().toISOString());
      props.deleteProperty(PROP_CACHE_ERR);
    } else {
      props.setProperty(PROP_CACHE_ERR, new Date().toISOString() + ' — ' + message);
    }
  } catch (e) { /* bỏ qua */ }
}

/**
 * Nạp lại các cache dữ liệu biến động (KHÔNG gồm Đơn giá).
 * Tách riêng khỏi refreshData() vì refreshData() còn chạy runVatTuAutoDeduction() — thao tác GHI
 * vào kho vật tư, tuyệt đối không được để một trigger nền tự động chạy.
 */
function warmFastCaches_() {
  getStoresCached_(true);
  getAssetsCached_(true);
  getMaintCached_(true);
  getChiPhiCached_(true);
  getChiPhiKeysCached_(true);      // mảng vân tay, phải dựng SAU chiphi
  getVatTuAutoLogMapCached_(true);
  readSanakyRepairs_(true);
}

function warmSlowCaches_() {
  getDonGiaData('bt', true);
  getDonGiaData('xd', true);
  getDonGiaData('snk', true);
}

/**
 * Chạy nền theo trigger 30 phút để cache luôn "nóng", nhờ đó người dùng gần như không bao giờ
 * phải chờ đọc lại Google Sheet.
 *
 * CHỈ ĐỌC — không gọi runVatTuAutoDeduction(). Đơn giá có TTL 6 tiếng nên chỉ dựng lại khi cache
 * của nó đã hết hạn, tránh đọc thừa 3 sheet đơn giá 48 lần/ngày.
 */
function silentRefreshCache() {
  try {
    warmFastCaches_();
    const needSlow = CACHE_KEYS_SLOW_.some(function (k) { return !isCacheWarm_(k); });
    if (needSlow) warmSlowCaches_();
    recordCacheStatus_(true, '');
  } catch (e) {
    recordCacheStatus_(false, e.message);
    Logger.log('silentRefreshCache lỗi: ' + e.message);
  }
}

/**
 * CHẠY HÀM NÀY 1 LẦN DUY NHẤT sau khi deploy (chọn "setupAutoRefreshTrigger" trong dropdown của
 * trình soạn thảo Apps Script rồi bấm Run) để bật trigger nạp nền 30 phút/lần.
 */
function setupAutoRefreshTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'silentRefreshCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('silentRefreshCache').timeBased().everyMinutes(30).create();
  return { success: true, message: 'Đã bật trigger nạp cache nền 30 phút/lần.' };
}

/**
 * Soi "sức khoẻ" cache. Chạy thủ công trong trình soạn thảo, xem kết quả ở Execution log.
 *
 * Hai dấu hiệu cần để ý:
 *  - warmKeys thiếu key nào -> cache của phần đó đang không ghi được (xem lastCacheError).
 *  - stale = true (lần nạp thành công gần nhất đã quá 2 tiếng) -> trigger nhiều khả năng đã chết,
 *    app vẫn chạy nhưng chậm dần mà không báo lỗi gì.
 */
function getRefreshStatus() {
  const props = PropertiesService.getScriptProperties();
  const lastOk = props.getProperty(PROP_CACHE_OK);
  const lastErr = props.getProperty(PROP_CACHE_ERR);

  let ageMinutes = null, stale = true;
  if (lastOk) {
    ageMinutes = Math.round((Date.now() - new Date(lastOk).getTime()) / 60000);
    stale = ageMinutes > 120;
  }

  let triggerCount = 0;
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'silentRefreshCache') triggerCount++;
    });
  } catch (e) { /* bỏ qua */ }

  const allKeys = CACHE_KEYS_FAST_.concat(CACHE_KEYS_SLOW_);
  const status = {
    lastSuccess: lastOk || '(chưa lần nào)',
    minutesSinceLastSuccess: ageMinutes,
    lastCacheError: lastErr || '(không có)',
    triggerInstalled: triggerCount > 0,
    stale: stale,
    warmKeys: allKeys.filter(isCacheWarm_),
    coldKeys: allKeys.filter(function (k) { return !isCacheWarm_(k); })
  };
  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

/**
 * Nút "Làm mới dữ liệu" trên giao diện — CHỈ ĐỌC, chỉ nạp lại cache.
 * Việc trừ kho nằm ở nút "Khớp vật tư" riêng trong tab Vật tư.
 */
function refreshData() {
  warmFastCaches_();
  warmSlowCaches_();
  recordCacheStatus_(true, '');
  return { success: true, refreshedAt: new Date().toISOString() };
}

/* ============================== CHẨN ĐOÁN CACHE ============================== */

// CacheService chặn CỨNG 100KB mỗi key (tính theo byte) và dọn theo kiểu FIFO quanh mốc ~1000 key.
// Với app này, ràng buộc nguy hiểm là SỐ LƯỢNG key chứ không phải kích thước key: sheetToObjects_
// lưu object với TÊN CỘT tiếng Việt lặp trên từng dòng, tốn gấp đôi so với lưu mảng.
const CACHE_LIMIT_BYTES_ = 102400;
const CACHE_WARN_BYTES_ = 92160;    // 90KB — còn 10% biên thì cảnh báo
const CACHE_KEY_LIMIT_ = 1000;
const CACHE_KEY_WARN_ = 800;

/**
 * Đếm byte UTF-8 bằng vòng lặp thuần. Không dùng Utilities.newBlob().getBytes().length vì đó là
 * lời gọi dịch vụ, nhân với hàng trăm chunk sẽ rất chậm. Surrogate pair tính 4 byte, bỏ nửa sau.
 */
function utf8Len_(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/**
 * ĐO TẢI CACHE THỰC TẾ. Chạy thủ công: chọn kiemTraCache -> Run -> xem Execution log.
 *
 * Hàm CHỈ ĐỌC. Chạy NGAY SAU khi mở app hoặc bấm "Làm mới dữ liệu"; chạy lúc cache nguội thì mọi
 * key đều báo NGUỘI và báo cáo vô nghĩa.
 *
 * Bổ sung đúng chỗ mù của getRefreshStatus(): hàm đó chỉ kiểm tra khoá __meta có tồn tại không,
 * nên khi meta còn sống mà vài chunk đã bị dọn FIFO thì nó vẫn báo warm, coldKeys vẫn rỗng —
 * trong khi cacheGetJSON_ trả null và mọi lượt truy cập đều đọc thẳng Google Sheet.
 */
function kiemTraCache() {
  const cache = CacheService.getScriptCache();
  const out = [];
  let tongChunk = 0, tongByte = 0, soKeyCoData = 0, soNguoi = 0, coCanhBao = false;

  out.push('===== TẢI CACHE THỰC TẾ — ' +
    Utilities.formatDate(new Date(), getSpreadsheetTimeZone_(), 'HH:mm dd/MM/yyyy') + ' =====');
  out.push('CACHE_CHUNK_SIZE = ' + CACHE_CHUNK_SIZE + ' ký tự · trần 100KB/key · mốc dọn FIFO ~1000 key');
  out.push('');

  function soi(tenNhom, keys) {
    out.push('── ' + tenNhom + ' ──');
    keys.forEach(function (key) {
      const metaRaw = cache.get(key + '__meta');
      if (!metaRaw) { soNguoi++; out.push('· ' + key + ': NGUỘI'); return; }

      let meta;
      try {
        meta = JSON.parse(metaRaw);
      } catch (e) {
        coCanhBao = true;
        out.push('· ' + key + ': META HỎNG — ' + e.message);
        return;
      }

      const n = meta.n || 0;
      let byteCua = 0, chunkNang = 0, soThieu = 0;

      // Đọc theo lô 50 key để không kéo cả chục MB vào bộ nhớ cùng lúc
      for (let i = 0; i < n; i += 50) {
        const lo = [];
        for (let j = i; j < Math.min(i + 50, n); j++) lo.push(key + '__' + j);
        const map = cache.getAll(lo);
        soThieu += lo.length - Object.keys(map).length;
        Object.keys(map).forEach(function (k) {
          const b = utf8Len_(map[k]);
          byteCua += b;
          if (b > chunkNang) chunkNang = b;
        });
      }

      tongChunk += n;
      tongByte += byteCua;
      soKeyCoData++;

      out.push('· ' + key + ': ' + n + ' chunk | ' + (byteCua / 1048576).toFixed(2) + ' MB | nặng nhất ' +
        (chunkNang / 1024).toFixed(1) + ' KB (' + Math.round(chunkNang / CACHE_LIMIT_BYTES_ * 100) + '% trần)');

      if (soThieu > 0) {
        coCanhBao = true;
        out.push('    ✘ THIẾU ' + soThieu + '/' + n + ' chunk — cacheGetJSON_ trả null, key này đang đọc');
        out.push('      thẳng Google Sheet ở MỌI lượt. getRefreshStatus() KHÔNG phát hiện được ca này.');
      }
      if (chunkNang > CACHE_WARN_BYTES_) {
        coCanhBao = true;
        out.push('    ⚠ chunk nặng nhất vượt 90KB, sát trần — phải GIẢM CACHE_CHUNK_SIZE');
      }
    });
  }

  soi('BIẾN ĐỘNG — TTL 35 phút', CACHE_KEYS_FAST_);
  soi('ĐƠN GIÁ — TTL 6 tiếng', CACHE_KEYS_SLOW_);

  const tongKhoa = tongChunk + soKeyCoData;   // mỗi key có thêm 1 khoá __meta
  out.push('');
  out.push('TỔNG: ' + tongKhoa + ' khoá (' + tongChunk + ' chunk + ' + soKeyCoData + ' meta) | ' +
    (tongByte / 1048576).toFixed(2) + ' MB' + (soNguoi ? ' · ' + soNguoi + ' key đang nguội, chưa tính' : ''));

  if (tongKhoa >= CACHE_KEY_LIMIT_) {
    coCanhBao = true;
    out.push('  ✘ ĐÃ VƯỢT mốc ~' + CACHE_KEY_LIMIT_ + ' khoá — cache đang bị dọn FIFO liên tục');
  } else if (tongKhoa >= CACHE_KEY_WARN_) {
    coCanhBao = true;
    out.push('  ⚠ Sát mốc ~' + CACHE_KEY_LIMIT_ + ' khoá');
  } else {
    out.push('  ✔ Còn cách mốc ~' + CACHE_KEY_LIMIT_ + ' khoá: ' + (CACHE_KEY_LIMIT_ - tongKhoa) + ' khoá');
  }

  // Trục byte thường còn dư nhiều -> nếu số khoá cao thì cách xử là TĂNG chunk size, không phải giảm
  if (tongChunk > 0) {
    out.push('');
    out.push('NẾU ĐỔI CACHE_CHUNK_SIZE:');
    [12000, 18000, 24000, 30000].forEach(function (sz) {
      const chunkMoi = Math.ceil(tongChunk * CACHE_CHUNK_SIZE / sz);
      const worst = sz * 3;    // xấu nhất: 3 byte/ký tự (chữ Việt có dấu đặc)
      out.push('  ' + String(sz).padStart(6) + ' ký tự -> ~' + String(chunkMoi + soKeyCoData).padStart(4) +
        ' khoá | xấu nhất ' + (worst / 1024).toFixed(0) + 'KB ' +
        (worst > CACHE_LIMIT_BYTES_ ? '✘ CÓ THỂ VỠ' : '✔ luôn an toàn') +
        (sz === CACHE_CHUNK_SIZE ? '   <= hiện tại' : ''));
    });
  }

  const lastErr = PropertiesService.getScriptProperties().getProperty(PROP_CACHE_ERR);
  out.push('');
  out.push('cache_last_error: ' + (lastErr || '(không có)'));
  out.push('  Lưu ý: recordCacheStatus_(true) XOÁ trường này mỗi lần nạp thành công, nên "(không có)"');
  out.push('  chỉ có nghĩa "không lỗi kể từ lần nạp gần nhất", không phải "chưa bao giờ lỗi".');

  out.push('');
  out.push(coCanhBao ? '=> CÓ CẢNH BÁO — xem các dòng ✘ / ⚠ ở trên.' : '=> Không phát hiện vấn đề.');

  const kq = out.join('\n');
  Logger.log(kq);
  return kq;
}

/**
 * Đo phần dung lượng bị tiêu vì sheetToObjects_ lặp TÊN CỘT trên từng dòng.
 * Chạy TỪNG KEY MỘT (truyền tham số) chứ không quét cả loạt, vì hàm phải dựng lại toàn bộ mảng
 * trong bộ nhớ. Mặc định soi chiphi_raw_v2.
 */
function kiemTraLapTenCot(key) {
  key = key || 'chiphi_raw_v2';
  const data = cacheGetJSON_(key);
  if (!Array.isArray(data) || !data.length) {
    const m = key + ': không đọc được cache (nguội, thiếu chunk, hoặc không phải mảng).';
    Logger.log(m);
    return m;
  }
  const dangObj = JSON.stringify(data);
  const dangMang = JSON.stringify(data.map(function (o) {
    return Object.keys(o).map(function (k) { return o[k]; });
  }));
  const bObj = utf8Len_(dangObj), bArr = utf8Len_(dangMang);
  const m = key + ': ' + data.length + ' dòng · ' + Object.keys(data[0]).length + ' cột\n' +
    '  Lưu object (hiện tại): ' + (bObj / 1048576).toFixed(2) + ' MB · ' +
    Math.ceil(dangObj.length / CACHE_CHUNK_SIZE) + ' chunk\n' +
    '  Nếu lưu mảng        : ' + (bArr / 1048576).toFixed(2) + ' MB · ' +
    Math.ceil(dangMang.length / CACHE_CHUNK_SIZE) + ' chunk\n' +
    '  Thừa do lặp tên cột : ' + Math.round((bObj / bArr - 1) * 100) + '%';
  Logger.log(m);
  return m;
}