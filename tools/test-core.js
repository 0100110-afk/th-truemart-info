/* Chạy: node tools/test-core.js — gọi thử MỌI hàm API của core.js với dữ liệu mẫu. */
const path = require('path');
const crypto = require('crypto');
globalThis.md5 = require(path.join(__dirname, '../js/vendor/md5.min.js'));
globalThis.XLSX = require(path.join(__dirname, '../js/vendor/xlsx.mini.min.js'));
const C = require(path.join(__dirname, '../js/core.js'));

const FX = require(path.join(__dirname, 'fixture.js'));
Object.keys(FX.sheets).forEach((k) => C.setSheetData(k, FX.sheets[k]));
C.setVatTu(JSON.parse(JSON.stringify(FX.vattu)), [], []);
const cpRows = FX.cpRows;
let fails = 0;
function run(name, ...args) {
  try { const r = C.READ_API[name](...args); JSON.stringify(r); return r; }
  catch (e) { fails++; console.log('LỖI', name, e.stack); }
}
const d = run('getDashboardData', false, '', '2026');
console.log('dashboard', d.totalStores, d.thsCost, d.lscCost, d.maintCount, d.sanakyCount, Object.keys(d.byRegion));
run('getDashboardData', true, 'MB', '');
console.log('search', run('searchStores','phuoc long').length, run('searchStores','303060084').length);
console.log('detail phone', run('getStoreDetail','305060057').managerPhone);
run('searchAssetByCode','3480'); run('getAssetsByStore','303060084');
run('getMaintenanceList',{query:'',page:1,pageSize:20}); run('getMaintenanceByStore','303060084'); run('getMaintenanceByAsset','348005903');
console.log('quarterly', JSON.stringify(run('getMaintenanceQuarterlyStats').labels));
run('getChiPhiByStore','303060084','tdlighting'); run('getChiPhiByAsset','348005903');
run('getStoreCostSummary','303060084'); run('getAssetCostSummary','348005903');
run('getAssetRepairHistory','348005903'); run('getStoreRepairHistory','303060084');
run('getSanakyYearsAvailable'); console.log('snk months', run('getSanakyMonthsAvailable'));
console.log('snk dash', JSON.stringify(run('getSanakyDashboardData','','')).slice(0,120));
run('getSanakyList',{page:1}); run('getSanakyByStore','303070015'); run('getSanakyByAsset','328022559');
['bt','xd','snk'].forEach(c => { const r = run('getDonGiaData', c); if (!r.success) { fails++; console.log('dongia fail', r); } });
console.log('vattu', JSON.stringify(run('getVatTuData').materials.map(m=>m.total)));
run('getVatTuYearsAvailable'); run('getVatTuMonthsAvailable'); run('getVatTuByStaffMonth','2026','9');
run('getVatTuTrackingFilters');
const tl = run('getVatTuTrackingList',{page:1,pageSize:20});
console.log('tracking', JSON.stringify(tl.counts), tl.rows.map(r=>r.item+' -> '+r.statusLabel+' ('+r.statusSub+')').join(' | '));
const x = run('exportVatTuExcel','2026','9',{});
console.log('excel bytes', x && x.base64.length);

// --- Vân tay MD5 phải trùng bản Apps Script (computeDigest MD5 UTF-8, 8 byte đầu) ---
const keys = C._chiPhiKeys();
const r0 = cpRows[0];
const parts = ['303060084','', '01/09/2026', 'Thay bóng đèn pha', 'Hỏng đèn', 'Nguyễn Duy Đức', '2', '300000'].join('||');
const expect = crypto.createHash('md5').update(parts, 'utf8').digest('hex').slice(0,16) + '#1';
console.log('key', keys[0], expect, keys[0] === expect ? 'KHỚP' : 'LỆCH'); if (keys[0] !== expect) fails++;

