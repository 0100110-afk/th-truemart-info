# CLAUDE.md — TH true mart · Hệ thống quản lý

Đọc README.md trước (kiến trúc, cài đặt, lệnh build/test, cấu trúc thư mục). File này chỉ ghi những điều README không nói.
Trao đổi, commit message, chú thích code: **tiếng Việt**.

## Không sửa trực tiếp
`desktop.html`, `mobile.html`, `js/core.js` là file sinh tự động. Sửa nguồn trong `apps-script/` → build → commit cả nguồn lẫn file sinh.
Sau build mà `git status` có file sinh đổi ngoài ý muốn → dừng lại kiểm tra.

## Đụng đến app khác
- Firebase này **dùng chung với repo `th-true-care`**; `firebase/firestore.rules` ở đây là rules của cả hai app.
  Sửa rules hoặc phần quyền trong Sync.gs (`care_users`, `admins`) phải giữ nguyên quyền đọc của care.
- APP USERS cấp quyền cho 3 app (Hệ thống quản lý, Phiếu sửa chữa, TH true care).
- Ghi vật tư trên app luôn qua transaction trong `js/app.js`; giữ sổ "khớp vật tư" để không trừ kho hai lần.

## Cách làm việc
- Thay đổi ảnh hưởng logic hoặc dữ liệu: **trình bày phương án trước**, chờ đồng ý. Giao diện nhỏ, rõ ràng: làm luôn.
- Không rõ sửa bản máy tính, điện thoại hay cả hai → hỏi.
- Sửa `apps-script/Sync.gs` → nhắc người dùng dán lại vào Apps Script file TM (và triển khai lại Web app nếu đổi `doPost`).
- Commit message: một dòng, mở đầu bằng khu vực (`Vật tư:`, `Điện thoại:`, `Sync.gs:`…), tả hành vi mới người dùng thấy.
- Không commit khoá service account hay dữ liệu thật (repo public).
