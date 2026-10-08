//@@PRELUDE
/**
 * core.js — SINH TỰ ĐỘNG từ Code.gs (Apps Script) bằng tools/build_core.py (python3 tools/build_core.py apps-script/Code.gs js/core.js tools/core_blocks.js). Đừng sửa tay nếu còn
 * muốn đồng bộ với Code.gs: sửa Code.gs rồi chạy lại script.
 *
 * Toàn bộ logic ĐỌC (Dashboard, Cửa hàng, Tài sản, Sanaky, Bảo dưỡng, Đơn giá, khớp vật tư...) giữ
 * NGUYÊN VĂN bản Apps Script. Chỉ khác ở lớp dữ liệu:
 *   - Sheet  -> TM_DATA: dữ liệu Sync.gs đẩy lên Firestore, app.js nạp vào đây.
 *   - CacheService -> MEMO trong bộ nhớ trình duyệt.
 *   - Kho vật tư (VAT TU / NHẬP KHO / TỰ ĐỘNG TRỪ) -> TM_VT: state trên Firestore. Các thao tác GHI
 *     là hàm thuần nhận state và sửa trực tiếp; app.js gọi chúng BÊN TRONG Firestore transaction
 *     (thay cho LockService — hai người bấm cùng lúc thì transaction tự chạy lại, không trừ đôi).
 */
