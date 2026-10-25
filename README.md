# TH true mart · Quản lý hệ thống (bản Web + App điện thoại)

Bản chuyển từ Google Apps Script sang **web tĩnh + Firebase**, chạy trên Vercel (`th-truemart-info.vercel.app`) và
cài được lên điện thoại như app (PWA). Google Sheet **vẫn là nơi nhập liệu** — Sync.gs tự đẩy dữ liệu lên.

```
 Google Sheet TM ──(Sync.gs: sửa ô / chèn, xoá dòng -> đẩy ngay)──────►  Firestore  ◄──── Web / App điện thoại
   DS CH, CH OFF, TAI SAN, BAO DUONG, CHI PHI, SANAKY,                    │            (Vercel)
   NCC THEO DÕI, APP USERS                                                │
 Google Sheet DG ──(quét dự phòng mỗi giờ, 7h–19h)──────────────────────►│
   DON GIA BT / XD / SNK                                                  │
                                                                          │
 Sheet VAT TU (bản sao) ◄──(kéo về khi mở file + mỗi giờ 7h–19h)─────────┘  ◄── Nhập kho / Khớp vật tư trên app
```

Admin cũng có thể bấm **Đồng bộ từ Google Sheet** trên app để đẩy ngay (cần bước 2.7 bên dưới).

**Mỗi bảng chỉ có MỘT nơi được sửa:**

| Bảng | Sửa ở đâu | Ghi chú |
|---|---|---|
| DS CH, CH OFF, TAI SAN, BAO DUONG, CHI PHI, SANAKY, NCC THEO DÕI (file **TM**) | **Google Sheet** | Sửa như cũ, app thấy sau vài giây |
| DON GIA BT, DON GIA XD, DON GIA SNK (file **DG**) | **Google Sheet** | File riêng nên không có trigger sửa ô: lên app ở lượt quét mỗi giờ, hoặc bấm đồng bộ trên app / menu |
| APP USERS (ai được vào **cả ba app**) | **Google Sheet** | Ba cột quyền (*Hệ thống quản lý*, *Phiếu sửa chữa*, *TH true care*) chỉ ghi `admin` hoặc `user`. Để trống = không vào được. Email mới → tự tạo tài khoản + gửi email đặt mật khẩu |
| VAT TU, VAT TU NHAP KHO, VAT TU TU DONG TRU | **App** | Sheet chỉ là bản sao, **đừng sửa tay** — lần kéo sau sẽ ghi đè |

Giao diện giữ **nguyên văn** Index.html / IndexMobile.html; logic tính toán giữ **nguyên văn** Code.gs
(được chuyển tự động sang `js/core.js`). Sổ "khớp vật tư" cũ được mang sang nên không trừ kho lần hai.

---

## Cài đặt lần đầu (~30 phút)

### 1. Tạo Firebase
1. Vào <https://console.firebase.google.com> → **Add project** (dùng tài khoản Google của bạn).
2. **Build → Firestore Database → Create database** → chọn vùng `asia-southeast1` (Singapore) → *Production mode*.
3. **Firestore → Rules**: xoá hết, dán nội dung file `firebase/firestore.rules` → **Publish**.
4. **Build → Authentication → Get started** → tab *Sign-in method* → bật **Google** và **Email/Password**.
5. **Project settings (bánh răng) → General → Your apps → biểu tượng `</>`** → đặt tên app → copy khối
   `firebaseConfig` → dán vào `js/firebase-config.js`.

### 2. Nối Google Sheet với Firebase
> Sync.gs **đứng một mình**, không cần Code.gs. Vị trí các tab / ID file DG nằm ở đầu Sync.gs (phần CẤU HÌNH).

1. **Project settings → Service accounts → Generate new private key** → tải file `.json`.
   *(Nếu báo bị chặn do chính sách tổ chức thì tạo dự án Firebase bằng tài khoản Gmail cá nhân, hoặc nhờ IT mở.)*
