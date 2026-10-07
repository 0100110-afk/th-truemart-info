/* node tools/test-sync.js — chạy Sync.gs với Google Sheet + Firestore GIẢ LẬP, rồi nạp kết quả vào core.js
   đúng cách app.js làm, để chắc hai đầu hiểu cùng một định dạng. */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const R = (p) => path.join(__dirname, '..', p);

// ---- Google Sheet giả ----
function mkSheet(name, values, display) {
  let v = values.map((r) => r.slice());
  const dispOf = (i, j) => display ? display[i][j] : (v[i][j] instanceof Date ? 'DATE' : String(v[i][j] ?? ''));
  return {
    name, getName: () => name,
    getLastRow: () => v.length, getLastColumn: () => Math.max(0, ...v.map((r) => r.length)),
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => v.slice(r - 1, r - 1 + nr).map((row) => { const a = []; for (let j = 0; j < nc; j++) a.push(row[c - 1 + j] ?? ''); return a; }),
        getDisplayValues: () => { const o = []; for (let i = r - 1; i < r - 1 + nr; i++) { const a = []; for (let j = c - 1; j < c - 1 + nc; j++) a.push(v[i] ? (display ? display[i][j] : (v[i][j] instanceof Date ? '01/02/2026' : String(v[i][j] ?? ''))) : ''); o.push(a); } return o; },
        setValues(arr) { arr.forEach((row, i) => { v[r - 1 + i] = v[r - 1 + i] || []; row.forEach((x, j) => { v[r - 1 + i][c - 1 + j] = x; }); }); return this; },
        clearContent() { for (let i = r - 1; i < r - 1 + nr; i++) if (v[i]) for (let j = c - 1; j < c - 1 + nc; j++) v[i][j] = ''; while (v.length && v[v.length - 1].every((x) => x === '')) v.pop(); return this; },
        setValue(x) { v[r - 1] = v[r - 1] || []; v[r - 1][c - 1] = x; return this; },
        setNumberFormat() { return this; }, setFontWeight() { return this; }, setDataValidation() { return this; },
        getRow: () => r
      };
    },
    insertColumnAfter(col) { v.forEach((row) => { while (row.length < col) row.push(''); row.splice(col, 0, ''); }); },
    getMaxRows: () => Math.max(v.length, 1000), setFrozenRows() {}, setColumnWidth() {},
    _v: () => v
  };
}
const sheets = {
  'DS CH': mkSheet('DS CH', [['Miền','Cost center','Địa chỉ','Loại cửa hàng','Mở/đóng'], ['MB', 303060084, 'Số 228 Lê Trọng Tấn, Hà Nội', 'Hero', 'Opnl'], ['', '', '', '', '']]),
  'TAI SAN': mkSheet('TAI SAN', [['Cost center','Mã tài sản','Tên tài sản','Ngày hoạt động'], [303060084, 348005903, 'Điều hòa', new Date(2024, 0, 2)]]),
  'BAO DUONG': mkSheet('BAO DUONG', [['Code Tủ','Địa chỉ','TP/Tỉnh','Ngày thực hiện','Nhà cung cấp','Chi phí','Ghi chú'], [348005903,'Số 228','Hà Nội', new Date(2026,2,6),'Minh Hoàng',263000,'Quý I']]),
  'CHI PHI': mkSheet('CHI PHI', [['Cost center','Tên cửa hàng','Khu vực','Mô tả sự cố','NV phụ trách','Hạng mục/Vật tư','Mã thiết bị','Ngày hoàn thành','Số lượng','Tổng chi phí','Nhà cung cấp'],
    ...Array.from({ length: 6000 }, (_, i) => [303060084, 'Số 228 Lê Trọng Tấn, Phường Phương Liệt, TP Hà Nội', 'Miền Bắc', 'Hỏng đèn số ' + i, 'Nguyễn Duy Đức', 'Thay bóng đèn pha', '', new Date(2026, 8, 1), 1, 150000, 'TD LIGHTING'])]),
  'VAT TU': mkSheet('VAT TU', [['Mã vật tư','Tên vật tư','Yêu cầu kỹ thuật và vật liệu','Nguyễn Duy Đức','Vũ Quang Hưng'], [602000283,'Bóng đèn pha','Duhal 30W', 4000, 0]]),
  'VAT TU NHAP KHO': mkSheet('VAT TU NHAP KHO', [['Ngày nhập','Mã vật tư','Tên vật tư','Số lượng nhập','Người giữ'], ['27/07/2026','602000283','Bóng đèn pha',5,'Nguyễn Duy Đức']]),
  'VAT TU TU DONG TRU': mkSheet('VAT TU TU DONG TRU', [['Khoá dòng','Ngày xử lý','Mã vật tư','Tên vật tư','Số lượng đã trừ','Người bị trừ']]),
  'APP USERS': mkSheet('APP USERS', [['Email','Quyền'], ['A@thmilk.vn','Sửa'], ['b@thmilk.vn','viewer']]),
};
// Sanaky nay nằm trong file TM (tab SANAKY); Đơn giá ở file DG riêng
sheets['SANAKY'] = mkSheet('SANAKY', [['Mã thiết bị','Mã CH','Ngày thực hiện','Thành tiền'], ['328001361','303060115','14/06/2021','250,000']]);
const ext = {
  'DON GIA BT': mkSheet('DON GIA BT', [['ma imc','noi dung','dvt','vat tu','nhan cong','tong cong'], ['I','PHẦN ĐIỀU HÒA','','','',''], ['3-SC','Thay tụ block ( 24000 BTU )','Cái',441000,163000,604000]]),
  'DON GIA XD': mkSheet('DON GIA XD', [['imc','noi dung cong viec','yeu cau ky thuat va vat lieu','dvt','don gia'], ['I','XÂY DỰNG (FITOUT)','','',''], [1,'PHÁ DỠ','','',''], ['1_XD','Phá dỡ móng các loại- Móng bê tông không cốt thép','','m3',960000]]),
  'DON GIA SNK': mkSheet('DON GIA SNK', [['imc','noi dung','dvt','vat tu','gas +\nphin loc','nhan\ncong','phu phi (van\nchuyen/ di lai)','don gia'], ['I','KIỂM TRA CHỈNH SỬA','','','','','',''], ['6-SNK','Máy nén ETA130L','Bộ',1210000,300000,500000,600000,2610000]])
};
const DG_ID = '1RFVctqPlPvLodhscIMxIMLrRgIEjSLLUlFUsqI2anSQ';
const dgFile = { getId: () => DG_ID, getSheetByName: (n) => ext[n] || null };
const ss = { getId: () => 'TM_ID', getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mkSheet(n, [])) };

