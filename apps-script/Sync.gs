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
 *       HAI CHIỀU: sửa tay VAT TU (danh mục, tồn kho theo người giữ) hoặc VAT TU NHAP KHO (lịch sử
 *       nhập) -> đẩy ngược lên app ngay. VAT TU TU DONG TRU vẫn chỉ đọc. Bản sửa sau cùng thắng.
 *
 * CÀI ĐẶT (1 lần) — chi tiết trong README:
 *   1. Firebase Console -> Project settings -> Service accounts -> Generate new private key (tải file JSON).
 *   2. Apps Script -> Project Settings (bánh răng) -> Script Properties -> Add:
 *        Property: FIREBASE_SA     Value: dán TOÀN BỘ nội dung file JSON vừa tải.
 *   3. Chọn hàm caiDatDongBoFirebase trong thanh công cụ -> Run -> cấp quyền.
 *
 * PHIẾU SỬA CHỮA (app th-truemart-repair-app, dự án Firebase RIÊNG) — cấp quyền chung sheet APP USERS:
 *   4. Firebase của app Phiếu sửa chữa -> Service accounts -> Generate new private key.
 *   5. Script Properties -> Add:  FIREBASE_SA_PSC = nội dung file JSON đó.
 *   6. Chạy hàm caiDatPhieuSuaChua (hoặc menu App TM -> "Cài đặt cấp quyền Phiếu sửa chữa").
 *
 * TH TRUE CARE (app th-true-care, CHUNG Firebase th-truemart-info -> cùng tài khoản đăng nhập):
 *   Cột "TH true care" trong APP USERS (admin / user) -> care_users/<email>. Tự thêm cột, không cần cài gì.
 *   Dữ liệu của app đó do Sync.gs riêng bên file GT đẩy lên.
 *
 * Định dạng dữ liệu trên Firestore: xem đầu file js/app.js trong repo.
 */

// ============================== CẤU HÌNH ==============================

// Vị trí dữ liệu. Đổi tên tab / file ở đây nếu sau này bạn di chuyển sheet.
const FS_TAB_STORES = 'DS CH';
const FS_TAB_STORES_OFF = 'CH OFF';   // cửa hàng đã đóng — biểu đồ Đang hoạt động / Đóng cửa theo Miền
const FS_TAB_ASSETS = 'TAI SAN';
const FS_TAB_MAINT = 'BAO DUONG';
const FS_TAB_CHIPHI = 'CHI PHI';
const FS_TAB_SANAKY = 'SANAKY';                       // tab trong file TM
const FS_TAB_NCC_TABS = 'NCC THEO DÕI';               // cấu hình tab NCC ở trang Cửa hàng
const FS_TAB_VATTU = 'VAT TU';
const FS_TAB_VATTU_LOG = 'VAT TU NHAP KHO';
const FS_DG_FILE_ID = '1RFVctqPlPvLodhscIMxIMLrRgIEjSLLUlFUsqI2anSQ';   // file "DG"
const FS_TAB_DG_BT = 'DON GIA BT';
const FS_TAB_DG_XD = 'DON GIA XD';
const FS_TAB_DG_SNK = 'DON GIA SNK';

const FS_PROP_SA = 'FIREBASE_SA';              // Firebase của Hệ thống quản lý (th-truemart-info)
const FS_PROP_SA_PSC = 'FIREBASE_SA_PSC';      // Firebase của app Phiếu sửa chữa
const FS_PROP_PSC_ON = 'fs_psc_enabled';       // '1' sau khi chạy caiDatPhieuSuaChua
const FS_PROP_PSC_HASH = 'fs_psc_users_hash';
const FS_PROP_CARE_HASH = 'fs_care_users_hash';
const FS_PROP_ACCOUNTS = 'fs_accounts_done';   // { "<prop>|<email>": "created" | "existing" }
// Địa chỉ các app — dùng trong email gửi người mới
const FS_URL_TM = 'https://th-truemart-info.vercel.app';
const FS_URL_PSC = 'https://th-truemart-repair-app.vercel.app';
const FS_URL_CARE = 'https://th-true-care.vercel.app';
const FS_PROP_MIRROR_REV = 'fs_vattu_mirror_rev';
const FS_PROP_USERS_HASH = 'fs_users_hash';
const FS_SHEET_USERS = 'APP USERS';
/** Mỗi tài liệu Firestore tối đa 1 MiB. Cắt theo BYTE UTF-8 (chữ Việt có dấu 3 byte/ký tự), chừa biên. */
const FS_CHUNK_BYTES = 700000;
const FS_AUTOLOG_CHUNK = 2500;          // phải khớp AUTOLOG_CHUNK_MAX trong js/app.js
const FS_TICK_HOURS = [7, 19];   // quét dự phòng chỉ trong khung giờ này (giờ VN)

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
    { key: 'storesoff', name: FS_TAB_STORES_OFF, mode: 'raw', sheet: function () { return active.getSheetByName(FS_TAB_STORES_OFF); } },
    { key: 'ncctabs', name: FS_TAB_NCC_TABS, mode: 'display', sheet: function () { return fsEnsureNccTabsSheet_(active); } },
    // Đơn giá ở file DG riêng. Mở thẳng bằng ID (không dùng getDongiaSpreadsheet_ vì hàm đó lặng lẽ
    // quay về file TM khi ID sai -> đồng bộ báo "không tìm thấy" mà không rõ vì sao).
    { key: 'dongia_bt',  name: FS_TAB_DG_BT,  mode: 'raw', external: true, sheet: function () { return fsDongiaSs_().getSheetByName(FS_TAB_DG_BT); } },
    { key: 'dongia_xd',  name: FS_TAB_DG_XD,  mode: 'raw', external: true, sheet: function () { return fsDongiaSs_().getSheetByName(FS_TAB_DG_XD); } },
    { key: 'dongia_snk', name: FS_TAB_DG_SNK, mode: 'raw', external: true, sheet: function () { return fsDongiaSs_().getSheetByName(FS_TAB_DG_SNK); } }
  ];
}

/** Sheet cấu hình tab NCC: chưa có thì tự tạo sẵn 4 tab đang dùng. */
function fsEnsureNccTabsSheet_(ss) {
  let sh = ss.getSheetByName(FS_TAB_NCC_TABS);
  if (sh) return sh;
  sh = ss.insertSheet(FS_TAB_NCC_TABS);
  sh.getRange(1, 1, 5, 4).setValues([
    ['Tên tab', 'Nhận diện', 'Trừ kho vật tư', 'Trừ kho từ ngày'],
    ['DAIKIN', '', '', ''], ['PSMART', '', '', ''], ['Minh Hoàng', '', '', ''], ['TD LIGHTING', '', 'Có', '']
  ]);
  sh.getRange(1, 1, 1, 4).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 200); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 130); sh.setColumnWidth(4, 140);
  sh.getRange(2, 4, 200, 1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(1, 6).setValue('Mỗi dòng là một tab ở "Theo dõi chi phí sửa chữa". Nhận diện: chữ cần có trong cột "Nhà cung cấp" ' +
    'của CHI PHI (bỏ trống = dùng Tên tab; nhiều từ cách nhau dấu phẩy). Trừ kho vật tư: ghi "Có" để dòng CHI PHI của NCC này ' +
    'được trừ kho khi bấm Khớp vật tư. Trừ kho từ ngày: bỏ trống = mọi ngày; điền ngày thì chỉ trừ các dòng từ ngày đó.');
  return sh;
}