2. Mở file Google Sheet **TM** → **Tiện ích mở rộng → Apps Script**.
3. Tạo file mới **Sync.gs**, dán nội dung `apps-script/Sync.gs` (để nguyên Code.gs cũ).
4. **Project Settings (bánh răng) → Script Properties → Add script property**:
   `FIREBASE_SA` = dán **toàn bộ** nội dung file `.json` ở bước 1. → **Save**.
5. Chọn hàm **`caiDatDongBoFirebase`** trên thanh công cụ → **Run** → cấp quyền.
   Hàm này: tạo sheet **APP USERS** (đã có sẵn email của bạn với quyền admin), bật trigger đồng bộ,
   đưa kho vật tư hiện có lên app và đẩy toàn bộ bảng lên Firestore.
6. Tải lại file Sheet → có menu **App TM** (Đồng bộ toàn bộ / Kéo vật tư về / Cài đặt lại / Cấp quyền Phiếu
   sửa chữa / Gửi lại email đặt mật khẩu / Xem tình trạng).
7. **Nút "Đồng bộ từ Google Sheet" trên app**: Apps Script → **Triển khai → Tùy chọn triển khai mới → Ứng dụng web**
   (Thực thi với tư cách: *Tôi* · Ai có quyền truy cập: *Bất kỳ ai*) → copy link `…/exec` → dán vào `SYNC_URL`
   trong `js/firebase-config.js`. Chỉ admin cột *Hệ thống quản lý* bấm được. Sau này sửa `doPost` trong Sync.gs
   thì **Triển khai → Quản lý → sửa → Phiên bản mới** để link cũ chạy code mới.

### 3. Thêm người dùng (dùng chung cho app Phiếu sửa chữa)

Sheet **APP USERS**: `Email | Hệ thống quản lý | Phiếu sửa chữa | TH true care | Ghi chú | Tài khoản (tự động)`.

