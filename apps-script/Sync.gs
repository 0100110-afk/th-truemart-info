/**
 * Sync.gs — ĐỒNG BỘ GOOGLE SHEET <-> FIRESTORE cho app TH true mart (bản web/PWA trên GitHub).
 *
 * DÁN FILE NÀY VÀO PROJECT APPS SCRIPT GẮN VỚI FILE SHEET "TM" (Tiện ích mở rộng -> Apps Script).
 * File này ĐỨNG MỘT MÌNH: không cần Code.gs / Index.html. Bản Apps Script cũ có thể giữ hoặc xoá
 * tuỳ ý — Sync.gs không phụ thuộc vào nó và không trùng tên với nó.
 *
 * HAI CHIỀU, MỖI BẢNG CHỈ MỘT NƠI ĐƯỢC SỬA:
 *
 *   Sheet -> App  (sửa trên Google Sheet như trước):
 *       DS CH, TAI SAN, BAO DUONG, CHI PHI, SANAKY (cùng file TM), DON GIA BT/XD/SNK (file DG riêng),
 *       APP USERS (danh sách người được vào app).
 *       Đẩy lên ngay khi sửa ô (trigger onEdit) + quét lại toàn bộ 10 phút/lần (bắt các thay đổi
 *       trigger onEdit không thấy: dán hàng loạt, công thức, file Sanaky/Đơn giá nằm ngoài).
 *
 *   App -> Sheet  (sửa trên APP, sheet chỉ là bản sao để xem/báo cáo):
 *       VAT TU, VAT TU NHAP KHO, VAT TU TU DONG TRU.
 *       Kéo về 10 phút/lần, hoặc menu "App TM" -> "Kéo vật tư từ app về sheet".
 *       ĐỪNG sửa tay 3 sheet này nữa — lần kéo sau sẽ ghi đè.
 *
 * CÀI ĐẶT (1 lần) — chi tiết trong README:
 *   1. Firebase Console -> Project settings -> Service accounts -> Generate new private key (tải file JSON).
 *   2. Apps Script -> Project Settings (bánh răng) -> Script Properties -> Add:
 *        Property: FIREBASE_SA     Value: dán TOÀN BỘ nội dung file JSON vừa tải.
 *   3. Chọn hàm caiDatDongBoFirebase trong thanh công cụ -> Run -> cấp quyền.
 *
 * Định dạng dữ liệu trên Firestore: xem đầu file js/app.js trong repo.
 */

// ============================== CẤU HÌNH ==============================

// Vị trí dữ liệu. Đổi tên tab / file ở đây nếu sau này bạn di chuyển sheet.
const FS_TAB_STORES = 'DS CH';
const FS_TAB_ASSETS = 'TAI SAN';
const FS_TAB_MAINT = 'BAO DUONG';
const FS_TAB_CHIPHI = 'CHI PHI';
const FS_TAB_SANAKY = 'SANAKY';                       // tab trong file TM
const FS_TAB_VATTU = 'VAT TU';
const FS_TAB_VATTU_LOG = 'VAT TU NHAP KHO';
const FS_DG_FILE_ID = '1RFVctqPlPvLodhscIMxIMLrRgIEjSLLUlFUsqI2anSQ';   // file "DG"
const FS_TAB_DG_BT = 'DON GIA BT';
const FS_TAB_DG_XD = 'DON GIA XD';
const FS_TAB_DG_SNK = 'DON GIA SNK';

const FS_PROP_SA = 'FIREBASE_SA';
const FS_PROP_MIRROR_REV = 'fs_vattu_mirror_rev';
const FS_PROP_USERS_HASH = 'fs_users_hash';
const FS_SHEET_USERS = 'APP USERS';
/** Mỗi tài liệu Firestore tối đa 1 MiB. Cắt theo BYTE UTF-8 (chữ Việt có dấu 3 byte/ký tự), chừa biên. */
const FS_CHUNK_BYTES = 700000;
const FS_AUTOLOG_CHUNK = 2500;          // phải khớp AUTOLOG_CHUNK_MAX trong js/app.js
const FS_TICK_MINUTES = 10;

