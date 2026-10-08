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
  cap: '<path d="M22 10 12 5 2 10l10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>'
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
  document.querySelectorAll('[data-act="theme"]').forEach((b) => { b.innerHTML = ico(t === 'dark' ? 'sun' : 'moon'); });
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

/* ---------- Page-change + morph transitions ---------- */
let showTok = 0;
function show(id, { morph = false } = {}) {
  const all = [...document.querySelectorAll('.screen')];
  const cur0 = all.find((s) => s.classList.contains('on') && !s.classList.contains('out')), next = $('#' + id);
  if (cur0 === next) return;
  const t = ++showTok;
  const clean = () => all.forEach((s) => { if (s !== next) { s.classList.remove('on', 'out', 'ghost'); s.style.top = ''; } });
  const enter = () => { next.classList.remove('out', 'ghost', 'fade'); if (morph) next.classList.add('fade'); next.classList.add('on'); scrollTo(0, 0); };
  if (!cur0) { clean(); enter(); return; }
  cur0.classList.add('out');
  if (morph) {
    cur0.style.top = -scrollY + 'px'; cur0.classList.add('ghost');
    enter();
    setTimeout(() => { if (t === showTok) clean(); }, 520);
  } else setTimeout(() => { if (t === showTok) { clean(); enter(); } }, 270);
}

