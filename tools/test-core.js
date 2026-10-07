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
console.log(fails ? ('THẤT BẠI: ' + fails) : 'TẤT CẢ OK');
process.exit(fails ? 1 : 0);