Cột *TH true care* cấp quyền app [th-true-care](https://github.com/0100110-afk/th-true-care) — app đó dùng **chung Firebase này**, nên một người có cả hai quyền chỉ có **một** tài khoản (cùng mật khẩu / Google). Quyền ghi vào `care_users/<email>`.
- Thêm dòng → vài giây sau có quyền. Email chưa có tài khoản → Sync.gs tự tạo và gửi email
  *"Đặt mật khẩu"* (link hết hạn 1 giờ; gửi lại: chọn dòng → menu **App TM → Gửi lại email đặt mật khẩu**).
- Xoá quyền / xoá dòng → mất quyền ngay.
- Bật cột *Phiếu sửa chữa*: thêm Script Property `FIREBASE_SA_PSC` (khoá service account của Firebase
  app sửa chữa) rồi chạy `caiDatPhieuSuaChua` — hàm này nhập sẵn người dùng đang có của app sửa chữa.
- Trong app: bấm **Tài khoản** để *Liên kết Google* hoặc *Đặt / Đổi mật khẩu* — một người dùng được cả hai cách.
- Mở link trong Zalo: Zalo chặn đăng nhập Google → dùng email + mật khẩu (hoặc mở bằng trình duyệt).

### 4. Đưa lên Vercel
1. **Vercel → Add New Project → Import** repo này → Framework **Other**, không cần build command → **Deploy**.
   Mỗi lần push vào `main` web tự cập nhật. `.vercelignore` đã loại `apps-script/`, `tools/`, `firebase/` nên
   **không** lộ mã Apps Script ra web.
2. **Firebase → Authentication → Settings → Authorized domains → Add domain**: thêm tên miền app
   (`th-truemart-info.vercel.app`, và tên miền riêng nếu gắn qua *Vercel → Settings → Domains*).
3. **Đăng nhập Google qua chính tên miền app** (tránh lỗi trang trắng *"missing initial state"* trên iPhone):
   `vercel.json` chuyển tiếp `/__/auth/*` về Firebase, `js/firebase-config.js` liệt kê tên miền đó trong
   `PROXIED_AUTH_HOSTS`. Mỗi tên miền mới phải thêm vào cả hai chỗ đó **và** **Google Cloud → Google Auth
   Platform → Clients → Web client → Authorized redirect URIs**: `https://<tên miền>/__/auth/handler`.

> **GitHub Pages** (phương án phụ): repo → *Settings → Pages → Source: GitHub Actions*, workflow
> `.github/workflows/pages.yml` tự xuất bản phần web. Pages **không** chuyển tiếp `/__/auth/*` được nên
> đăng nhập Google trên iPhone có thể lỗi trang trắng — dùng email + mật khẩu, hoặc chạy chính trên Vercel.

### 5. Cài lên điện thoại
- **Android (Chrome)**: mở tên miền → menu ⋮ → **Cài đặt ứng dụng / Thêm vào màn hình chính**.
- **iPhone (Safari)**: nút Chia sẻ → **Thêm vào MH chính**.
- Link mở trong Zalo: bấm ⋯ → **Mở bằng trình duyệt** rồi mới cài.

App tự chọn giao diện theo màn hình; ép bằng `?ui=mobile` hoặc `?ui=desktop`.
Khi mất mạng app vẫn mở được và hiển thị dữ liệu lần tải gần nhất (chỉ xem).

---

## Sau khi chuyển

- **Ngừng ghi vật tư trên bản Apps Script cũ** (link `script.google.com`): mọi thay đổi ở đó vào sheet
  VAT TU sẽ bị bản kéo về từ app ghi đè. Muốn chắc chắn thì *Triển khai → Quản lý → Lưu trữ* bản cũ.
- Quyền ghi vật tư: **admin** cột *Hệ thống quản lý* thấy nút ghi và không phải nhập mật khẩu xác nhận;
  **user** chỉ xem (nút ghi bị ẩn). Firestore rules chặn ghi ở phía máy chủ, nên biết mật khẩu cũ cũng không ghi được.
- Nếu lỡ cần làm lại kho vật tư trên app từ sheet: chạy hàm `dayVatTuTuSheetLenAppGhiDe` (có hỏi xác nhận).

### Chi phí
Gói miễn phí (Spark) của Firebase: 50.000 lượt đọc + 20.000 lượt ghi/ngày. App lưu dữ liệu trên máy và
chỉ tải lại bảng nào thật sự thay đổi, nên mỗi lần mở chỉ tốn khoảng 5–15 lượt đọc → dư cho vài chục người
dùng mỗi ngày. Vercel gói Hobby miễn phí.

---

## Sửa giao diện / logic về sau

Mã gốc nằm trong `apps-script/` (Code.gs, Index.html, IndexMobile.html — y hệt bản Apps Script).
Sửa ở đó rồi chạy:

```bash
python3 tools/build_core.py apps-script/Code.gs js/core.js tools/core_blocks.js   # Code.gs -> js/core.js
python3 tools/build_pages.py                                                      # Index*.html -> desktop/mobile.html
node tools/test-core.js        # gọi thử mọi hàm với dữ liệu mẫu
node tools/test-sync.js        # chạy Sync.gs với Sheet + Firestore giả lập
python3 tools/test-ui.py       # bấm thử giao diện trong Chromium (cần: pip install playwright)
```

Sau khi đổi file web, tăng `VERSION` trong `sw.js` để máy người dùng bỏ bản lưu cũ ngay.

### Cấu trúc
| Đường dẫn | Vai trò |
|---|---|
| `index.html` | Chọn giao diện máy tính / điện thoại |
| `desktop.html`, `mobile.html` | Giao diện cũ + màn đăng nhập (sinh từ `apps-script/`) |
| `js/gas-shim.js` | Giả lập `google.script.run` để giao diện cũ chạy không cần sửa |
| `js/core.js` | Code.gs chạy trên trình duyệt (sinh tự động) |
| `js/app.js` | Firebase: đăng nhập, phân quyền, tải dữ liệu, ghi vật tư bằng transaction |
| `js/firebase-config.js` | **Dán cấu hình Firebase vào đây** |
| `apps-script/Sync.gs` | Dán vào project Apps Script: đồng bộ Sheet ↔ Firestore |
| `firebase/firestore.rules` | Quyền truy cập Firestore |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (cài lên điện thoại, chạy khi mất mạng) |
