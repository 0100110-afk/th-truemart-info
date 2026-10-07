#!/usr/bin/env python3
"""Sinh repo/js/core.js từ Code.gs: giữ nguyên logic đọc, thay lớp Sheet/Cache bằng dữ liệu Firestore
đã nạp sẵn trong bộ nhớ, viết lại phần GHI vật tư thành hàm thuần (app.js bọc trong transaction)."""
import re, sys

src_path, out_path = sys.argv[1], sys.argv[2]
src = open(src_path, encoding='utf-8').read()
lines = src.split('\n')


def func_range(name):
    pat = re.compile(r'^function ' + re.escape(name) + r'\(')
    for i, l in enumerate(lines):
        if pat.match(l):
            if l.rstrip().endswith('}') and l.count('{') == l.count('}'):
                return i, i
            for j in range(i + 1, len(lines)):
                if lines[j].rstrip() == '}':
                    return i, j
    raise SystemExit('Không thấy hàm ' + name)


replacements = {}  # start_line -> (end_line, new_text)


def replace_func(name, new_text):
    s, e = func_range(name)
    # Bỏ luôn khối chú thích /** ... */ ngay phía trên (nó mô tả bản Apps Script cũ)
    k = s - 1
    if k >= 0 and lines[k].strip() == '*/':
        while k >= 0 and not lines[k].lstrip().startswith('/*'):
            k -= 1
        if k >= 0 and lines[k].startswith('/*'):
            s = k
    replacements[s] = (e, new_text)


def delete_func(name):
    replace_func(name, None)


def line_of(marker, start=0):
    for i in range(start, len(lines)):
        if lines[i].startswith(marker):
            return i
    raise SystemExit('Không thấy marker ' + marker)


def replace_range(start_marker, end_marker, new_text):
    s = line_of(start_marker)
    e = line_of(end_marker, s + 1) - 1 if end_marker else len(lines) - 1
    replacements[s] = (e, new_text)


# ---------- 1. Truy cập sheet ----------
delete_func('doGet')
replace_func('getSheet_', '''function getSheet_(name) {
  const key = sheetKeyOf_(name);
  const d = key ? TM_DATA[key] : null;
  if (!d) {
    throw new Error('Chưa có dữ liệu "' + name + '" trên máy chủ. Mở Google Sheet -> menu "App TM" -> ' +
      '"Đồng bộ toàn bộ lên app" rồi bấm Làm mới.');
  }
  return d;
}''')
replace_func('sheetToObjects_', '''/** Bản Firestore: dữ liệu đã được Sync.gs đọc sẵn (cột ngày là chuỗi hiển thị), chỉ dựng lại object. */
function sheetToObjects_(name) {
  const d = getSheet_(name);
  const headers = (d.headers || []).map(function (h) { return String(h === null || h === undefined ? '' : h).trim(); });
  const out = [];
  (d.rows || []).forEach(function (r, i) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      const v = r[j];
      obj[headers[j]] = (v === null || v === undefined) ? '' : v;
    }
    obj.__row = (d.rowNums && d.rowNums[i]) || (i + 2);
    out.push(obj);
  });
  return out;
}''')
replace_func('getSpreadsheetTimeZone_', '''function getSpreadsheetTimeZone_() {
  return 'Asia/Ho_Chi_Minh';
}''')

# ---------- 2. Cache -> bộ nhớ ----------
delete_func('cacheGetJSON_')
delete_func('cacheSetJSON_')
replace_func('getCachedOrCompute_', '''/** Cache trong bộ nhớ trình duyệt. Dữ liệu chỉ đổi khi tải lại từ Firestore -> lúc đó MEMO bị xoá. */
function getCachedOrCompute_(key, ttlSeconds, computeFn, forceRefresh) {
  if (!forceRefresh && Object.prototype.hasOwnProperty.call(MEMO, key)) return MEMO[key];
  const value = computeFn();
  MEMO[key] = value;
  return value;
}''')

# ---------- 3. Sanaky / Đơn giá: file ngoài -> dữ liệu đã đồng bộ ----------
replace_func('getSanakySpreadsheet_', '''function getSanakySpreadsheet_() {
  const m = {}; m[SANAKY_SHEET_NAME] = 'sanaky';
  return fakeSpreadsheet_(m);
}''')
replace_func('getDongiaSpreadsheet_', '''function getDongiaSpreadsheet_() {
  const m = {};
  m[SHEET_DONGIA_BT] = 'dongia_bt'; m[SHEET_DONGIA_XD] = 'dongia_xd'; m[SHEET_DONGIA_SNK] = 'dongia_snk';
  return fakeSpreadsheet_(m);
}''')

# ---------- 4. Vật tư: phần đọc/ghi sheet -> state Firestore ----------
replace_range('// ============================== VẬT TƯ (KHO VẬT TƯ THEO NGƯỜI GIỮ)',
              '/* ==================== KHỚP HẠNG MỤC CHI PHÍ',
              '@@VATTU_BLOCK@@')
replace_func('readVatTuAutoLogMap_', '''function readVatTuAutoLogMap_() {
  const map = {};
  (TM_VT.autolog || []).forEach(function (e) {
    const k = String((e && e.k) || '');
    if (k) map[k] = { qty: Number(e.qty) || 0, holder: String(e.holder || '') };
  });
  return map;
}''')
replace_func('exportVatTuExcel', '@@EXPORT_BLOCK@@')
delete_func('ensureVatTuAutoLogSheet_')
delete_func('migrateVatTuAutoLog_')
replace_func('runVatTuAutoDeduction', '@@DEDUCT_BLOCK@@')

# ---------- 5. Làm mới / chẩn đoán cache: không còn dùng ----------
replace_range('// ============================== LÀM MỚI DỮ LIỆU', None, '')

out = []
i = 0
while i < len(lines):
    if i in replacements:
        e, txt = replacements[i]
        if txt is not None:
            out.append(txt)
        i = e + 1
        continue
    out.append(lines[i])
    i += 1
body = '\n'.join(out)

# Các khối viết mới, đọc từ file mẫu cạnh script
blocks = open(sys.argv[3], encoding='utf-8').read()
for name in ['PRELUDE', 'VATTU_BLOCK', 'EXPORT_BLOCK', 'DEDUCT_BLOCK', 'EPILOGUE']:
    m = re.search(r'//@@' + name + r'\n(.*?)//@@END', blocks, re.S)
    if not m:
        raise SystemExit('Thiếu khối ' + name)
    globals()[name] = m.group(1)
body = body.replace('@@VATTU_BLOCK@@', VATTU_BLOCK).replace('@@EXPORT_BLOCK@@', EXPORT_BLOCK) \
           .replace('@@DEDUCT_BLOCK@@', DEDUCT_BLOCK)

# Thụt vào trong IIFE
indented = '\n'.join(('  ' + l) if l.strip() else '' for l in body.split('\n'))
open(out_path, 'w', encoding='utf-8').write(PRELUDE + indented + '\n' + EPILOGUE)
print('OK', out_path, len(PRELUDE + indented + EPILOGUE))