/** Danh sách bảng đẩy lên app. mode 'raw' = giữ số/chữ gốc (ô kiểu Ngày -> chuỗi hiển thị dd/MM/yyyy,
 *  đúng quy ước số 2 của Code.gs); 'display' = toàn bộ chuỗi hiển thị (Sanaky vốn đọc kiểu này). */
let fsDongiaSsCache_ = null;
function fsDongiaSs_() {
  if (!fsDongiaSsCache_) {
    try { fsDongiaSsCache_ = SpreadsheetApp.openById(FS_DG_FILE_ID); }
    catch (e) { throw new Error('Không mở được file Đơn giá (FS_DG_FILE_ID = ' + FS_DG_FILE_ID + '): ' + e.message); }
  }
  return fsDongiaSsCache_;
}

function fsSources_() {
  const active = SpreadsheetApp.getActive();
  return [
    { key: 'stores', name: FS_TAB_STORES, mode: 'raw', sheet: function () { return active.getSheetByName(FS_TAB_STORES); } },
    { key: 'assets', name: FS_TAB_ASSETS, mode: 'raw', sheet: function () { return active.getSheetByName(FS_TAB_ASSETS); } },
    { key: 'maint',  name: FS_TAB_MAINT,  mode: 'raw', sheet: function () { return active.getSheetByName(FS_TAB_MAINT); } },
    { key: 'chiphi', name: FS_TAB_CHIPHI, mode: 'raw', sheet: function () { return active.getSheetByName(FS_TAB_CHIPHI); } },
    { key: 'sanaky', name: FS_TAB_SANAKY, mode: 'display', sheet: function () { return active.getSheetByName(FS_TAB_SANAKY); } },
    // Đơn giá ở file DG riêng. Mở thẳng bằng ID (không dùng getDongiaSpreadsheet_ vì hàm đó lặng lẽ
    // quay về file TM khi ID sai -> đồng bộ báo "không tìm thấy" mà không rõ vì sao).
    { key: 'dongia_bt',  name: FS_TAB_DG_BT,  mode: 'raw', external: true, sheet: function () { return fsDongiaSs_().getSheetByName(FS_TAB_DG_BT); } },
    { key: 'dongia_xd',  name: FS_TAB_DG_XD,  mode: 'raw', external: true, sheet: function () { return fsDongiaSs_().getSheetByName(FS_TAB_DG_XD); } },
    { key: 'dongia_snk', name: FS_TAB_DG_SNK, mode: 'raw', external: true, sheet: function () { return fsDongiaSs_().getSheetByName(FS_TAB_DG_SNK); } }
  ];
}

// ============================== MENU + CÀI ĐẶT ==============================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('App TM')
    .addItem('Đồng bộ toàn bộ lên app', 'dongBoToanBoLenApp')
    .addItem('Kéo vật tư từ app về sheet', 'keoVatTuVeSheet')
    .addSeparator()
    .addItem('Cài đặt / cài lại đồng bộ', 'caiDatDongBoFirebase')
    .addItem('Xem tình trạng đồng bộ', 'xemTinhTrangDongBo')
    .addToUi();
}

