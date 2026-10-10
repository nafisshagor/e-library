/* JCC E-Library — Application Core */
const CFG = {
  url: 'https://bssdpvpkqggmencrdnmm.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzc2RwdnBrcWdnbWVuY3Jkbm1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyOTcwOTMsImV4cCI6MjEwNjg3MzA5M30.iAjboj0u93DXA5uTTcnJOo5wwU49sXP1iCgOD5lftzI'
};
const sb = supabase.createClient(CFG.url, CFG.key);

/* Timeout guard: no stage may spin forever */
function withTimeout(p, ms, label) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

/* PDF.js worker */
const PDF_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const pdfReady = (async () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + 'pdf.worker.min.js';
  try {
    const res = await withTimeout(fetch(PDF_BASE + 'pdf.worker.min.js'), 8000, 'PDF worker fetch');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(await res.blob());
  } catch (err) { console.warn('PDF worker: using CDN URL directly.', err); }
})();

const ROLES = { cadet: 'Cadet', faculty: 'Faculty Member', principal: 'Principal', vice_principal: 'Vice-Principal', adjutant: 'Adjutant', admin: 'Admin' };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mail = (id) => id.toLowerCase() + '@jcc.library';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let me, books = [], saved = new Set(), recentIds = [], favs = new Set(), filter = 'all', sortMode = 'recent', q = '', pdf, cur, zoom = 1, channels = [], pageObserver, openToken = 0;
let detailBook = null, curPage = 1, bms = [], hlData = {}, hlColor = '#ffe45c', hlErase = false, heroKey = '';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

