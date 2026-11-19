// ---- shim: แทน chrome.storage / chrome.runtime ของ extension ด้วย localStorage (เก็บในเครื่องเท่านั้น) ----
const ext = {
  url: (p) => p,
  storage: { local: {
    async get(keys) {
      const ks = typeof keys === 'string' ? [keys] : keys;
      const out = {};
      ks.forEach((k) => { try { const v = localStorage.getItem('snap:' + k); if (v !== null) out[k] = JSON.parse(v); } catch (e) {} });
      return out;
    },
    async set(o) { for (const [k, v] of Object.entries(o)) { try { localStorage.setItem('snap:' + k, JSON.stringify(v)); } catch (e) {} } },
  } },
};
const SRC = (l) => `https://snapjson.untapped.gg/v2/latest/${l}/cards.json`;
let lang = 'th';
const IMG = (id, size = 256) => `https://snapjson.untapped.gg/art/render/framebreak/common/${size}/${id}.webp`;
const $ = (id) => document.getElementById(id);
let cards = [];

const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '');
const zw = (s) => (s || '').replace(/[​‌‍]/g, '');
const nm = (c) => (lang === 'th' && c.th && c.th.name) || c.name;
// ข้อมูลต้นทางบางใบมีคำว่า undefined (ค่าตัวแปรหาย) → แทนด้วยค่าจาก attributes ถ้ามี
const fixUndef = (s, c) => s.replace(/undefined/g, (c.attributes && c.attributes.data && c.attributes.data.TokenEnergyCost) ?? '?');
const ds = (c) => fixUndef(zw(stripHtml(lang === 'th' && c.th && c.th.description ? c.th.description : c.description)), c);
const toRow = (c, i) => ({
  no: i + 1,
  id: c.defId,
  name: c.name,
  name_th: c.th ? c.th.name : '',
  cost: c.cost,
  power: c.power,
  ability: stripHtml(c.description),
  ability_th: c.th ? zw(stripHtml(c.th.description)) : '',
  series: c.series,
  released: relTs(c) ? fmtDate(relTs(c)) : '',
  image: IMG(c.defId, 512),
});

async function load(force) {
  $('status').textContent = 'กำลังโหลด…';
  try {
    if (!force) {
      const { cache } = await ext.storage.local.get('cache');
      if (cache && cache.v === 3 && Date.now() - cache.t < 6 * 3600e3) { cards = cache.data; return done(); }
    }
    const [r, rt] = await Promise.all([fetch(SRC('en')), fetch(SRC('th'))]);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    let thMap = {};
    if (rt.ok) { (await rt.json()).forEach((x) => { thMap[x.defId] = { name: x.name, description: x.description }; }); }
    // กัน cache ถูกทับด้วยข้อมูลว่าง/น้อยผิดปกติ
    if (!Array.isArray(data) || data.length < 100) throw new Error('ข้อมูลผิดปกติ');
    cards = data.filter((c) => c.collectible && c.name).map((c) => ({ ...c, th: thMap[c.defId] }));
    await ext.storage.local.set({ cache: { v: 3, t: Date.now(), data: cards } });
    done();
  } catch (e) {
    // ออฟไลน์/โหลดไม่ได้ → ใช้ข้อมูลที่เคย cache ไว้ (แม้หมดอายุ)
    const { cache } = await ext.storage.local.get('cache');
    if (cache && cache.data && cache.data.length) { cards = cache.data; $('status').textContent = 'ใช้ข้อมูลที่แคชไว้ (' + e.message + ')'; return done(); }
    $('status').textContent = 'ผิดพลาด: ' + e.message;
  }
}

// แคชรูปการ์ดถาวรด้วย Cache API (โหลดครั้งเดียว ครั้งต่อไปใช้จากเครื่อง)
let imgCache;
async function cachedImg(img, id, holder) {
  const url = IMG(id);
  try {
    imgCache ||= await caches.open('snap-card-art-v1');
    let res = await imgCache.match(url);
    if (!res) {
      const net = await fetch(url);
      if (!net.ok) throw new Error('img ' + net.status);
      await imgCache.put(url, net.clone());
      res = net;
    }
    const blobUrl = URL.createObjectURL(await res.blob());
    img.onload = () => URL.revokeObjectURL(blobUrl);
    img.src = blobUrl;
  } catch (e) { if (holder) holder.remove(); } // ไม่มีรูป = ไม่ใช่การ์ดจริง (เช่น augment/token) ซ่อนไว้
}