// ---- Firestore + Firebase Auth giả (REST), HAI dự án: p1 = Hệ thống quản lý, p2 = Phiếu sửa chữa ----
const stores = { p1: {}, p2: {} };
const store = stores.p1;
const PFX = 'projects/p1/databases/(default)/documents/';
const authUsers = { p1: [{ localId: 'u_me', email: 'me@x.vn', emailVerified: true }],
  p2: [{ localId: 'u_old', email: 'kythuat.cu@gmail.com', emailVerified: false }, { localId: 'u_adm', email: 'quantri@th.com', emailVerified: false }] };
const sentMail = [];
let tokenProjects = [];
function resp(code, obj) { return { getResponseCode: () => code, getContentText: () => (obj === undefined ? '' : JSON.stringify(obj)) }; }
const UrlFetchApp = { fetch(url, opt) {
  if (url.includes('oauth2')) { tokenProjects.push(1); return resp(200, { access_token: 't' }); }
  let m = url.match(/identitytoolkit\.googleapis\.com\/v1\/projects\/(p\d)\/accounts(.*)$/);
  if (m) {
    const P = m[1], action = m[2].split('?')[0], body = opt.payload ? JSON.parse(opt.payload) : {};
    const list = authUsers[P];
    if (action === ':lookup') { const u = list.filter((x) => body.email.includes(x.email)); return resp(200, u.length ? { users: u } : {}); }
    if (action === '') { if (list.some((x) => x.email === body.email)) return resp(400, { error: 'EMAIL_EXISTS' }); const u = { localId: 'n' + list.length, email: body.email, emailVerified: body.emailVerified }; list.push(u); return resp(200, u); }
    if (action === ':update') { list.find((x) => x.localId === body.localId).emailVerified = body.emailVerified; return resp(200, {}); }
    if (action === ':sendOobCode') return resp(200, { email: body.email, oobLink: 'https://x.firebaseapp.com/__/auth/action?mode=resetPassword&p=' + P + '&e=' + body.email });
    if (action === ':batchGet') return resp(200, { users: list });
    return resp(404);
  }
  m = url.match(/firestore\.googleapis\.com\/v1\/projects\/(p\d)\/databases\/\(default\)\/documents(.*)$/);
  const P = m[1], st = stores[P], pfx = 'projects/' + P + '/databases/(default)/documents/';
  if (url.endsWith(':commit')) {
    const body = JSON.parse(opt.payload);
    body.writes.forEach((w) => {
      if (w.delete) delete st[w.delete.replace(pfx, '')];
      else { const id = w.update.name.replace(pfx, ''); if (w.currentDocument && w.currentDocument.exists === false && st[id]) throw new Error('exists'); st[id] = { name: w.update.name, fields: w.update.fields }; }
    });
    return resp(200, {});
  }
  const rest = decodeURIComponent(m[2].replace(/^\//, '').split('?')[0]);
  if (st[rest]) return resp(200, st[rest]);
  const docs = Object.keys(st).filter((k) => k.startsWith(rest + '/') && !k.slice(rest.length + 1).includes('/')).map((k) => st[k]);
  if (docs.length || ['users', 'vattu_autolog', 'members', 'admins'].includes(rest)) return resp(200, { documents: docs });
  return resp(404);
} };
const props = { FIREBASE_SA: JSON.stringify({ client_email: 'x', private_key: 'k', project_id: 'p1' }) };
const ctx = {
  console, JSON, Math, Date, Number, String, Object, Array, Set, RegExp, Error,
  SpreadsheetApp: { getActive: () => ss, getActiveSpreadsheet: () => ss, openById: (id) => { if (id !== DG_ID) throw new Error('bad id'); return dgFile; }, getUi: () => { throw new Error('no ui'); }, flush() {}, newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() {} }) },
  MailApp: { sendEmail: (o) => sentMail.push(o) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => delete props[k] }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, getAll: () => ({}), putAll() {} }) },
  LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }), getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'me@x.vn' }), getEffectiveUser: () => ({ getEmail: () => '' }), getScriptTimeZone: () => 'Asia/Ho_Chi_Minh' },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ forSpreadsheet() { return this; }, onEdit() { return this; }, timeBased() { return this; }, everyMinutes() { return this; }, create() {} }) },
  Utilities: {
    computeDigest: (a, s) => [...crypto.createHash('md5').update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { MD5: 1 }, Charset: { UTF_8: 1 },
    base64EncodeWebSafe: (s) => Buffer.from(typeof s === 'string' ? s : Buffer.from(s)).toString('base64url'),
    computeRsaSha256Signature: () => [1, 2, 3], formatDate: () => '07/10/2026'
  },
  UrlFetchApp, Logger: { log() {} }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(R('apps-script/Sync.gs'), 'utf8') +   /* Sync.gs chạy MỘT MÌNH, không cần Code.gs */
  '\nthis.__t = { caiDatDongBoFirebase, caiDatPhieuSuaChua, fsSyncAll_, fsMirrorVatTu_, fsOnEdit, guiLaiEmailDatMatKhau };', ctx);

