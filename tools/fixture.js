/* Dữ liệu mẫu dùng chung cho test (Node) và test giao diện (trình duyệt). */
(function (root) {
  const C = { _s: {}, _v: null, setSheetData(k, p) { this._s[k] = p; }, emptyVatTuState() { return { holders: [], materials: [], autologMigrated: false, autologChunks: 0 }; }, setVatTu(st) { this._v = st; } };
const H_STORES = ['Miền','Khu vực','Cost center','Địa chỉ','Xã/Phường','Thành Phố trực thuộc','Loại cửa hàng','Mở/đóng','Giám sát','Mail Giám Sát','SĐTGS','ASM','Mail ASM','SĐT ASM','Cửa hàng trưởng','Số điện thoại','Email cửa hàng','Số điện thoại cửa hàng','Ngày','Tháng','Năm'];
C.setSheetData('stores', { headers: H_STORES, rows: [
  ['MN1','TM-HCM3',305060057,'128 Đỗ Xuân Hợp, Phường Phước Long, TP.HCM','Phường Phước Long','HCM','Normal','Opnl','Huỳnh Trọng Tín','tin.ht@thmilk.vn','0973578800','Nguyễn Thị Ngọc Hân','ntnhan@thmilk.vn',969807580,'Trần Thị Tuyết Nhung',559206035,'a@b.vn',2836200897,8,1,2014],
  ['MB','HN1',303060084,'Số 228 Lê Trọng Tấn, Phường Phương Liệt, TP Hà Nội','Phương Liệt','Hà Nội','Hero','Opnl','GS','','','','','', 'CHT', '', '', '', 1, 2, 2020],
]});
C.setSheetData('assets', { headers: ['Cost center','Mã tài sản','Tên tài sản','Ngày hoạt động'], rows: [
  [303060084, 348005903, 'Dieu hoa Daikin', '02/01/2024'], [305060057, 1420007, 'Tuong bo', '17/08/2012']]});
C.setSheetData('maint', { headers: ['Code Tủ','Tên GSBH','Địa chỉ','Phường','TP/Tỉnh','Ngày thực hiện','Loại Tủ','Mã dịch vụ','Nhà cung cấp','Diễn giải','Chi phí','Ghi chú'], rows: [
  [348005903,'TH Truemart','Số 228 Lê Trọng Tấn','','Hà Nội','06/03/2026','Điều hòa','62-SC','Minh Hoàng','Vệ sinh máy lạnh',263000,'Quý I'],
  ['Không MTS','TH Truemart','Số 70 Sài Đồng','','Hà Nội','14/07/2026','Điều hòa','79-SC','Minh Hoàng','Bảo dưỡng',630000,'Quý II']]});
const H_CP = ['Cost center','Tên cửa hàng','Khu vực','Mô tả sự cố','NV phụ trách','Hạng mục/Vật tư','Mã thiết bị','Ngày hoàn thành','Số lượng','Tổng chi phí','Nhà cung cấp','Cột 1'];
const cpRows = [
  [303060084,'Số 228 Lê Trọng Tấn','Miền Bắc','Hỏng đèn','Nguyễn Duy Đức','Thay bóng đèn pha','', '01/09/2026', 2, 300000, 'TD LIGHTING', 8],
  [303060084,'Số 228 Lê Trọng Tấn','Miền Bắc','Cấp nguồn','Nguyễn Duy Đức','Dây điện 2x1,5','', '02/09/2026', 10, 100000, 'TD LIGHTING', 8],
  [303060084,'Số 228 Lê Trọng Tấn','Miền Bắc','Hỏng quạt','Nguyễn Duy Đức','Quạt hút mùi','', '03/09/2026', 1, 100000, 'TD LIGHTING', 8],
  [503000101,'Kho','', 'Sạc gas','Vũ Quang Hưng','Sạc Gas( gas 32a)',348005903,'27/08/2026',1,252976,'DAIKIN',8],
];
C.setSheetData('chiphi', { headers: H_CP, rows: cpRows });
C.setSheetData('sanaky', { headers: ['Mã thiết bị','Mã CH','Địa chỉ','Tỉnh/TP','Ngày thực hiện','Loại tủ','Mã thanh toán','Hạng mục sửa chữa','Đơn giá','SL','Thành tiền'], rows: [
  ['328001361','303060115','68 Võ Thị Sáu, TP Hà Nội','Hà Nội','14/06/2021','','','Thay rơ le','250000','1','250000'],
  ['328022559','303070015','Số 90 Núi Đôi','Hà Nội','17/08/2026','Tủ mát','105-SNK','Đèn Led','580000','1','580,000']]});
C.setSheetData('dongia_bt', { headers: ['Mã IMC','Nội dung','ĐVT','Vật tư','Nhân công','Tổng cộng'], rows: [['I','Điện','','','',''],['1.1','Thay đèn','Cái',100,50,150]]});
C.setSheetData('dongia_xd', { headers: ['IMC','Nội dung công việc','Yêu cầu kỹ thuật và vật liệu','ĐVT','Đơn giá'], rows: [['I','Xây','','',''],['1','Tường','','',''],['1.1','Xây tường','gạch','m2',500000]]});
C.setSheetData('dongia_snk', { headers: ['Mã IMC','Nội dung','ĐVT','Vật tư','Gas + phin lọc','Nhân công','Phụ phí (vận chuyển/ đi lại)','Đơn giá'], rows: [['1-SNK','Kiểm tra','Lần',0,0,250000,0,250000]]});

const st = C.emptyVatTuState();
st.holders = ['Nguyễn Duy Đức','Nguyễn Văn Thái','Vũ Quang Hưng'];
st.materials = [
  { code:'602000283', name:'Bóng đèn pha', spec:'Duhal CP06 30W 6500K', qty:{'Nguyễn Duy Đức':4} },
  { code:'603000154', name:'Dây điện 2*1.5mm', spec:'Cadivi hoặc tương đương 2x1.5mm', qty:{'Nguyễn Duy Đức':33} },
];
st.autologMigrated = true;
C.setVatTu(st);


  const out = { sheets: C._s, vattu: C._v, cpRows: cpRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = out; else root.TM_FIXTURE = out;
})(this);
