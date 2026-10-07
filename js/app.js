/**
 * app.js — Firebase: đăng nhập, nạp dữ liệu Firestore vào core.js, bọc các thao tác GHI vật tư trong
 * transaction, rồi mở cổng google.script.run (gas-shim.js) cho giao diện.
 *
 * Bố cục dữ liệu trên Firestore (do apps-script/Sync.gs ghi, xem README):
 *   meta/sheets            { json: '{ updatedAt, sheets: { <key>: { n, hash, headers, rowCount, updatedAt } } }' }
 *   sheetdata/<key>__<i>   { key, i, hash, json: '[[...row], ...]' }      (chỉ Sync.gs được ghi)
 *   vattu/state            { json: '{ holders, materials, autologMigrated, autologChunks }', rev, updatedAt, updatedBy }
 *   vattu/stockin          { json: '[{ date, code, name, qty, holder }]' }
 *   vattu_autolog/c<i>     { json: '[{ k, d, code, name, qty, holder }]' }  sổ dòng CHI PHÍ đã trừ kho
 *   users/<email>          { role: 'viewer' | 'editor' | 'admin' }         (Sync.gs ghi từ sheet APP USERS)
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut,
  EmailAuthProvider, linkWithPopup, linkWithCredential, updatePassword, unlink, getAdditionalUserInfo
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, collection, query, where, runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { FIREBASE_CONFIG, APP_TITLE } from './firebase-config.js';

const SHEET_KEYS = ['stores', 'assets', 'maint', 'chiphi', 'sanaky', 'dongia_bt', 'dongia_xd', 'dongia_snk'];
const AUTOLOG_CHUNK_MAX = 2500;   // ~110 byte/dòng -> ~275KB/tài liệu, xa trần 1MB của Firestore

const fbApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

let currentUser = null;
let currentRole = null;
let lastUpdatedIso = null;
let autologCache = [];
let stockinCache = [];
let apiOpened = false;

// ============================== IndexedDB (lưu dữ liệu đã tải để mở app nhanh + xem được khi mất mạng) ==============================

const idb = (() => {
  let dbp = null;
  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('tm-cache', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function op(mode, fn) {
    try {
      const d = await open();
      return await new Promise((res, rej) => {
        const t = d.transaction('kv', mode);
        const req = fn(t.objectStore('kv'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      });
    } catch (e) { return undefined; }   // trình duyệt chặn IndexedDB (ẩn danh...) -> coi như không có cache
  }
  return {
    get: (k) => op('readonly', (s) => s.get(k)),
    set: (k, v) => op('readwrite', (s) => s.put(v, k)),
    clear: () => op('readwrite', (s) => s.clear())
  };
})();

// ============================== MÀN ĐĂNG NHẬP ==============================

const $ = (s) => document.querySelector(s);
const authEl = $('#tmAuth');

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Logo giống hệt app Phiếu sửa chữa: ô TH chữ serif + ngôi sao 6 cánh vàng đè mép phải.
const STAR_SVG = '<svg class="tm-auth-star" viewBox="0 0 24 24" fill="none" aria-hidden="true"><defs>' +
  '<linearGradient id="tmStarGold" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#FDF0C6"/><stop offset=".45" stop-color="#E9B24A"/><stop offset="1" stop-color="#B67F22"/>' +
  '</linearGradient></defs><path fill="url(#tmStarGold)" d="M12 .5Q13.1 10.1 18.5 8.25Q14.2 12 18.5 15.75Q13.1 13.9 12 22Q10.9 13.9 5.5 15.75Q9.8 12 5.5 8.25Q10.9 10.1 12 .5Z"/></svg>';
const BRAND = '<div class="tm-auth-brand"><div class="tm-auth-mark"><span class="tm-auth-th">TH</span>' + STAR_SVG + '</div>' +
  '<div><div class="tm-auth-word"><span class="w-true">true</span><span class="w-mart">mart</span></div>' +
  '<div class="tm-auth-sub">' + esc(APP_TITLE) + '</div></div></div>';

function showAuth(html) {
  authEl.innerHTML = '<div class="tm-auth-card">' + BRAND + html + '</div>';
  authEl.classList.remove('hidden');
}
function hideAuth() { authEl.classList.add('hidden'); }

function showLoading(msg) {
  showAuth('<div class="tm-auth-loading"><div class="tm-spin"></div><div>' + esc(msg) + '</div></div>');
}

function showLogin(errMsg) {
  showAuth(
    '<button class="tm-btn tm-btn-google" id="tmGoogleBtn" type="button">' +
      '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' +
      'Đăng nhập bằng Google</button>' +
    '<div class="tm-or"><span>hoặc</span></div>' +
    '<form id="tmEmailForm" autocomplete="on">' +
      '<input class="tm-input" type="email" id="tmEmail" placeholder="Email" autocomplete="username" required>' +
      '<input class="tm-input" type="password" id="tmPass" placeholder="Mật khẩu" autocomplete="current-password" required>' +
      '<button class="tm-btn tm-btn-primary" type="submit" id="tmSubmit">Đăng nhập</button>' +
      '<button class="tm-link" type="button" id="tmForgot">Quên mật khẩu?</button>' +
    '</form>' +
    '<div class="tm-auth-err" id="tmAuthErr">' + esc(errMsg || '') + '</div>' +
    '<div class="tm-auth-note">Tài khoản do quản trị viên cung cấp.</div>'
  );
  $('#tmGoogleBtn').onclick = loginGoogle;
  $('#tmEmailForm').onsubmit = (e) => {
    e.preventDefault();
    const btn = $('#tmSubmit');
    btn.disabled = true; btn.textContent = 'Đang đăng nhập...'; setAuthErr('');
    signInWithEmailAndPassword(auth, $('#tmEmail').value.trim(), $('#tmPass').value)
      .catch((err) => { setAuthErr(authErrText(err)); btn.disabled = false; btn.textContent = 'Đăng nhập'; });
  };
  $('#tmForgot').onclick = () => {
    const em = $('#tmEmail').value.trim();
    if (!em) { setAuthErr('Nhập email trước rồi bấm "Quên mật khẩu".'); return; }
    sendPasswordResetEmail(auth, em)
      .then(() => setAuthErr('Đã gửi email đặt lại mật khẩu tới ' + em + '.'))
      .catch((err) => setAuthErr(authErrText(err)));
  };
}

function setAuthErr(t) { const el = $('#tmAuthErr'); if (el) el.textContent = t; }

function authErrText(err) {
  const c = (err && err.code) || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Sai email hoặc mật khẩu.';
  if (c.includes('too-many-requests')) return 'Thử sai quá nhiều lần, đợi vài phút rồi thử lại.';
  if (c.includes('popup-closed') || c.includes('cancelled-popup')) return '';
  if (c.includes('unauthorized-domain')) return 'Tên miền này chưa được thêm vào Firebase Auth → Settings → Authorized domains.';
  if (c.includes('network')) return 'Không có kết nối mạng.';
  return (err && err.message) || 'Đăng nhập không thành công.';
}

function loginGoogle() {
  const provider = googleProvider();
  signInWithPopup(auth, provider).catch((err) => {
    const c = (err && err.code) || '';
    // Trình duyệt trong Zalo/Facebook chặn popup -> chuyển sang chuyển hướng toàn trang
    if (c.includes('popup-blocked') || c.includes('operation-not-supported')) {
      signInWithRedirect(auth, provider).catch((e2) => setAuthErr(authErrText(e2)));
    } else {
      setAuthErr(authErrText(err));
    }
  });
}

function showNoAccess(email) {
  showAuth(
    '<div class="tm-auth-msg"><b>Tài khoản chưa được cấp quyền</b><br>' + esc(email) +
    '<br><br>Liên hệ quản trị viên để được cấp quyền, sau đó bấm "Thử lại".</div>' +
    '<button class="tm-btn tm-btn-primary" id="tmRetry" type="button">Thử lại</button>' +
    '<button class="tm-btn" id="tmLogout2" type="button">Đăng xuất</button>'
  );
  $('#tmRetry').onclick = () => location.reload();
  $('#tmLogout2').onclick = () => doLogout();
}

async function doLogout() {
  await idb.clear();
  try { localStorage.removeItem('tm_role'); } catch (e) { /* bỏ qua */ }
  await signOut(auth);
  location.reload();
}