var TMCore = (function () {
  'use strict';

  var TM_DATA = {};                                     // key -> { headers, rows }
  var TM_VT = { state: null, stockin: [], autolog: [] };
  var MEMO = {};

  function sheetKeyOf_(name) {
    var m = {};
    m[SHEET_STORES] = 'stores'; m[SHEET_ASSETS] = 'assets'; m[SHEET_MAINT] = 'maint'; m[SHEET_CHIPHI] = 'chiphi'; m[SHEET_NCC_TABS] = 'ncctabs';
    return m[name] || null;
  }

  /** Giả lập đúng 2 lời gọi mà Code.gs dùng với file ngoài: getSheetByName().getDataRange().get(Display)Values() */
  function fakeSpreadsheet_(nameToKey) {
    return {
      getSheetByName: function (n) {
        var key = nameToKey[n];
        var d = key ? TM_DATA[key] : null;
        if (!d) return null;
        var all = [d.headers || []].concat(d.rows || []);
        return {
          getDataRange: function () {
            return {
              getValues: function () { return all; },
              getDisplayValues: function () {
                return all.map(function (r) { return r.map(function (c) { return c === null || c === undefined ? '' : String(c); }); });
              }
            };
          }
        };
      }
    };
  }

  var Logger = { log: function (m) { if (typeof console !== 'undefined') console.log(m); } };

  var Utilities = {
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    /** MD5 trên chuỗi UTF-8 — cho ra ĐÚNG khoá vân tay mà bản Apps Script đã ghi trong sổ trừ kho. */
    computeDigest: function (alg, str) {
      var md5fn = (typeof md5 === 'function') ? md5 : (typeof globalThis !== 'undefined' && globalThis.md5);
      var hex = md5fn(String(str));
      var out = [];
      for (var i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
      return out;
    },
    formatDate: function (d, tz, fmt) {
      var parts = {};
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz || 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
      return String(fmt).replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
        .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
    }
  };

  function todayVn_() { return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy'); }

//@@END

//@@VATTU_BLOCK
// ============================== VẬT TƯ (KHO VẬT TƯ THEO NGƯỜI GIỮ) — BẢN FIRESTORE ==============================
//
// Sheet VAT TU / VAT TU NHAP KHO / VAT TU TU DONG TRU giờ chỉ là BẢN SAO do Sync.gs kéo về.
// Nguồn thật là Firestore: vattu/state { holders, materials[{code,name,spec,qty{holder:n}}] }.

const SHEET_VATTU = 'VAT TU';
const SHEET_VATTU_LOG = 'VAT TU NHAP KHO';
const VATTU_FIXED_COLS = 3;

function emptyVatTuState_() {
  return { holders: [], materials: [], autologMigrated: false, autologChunks: 0 };
}

function vtDataFromState_(st) {
  st = st || emptyVatTuState_();
  const holders = (st.holders || []).map(function (h) { return String(h || '').trim(); }).filter(function (h) { return h; });
  const materials = [];
  (st.materials || []).forEach(function (m) {
    const code = String(m.code || '').trim();
    const name = String(m.name || '').trim();
    if (!code && !name) return;
    const qty = {};
    let total = 0;
    holders.forEach(function (h) {
      const v = Number(m.qty && m.qty[h]) || 0;
      qty[h] = v;
      total += v;
    });
    materials.push({ code: code, name: name, spec: String(m.spec || ''), qty: qty, total: total });
  });
  return { holders: holders, materials: materials };
}

function getVatTuData() {
  return vtDataFromState_(TM_VT.state);
}

function vtIndexOfCode_(st, code) {
  const c = String(code || '').trim();
  for (let i = 0; i < st.materials.length; i++) {
    if (String(st.materials[i].code || '').trim() === c) return i;
  }
  return -1;
}

function vtHolderName_(st, holder) {
  const h = String(holder || '').trim();
  if (st.holders.map(function (x) { return String(x || '').trim(); }).indexOf(h) === -1) {
    throw new Error('Không tìm thấy người "' + holder + '".');
  }
  return h;
}

/* Các thao tác GHI — hàm thuần, SỬA TRỰC TIẾP `st`. app.js gọi trong transaction. Thông báo lỗi giữ
   nguyên văn bản Apps Script. */
const VT_OPS = {
  saveVatTuItem: function (st, item) {
    const code = String((item && item.code) || '').trim();
    if (!code) throw new Error('Thiếu mã vật tư.');
    const oldCode = String((item && item.oldCode) || '').trim();
    const targetIdx = oldCode ? vtIndexOfCode_(st, oldCode) : -1;
    if (oldCode && targetIdx === -1) throw new Error('Không tìm thấy vật tư "' + oldCode + '" để sửa.');
    for (let i = 0; i < st.materials.length; i++) {
      if (i === targetIdx) continue;
      if (String(st.materials[i].code || '').trim() === code) throw new Error('Mã vật tư "' + code + '" đã tồn tại.');
    }
    if (targetIdx > -1) {
      const m = st.materials[targetIdx];
      m.code = code; m.name = item.name || ''; m.spec = item.spec || '';
    } else {
      st.materials.push({ code: code, name: item.name || '', spec: item.spec || '', qty: {} });
    }
    return { success: true };
  },

  deleteVatTuItem: function (st, code) {
    const c = String(code || '').trim();
    st.materials = st.materials.filter(function (m) { return String(m.code || '').trim() !== c; });
    return { success: true };
  },

  moveVatTuItem: function (st, code, direction) {
    const idx = vtIndexOfCode_(st, code);
    if (idx === -1) throw new Error('Không tìm thấy vật tư "' + code + '".');
    const t = direction === 'up' ? idx - 1 : idx + 1;
    if (t < 0 || t >= st.materials.length) return { success: true };
    const tmp = st.materials[idx]; st.materials[idx] = st.materials[t]; st.materials[t] = tmp;
    return { success: true };
  },

  addVatTuHolder: function (st, name) {
    const n = String(name || '').trim();
    if (!n) throw new Error('Thiếu tên người giữ vật tư.');
    if (st.holders.map(function (h) { return String(h).trim(); }).indexOf(n) > -1) {
      throw new Error('Người "' + n + '" đã có trong danh sách.');
    }
    st.holders.push(n);
    return { success: true };
  },

  renameVatTuHolder: function (st, oldName, newName) {
    const trimmed = st.holders.map(function (h) { return String(h || '').trim(); });
    const o = String(oldName || '').trim();
    const idx = trimmed.indexOf(o);
    if (idx === -1) throw new Error('Không tìm thấy người "' + oldName + '".');
    const nn = String(newName || '').trim();
    if (!nn) throw new Error('Tên mới không được để trống.');
    for (let i = 0; i < trimmed.length; i++) {
      if (i !== idx && trimmed[i] === nn) throw new Error('Người "' + nn + '" đã có trong danh sách.');
    }
    st.holders[idx] = nn;
    st.materials.forEach(function (m) {
      m.qty = m.qty || {};
      if (Object.prototype.hasOwnProperty.call(m.qty, o)) {
        m.qty[nn] = m.qty[o];
        delete m.qty[o];
      }
    });
    return { success: true };
  },

  deleteVatTuHolder: function (st, name) {
    const n = String(name || '').trim();
    const idx = st.holders.map(function (h) { return String(h || '').trim(); }).indexOf(n);
    if (idx === -1) throw new Error('Không tìm thấy người "' + name + '".');
    st.holders.splice(idx, 1);
    st.materials.forEach(function (m) { if (m.qty) delete m.qty[n]; });
    return { success: true };
  },

  setVatTuQty: function (st, code, holder, qty) {
    const h = vtHolderName_(st, holder);
    if (!st.materials.length) throw new Error('Chưa có vật tư nào trong danh mục.');
    const idx = vtIndexOfCode_(st, code);
    if (idx === -1) throw new Error('Không tìm thấy vật tư "' + code + '".');
    st.materials[idx].qty = st.materials[idx].qty || {};
    st.materials[idx].qty[h] = Number(qty) || 0;
    return { success: true };
  },

  setVatTuQtyBulk: function (st, holder, items) {
    const h = vtHolderName_(st, holder);
    if (!st.materials.length) throw new Error('Chưa có vật tư nào trong danh mục.');
    const byCode = {};
    (items || []).forEach(function (it) { byCode[String(it.code || '').trim()] = Number(it.qty) || 0; });
    st.materials.forEach(function (m) {
      const c = String(m.code || '').trim();
      if (Object.prototype.hasOwnProperty.call(byCode, c)) {
        m.qty = m.qty || {};
        m.qty[h] = byCode[c];
      }
    });
    return { success: true };
  },

  /** Nhập kho CỘNG DỒN + ghi lịch sử nhập. `stockin` là mảng lịch sử (sửa trực tiếp). */
  addVatTuStock: function (st, stockin, holder, items) {
    const data = vtDataFromState_(st);
    const byCode = {};
    data.materials.forEach(function (m) { byCode[m.code] = m; });
    const h = vtHolderName_(st, holder);
    const today = todayVn_();
    const newQty = {};
    let added = 0;
    (items || []).forEach(function (it) {
      const qty = Number(it.qty) || 0;
      if (qty <= 0) return;
      const mat = byCode[String(it.code || '').trim()];
      if (!mat) return;
      const current = mat.qty[h] || 0;
      newQty[mat.code] = (Object.prototype.hasOwnProperty.call(newQty, mat.code) ? newQty[mat.code] : current) + qty;
      stockin.push({ date: today, code: mat.code, name: mat.name, qty: qty, holder: h });
      added++;
    });
    const bulk = Object.keys(newQty).map(function (code) { return { code: code, qty: newQty[code] }; });
    if (bulk.length) VT_OPS.setVatTuQtyBulk(st, h, bulk);
    return { success: true, itemsAdded: added };
  }
};

function getVatTuStockInHistory() {
  return (TM_VT.stockin || [])
    .map(function (r) {
      return { date: normalizeDate_(r.date), code: r.code, name: r.name, qty: Number(r.qty) || 0, holder: r.holder };
    })
    .sort(function (a, b) { return parseVnDate_(b.date) - parseVnDate_(a.date); });
}

//@@END

//@@EXPORT_BLOCK
/** Xuất Excel ngay trên trình duyệt bằng SheetJS (bản Apps Script phải tạo file tạm trên Drive). */
function exportVatTuExcel(yearFilter, monthFilter, trackOpts) {
  trackOpts = trackOpts || {};
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

  function scopeText(y, m, st, q) {
    const bits = ['Năm: ' + (y || 'Tất cả'), 'Tháng: ' + (m ? pad2_(m) : 'Tất cả')];
    if (st) bits.push('Nhân viên: ' + st);
    if (q) bits.push('Từ khoá: ' + q);
    return bits.join('  ·  ');
  }

  const XL = (typeof XLSX !== 'undefined') ? XLSX : null;
  if (!XL) throw new Error('Chưa tải được thư viện xuất Excel, thử tải lại trang.');
  const wb = XL.utils.book_new();

  function writeSheet(name, headers, rows, scope) {
    const aoa = [];
    const merges = [];
    if (scope) {
      aoa.push(['Phạm vi lọc — ' + scope]);
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, headers.length - 1) } });
    }
    aoa.push(headers);
    rows.forEach(function (r) { aoa.push(r); });
    const ws = XL.utils.aoa_to_sheet(aoa);
    if (merges.length) ws['!merges'] = merges;
    ws['!cols'] = headers.map(function (h, i) { return { wch: i === 0 ? 22 : Math.max(10, String(h).length + 2) }; });
    XL.utils.book_append_sheet(wb, ws, name);
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
    ['Nguồn', 'Ngày hoàn thành', 'Hạng mục vật tư', 'Số lượng', 'NV Phụ trách', 'Địa chỉ', 'Trạng thái', 'Vật tư khớp'],
    full.rows.map(function (r) {
      return [r.source, r.date, r.item, r.qty, r.staff, r.address, r.statusLabel, r.statusSub];
    }),
    scopeText(trackYear, trackMonth, trackStaff, trackQuery));

  const label = (yearFilter || monthFilter) ? ('_' + (yearFilter || 'tatca') + (monthFilter ? '-' + pad2_(monthFilter) : '')) : '';
  return { success: true, base64: XL.write(wb, { bookType: 'xlsx', type: 'base64' }), filename: 'VatTu' + label + '.xlsx' };
}