const TH = { 'on reveal': 'เปิดตัว (On Reveal)', ongoing: 'ต่อเนื่อง (Ongoing)', 'end of turn': 'จบเทิร์น (End of Turn)', 'when this is discarded': 'เมื่อถูกทิ้ง', 'when this dies': 'เมื่อตาย', 'when this is destroyed': 'เมื่อถูกทำลาย', destroy: 'ทำลาย', discard: 'ทิ้ง', move: 'ย้าย', 'on turn': 'ทุกเทิร์น', 'start of game': 'เริ่มเกม', 'no ability': 'ไม่มีความสามารถ' };

function keywords(c) {
  const out = new Set();
  const re = /<b>(.*?)<\/b>/gi;
  let m;
  while ((m = re.exec(c.description || ''))) {
    const k = m[1].replace(/<[^>]+>/g, '').replace(/[:：]\s*$/, '').trim().toLowerCase();
    if (k) out.add(k);
  }
  if (!stripHtml(c.description)) out.add('no ability');
  return out;
}

function fillSelects() {
  const count = {};
  cards.forEach((c) => keywords(c).forEach((k) => (count[k] = (count[k] || 0) + 1)));
  const kw = $('kw');
  kw.length = 1;
  Object.keys(count).sort((a, b) => count[b] - count[a]).forEach((k) => {
    const o = new Option(`${TH[k] || k} · ${count[k]}`, k);
    kw.add(o);
  });
  const series = $('series');
  series.length = 1;
  [...new Set(cards.map((c) => c.series))].sort((a, b) => a - b).forEach((s) => series.add(new Option('Series ' + s, s)));
}

let owned = new Set();
let favs = new Set();
let view = 'all';
let mode = 'list';
let page = 0;
const PER_PAGE = 9; // อัลบั้ม 3x3 ต่อหน้า
let dir = 0;
const saveFavs = () => ext.storage.local.set({ favs: [...favs] });
const updFavN = () => { $('favN').textContent = favs.size; };
const saveOwned = () => ext.storage.local.set({ owned: [...owned] });
// ย้อนการแก้ไขคลัง (กันกดพลาด): เก็บ snapshot ก่อนแก้ ไว้ 20 ครั้งล่าสุด
let undoStack = [];
function snap() {
  undoStack.push([...owned]);
  if (undoStack.length > 20) undoStack.shift();
  ext.storage.local.set({ undo: undoStack });
  updUndo();
}
function updUndo() { $('undo').disabled = !undoStack.length; $('undo').textContent = '↶ ย้อน' + (undoStack.length ? ` (${undoStack.length})` : ''); }
const updOwnedN = () => ($('ownedN').textContent = owned.size);

// คะแนนแบบ heuristic (ไม่มีสถิติชนะจริง): พลังเทียบคอสต์ + โบนัสความสามารถ
function score(c) {
  const kws = keywords(c);
  let s = c.power - 2 * c.cost;
  if (stripHtml(c.description)) s += 1.5;
  if (kws.has('ongoing')) s += 0.5;
  if (kws.has('on reveal')) s += 0.3;
  return s;
}

function buildDeck() {
  const pool = cards.filter((c) => owned.has(c.defId)).sort((a, b) => score(b) - score(a));
  if (pool.length < 12) { $('deck').textContent = `ต้องมีการ์ดในคลังอย่างน้อย 12 ใบ (ตอนนี้ ${pool.length})`; return; }
  const target = { 1: 2, 2: 3, 3: 3, 4: 2, 5: 1, 6: 1 }; // กราฟคอสต์ 12 ใบ (6 = 6+)
  const deck = [], used = new Set(), have = {};
  for (const c of pool) {
    const b = Math.min(c.cost, 6);
    if ((have[b] || 0) < (target[b] || 0)) { deck.push(c); used.add(c.defId); have[b] = (have[b] || 0) + 1; }
    if (deck.length === 12) break;
  }
  for (const c of pool) { if (deck.length >= 12) break; if (!used.has(c.defId)) deck.push(c); }
  deck.sort((a, b) => a.cost - b.cost);
  const wrap = document.createElement('div');
  wrap.append('เด็คแนะนำ (' + deck.length + '): ');
  deck.forEach((c) => { const s = document.createElement('span'); s.className = 'chip'; s.textContent = `${c.cost}⚡ ${c.name}`; wrap.append(s); });
  $('deck').replaceChildren(wrap);
}