let fails = 0; const ok = (c, m) => { console.log((c ? 'OK  ' : 'SAI ') + m); if (!c) fails++; };
ctx.__t.caiDatDongBoFirebase();
const meta = JSON.parse(store['meta/sheets'].fields.json.stringValue);
ok(meta.sheets.chiphi.n >= 2, 'CHI PHI 6000 dòng được cắt thành ' + meta.sheets.chiphi.n + ' mảnh');
ok(Object.keys(store).filter((k) => k.startsWith('sheetdata/chiphi')).every((k) => Buffer.byteLength(store[k].fields.json.stringValue) < 1000000), 'mỗi mảnh < 1MB');
ok(meta.sheets.stores.rowCount === 1, 'bỏ dòng trống');
ok(!!meta.sheets.sanaky && !!meta.sheets.dongia_bt && !!meta.sheets.dongia_xd && !!meta.sheets.dongia_snk, 'Sanaky (tab trong TM) + 3 tab Đơn giá (file DG) đều được đẩy lên');
ok(store['users/a@thmilk.vn'].fields.role.stringValue === 'editor' && store['users/b@thmilk.vn'].fields.role.stringValue === 'viewer', 'users: email chữ thường + quyền (giá trị cũ vẫn hiểu)');
ok(sheets['APP USERS']._v()[1][1] === 'user' && sheets['APP USERS']._v()[2][1] === 'user', 'cột quyền chuẩn hoá về admin / user');
ok(!!store['users/a@thmilk.vn'].fields.uid.stringValue, 'users ghi kèm uid');
const uh = sheets['APP USERS']._v()[0];
ok(uh[1] === 'Hệ thống quản lý' && uh[2] === 'Phiếu sửa chữa' && uh.includes('Tài khoản (tự động)'), 'APP USERS: đổi "Quyền" -> "Hệ thống quản lý", thêm cột Phiếu sửa chữa + trạng thái');
ok(authUsers.p1.some((u) => u.email === 'a@thmilk.vn' && u.emailVerified) && sentMail.some((m) => m.to === 'a@thmilk.vn'), 'email mới có quyền QL -> tự tạo tài khoản + gửi email đặt mật khẩu');
ok(String(sheets['APP USERS']._v()[1][4]).includes('đã gửi email'), 'cột Tài khoản (tự động) ghi trạng thái');
ok(!!store['vattu/state'], 'kho vật tư được đưa lên lần đầu');