/** Xuất Excel trang Chi phí THS / LSC theo đúng bộ lọc đang chọn — đúng các cột như sheet CHI PHI. */
function exportChiPhiKindExcel(opts) {
  opts = Object.assign({}, opts || {}, { page: 1, pageSize: 0 });
  const XL = (typeof XLSX !== 'undefined') ? XLSX : null;
  if (!XL) throw new Error('Chưa tải được thư viện xuất Excel, thử tải lại trang.');
  const data = getChiPhiKindRows(opts);
  const kindLabel = opts.kind === 'lsc' ? 'LSC' : 'THS';
  const regionLabel = { MB: 'Miền Bắc', MT: 'Miền Trung', MN: 'Miền Nam' }[opts.region] || 'Toàn quốc';
  const scope = ['Chi phí sửa chữa ' + kindLabel, regionLabel, 'Năm: ' + (opts.year || 'Tất cả'),
    'Tháng: ' + (opts.month ? pad2_(opts.month) : 'Tất cả'), 'NCC: ' + (opts.supplier || 'Tất cả')]
    .concat(opts.query ? ['Từ khoá: ' + opts.query] : []).join('  ·  ');
  const headers = ['Cost center', 'Tên cửa hàng', 'Khu vực', 'Mô tả sự cố', 'NV phụ trách', 'Hạng mục/Vật tư', 'Mã thiết bị', 'Ngày hoàn thành', 'Số lượng', 'Tổng chi phí', 'Nhà cung cấp'];
  const aoa = [['Phạm vi lọc — ' + scope], headers];
  data.rows.forEach(function (r) {
    aoa.push([r.costCenter, r.storeName, r.area, r.issue, r.staff, r.item, r.assetCode, r.date, r.qty, r.cost, r.supplier]);
  });
  const ws = XL.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  ws['!cols'] = [12, 40, 10, 26, 20, 32, 12, 14, 9, 14, 18].map(function (w) { return { wch: w }; });
  const wb = XL.utils.book_new();
  XL.utils.book_append_sheet(wb, ws, 'ChiPhi' + kindLabel);
  const tag = (opts.year || '') + (opts.month ? '-' + pad2_(opts.month) : '');
  return { success: true, base64: XL.write(wb, { bookType: 'xlsx', type: 'base64' }), filename: 'ChiPhi_' + kindLabel + (tag ? '_' + tag : '') + '.xlsx' };
}
//@@END