// เทียร์: ชุดคงที่จาก Marvel Snap Zone (tiers-zone.json) จับคู่ชื่อกับการ์ดในเกม
let tiers = {};
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
async function loadTiers() {
  try {
    const j = await (await fetch('tiers-zone.json')).json();
    const byName = new Map();
    cards.forEach((c) => { const k = norm(c.name); if (!byName.has(k)) byName.set(k, c.defId); });
    const out = {};
    for (const [name, tier] of Object.entries(j.tiers)) { const id = byName.get(norm(name)); if (id) out[id] = { tier, src: 'zone' }; }
    tiers = out;
  } catch (e) { /* ไม่มีเทียร์ ก็ใช้ส่วนอื่นต่อได้ */ }
}
const tierOf = (c) => (tiers[c.defId] || {}).tier || '-';

function done() { fillSelects(); render(); }

const inRange = (v, f) => !f || (f === '6+' ? v >= 6 : v === +f);

// วันที่ออกขายครั้งแรกจาก seriesStartTimestamps (ใบเก่ามากไม่มีวันที่ → 0)
function relTs(c) {
  const now = Date.now();
  const t = (c.seriesStartTimestamps || []).filter((v) => v > 1.4e12 && v <= now);
  return t.length ? Math.min(...t) : 0; // ครั้งแรกที่การ์ดออกขาย (ไม่ใช่วันที่ย้ายซีรีส์)
}
const fmtDate = (t) => new Date(t).toISOString().slice(0, 10);
const SORTS = {
  new: (a, b) => relTs(b) - relTs(a) || b.series - a.series || a.name.localeCompare(b.name),
  old: (a, b) => (relTs(a) || Infinity) - (relTs(b) || Infinity) || a.series - b.series || a.name.localeCompare(b.name),
  name: (a, b) => nm(a).localeCompare(nm(b)),
  cost: (a, b) => a.cost - b.cost || a.power - b.power,
};

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const kw = $('kw').value, sr = $('series').value;
  const out = cards.filter((c) => {
    if (!inRange(c.cost, $('cost').value) || !inRange(c.power, $('power').value)) return false;
    if (kw && !keywords(c).has(kw)) return false;
    if (sr !== '' && String(c.series) !== sr) return false;
    if (c.collectible === false || /Augment$/.test(c.defId)) return false;
    if (view === 'fav' && !favs.has(c.defId)) return false;
    if (view === 'own' && !owned.has(c.defId)) return false;
    if ($('tier').value && tierOf(c) !== $('tier').value) return false;
    return !q || c.name.toLowerCase().includes(q) || stripHtml(c.description).toLowerCase().includes(q) || nm(c).toLowerCase().includes(q) || ds(c).toLowerCase().includes(q);
  });
  const s = SORTS[$('sort').value];
  return s ? out.sort(s) : out;
}

// โหลดรูปเมื่อเลื่อนมาใกล้เท่านั้น (แสดงทุกใบได้โดยไม่โหลด 500 รูปพร้อมกัน)
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  io.unobserve(e.target);
  cachedImg(e.target, e.target.dataset.id, e.target.closest('.card'));
}), { rootMargin: '600px' });

// ---------- แนะนำเด็ค/การ์ดที่ควรเสริม (จากเด็คเมต้า Untapped) ----------
let decks = null;
let deckMeta = null;
// เด็คเมต้าจาก Marvel Snap Zone (ชุดคงที่ในไฟล์ decks-zone.json เพราะ Cloudflare บล็อกการดึงสด)
async function loadDecks() {
  if (decks) return decks;
  try {
    const j = await (await fetch(ext.url('decks-zone.json'))).json();
    const byName = new Map();
    cards.forEach((c) => { const k = norm(c.name); if (!byName.has(k)) byName.set(k, c.defId); });
    deckMeta = { fetched: j.fetched, source: j.source };
    decks = j.decks.map((d) => ({ name: d.name, games: d.games, wr: d.wr, meta: d.meta, ids: d.cards.map((n) => byName.get(norm(n)) || 'name:' + n) }));
  } catch (e) { decks = null; }
  return decks;
}

