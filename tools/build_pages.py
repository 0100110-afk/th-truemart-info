#!/usr/bin/env python3
"""Sinh desktop.html / mobile.html từ Index.html / IndexMobile.html của Apps Script.
Giao diện giữ NGUYÊN VĂN, chỉ chèn thêm phần đầu (PWA + shim + core) và màn đăng nhập.
Chạy lại mỗi khi sửa giao diện trong apps-script/:  python3 tools/build_pages.py"""
import os, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HEAD = '''<meta charset="utf-8">
  {viewport}<title>TH true mart · Quản lý hệ thống</title>
  <meta name="theme-color" content="#0B4C8C">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="TH truemart">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" type="image/png" href="icons/favicon-96.png">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
  <link rel="stylesheet" href="css/auth.css">
  <!-- Thứ tự quan trọng: shim + core phải có TRƯỚC script inline của giao diện bên dưới -->
  <script src="js/gas-shim.js"></script>
  <script src="js/vendor/md5.min.js"></script>
  {xlsx}<script src="js/core.js"></script>
'''

# Bản web có phân quyền thật (sheet APP USERS): admin thì bỏ hộp mật khẩu 121212, người dùng
# (viewer) thì ẩn hẳn các nút ghi — xem css/auth.css (body.tm-viewer) và js/app.js (__TM_ROLE).
PATCHES = {
    'Index.html': [('  function passwordDialog(title, message) {\n',
                    '  function passwordDialog(title, message) {\n'
                    '    if (window.__TM_ROLE === \'admin\') return Promise.resolve(true);   // web: đã phân quyền bằng tài khoản\n')],
    'IndexMobile.html': [('  function requirePassword_(title,message){\n',
                          '  function requirePassword_(title,message){\n'
                          '    if (window.__TM_ROLE === \'admin\') return Promise.resolve(true);   // web: đã phân quyền bằng tài khoản\n')],
}

def build(src, dst, desktop):
    s = open(os.path.join(root, 'apps-script', src), encoding='utf-8').read()
    for old, new in PATCHES.get(src, []):
        if old not in s:
            sys.exit('Không tìm thấy đoạn cần vá trong ' + src + ': ' + old.strip())
        s = s.replace(old, new, 1)
    s = s.replace('<base target="_top">', '')
    has_vp = 'name="viewport"' in s
    head = HEAD.format(
        viewport='' if has_vp else '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n  ',
        xlsx='<script src="js/vendor/xlsx.mini.min.js" defer></script>\n  ' if desktop else '')
    i = s.index('<head>') + len('<head>')
    s = s[:i] + '\n  ' + head + s[i:]
    i = s.index('<body>') + len('<body>')
    s = s[:i] + '\n  <div id="tmAuth"></div>' + s[i:]
    i = s.rindex('</body>')
    s = s[:i] + '  <script type="module" src="js/app.js"></script>\n' + s[i:]
    open(os.path.join(root, dst), 'w', encoding='utf-8').write(s)
    print('OK', dst)

build('Index.html', 'desktop.html', True)
build('IndexMobile.html', 'mobile.html', False)