/* ---------- Icons ---------- */
const IC = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  hl: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  play: '<polygon points="7 4 20 12 7 20" fill="currentColor"/>',
  side: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M15 3v18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  glasses: '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M14 15a2 2 0 0 0-4 0M2.5 13 5 7c.7-1.3 1.4-2 3-2M21.5 13 19 7c-.7-1.3-1.5-2-3-2"/>',
  flask: '<path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3"/>',
  landmark: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2 3 7h18z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  star: '<polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9"/>',
  cap: '<path d="M22 10 12 5 2 10l10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'
};
const GI = { Fiction: 'book', 'Non-fiction': 'glasses', Classics: 'star', Science: 'flask', History: 'landmark', Biography: 'user', Textbook: 'cap' };
const ico = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n] || IC.book}</svg>`;
const hydrate = () => document.querySelectorAll('i[data-i]').forEach((i) => { i.outerHTML = ico(i.dataset.i, +i.dataset.s || 20); });
hydrate();

/* ---------- Theme (dark mode) with circular morph reveal ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('jcc:theme', t); } catch {}
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#0b1218' : '#7f9bab');
  document.querySelectorAll('.icon-btn[data-act="theme"]').forEach((b) => { b.innerHTML = ico(t === 'dark' ? 'sun' : 'moon'); });
  const item = document.querySelector('.theme-item');
  if (item) item.innerHTML = `${ico(t === 'dark' ? 'sun' : 'moon', 17)}<span id="theme-lbl">${t === 'dark' ? 'Light mode' : 'Dark mode'}</span>`;
}
function toggleTheme(btn) {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  if (!document.startViewTransition || reduced) return applyTheme(next);
  const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(() => applyTheme(next));
  vt.ready.then(() => document.documentElement.animate(
    { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
    { duration: 700, easing: 'cubic-bezier(.65,.05,.25,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
}
applyTheme(document.documentElement.dataset.theme || 'light');

/* ---------- Motion system: opacity + transform only (compositor-driven, no per-frame layout) ---------- */
const EASE = 'cubic-bezier(.22,1,.36,1)';
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
let showTok = 0;
const scrollMem = {};

function show(id, { morph = false, instant = false } = {}) {
  const all = [...document.querySelectorAll('.screen')];
  const from = all.find((s) => s.classList.contains('on') && !s.classList.contains('out')), next = $('#' + id);
  if (from === next) return;
  const t = ++showTok;
  if (from) scrollMem[from.id] = scrollY;
  const clean = () => all.forEach((s) => { if (s !== next) { s.classList.remove('on', 'out', 'ghost'); s.style.top = ''; } });
  const enter = () => {
    next.classList.remove('out', 'ghost', 'fade', 'inst');
    next.classList.add(morph ? 'fade' : instant ? 'inst' : 'rise', 'on');
    scrollTo(0, id === 'library' ? (scrollMem.library || 0) : 0);
    requestAnimationFrame(syncInks);
  };
  if (!from || instant) { clean(); enter(); return; }
  from.style.top = -scrollY + 'px';           // freeze position, then cross-fade it out on top
  from.classList.add('out', 'ghost');
  enter();
  setTimeout(() => { if (t === showTok) clean(); }, 320);
}

const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };

/* FLIP cover flight: the clone is rasterised once at the larger size and only transformed */
function flyCover(src, dst, ms = 640, srcRect) {
  if (!src || !dst || reduced) return Promise.resolve();
  const a = srcRect || rectOf(src), b = rectOf(dst);
  if (!a.width || !b.width) return Promise.resolve();
  const big = a.width >= b.width ? a : b;
  const c = src.cloneNode(true);
  c.classList.add('morph');
  Object.assign(c.style, { left: big.left + 'px', top: big.top + 'px', width: big.width + 'px', height: big.height + 'px' });
  const tf = (r) => `translate3d(${r.left - big.left}px, ${r.top - big.top}px, 0) scale(${r.width / big.width}, ${r.height / big.height})`;
  document.body.append(c);
  const prev = dst.style.visibility;
  dst.style.visibility = 'hidden';
  const done = () => { dst.style.visibility = prev; c.remove(); };
  try {
    return c.animate([{ transform: tf(a) }, { transform: tf(b) }], { duration: ms, easing: EASE, fill: 'both' }).finished.then(done, done);
  } catch { done(); return Promise.resolve(); }
}

/* Sliding indicator for pill navs */
function slideInk(nav) {
  const ink = nav && nav.querySelector('.ink'), on = nav && nav.querySelector('button.on');
  if (!ink || !on || !on.offsetWidth) return;
  const first = !ink.style.width;
  if (first) ink.style.transition = 'none';
  ink.style.width = on.offsetWidth + 'px';
  ink.style.transform = `translate3d(${on.offsetLeft}px,0,0)`;
  if (first) { void ink.offsetWidth; ink.style.transition = ''; }
}
function syncInks() { slideInk($('#nav')); slideInk($('#tabs')); }
addEventListener('resize', debounce(syncInks, 120));

/* ---------- Storage ---------- */
const idb = new Promise((res, rej) => {
  const r = indexedDB.open('jcc-lib', 2);
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.onblocked = () => console.warn('IndexedDB upgrade blocked by another open tab.');
});
const tx = async (mode, fn) => {
  const d = await idb;
  return new Promise((res, rej) => {
    const t = d.transaction('kv', mode), r = fn(t.objectStore('kv'));
    t.oncomplete = () => res(r && r.result);
    t.onerror = t.onabort = () => rej(t.error || new Error('IndexedDB transaction failed'));
  });
};
const soft = (p, fallback) => p.catch((e) => { console.warn('IndexedDB:', e); return fallback; });
const kv = {
  get: (k) => soft(tx('readonly', (s) => s.get(k)), undefined),
  set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
  del: (k) => soft(tx('readwrite', (s) => s.delete(k)), undefined),
  keys: () => soft(tx('readonly', (s) => s.getAllKeys()), [])
};
const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

async function devKey() {
  const name = 'key:' + me.id;
  let k = await kv.get(name);
  if (!k) { k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await kv.set(name, k); }
  return k;
}

/* ---------- UI helpers ---------- */
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => { t.animate({ opacity: [1, 0], transform: ['none', 'translateX(30px)'] }, { duration: 300 }).finished.then(() => t.remove(), () => t.remove()); }, 3700);
}
function beep() {
  try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .18); } catch {}
}
const err = (sel, m) => { $(sel).textContent = m; };

if ($('#spines')) {
  $('#spines').innerHTML = [58, 82, 66, 100, 74, 90, 62, 96, 70, 84, 60, 92, 78, 68, 88, 72].map((h, i) =>
    `<i style="--h:${h}%;--i:${i};--c:hsl(${[200, 205, 195, 210, 202, 198, 208, 192][i % 8]} 35% ${30 + (i % 4) * 8}%)"></i>`).join('');
}

/* DRM Guards */
document.addEventListener('contextmenu', (e) => { if ($('#reader').classList.contains('on')) e.preventDefault(); });
document.addEventListener('keydown', (e) => {
  const inReader = $('#reader').classList.contains('on') && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (inReader && (e.ctrlKey || e.metaKey) && ['s', 'p', 'u', 'c', 'a'].includes(e.key.toLowerCase())) e.preventDefault();
  if (inReader && e.key === 'F12') e.preventDefault();
  if (e.key === 'Escape' && $('#reader').classList.contains('reading')) toggleReading(false);
});

/* ---------- Auth ---------- */
document.querySelectorAll('[data-sw]').forEach((a) => a.onclick = (e) => {
  e.preventDefault();
  const to = $('#' + a.dataset.sw), from = a.dataset.sw === 'login' ? $('#register') : $('#login');
  from.classList.add('swap-out');
  setTimeout(() => { from.hidden = true; from.classList.remove('swap-out'); to.hidden = false; }, 220);
});

$('#login').onsubmit = async (e) => {
  e.preventDefault(); err('#l-err', '');
  const { error } = await sb.auth.signInWithPassword({ email: mail($('#l-id').value.trim()), password: $('#l-pw').value });
  if (error) return err('#l-err', navigator.onLine ? 'Invalid User ID or password.' : 'Offline mode: Sign in online first.');
  boot();
};

$('#register').onsubmit = async (e) => {
  e.preventDefault(); err('#r-err', '');
  const id = $('#r-id').value.trim(), pw = $('#r-pw').value;
  if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(id)) return err('#r-err', 'User ID: 3–20 alphanumeric chars, . _ - allowed.');
  if (pw !== $('#r-pw2').value) return err('#r-err', 'Passwords do not match.');
  const { error } = await sb.auth.signUp({
    email: mail(id), password: pw,
    options: { data: { user_id: id.toLowerCase(), full_name: $('#r-name').value.trim(), role: $('#r-role').value } }
  });
  if (error) return err('#r-err', /registered|exists/i.test(error.message) ? 'That User ID is already taken.' : error.message);
  boot();
};

document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'theme' || a.dataset.act === 'theme-item') return toggleTheme(a);
  if (a.dataset.act !== 'logout') return;
  channels.forEach((c) => sb.removeChannel(c));
  await kv.del('profile');
  await sb.auth.signOut({ scope: 'local' });
  location.reload();
});

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return show('auth');
  let { data: p, error: pe } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (p) {
    await kv.set('profile', p).catch(() => {});
  } else if (!pe && navigator.onLine) {
    await kv.del('profile');
    await sb.auth.signOut({ scope: 'local' });
    return show('auth');
  } else {
    const cached = await kv.get('profile');
    p = cached && cached.id === session.user.id ? cached : null;
  }
  if (!p) return show('auth');
  me = p;
  if (me.status === 'approved') return enter();
  show('pending');
  if (me.status === 'rejected') {
    $('#p-title').textContent = 'Access Declined';
    $('#p-text').textContent = 'Your request was not approved. Please visit the library admin office.';
    return;
  }
  const sub = sb.channel(`me:${me.id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${me.id}` }, (m) => {
      if (m.new.status !== 'pending') {
        toast(m.new.status === 'approved' ? 'Account approved! Welcome.' : 'Request declined.', m.new.status === 'approved' ? '' : 'err');
        boot();
      }
    })
    .subscribe((status) => { if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') setTimeout(boot, 3000); });
  channels.push(sub);
}

/* ---------- Catalog ---------- */
async function enter() {
  favs = new Set(jget(`fav:${me.id}`, []));
  paintMe();
  $('#admin-btn').hidden = me.role !== 'admin';
  $('#bell').hidden = me.role !== 'admin';
  await loadBooks();
  render();
  updateStats();
  show('library');
  if (me.role === 'admin') { watchSignups(); countPending(); }
}

async function loadBooks() {
  saved = new Set((await kv.keys()).filter((k) => String(k).startsWith(`pdf:${me.id}:`)).map((k) => k.split(':')[2]));
  const rawRecents = (await kv.get(`recents:${me.id}`)) || [];
  recentIds = rawRecents.map((item) => (typeof item === 'string' ? item : item.id));
  if (navigator.onLine) {
    const { data, error } = await sb.from('books').select('*').order('created_at', { ascending: false });
    if (!error && data) { books = data; await kv.set('catalog', data).catch(() => {}); }
  }
  if (!books.length) books = (await kv.get('catalog')) || [];
}

async function markRecentlyRead(bookId) {
  recentIds = [bookId, ...recentIds.filter((id) => id !== bookId)];
  await kv.set(`recents:${me.id}`, recentIds.map((id) => ({ id, ts: Date.now() })));
}

const hueOf = (t) => ([...t].reduce((a, c) => a + c.charCodeAt(0), 0) % 40) + 130;
const coverHTML = (b, cls = '') => b.cover
  ? `<div class="cv ${cls}" style="background-image:url(${b.cover})"></div>`
  : `<div class="cv gen ${cls}" style="--h:${hueOf(b.title)}"><b>${esc(b.title)}</b></div>`;

function renderHero() {
  const key = books.map((b) => b.id).join();
  if (key === heroKey) return;
  heroKey = key;
  const card = (b, cls, label) => `<article class="hero-card ${cls}" data-id="${b.id}" tabindex="0">
    <div class="hero-t"><small>${label}</small><h2>${esc(b.title)}</h2><span class="play"><i class="pdot">${ico('play', 11)}</i> Start reading</span></div>${coverHTML(b, 'hero-cv')}</article>`;
  if (!books.length) { $('#hero').innerHTML = '<article class="hero-card empty-hero"><div class="hero-t"><small>Welcome</small><h2>Your digital repository awaits.</h2></div></article>'; return; }
  const b1 = books[0], rest = books.slice(1), b2 = rest.length ? rest[Math.floor(Math.random() * rest.length)] : b1;
  $('#hero').innerHTML = card(b1, '', 'Latest addition') + card(b2, 'b', 'Recommended for you');
}

let chipSig = '';
function render(opts = {}) {
  const off = !navigator.onLine;
  $('#net').classList.toggle('off', off);
  $('#net span').textContent = off ? 'Offline' : 'Online';
  renderHero();

  const genres = [...new Set(books.map((b) => b.genre))];
  const cats = [['all', 'All Books', 'book'], ['recents', 'Recents', 'clock'], ['saved', 'Saved Offline', 'download'], ['fav', 'Favorites', 'heart'], ...genres.map((g) => [g, g, GI[g] || 'book'])];
  const sig = cats.map((c) => c.join()).join('|');
  if (sig !== chipSig) {            // only rebuild chips when the category set changes, so the active-state morph can animate
    chipSig = sig;
    $('#chips').innerHTML = cats.map(([k, l, i]) => `<button data-f="${esc(k)}">${ico(i, 20)}<span>${esc(l)}</span></button>`).join('');
  }
  $('#chips').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
  requestAnimationFrame(() => slideInk($('#nav')));
  const label = (cats.find((c) => c[0] === filter) || [])[1] || 'All Books';
  $('#sec-title').textContent = filter === 'all' ? 'Library Catalog' : genres.includes(filter) ? `Trending in ${label}` : label;

  let list = [];
  if (filter === 'recents') list = recentIds.map((id) => books.find((b) => b.id === id)).filter(Boolean);
  else list = books.filter((b) => filter === 'all' || (filter === 'saved' ? saved.has(b.id) : filter === 'fav' ? favs.has(b.id) : b.genre === filter));
  if (q) list = list.filter((b) => (b.title + ' ' + (b.author || '')).toLowerCase().includes(q));
  if (filter !== 'recents') {
    if (sortMode === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortMode === 'author') list.sort((a, b) => (a.author || '').localeCompare(b.author || ''));
    else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  $('#grid').classList.toggle('noanim', !!opts.quiet);
  $('#grid').innerHTML = list.length ? list.map((b, i) => {
    const lastPg = localStorage.getItem(`pg:${me.id}:${b.id}`);
    const yr = b.created_at ? new Date(b.created_at).getFullYear() : '';
    return `<article class="book ${off && !saved.has(b.id) ? 'dim' : ''}" data-id="${b.id}" tabindex="0" style="--i:${Math.min(i, 14)}">
      <div class="cv-wrap">${coverHTML(b)}
        ${saved.has(b.id) ? '<i class="sv">Offline</i>' : ''}
        <button class="heart ${favs.has(b.id) ? 'fav-on' : ''}" data-fav="${b.id}" aria-label="Favorite">${ico('heart', 16)}</button>
      </div>
      <h3>${esc(b.title)}</h3>
      <p>${esc(b.author || 'Unknown Author')}</p>
      <div class="meta-line"><span class="tag">${esc(b.genre)}</span><span>${lastPg ? 'p. ' + esc(lastPg) : yr}</span></div>
    </article>`;
  }).join('') : `<p class="empty">${filter === 'recents' ? 'No recently read books yet.' : filter === 'saved' ? 'No books saved for offline reading.' : filter === 'fav' ? 'No favorite books yet — tap the heart on any book.' : 'No matching books found.'}</p>`;
}

function updateStats() {
  if ($('#st-saved')) $('#st-saved').textContent = saved.size;
  if ($('#st-total')) $('#st-total').textContent = books.length;
}

const setFilter = (f) => { filter = f; render(); };
$('#chips').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) setFilter(b.dataset.f); };
$('#nav').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) setFilter(b.dataset.f); };
$('#sort').onchange = (e) => { sortMode = e.target.value; render(); };
$('#search').oninput = debounce((e) => { q = e.target.value.trim().toLowerCase(); render({ quiet: true }); }, 140);
$('#s-btn').onclick = () => { $('.sbox').classList.toggle('open'); $('#search').focus(); };

function toggleFav(id) {
  if (favs.has(id)) { favs.delete(id); toast('Removed from favorites.'); } else { favs.add(id); toast('Added to favorites ♥'); }
  jset(`fav:${me.id}`, [...favs]);
  document.querySelectorAll(`[data-fav="${id}"]`).forEach((h) => h.classList.toggle('fav-on', favs.has(id)));
  if (filter === 'fav') render();
  if (detailBook && detailBook.id === id) updDetail();
}
$('#grid').onclick = (e) => {
  const f = e.target.closest('[data-fav]');
  if (f) { e.stopPropagation(); return toggleFav(f.dataset.fav); }
  const c = e.target.closest('.book');
  if (c) openDetail(books.find((b) => b.id === c.dataset.id), c.querySelector('.cv'));
};
$('#hero').onclick = (e) => {
  const c = e.target.closest('.hero-card[data-id]');
  if (c) openDetail(books.find((b) => b.id === c.dataset.id), c.querySelector('.cv'));
};
const kbOpen = (e) => { if (e.key === 'Enter' && e.target.matches('.book,.hero-card')) e.target.click(); };
$('#grid').onkeydown = kbOpen; $('#hero').onkeydown = kbOpen;

addEventListener('online', () => { if (me?.status === 'approved') loadBooks().then(() => { render(); updateStats(); }); });
addEventListener('offline', () => me && render());

/* ---------- Book detail (cover morph) ---------- */
function updDetail() {
  const b = detailBook; if (!b) return;
  $('#d-fav').innerHTML = `${ico('heart', 17)} ${favs.has(b.id) ? 'Favorited' : 'Favorite'}`;
  $('#d-fav').classList.toggle('on', favs.has(b.id));
  $('#d-fav').classList.toggle('fav-on', favs.has(b.id));
  $('#d-save').innerHTML = `${ico('download', 17)} ${saved.has(b.id) ? 'Remove offline copy' : 'Save offline'}`;
}
function fillDetail(b) {
  detailBook = b;
  $('#d-cover').innerHTML = coverHTML(b);
  $('#d-genre').textContent = b.genre || '';
  $('#d-title').textContent = b.title;
  $('#d-author').textContent = b.author || 'Unknown Author';
  const lp = localStorage.getItem(`pg:${me.id}:${b.id}`), nb = jget(`bm:${me.id}:${b.id}`, []).length;
  $('#d-meta').innerHTML = [
    b.size ? `${(b.size / 1048576).toFixed(1)} MB` : '', b.created_at ? `Added ${new Date(b.created_at).toLocaleDateString()}` : '',
    lp ? `Last read: page ${esc(lp)}` : 'Not started', nb ? `${nb} bookmark${nb > 1 ? 's' : ''}` : ''
  ].filter(Boolean).map((s) => `<span>${s}</span>`).join('');
  $('#d-read').lastChild.textContent = lp ? ' Continue reading' : ' Read now';
  updDetail();
}
function openDetail(b, srcEl) {
  if (!b) return;
  fillDetail(b);
  const a = srcEl ? rectOf(srcEl) : null;
  show('detail', { morph: !!srcEl });
  const dst = $('#d-cover .cv');
  if (srcEl && dst && a) flyCover(srcEl, dst, 640, a);
}
function closeDetail() {
  const id = detailBook?.id, src = $('#d-cover .cv');
  show('library', { morph: true });
  const dst = id && (document.querySelector(`.book[data-id="${id}"] .cv`) || document.querySelector(`.hero-card[data-id="${id}"] .cv`));
  if (dst && src) flyCover(src, dst, 600);
}
$('#d-back').onclick = closeDetail;
$('#d-fav').onclick = () => detailBook && toggleFav(detailBook.id);
$('#d-save').onclick = async () => { if (detailBook) { await toggleOffline(detailBook); updDetail(); render(); } };
$('#d-read').onclick = () => detailBook && readFlow(detailBook);

/* Book-opening flow: cover lifts to centre, opens in 3D, the page grows into the reader.
   Every step is a transform/opacity animation, and the heavy reader build waits until it is over. */
async function readFlow(b) {
  if (!navigator.onLine && !saved.has(b.id)) return toast('Connect online once to view this book.', 'err');
  const cov = $('#d-cover .cv');
  if (reduced || !cov) return openBook(b);
  const r = rectOf(cov), vw = innerWidth, vh = innerHeight;
  const H = Math.min(vh * .6, 460), W = H * (r.width / r.height), L = (vw - W) / 2, T = (vh - H) / 2;
  const ov = document.createElement('div');
  ov.className = 'bk-ov';
  ov.innerHTML = '<div class="bk-book"><div class="bk-page"></div><div class="bk-cover"><div class="bk-front"></div><div class="bk-back"></div></div></div>';
  const book = ov.firstChild, cover = ov.querySelector('.bk-cover');
  ov.querySelector('.bk-front').append(cov.cloneNode(true));
  Object.assign(book.style, { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
  const start = `translate3d(${r.left - L}px, ${r.top - T}px, 0) scale(${r.width / W}, ${r.height / H})`;
  book.style.transform = start;
  document.body.append(ov);
  cov.style.visibility = 'hidden';
  let release; const ready = new Promise((res) => { release = res; });
  const o = (d, easing = EASE) => ({ duration: d, easing, fill: 'forwards' });
  const swing = 'cubic-bezier(.45,.05,.2,1)';
  openBook(b, ready);                         // download + parse overlap with the animation
  try {
    ov.animate({ opacity: [0, 1] }, o(240, 'ease-out'));
    await book.animate([{ transform: start }, { transform: 'translate3d(0,0,0) scale(1,1)' }], o(460)).finished;
    cover.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-172deg)' }], o(620, swing));
    await book.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${W / 2}px,0,0)` }], o(620, swing)).finished;
    cover.animate({ opacity: [1, 0] }, o(140, 'ease'));
    await book.animate([{ transform: `translate3d(${W / 2}px,0,0) scale(1,1)` }, { transform: `translate3d(${-L}px, ${-T}px, 0) scale(${vw / W}, ${vh / H})` }], o(440, 'cubic-bezier(.65,0,.25,1)')).finished;
    release();                                // page covers the viewport: reader is swapped in underneath
    await nextFrame();
    await ov.animate({ opacity: [1, 0] }, o(340, 'ease')).finished;
  } catch (e) { console.warn(e); release(); }
  ov.remove();
  cov.style.visibility = '';
}