const nameOf = (id) => { if (id.startsWith('name:')) return id.slice(5); const c = cards.find((x) => x.defId === id); return c ? nm(c) : id; };

function analyze() {
  const rows = decks.map((d) => {
    const missing = d.ids.filter((id) => !owned.has(id));
    return { ...d, missing, have: d.ids.length - missing.length, w: (d.wr / 100) * Math.log10(d.games + 10) };
  });
  // คะแนนการ์ดที่ควรเสริม: รวมจากเด็คที่ขาดใบนี้ ยิ่งเด็คแกร่ง/ยิ่งขาดน้อยยิ่งได้มาก
  const sc = {};
  rows.forEach((d) => d.missing.forEach((id) => {
    const e = (sc[id] ||= { id, score: 0, decks: [], unlock: [] });
    e.score += d.w / d.missing.length;
    e.decks.push(d.name);
    if (d.missing.length <= 2) e.unlock.push(d.name);
  }));
  const picks = Object.values(sc).map((e) => { const t = (tiers[e.id] || {}).tier; return { ...e, tier: t, score: e.score * (t === 'Tier 1' ? 1.3 : t === 'Tier 2' ? 1.15 : 1) }; }).sort((a, b) => b.score - a.score);
  return { rows: rows.sort((a, b) => a.missing.length - b.missing.length || b.w - a.w), picks };
}

// แถบการ์ด 12 ใบของเด็ค: ใบที่มีในคลังสว่าง ใบที่ไม่มีมืด (hl = ใบที่ต้องการเน้น)
function deckStrip(r, hl) {
  const wrap = document.createElement('div');
  const head = document.createElement('div'); head.className = 'stripHead';
  head.textContent = `${r.name} — มี ${r.have}/${r.ids.length} · WR ${r.wr}% (${r.games} เกม)` + (r.missing.length ? ` · ขาด ${r.missing.length}` : ' · ครบแล้ว ✓');
  const g = document.createElement('div'); g.className = 'strip';
  r.ids.forEach((id) => {
    const cell = document.createElement('div');
    cell.className = 'scell' + (owned.has(id) ? '' : ' dim') + (id === hl ? ' hl' : '');
    cell.title = nameOf(id) + (owned.has(id) ? ' (มีแล้ว)' : ' (ยังไม่มี)');
    if (id.startsWith('name:')) { cell.textContent = nameOf(id); cell.classList.add('noimg'); }
    else { const img = document.createElement('img'); img.dataset.id = id; io.observe(img); cell.append(img); }
    const cap = document.createElement('div'); cap.className = 'cap'; cap.textContent = nameOf(id);
    cell.append(cap);
    g.append(cell);
  });
  wrap.append(head, g);
  return wrap;
}
// คลิกแถวเพื่อกางดูเด็ค (คลิกซ้ำเพื่อพับ)
function makeExpandable(row, getDecks, hl) {
  row.classList.add('click');
  row.onclick = () => {
    const ex = row.querySelector('.detail');
    if (ex) { ex.remove(); return; }
    const det = document.createElement('div'); det.className = 'detail';
    det.onclick = (ev) => ev.stopPropagation();
    getDecks().forEach((r) => det.append(deckStrip(r, hl)));
    row.append(det);
  };
}