// --- Ghi: nhập kho, sửa danh mục, trừ kho ---
const s2 = JSON.parse(JSON.stringify(C.getVatTuState()));
const log = [];
console.log('stockin', JSON.stringify(C.VT_OPS.addVatTuStock(s2, log, 'Nguyễn Duy Đức', [{code:'602000283',qty:5}])), s2.materials[0].qty, log[0].date);
C.VT_OPS.renameVatTuHolder(s2, 'Nguyễn Văn Thái', 'NV Thái');
C.VT_OPS.saveVatTuItem(s2, {code:'603000999', name:'Quạt hút mùi', spec:''});
C.VT_OPS.moveVatTuItem(s2, '603000999', 'up');
try { C.VT_OPS.saveVatTuItem(s2, {code:'602000283', name:'x'}); fails++; } catch (e) { console.log('dup ok:', e.message); }
const ded = C.computeVatTuDeduction(s2, []);
console.log('deduct', JSON.stringify(ded.result), ded.newEntries.map(e=>e.name+' '+e.qty), JSON.stringify(s2.materials.map(m=>[m.name,m.qty])));
const ded2 = C.computeVatTuDeduction(s2, ded.newEntries);
console.log('deduct again', JSON.stringify(ded2.result));
if (ded2.result.processed) fails++;
const s3 = C.emptyVatTuState(); s3.holders=['A']; s3.materials=[{code:'1',name:'Bóng đèn pha',qty:{A:9}}];
console.log('migrate', JSON.stringify(C.computeVatTuDeduction(s3, []).result));

// --- ID cố định cho dòng CHI PHÍ: sửa/xoá dòng đã trừ thì KHÔNG trừ lại, KHÔNG hoàn kho ---
(function () {
  const H = FX.sheets.chiphi.headers.concat(['ID']);
  const withId = (rows) => rows.map((r, i) => r.concat(['CP-T' + i]));
  const sA = JSON.parse(JSON.stringify(FX.vattu));
  const stock = () => JSON.stringify(sA.materials.map((m) => m.qty));
  // 1) Trừ lần đầu khi CHƯA có ID -> log mang khoá vân tay
  C.setSheetData('chiphi', { headers: FX.sheets.chiphi.headers, rows: cpRows });
  const d1 = C.computeVatTuDeduction(sA, []);
  let log = d1.newEntries; const after1 = stock();
  // 2) Sync.gs điền ID -> chạy lại: đổi khoá sang ID, không trừ thêm
  let rows = withId(cpRows);
  C.setSheetData('chiphi', { headers: H, rows });
  const d2 = C.computeVatTuDeduction(sA, log);
  log = d2.replaceAll ? d2.newEntries : log.concat(d2.newEntries);
  const okMig = d2.result.processed === 0 && stock() === after1 && log.filter((e) => e.code).every((e) => /^CP-T/.test(e.k));
  console.log('id migrate', okMig ? 'OK' : 'SAI', JSON.stringify(log.map((e) => e.k + ':' + e.qty)));
  if (!okMig) fails++;
  // 3) Sửa dòng đã trừ (số lượng 2 -> 3, đổi mô tả) -> cập nhật log, không trừ
  rows = rows.map((r) => r.slice()); rows[0][8] = 3; rows[0][3] = 'Hỏng đèn (sửa lại)';
  C.setSheetData('chiphi', { headers: H, rows });
  const d3 = C.computeVatTuDeduction(sA, log);
  log = d3.replaceAll ? d3.newEntries : log.concat(d3.newEntries);
  const e0 = log.find((e) => e.k === 'CP-T0');
  const okEdit = d3.result.processed === 0 && stock() === after1 && e0 && e0.qty === 3;
  console.log('id edit', okEdit ? 'OK' : 'SAI', JSON.stringify(e0)); if (!okEdit) fails++;
  // 4) Xoá dòng đã trừ -> xoá bản ghi log, không hoàn kho
  rows = rows.filter((r, i) => i !== 1);
  C.setSheetData('chiphi', { headers: H, rows });
  const d4 = C.computeVatTuDeduction(sA, log);
  log = d4.replaceAll ? d4.newEntries : log.concat(d4.newEntries);
  const okDel = d4.result.processed === 0 && stock() === after1 && !log.some((e) => e.k === 'CP-T1');
  console.log('id delete', okDel ? 'OK' : 'SAI', JSON.stringify(log.map((e) => e.k))); if (!okDel) fails++;
  // 5) Còn dòng chưa có ID -> không dọn log (tránh xoá nhầm khi Sync.gs chưa kịp điền)
  const rows5 = rows.map((r) => r.slice()); rows5[0][rows5[0].length - 1] = '';
  C.setSheetData('chiphi', { headers: H, rows: rows5 });
  const d5 = C.computeVatTuDeduction(sA, log.concat([{ k: 'GONE', d: '', code: 'x', name: 'x', qty: 1, holder: 'A' }]));
  const okPartial = !d5.replaceAll;
  console.log('id partial', okPartial ? 'OK' : 'SAI'); if (!okPartial) fails++;
  C.setSheetData('chiphi', { headers: FX.sheets.chiphi.headers, rows: cpRows });
})();
console.log(fails ? ('THẤT BẠI: ' + fails) : 'TẤT CẢ OK');
process.exit(fails ? 1 : 0);
