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

/* PDF.js worker: pre-fetched as a Blob (cached by the service worker for offline), CDN URL as fallback */
const PDF_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const pdfReady = (async () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + 'pdf.worker.min.js';
  try {
    const res = await withTimeout(fetch(PDF_BASE + 'pdf.worker.min.js'), 8000, 'PDF worker fetch');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(await res.blob());
  } catch (err) {
    console.warn('PDF worker: using CDN URL directly.', err);
  }
})();

const ROLES = { 
  cadet: 'Cadet', 
  faculty: 'Faculty Member', 
  principal: 'Principal', 
  vice_principal: 'Vice-Principal', 
  adjutant: 'Adjutant', 
  admin: 'Admin' 
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mail = (id) => id.toLowerCase() + '@jcc.library';
let me, books = [], saved = new Set(), recentIds = [], filter = 'all', sortMode = 'recent', q = '', pdf, cur, zoom = 1, channels = [], pageObserver, openToken = 0;

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

/* IndexedDB AES-GCM Local Storage */
const idb = new Promise((res, rej) => {
  const r = indexedDB.open('jcc-lib', 2);
  r.onupgradeneeded = () => {
    if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv');
  };
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

async function devKey() {
  const name = 'key:' + me.id;
  let k = await kv.get(name);
  if (!k) { 
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); 
    await kv.set(name, k); 
  }
  return k;
}

/* UI & Security Helpers */
const show = (id) => document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
function toast(msg, type = '') { 
  const t = document.createElement('div'); 
  t.className = 'toast ' + type; 
  t.textContent = msg; 
  $('#toasts').append(t); 
  setTimeout(() => t.remove(), 4000); 
}
function beep() { 
  try { 
    const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); 
    o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(c.destination); 
    o.start(); o.stop(c.currentTime + .18); 
  } catch {} 
}
const err = (sel, m) => { $(sel).textContent = m; };

// Decorative Bookshelf Spines
if ($('#spines')) {
  $('#spines').innerHTML = [58, 82, 66, 100, 74, 90, 62, 96, 70, 84, 60, 92, 78, 68, 88, 72].map((h, i) =>
    `<i style="--h:${h}%;--i:${i};--c:hsl(${[150, 155, 145, 160, 152, 148, 158, 142][i % 8]} 45% ${18 + (i % 4) * 6}%)"></i>`).join('');
}

/* DRM Guards */
document.addEventListener('contextmenu', (e) => {
  if ($('#reader').classList.contains('on')) e.preventDefault();
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u', 'c', 'a', 'i', 'j'].includes(e.key.toLowerCase())) e.preventDefault();
  if (e.key === 'F12') e.preventDefault();
});

/* Auth Handlers */
document.querySelectorAll('[data-sw]').forEach((a) => a.onclick = (e) => {
  e.preventDefault();
  $('#login').hidden = a.dataset.sw !== 'login';
  $('#register').hidden = a.dataset.sw !== 'register';
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
    email: mail(id), 
    password: pw, 
    options: { data: { user_id: id.toLowerCase(), full_name: $('#r-name').value.trim(), role: $('#r-role').value } } 
  });
  if (error) return err('#r-err', /registered|exists/i.test(error.message) ? 'That User ID is already taken.' : error.message);
  boot();
};