async function renderRec() {
  $('pager').hidden = true;
  const box = $('list');
  box.className = 'rec';
  box.textContent = 'กำลังโหลดเด็คเมต้า…';
  if (!decks) await loadDecks();
  if (!decks) { box.textContent = 'โหลดเด็คเมต้าไม่ได้'; return; }
  if (!owned.size) { box.textContent = 'ยังไม่มีการ์ดในคลัง — เพิ่มการ์ดเข้าคลังก่อน แล้วระบบจะประเมินให้'; return; }
  const { rows, picks } = analyze();
  const frag = document.createDocumentFragment();
  const h = (t) => { const e = document.createElement('h3'); e.textContent = t; return e; };
  frag.append(h('การ์ดที่ควรเสริม (ส่งผลต่อเด็คมากสุด)'));
  picks.slice(0, 10).forEach((e, i) => {
    const d = document.createElement('div'); d.className = 'recrow';
    const t = e.tier ? ` · ${e.tier}` : '';
    d.textContent = `${i + 1}. ${favs.has(e.id) ? '★ ' : ''}${nameOf(e.id)}${t} — อยู่ในเด็คเมต้า ${e.decks.length} เด็ค` + (e.unlock.length ? `, ใกล้ครบ: ${[...new Set(e.unlock)].join(', ')}` : '');
    makeExpandable(d, () => rows.filter((r) => r.ids.includes(e.id)).sort((a, b) => b.w - a.w).slice(0, 3), e.id);
    frag.append(d);
  });
  const favList = [...favs].filter((id) => !owned.has(id));
  if (favList.length) {
    frag.append(h('รายการโปรดที่ยังไม่มี — ควรเสริมไหม?'));
    const ev = favList.map((id) => {
      const inD = rows.filter((r) => r.ids.includes(id));
      const near = inD.filter((r) => r.missing.length <= 2);
      const best = inD.slice().sort((a, b) => b.w - a.w)[0];
      const t = (tiers[id] || {}).tier;
      let verdict;
      if (near.length) verdict = '✅ ควรเสริม (ทำให้เด็คใกล้ครบ: ' + near.map((r) => r.name).join(', ') + ')';
      else if (inD.length >= 3 || t === 'Tier 1') verdict = '👍 น่าเสริม (ติด ' + inD.length + ' เด็คเมต้า' + (t ? ', ' + t : '') + ')';
      else if (inD.length) verdict = '🤔 พอใช้ (ติด ' + inD.length + ' เด็ค แต่เด็คที่เกี่ยวข้องยังขาดอีกมาก)';
      else verdict = '⏸ ยังไม่จำเป็น (ไม่ติดเด็คเมต้าที่ตรวจ' + (t ? ', ' + t : '') + ') — ไม่ได้แปลว่าอ่อน อาจเหมาะกับเด็คนอกเมต้า';
      return { id, inD, best, verdict, k: near.length * 100 + inD.length };
    }).sort((a, b) => b.k - a.k);
    ev.forEach((e) => {
      const d = document.createElement('div'); d.className = 'recrow';
      d.textContent = `★ ${nameOf(e.id)} — ${e.verdict}` + (e.best ? ` · เด็คที่ดีสุด: ${e.best.name} (WR ${e.best.wr}%)` : '');
      makeExpandable(d, () => e.inD.slice().sort((a, b) => a.missing.length - b.missing.length || b.w - a.w).slice(0, 3), e.id);
      frag.append(d);
    });
  }
  frag.append(h('เด็คเมต้าที่คุณใกล้ทำได้ที่สุด'));
  rows.forEach((r) => {
    const d = document.createElement('div'); d.className = 'recrow';
    d.textContent = `${r.name} — มี ${r.have}/${r.ids.length} · WR ${r.wr.toFixed(1)}% (${r.games} เกม)` + (r.missing.length ? ` · ขาด: ${r.missing.map(nameOf).join(', ')}` : ' · ครบแล้ว ✓');
    makeExpandable(d, () => [r], null);
    frag.append(d);
  });
  const n = document.createElement('div'); n.className = 'recnote';
  n.textContent = 'ประเมินจากเด็คเมต้า 30 เด็คของ Marvel Snap Zone (ชุดคงที่ ดึงเมื่อ ' + (deckMeta ? deckMeta.fetched : '-') + ', ตั้งแต่แพตช์ล่าสุด, 100+ เกม): คะแนนการ์ด = ความแกร่งเด็ค (WR × จำนวนเกม) หารด้วยจำนวนใบที่เด็คนั้นยังขาด + โบนัสเทียร์ ไม่ใช่ผลการจำลองการเล่นจริง';
  frag.append(n);
  box.replaceChildren(frag);
}