/** CHẠY 1 LẦN sau khi đã dán FIREBASE_SA vào Script Properties. Chạy lại bao nhiêu lần cũng được. */
function caiDatDongBoFirebase() {
  fsSa_();   // báo lỗi rõ ràng nếu chưa cấu hình

  // Sheet danh sách người dùng
  const ss = SpreadsheetApp.getActive();
  let us = ss.getSheetByName(FS_SHEET_USERS);
  if (!us) {
    us = ss.insertSheet(FS_SHEET_USERS);
    const me = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
    us.getRange(1, 1, 1, 3).setValues([['Email', 'Quyền', 'Ghi chú']]).setFontWeight('bold');
    if (me) us.getRange(2, 1, 1, 3).setValues([[me, 'admin', 'Người cài đặt']]);
    us.getRange(2, 2, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['admin', 'editor', 'viewer'], true).build());
    us.setFrozenRows(1);
    us.setColumnWidth(1, 260);
  }

  // Trigger: xoá trigger cũ của file này rồi tạo lại
  const mine = ['fsOnEdit', 'fsTick'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (mine.indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fsOnEdit').forSpreadsheet(ss).onEdit().create();
  // Sửa file DG cũng đẩy lên ngay (cùng hàm xử lý, phân biệt bằng tên tab)
  let dgNote = '';
  try { ScriptApp.newTrigger('fsOnEdit').forSpreadsheet(fsDongiaSs_()).onEdit().create(); }
  catch (e) { dgNote = '\n- CHÚ Ý: không gắn được trigger cho file DG (' + e.message + '). Đơn giá vẫn cập nhật theo lượt quét 10 phút.'; }
  ScriptApp.newTrigger('fsTick').timeBased().everyMinutes(FS_TICK_MINUTES).create();

  // Lần đầu: đưa kho vật tư hiện có lên app (bỏ qua nếu app đã có dữ liệu vật tư)
  const imported = fsImportVatTu_(false);
  const res = fsSyncAll_(true);
  const msg = 'Đã cài đồng bộ.\n' +
    '- Bảng đã đẩy lên: ' + (res.changed.join(', ') || '(không đổi)') + '\n' +
    '- Kho vật tư: ' + (imported ? 'đã đưa lên app lần đầu' : 'app đã có sẵn, giữ nguyên') + '\n' +
    '- Trigger: sửa ô (file TM + file DG) -> đẩy ngay; quét lại mỗi ' + FS_TICK_MINUTES + ' phút.' + dgNote + '\n' +
    (res.missing.length ? '- KHÔNG tìm thấy sheet: ' + res.missing.join(', ') : '');
  fsAlert_(msg);
  return msg;
}

function dongBoToanBoLenApp() {
  const res = fsSyncAll_(true);
  fsAlert_('Đã đồng bộ. Bảng thay đổi: ' + (res.changed.join(', ') || 'không có') +
    (res.missing.length ? '\nKhông tìm thấy sheet: ' + res.missing.join(', ') : ''));
}

function keoVatTuVeSheet() {
  const n = fsMirrorVatTu_(true);
  fsAlert_(n ? 'Đã kéo kho vật tư từ app về 3 sheet VAT TU.' : 'App chưa có dữ liệu vật tư.');
}

/** Chỉ dùng khi cần ĐÈ dữ liệu vật tư trên app bằng sheet (vd làm lại từ đầu). Hỏi xác nhận. */
function dayVatTuTuSheetLenAppGhiDe() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('Ghi đè kho vật tư trên app',
    'Toàn bộ tồn kho, lịch sử nhập và sổ trừ kho TRÊN APP sẽ bị thay bằng nội dung 3 sheet VAT TU hiện tại. Tiếp tục?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  fsImportVatTu_(true);
  ui.alert('Đã ghi đè kho vật tư trên app bằng dữ liệu sheet.');
}

function xemTinhTrangDongBo() {
  const meta = fsReadMeta_();
  const lines = ['Cập nhật lần cuối: ' + (meta.updatedAt || '(chưa có)')];
  Object.keys(meta.sheets || {}).forEach(function (k) {
    const m = meta.sheets[k];
    lines.push('- ' + k + ': ' + m.rowCount + ' dòng, ' + m.n + ' mảnh, đổi lúc ' + m.updatedAt);
  });
  const st = fsGetDoc_('vattu/state');
  lines.push('Vật tư trên app: ' + (st ? ('rev ' + fsField_(st, 'rev') + ', sửa bởi ' + fsField_(st, 'updatedBy')) : '(chưa có)'));
  lines.push('Đã kéo về sheet tới rev: ' + (PropertiesService.getScriptProperties().getProperty(FS_PROP_MIRROR_REV) || '(chưa)'));
  fsAlert_(lines.join('\n'));
}

// ============================== TRIGGER ==============================

/** Trigger cài đặt (installable) — chạy mỗi lần sửa ô trong file TM. */
function fsOnEdit(e) {
  try {
    const name = e && e.range ? e.range.getSheet().getName() : '';
    if (name === FS_SHEET_USERS) { fsWithLock_(function () { fsSyncUsers_(false); }); return; }
    const fromDg = e && e.source && e.source.getId && e.source.getId() === FS_DG_FILE_ID;
    const src = fsSources_().filter(function (s) { return s.name === name && !!s.external === !!fromDg; })[0];
    if (!src) return;
    fsWithLock_(function () {
      const meta = fsReadMeta_();
      if (fsSyncOne_(src, meta)) fsWriteMetaOnly_(meta);
    });
  } catch (err) {
    console.error('fsOnEdit: ' + err.message);
  }
}

/** Trigger thời gian — quét toàn bộ (chỉ ghi bảng nào thật sự đổi) + kéo vật tư về sheet. */
function fsTick() {
  try { fsSyncAll_(false); } catch (err) { console.error('fsTick sync: ' + err.message); }
  try { fsMirrorVatTu_(false); } catch (err) { console.error('fsTick mirror: ' + err.message); }
}

// ============================== SHEET -> FIRESTORE ==============================

function fsSyncAll_(force) {
  const changed = [], missing = [];
  fsWithLock_(function () {
    const meta = fsReadMeta_();
    fsSources_().forEach(function (src) {
      try {
        const r = fsSyncOne_(src, meta, force);
        if (r === null) missing.push(src.name);
        else if (r) changed.push(src.key);
      } catch (err) {
        console.error('Đồng bộ ' + src.key + ' lỗi: ' + err.message);
        missing.push(src.name + ' (lỗi: ' + err.message + ')');
      }
    });
    fsSyncUsers_(force);
    fsWriteMetaOnly_(meta);    // cập nhật mốc "Cập nhật lần cuối" kể cả khi không bảng nào đổi
  });
  return { changed: changed, missing: missing };
}

/** Trả true nếu đã ghi lên Firestore, false nếu không đổi, null nếu không tìm thấy sheet. */
function fsSyncOne_(src, meta, force) {
  let sh = null;
  try { sh = src.sheet(); } catch (e) { sh = null; }
  if (!sh) return null;

  const data = fsReadSheet_(sh, src.mode);
  const hash = fsMd5_(JSON.stringify(data));
  const old = (meta.sheets || {})[src.key];
  if (old && old.hash === hash) return false;    // nội dung không đổi -> không tốn lượt ghi Firestore

  const chunks = fsChunkRows_(data.rows);
  const now = new Date().toISOString();
  const writes = chunks.map(function (rows, i) {
    return { update: { name: fsDocName_('sheetdata/' + src.key + '__' + i), fields: {
      key: { stringValue: src.key }, i: { integerValue: String(i) }, hash: { stringValue: hash },
      json: { stringValue: JSON.stringify(rows) } } } };
  });
  for (let i = chunks.length; i < (old ? old.n : 0); i++) writes.push({ delete: fsDocName_('sheetdata/' + src.key + '__' + i) });

  meta.sheets = meta.sheets || {};
  meta.sheets[src.key] = { n: chunks.length, hash: hash, headers: data.headers, rowCount: data.rows.length, updatedAt: now };
  meta.updatedAt = now;
  writes.push(fsMetaWrite_(meta));
  fsCommit_(writes);
  return true;
}

function fsReadSheet_(sh, mode) {
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };
  const rng = sh.getRange(1, 1, lastRow, lastCol);
  const vals = rng.getValues();
  const disp = rng.getDisplayValues();
  const headers = (mode === 'display' ? disp[0] : vals[0]).map(function (h) { return String(h); });
  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const raw = vals[i];
    if (raw.every(function (c) { return c === '' || c === null; })) continue;
    rows.push(raw.map(function (v, j) {
      if (mode === 'display') return disp[i][j];
      if (v instanceof Date) return disp[i][j];     // KHÔNG gửi Date: lệch múi giờ 1 ngày (quy ước số 2)
      return v;
    }));
  }
  return { headers: headers, rows: rows };
}