// ============================== MENU + CÀI ĐẶT ==============================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('App TM')
    .addItem('Đồng bộ toàn bộ lên app', 'dongBoToanBoLenApp')
    .addItem('Kéo vật tư từ app về sheet', 'keoVatTuVeSheet')
    .addSeparator()
    .addItem('Cài đặt / cài lại đồng bộ', 'caiDatDongBoFirebase')
    .addItem('Cài đặt cấp quyền Phiếu sửa chữa', 'caiDatPhieuSuaChua')
    .addItem('Gửi lại email đặt mật khẩu (dòng đang chọn)', 'guiLaiEmailDatMatKhau')
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
    us.getRange(1, 1, 1, 2).setValues([['Email', 'Hệ thống quản lý']]);
    if (me) us.getRange(2, 1, 1, 2).setValues([[me, 'admin']]);
    us.setColumnWidth(1, 260);
  }
  fsEnsureUsersLayout_(us);

  // Trigger: xoá trigger cũ của file này rồi tạo lại
  const mine = ['fsOnEdit', 'fsOnChange', 'fsTick', 'fsOnOpenPull'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (mine.indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  /* Sheet dữ liệu (DS CH, CHI PHI, ...) KHÔNG đẩy ngay theo từng lần sửa: dữ liệu được cập nhật
     hàng loạt vài lần/tháng, đẩy ngay sẽ đưa lên app bản đang dán dở. Admin bấm "Đồng bộ từ Google
     Sheet" trên app (Web app doPost bên dưới) sau khi dán xong. Hai trigger sửa ô / xoá-chèn dòng
     chỉ còn lo APP USERS (cấp quyền) và VAT TU / VAT TU NHAP KHO (sửa tay đẩy lên app). */
  ScriptApp.newTrigger('fsOnEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('fsOnChange').forSpreadsheet(ss).onChange().create();
  // Mở file TM -> kéo kho vật tư mới nhất từ app về sheet trước, để luôn sửa trên bản mới nhất.
  ScriptApp.newTrigger('fsOnOpenPull').forSpreadsheet(ss).onOpen().create();
  // Lưới an toàn: quét 1 giờ/lần, chỉ chạy trong giờ làm việc (fsTick tự bỏ qua ngoài FS_TICK_HOURS).
  ScriptApp.newTrigger('fsTick').timeBased().everyHours(1).create();
  const dgNote = '';

  // Lần đầu: đưa kho vật tư hiện có lên app (bỏ qua nếu app đã có dữ liệu vật tư)
  const imported = fsImportVatTu_(false);
  const res = fsSyncAll_(true);
  const msg = 'Đã cài đồng bộ.\n' +
    '- Bảng đã đẩy lên: ' + (res.changed.join(', ') || '(không đổi)') + '\n' +
    '- Kho vật tư: ' + (imported ? 'đã đưa lên app lần đầu' : 'app đã có sẵn, giữ nguyên') + '\n' +
    '- Sheet dữ liệu: admin bấm "Đồng bộ từ Google Sheet" trên app; quét dự phòng 1 giờ/lần (' + FS_TICK_HOURS[0] + 'h–' + FS_TICK_HOURS[1] + 'h).' + dgNote + '\n' +
    '- APP USERS, VAT TU, VAT TU NHAP KHO: sửa là đẩy lên app ngay.\n' +
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
    if (name === FS_SHEET_USERS) { fsWithLock_(function () { fsSyncAllUsers_(false); }); return; }
    if (name === FS_TAB_VATTU || name === FS_TAB_VATTU_LOG) { fsWithLock_(function () { fsPushVatTuSheet_(name); }); return; }
    // Sheet dữ liệu: KHÔNG đẩy ngay (xem caiDatDongBoFirebase) — chờ admin bấm đồng bộ trên app.
  } catch (err) {
    console.error('fsOnEdit: ' + err.message);
  }
}

/** Trigger cài đặt onChange — xoá/chèn dòng, dán nhiều ô... (những thay đổi onEdit không bắt được).
 *  Không biết chính xác tab nào đổi -> đồng bộ tab đang mở; tab khác vẫn được lượt quét 10 phút bù. */
function fsOnChange(e) {
  try {
    const t = e && e.changeType;
    if (t === 'FORMAT') return;
    const sh = e && e.source ? e.source.getActiveSheet() : null;
    const name = sh ? sh.getName() : '';
    if (name === FS_SHEET_USERS) { fsWithLock_(function () { fsSyncAllUsers_(false); }); return; }
    if (name === FS_TAB_VATTU || name === FS_TAB_VATTU_LOG) { fsWithLock_(function () { fsPushVatTuSheet_(name); }); return; }
  } catch (err) {
    console.error('fsOnChange: ' + err.message);
  }
}

/** Mở file TM -> kéo kho vật tư + các ô đã xác nhận vật tư/người giữ từ app về sheet. */
function fsOnOpenPull() {
  try { fsWithLock_(function () { fsMirrorVatTu_(false); }); } catch (err) { console.error('fsOnOpenPull: ' + err.message); }
}

/** Trigger thời gian — quét toàn bộ (chỉ ghi bảng nào thật sự đổi) + kéo vật tư về sheet. */
function fsTick() {
  const h = Number(Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'H'));
  if (h < FS_TICK_HOURS[0] || h >= FS_TICK_HOURS[1]) return;   // ngoài giờ làm việc: không quét
  try { fsWithLock_(function () { fsMirrorVatTu_(false); }); } catch (err) { console.error('fsTick mirror: ' + err.message); }
  try { fsSyncAll_(false); } catch (err) { console.error('fsTick sync: ' + err.message); }
}

// ============================== WEB APP: NÚT "ĐỒNG BỘ TỪ GOOGLE SHEET" TRÊN APP ==============================
/**
 * App (admin) gọi POST { action:'sync', idToken }. Kiểm tra token đăng nhập Firebase -> email ->
 * phải là admin cột "Hệ thống quản lý" trong APP USERS. Đạt thì: đẩy các sheet có thay đổi lên,
 * ghi kho vật tư + ô đã xác nhận về sheet, trả danh sách sheet đã đổi.
 * Triển khai: Apps Script -> Triển khai -> Tùy chọn triển khai mới -> Ứng dụng web
 *   (Thực thi với tư cách: Tôi · Ai có quyền truy cập: Bất kỳ ai). Dán link vào js/firebase-config.js (SYNC_URL).
 */