//@@DEDUCT_BLOCK
/**
 * Tự động trừ tồn kho theo các dòng CHI PHÍ mới — BẢN THUẦN. app.js chạy hàm này trong Firestore
 * transaction với `st` (vattu/state) và `autolog` (toàn bộ sổ đã xử lý) vừa đọc từ server, rồi ghi
 * lại `st` + các dòng log mới. Năm nguyên tắc của bản Apps Script giữ nguyên:
 *  1) Khoá chống trùng là ID CỐ ĐỊNH của dòng (cột ẩn "ID" do Sync.gs điền). Dòng chưa có ID thì
 *     dùng vân tay nội dung như bản cũ. Khi MỌI dòng đã có ID (xem syncAutologWithIds_):
 *       - log cũ còn khoá vân tay được đổi sang ID của đúng dòng đó (không trừ lại);
 *       - dòng đã trừ bị SỬA -> cập nhật thông tin trong log, KHÔNG trừ thêm, KHÔNG hoàn kho;
 *       - dòng đã trừ bị XOÁ khỏi sheet -> xoá luôn bản ghi log, KHÔNG hoàn kho.
 *  2) Chống trừ đôi: transaction thay LockService.
 *  3) KHÔNG ghi log dòng chưa khớp vật tư/người giữ.
 *  4) KHÔNG đủ tồn thì KHÔNG trừ gì cả.
 *  5) Thứ tự tranh tồn: ngày tăng dần (vtAllocOrder_).
 *
 * Trả về { result, newEntries, replaceAll }.
 */