function fsChunkRows_(rows) {
  const out = [];
  let cur = [], bytes = 2;
  rows.forEach(function (r) {
    const b = fsUtf8Len_(JSON.stringify(r)) + 1;
    if (cur.length && bytes + b > FS_CHUNK_BYTES) { out.push(cur); cur = []; bytes = 2; }
    cur.push(r); bytes += b;
  });
  if (cur.length || !out.length) out.push(cur);
  return out;
}

function fsReadMeta_() {
  const d = fsGetDoc_('meta/sheets');
  if (!d) return { sheets: {} };
  try { return JSON.parse(fsField_(d, 'json')) || { sheets: {} }; } catch (e) { return { sheets: {} }; }
}

function fsMetaWrite_(meta) {
  return { update: { name: fsDocName_('meta/sheets'), fields: { json: { stringValue: JSON.stringify(meta) } } } };
}

function fsWriteMetaOnly_(meta) {
  meta.updatedAt = new Date().toISOString();
  fsCommit_([fsMetaWrite_(meta)]);
}

// ============================== NGƯỜI DÙNG (sheet APP USERS -> users/<email>) ==============================

function fsSyncUsers_(force) {
  const sh = SpreadsheetApp.getActive().getSheetByName(FS_SHEET_USERS);
  if (!sh || sh.getLastRow() < 2) return;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues();
  const want = {};
  vals.forEach(function (r) {
    const email = String(r[0] || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) return;
    const raw = fsStripAccents_(r[1]);
    let role = 'viewer';
    if (raw.indexOf('admin') > -1 || raw.indexOf('quan tri') > -1) role = 'admin';
    else if (raw.indexOf('editor') > -1 || raw.indexOf('sua') > -1) role = 'editor';
    want[email] = role;
  });
  const hash = fsMd5_(JSON.stringify(want));
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty(FS_PROP_USERS_HASH) === hash) return;

  const existing = fsListDocs_('users').map(function (d) { return d.name.split('/').pop(); });
  const writes = Object.keys(want).map(function (email) {
    return { update: { name: fsDocName_('users/' + email), fields: { role: { stringValue: want[email] } } } };
  });
  existing.forEach(function (id) {
    if (!want.hasOwnProperty(decodeURIComponent(id))) writes.push({ delete: fsDocName_('users/' + decodeURIComponent(id)) });
  });
  if (writes.length) fsCommit_(writes);
  props.setProperty(FS_PROP_USERS_HASH, hash);
}