function render() {
  if (view === 'rec') return renderRec();
  const list = filtered();
  $('status').textContent = `${list.length}/${cards.length} ใบ`;
  const frag = document.createDocumentFragment();
  $('list').className = mode === 'grid' ? 'grid' : '';
  if (mode !== 'grid') $('pager').hidden = true;
  if (mode === 'grid') {
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    page = Math.min(Math.max(page, 0), pages - 1);
    const start = page * PER_PAGE;
    $('pager').hidden = false;
    $('pageInfo').textContent = `หน้า ${page + 1} / ${pages}`;
    $('prev').disabled = page === 0;
    $('next').disabled = page >= pages - 1;
    $('list').classList.remove('flipL', 'flipR');
    if (dir) { void $('list').offsetWidth; $('list').classList.add(dir > 0 ? 'flipR' : 'flipL'); dir = 0; }
    list.slice(start, start + PER_PAGE).forEach((c, k) => {
      const i = start + k;
      const cell = document.createElement('div');
      cell.className = 'cell card' + (view !== 'own' && !owned.has(c.defId) ? ' dim' : '');
      cell.title = `${i + 1}. ${nm(c)} · Cost ${c.cost} · Power ${c.power}
${ds(c)}`;
      const img = document.createElement('img');
      img.dataset.id = c.defId;
      io.observe(img);
      cell.append(img);
      const ti = tiers[c.defId];
      if (ti) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = ti.tier.replace('Tier ', 'T'); cell.append(b); }
      if (owned.has(c.defId) && view !== 'own') { const o = document.createElement('span'); o.className = 'badge own2'; o.textContent = '✓'; cell.append(o); }
      if (favs.has(c.defId)) { const f = document.createElement('span'); f.className = 'badge fav2'; f.textContent = '★'; cell.append(f); }
      frag.append(cell);
    });
    for (let k = list.slice(start, start + PER_PAGE).length; k < PER_PAGE; k++) {
      const e = document.createElement('div'); e.className = 'cell empty'; frag.append(e);
    }
    $('list').replaceChildren(frag);
    return;
  }
  list.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'card';
    const img = document.createElement('img');
    img.dataset.id = c.defId;
    io.observe(img);
    const box = document.createElement('div');
    const n = document.createElement('div'); n.className = 'name'; n.textContent = `${i + 1}. ` + nm(c) + (nm(c) !== c.name ? ` (${c.name})` : '');
    const ti = tiers[c.defId];
    const s = document.createElement('div'); s.className = 'stat';
    s.textContent = `Cost ${c.cost} · Power ${c.power}` + (ti ? ` · ${ti.tier}` : '') + (relTs(c) ? ` · ออกขาย ${fmtDate(relTs(c))}` : '');
    const t = document.createElement('div'); t.className = 'desc'; t.textContent = ds(c) || '— ไม่มีความสามารถ —';
    const ob = document.createElement('button');
    const paint = () => { const on = owned.has(c.defId); ob.className = 'own' + (on ? ' on' : ''); ob.textContent = on ? '✓ อยู่ในคลัง' : '+ เพิ่มในคลัง'; };
    paint();
    ob.onclick = () => { snap(); owned.has(c.defId) ? owned.delete(c.defId) : owned.add(c.defId); saveOwned(); updOwnedN(); paint(); if (view === 'own') render(); };
    const fb = document.createElement('button');
    const paintF = () => { const on = favs.has(c.defId); fb.className = 'fav' + (on ? ' on' : ''); fb.textContent = on ? '★' : '☆'; fb.title = on ? 'เอาออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'; };
    paintF();
    fb.onclick = () => { favs.has(c.defId) ? favs.delete(c.defId) : favs.add(c.defId); saveFavs(); updFavN(); paintF(); if (view === 'fav') render(); };
    n.append(fb);
    box.append(n, s, t, ob);
    d.append(img, box);
    frag.append(d);
  });
  $('list').replaceChildren(frag);
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}