/* ---------- PDF data ---------- */
async function fetchPdfData(b) {
  const key = `pdf:${me.id}:${b.id}`;
  const rec = await kv.get(key);
  if (rec) {
    try { return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, await devKey(), rec.data); }
    catch (e) { console.warn('Offline copy unreadable, re-downloading.', e); await kv.del(key); saved.delete(b.id); }
  }
  if (!navigator.onLine) throw new Error('You are offline and this book is not saved on this device.');
  let firstErr;
  try {
    const { data, error } = await withTimeout(sb.storage.from('books').download(b.path), 60000, 'Download');
    if (data) return await data.arrayBuffer();
    firstErr = error;
  } catch (e) { firstErr = e; }
  try {
    const { data, error } = await withTimeout(sb.storage.from('books').createSignedUrl(b.path, 300), 15000, 'Signed URL request');
    if (error) throw error;
    const r = await withTimeout(fetch(data.signedUrl), 60000, 'Signed URL download');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.arrayBuffer();
  } catch (e) { firstErr = firstErr || e; }
  throw new Error(firstErr?.message || 'Unable to download the PDF from the server.');
}

async function openPdf(buf) {
  await pdfReady;
  const attempt = async () => {
    const task = pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), cMapUrl: PDF_BASE + 'cmaps/', cMapPacked: true, isEvalSupported: false });
    try { return await withTimeout(task.promise, 20000, 'PDF parsing'); }
    catch (e) { task.destroy().catch(() => {}); throw e; }
  };
  try { return await attempt(); }
  catch (e) {
    console.warn('PDF parse failed, retrying with CDN worker.', e);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + 'pdf.worker.min.js';
    return await attempt();
  }
}
const setLoadMsg = (m) => { const el = $('#ld-msg'); if (el) el.textContent = m; };