// ============================== NẠP DỮ LIỆU ==============================

function parseJsonField(snap, fallback) {
  if (!snap || !snap.exists()) return fallback;
  try { return JSON.parse(snap.data().json || 'null') ?? fallback; } catch (e) { return fallback; }
}

async function loadSheetKey(key, m) {
  const cached = await idb.get('sheet:' + key);
  if (cached && cached.hash === m.hash) return cached;

  for (let attempt = 0; attempt < 2; attempt++) {
    const qs = await getDocs(query(collection(db, 'sheetdata'), where('key', '==', key)));
    const chunks = [];
    qs.forEach((d) => chunks.push(d.data()));
    const ok = chunks.length === m.n && chunks.every((c) => c.hash === m.hash);
    if (ok) {
      chunks.sort((a, b) => a.i - b.i);
      let rows = [];
      chunks.forEach((c) => { rows = rows.concat(JSON.parse(c.json)); });
      const payload = { hash: m.hash, headers: m.headers, rows };
      await idb.set('sheet:' + key, payload);
      return payload;
    }
    // Sync.gs đang ghi dở đúng lúc này -> đợi chút rồi đọc lại
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Dữ liệu "' + key + '" đang được đồng bộ, thử bấm Làm mới sau ít giây.');
}

async function loadAll() {
  let meta = null;
  let offline = false;
  try {
    meta = parseJsonField(await getDoc(doc(db, 'meta', 'sheets')), null);
    if (meta) await idb.set('meta', meta);
  } catch (e) {
    meta = await idb.get('meta');
    offline = true;
    if (!meta) throw new Error('Không tải được dữ liệu (mất mạng hoặc chưa được cấp quyền).');
  }
  if (!meta || !meta.sheets) {
    throw new Error('Firestore chưa có dữ liệu. Mở Google Sheet TM -> menu "App TM" -> "Đồng bộ toàn bộ lên app".');
  }
  lastUpdatedIso = meta.updatedAt || null;

  await Promise.all(SHEET_KEYS.map(async (key) => {
    const m = meta.sheets[key];
    if (!m) return;
    const payload = offline ? await idb.get('sheet:' + key) : await loadSheetKey(key, m);
    if (payload) TMCore.setSheetData(key, payload);
  }));

  await loadVatTu(offline);
  return offline;
}

async function loadVatTu(offline) {
  let st, stockin, autolog;
  if (offline) {
    const c = (await idb.get('vattu')) || {};
    st = c.st; stockin = c.stockin; autolog = c.autolog;
  } else {
    const [s1, s2, s3] = await Promise.all([
      getDoc(doc(db, 'vattu', 'state')),
      getDoc(doc(db, 'vattu', 'stockin')),
      getDocs(collection(db, 'vattu_autolog'))
    ]);
    st = parseJsonField(s1, null);
    stockin = parseJsonField(s2, []);
    const chunks = [];
    s3.forEach((d) => chunks.push({ id: d.id, entries: parseJsonField(d, []) }));
    chunks.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    autolog = [].concat(...chunks.map((c) => c.entries));
    await idb.set('vattu', { st, stockin, autolog });
  }
  autologCache = autolog || [];
  stockinCache = stockin || [];
  TMCore.setVatTu(st || TMCore.emptyVatTuState(), stockinCache, autologCache);
}

// ============================== GHI VẬT TƯ (TRANSACTION) ==============================

function requireEditor() {
  if (currentRole !== 'editor' && currentRole !== 'admin') {
    throw new Error('Tài khoản ' + (currentUser && currentUser.email) + ' chỉ có quyền XEM, không sửa được vật tư.');
  }
}

function writeErr(err) {
  const c = (err && err.code) || '';
  if (c === 'permission-denied') return new Error('Bạn không có quyền thực hiện thao tác này.');
  if (c === 'unavailable') return new Error('Mất kết nối máy chủ, thao tác chưa được lưu. Thử lại khi có mạng.');
  if (c === 'aborted') return new Error('Có người khác đang cập nhật vật tư, vui lòng thử lại sau vài giây.');
  return err;
}

const stateRef = () => doc(db, 'vattu', 'state');
const stockRef = () => doc(db, 'vattu', 'stockin');

function stateDoc(st, prevSnap) {
  const rev = (prevSnap.exists() ? Number(prevSnap.data().rev) || 0 : 0) + 1;
  return { json: JSON.stringify(st), rev, updatedAt: serverTimestamp(), updatedBy: currentUser.email };
}

/** fn(state, stockinArray) sửa trực tiếp và trả kết quả. Transaction tự chạy lại khi đụng độ. */
async function mutateVatTu(fn) {
  requireEditor();
  try {
    const out = await runTransaction(db, async (tx) => {
      const s1 = await tx.get(stateRef());
      const s2 = await tx.get(stockRef());
      const st = parseJsonField(s1, null) || TMCore.emptyVatTuState();
      const stockin = parseJsonField(s2, []);
      const n0 = stockin.length;
      const res = fn(st, stockin);
      tx.set(stateRef(), stateDoc(st, s1));
      if (stockin.length !== n0) tx.set(stockRef(), { json: JSON.stringify(stockin), updatedAt: serverTimestamp() });
      return { res, st, stockin };
    });
    stockinCache = out.stockin;
    TMCore.setVatTu(out.st, stockinCache, autologCache);
    idb.set('vattu', { st: out.st, stockin: stockinCache, autolog: autologCache });
    return out.res;
  } catch (e) { throw writeErr(e); }
}

function opWrapper(name) {
  return (...args) => mutateVatTu((st) => TMCore.VT_OPS[name](st, ...args));
}

async function runVatTuAutoDeduction() {
  requireEditor();
  try {
    const out = await runTransaction(db, async (tx) => {
      const s1 = await tx.get(stateRef());
      const st = parseJsonField(s1, null) || TMCore.emptyVatTuState();
      const nChunks = Number(st.autologChunks) || 0;
      const chunkSnaps = [];
      for (let i = 0; i < nChunks; i++) chunkSnaps.push(await tx.get(doc(db, 'vattu_autolog', 'c' + i)));
      const chunks = chunkSnaps.map((s) => parseJsonField(s, []));
      const entries = [].concat(...chunks);

      const r = TMCore.computeVatTuDeduction(st, entries);

      let newChunks;
      if (r.replaceAll) {
        newChunks = [];
        for (let i = 0; i < r.newEntries.length; i += AUTOLOG_CHUNK_MAX) newChunks.push(r.newEntries.slice(i, i + AUTOLOG_CHUNK_MAX));
      } else {
        newChunks = chunks.slice();
        let last = newChunks.length ? newChunks[newChunks.length - 1].slice() : [];
        if (newChunks.length) newChunks.pop();
        r.newEntries.forEach((e) => {
          if (last.length >= AUTOLOG_CHUNK_MAX) { newChunks.push(last); last = []; }
          last.push(e);
        });
        if (last.length || !newChunks.length) newChunks.push(last);
      }

      if (r.replaceAll || r.newEntries.length) {
        // Chỉ ghi lại các chunk có thay đổi (chunk cuối + chunk mới); khi khởi tạo thì ghi tất cả
        const firstChanged = r.replaceAll ? 0 : Math.max(0, chunks.length - 1);
        for (let i = firstChanged; i < newChunks.length; i++) {
          tx.set(doc(db, 'vattu_autolog', 'c' + i), { json: JSON.stringify(newChunks[i]), updatedAt: serverTimestamp() });
        }
        for (let i = newChunks.length; i < nChunks; i++) tx.delete(doc(db, 'vattu_autolog', 'c' + i));
        st.autologChunks = newChunks.length;
        tx.set(stateRef(), stateDoc(st, s1));
      }
      return { result: r.result, st, entries: [].concat(...newChunks) };
    });
    autologCache = out.entries;
    TMCore.setVatTu(out.st, stockinCache, autologCache);
    idb.set('vattu', { st: out.st, stockin: stockinCache, autolog: autologCache });
    return out.result;
  } catch (e) { throw writeErr(e); }
}

// ============================== API CHO GIAO DIỆN ==============================

function buildApi() {
  const api = Object.assign({}, TMCore.READ_API);
  ['saveVatTuItem', 'deleteVatTuItem', 'moveVatTuItem', 'addVatTuHolder', 'renameVatTuHolder',
    'deleteVatTuHolder', 'setVatTuQty', 'setVatTuQtyBulk'].forEach((n) => { api[n] = opWrapper(n); });
  api.addVatTuStock = (holder, items) => mutateVatTu((st, stockin) => TMCore.VT_OPS.addVatTuStock(st, stockin, holder, items));
  api.runVatTuAutoDeduction = runVatTuAutoDeduction;
  api.getDataLastUpdated = () => lastUpdatedIso;
  api.refreshData = async () => {
    const offline = await loadAll();
    if (offline) throw new Error('Đang mất mạng — vẫn hiển thị dữ liệu đã lưu lần trước.');
    return { success: true, refreshedAt: lastUpdatedIso };
  };
  return api;
}

// Rules bắt buộc email đã xác minh. Token cũ (cấp trước khi Sync.gs đánh dấu đã xác minh)
// còn mang false tới 1 giờ -> gặp false thì xin token mới một lần. Mất mạng: null.
async function emailVerifiedClaim(u) {
  try {
    let t = await u.getIdTokenResult();
    if (t.claims.email_verified !== true) t = await u.getIdTokenResult(true);
    return t.claims.email_verified === true;
  } catch (e) { return null; }
}

// ============================== HỘP TÀI KHOẢN: dùng được cả mật khẩu lẫn Google ==============================

function googleProvider() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}