// Đồng bộ lại không đổi gì -> không ghi sheetdata
const before = JSON.stringify(store['sheetdata/chiphi__0']);
const r2 = ctx.__t.fsSyncAll_(false); ok(r2.changed.length === 0, 'quét lại khi không đổi: không ghi bảng nào');
// Sửa 1 ô -> onEdit
sheets['DS CH']._v()[1][2] = 'Địa chỉ mới';
ctx.__t.fsOnEdit({ range: { getSheet: () => sheets['DS CH'] } });
// Sửa ô bên file DG -> cũng đẩy ngay
ext['DON GIA BT']._v()[2][5] = 700000;
ctx.__t.fsOnEdit({ source: dgFile, range: { getSheet: () => ext['DON GIA BT'] } });
const m2 = JSON.parse(store['meta/sheets'].fields.json.stringValue);
ok(m2.sheets.dongia_bt.hash !== meta.sheets.dongia_bt.hash, 'onEdit ở file DG đẩy Đơn giá BT');
ok(m2.sheets.stores.hash !== meta.sheets.stores.hash, 'onEdit đẩy bảng vừa sửa');

// ---- Nạp vào core.js giống app.js ----
globalThis.md5 = require(R('js/vendor/md5.min.js'));
const C = require(R('js/core.js'));
Object.keys(m2.sheets).forEach((key) => {
  const m = m2.sheets[key];
  const chunks = Object.keys(store).filter((k) => k.startsWith('sheetdata/' + key + '__')).map((k) => store[k].fields)
    .map((f) => ({ i: Number(f.i.integerValue), hash: f.hash.stringValue, json: f.json.stringValue })).sort((a, b) => a.i - b.i);
  if (chunks.length !== m.n || chunks.some((c) => c.hash !== m.hash)) { fails++; console.log('SAI mảnh', key); }
  C.setSheetData(key, { headers: m.headers, rows: [].concat(...chunks.map((c) => JSON.parse(c.json))) });
});
const st = JSON.parse(store['vattu/state'].fields.json.stringValue);
C.setVatTu(st, [], []);
const d = C.READ_API.getDashboardData(false, '', '2026');
ok(d.thsCount === 6000 && d.totalStores === 1, 'dashboard đọc đủ 6000 dòng chi phí');
ok(C.READ_API.getStoreDetail('303060084').address === 'Địa chỉ mới', 'thấy dữ liệu vừa sửa');
ok(C.READ_API.searchAssetByCode('348005903')[0].activeDate === '01/02/2026', 'ô Ngày đi qua dạng chuỗi hiển thị');
ok(C.READ_API.getSanakyList({ page: 1 }).total === 1, 'app đọc được Sanaky từ tab SANAKY');
const bt = C.READ_API.getDonGiaData('bt'), xd = C.READ_API.getDonGiaData('xd'), snk = C.READ_API.getDonGiaData('snk');
ok(bt.records[1].tongCong === 700000 && bt.records[1].vatTu === 441000, 'Đơn giá BT đọc đúng cột (ma imc / vat tu / tong cong)');
ok(xd.records[2].tongCong === 960000 && xd.records[1].isSubHeader, 'Đơn giá XD: đầu mục 2 cấp + đơn giá');
ok(snk.records[1].gasPhinLoc === 300000 && snk.records[1].phuPhi === 600000 && snk.records[1].tongCong === 2610000, 'Đơn giá SNK: gas+phin lọc, phụ phí (tiêu đề xuống dòng) đọc đúng');