// ============================== KHO VẬT TƯ ==============================

/** Đưa 3 sheet VAT TU lên app. force=false: chỉ làm khi app CHƯA có vattu/state. Trả true nếu đã ghi. */
function fsImportVatTu_(force) {
  if (!force && fsGetDoc_('vattu/state')) return false;
  const ss = SpreadsheetApp.getActive();

  const st = { holders: [], materials: [], autologMigrated: false, autologChunks: 0 };
  const sh = ss.getSheetByName(FS_TAB_VATTU);
  if (sh && sh.getLastRow() >= 1) {
    const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 3)).getValues();
    const headers = v[0].map(function (h) { return String(h || '').trim(); });
    st.holders = headers.slice(3).filter(function (h) { return h; });
    for (let i = 1; i < v.length; i++) {
      const code = String(v[i][0] || '').trim(), name = String(v[i][1] || '').trim();
      if (!code && !name) continue;
      const qty = {};
      for (let c = 3; c < headers.length; c++) if (headers[c]) qty[headers[c]] = Number(v[i][c]) || 0;
      st.materials.push({ code: code, name: name, spec: String(v[i][2] || ''), qty: qty });
    }
  }

  const stockin = [];
  const lg = ss.getSheetByName(FS_TAB_VATTU_LOG);
  if (lg && lg.getLastRow() >= 2) {
    lg.getRange(2, 1, lg.getLastRow() - 1, 5).getDisplayValues().forEach(function (r) {
      if (!r[1] && !r[2]) return;
      stockin.push({ date: r[0], code: String(r[1]).trim(), name: r[2], qty: Number(String(r[3]).replace(/[^\d.-]/g, '')) || 0, holder: r[4] });
    });
  }

  const autolog = [];
  const al = ss.getSheetByName('VAT TU TU DONG TRU');
  if (al && al.getLastRow() >= 2) {
    al.getRange(2, 1, al.getLastRow() - 1, 6).getDisplayValues().forEach(function (r) {
      if (!r[0]) return;
      autolog.push({ k: String(r[0]), d: r[1], code: String(r[2]), name: r[3], qty: Number(r[4]) || 0, holder: r[5] });
    });
  }
  const ver = Number(PropertiesService.getScriptProperties().getProperty('vattu_autolog_version') || 0);
  st.autologMigrated = autolog.length > 0 || ver >= 2;

  const chunks = [];
  for (let i = 0; i < autolog.length; i += FS_AUTOLOG_CHUNK) chunks.push(autolog.slice(i, i + FS_AUTOLOG_CHUNK));
  st.autologChunks = chunks.length;

  const now = new Date().toISOString();
  const writes = [
    { update: { name: fsDocName_('vattu/state'), fields: {
      json: { stringValue: JSON.stringify(st) }, rev: { integerValue: '1' },
      updatedAt: { timestampValue: now }, updatedBy: { stringValue: 'Sync.gs (nhập từ sheet)' } } },
      currentDocument: force ? undefined : { exists: false } },
    { update: { name: fsDocName_('vattu/stockin'), fields: { json: { stringValue: JSON.stringify(stockin) } } } }
  ];
  chunks.forEach(function (c, i) {
    writes.push({ update: { name: fsDocName_('vattu_autolog/c' + i), fields: { json: { stringValue: JSON.stringify(c) } } } });
  });
  if (force) {
    fsListDocs_('vattu_autolog').forEach(function (d) {
      const id = d.name.split('/').pop();
      if (Number(id.slice(1)) >= chunks.length) writes.push({ delete: d.name });
    });
  }
  writes.forEach(function (w) { if (w.currentDocument === undefined) delete w.currentDocument; });
  fsCommit_(writes);
  PropertiesService.getScriptProperties().setProperty(FS_PROP_MIRROR_REV, '1');
  return true;
}