function accountErrText(err) {
  const c = (err && err.code) || '';
  if (c === 'app/google-email-mismatch') return err.message;
  if (c.includes('weak-password')) return 'Mật khẩu quá ngắn — cần ít nhất 6 ký tự.';
  if (c.includes('requires-recent-login')) return 'Để đổi mật khẩu, hãy đăng xuất rồi đăng nhập lại, sau đó thử lại ngay.';
  if (c.includes('credential-already-in-use') || c.includes('email-already-in-use')) return 'Tài khoản Google này đã gắn với một tài khoản khác.';
  if (c.includes('provider-already-linked')) return 'Tài khoản đã liên kết Google rồi.';
  return authErrText(err) || 'Không thực hiện được, vui lòng thử lại.';
}

const ROLE_TEXT = (r) => (r === 'admin' ? 'Quản trị' : 'Người dùng');

/** Khung hộp thoại theo đúng giao diện đang mở: bản máy tính dùng .modal, bản điện thoại dùng
 *  .sheet (bottom sheet) — để chữ, cỡ chữ, nút, ô nhập giống hệt các hộp thoại khác của app. */
function accountShell() {
  const mobile = !!document.getElementById('moreSheet');
  let wrap = document.getElementById('tmAccWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'tmAccWrap';
    wrap.innerHTML = mobile
      ? '<div class="sheet-overlay" id="tmAccOverlay"></div>' +
        '<div class="sheet" id="tmAccSheet"><div class="sheet-grip"></div>' +
        '<div class="sheet-head"><h3>Tài khoản</h3><button class="sheet-close" type="button" id="tmAccClose">✕</button></div>' +
        '<div class="sheet-body" id="tmAccBody"></div></div>'
      : '<div class="modal-overlay" id="tmAccOverlay"><div class="modal" style="max-width:440px">' +
        '<div class="modal-head"><h3>Tài khoản</h3><button class="modal-close" type="button" id="tmAccClose">✕</button></div>' +
        '<div class="modal-body" id="tmAccBody"></div></div></div>';
    document.body.appendChild(wrap);
    const close = () => {
      document.getElementById('tmAccOverlay').classList.remove('active');
      const sh = document.getElementById('tmAccSheet'); if (sh) sh.classList.remove('active');
    };
    document.getElementById('tmAccClose').onclick = close;
    document.getElementById('tmAccOverlay').addEventListener('click', (e) => { if (e.target.id === 'tmAccOverlay') close(); });
  }
  return {
    body: document.getElementById('tmAccBody'),
    open() {
      document.getElementById('tmAccOverlay').classList.add('active');
      const sh = document.getElementById('tmAccSheet'); if (sh) sh.classList.add('active');
    },
    close() { document.getElementById('tmAccClose').click(); }
  };
}