$('json').onclick = () => download('snap-cards.json', JSON.stringify(filtered().map(toRow), null, 2), 'application/json');
$('csv').onclick = () => {
  const rows = filtered().map(toRow);
  const keys = Object.keys(rows[0] || {});
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
  download('snap-cards.csv', csv, 'text/csv');
};
$('reload').onclick = () => load(true).then(() => loadTiers());
const render0 = () => { page = 0; render(); };
$('q').oninput = render0;
$('prev').onclick = () => { page--; dir = -1; render(); $('list').scrollIntoView({ block: 'start' }); };
$('next').onclick = () => { page++; dir = 1; render(); $('list').scrollIntoView({ block: 'start' }); };
$('mode').onclick = () => { mode = mode === 'list' ? 'grid' : 'list'; $('mode').textContent = mode === 'grid' ? '☰ รายการ' : '▦ การ์ด'; ext.storage.local.set({ mode }); render(); };
document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => {
  view = b.dataset.view; page = 0;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  render();
}));
$('lang').onclick = () => { lang = lang === 'th' ? 'en' : 'th'; $('lang').textContent = lang === 'th' ? 'ไทย' : 'EN'; ext.storage.local.set({ lang }); render(); };
['cost', 'power', 'kw', 'series', 'tier', 'sort'].forEach((id) => ($(id).onchange = render0));
$('build').onclick = buildDeck;
const CLEAR_PIN = '1122';
$('clearOwned').onclick = () => { $('pinRow').hidden = false; $('pin').value = ''; $('pinMsg').textContent = ''; $('pin').focus(); };
$('pinCancel').onclick = () => { $('pinRow').hidden = true; };
const doClear = () => {
  if ($('pin').value !== CLEAR_PIN) { $('pinMsg').textContent = 'รหัสไม่ถูกต้อง'; $('pin').select(); return; }
  snap(); owned.clear(); saveOwned(); updOwnedN(); $('deck').replaceChildren(); $('pinRow').hidden = true; render();
};
$('pinOk').onclick = doClear;
$('pin').onkeydown = (e) => { if (e.key === 'Enter') doClear(); };
ext.storage.local.get(['owned', 'lang', 'favs', 'mode', 'undo']).then((r) => { undoStack = r.undo || []; updUndo(); mode = r.mode || 'list'; $('mode').textContent = mode === 'grid' ? '☰ รายการ' : '▦ การ์ด'; owned = new Set(r.owned || []); favs = new Set(r.favs || []); updFavN(); lang = r.lang || 'th'; $('lang').textContent = lang === 'th' ? 'ไทย' : 'EN'; updOwnedN(); load(false).then(() => loadTiers()).then(render); });

// เพิ่มการ์ดทั้งเทียร์ที่เลือกเข้าคลัง (มีคำเตือนก่อน)
let pendingTierAdd = [];
$('tierAddBtn').onclick = () => {
  const sel = [...document.querySelectorAll('.tchk:checked')].map((x) => x.value);
  const msg = $('tierMsg');
  $('tierOk').hidden = false;
  if (!sel.length) { msg.textContent = 'เลือก Tier ก่อน'; $('tierOk').hidden = true; $('tierConfirm').hidden = false; return; }
  const hit = cards.filter((c) => c.collectible !== false && sel.includes(tierOf(c)));
  pendingTierAdd = hit.filter((c) => !owned.has(c.defId));
  if (!pendingTierAdd.length) { msg.textContent = `${sel.join(', ')}: ไม่มีใบใหม่ให้เพิ่ม (มีในคลังครบ ${hit.length} ใบแล้ว)`; $('tierOk').hidden = true; $('tierConfirm').hidden = false; return; }
  msg.textContent = `⚠ จะเพิ่ม ${pendingTierAdd.length} ใบจาก ${sel.join(', ')} เข้าคลัง (มีในคลังแล้ว ${hit.length - pendingTierAdd.length} ใบ) — ยืนยัน?`;
  $('tierConfirm').hidden = false;
};
$('tierNo').onclick = () => { pendingTierAdd = []; $('tierConfirm').hidden = true; };
$('tierOk').onclick = () => {
  snap();
  pendingTierAdd.forEach((c) => owned.add(c.defId));
  saveOwned(); updOwnedN(); pendingTierAdd = []; $('tierConfirm').hidden = true; render();
};

$('undo').onclick = () => {
  if (!undoStack.length) return;
  owned = new Set(undoStack.pop());
  ext.storage.local.set({ undo: undoStack });
  saveOwned(); updOwnedN(); updUndo(); render();
};