/** Firestore -> 3 sheet VAT TU. Chỉ ghi khi rev trên app khác lần kéo trước (force: luôn ghi). */
function fsMirrorVatTu_(force) {
  const d = fsGetDoc_('vattu/state');
  if (!d) return 0;
  const rev = String(fsField_(d, 'rev') || '0');
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty(FS_PROP_MIRROR_REV) === rev) return 0;

  const st = JSON.parse(fsField_(d, 'json') || '{}');
  const holders = st.holders || [];
  const sd = fsGetDoc_('vattu/stockin');
  const stockin = sd ? JSON.parse(fsField_(sd, 'json') || '[]') : [];
  const autolog = [];
  fsListDocs_('vattu_autolog')
    .sort(function (a, b) { return Number(a.name.split('/').pop().slice(1)) - Number(b.name.split('/').pop().slice(1)); })
    .forEach(function (doc) { JSON.parse(fsField_(doc, 'json') || '[]').forEach(function (e) { autolog.push(e); }); });

  const ss = SpreadsheetApp.getActive();
  fsWriteTable_(ss, FS_TAB_VATTU, ['Mã vật tư', 'Tên vật tư', 'Yêu cầu kỹ thuật và vật liệu'].concat(holders),
    (st.materials || []).map(function (m) {
      return [m.code, m.name, m.spec || ''].concat(holders.map(function (h) { return Number(m.qty && m.qty[h]) || 0; }));
    }), false);
  fsWriteTable_(ss, FS_TAB_VATTU_LOG, ['Ngày nhập', 'Mã vật tư', 'Tên vật tư', 'Số lượng nhập', 'Người giữ'],
    stockin.map(function (r) { return [r.date, r.code, r.name, r.qty, r.holder]; }), true);
  fsWriteTable_(ss, 'VAT TU TU DONG TRU', ['Khoá dòng', 'Ngày xử lý', 'Mã vật tư', 'Tên vật tư', 'Số lượng đã trừ', 'Người bị trừ'],
    autolog.map(function (e) { return [e.k, e.d, e.code, e.name, e.qty, e.holder]; }), true);

  props.setProperty(FS_PROP_MIRROR_REV, rev);
  return 1;
}