/* ---------- Reader ---------- */
async function openBook(b, ready) {
  if (!navigator.onLine && !saved.has(b.id)) return toast('Connect online once to view this book.', 'err');
  const token = ++openToken;
  if (pdf) { pdf.destroy(); pdf = null; }
  cur = b; zoom = 1; curPage = 1;
  bms = jget(bmKey(), []); hlData = jget(hlKey(), {});
  if (!ready) show('reader');
  $('#reader').classList.toggle('reading', localStorage.getItem('jcc:rm') === '1');
  $('#r-title').textContent = b.title;
  $('#pg').textContent = 'Loading document...';
  $('#pages').innerHTML = '<div class="load-spinner"><div class="spin"></div><p id="ld-msg">Opening Document…</p></div>';
  updSave(); updBm(); loadNotes();
  markRecentlyRead(b.id).catch(() => {});
  const reveal = async () => { if (ready) { await ready; if (token === openToken) show('reader', { instant: true }); } };
  try {
    setLoadMsg('Downloading document…');
    const buf = await fetchPdfData(b);
    if (token !== openToken) return;
    setLoadMsg('Preparing pages…');
    const doc = await openPdf(buf);
    if (token !== openToken) { doc.destroy(); return; }
    pdf = doc;
    await reveal();
    if (token !== openToken) return;
    await nextFrame();
    await build();
  } catch (x) {
    if (token !== openToken) return;
    console.error('PDF Open Error:', x);
    await reveal();
    $('#pg').textContent = 'Failed to load';
    $('#pages').innerHTML = `<div class="load-spinner fail"><p>This document could not be opened.</p><small>${esc(x.message || x)}</small><button class="btn dark" id="r-retry">Try Again</button></div>`;
    $('#r-retry').onclick = () => openBook(b);
  }
}

