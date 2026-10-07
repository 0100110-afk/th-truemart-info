"""Kiểm thử giao diện trong Chromium headless, KHÔNG cần Firebase: thay js/app.js bằng bản giả nạp dữ liệu mẫu
(tools/fixture.js) rồi bấm qua từng tab của bản máy tính và bản điện thoại, bắt mọi lỗi JS.
Chạy: python3 tools/test-ui.py   (cần: pip install playwright)"""
import os, sys, threading, http.server, functools
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUB = r"""
(async function () {
  await new Promise((r) => { const s = document.createElement('script'); s.src = 'tools/fixture.js'; s.onload = r; document.head.appendChild(s); });
  const FX = window.TM_FIXTURE, C = window.TMCore;
  Object.keys(FX.sheets).forEach((k) => C.setSheetData(k, FX.sheets[k]));
  let st = JSON.parse(JSON.stringify(FX.vattu)), stockin = [], autolog = [];
  C.setVatTu(st, stockin, autolog);
  const mut = (fn) => { const s2 = JSON.parse(JSON.stringify(st)); const r = fn(s2); st = s2; C.setVatTu(st, stockin, autolog); return r; };
  const api = Object.assign({}, C.READ_API);
  Object.keys(C.VT_OPS).forEach((n) => { if (n !== 'addVatTuStock') api[n] = (...a) => mut((s) => C.VT_OPS[n](s, ...a)); });
  api.addVatTuStock = (h, items) => mut((s) => C.VT_OPS.addVatTuStock(s, stockin, h, items));
  api.runVatTuAutoDeduction = () => { const s2 = JSON.parse(JSON.stringify(st)); const r = C.computeVatTuDeduction(s2, autolog); autolog = autolog.concat(r.newEntries); st = s2; C.setVatTu(st, stockin, autolog); return r.result; };
  api.getDataLastUpdated = () => '2026-10-07T05:00:00Z';
  api.refreshData = () => ({ success: true, refreshedAt: new Date().toISOString() });
  document.getElementById('tmAuth').classList.add('hidden');
  window.__TM_API_READY(api);
})();
"""

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(H, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
def watch(page, tag):
    page.on('pageerror', lambda e: errors.append(f'[{tag}] pageerror: {e}'))
    page.on('console', lambda m: errors.append(f'[{tag}] console.{m.type}: {m.text}') if m.type == 'error' and 'net::' not in m.text and 'Failed to load resource' not in m.text else None)

def route(page):
    page.route('**/js/app.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    # mạng ngoài bị chặn trong môi trường test: font + Chart.js thì giả rỗng / dùng bản cục bộ nếu có
    page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    chart = os.environ.get('CHARTJS')
    page.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=open(chart).read() if chart else ''))
    page.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=''))

shots = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None)
    # ---- Máy tính ----
    pg = b.new_page(viewport={'width': 1366, 'height': 900}); watch(pg, 'desktop'); route(pg)
    pg.goto('http://127.0.0.1:8765/desktop.html')
    pg.wait_for_selector('#statGrid .stat-card', timeout=8000)
    pg.wait_for_timeout(600)
    pg.screenshot(path=f'{shots}/desktop-dashboard.png')
    for v in ['stores', 'assets', 'sanaky', 'maintenance', 'vattu', 'dongia']:
        pg.click(f'.nav-item[data-view="{v}"]'); pg.wait_for_timeout(500)
    pg.click('.nav-item[data-view="vattu"]')
    pg.wait_for_selector('#vtTrackTable tbody .vt-status', timeout=5000); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{shots}/desktop-vattu.png')
    pg.click('#vtCalcBtn'); pg.fill('#vtPasswordInput', '121212'); pg.click('#vtPasswordOkBtn'); pg.wait_for_timeout(800)
    toast = pg.inner_text('#toast'); print('toast khớp vật tư:', toast)
    with pg.expect_download() as dl: pg.click('#vtExportBtn')
    print('tải excel:', dl.value.suggested_filename)
    pg.click('.nav-item[data-view="stores"]'); pg.fill('#storeSearchInput', '303060084'); pg.wait_for_timeout(900)
    pg.screenshot(path=f'{shots}/desktop-store.png')
    print('chi tiết cửa hàng có:', 'Lê Trọng Tấn' in pg.inner_text('#storeDetailWrap'))
    pg.click('#refreshDataBtn'); pg.wait_for_timeout(700)
    print('mốc cập nhật:', pg.inner_text('#dataLastUpdatedValue'))
    # ---- Điện thoại ----
    m = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); watch(m, 'mobile'); route(m)
    m.goto('http://127.0.0.1:8765/mobile.html')
    m.wait_for_selector('#dashStats .stat-tile', timeout=8000); m.wait_for_timeout(500)
    m.screenshot(path=f'{shots}/mobile-dashboard.png')
    for t in ['stores', 'assets', 'dongia']:
        m.click(f'.nav-tab[data-tab="{t}"]'); m.wait_for_timeout(400)
    for g in ['sanaky', 'maint', 'vattu']:
        m.click('#moreTab'); m.wait_for_timeout(300); m.click(f'.more-item[data-goto="{g}"]'); m.wait_for_timeout(500)
    m.screenshot(path=f'{shots}/mobile-vattu.png')
    # ---- Trang chọn giao diện ----
    r = b.new_page(viewport={'width': 390, 'height': 844}); route(r)
    r.goto('http://127.0.0.1:8765/index.html'); r.wait_for_timeout(500); print('router điện thoại ->', r.url.split('/')[-1])
    b.close()
srv.shutdown()
print('\n'.join(errors) if errors else 'KHÔNG CÓ LỖI JS')
sys.exit(1 if errors else 0)