document.addEventListener('click', async (e) => {
  if (e.target.dataset.act !== 'logout') return;
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
    // Valid session but the account row is gone: an admin deleted this user.
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
    .subscribe((status) => {
      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') setTimeout(boot, 3000);
    });
  channels.push(sub);
}

/* Catalog & Navigation */
async function enter() {
  show('library');
  $('#who').textContent = me.full_name; 
  $('#role').textContent = ROLES[me.role] || me.role;
  $('#admin-btn').hidden = me.role !== 'admin';
  await loadBooks(); 
  render();
  updateStats();
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

function render() {
  const off = !navigator.onLine;
  $('#net').classList.toggle('off', off); 
  $('#net span').textContent = off ? 'Offline' : 'Online';
  
  const genres = [...new Set(books.map((b) => b.genre))];
  $('#chips').innerHTML = [
    ['all', 'All Books'], 
    ['recents', 'Recents'], 
    ['saved', 'Saved Offline'], 
    ...genres.map((g) => [g, g])
  ].map(([k, l]) => `<button data-f="${esc(k)}" class="${filter === k ? 'on' : ''}">${esc(l)}</button>`).join('');

  let list = [];
  if (filter === 'recents') {
    list = recentIds.map((id) => books.find((b) => b.id === id)).filter(Boolean);
  } else {
    list = books.filter((b) => filter === 'all' || (filter === 'saved' ? saved.has(b.id) : b.genre === filter));
  }

  if (q) list = list.filter((b) => (b.title + ' ' + (b.author || '')).toLowerCase().includes(q));

  if (filter !== 'recents') {
    if (sortMode === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortMode === 'author') list.sort((a, b) => (a.author || '').localeCompare(b.author || ''));
    else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  $('#grid').innerHTML = list.length ? list.map((b) => {
    const hue = ([...b.title].reduce((a, c) => a + c.charCodeAt(0), 0) % 40) + 130;
    const cover = b.cover ? `<div class="cv" style="background-image:url(${b.cover})"></div>` : `<div class="cv gen" style="--h:${hue}"><b>${esc(b.title)}</b></div>`;
    const lastPg = localStorage.getItem(`pg:${me.id}:${b.id}`);
    return `<article class="book ${off && !saved.has(b.id) ? 'dim' : ''}" data-id="${b.id}" tabindex="0">
      ${cover}
      ${saved.has(b.id) ? '<i class="sv">Offline</i>' : ''}
      <h3>${esc(b.title)}</h3>
      <p>${esc(b.author || 'Unknown Author')}</p>
      <div class="meta-line"><span class="tag">${esc(b.genre)}</span>${lastPg ? `<span class="prog">p. ${lastPg}</span>` : ''}</div>
    </article>`;
  }).join('') : `<p class="empty">${
    filter === 'recents' 
      ? 'No recently read books yet.' 
      : filter === 'saved' 
        ? 'No books saved for offline reading.' 
        : 'No matching books found.'
  }</p>`;
}

function updateStats() {
  if ($('#st-saved')) $('#st-saved').textContent = saved.size;
  if ($('#st-total')) $('#st-total').textContent = books.length;
}

$('#chips').onclick = (e) => { if (e.target.dataset.f) { filter = e.target.dataset.f; render(); } };
if ($('#sort')) $('#sort').onchange = (e) => { sortMode = e.target.value; render(); };
$('#search').oninput = (e) => { q = e.target.value.trim().toLowerCase(); render(); };
$('#grid').onclick = (e) => { const c = e.target.closest('.book'); if (c) openBook(books.find((b) => b.id === c.dataset.id)); };
$('#grid').onkeydown = (e) => { if (e.key === 'Enter' && e.target.classList.contains('book')) e.target.click(); };

addEventListener('online', () => { if (me?.status === 'approved') loadBooks().then(() => { render(); updateStats(); }); });
addEventListener('offline', () => me && render());

/* PDF Data Fetcher: encrypted local copy -> Supabase download -> signed URL */
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
    const task = pdfjsLib.getDocument({
      data: new Uint8Array(buf.slice(0)),
      cMapUrl: PDF_BASE + 'cmaps/',
      cMapPacked: true,
      isEvalSupported: false
    });
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

/* Reader Core & PDF Renderer */
async function openBook(b) {
  if (!navigator.onLine && !saved.has(b.id)) return toast('Connect online once to view this book.', 'err');
  const token = ++openToken;
  if (pdf) { pdf.destroy(); pdf = null; }
  cur = b; zoom = 1; show('reader');
  $('#r-title').textContent = b.title;
  $('#pg').textContent = 'Loading document...';
  $('#pages').innerHTML = '<div class="load-spinner"><div class="spin"></div><p id="ld-msg">Opening Document…</p></div>';
  updSave();
  watermark();
  loadNotes();
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
    $('#pages').innerHTML = `<div class="load-spinner fail"><p>This document could not be opened.</p><small>${esc(x.message || x)}</small><button class="btn gold" id="r-retry">Try Again</button></div>`;
    $('#r-retry').onclick = () => openBook(b);
  }
}

/* Usable width inside #pages (minus its padding, so pages never force a sideways scrollbar) */
function pageBaseWidth(box) {
  const cs = getComputedStyle(box);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return Math.max(280, (box.clientWidth || window.innerWidth - 320) - pad);
}

async function renderPage(el) {
  if (!pdf || !el || el.dataset.rendered || el.dataset.rendering) return;
  el.dataset.rendering = 'true';
  const pageNum = +el.dataset.n;
  
  try {
    const pg = await pdf.getPage(pageNum);
    const viewport0 = pg.getViewport({ scale: 1 });
    const box = $('#pages');
    
    const containerWidth = pageBaseWidth(box);
    const targetWidth = containerWidth * zoom;
    const scale = targetWidth / (viewport0.width || 600);
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

    await pg.render({ canvasContext: ctx, viewport: renderVp }).promise;
    el.dataset.rendered = 'true';
  } catch (err) {
    console.error(`Page ${pageNum} render error:`, err);
  } finally {
    delete el.dataset.rendering;
  }
}

async function build() {
  if (!pdf) return;
  const box = $('#pages'); 
  box.innerHTML = '';
  
  const first = await pdf.getPage(1);
  const viewport0 = first.getViewport({ scale: 1 });
  const containerWidth = pageBaseWidth(box);
  const targetWidth = containerWidth * zoom;
  const scale = targetWidth / (viewport0.width || 600);
  const targetHeight = (viewport0.height || 800) * scale;

  // Explicit container root for IntersectionObserver
  if (pageObserver) pageObserver.disconnect();
  const io = pageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) renderPage(entry.target);
    });
  }, { root: box, rootMargin: '800px 0px' });

  for (let n = 1; n <= pdf.numPages; n++) {
    const d = document.createElement('div'); 
    d.className = 'pg'; 
    d.dataset.n = n; 
    d.style.cssText = `flex:none; width:${Math.floor(targetWidth)}px; height:${Math.floor(targetHeight)}px; background:#ffffff; margin:20px auto; border-radius:3px; box-shadow:0 4px 14px rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; color:#888; font-size:14px;`;
    d.textContent = `Loading page ${n}…`;
    box.append(d); 
    io.observe(d);
  }

  const start = +localStorage.getItem(`pg:${me.id}:${cur.id}`) || 1;
  const targetEl = box.children[start - 1] || box.children[0];
  if (targetEl) {
    renderPage(targetEl);
    box.scrollTop = Math.max(0, targetEl.offsetTop - 20);
  }
  track();
}