function showAccountDialog(okMsg) {
  if (typeof okMsg !== 'string') okMsg = '';   // gọi từ sự kiện click thì tham số là Event, không phải lời nhắn
  const shell = accountShell();
  const u = auth.currentUser;
  if (!u) { shell.close(); return; }
  const ids = (u.providerData || []).map((p) => p.providerId);
  const hasPw = ids.includes('password'), hasG = ids.includes('google.com');
  const method = (name, on) => '<div class="tm-acc-method' + (on ? ' on' : '') + '"><span>' + name + '</span><b>' + (on ? 'Đang dùng' : 'Chưa có') + '</b></div>';
  shell.body.innerHTML = '<div class="tm-acc">' +
    '<div class="tm-acc-row"><span>Email</span><b>' + esc(u.email) + '</b></div>' +
    '<div class="tm-acc-row"><span>Quyền</span><b>' + ROLE_TEXT(currentRole) + '</b></div>' +
    '<div class="tm-acc-title">Cách đăng nhập</div>' + method('Email + mật khẩu', hasPw) + method('Google', hasG) +
    '<div class="tm-acc-msg" id="tmAccMsg"></div>' +
    '<div class="tm-acc-actions" id="tmAccActions">' +
      (hasG ? '' : '<button type="button" class="btn btn-ghost" id="tmAccLinkG">Liên kết Google</button>') +
      '<button type="button" class="btn btn-ghost" id="tmAccPwBtn">' + (hasPw ? 'Đổi mật khẩu' : 'Đặt mật khẩu') + '</button>' +
    '</div>' +
    '<form id="tmAccPwForm" class="tm-acc-pw" hidden>' +
      '<div class="field"><label>' + (hasPw ? 'Mật khẩu mới' : 'Mật khẩu') + '</label><input type="password" id="tmAccPw1" autocomplete="new-password" placeholder="Ít nhất 6 ký tự"></div>' +
      '<div class="field"><label>Nhập lại mật khẩu</label><input type="password" id="tmAccPw2" autocomplete="new-password"></div>' +
      '<div class="tm-acc-actions"><button type="submit" class="btn btn-primary" id="tmAccSave">Lưu mật khẩu</button>' +
      '<button type="button" class="btn btn-ghost" id="tmAccCancel">Huỷ</button></div>' +
    '</form>' +
    '<p class="tm-acc-note">Liên kết ở đây thì giữ được cả hai cách đăng nhập.</p>' +
  '</div>';
  shell.open();
  const msg = (t, ok) => { const m = document.getElementById('tmAccMsg'); if (!m) return; m.textContent = t; m.className = 'tm-acc-msg' + (ok ? ' ok' : ''); };
  if (okMsg) msg(okMsg, true);

  // Sau khi liên kết/đổi mật khẩu, Firebase có thể buộc đăng nhập lại (phiên cũ bị thu hồi).
  // Khi đó auth.currentUser = null: đóng hộp và để màn đăng nhập hiện ra, kèm lời nhắn.
  const afterChange = async (okText) => {
    try { await u.reload(); } catch (e) { /* phiên bị thu hồi -> xử lý bên dưới */ }
    if (!auth.currentUser) {
      shell.close();
      showLogin(okText + ' Vui lòng đăng nhập lại.');
      return;
    }
    showAccountDialog(okText);
  };

  const linkBtn = document.getElementById('tmAccLinkG');
  if (linkBtn) linkBtn.onclick = async () => {
    linkBtn.disabled = true; msg('');
    try {
      const r = await linkWithPopup(u, googleProvider());
      const info = getAdditionalUserInfo(r);
      const gEmail = String((info && info.profile && info.profile.email) || '').toLowerCase();
      if (gEmail && gEmail !== String(u.email).toLowerCase()) {
        await unlink(u, 'google.com');
        const e = new Error('Tài khoản Google ' + gEmail + ' không trùng email ' + u.email + '. Hãy chọn đúng Gmail ' + u.email + '.');
        e.code = 'app/google-email-mismatch'; throw e;
      }
      await afterChange('Đã liên kết Google. Từ giờ đăng nhập được bằng cả Google lẫn mật khẩu.');
    } catch (err) { msg(accountErrText(err)); linkBtn.disabled = false; }
  };
  document.getElementById('tmAccPwBtn').onclick = () => {
    document.getElementById('tmAccPwForm').hidden = false;
    document.getElementById('tmAccActions').hidden = true;
    msg('');
    document.getElementById('tmAccPw1').focus();
  };
  document.getElementById('tmAccCancel').onclick = () => {
    document.getElementById('tmAccPwForm').hidden = true;
    document.getElementById('tmAccActions').hidden = false;
  };
  document.getElementById('tmAccPwForm').onsubmit = async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('tmAccPw1').value, p2 = document.getElementById('tmAccPw2').value;
    if (p1.length < 6) { msg('Mật khẩu cần ít nhất 6 ký tự.'); return; }
    if (p1 !== p2) { msg('Hai lần nhập mật khẩu không khớp.'); return; }
    const save = document.getElementById('tmAccSave');
    save.disabled = true; save.textContent = 'Đang lưu...';
    try {
      if (hasPw) await updatePassword(u, p1);
      else await linkWithCredential(u, EmailAuthProvider.credential(u.email, p1));
      await afterChange(hasPw ? 'Đã đổi mật khẩu.' : 'Đã đặt mật khẩu. Từ giờ đăng nhập được bằng email ' + u.email + ' và mật khẩu này.');
    } catch (err) {
      msg(accountErrText(err));
      save.disabled = false; save.textContent = 'Lưu mật khẩu';
    }
  };
}