function computeVatTuDeduction_(st, autolog) {
  const cpRows = getChiPhiCached_();
  const data = vtDataFromState_(st);
  if (!cpRows.length || !data.materials.length || !data.holders.length) {
    return { result: { success: true, processed: 0, skipped: 0, shorted: 0 }, newEntries: [] };
  }

  const keys = getChiPhiKeysCached_();
  const matcher = buildVatTuMatcher_(data.materials);
  const today = todayVn_();

  /* Lần chạy đầu khi KHÔNG có sổ log cũ: đánh dấu toàn bộ dòng hiện có là đã xử lý, không trừ gì
     (giống migrateVatTuAutoLog_ của bản Apps Script). Nếu sổ log cũ đã được nhập từ sheet thì
     autologMigrated = true sẵn và bước này bị bỏ qua. */
  if (!st.autologMigrated) {
    st.autologMigrated = true;
    return {
      result: { success: true, processed: 0, skipped: cpRows.length, shorted: 0, migrated: cpRows.length },
      newEntries: keys.map(function (k) {
        return { k: k, d: today, code: '', name: '(khởi tạo khoá nội dung — không trừ)', qty: 0, holder: '' };
      }),
      replaceAll: true
    };
  }

  /* Đồng bộ sổ log với ID cố định — chỉ khi MỌI dòng đã có ID, tránh xoá nhầm log lúc Sync.gs
     chưa kịp điền ID cho dòng mới. */
  const sync = syncAutologWithIds_(cpRows, keys, autolog || [], matcher, data.holders);
  const entries = sync.entries;
  const processedKeys = new Set(entries.map(function (e) { return String(e.k); }));

  // Tham chiếu thẳng vào object vật tư trong `st` để sửa tồn
  const stByCode = {};
  st.materials.forEach(function (m) { stByCode[String(m.code || '').trim()] = m; });

  const newEntries = [];
  let processedCount = 0, skippedCount = 0, shortedCount = 0, unmatchedTotal = 0;

  const order = cpRows
    .map(function (r, i) { return { i: i, t: vtRowTime_(r[COLS.CP_DATE]) }; })
    .sort(vtAllocOrder_);

  order.forEach(function (o) {
    const i = o.i;
    const r = cpRows[i];
    const key = keys[i];

    if (!isVatTuRow_(r)) return;

    const res = vtMatch_(matcher, r[COLS.CP_ITEM]);
    const mat = vtMatchAccepted_(res) ? res.material : null;
    const holder = matchVatTuHolder_(r[COLS.CP_STAFF], data.holders);
    const qty = Number(r[COLS.CP_QTY]) || 0;
    const unmatched = (!mat || !holder || qty <= 0);
    if (unmatched) unmatchedTotal++;

    if (processedKeys.has(key)) return;
    if (unmatched) { skippedCount++; return; }

    const matRef = stByCode[mat.code];
    if (!matRef) { skippedCount++; return; }
    matRef.qty = matRef.qty || {};
    const current = Number(matRef.qty[holder]) || 0;
    if (qty > current) { shortedCount++; return; }

    matRef.qty[holder] = current - qty;
    processedKeys.add(key);
    newEntries.push({ k: key, d: today, code: mat.code, name: mat.name, qty: qty, holder: holder });
    processedCount++;
  });

  const result = {
    success: true,
    processed: processedCount,
    skipped: skippedCount,
    shorted: shortedCount,
    unmatchedTotal: unmatchedTotal,
    scanned: cpRows.length
  };
  // Sổ log có dòng đổi khoá / cập nhật / bị xoá -> ghi lại TOÀN BỘ sổ
  if (sync.changed) return { result: result, newEntries: entries.concat(newEntries), replaceAll: true };
  return { result: result, newEntries: newEntries };
}