const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
/* Morph (FLIP) a cover from one element to another */
function flyCover(src, dst, ms = 750) {
  if (!src || !dst || reduced) return Promise.resolve();
  const a = rectOf(src), b = rectOf(dst);
  const c = src.cloneNode(true);
  c.classList.add('morph');
  const px = (r) => ({ left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  Object.assign(c.style, px(a));
  document.body.append(c);
  const dstPrev = dst.style.visibility;
  dst.style.visibility = 'hidden';
  const done = () => { dst.style.visibility = dstPrev; c.remove(); };
  try {
    return c.animate([px(a), px(b)], { duration: ms, easing: 'cubic-bezier(.65,.05,.25,1)', fill: 'forwards' }).finished.then(done, done);
  } catch { done(); return Promise.resolve(); }
}

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
  if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u', 'c', 'a', 'i', 'j'].includes(e.key.toLowerCase())) e.preventDefault();
  if (e.key === 'F12') e.preventDefault();
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
  if (a.dataset.act === 'theme') return toggleTheme(a);
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
  $('#who').textContent = me.full_name;
  $('#av').textContent = (me.full_name || '?').trim().charAt(0).toUpperCase();
  $('#role').textContent = ROLES[me.role] || me.role;
  $('#admin-btn').hidden = me.role !== 'admin';
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

function render() {
  const off = !navigator.onLine;
  $('#net').classList.toggle('off', off);
  $('#net span').textContent = off ? 'Offline' : 'Online';
  renderHero();

  const genres = [...new Set(books.map((b) => b.genre))];
  const cats = [['all', 'All Books', 'book'], ['recents', 'Recents', 'clock'], ['saved', 'Saved Offline', 'download'], ['fav', 'Favorites', 'heart'], ...genres.map((g) => [g, g, GI[g] || 'book'])];
  $('#chips').innerHTML = cats.map(([k, l, i]) => `<button data-f="${esc(k)}" class="${filter === k ? 'on' : ''}">${ico(i, 20)}<span>${esc(l)}</span></button>`).join('');
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
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
$('#search').oninput = (e) => { q = e.target.value.trim().toLowerCase(); render(); };
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
  const dst = $('#d-cover .cv');
  const src = srcEl;
  const was = src ? src.cloneNode(true) : null;
  const a = src ? rectOf(src) : null;
  show('detail', { morph: !!src });
  if (src && dst && was) {
    // fly the clone from the original rect (src is still laid out under the ghosting screen)
    const hold = { getBoundingClientRect: () => ({ left: a.left, top: a.top, width: a.width, height: a.height }), cloneNode: () => was.cloneNode(true) };
    flyCover(hold, dst);
  }
}
function closeDetail() {
  const id = detailBook?.id, src = $('#d-cover .cv');
  show('library', { morph: true });
  const dst = id && document.querySelector(`.book[data-id="${id}"] .cv`);
  if (dst && src) flyCover(src, dst, 650);
  else if (id) { const h = document.querySelector(`.hero-card[data-id="${id}"] .cv`); if (h && src) flyCover(src, h, 650); }
}
$('#d-back').onclick = closeDetail;
$('#d-fav').onclick = () => detailBook && toggleFav(detailBook.id);
$('#d-save').onclick = async () => { if (detailBook) { await toggleOffline(detailBook); updDetail(); render(); } };
$('#d-read').onclick = () => detailBook && readFlow(detailBook);

/* Book-opening morph: cover lifts, opens in 3D, page expands into the reader */
async function readFlow(b) {
  if (!navigator.onLine && !saved.has(b.id)) return toast('Connect online once to view this book.', 'err');
  const cov = $('#d-cover .cv');
  if (reduced || !cov) return openBook(b, true);
  const r = rectOf(cov), vh = innerHeight, H = Math.min(vh * .66, 520), W = H * (r.width / r.height);
  const ov = document.createElement('div');
  ov.className = 'bk-ov';
  ov.innerHTML = '<div class="bk-book"><div class="bk-page"></div><div class="bk-cover"><div class="bk-front"></div><div class="bk-back"></div></div></div>';
  const book = ov.firstChild, cover = ov.querySelector('.bk-cover');
  ov.querySelector('.bk-front').append(cov.cloneNode(true));
  const px = (l, t, w, h) => ({ left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
  Object.assign(book.style, px(r.left, r.top, r.width, r.height));
  document.body.append(ov);
  cov.style.visibility = 'hidden';
  const E = 'cubic-bezier(.65,.05,.25,1)', fw = (d, easing = E) => ({ duration: d, easing, fill: 'forwards' });
  try {
    ov.animate({ opacity: [0, 1] }, fw(300, 'ease'));
    await book.animate([px(r.left, r.top, r.width, r.height), px((innerWidth - W) / 2, (vh - H) / 2, W, H)], fw(420)).finished;
    cover.animate({ transform: ['rotateY(0deg)', 'rotateY(-172deg)'] }, fw(700));
    await book.animate([px((innerWidth - W) / 2, (vh - H) / 2, W, H), px(innerWidth / 2, (vh - H) / 2, W, H)], fw(700)).finished;
    cover.animate({ opacity: [1, 0] }, fw(200, 'ease'));
    openBook(b, true);
    await book.animate([px(innerWidth / 2, (vh - H) / 2, W, H), px(0, 0, innerWidth, vh)], fw(480)).finished;
    await ov.animate({ opacity: [1, 0] }, fw(380, 'ease')).finished;
  } catch (e) { console.warn(e); }
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
async function openBook(b, morph = false) {
  if (!navigator.onLine && !saved.has(b.id)) return toast('Connect online once to view this book.', 'err');
  const token = ++openToken;
  if (pdf) { pdf.destroy(); pdf = null; }
  cur = b; zoom = 1; curPage = 1;
  bms = jget(bmKey(), []); hlData = jget(hlKey(), {});
  show('reader', { morph });
  $('#reader').classList.toggle('reading', localStorage.getItem('jcc:rm') === '1');
  $('#r-title').textContent = b.title;
  $('#pg').textContent = 'Loading document...';
  $('#pages').innerHTML = '<div class="load-spinner"><div class="spin"></div><p id="ld-msg">Opening Document…</p></div>';
  updSave(); updBm(); watermark(); loadNotes();
  markRecentlyRead(b.id).catch(() => {});
  try {
    setLoadMsg('Downloading document…');
    const buf = await fetchPdfData(b);
    if (token !== openToken) return;
    setLoadMsg('Preparing pages…');
    const doc = await openPdf(buf);
    if (token !== openToken) { doc.destroy(); return; }
    pdf = doc;
    await build();
  } catch (x) {
    if (token !== openToken) return;
    console.error('PDF Open Error:', x);
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

async function build() {
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
    entries.forEach((entry) => { if (entry.isIntersecting) renderPage(entry.target); });
  }, { root: box, rootMargin: '800px 0px' });
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
  const box = $('#pages'), mid = box.scrollTop + box.clientHeight / 3;
  let n = 1;
  for (const c of box.children) { if (c.offsetTop + c.offsetHeight > mid) { n = +c.dataset.n || 1; break; } }
  curPage = n;
  $('#pg').textContent = `Page ${n} of ${pdf.numPages} (${Math.round((n / pdf.numPages) * 100)}%)`;
  localStorage.setItem(`pg:${me.id}:${cur.id}`, n);
  updBm(true);
}

$('#pages').onscroll = () => pdf && track();
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

/* ---------- Notes & Watermark ---------- */
function loadNotes() { $('#r-notes').value = localStorage.getItem(`note:${me.id}:${cur.id}`) || ''; }
$('#r-notes').oninput = (e) => localStorage.setItem(`note:${me.id}:${cur.id}`, e.target.value);

function watermark() {
  const t = esc(`${me.full_name} (${me.user_id}) · JCC E-Library`);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='240'><text x='30' y='160' transform='rotate(-22 30 160)' font-family='sans-serif' font-weight='bold' font-size='14' fill='rgba(120,120,120,0.16)'>${t}</text></svg>`;
  $('#wm').style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/* ---------- Admin ---------- */
$('#admin-btn').onclick = () => { show('admin'); loadAdmin(); };
$('#adm-back').onclick = () => show('library');
$('#tabs').onclick = (e) => {
  const t = e.target.dataset.t; if (!t) return;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b === e.target));
  document.querySelectorAll('.tab').forEach((p) => p.classList.toggle('on', p.id === t));
};

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

boot();