// ---- Trừ kho trên app (mô phỏng transaction) rồi kéo về sheet ----
const ded = C.computeVatTuDeduction(st, []);
ok(ded.result.migrated === 6000, 'không có sổ cũ -> lần đầu chỉ khởi tạo khoá, không trừ');
st.autologChunks = 2;
store['vattu_autolog/c0'] = { name: PFX + 'vattu_autolog/c0', fields: { json: { stringValue: JSON.stringify(ded.newEntries.slice(0, 2500)) } } };
store['vattu_autolog/c1'] = { name: PFX + 'vattu_autolog/c1', fields: { json: { stringValue: JSON.stringify(ded.newEntries.slice(2500)) } } };
st.materials[0].qty['Vũ Quang Hưng'] = 7;
store['vattu/state'].fields.json.stringValue = JSON.stringify(st);
store['vattu/state'].fields.rev = { integerValue: '2' };
ctx.__t.fsMirrorVatTu_(false);
const vt = sheets['VAT TU']._v();
ok(vt[1][4] === 7, 'kéo tồn kho mới về sheet VAT TU');
ok(sheets['VAT TU TU DONG TRU']._v().length === 6001, 'sổ trừ kho về sheet đủ 6000 dòng');
ok(sheets['VAT TU NHAP KHO']._v()[1][4] === 'Nguyễn Duy Đức', 'lịch sử nhập kho giữ nguyên');
// ---- Cấp quyền Phiếu sửa chữa từ cùng sheet APP USERS ----
stores.p2['admins/quantri@th.com'] = { name: 'projects/p2/databases/(default)/documents/admins/quantri@th.com', fields: { role: { stringValue: 'admin' } } };
props.FIREBASE_SA_PSC = JSON.stringify({ client_email: 'y', private_key: 'k', project_id: 'p2' });
const mailsBefore = sentMail.length;
ctx.__t.caiDatPhieuSuaChua();
const U = () => sheets['APP USERS']._v();
const rowOf = (e) => U().find((r) => String(r[0]).toLowerCase() === e);
ok(rowOf('kythuat.cu@gmail.com') && rowOf('kythuat.cu@gmail.com')[2] === 'user' && rowOf('quantri@th.com')[2] === 'admin', 'nhập người dùng đang có của app sửa chữa vào sheet (giữ admin)');
ok(authUsers.p2.every((u) => u.emailVerified), 'tài khoản cũ của app sửa chữa được đánh dấu đã xác minh');
ok(!!stores.p2['members/kythuat.cu@gmail.com'] && !!stores.p2['members/quantri@th.com'] && !!stores.p2['admins/quantri@th.com'], 'members + admins đẩy sang Firebase app sửa chữa');
ok(sentMail.length === mailsBefore, 'người cũ KHÔNG bị gửi email đặt mật khẩu');
// Thêm nhân viên mới + nâng 1 người lên admin + thu quyền 1 người
U().push(['moi.vao@gmail.com', '', 'nhân viên', '', '']);   // gõ kiểu cũ -> tự đổi thành 'user'
rowOf('kythuat.cu@gmail.com')[2] = 'admin';
rowOf('quantri@th.com')[2] = '';
ctx.__t.fsOnEdit({ range: { getSheet: () => sheets['APP USERS'] } });
ok(!!stores.p2['members/moi.vao@gmail.com'] && stores.p2['members/moi.vao@gmail.com'].fields.role.stringValue === 'staff', 'thêm dòng -> members có ngay');
ok(authUsers.p2.some((u) => u.email === 'moi.vao@gmail.com' && u.emailVerified), 'người mới -> tạo tài khoản app sửa chữa (đã xác minh)');
const newUid = authUsers.p2.find((u) => u.email === 'moi.vao@gmail.com').localId;
ok(stores.p2['members/moi.vao@gmail.com'].fields.uid.stringValue === newUid, 'members ghi kèm uid của tài khoản');
ok(stores.p2['members/kythuat.cu@gmail.com'].fields.uid.stringValue === 'u_old', 'người cũ nhập vào cũng có uid');
ok(rowOf('moi.vao@gmail.com')[2] === 'user', 'giá trị cũ "nhân viên" tự đổi thành "user"');
const mail = sentMail[sentMail.length - 1];
ok(mail.to === 'moi.vao@gmail.com' && mail.htmlBody.includes('Phiếu sửa chữa') && !mail.htmlBody.includes('Hệ thống quản lý'), 'email chỉ chứa link app được cấp');
ok(!!stores.p2['admins/kythuat.cu@gmail.com'], 'nâng lên admin -> có trong admins');
ok(!stores.p2['admins/quantri@th.com'] && !stores.p2['members/quantri@th.com'], 'xoá quyền -> gỡ khỏi admins + members');
const n0 = sentMail.length; ctx.__t.fsSyncAll_(false);
ok(sentMail.length === n0, 'quét lại không gửi email lặp');
console.log(fails ? 'THẤT BẠI ' + fails : 'TẤT CẢ OK');
process.exit(fails ? 1 : 0);