function pageBaseWidth(box) {
  const cs = getComputedStyle(box);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return Math.max(280, (box.clientWidth || window.innerWidth - 320) - pad);
}

/* Highlight layer */
const hlKey = () => `hl:${me.id}:${cur.id}`;
function drawHL(layer) {
  const n = layer.dataset.n;
  layer.innerHTML = (hlData[n] || []).map((h, i) => `<div class="hl" data-i="${i}" style="left:${h.x * 100}%;top:${h.y * 100}%;width:${h.w * 100}%;height:${h.h * 100}%;background:${h.c}"></div>`).join('');
}
function attachLayer(el, n) {
  const layer = document.createElement('div');
  layer.className = 'hl-layer'; layer.dataset.n = n;
  drawHL(layer);
  el.append(layer);
}

async function renderPage(el) {
  if (!pdf || !el || el.dataset.rendered || el.dataset.rendering) return;
  el.dataset.rendering = 'true';
  const pageNum = +el.dataset.n;
  try {
    const pg = await pdf.getPage(pageNum);
    const viewport0 = pg.getViewport({ scale: 1 });
    const box = $('#pages');
    const scale = (pageBaseWidth(box) * zoom) / (viewport0.width || 600);
    const vp = pg.getViewport({ scale });
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    dpr = Math.max(.5, Math.min(dpr, Math.sqrt(6e6 / (vp.width * vp.height))));   // stay inside mobile canvas limits when zoomed
    const renderVp = pg.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(renderVp.width);
    canvas.height = Math.floor(renderVp.height);
    canvas.style.width = Math.floor(vp.width) + 'px';
    canvas.style.height = Math.floor(vp.height) + 'px';
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    el.style.width = Math.floor(vp.width) + 'px';
    el.style.height = Math.floor(vp.height) + 'px';
    el.style.background = '#ffffff';
    el.replaceChildren(canvas);
    attachLayer(el, pageNum);
    await pg.render({ canvasContext: ctx, viewport: renderVp }).promise;
    el.dataset.rendered = 'true';
  } catch (err) {
    console.error(`Page ${pageNum} render error:`, err);
  } finally { delete el.dataset.rendering; }
}

/* free canvas memory for pages far from the viewport (keeps phones fast) */
function releasePage(el) {
  if (!el.dataset.rendered) return;
  el.replaceChildren();
  delete el.dataset.rendered;
}

let shownPg = 0;
async function build() {
  shownPg = 0;
  if (!pdf) return;
  const box = $('#pages');
  box.innerHTML = '';
  const first = await pdf.getPage(1);
  const viewport0 = first.getViewport({ scale: 1 });
  const targetWidth = pageBaseWidth(box) * zoom;
  const scale = targetWidth / (viewport0.width || 600);
  const targetHeight = (viewport0.height || 800) * scale;
  if (pageObserver) pageObserver.disconnect();
  const io = pageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.isIntersecting ? renderPage(entry.target) : releasePage(entry.target));
  }, { root: box, rootMargin: '1200px 0px' });
  for (let n = 1; n <= pdf.numPages; n++) {
    const d = document.createElement('div');
    d.className = 'pg'; d.dataset.n = n;
    d.style.cssText = `flex:none; width:${Math.floor(targetWidth)}px; height:${Math.floor(targetHeight)}px; background:#ffffff; margin:20px auto; display:flex; align-items:center; justify-content:center; color:#888; font-size:14px;`;
    d.textContent = `Loading page ${n}…`;
    box.append(d);
    io.observe(d);
  }
  const start = +localStorage.getItem(`pg:${me.id}:${cur.id}`) || 1;
  const targetEl = box.children[start - 1] || box.children[0];
  if (targetEl) { renderPage(targetEl); box.scrollTop = Math.max(0, targetEl.offsetTop - 20); }
  track();
}

function track() {
  if (!pdf) return;
  const box = $('#pages'), kids = box.children, mid = box.scrollTop + box.clientHeight / 3;
  let lo = 0, hi = kids.length - 1;               // binary search instead of walking every page
  while (lo < hi) { const m = (lo + hi) >> 1; if (kids[m].offsetTop + kids[m].offsetHeight > mid) hi = m; else lo = m + 1; }
  const n = +(kids[lo] && kids[lo].dataset.n) || 1;
  if (n === shownPg) return;
  shownPg = curPage = n;
  $('#pg').textContent = `Page ${n} of ${pdf.numPages} (${Math.round((n / pdf.numPages) * 100)}%)`;
  try { localStorage.setItem(`pg:${me.id}:${cur.id}`, n); } catch {}
  updBm(true);
}