/**
 * Đối chiếu sổ log "đã trừ" với các dòng CHI PHÍ hiện tại theo ID cố định. KHÔNG đụng tới tồn kho.
 *  - Bản ghi còn khoá vân tay cũ mà khớp đúng dòng -> đổi khoá sang ID của dòng đó.
 *  - Bản ghi của dòng còn tồn tại -> cập nhật vật tư / số lượng / người giữ theo nội dung mới của dòng.
 *  - Bản ghi không còn dòng nào ứng với nó (dòng đã bị xoá) -> bỏ khỏi sổ.
 * Chưa phải mọi dòng đều có ID -> trả nguyên sổ, không làm gì.
 */
function syncAutologWithIds_(cpRows, keys, autolog, matcher, holders) {
  const entries = autolog.map(function (e) { return Object.assign({}, e); });
  const allHaveId = cpRows.length > 0 && cpRows.every(function (r) { return !!chiPhiRowId_(r); });
  if (!allHaveId) return { entries: entries, changed: false };

  let changed = false;
  const legacy = buildChiPhiLegacyKeys_(cpRows);
  const byKey = {};
  entries.forEach(function (e, j) { byKey[String(e.k)] = j; });

  const keep = {};
  cpRows.forEach(function (r, i) {
    const id = keys[i];
    let j = byKey[id];
    if (j === undefined && byKey[legacy[i]] !== undefined && !keep[byKey[legacy[i]]]) {
      j = byKey[legacy[i]];
      entries[j].k = id;          // đổi khoá vân tay -> ID
      changed = true;
    }
    if (j === undefined) return;
    keep[j] = true;

    const e = entries[j];
    if (!e.code) return;          // bản ghi "khởi tạo — không trừ": không có thông tin vật tư để cập nhật
    const res = vtMatch_(matcher, r[COLS.CP_ITEM]);
    const mat = vtMatchAccepted_(res) ? res.material : null;
    const holder = matchVatTuHolder_(r[COLS.CP_STAFF], holders);
    const qty = Number(r[COLS.CP_QTY]) || 0;
    if (mat && (e.code !== mat.code || e.name !== mat.name)) { e.code = mat.code; e.name = mat.name; changed = true; }
    if (holder && e.holder !== holder) { e.holder = holder; changed = true; }
    if (qty > 0 && Number(e.qty) !== qty) { e.qty = qty; changed = true; }
  });

  const kept = entries.filter(function (e, j) { return keep[j]; });
  if (kept.length !== entries.length) changed = true;
  return { entries: kept, changed: changed };
}
//@@END