function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const email = fsVerifyIdToken_(body.idToken);
    const me = fsReadUsers_().rows.filter(function (r) { return r.email === email; })[0];
    if (!me || me.tm !== 'admin') throw new Error('Tài khoản ' + email + ' không có quyền đồng bộ dữ liệu.');
    out = fsWebSync_();
  } catch (err) {
    out = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function fsVerifyIdToken_(idToken) {
  if (!idToken) throw new Error('Chưa đăng nhập.');
  let r;
  try { r = fsFetch_('post', fsAuthUrl_(':lookup'), { idToken: idToken }); }
  catch (err) { throw new Error('Phiên đăng nhập hết hạn — tải lại trang rồi thử lại.'); }
  const u = r && r.users && r.users[0];
  if (!u || !u.email) throw new Error('Phiên đăng nhập không hợp lệ.');
  return String(u.email).toLowerCase();
}

function fsWebSync_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) throw new Error('Đang có lượt đồng bộ khác chạy, thử lại sau ít phút.');
  try {
    // Kéo kho vật tư + ghi ô đã xác nhận vật tư/người giữ về sheet TRƯỚC, rồi mới đọc meta.
    try { fsMirrorVatTu_(false); } catch (err) { console.error('web mirror: ' + err.message); }
    const meta = fsReadMeta_();
    const before = {};
    Object.keys(meta.sheets || {}).forEach(function (k) { before[k] = meta.sheets[k].rowCount; });
    const changed = [], details = [];
    fsSources_().forEach(function (src) {
      let r = null;
      try { r = fsSyncOne_(src, meta, false); } catch (err) { console.error('web sync ' + src.key + ': ' + err.message); }
      if (r) {
        changed.push(src.key);
        const n = meta.sheets[src.key].rowCount, o = before[src.key];
        const label = src.name;
        details.push(o === undefined ? label + ' ' + n + ' dòng'
          : (n !== o ? label + ' ' + (n > o ? '+' : '−') + Math.abs(n - o) + ' dòng' : label + ' sửa nội dung'));
      }
    });
    fsWriteMetaOnly_(meta);
    try { fsSyncAllUsers_(false); } catch (err) { console.error('web users: ' + err.message); }
    return { ok: true, changed: changed, details: details, at: new Date().toISOString() };
  } finally { lock.releaseLock(); }
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
    fsSyncAllUsers_(force);
    fsWriteMetaOnly_(meta);    // cập nhật mốc "Cập nhật lần cuối" kể cả khi không bảng nào đổi
  });
  return { changed: changed, missing: missing };
}

/** Trả true nếu đã ghi lên Firestore, false nếu không đổi, null nếu không tìm thấy sheet. */
function fsSyncOne_(src, meta, force) {
  let sh = null;
  try { sh = src.sheet(); } catch (e) { sh = null; }
  if (!sh) return null;

  if (src.key === 'chiphi') fsEnsureChiPhiIds_(sh);   // điền ID cố định trước khi đọc
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

// ============================== ID CỐ ĐỊNH CHO DÒNG CHI PHÍ ==============================
// Mỗi dòng CHI PHÍ có một ID không đổi (cột "ID" ẩn ở cuối bảng). App dùng ID này để nhớ dòng nào
// đã trừ kho vật tư: sửa nội dung dòng thì vẫn là dòng cũ -> không trừ lại; xoá dòng thì app xoá
// luôn bản ghi đã trừ. Script tự thêm cột, tự điền ID cho dòng mới, cấp ID mới cho dòng bị chép
// trùng ID. KHÔNG sửa tay cột này.
const FS_CP_ID_HEADER = 'ID';

function fsEnsureChiPhiIds_(sh) {
  const lastRow = sh.getLastRow();
  let lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return;
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  let col = headers.indexOf(FS_CP_ID_HEADER) + 1;
  if (!col) {
    col = lastCol + 1;
    sh.getRange(1, col).setValue(FS_CP_ID_HEADER);
    try { sh.hideColumns(col); } catch (e) { /* bỏ qua */ }
    lastCol = col;
  }
  fsExtendFilterTo_(sh, col);   // bộ lọc phải phủ cả cột ID, nếu không sắp xếp sẽ làm lệch ID
  if (lastRow < 2) return;

  const vals = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const base = 'CP' + Date.now().toString(36).toUpperCase();
  const seen = {};
  let n = 0, changed = false;
  const ids = vals.map(function (r) {
    let id = String(r[col - 1] === null ? '' : r[col - 1]).trim();
    const hasData = r.some(function (c, j) { return j !== col - 1 && c !== '' && c !== null; });
    if (!hasData) { if (id) changed = true; return ['']; }        // dòng đã xoá nội dung -> bỏ ID thừa
    if (!id || seen[id]) { id = base + '-' + (++n); changed = true; }
    seen[id] = true;
    return [id];
  });
  if (changed) sh.getRange(2, col, ids.length, 1).setNumberFormat('@').setValues(ids);
}

/** Nới bộ lọc (Data > Bộ lọc) sang tới cột `col`, giữ nguyên điều kiện lọc đang có. */
function fsExtendFilterTo_(sh, col) {
  const f = sh.getFilter();
  if (!f) return;
  const r = f.getRange();
  if (r.getLastColumn() >= col) return;
  const crit = {};
  for (let c = r.getColumn(); c <= r.getLastColumn(); c++) {
    const k = f.getColumnFilterCriteria(c);
    if (k) crit[c] = k.copy().build();
  }
  f.remove();
  const rows = Math.max(r.getNumRows(), sh.getLastRow() - r.getRow() + 1);
  const nf = sh.getRange(r.getRow(), r.getColumn(), rows, col - r.getColumn() + 1).createFilter();
  Object.keys(crit).forEach(function (c) { nf.setColumnFilterCriteria(Number(c), crit[c]); });
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

// ============================== NGƯỜI DÙNG (sheet APP USERS) ==============================
//
// Một sheet cấp quyền cho CẢ BA app:
//
//   Email | Hệ thống quản lý | Phiếu sửa chữa | TH true care | Ghi chú | Tài khoản (tự động)
//
//   Các cột quyền chỉ dùng HAI giá trị:  admin  /  user   (để trống = không vào được)
//   Hệ thống quản lý -> Firebase th-truemart-info: users/<email> { role, uid }
//       admin = Quản trị (sửa vật tư, không cần mật khẩu 121212), user = Người dùng (chỉ xem)
//   Phiếu sửa chữa   -> Firebase của app sửa chữa: members/<email> { role, uid } + admins/<email>
//       admin = Quản trị (sửa bảng giá, cửa hàng, xem mọi phiếu), user = Người dùng (phiếu của mình)
//   TH true care     -> CÙNG Firebase th-truemart-info: care_users/<email> { role, uid }
//       app chỉ tra cứu: admin và user xem như nhau (cùng tài khoản với Hệ thống quản lý)
//   uid = mã tài khoản Sync.gs tạo/tra được — rules dùng để chặn người tự đăng ký trùng email.
//   Tài khoản (tự động): Sync.gs ghi — đừng gõ tay.
//
// Cột nhận theo TÊN tiêu đề (không theo vị trí), nên chèn thêm cột khác hay đổi thứ tự đều được.
// Thêm email mới có quyền -> Sync.gs tự tạo tài khoản đăng nhập và gửi email đặt mật khẩu.

const FS_COL_EMAIL = 'Email';
const FS_COL_TM = 'Hệ thống quản lý';
const FS_COL_PSC = 'Phiếu sửa chữa';
const FS_COL_CARE = 'TH true care';
const FS_COL_NOTE = 'Ghi chú';
const FS_COL_STATUS = 'Tài khoản (tự động)';

/** Chuẩn hoá tiêu đề APP USERS: đổi "Quyền" (bản đầu) -> "Hệ thống quản lý", thêm các cột còn thiếu. */
function fsEnsureUsersLayout_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  let headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const idx = function (name) {
    const k = fsStripAccents_(name);
    return headers.findIndex(function (h) { return fsStripAccents_(h) === k; });
  };
  if (idx(FS_COL_TM) < 0 && idx('Quyền') > -1) {
    sh.getRange(1, idx('Quyền') + 1).setValue(FS_COL_TM);
    headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  }
  if (idx(FS_COL_EMAIL) < 0) throw new Error('Sheet ' + FS_SHEET_USERS + ' phải có cột "Email" ở dòng tiêu đề.');
  if (idx(FS_COL_TM) < 0) { sh.insertColumnAfter(idx(FS_COL_EMAIL) + 1); sh.getRange(1, idx(FS_COL_EMAIL) + 2).setValue(FS_COL_TM); }
  headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  if (idx(FS_COL_PSC) < 0) { sh.insertColumnAfter(idx(FS_COL_TM) + 1); sh.getRange(1, idx(FS_COL_TM) + 2).setValue(FS_COL_PSC); }
  headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  if (idx(FS_COL_CARE) < 0) { sh.insertColumnAfter(idx(FS_COL_PSC) + 1); sh.getRange(1, idx(FS_COL_PSC) + 2).setValue(FS_COL_CARE); }
  headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  if (idx(FS_COL_NOTE) < 0) { sh.getRange(1, headers.filter(String).length + 1).setValue(FS_COL_NOTE); }
  headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  if (idx(FS_COL_STATUS) < 0) { sh.getRange(1, headers.filter(String).length + 1).setValue(FS_COL_STATUS); }
  headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];

  const n = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, idx(FS_COL_TM) + 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['admin', 'user'], true).setAllowInvalid(true).build());
  sh.getRange(2, idx(FS_COL_PSC) + 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['admin', 'user'], true).setAllowInvalid(true).build());
  sh.getRange(2, idx(FS_COL_CARE) + 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['admin', 'user'], true).setAllowInvalid(true).build());
  sh.getRange(1, 1, 1, headers.filter(String).length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/** Đọc APP USERS -> [{ row, email, tm, psc, care }]. tm: admin|viewer|'' ; psc: admin|staff|'' ; care: admin|user|'' */
function fsReadUsers_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(FS_SHEET_USERS);
  if (!sh || sh.getLastRow() < 2) return { sh: sh, cols: null, rows: [] };
  const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getDisplayValues();
  const H = vals[0].map(fsStripAccents_);
  const col = function (name) { return H.indexOf(fsStripAccents_(name)); };
  const cols = { email: col(FS_COL_EMAIL), tm: col(FS_COL_TM) > -1 ? col(FS_COL_TM) : col('Quyền'),
    psc: col(FS_COL_PSC), care: col(FS_COL_CARE), status: col(FS_COL_STATUS) };
  if (cols.email < 0) cols.email = 0;
  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const email = String(vals[i][cols.email] || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) continue;
    rows.push({
      row: i + 1, email: email,
      tm: cols.tm > -1 ? fsTmRole_(vals[i][cols.tm]) : '',
      psc: cols.psc > -1 ? fsPscRole_(vals[i][cols.psc]) : '',
      care: cols.care > -1 ? fsCareRole_(vals[i][cols.care]) : '',
      status: cols.status > -1 ? vals[i][cols.status] : ''
    });
  }
  return { sh: sh, cols: cols, rows: rows };
}