let trackQ = false;
$('#pages').onscroll = () => { if (!pdf || trackQ) return; trackQ = true; requestAnimationFrame(() => { trackQ = false; track(); }); };
$('#z-in').onclick = () => { if (pdf && zoom < 2.2) { zoom += 0.2; build(); } };
$('#z-out').onclick = () => { if (pdf && zoom > 0.6) { zoom -= 0.2; build(); } };

function closeReader() {
  openToken++;
  if (pageObserver) pageObserver.disconnect();
  if (pdf) { pdf.destroy(); pdf = null; }
  $('#pages').innerHTML = '';
  $('#lens').classList.remove('show');
  if (cur) { fillDetail(cur); }
  show('detail');
  render();
}
$('#r-back').onclick = closeReader;

/* Offline save */
function updSave() { $('#r-save').textContent = saved.has(cur.id) ? 'Delete Offline Copy' : 'Save Offline'; }
async function toggleOffline(b) {
  const k = `pdf:${me.id}:${b.id}`;
  if (saved.has(b.id)) { await kv.del(k); saved.delete(b.id); toast('Offline copy removed.'); updateStats(); return; }
  try {
    toast('Storing offline copy...');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await fetchPdfData(b);
    await kv.set(k, { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await devKey(), data) });
    saved.add(b.id); toast('Saved offline successfully!'); updateStats();
  } catch { toast('Unable to save offline. Check connection.', 'err'); }
}
$('#r-save').onclick = async () => { await toggleOffline(cur); updSave(); };

/* ---------- Bookmarks ---------- */
const bmKey = () => `bm:${me.id}:${cur.id}`;
function updBm(light) {
  $('#t-bm').classList.toggle('on', bms.includes(curPage));
  if (light === true && $('#bm-list').dataset.sig === bms.join()) return;
  $('#bm-list').dataset.sig = bms.join();
  $('#bm-list').innerHTML = bms.length
    ? bms.map((p) => `<span class="bmchip" data-p="${p}">${ico('bookmark', 13)} Page ${p}<b data-x="${p}" title="Remove">×</b></span>`).join('')
    : '<p class="empty">No bookmarks yet. Tap the bookmark icon.</p>';
}
function goPage(p) {
  const el = $('#pages').children[p - 1];
  if (el) $('#pages').scrollTo({ top: el.offsetTop - 20, behavior: 'smooth' });
}
$('#t-bm').onclick = () => {
  if (!pdf) return;
  const i = bms.indexOf(curPage);
  if (i < 0) { bms.push(curPage); toast(`Bookmarked page ${curPage}`); } else { bms.splice(i, 1); toast(`Bookmark removed (page ${curPage})`); }
  bms.sort((a, b) => a - b); jset(bmKey(), bms); updBm();
};
$('#bm-list').onclick = (e) => {
  const x = e.target.closest('[data-x]');
  if (x) { bms = bms.filter((p) => p !== +x.dataset.x); jset(bmKey(), bms); return updBm(); }
  const c = e.target.closest('[data-p]');
  if (c) goPage(+c.dataset.p);
};

/* ---------- Highlighter ---------- */
const setTool = (cls, on) => $('#reader').classList.toggle(cls, on);
$('#t-hl').onclick = () => {
  const on = !$('#reader').classList.contains('hl-on');
  setTool('hl-on', on); $('#t-hl').classList.toggle('on', on);
  if (!on) { hlErase = false; setTool('hl-erase', false); $('#hl-erase').classList.remove('on'); }
  else if (!$('#reader').classList.contains('mag')) toast('Drag over the text to highlight.');
};
$('#hl-pop').onclick = (e) => {
  const c = e.target.closest('[data-c]');
  if (c) {
    hlColor = c.dataset.c; hlErase = false; setTool('hl-erase', false); $('#hl-erase').classList.remove('on');
    document.querySelectorAll('.sw-c').forEach((s) => s.classList.toggle('on', s === c));
  }
  if (e.target.closest('#hl-erase')) { hlErase = !hlErase; setTool('hl-erase', hlErase); $('#hl-erase').classList.toggle('on', hlErase); }
};
let drag = null;
$('#pages').addEventListener('pointerdown', (e) => {
  if (!$('#reader').classList.contains('hl-on')) return;
  const layer = e.target.closest('.hl-layer');
  if (!layer) return;
  const n = layer.dataset.n;
  if (hlErase) {
    const h = e.target.closest('.hl');
    if (h) { (hlData[n] || []).splice(+h.dataset.i, 1); jset(hlKey(), hlData); drawHL(layer); }
    return;
  }
  e.preventDefault();
  const r = layer.getBoundingClientRect(), ghost = document.createElement('div');
  ghost.className = 'hl'; ghost.style.background = hlColor; ghost.style.animation = 'none';
  layer.append(ghost);
  layer.setPointerCapture(e.pointerId);
  drag = { layer, r, n, x0: (e.clientX - r.left) / r.width, y0: (e.clientY - r.top) / r.height, ghost };
});
$('#pages').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { r, x0, y0, ghost } = drag;
  const x1 = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y1 = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  drag.box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  Object.assign(ghost.style, { left: drag.box.x * 100 + '%', top: drag.box.y * 100 + '%', width: drag.box.w * 100 + '%', height: drag.box.h * 100 + '%' });
});
const endDrag = () => {
  if (!drag) return;
  const { layer, n, box } = drag; drag = null;
  if (box && box.w > .01 && box.h > .004) { (hlData[n] = hlData[n] || []).push({ ...box, c: hlColor }); jset(hlKey(), hlData); }
  drawHL(layer);
};
addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);

