/**
 * CẤU HÌNH FIREBASE — dán đoạn firebaseConfig lấy từ:
 *   Firebase Console -> Project settings (bánh răng) -> General -> Your apps -> Web app -> SDK setup and configuration -> Config
 *
 * Các giá trị này KHÔNG phải bí mật (mọi web app Firebase đều lộ ra trình duyệt). Bảo mật dữ liệu nằm
 * ở firebase/firestore.rules + danh sách người dùng trong sheet "APP USERS".
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDC7uYhXaaIIWQ9c9awYoEkBR2T3MdCbl0',
  authDomain: 'th-truemart-info.firebaseapp.com',
  projectId: 'th-truemart-info',
  storageBucket: 'th-truemart-info.firebasestorage.app',
  messagingSenderId: '689058170024',
  appId: '1:689058170024:web:f10719c9acd92b639f2e9d'
};

/** Dòng chữ nhỏ dưới logo "truemart" trên màn hình đăng nhập. */
export const APP_TITLE = 'Hệ thống quản lý';

/** Link Web app của Sync.gs (file TM) — Apps Script -> Triển khai -> Ứng dụng web. Để trống thì nút
 *  "Đồng bộ từ Google Sheet" quay về chức năng cũ (chỉ tải lại dữ liệu đã có trên app). */
export const SYNC_URL = '';