function fsWriteTable_(ss, name, headers, rows, firstColText) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const width = Math.max(headers.length, sh.getLastColumn(), 1);
  const oldRows = Math.max(sh.getLastRow(), 1);
  sh.getRange(1, 1, oldRows, width).clearContent();
  const pad = function (r) { const a = r.slice(); while (a.length < headers.length) a.push(''); return a; };
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    if (firstColText) sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows.map(pad));
  }
}

// ============================== FIRESTORE REST ==============================

function fsSa_() {
  const raw = PropertiesService.getScriptProperties().getProperty(FS_PROP_SA);
  if (!raw) throw new Error('Chưa cấu hình: thêm Script Property "' + FS_PROP_SA + '" = nội dung file JSON service account của Firebase.');
  let sa;
  try { sa = JSON.parse(raw); }
  catch (e) {
    throw new Error('FIREBASE_SA phải là NỘI DUNG file .json (bắt đầu bằng dấu { ), không phải tên file. ' +
      'Mở file .json bằng Notepad -> Ctrl+A -> Ctrl+C -> dán vào Giá trị. Hiện đang là: "' + String(raw).slice(0, 40) + '"');
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIREBASE_SA không đúng định dạng file JSON service account.');
  return sa;
}

function fsToken_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fs_token');
  if (hit) return hit;
  const sa = fsSa_();
  const now = Math.floor(Date.now() / 1000);
  const enc = function (o) { return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, ''); };
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, sa.private_key)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }
  });
  if (res.getResponseCode() !== 200) throw new Error('Không lấy được token Firebase: ' + res.getContentText());
  const tok = JSON.parse(res.getContentText()).access_token;
  cache.put('fs_token', tok, 3000);
  return tok;
}

function fsDocName_(path) {
  return 'projects/' + fsSa_().project_id + '/databases/(default)/documents/' + path;
}

function fsFetch_(method, url, body) {
  const opt = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + fsToken_() } };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore ' + code + ': ' + res.getContentText().slice(0, 500));
  const txt = res.getContentText();
  return txt ? JSON.parse(txt) : {};
}

function fsBaseUrl_() {
  return 'https://firestore.googleapis.com/v1/projects/' + fsSa_().project_id + '/databases/(default)/documents';
}

function fsGetDoc_(path) {
  return fsFetch_('get', fsBaseUrl_() + '/' + path.split('/').map(encodeURIComponent).join('/'));
}

function fsListDocs_(collection) {
  const out = [];
  let token = '';
  do {
    const r = fsFetch_('get', fsBaseUrl_() + '/' + collection + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    ((r && r.documents) || []).forEach(function (d) { out.push(d); });
    token = r && r.nextPageToken;
  } while (token);
  return out;
}

/** Ghi nhiều tài liệu NGUYÊN TỬ (tất cả hoặc không gì). Firestore giới hạn 500 thao tác/lần. */
function fsCommit_(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    fsFetch_('post', fsBaseUrl_() + ':commit', { writes: writes.slice(i, i + 400) });
  }
}

function fsField_(doc, name) {
  const f = doc && doc.fields && doc.fields[name];
  if (!f) return null;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('timestampValue' in f) return f.timestampValue;
  if ('booleanValue' in f) return f.booleanValue;
  return null;
}

// ============================== TIỆN ÍCH ==============================

function fsWithLock_(fn) {
  const lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(28000)) { console.warn('Đồng bộ khác đang chạy, bỏ qua lần này (lần quét sau sẽ bù).'); return; }
  try { return fn(); } finally { lock.releaseLock(); }
}

function fsMd5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function fsUtf8Len_(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; } else n += 3;
  }
  return n;
}

function fsStripAccents_(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

function fsAlert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }   // chạy từ trình soạn thảo/trigger thì không có UI
}