function fsTmRole_(v) {
  const raw = fsStripAccents_(v);
  if (!raw) return '';
  if (raw.indexOf('admin') > -1 || raw.indexOf('quan tri') > -1) return 'admin';
  return 'viewer';   // user (và mọi giá trị khác) = người dùng: chỉ xem, không thấy nút ghi
}

function fsPscRole_(v) {
  const raw = fsStripAccents_(v);
  if (!raw) return '';
  if (raw.indexOf('admin') > -1 || raw.indexOf('quan tri') > -1) return 'admin';
  return 'staff';    // user (và mọi giá trị khác) = người dùng
}

function fsCareRole_(v) {
  const raw = fsStripAccents_(v);
  if (!raw) return '';
  if (raw.indexOf('admin') > -1 || raw.indexOf('quan tri') > -1) return 'admin';
  return 'user';
}

/** Đưa các giá trị cũ (nhân viên, editor, viewer...) về đúng 2 giá trị admin / user cho dễ đọc. */
function fsNormalizeRoleCells_(data) {
  if (!data.sh || !data.cols) return;
  [data.cols.tm, data.cols.psc, data.cols.care].forEach(function (c) {
    if (c < 0) return;
    const rng = data.sh.getRange(2, c + 1, Math.max(data.sh.getLastRow() - 1, 1), 1);
    const vals = rng.getDisplayValues();
    let changed = false;
    const out = vals.map(function (r) {
      const raw = fsStripAccents_(r[0]);
      if (!raw || raw === 'admin' || raw === 'user') return [r[0]];
      changed = true;
      return [(raw.indexOf('admin') > -1 || raw.indexOf('quan tri') > -1) ? 'admin' : 'user'];
    });
    if (changed) rng.setValues(out);
  });
}

function fsPscOn_() {
  return fsHasTarget_(FS_PROP_SA_PSC) && PropertiesService.getScriptProperties().getProperty(FS_PROP_PSC_ON) === '1';
}

/** Đồng bộ quyền cho cả hai app + tạo tài khoản cho người mới. Gọi trong fsWithLock_. */
function fsSyncAllUsers_(force) {
  let data = fsReadUsers_();
  if (!data.sh) return;
  // Cập nhật danh sách chọn (admin / user) cho sheet đã tạo từ bản cũ — chỉ làm một lần
  const props0 = PropertiesService.getScriptProperties();
  if (props0.getProperty('fs_users_layout_v') !== '3') {   // 3: thêm cột "TH true care"
    try { fsEnsureUsersLayout_(data.sh); props0.setProperty('fs_users_layout_v', '3'); data = fsReadUsers_(); }
    catch (e) { console.error('Cập nhật cột APP USERS: ' + e.message); }
  }
  try { fsNormalizeRoleCells_(data); } catch (e) { console.error('Chuẩn hoá quyền: ' + e.message); }
  // Tạo tài khoản TRƯỚC để biết uid, rồi mới ghi quyền (kèm uid) lên Firestore
  try { fsProvisionAccounts_(data); } catch (e) { console.error('Tạo tài khoản: ' + e.message); }
  const done = fsAccountsDone_();
  try { fsSyncTmUsers_(data.rows, force, done); } catch (e) { console.error('Quyền Hệ thống quản lý: ' + e.message); }
  try { fsSyncCareUsers_(data.rows, force, done); } catch (e) { console.error('Quyền TH true care: ' + e.message); }
  if (fsPscOn_()) {
    try { fsSyncPscUsers_(data.rows, force, done); } catch (e) { console.error('Quyền Phiếu sửa chữa: ' + e.message); }
  }
}