//@@EPILOGUE
  // ============================== CỔNG RA NGOÀI ==============================

  function setSheetData(key, payload) {
    TM_DATA[key] = payload;
    MEMO = {};
  }

  function setVatTu(state, stockin, autolog) {
    TM_VT.state = state || emptyVatTuState_();
    TM_VT.stockin = stockin || [];
    TM_VT.autolog = autolog || [];
    delete MEMO['vattu_autolog_v1'];
  }

  /** Các hàm giao diện được phép gọi qua google.script.run (chỉ ĐỌC; phần GHI do app.js bọc). */
  var READ_API = {
    getDashboardData: getDashboardData,
    searchStores: searchStores,
    getStoreDetail: getStoreDetail,
    searchAssetByCode: searchAssetByCode,
    getAssetsByStore: getAssetsByStore,
    getMaintenanceList: getMaintenanceList,
    getMaintenanceByStore: getMaintenanceByStore,
    getMaintenanceByAsset: getMaintenanceByAsset,
    getMaintenanceQuarterlyStats: getMaintenanceQuarterlyStats,
    getChiPhiByStore: getChiPhiByStore,
    getChiPhiByAsset: getChiPhiByAsset,
    getStoreCostSummary: getStoreCostSummary,
    getAssetCostSummary: getAssetCostSummary,
    getAssetRepairHistory: getAssetRepairHistory,
    getStoreRepairHistory: getStoreRepairHistory,
    getSanakyYearsAvailable: getSanakyYearsAvailable,
    getSanakyMonthsAvailable: getSanakyMonthsAvailable,
    getSanakyDashboardData: getSanakyDashboardData,
    getSanakyList: getSanakyList,
    getSanakyByStore: getSanakyByStore,
    getChiPhiKindMonthsAvailable: getChiPhiKindMonthsAvailable,
    getChiPhiSupplierOptions: getChiPhiSupplierOptions,
    getChiPhiKindRows: getChiPhiKindRows,
    exportChiPhiKindExcel: exportChiPhiKindExcel,
    getSanakyByAsset: getSanakyByAsset,
    getDonGiaData: getDonGiaData,
    getVatTuData: getVatTuData,
    getVatTuStockInHistory: getVatTuStockInHistory,
    getVatTuYearsAvailable: getVatTuYearsAvailable,
    getVatTuMonthsAvailable: getVatTuMonthsAvailable,
    getVatTuByStaffMonth: getVatTuByStaffMonth,
    getVatTuTrackingFilters: getVatTuTrackingFilters,
    getVatTuTrackingList: getVatTuTrackingList,
    exportVatTuExcel: exportVatTuExcel
  };

  return {
    READ_API: READ_API,
    VT_OPS: VT_OPS,
    emptyVatTuState: emptyVatTuState_,
    computeVatTuDeduction: computeVatTuDeduction_,
    setSheetData: setSheetData,
    setVatTu: setVatTu,
    getVatTuState: function () { return TM_VT.state; },
    // dùng cho kiểm thử
    _chiPhiKeys: function () { return getChiPhiKeysCached_(); }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TMCore;
//@@END