/* ---------- Magnifier ---------- */
const lens = $('#lens'), lctx = lens.querySelector('canvas').getContext('2d'), LS = 190, MZ = 2.5;
$('#t-mag').onclick = () => {
  const on = !$('#reader').classList.contains('mag');
  setTool('mag', on); $('#t-mag').classList.toggle('on', on);
  if (!on) lens.classList.remove('show'); else toast('Move over a page to magnify.');
};
$('#pages').addEventListener('pointermove', (e) => {
  if (!$('#reader').classList.contains('mag') || e.pointerType === 'touch' && drag) return;
  const cv = e.target.closest?.('.pg')?.querySelector('canvas');
  if (!cv) return lens.classList.remove('show');
  const r = cv.getBoundingClientRect(), k = cv.width / r.width;
  const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k, s = (LS / MZ) * k;
  lens.style.transform = `translate(${e.clientX - LS / 2}px,${e.clientY - LS / 2}px)`;
  lctx.fillStyle = '#fff'; lctx.fillRect(0, 0, 380, 380);
  lctx.filter = getComputedStyle(cv).filter;
  lctx.drawImage(cv, x - s / 2, y - s / 2, s, s, 0, 0, 380, 380);
  lctx.filter = 'none';
  lens.classList.add('show');
});
$('#pages').addEventListener('pointerleave', () => lens.classList.remove('show'));

/* ---------- Reading mode & sidebar ---------- */
function toggleReading(on = !$('#reader').classList.contains('reading')) {
  setTool('reading', on); setTool('peek', false);
  $('#t-read').classList.toggle('on', on);
  try { localStorage.setItem('jcc:rm', on ? '1' : '0'); } catch {}
  if (on) toast('Reading mode on — move the mouse to the top for tools. Esc to exit.');
  if (pdf) setTimeout(build, 520);
}
$('#t-read').onclick = () => toggleReading();
$('#r-exit').onclick = () => toggleReading(false);
$('#t-side').onclick = () => { setTool('noside', !$('#reader').classList.contains('noside')); if (pdf) setTimeout(build, 520); };
addEventListener('mousemove', (e) => { const r = $('#reader'); if (r.classList.contains('reading')) r.classList.toggle('peek', e.clientY < 70); });

/* ---------- Notes ---------- */
function loadNotes() { $('#r-notes').value = localStorage.getItem(`note:${me.id}:${cur.id}`) || ''; }
$('#r-notes').oninput = (e) => localStorage.setItem(`note:${me.id}:${cur.id}`, e.target.value);


/* ---------- Admin ---------- */
$('#admin-btn').onclick = () => { show('admin'); loadAdmin(); };
$('#adm-back').onclick = () => show('library');
function selectTab(id) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === id));
  document.querySelectorAll('.tab').forEach((p) => p.classList.toggle('on', p.id === id));
  slideInk($('#tabs'));
}
$('#tabs').onclick = (e) => {
  const btn = e.target.closest('button[data-t]');
  if (!btn || btn.classList.contains('on')) return;
  const id = btn.dataset.t, wrap = $('#t-wrap'), root = document.documentElement;
  if (document.startViewTransition && !reduced && !root.classList.contains('vt-tab')) {
    root.classList.add('vt-tab');
    wrap.style.viewTransitionName = 'tabpanel';        // the panel container morphs size + cross-fades
    const vt = document.startViewTransition(() => selectTab(id));
    vt.finished.finally(() => { root.classList.remove('vt-tab'); wrap.style.viewTransitionName = ''; });
  } else {
    selectTab(id);
    const p = $('#' + id); p.classList.add('flip'); setTimeout(() => p.classList.remove('flip'), 520);
  }
};
$('#bell').onclick = () => { show('admin'); loadAdmin(); selectTab('t-req'); };

function watchSignups() {
  const sub = sb.channel('signups-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, (m) => {
      toast(`New Access Request: ${m.new.full_name} (${ROLES[m.new.role] || m.new.role})`);
      beep(); countPending(); loadAdmin();
    })
    .subscribe();
  channels.push(sub);
}

async function countPending() {
  const { count } = await sb.from('profiles').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  for (const el of [$('#adm-n'), $('#ap-n')]) { if (el) { el.textContent = count; el.hidden = !count; } }
}

async function loadAdmin() {
  const { data: us = [] } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  const pend = us.filter((u) => u.status === 'pending');
  $('#pending-list').innerHTML = pend.length ? pend.map((u) => `
    <div class="row">
      <div><h4>${esc(u.full_name)}</h4><p>${esc(u.user_id)} · ${ROLES[u.role] || u.role}</p></div>
      <div class="act">
        <button class="btn dark" data-a="approved" data-id="${u.id}">Approve</button>
        <button class="btn red" data-a="rejected" data-id="${u.id}">Reject</button>
      </div>
    </div>`).join('') : '<p class="empty">No pending access requests.</p>';

  $('#users-list').innerHTML = us.filter((u) => u.status !== 'pending' && u.id !== me.id).map((u) => `
    <div class="row">
      <div><h4>${esc(u.full_name)}</h4><p>${esc(u.user_id)}</p></div>
      <div class="act">
        <span class="st ${u.status}">${u.status}</span>
        <select data-role="${u.id}">
          ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        ${u.status === 'approved' ? `<button class="btn red" data-a="rejected" data-id="${u.id}">Revoke</button>` : `<button class="btn" data-a="approved" data-id="${u.id}">Restore</button>`}
        <button class="btn red" data-del-user="${u.id}" data-name="${esc(u.full_name)}">Delete</button>
      </div>
    </div>`).join('') || '<p class="empty">No active registered users.</p>';

  $('#books-list').innerHTML = books.map((b) => `
    <div class="row">
      <div><h4>${esc(b.title)}</h4><p>${esc(b.author || 'N/A')} · ${esc(b.genre)} · ${(b.size / (1024 * 1024)).toFixed(1)} MB</p></div>
      <button class="btn red" data-del="${b.id}">Delete</button>
    </div>`).join('') || '<p class="empty">No uploaded books in repository.</p>';
  countPending();
}

$('#admin').addEventListener('click', async (e) => {
  const { a, id, del, delUser, name } = e.target.dataset;
  if (a) {
    const { error } = await sb.from('profiles').update({ status: a }).eq('id', id);
    if (error) return toast(error.message, 'err');
    toast(a === 'approved' ? 'User approved.' : 'Access revoked.');
    loadAdmin();
  }
  if (delUser) {
    if (!confirm(`Permanently delete the account of "${name}"?\nTheir login is removed and they must register again. This cannot be undone.`)) return;
    e.target.disabled = true;
    const { error } = await sb.rpc('admin_delete_user', { target: delUser });
    if (error) {
      e.target.disabled = false;
      return toast(/admin_delete_user|schema cache/i.test(error.message) ? 'Delete function missing. Run the updated schema.sql in Supabase.' : 'Delete failed: ' + error.message, 'err');
    }
    toast('Account deleted.');
    await loadAdmin();
  }
  if (del && confirm('Permanently delete this book from the server?')) {
    const b = books.find((x) => x.id === del);
    await sb.storage.from('books').remove([b.path]);
    await sb.from('books').delete().eq('id', del);
    heroKey = '';
    await loadBooks();
    loadAdmin(); render();
    toast('Book deleted.');
  }
});