/** uid đã biết của email ở một dự án ('' nếu chưa biết). */
function fsUidOf_(done, prop, email) {
  const v = done[prop + '|' + email];
  return (v && typeof v === 'object' && v.uid) ? v.uid : '';
}

function fsSyncTmUsers_(rows, force, done) {
  done = done || fsAccountsDone_();
  const want = {};
  rows.forEach(function (r) { if (r.tm) want[r.email] = { role: r.tm, uid: fsUidOf_(done, FS_PROP_SA, r.email) }; });
  const hash = fsMd5_(JSON.stringify(want));
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty(FS_PROP_USERS_HASH) === hash) return;

  const existing = fsListDocs_('users').map(function (d) { return decodeURIComponent(d.name.split('/').pop()); });
  const writes = Object.keys(want).map(function (email) {
    return { update: { name: fsDocName_('users/' + email), fields: {
      role: { stringValue: want[email].role }, uid: { stringValue: want[email].uid } } } };
  });
  existing.forEach(function (id) {
    if (!want.hasOwnProperty(id)) writes.push({ delete: fsDocName_('users/' + id) });
  });
  if (writes.length) fsCommit_(writes);
  props.setProperty(FS_PROP_USERS_HASH, hash);
}

/** TH true care: cùng Firebase th-truemart-info, danh sách riêng care_users/<email>. */
function fsSyncCareUsers_(rows, force, done) {
  done = done || fsAccountsDone_();
  const want = {};
  rows.forEach(function (r) { if (r.care) want[r.email] = { role: r.care, uid: fsUidOf_(done, FS_PROP_SA, r.email) }; });
  const hash = fsMd5_(JSON.stringify(want));
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty(FS_PROP_CARE_HASH) === hash) return;

  const existing = fsListDocs_('care_users').map(function (d) { return decodeURIComponent(d.name.split('/').pop()); });
  const writes = Object.keys(want).map(function (email) {
    return { update: { name: fsDocName_('care_users/' + email), fields: {
      role: { stringValue: want[email].role }, uid: { stringValue: want[email].uid } } } };
  });
  existing.forEach(function (id) {
    if (!want.hasOwnProperty(id)) writes.push({ delete: fsDocName_('care_users/' + id) });
  });
  if (writes.length) fsCommit_(writes);
  props.setProperty(FS_PROP_CARE_HASH, hash);
}

function fsSyncPscUsers_(rows, force, done) {
  done = done || fsAccountsDone_();
  const want = {};
  rows.forEach(function (r) { if (r.psc) want[r.email] = { role: r.psc, uid: fsUidOf_(done, FS_PROP_SA_PSC, r.email) }; });
  const hash = fsMd5_(JSON.stringify(want));
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty(FS_PROP_PSC_HASH) === hash) return;

  fsWithTarget_(FS_PROP_SA_PSC, function () {
    const now = new Date().toISOString();
    const members = fsListDocs_('members').map(function (d) { return decodeURIComponent(d.name.split('/').pop()); });
    const admins = fsListDocs_('admins').map(function (d) { return decodeURIComponent(d.name.split('/').pop()); });
    const writes = [];
    Object.keys(want).forEach(function (email) {
      const w = want[email];
      writes.push({ update: { name: fsDocName_('members/' + email), fields: {
        role: { stringValue: w.role }, uid: { stringValue: w.uid }, via: { stringValue: 'sheet' }, updatedAt: { timestampValue: now } } } });
      if (w.role === 'admin') {
        writes.push({ update: { name: fsDocName_('admins/' + email), fields: { role: { stringValue: 'admin' }, uid: { stringValue: w.uid } } } });
      }
    });
    members.forEach(function (email) { if (!want.hasOwnProperty(email)) writes.push({ delete: fsDocName_('members/' + email) }); });
    admins.forEach(function (email) { if (!want[email] || want[email].role !== 'admin') writes.push({ delete: fsDocName_('admins/' + email) }); });
    if (writes.length) fsCommit_(writes);
  });
  props.setProperty(FS_PROP_PSC_HASH, hash);
}

// ---------- Tạo tài khoản + email đặt mật khẩu ----------

function fsAccountsDone_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(FS_PROP_ACCOUNTS) || '{}'); }
  catch (e) { return {}; }
}

/**
 * Với mỗi email có quyền ở một app mà CHƯA xử lý: tạo tài khoản nếu chưa có (rồi gửi một email đặt
 * mật khẩu gộp cho mọi app mới tạo), hoặc đánh dấu "đã xác minh" nếu đã có tài khoản sẵn.
 * Ghi kết quả vào cột "Tài khoản (tự động)". Mỗi email/app chỉ xử lý MỘT lần.
 */