function injectUserBox() {
  const email = currentUser.email || '';
  const roleTxt = ROLE_TEXT(currentRole);
  const foot = document.querySelector('.sidebar-foot');                 // bản máy tính
  if (foot) {
    const box = document.createElement('div');
    box.className = 'tm-userbox';
    box.innerHTML = '<div class="tm-userbox-mail" title="' + esc(email) + '">' + esc(email) + '</div>' +
      '<div class="tm-userbox-row"><button type="button" id="tmAccountBtn">Tài khoản</button><button type="button" id="tmLogoutBtn">Đăng xuất</button></div>';
    foot.insertBefore(box, foot.firstChild);
  }
  const sheetBody = document.querySelector('#moreSheet .sheet-body');   // bản điện thoại
  if (sheetBody) {
    const it = document.createElement('div');
    it.className = 'more-item';
    it.id = 'tmLogoutBtn';
    it.innerHTML = '<div class="more-ic ic" style="background:#F7E1DE;color:#C1443A;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg></div>' +
      '<div class="more-main"><div class="more-title">Đăng xuất</div><div class="more-sub">' + esc(email) + ' · ' + roleTxt + '</div></div>';
    const acc = document.createElement('div');
    acc.className = 'more-item';
    acc.id = 'tmAccountBtnM';
    acc.innerHTML = '<div class="more-ic ic" style="background:#E3F0FA;color:#0B4C8C;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg></div>' +
      '<div class="more-main"><div class="more-title">Tài khoản</div><div class="more-sub">Cách đăng nhập, đặt / đổi mật khẩu</div></div>';
    sheetBody.appendChild(acc);
    acc.addEventListener('click', () => {
      const closeBtn = document.querySelector('#moreSheet .sheet-close, #moreSheet [data-close]');
      if (closeBtn) closeBtn.click();
      showAccountDialog();
    });
    sheetBody.appendChild(it);
  }
  const accBtn = document.getElementById('tmAccountBtn');
  if (accBtn) accBtn.addEventListener('click', () => showAccountDialog());
  const btn = document.getElementById('tmLogoutBtn');
  if (btn) btn.addEventListener('click', doLogout);
}