function track() {
  if (!pdf) return;
  const box = $('#pages'), mid = box.scrollTop + box.clientHeight / 3;
  let n = 1; 
  for (const c of box.children) { 
    if (c.offsetTop + c.offsetHeight > mid) { n = +c.dataset.n || 1; break; } 
  }
  const pct = Math.round((n / pdf.numPages) * 100);
  $('#pg').textContent = `Page ${n} of ${pdf.numPages} (${pct}%)`; 
  localStorage.setItem(`pg:${me.id}:${cur.id}`, n);
}

$('#pages').onscroll = () => pdf && track();
$('#z-in').onclick = () => { if (pdf && zoom < 2.2) { zoom += 0.2; build(); } };
$('#z-out').onclick = () => { if (pdf && zoom > 0.6) { zoom -= 0.2; build(); } };

function closeReader() { 
  openToken++;
  if (pageObserver) pageObserver.disconnect();
  if (pdf) { pdf.destroy(); pdf = null; }
  $('#pages').innerHTML = ''; 
  show('library'); 
  render(); 
}
$('#r-back').onclick = closeReader;

function updSave() { $('#r-save').textContent = saved.has(cur.id) ? 'Delete Offline Copy' : 'Save Offline'; }

$('#r-save').onclick = async () => {
  const k = `pdf:${me.id}:${cur.id}`;
  if (saved.has(cur.id)) { 
    await kv.del(k); 
    saved.delete(cur.id); 
    toast('Offline copy removed.'); 
    updateStats(); 
    return updSave(); 
  }
  try {
    toast('Storing offline copy...');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await fetchPdfData(cur);
    await kv.set(k, { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await devKey(), data) });
    saved.add(cur.id); 
    toast('Saved offline successfully!'); 
    updSave(); 
    updateStats();
  } catch { 
    toast('Unable to save offline. Check connection.', 'err'); 
  }
};

/* Notes & Watermark */
function loadNotes() {
  if (!$('#r-notes')) return;
  $('#r-notes').value = localStorage.getItem(`note:${me.id}:${cur.id}`) || '';
}
if ($('#r-notes')) {
  $('#r-notes').oninput = (e) => localStorage.setItem(`note:${me.id}:${cur.id}`, e.target.value);
}

function watermark() {
  const t = esc(`${me.full_name} (${me.user_id}) · JCC E-Library`);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='240'><text x='30' y='160' transform='rotate(-22 30 160)' font-family='sans-serif' font-weight='bold' font-size='14' fill='rgba(214,171,82,0.12)'>${t}</text></svg>`;
  $('#wm').style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/* Admin Management */
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
      beep(); 
      countPending(); 
      loadAdmin();
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
        <button class="btn gold" data-a="approved" data-id="${u.id}">Approve</button>
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
    await loadBooks(); 
    loadAdmin(); 
    render(); 
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
    c.width = v.width; 
    c.height = v.height;

    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);

    await pg.render({ canvasContext: ctx, viewport: v }).promise;

    const path = crypto.randomUUID() + '.pdf';
    btn.textContent = 'Uploading to Secure Storage...';
    
    const up = await sb.storage.from('books').upload(path, f, { contentType: 'application/pdf' }); 
    if (up.error) throw up.error;

    const ins = await sb.from('books').insert({ 
      title: $('#u-title').value.trim(), 
      author: $('#u-author').value.trim(), 
      genre: $('#u-genre').value, 
      path, 
      cover: c.toDataURL('image/jpeg', .75), 
      size: f.size 
    });
    if (ins.error) throw ins.error;

    toast('Book successfully published.'); 
    e.target.reset(); 
    await loadBooks(); 
    loadAdmin(); 
    render();
  } catch (x) { 
    toast(x.message || 'Book publication failed.', 'err'); 
  }
  btn.disabled = false; 
  btn.textContent = 'Upload Book';
};

boot();