// ---------- ซิงค์คลัง/รายการโปรดด้วยรหัส (ไม่ใช้เซิร์ฟเวอร์ ข้อมูลอยู่ในรหัสเอง) ----------
const SYNC_URL = 'https://bcomebacksaleapp-web.github.io/snap-cards/';
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function pipe(u8, T) {
  const s = new Blob([u8]).stream().pipeThrough(new T('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function encodeSync() {
  const raw = new TextEncoder().encode(JSON.stringify({ o: [...owned], f: [...favs] }));
  if (typeof CompressionStream === 'undefined') return 'SNAP0.' + b64u(raw);
  return 'SNAP1.' + b64u(await pipe(raw, CompressionStream));
}
async function decodeSync(code) {
  code = code.trim().replace(/^.*#sync=/, '');
  const m = code.match(/^SNAP([01])\.([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('รหัสไม่ถูกต้อง');
  let u8 = unb64u(m[2]);
  if (m[1] === '1') { if (typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์นี้ถอดรหัสไม่ได้'); u8 = await pipe(u8, DecompressionStream); }
  const j = JSON.parse(new TextDecoder().decode(u8));
  if (!Array.isArray(j.o) || !Array.isArray(j.f)) throw new Error('รหัสไม่ถูกต้อง');
  return j;
}
const syncMsg = (t, bad) => { $('syncMsg').textContent = t; $('syncMsg').style.color = bad ? '#ff7b7b' : '#7be39a'; };
$('syncBtn').onclick = async () => {
  $('syncRow').hidden = !$('syncRow').hidden;
  if (!$('syncRow').hidden) { $('syncCode').value = await encodeSync(); syncMsg(`รหัสของเครื่องนี้: คลัง ${owned.size} ใบ · โปรด ${favs.size} ใบ`); }
};
$('syncCopy').onclick = async () => { try { await navigator.clipboard.writeText($('syncCode').value); syncMsg('คัดลอกรหัสแล้ว'); } catch (e) { $('syncCode').select(); syncMsg('กดคัดลอกเองได้เลย (เลือกข้อความไว้แล้ว)', true); } };
$('syncLink').onclick = async () => { try { await navigator.clipboard.writeText(SYNC_URL + '#sync=' + $('syncCode').value); syncMsg('คัดลอกลิงก์แล้ว'); } catch (e) { syncMsg('คัดลอกลิงก์ไม่ได้', true); } };
async function doImport(replace) {
  try {
    const j = await decodeSync($('syncCode').value);
    snap();
    const o = new Set(j.o), f = new Set(j.f);
    if (replace) { owned = o; favs = f; } else { o.forEach((x) => owned.add(x)); f.forEach((x) => favs.add(x)); }
    saveOwned(); saveFavs(); updOwnedN(); updFavN(); render();
    syncMsg(`นำเข้าแล้ว: คลัง ${owned.size} ใบ · โปรด ${favs.size} ใบ (กด ↶ ย้อน ได้)`);
  } catch (e) { syncMsg(e.message || 'นำเข้าไม่ได้', true); }
}
$('syncMerge').onclick = () => doImport(false);
$('syncReplace').onclick = () => { if ($('syncReplaceOk').hidden) { $('syncReplaceOk').hidden = false; syncMsg('⚠ แทนที่จะลบของเดิมในเครื่องนี้ — กด "ยืนยันแทนที่" อีกครั้ง', true); } };
$('syncReplaceOk').onclick = () => { $('syncReplaceOk').hidden = true; doImport(true); };
// เปิดลิงก์ที่มี #sync=… → เติมรหัสให้ ไม่นำเข้าเอง (ต้องกดเอง)
if (location.hash.startsWith('#sync=')) { $('syncRow').hidden = false; $('syncCode').value = location.hash.slice(6); syncMsg('พบรหัสซิงค์จากลิงก์ — กด "รวม" หรือ "แทนที่" เพื่อนำเข้า'); }

// เปิดมาแล้วเริ่มที่แท็บ "คลัง" ถ้ามีการ์ดในคลังอยู่แล้ว
(async () => {
  const r = await ext.storage.local.get('owned');
  if ((r.owned || []).length) {
    view = 'own';
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.view === 'own'));
  }
})();