// ============================== KHỞI ĐỘNG ==============================

async function checkRole(user) {
  const email = String(user.email || '').toLowerCase();
  try {
    const snap = await getDoc(doc(db, 'users', email));
    let role = snap.exists() ? String(snap.data().role || 'viewer') : null;
    // Khớp rules: tài khoản phải đúng uid Sync.gs đã ghi, HOẶC email đã xác minh.
    // (Liên kết mật khẩu vào tài khoản Google làm Firebase đặt lại "chưa xác minh" —
    //  uid vẫn giữ nguyên nên vẫn vào được.)
    const uid = snap.exists() ? snap.data().uid : '';
    if (role && uid && uid !== user.uid && await emailVerifiedClaim(user) === false) role = null;
    try { localStorage.setItem('tm_role', JSON.stringify({ email, role })); } catch (e) { /* bỏ qua */ }
    return role;
  } catch (e) {
    // Mất mạng: dùng quyền đã biết lần trước để vẫn xem được dữ liệu đã lưu
    try {
      const c = JSON.parse(localStorage.getItem('tm_role') || 'null');
      if (c && c.email === email) return c.role;
    } catch (e2) { /* bỏ qua */ }
    if (e && e.code === 'permission-denied') return null;
    throw e;
  }
}

async function start(user) {
  currentUser = user;
  showLoading('Đang kiểm tra quyền truy cập…');
  try {
    currentRole = await checkRole(user);
  } catch (e) {
    showAuth('<div class="tm-auth-msg">Không kết nối được máy chủ.<br>' + esc(e.message || '') + '</div>' +
      '<button class="tm-btn tm-btn-primary" type="button" onclick="location.reload()">Thử lại</button>');
    return;
  }
  if (!currentRole) { showNoAccess(user.email); return; }
  // Quyền trên giao diện: admin (và editor bản cũ) bỏ hộp mật khẩu 121212; người dùng chỉ xem —
  // ẩn hết nút ghi (css/auth.css: body.tm-viewer). Rules vẫn chặn ghi nếu cố gọi.
  const canEdit = currentRole === 'admin' || currentRole === 'editor';
  window.__TM_ROLE = canEdit ? 'admin' : 'viewer';
  document.body.classList.toggle('tm-viewer', !canEdit);

  showLoading('Đang tải dữ liệu…');
  let offline = false;
  try {
    offline = await loadAll();
  } catch (e) {
    showAuth('<div class="tm-auth-msg">' + esc(e.message || String(e)) + '</div>' +
      '<button class="tm-btn tm-btn-primary" type="button" onclick="location.reload()">Thử lại</button>' +
      '<button class="tm-btn" type="button" id="tmLogout3">Đăng xuất</button>');
    const b = document.getElementById('tmLogout3'); if (b) b.onclick = doLogout;
    return;
  }
  injectUserBox();
  hideAuth();
  if (!apiOpened) { apiOpened = true; window.__TM_API_READY(buildApi()); }
  if (offline) setTimeout(() => {
    const t = document.getElementById('toast');
    if (t) { t.textContent = 'Đang mất mạng — hiển thị dữ liệu đã lưu lần trước.'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4000); }
  }, 600);
}

showLoading('Đang kiểm tra đăng nhập…');
getRedirectResult(auth).catch((err) => { if (err && err.code) setAuthErr(authErrText(err)); });
onAuthStateChanged(auth, (user) => {
  if (user) { if (!currentUser) start(user); }
  else { currentUser = null; showLogin(); }
});

// PWA: cài lên màn hình chính + mở được khi mất mạng
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* bỏ qua */ }));
}