function fsProvisionAccounts_(data) {
  // Firebase th-truemart-info dùng chung cho Hệ thống quản lý + TH true care: MỘT tài khoản cho cả hai.
  const targets = [{ prop: FS_PROP_SA, apps: function (r) {
    const a = [];
    if (r.tm) a.push({ name: 'Hệ thống quản lý', url: FS_URL_TM });
    if (r.care) a.push({ name: 'TH true care', url: FS_URL_CARE });
    return a;
  } }];
  if (fsPscOn_()) targets.push({ prop: FS_PROP_SA_PSC, apps: function (r) {
    return r.psc ? [{ name: 'Phiếu sửa chữa', url: FS_URL_PSC }] : [];
  } });
  const done = fsAccountsDone_();
  const statusByRow = {};
  let changed = false;

  data.rows.forEach(function (r) {
    const links = [];
    const notes = [];
    targets.forEach(function (t) {
      const apps = t.apps(r);
      if (!apps.length) return;
      const name = apps.map(function (a) { return a.name; }).join(' + ');
      const k = t.prop + '|' + r.email;
      const prev = done[k];
      const prevState = prev && typeof prev === 'object' ? prev.s : prev;   // bản cũ lưu chuỗi, chưa có uid
      if (prev && typeof prev === 'object' && prev.uid) {
        notes.push(name + ': ' + (prevState === 'created' ? 'đã tạo' : 'đã có') + ' tài khoản');
        return;
      }
      try {
        fsWithTarget_(t.prop, function () {
          const u = fsAuthLookup_(r.email);
          if (u) {
            if (!prev && !u.emailVerified) fsAuthMarkVerified_(u.localId);
            done[k] = { s: prevState || 'existing', uid: u.localId };
            notes.push(name + ': ' + (prevState === 'created' ? 'đã tạo' : 'đã có') + ' tài khoản');
          } else {
            const created = fsAuthCreate_(r.email);
            links.push({ apps: apps, link: fsAuthResetLink_(r.email, apps[0].url) });
            done[k] = { s: 'created', uid: created.localId };
            notes.push(name + ': đã tạo tài khoản');
          }
        });
        changed = true;
      } catch (e) {
        notes.push(name + ': LỖI ' + e.message.slice(0, 120));
      }
    });
    if (links.length) {
      try {
        fsSendWelcomeMail_(r.email, links);
        notes.push('đã gửi email đặt mật khẩu ' + Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM HH:mm'));
      } catch (e) {
        notes.push('LỖI gửi email: ' + e.message.slice(0, 120));
      }
    }
    if (notes.length) statusByRow[r.row] = notes.join(' · ');
  });

  if (changed) PropertiesService.getScriptProperties().setProperty(FS_PROP_ACCOUNTS, JSON.stringify(done));
  fsWriteStatus_(data, statusByRow);
}

function fsWriteStatus_(data, statusByRow) {
  if (!data.cols || data.cols.status < 0) return;
  Object.keys(statusByRow).forEach(function (row) {
    const r = data.rows.filter(function (x) { return String(x.row) === String(row); })[0];
    if (r && r.status === statusByRow[row]) return;     // không đổi thì khỏi ghi
    data.sh.getRange(Number(row), data.cols.status + 1).setValue(statusByRow[row]);
  });
}

function fsSendWelcomeMail_(email, links) {
  // Mỗi mục = một tài khoản (một nút Đặt mật khẩu), dùng được cho một hoặc nhiều app cùng Firebase.
  const lines = links.map(function (l) {
    const apps = l.apps.map(function (a) {
      return '<b>' + a.name + '</b> — <a href="' + a.url + '">' + a.url.replace('https://', '') + '</a>';
    }).join('<br>');
    return '<li style="margin:0 0 14px">' + apps + '<br>' +
      '<a href="' + l.link + '" style="display:inline-block;margin-top:6px;padding:8px 16px;background:#0B4C8C;color:#fff;' +
      'border-radius:8px;text-decoration:none;font-weight:600">Đặt mật khẩu</a></li>';
  }).join('');
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#14202B;line-height:1.55">' +
    '<p>Chào bạn,</p><p>Bạn vừa được cấp tài khoản truy cập ứng dụng TH truemart với email <b>' + email + '</b>:</p>' +
    '<ul style="padding-left:18px">' + lines + '</ul>' +
    '<p>Bấm <b>Đặt mật khẩu</b> để tạo mật khẩu, rồi đăng nhập bằng email này và mật khẩu vừa đặt.<br>' +
    'Link đặt mật khẩu hết hạn sau <b>1 giờ</b>. Quá hạn thì vào app, bấm <b>Quên mật khẩu?</b> để nhận link mới.</p>' +
    '<p>Nếu email này là Gmail, bạn cũng có thể bấm <b>Đăng nhập bằng Google</b> mà không cần mật khẩu.</p>' +
    '<p style="color:#5B6B63;font-size:12px">Email gửi tự động từ hệ thống quản lý của Phòng Dự án và Xây dựng.</p></div>';
  MailApp.sendEmail({ to: email, subject: 'TH truemart — Tài khoản đăng nhập của bạn', htmlBody: html, name: 'TH truemart' });
}

/** Menu: gửi lại email đặt mật khẩu cho dòng đang chọn trong APP USERS (link cũ hết hạn sau 1 giờ). */
function guiLaiEmailDatMatKhau() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getActiveSheet();
  if (sh.getName() !== FS_SHEET_USERS) { fsAlert_('Mở sheet ' + FS_SHEET_USERS + ' và chọn một ô ở dòng của người cần gửi.'); return; }
  const data = fsReadUsers_();
  const row = sh.getActiveRange().getRow();
  const r = data.rows.filter(function (x) { return x.row === row; })[0];
  if (!r) { fsAlert_('Dòng đang chọn không có email hợp lệ.'); return; }
  const links = [];
  const mainApps = [];
  if (r.tm) mainApps.push({ name: 'Hệ thống quản lý', url: FS_URL_TM });
  if (r.care) mainApps.push({ name: 'TH true care', url: FS_URL_CARE });
  if (mainApps.length) fsWithTarget_(FS_PROP_SA, function () {
    if (fsAuthLookup_(r.email)) links.push({ apps: mainApps, link: fsAuthResetLink_(r.email, mainApps[0].url) });
  });
  if (r.psc && fsPscOn_()) fsWithTarget_(FS_PROP_SA_PSC, function () {
    if (fsAuthLookup_(r.email)) links.push({ apps: [{ name: 'Phiếu sửa chữa', url: FS_URL_PSC }], link: fsAuthResetLink_(r.email, FS_URL_PSC) });
  });
  if (!links.length) { fsAlert_('Chưa có tài khoản nào cho ' + r.email + '. Đợi vài giây cho đồng bộ tạo tài khoản rồi thử lại.'); return; }
  fsSendWelcomeMail_(r.email, links);
  fsAlert_('Đã gửi email đặt mật khẩu tới ' + r.email + '.');
}

/**
 * CHẠY 1 LẦN sau khi dán FIREBASE_SA_PSC. Chạy lại bao nhiêu lần cũng được.
 *  1. Chuẩn hoá cột APP USERS (thêm cột "Phiếu sửa chữa", "Tài khoản (tự động)").
 *  2. Nhập NGƯỜI DÙNG ĐANG CÓ của app sửa chữa vào sheet (admin giữ admin, còn lại "user"),
 *     đánh dấu email của họ đã xác minh — để không ai mất quyền khi rules mới bắt buộc điều đó.
 *  3. Đẩy quyền lên Firebase của app sửa chữa.
 */