$('#admin').addEventListener('change', async (e) => {
  if (e.target.dataset.role) {
    await sb.from('profiles').update({ role: e.target.value }).eq('id', e.target.dataset.role);
    toast('Role updated.');
  }
});

$('#up').onsubmit = async (e) => {
  e.preventDefault();
  const f = $('#u-file').files[0], btn = $('#u-btn');
  if (!f || f.type !== 'application/pdf') return toast('Please select a valid PDF file.', 'err');
  if (f.size > 50 * 1024 * 1024) return toast('File size exceeds maximum limit of 50 MB.', 'err');
  btn.disabled = true;
  btn.textContent = 'Processing PDF...';
  try {
    const fileData = new Uint8Array(await f.arrayBuffer());
    const d = await pdfjsLib.getDocument({ data: fileData }).promise;
    const pg = await d.getPage(1);
    const v = pg.getViewport({ scale: 320 / pg.getViewport({ scale: 1 }).width });
    const c = document.createElement('canvas');
    c.width = v.width; c.height = v.height;
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: v }).promise;
    const path = crypto.randomUUID() + '.pdf';
    btn.textContent = 'Uploading to Secure Storage...';
    const up = await sb.storage.from('books').upload(path, f, { contentType: 'application/pdf' });
    if (up.error) throw up.error;
    const ins = await sb.from('books').insert({
      title: $('#u-title').value.trim(), author: $('#u-author').value.trim(), genre: $('#u-genre').value,
      path, cover: c.toDataURL('image/jpeg', .75), size: f.size
    });
    if (ins.error) throw ins.error;
    toast('Book successfully published.');
    e.target.reset();
    heroKey = '';
    await loadBooks();
    loadAdmin(); render();
  } catch (x) { toast(x.message || 'Book publication failed.', 'err'); }
  btn.disabled = false;
  btn.textContent = 'Upload Book';
};


/* ---------- Profile (name, photo, password) ---------- */
function paintAv(el, name, img) {
  if (img && img.startsWith('data:image/')) { el.style.backgroundImage = `url('${img}')`; el.textContent = ''; }
  else { el.style.backgroundImage = ''; el.textContent = (name || '?').trim().charAt(0).toUpperCase(); }
}
function paintMe() {
  $('#who').textContent = me.full_name;
  $('#role').textContent = ROLES[me.role] || me.role;
  paintAv($('#av'), me.full_name, me.avatar);
}
let pfAvatar = null;
$('#prof-btn').onclick = () => {
  pfAvatar = me.avatar || null;
  $('#pf-name').value = me.full_name; $('#pf-uid').value = me.user_id; $('#pf-role').value = ROLES[me.role] || me.role;
  $('#pf-pw').value = ''; $('#pf-pw2').value = ''; $('#pf-err').textContent = '';
  document.querySelector('.pf-pw').open = false;
  paintAv($('#pf-av'), me.full_name, pfAvatar);
  $('#prof-dlg').showModal();
};
$('#pf-cancel').onclick = () => $('#prof-dlg').close();
$('#prof-dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#pf-pick').onclick = () => $('#pf-file').click();
$('#pf-rm').onclick = () => { pfAvatar = null; paintAv($('#pf-av'), $('#pf-name').value, null); };
$('#pf-name').oninput = (e) => { if (!pfAvatar) paintAv($('#pf-av'), e.target.value, null); };
$('#pf-file').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f), S = 192, m = Math.min(bmp.width, bmp.height);
    const c = document.createElement('canvas'); c.width = c.height = S;
    c.getContext('2d').drawImage(bmp, (bmp.width - m) / 2, (bmp.height - m) / 2, m, m, 0, 0, S, S);
    pfAvatar = c.toDataURL('image/jpeg', .82);          // ~8 KB, stored with the profile
    paintAv($('#pf-av'), '', pfAvatar);
  } catch { toast('Could not read that image.', 'err'); }
};
$('#prof-form').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('#pf-name').value.trim(), pw = $('#pf-pw').value, btn = e.submitter || e.target.querySelector('.btn.dark');
  if (name.length < 2) return err('#pf-err', 'Please enter your full name.');
  if (pw && pw.length < 6) return err('#pf-err', 'Password must be at least 6 characters.');
  if (pw && pw !== $('#pf-pw2').value) return err('#pf-err', 'Passwords do not match.');
  btn.disabled = true; err('#pf-err', '');
  try {
    const { error } = await sb.rpc('update_my_profile', { p_name: name, p_avatar: pfAvatar });
    if (error) return err('#pf-err', /update_my_profile|schema cache/i.test(error.message) ? 'Profile editing needs the updated schema.sql in Supabase.' : error.message);
    if (pw) {
      const r = await sb.auth.updateUser({ password: pw });
      if (r.error) return err('#pf-err', 'Profile saved, but password was not changed: ' + r.error.message);
    }
    me = { ...me, full_name: name, avatar: pfAvatar };
    kv.set('profile', me).catch(() => {});
    paintMe();
    $('#prof-dlg').close();
    toast(pw ? 'Profile and password updated.' : 'Profile updated.');
  } finally { btn.disabled = false; }
};

/* ---------- Account menu ---------- */
const menu = $('#menu'), acct = $('#acct');
const setMenu = (on) => { menu.classList.toggle('open', on); acct.setAttribute('aria-expanded', on); };
acct.onclick = (e) => { e.stopPropagation(); setMenu(!menu.classList.contains('open')); };
menu.onclick = (e) => { if (e.target.closest('[role="menuitem"]')) setMenu(false); };
document.addEventListener('click', (e) => { if (!e.target.closest('.acct-wrap')) setMenu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

/* ---------- Login page: slow photo cross-fade (pre-blurred images, no runtime blur) ---------- */
(() => {
  const layers = [...document.querySelectorAll('#auth-bg i')]; let k = 0;
  setInterval(() => {
    if (document.hidden || !$('#auth').classList.contains('on')) return;
    layers[k].classList.remove('on'); k = (k + 1) % layers.length; layers[k].classList.add('on');
  }, 9000);
})();
/* liquid-glass highlight follows the pointer (one rAF-throttled CSS variable) */
document.querySelectorAll('.liquid').forEach((c) => {
  let raf = 0;
  c.addEventListener('pointermove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0; const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
});

boot();