function caiDatPhieuSuaChua() {
  fsWithTarget_(FS_PROP_SA_PSC, function () { fsSa_(); });   // báo lỗi rõ nếu chưa cấu hình
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(FS_SHEET_USERS);
  if (!sh) { sh = ss.insertSheet(FS_SHEET_USERS); sh.getRange(1, 1).setValue(FS_COL_EMAIL); }
  fsEnsureUsersLayout_(sh);

  const done = fsAccountsDone_();
  const added = [], updated = [];
  fsWithLock_(function () {
    const data = fsReadUsers_();
    const byEmail = {};
    data.rows.forEach(function (r) { byEmail[r.email] = r; });
    const H = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(fsStripAccents_);
    const cEmail = H.indexOf(fsStripAccents_(FS_COL_EMAIL)) + 1;
    const cPsc = H.indexOf(fsStripAccents_(FS_COL_PSC)) + 1;

    fsWithTarget_(FS_PROP_SA_PSC, function () {
      const admins = fsListDocs_('admins').map(function (d) { return decodeURIComponent(d.name.split('/').pop()); });
      const users = fsAuthListAll_();
      const seen = {};
      users.forEach(function (u) {
        const email = String(u.email || '').toLowerCase();
        if (!email || seen[email] || u.disabled) return;
        seen[email] = true;
        if (!u.emailVerified) fsAuthMarkVerified_(u.localId);
        done[FS_PROP_SA_PSC + '|' + email] = { s: 'existing', uid: u.localId };
        const role = admins.indexOf(email) > -1 ? 'admin' : 'user';
        const r = byEmail[email];
        if (!r) {
          const row = sh.getLastRow() + 1;
          sh.getRange(row, cEmail).setValue(email);
          sh.getRange(row, cPsc).setValue(role);
          added.push(email + ' (' + role + ')');
        } else if (!r.psc) {
          sh.getRange(r.row, cPsc).setValue(role);
          updated.push(email + ' (' + role + ')');
        }
      });
      // Admin có trong danh sách admins nhưng chưa từng tạo tài khoản (hiếm) vẫn giữ quyền admin
      admins.forEach(function (email) {
        if (seen[email] || byEmail[email]) return;
        const row = sh.getLastRow() + 1;
        sh.getRange(row, cEmail).setValue(email);
        sh.getRange(row, cPsc).setValue('admin');
        added.push(email + ' (admin)');
      });
    });
    PropertiesService.getScriptProperties().setProperty(FS_PROP_ACCOUNTS, JSON.stringify(done));
    PropertiesService.getScriptProperties().setProperty(FS_PROP_PSC_ON, '1');
    PropertiesService.getScriptProperties().deleteProperty(FS_PROP_PSC_HASH);
    SpreadsheetApp.flush();
    fsSyncAllUsers_(true);
  });

  const msg = 'Đã cài cấp quyền Phiếu sửa chữa.\n' +
    '- Thêm vào APP USERS: ' + (added.length ? '\n    ' + added.join('\n    ') : '(không có)') + '\n' +
    '- Điền quyền cho dòng có sẵn: ' + (updated.length ? '\n    ' + updated.join('\n    ') : '(không có)') + '\n\n' +
    'Kiểm tra lại cột "Phiếu sửa chữa": xoá quyền của ai không còn làm, đổi "user" <-> "admin" nếu cần.\n' +
    'Từ giờ cấp/thu quyền app sửa chữa NGAY TRONG SHEET NÀY.';
  fsAlert_(msg);
  return msg;
}


// ============================== KHO VẬT TƯ ==============================

/** Đưa 3 sheet VAT TU lên app. force=false: chỉ làm khi app CHƯA có vattu/state. Trả true nếu đã ghi. */
function fsImportVatTu_(force) {
  if (!force && fsGetDoc_('vattu/state')) return false;
  const ss = SpreadsheetApp.getActive();

  const st = { holders: [], materials: [], autologMigrated: false, autologChunks: 0 };
  const parsed = fsReadVatTuSheet_(ss);
  if (parsed) { st.holders = parsed.holders; st.materials = parsed.materials; }
  const stockin = fsReadStockinSheet_(ss) || [];

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

/** Đọc sheet VAT TU -> { holders, materials }. Tiêu đề người giữ gộp khoảng trắng / xuống dòng. */
function fsReadVatTuSheet_(ss) {
  const sh = ss.getSheetByName(FS_TAB_VATTU);
  if (!sh || sh.getLastRow() < 1) return null;
  const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 3)).getValues();
  const headers = v[0].map(function (h) { return String(h || '').replace(/\s+/g, ' ').trim(); });
  const holders = headers.slice(3).filter(function (h) { return h; });
  const materials = [];
  for (let i = 1; i < v.length; i++) {
    const code = String(v[i][0] || '').trim(), name = String(v[i][1] || '').trim();
    if (!code && !name) continue;
    const qty = {};
    for (let c = 3; c < headers.length; c++) if (headers[c]) qty[headers[c]] = Number(v[i][c]) || 0;
    materials.push({ code: code, name: name, spec: String(v[i][2] || ''), qty: qty });
  }
  return { holders: holders, materials: materials };
}

/** Đọc sheet VAT TU NHAP KHO -> mảng lịch sử nhập. */
function fsReadStockinSheet_(ss) {
  const lg = ss.getSheetByName(FS_TAB_VATTU_LOG);
  if (!lg) return null;
  const out = [];
  if (lg.getLastRow() >= 2) {
    lg.getRange(2, 1, lg.getLastRow() - 1, 5).getDisplayValues().forEach(function (r) {
      if (!r[1] && !r[2]) return;
      out.push({ date: r[0], code: String(r[1]).trim(), name: r[2], qty: Number(String(r[3]).replace(/[^\d.-]/g, '')) || 0, holder: r[4] });
    });
  }
  return out;
}

/**
 * Sửa tay trên sheet VAT TU / VAT TU NHAP KHO -> đẩy lên app ngay (đồng bộ 2 chiều).
 *  - VAT TU: thay danh mục + tồn kho theo người giữ; GIỮ NGUYÊN sổ trừ kho, cpFixes... của app.
 *  - VAT TU NHAP KHO: thay "Lịch sử nhập" — chỉ là lịch sử, KHÔNG tự cộng/trừ tồn kho.
 * Ghi xong đánh dấu rev đã kéo = rev mới, để lượt kéo app -> sheet kế tiếp không ghi đè lại.
 * Bản sửa sau cùng (app hay sheet) thắng.
 */
function fsPushVatTuSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  for (let attempt = 0; attempt < 2; attempt++) {
    const d = fsGetDoc_('vattu/state');
    if (!d) return false;                        // app chưa có kho vật tư -> dùng Cài đặt đồng bộ
    const rev = Number(fsField_(d, 'rev') || 0) + 1;
    const now = new Date().toISOString();
    const pre = d.updateTime ? { updateTime: d.updateTime } : undefined;
    let writes;
    if (name === FS_TAB_VATTU) {
      const parsed = fsReadVatTuSheet_(ss);
      if (!parsed) return false;
      const st = JSON.parse(fsField_(d, 'json') || '{}');
      st.holders = parsed.holders;
      st.materials = parsed.materials;
      writes = [{ update: { name: fsDocName_('vattu/state'), fields: {
        json: { stringValue: JSON.stringify(st) }, rev: { integerValue: String(rev) },
        updatedAt: { timestampValue: now }, updatedBy: { stringValue: 'Sheet VAT TU' } } } }];
    } else {
      const stockin = fsReadStockinSheet_(ss);
      if (!stockin) return false;
      // Đổi rev của state để app biết dữ liệu vật tư đã đổi (app đọc lại cả stockin khi tải).
      writes = [
        { update: { name: fsDocName_('vattu/stockin'), fields: { json: { stringValue: JSON.stringify(stockin) }, updatedAt: { timestampValue: now } } } },
        { update: { name: fsDocName_('vattu/state'), fields: { rev: { integerValue: String(rev) }, updatedAt: { timestampValue: now }, updatedBy: { stringValue: 'Sheet VAT TU NHAP KHO' } } },
          updateMask: { fieldPaths: ['rev', 'updatedAt', 'updatedBy'] } }
      ];
    }
    if (pre) writes[writes.length - 1].currentDocument = pre;
    try {
      fsCommit_(writes);
      props.setProperty(FS_PROP_MIRROR_REV, String(rev));
      return true;
    } catch (err) {
      if (attempt) throw err;                    // app vừa ghi chen giữa -> đọc lại và thử 1 lần nữa
    }
  }
  return false;
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
  // Sửa tay trên app (dòng chưa khớp vật tư / thiếu người giữ) -> ghi ngược vào sheet CHI PHI
  try {
    if (fsApplyChiPhiFixes_(st.cpFixes)) {          // ô CHI PHI vừa đổi -> đẩy lại riêng CHI PHI (không lấy khoá)
      const m = fsReadMeta_();
      const src = fsSources_().filter(function (x) { return x.key === 'chiphi'; })[0];
      if (fsSyncOne_(src, m)) fsWriteMetaOnly_(m);
    }
  } catch (err) { console.error('cpFixes: ' + err.message); }
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

/**
 * Ghi các sửa tay của người dùng (vattu/state.cpFixes) vào sheet CHI PHI theo cột ID ẩn.
 * Chỉ ghi khi ô vẫn còn đúng nội dung lúc người dùng xác nhận (from*) — ô đã được sửa tay trên
 * sheet sau đó thì giữ nguyên bản trên sheet. Trả về số ô đã ghi.
 */
function fsApplyChiPhiFixes_(fixes) {
  if (!fixes || !Object.keys(fixes).length) return 0;
  const sh = SpreadsheetApp.getActive().getSheetByName(FS_TAB_CHIPHI);
  if (!sh || sh.getLastRow() < 2) return 0;
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(function (h) { return String(h || '').trim(); });
  const cId = headers.indexOf(FS_CP_ID_HEADER), cItem = headers.indexOf('Hạng mục/Vật tư'), cStaff = headers.indexOf('NV phụ trách');
  if (cId < 0) return 0;
  let n = 0;
  for (let i = 1; i < values.length; i++) {
    const f = fixes[String(values[i][cId] || '').trim()];
    if (!f) continue;
    if (f.item && cItem > -1 && String(values[i][cItem] || '').trim() === String(f.fromItem || '').trim()) {
      sh.getRange(i + 1, cItem + 1).setValue(f.item); n++;
    }
    if (f.staff && cStaff > -1 && String(values[i][cStaff] || '').trim() === String(f.fromStaff || '').trim()) {
      sh.getRange(i + 1, cStaff + 1).setValue(f.staff); n++;
    }
  }
  return n;
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

// Dự án Firebase đang thao tác. Mặc định = Hệ thống quản lý. Đổi tạm bằng fsWithTarget_().
let fsTarget_ = FS_PROP_SA;

/** Chạy fn với dự án Firebase khác (vd FS_PROP_SA_PSC), xong trả lại như cũ. */
function fsWithTarget_(prop, fn) {
  const prev = fsTarget_;
  fsTarget_ = prop;
  try { return fn(); } finally { fsTarget_ = prev; }
}

function fsHasTarget_(prop) {
  return !!PropertiesService.getScriptProperties().getProperty(prop);
}

function fsSa_() {
  const prop = fsTarget_;
  const raw = PropertiesService.getScriptProperties().getProperty(prop);
  if (!raw) throw new Error('Chưa cấu hình: thêm Script Property "' + prop + '" = nội dung file JSON service account của Firebase.');
  let sa;
  try { sa = JSON.parse(raw); }
  catch (e) {
    throw new Error(prop + ' phải là NỘI DUNG file .json (bắt đầu bằng dấu { ), không phải tên file. ' +
      'Mở file .json bằng Notepad -> Ctrl+A -> Ctrl+C -> dán vào Giá trị. Hiện đang là: "' + String(raw).slice(0, 40) + '"');
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error(prop + ' không đúng định dạng file JSON service account.');
  return sa;
}

function fsToken_() {
  const cacheKey = 'fs_token2_' + fsTarget_;
  const cache = CacheService.getScriptCache();
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const sa = fsSa_();
  const now = Math.floor(Date.now() / 1000);
  const enc = function (o) { return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, ''); };
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email,
    // datastore = Firestore; identitytoolkit = tạo tài khoản / gửi link đặt mật khẩu
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, sa.private_key)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }
  });
  if (res.getResponseCode() !== 200) throw new Error('Không lấy được token Firebase (' + fsTarget_ + '): ' + res.getContentText());
  const tok = JSON.parse(res.getContentText()).access_token;
  cache.put(cacheKey, tok, 3000);
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
  if (code >= 300) throw new Error('Firebase ' + code + ': ' + res.getContentText().slice(0, 500));
  const txt = res.getContentText();
  return txt ? JSON.parse(txt) : {};
}

function fsBaseUrl_() {
  return 'https://firestore.googleapis.com/v1/projects/' + fsSa_().project_id + '/databases/(default)/documents';
}

// ---------- Firebase Authentication (Identity Toolkit, quyền quản trị) ----------

function fsAuthUrl_(action) {
  return 'https://identitytoolkit.googleapis.com/v1/projects/' + fsSa_().project_id + '/accounts' + (action || '');
}

/** Tài khoản theo email, null nếu chưa có. */
function fsAuthLookup_(email) {
  const r = fsFetch_('post', fsAuthUrl_(':lookup'), { email: [email] });
  return (r && r.users && r.users[0]) || null;
}

/** Tạo tài khoản đăng nhập (chưa có mật khẩu). emailVerified = true vì quản trị đã xác nhận email này
 *  bằng cách ghi vào APP USERS — rules của cả hai app chỉ nhận email đã xác minh. */
function fsAuthCreate_(email) {
  return fsFetch_('post', fsAuthUrl_(''), { email: email, emailVerified: true });
}

function fsAuthMarkVerified_(localId) {
  return fsFetch_('post', fsAuthUrl_(':update'), { localId: localId, emailVerified: true });
}

/** Link đặt mật khẩu (hết hạn sau 1 giờ — Firebase quy định). Không gửi email: mình tự gửi bằng MailApp
 *  với nội dung tiếng Việt. */
function fsAuthResetLink_(email, continueUrl) {
  const body = { requestType: 'PASSWORD_RESET', email: email, returnOobLink: true };
  if (continueUrl) body.continueUrl = continueUrl;
  try {
    return fsFetch_('post', fsAuthUrl_(':sendOobCode'), body).oobLink;
  } catch (e) {
    if (!continueUrl) throw e;
    // Tên miền app chưa nằm trong Authorized domains -> lấy link không kèm đường quay về
    delete body.continueUrl;
    return fsFetch_('post', fsAuthUrl_(':sendOobCode'), body).oobLink;
  }
}

/** Toàn bộ tài khoản đăng nhập của dự án. */
function fsAuthListAll_() {
  const out = [];
  let token = '';
  do {
    const r = fsFetch_('get', fsAuthUrl_(':batchGet') + '?maxResults=500' + (token ? '&nextPageToken=' + encodeURIComponent(token) : ''));
    ((r && r.users) || []).forEach(function (u) { out.push(u); });
    token = r && r.nextPageToken;
  } while (token);
  return out;
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
  const lock = LockService.getScriptLock();   // cùng loại khoá với nút đồng bộ trên app (doPost)
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
