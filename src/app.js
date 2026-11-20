'use strict';
(() => {
const $ = (s) => document.querySelector(s);
const api = window.api || browserStub();

const stage = $('#stage'), world = $('#world'), itemsEl = $('#items'), arrowsEl = $('#arrows'), gbgEl = $('#gbg');
const frame = $('#frame'), marquee = $('#marquee'), tbar = $('#tbar'), menu = $('#menu'), modal = $('#modal');
const toastEl = $('#toast'), updnote = $('#updnote'), dropEl = $('#drop'), pinBtn = $('#pin');

/* ================= trạng thái ================= */
let doc = { items: [], groups: [], arrows: [] };
const assets = new Map();          // id -> {blob,url,mime,name,w,h}
const els = new Map();             // item id -> element
let view = { x: innerWidth / 2, y: innerHeight / 2, z: 1 };
let sel = [];                      // id item đang chọn, theo thứ tự chọn
let selArrow = null;
let editingId = null, savedRange = null;
let filePath = null, dirty = false;
let lastSnap = JSON.stringify(doc);
const undoStack = [], redoStack = [];
let clip = null;
let settings = { alwaysOnTop: true, opacity: 1, bg: '#2B2D31', grid: true, textColor: '#E8E9EC', lastSeenVersion: '' };
let appVersion = '', whatsnew = null;
let upd = { state: 'idle' }, manualCheck = false;
let drag = null, spaceDown = false, lastMouse = { x: innerWidth / 2, y: innerHeight / 2 };

const CLIP_MARK = '​M Ref';
const uid = () => Math.random().toString(36).slice(2, 10);
const item = (id) => doc.items.find((i) => i.id === id);
const selItems = () => sel.map(item).filter(Boolean);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ================= hình học ================= */
function rotv(x, y, deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; }
function corners(it) {
  const hw = it.w / 2, hh = it.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => { const p = rotv(x, y, it.rot); return { x: it.cx + p.x, y: it.cy + p.y }; });
}
function aabb(list) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const it of list) for (const p of corners(it)) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}
const w2s = (x, y) => ({ x: view.x + x * view.z, y: view.y + y * view.z });
const s2w = (x, y) => ({ x: (x - view.x) / view.z, y: (y - view.y) / view.z });

/* ================= undo ================= */
function normalize() {
  const ids = new Set(doc.items.map((i) => i.id));
  doc.arrows = doc.arrows.filter((a) => ids.has(a.from) && ids.has(a.to) && a.from !== a.to);
  const used = new Set(doc.items.map((i) => i.group).filter(Boolean));
  doc.groups = doc.groups.filter((g) => used.has(g.id));
  const gids = new Set(doc.groups.map((g) => g.id));
  for (const it of doc.items) if (it.group && !gids.has(it.group)) it.group = null;
  sel = sel.filter((id) => ids.has(id));
  if (selArrow && !doc.arrows.some((a) => a.id === selArrow)) selArrow = null;
}
function commit() {
  normalize();
  const snap = JSON.stringify(doc);
  if (snap === lastSnap) return;
  undoStack.push(lastSnap); if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0; lastSnap = snap; dirty = true;
}
function undo() { if (!undoStack.length) return; endEdit(); redoStack.push(lastSnap); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; endEdit(); undoStack.push(lastSnap); restore(redoStack.pop()); }
function restore(snap) { lastSnap = snap; doc = JSON.parse(snap); dirty = true; normalize(); render(); }

/* ================= vẽ ================= */
function makeEl(it) {
  const el = document.createElement('div');
  el.className = 'item ' + it.type; el.dataset.id = it.id;
  if (it.type === 'image') {
    const img = document.createElement('img'); img.draggable = false;
    const a = assets.get(it.asset); if (a) img.src = a.url;
    el.appendChild(img);
  } else {
    el.spellcheck = false;
    el.addEventListener('input', () => onTextInput(it.id));
    el.addEventListener('blur', () => { if (editingId === it.id && !tbar.contains(document.activeElement)) endEdit(); });
  }
  return el;
}
function place(it, el) {
  el.style.left = it.cx + 'px'; el.style.top = it.cy + 'px';
  el.style.transform = `translate(-50%,-50%) rotate(${it.rot}deg) scale(${it.fx ? -1 : 1},${it.fy ? -1 : 1})`;
  if (it.type === 'image') { el.style.width = it.w + 'px'; el.style.height = it.h + 'px'; }
  else {
    el.style.fontSize = it.size + 'px'; el.style.color = it.color;
    if (editingId !== it.id && el._html !== it.html) { el.innerHTML = it.html; el._html = it.html; }
    if (editingId !== it.id) { it.w = el.offsetWidth; it.h = el.offsetHeight; }
  }
}
function render() {
  const seen = new Set();
  doc.items.forEach((it, i) => {
    let el = els.get(it.id);
    if (!el) { el = makeEl(it); els.set(it.id, el); }
    if (itemsEl.children[i] !== el) itemsEl.insertBefore(el, itemsEl.children[i] || null);
    place(it, el); seen.add(it.id);
  });
  for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id); }
  $('#empty').hidden = doc.items.length > 0;
  renderOverlays();
}
function renderOverlays() { renderGroups(); renderArrows(); renderSel(); updateInfo(); }
function applyView() {
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  world.style.setProperty('--iz', 1 / view.z);
  stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
  renderOverlays();
}

const GPAD = 32;
function renderGroups() {
  const have = new Map([...gbgEl.children].map((el) => [el.dataset.g, el]));
  for (const g of doc.groups) {
    const mem = doc.items.filter((i) => i.group === g.id);
    if (!mem.length) continue;
    let el = have.get(g.id);
    if (!el) { el = document.createElement('div'); el.className = 'gpanel'; el.dataset.g = g.id; gbgEl.appendChild(el); }
    have.delete(g.id);
    const b = aabb(mem);
    el.style.left = b.x - GPAD + 'px'; el.style.top = b.y - GPAD + 'px';
    el.style.width = b.w + GPAD * 2 + 'px'; el.style.height = b.h + GPAD * 2 + 'px';
    el.classList.toggle('sel', mem.every((i) => sel.includes(i.id)));
  }
  for (const el of have.values()) el.remove();
}

function edgePoint(it, target, gap) {
  const d = rotv(target.x - it.cx, target.y - it.cy, -it.rot);
  const hw = it.w / 2 + gap, hh = it.h / 2 + gap;
  const t = Math.min(d.x ? hw / Math.abs(d.x) : Infinity, d.y ? hh / Math.abs(d.y) : Infinity);
  if (!(t < 1)) return null;
  return { x: it.cx + (target.x - it.cx) * t, y: it.cy + (target.y - it.cy) * t };
}
function renderArrows() {
  const z = view.z, sw = 2.5 / z, head = 14 / z, gap = 6 / z;
  let html = '';
  for (const a of doc.arrows) {
    const f = item(a.from), t = item(a.to); if (!f || !t) continue;
    const p1 = edgePoint(f, { x: t.cx, y: t.cy }, gap), p2 = edgePoint(t, { x: f.cx, y: f.cy }, gap);
    if (!p1 || !p2) continue;
    const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
    if (len < 4 / z || dx * (t.cx - f.cx) + dy * (t.cy - f.cy) <= 0) continue;   // hai ảnh đè nhau
    const hd = Math.min(head, len * 0.8), ux = dx / len, uy = dy / len, bx = p2.x - ux * hd, by = p2.y - uy * hd, hw = hd * 0.42;
    html += `<g data-a="${a.id}" class="${a.id === selArrow ? 'sel' : ''}">` +
      `<line class="hit" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke-width="${14 / z}"/>` +
      `<line class="vis" x1="${p1.x}" y1="${p1.y}" x2="${bx}" y2="${by}" stroke-width="${sw}"/>` +
      `<polygon points="${p2.x},${p2.y} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}"/></g>`;
  }
  arrowsEl.innerHTML = html;
}

let frameInfo = null;
function renderSel() {
  const its = selItems();
  if (!its.length) { frame.hidden = true; tbar.hidden = true; frameInfo = null; return; }
  const b = aabb(its);
  frameInfo = its.length === 1 ? { cx: its[0].cx, cy: its[0].cy, w: its[0].w, h: its[0].h, rot: its[0].rot } : { cx: b.cx, cy: b.cy, w: b.w, h: b.h, rot: 0 };
  const c = w2s(frameInfo.cx, frameInfo.cy), w = Math.round(frameInfo.w * view.z), h = Math.round(frameInfo.h * view.z);
  frame.hidden = false;
  frame.style.width = w + 'px'; frame.style.height = h + 'px';
  frame.style.transform = `translate(${Math.round(c.x - w / 2)}px,${Math.round(c.y - h / 2)}px) rotate(${frameInfo.rot}deg)`;
  frame.classList.toggle('editing', !!editingId);

  const txt = its.length === 1 && its[0].type === 'text' ? its[0] : null;
  if (!txt) { tbar.hidden = true; return; }
  tbar.hidden = false;
  $('#tsize').textContent = Math.round(txt.size);
  const tl = w2s(b.x, b.y), bl = w2s(b.x, b.y + b.h);
  let top = tl.y - tbar.offsetHeight - (editingId ? 10 : 44);
  if (top < 6) top = Math.min(innerHeight - tbar.offsetHeight - 6, bl.y + 12);
  tbar.style.left = clamp(tl.x, 6, Math.max(6, innerWidth - tbar.offsetWidth - 6)) + 'px';
  tbar.style.top = Math.max(6, top) + 'px';
}

function updateInfo() {
  const n = doc.items.filter((i) => i.type === 'image').length;
  const name = filePath ? filePath.split(/[\\/]/).pop() : 'Chưa lưu';
  $('#info').textContent = `${Math.round(view.z * 100)}% · ${n} ảnh · ${name}${dirty ? ' •' : ''}`;
  document.title = (filePath ? name + ' – ' : '') + 'M Ref';
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  toastEl.style.animation = 'none'; void toastEl.offsetWidth; toastEl.style.animation = '';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

/* ================= chọn ================= */
function setSel(ids) { sel = [...new Set(ids)]; selArrow = null; renderOverlays(); }
function selectedGroup() {
  const its = selItems(); if (!its.length) return null;
  const g = its[0].group; if (!g || !its.every((i) => i.group === g)) return null;
  return doc.groups.find((x) => x.id === g) || null;
}
function unitsOf(its) {
  const map = new Map(), out = [];
  for (const it of its) {
    if (!it.group) { out.push([it]); continue; }
    if (!map.has(it.group)) { map.set(it.group, []); out.push(map.get(it.group)); }
    map.get(it.group).push(it);
  }
  return out;
}

/* ================= ảnh ================= */
async function addImages(list, at) {
  const added = [];
  for (const f of list) {
    const blob = f.blob || new Blob([f.data], { type: f.mime });
    const url = URL.createObjectURL(blob);
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch { URL.revokeObjectURL(url); continue; }
    const id = uid();
    assets.set(id, { blob, url, mime: blob.type || f.mime || 'image/png', name: f.name || 'image', w: img.naturalWidth, h: img.naturalHeight });
    const k = Math.min(1, (innerWidth * 0.6) / view.z / img.naturalWidth, (innerHeight * 0.6) / view.z / img.naturalHeight);
    added.push({ id: uid(), type: 'image', asset: id, cx: 0, cy: 0, w: img.naturalWidth * k, h: img.naturalHeight * k, rot: 0, fx: false, fy: false, group: null });
  }
  if (!added.length) { if (list.length) toast('Không đọc được ảnh này'); return; }
  const gap = 16 / view.z, total = added.reduce((s, i) => s + i.w, 0) + gap * (added.length - 1);
  let x = at.x - total / 2;
  for (const it of added) { it.cx = x + it.w / 2; it.cy = at.y; x += it.w + gap; doc.items.push(it); }
  sel = added.map((i) => i.id); selArrow = null;
  commit(); render();
}
const isImageFile = (f) => /^image\/(png|jpeg|gif|webp|bmp)$/.test(f.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name);
const viewCenter = () => s2w(innerWidth / 2, innerHeight / 2);

/* ================= chữ ================= */
const TAGS = new Set(['B', 'I', 'U', 'STRONG', 'EM', 'FONT', 'BR', 'DIV', 'SPAN']);
function sanitize(html) {
  const t = document.createElement('template'); t.innerHTML = html;
  (function walk(n) {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1) { c.remove(); continue; }
      walk(c);
      if (!TAGS.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
      for (const a of [...c.attributes]) {
        if (c.tagName === 'FONT' && a.name === 'color' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\))$/i.test(a.value)) continue;
        if (a.name === 'style' && /^color:\s*(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\));?$/i.test(a.value.trim())) continue;
        c.removeAttribute(a.name);
      }
    }
  })(t.content);
  return t.innerHTML;
}
function addText(at) {
  endEdit();
  const p = at || viewCenter();
  const it = { id: uid(), type: 'text', html: '', size: Math.max(4, 22 / view.z), color: settings.textColor || '#E8E9EC', cx: p.x, cy: p.y, w: 0, h: 0, rot: 0, fx: false, fy: false, group: null };
  doc.items.push(it); sel = [it.id]; selArrow = null; render();
  startEdit(it, true);
}
function startEdit(it, all) {
  endEdit();
  const el = els.get(it.id); if (!el) return;
  editingId = it.id; sel = [it.id]; selArrow = null;
  el.contentEditable = 'true'; el.focus();
  const r = document.createRange(); r.selectNodeContents(el); if (!all) r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  renderOverlays();
}
function endEdit() {
  if (!editingId) return;
  const it = item(editingId), el = els.get(editingId);
  editingId = null; savedRange = null;
  if (!it || !el) { render(); return; }
  el.contentEditable = 'false'; getSelection().removeAllRanges(); el.blur();
  if (!el.textContent.trim()) doc.items = doc.items.filter((i) => i !== it);
  else { it.html = sanitize(el.innerHTML); el._html = null; }
  commit(); render();
}
function onTextInput(id) {
  const it = item(id), el = els.get(id); if (!it || !el) return;
  const nw = el.offsetWidth, nh = el.offsetHeight;
  if (nw !== it.w || nh !== it.h) {            // giữ nguyên góc trái trên khi gõ dài ra
    const d = rotv((nw - it.w) / 2, (nh - it.h) / 2, it.rot);
    it.cx += d.x; it.cy += d.y; it.w = nw; it.h = nh;
    el.style.left = it.cx + 'px'; el.style.top = it.cy + 'px';
  }
  renderOverlays();
}
function textCmd(cmd, val) {
  const its = selItems(); if (its.length !== 1 || its[0].type !== 'text') return;
  const it = its[0], el = els.get(it.id);
  if (editingId === it.id) {
    el.focus();
    if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
    document.execCommand(cmd, false, val); onTextInput(it.id); syncTbar();
    return;
  }
  el.contentEditable = 'true'; el.focus();
  const r = document.createRange(); r.selectNodeContents(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand(cmd, false, val);
  s.removeAllRanges(); el.contentEditable = 'false'; el.blur();
  it.html = sanitize(el.innerHTML); el._html = null;
  commit(); render();
}
function textSize(dir) {
  const its = selItems(); if (its.length !== 1 || its[0].type !== 'text') return;
  const it = its[0], el = els.get(it.id);
  it.size = clamp(it.size + dir * Math.max(1, Math.round(it.size * 0.1)), 4, 4000);
  el.style.fontSize = it.size + 'px';
  if (editingId === it.id) onTextInput(it.id); else { commit(); render(); }
  $('#tsize').textContent = Math.round(it.size);
}
function syncTbar() {
  for (const b of tbar.querySelectorAll('.tb[data-t]')) {
    const c = b.dataset.t;
    if (c === 'bold' || c === 'italic' || c === 'underline') b.classList.toggle('on', !!editingId && document.queryCommandState(c));
  }
}
tbar.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
tbar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]'), c = e.target.closest('[data-c]');
  if (b) { const t = b.dataset.t; if (t === 'smaller') textSize(-1); else if (t === 'bigger') textSize(1); else textCmd(t); }
  if (c) setTextColor(c.dataset.c);
});
$('#tcolor').addEventListener('change', (e) => setTextColor(e.target.value));
function setTextColor(c) {
  settings.textColor = c; api.setSettings({ textColor: c });
  const n = parseInt(c.slice(1), 16);
  textCmd('foreColor', `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`);
}
document.addEventListener('selectionchange', () => {
  if (!editingId) return;
  const s = getSelection(), el = els.get(editingId);
  if (el && s.rangeCount && el.contains(s.anchorNode)) { savedRange = s.getRangeAt(0).cloneRange(); syncTbar(); }
});

/* ================= lệnh ================= */
function del() {
  if (selArrow) { doc.arrows = doc.arrows.filter((a) => a.id !== selArrow); selArrow = null; commit(); render(); return; }
  if (!sel.length) return;
  const s = new Set(sel); doc.items = doc.items.filter((i) => !s.has(i.id)); sel = [];
  commit(); render();
}
function alignCmd(mode) {
  const its = selItems(); let units = unitsOf(its);
  if (units.length < 2) units = its.map((i) => [i]);
  if (units.length < 2) return;
  const all = aabb(its), bs = units.map((u) => ({ u, b: aabb(u) }));
  const move = (o, dx, dy) => { for (const it of o.u) { it.cx += dx; it.cy += dy; } };
  if (mode === 'dh' || mode === 'dv') {
    const k = mode === 'dh' ? ['x', 'w'] : ['y', 'h'];
    bs.sort((a, b) => a.b[k[0]] - b.b[k[0]]);
    const gap = (all[k[1]] - bs.reduce((s, o) => s + o.b[k[1]], 0)) / (bs.length - 1);
    let p = all[k[0]];
    for (const o of bs) { const d = p - o.b[k[0]]; move(o, mode === 'dh' ? d : 0, mode === 'dv' ? d : 0); p += o.b[k[1]] + gap; }
  } else for (const o of bs) {
    const b = o.b;
    if (mode === 'l') move(o, all.x - b.x, 0);
    if (mode === 'ch') move(o, all.cx - b.cx, 0);
    if (mode === 'r') move(o, all.x + all.w - b.x - b.w, 0);
    if (mode === 't') move(o, 0, all.y - b.y);
    if (mode === 'cv') move(o, 0, all.cy - b.cy);
    if (mode === 'b') move(o, 0, all.y + all.h - b.y - b.h);
  }
  commit(); render();
}
function pack() {
  const its = sel.length > 1 ? selItems() : doc.items; if (its.length < 2) return;
  const all = aabb(its), gap = 12 / view.z;
  const bs = unitsOf(its).map((u) => ({ u, b: aabb(u) })).sort((a, b) => b.b.h - a.b.h);
  const target = Math.max(Math.sqrt(bs.reduce((s, o) => s + (o.b.w + gap) * (o.b.h + gap), 0)) * 1.25, ...bs.map((o) => o.b.w));
  let x = 0, y = 0, rowH = 0;
  for (const o of bs) {
    if (x > 0 && x + o.b.w > target) { x = 0; y += rowH + gap; rowH = 0; }
    const dx = all.x + x - o.b.x, dy = all.y + y - o.b.y;
    for (const it of o.u) { it.cx += dx; it.cy += dy; }
    x += o.b.w + gap; rowH = Math.max(rowH, o.b.h);
  }
  commit(); render();
}
function flip(axis) { const its = selItems(); if (!its.length) return; for (const it of its) { if (axis === 'h') it.fx = !it.fx; else it.fy = !it.fy; } commit(); render(); }
function rotateBy(deg) {
  const its = selItems(); if (!its.length) return;
  const c = aabb(its);
  for (const it of its) { const p = rotv(it.cx - c.cx, it.cy - c.cy, deg); it.cx = c.cx + p.x; it.cy = c.cy + p.y; it.rot = (it.rot + deg) % 360; }
  commit(); render();
}
function resetXf() {
  for (const it of selItems()) {
    it.rot = 0; it.fx = it.fy = false;
    const a = it.type === 'image' && assets.get(it.asset); if (a) { it.w = a.w; it.h = a.h; }
  }
  commit(); render();
}
function reorder(front) {
  const s = new Set(sel); if (!s.size) return;
  const a = doc.items.filter((i) => s.has(i.id)), b = doc.items.filter((i) => !s.has(i.id));
  doc.items = front ? [...b, ...a] : [...a, ...b];
  commit(); render();
}
function groupSel() {
  const its = selItems(); if (!its.length) return;
  const g = { id: uid() };
  doc.groups.push(g); for (const it of its) it.group = g.id;
  commit(); render();
}
function ungroupSel() {
  const its = selItems().filter((i) => i.group); if (!its.length) return;
  for (const it of its) it.group = null;
  commit(); render();
}
function connect() {
  const ids = sel.filter(item); if (ids.length < 2) return toast('Chọn ít nhất 2 ảnh để nối mũi tên');
  for (let i = 0; i < ids.length - 1; i++) {
    const from = ids[i], to = ids[i + 1];
    if (!doc.arrows.some((a) => a.from === from && a.to === to)) doc.arrows.push({ id: uid(), from, to });
  }
  commit(); render();
}
function cloneItems(src, dx, dy) {
  const idMap = new Map(), gMap = new Map(), out = [];
  for (const o of src.items) {
    const it = { ...o, id: uid(), cx: o.cx + dx, cy: o.cy + dy };
    if (it.group) {
      if (!gMap.has(it.group)) { const g = src.groups.find((x) => x.id === it.group); const ng = g ? { id: uid() } : null; gMap.set(it.group, ng); if (ng) doc.groups.push(ng); }
      it.group = gMap.get(it.group) ? gMap.get(it.group).id : null;
    }
    idMap.set(o.id, it.id); out.push(it); doc.items.push(it);
  }
  for (const a of src.arrows) doc.arrows.push({ id: uid(), from: idMap.get(a.from), to: idMap.get(a.to) });
  sel = out.map((i) => i.id); selArrow = null;
  commit(); render();
}
function snapshotSel() {
  const its = selItems(); if (!its.length) return null;
  const s = new Set(sel);
  return JSON.parse(JSON.stringify({ items: its, groups: doc.groups, arrows: doc.arrows.filter((a) => s.has(a.from) && s.has(a.to)) }));
}
function duplicate() { const s = snapshotSel(); if (s) cloneItems(s, 24 / view.z, 24 / view.z); }
function copySel() {
  clip = snapshotSel(); if (!clip) return;
  try { navigator.clipboard.writeText(CLIP_MARK).catch(() => {}); } catch { /* bỏ qua */ }
}
function pasteClip() {
  if (!clip) return;
  const b = aabb(clip.items), p = s2w(lastMouse.x, lastMouse.y);
  cloneItems(clip, p.x - b.cx, p.y - b.cy);
}
function fitView(its, maxZ) {
  if (!its.length) { view = { x: innerWidth / 2, y: innerHeight / 2, z: 1 }; return applyView(); }
  const b = aabb(its);
  const z = clamp(Math.min(maxZ, (innerWidth - 80) / Math.max(b.w, 1), (innerHeight - 80) / Math.max(b.h, 1)), 0.02, 40);
  view = { z, x: innerWidth / 2 - b.cx * z, y: innerHeight / 2 - b.cy * z };
  applyView();
}
function setPin(on) { settings.alwaysOnTop = on; pinBtn.classList.toggle('on', on); api.setAlwaysOnTop(on); }
pinBtn.addEventListener('click', () => setPin(!settings.alwaysOnTop));

/* ================= file .mref ================= */
const MAGIC = [0x4d, 0x52, 0x45, 0x46]; // "MREF"
async function buildFile() {
  const used = [...new Set(doc.items.filter((i) => i.type === 'image').map((i) => i.asset))].filter((id) => assets.has(id));
  const bufs = [], meta = []; let off = 0;
  for (const id of used) {
    const a = assets.get(id), b = new Uint8Array(await a.blob.arrayBuffer());
    meta.push({ id, mime: a.mime, name: a.name, w: a.w, h: a.h, offset: off, size: b.length });
    bufs.push(b); off += b.length;
  }
  const json = new TextEncoder().encode(JSON.stringify({ app: 'M Ref', format: 1, doc, view, assets: meta }));
  const out = new Uint8Array(12 + json.length + off);
  out.set(MAGIC, 0); out[4] = 1;
  new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12);
  let p = 12 + json.length; for (const b of bufs) { out.set(b, p); p += b.length; }
  return out;
}
function parseFile(u8) {
  if (u8.length < 12 || MAGIC.some((m, i) => u8[i] !== m)) throw new Error('bad');
  const len = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(8, true);
  const data = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + len)));
  const base = 12 + len, num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const newAssets = new Map();
  for (const a of data.assets || []) {
    if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(a.mime)) continue;
    const blob = new Blob([u8.slice(base + a.offset, base + a.offset + a.size)], { type: a.mime });
    newAssets.set(String(a.id), { blob, url: URL.createObjectURL(blob), mime: a.mime, name: String(a.name || 'image'), w: num(a.w, 100), h: num(a.h, 100) });
  }
  const d = data.doc || {};
  const items = (d.items || []).filter((i) => i && (i.type === 'text' || (i.type === 'image' && newAssets.has(String(i.asset))))).map((i) => {
    const o = { id: String(i.id), type: i.type, cx: num(i.cx, 0), cy: num(i.cy, 0), w: Math.max(1, num(i.w, 100)), h: Math.max(1, num(i.h, 100)), rot: num(i.rot, 0), fx: !!i.fx, fy: !!i.fy, group: i.group ? String(i.group) : null };
    if (i.type === 'image') o.asset = String(i.asset);
    else { o.html = sanitize(String(i.html || '')); o.size = clamp(num(i.size, 22), 4, 4000); o.color = /^#[0-9a-f]{3,8}$/i.test(i.color) ? i.color : '#E8E9EC'; }
    return o;
  });
  return {
    assets: newAssets,
    doc: {
      items,
      groups: (d.groups || []).map((g) => ({ id: String(g.id) })),
      arrows: (d.arrows || []).map((a) => ({ id: String(a.id), from: String(a.from), to: String(a.to) })),
    },
    view: data.view && num(data.view.z, 0) > 0 ? { x: num(data.view.x, 0), y: num(data.view.y, 0), z: clamp(num(data.view.z, 1), 0.02, 40) } : null,
  };
}
function resetBoard(next) {
  endEdit();
  for (const a of assets.values()) URL.revokeObjectURL(a.url);
  assets.clear(); for (const el of els.values()) el.remove(); els.clear();
  if (next) for (const [k, v] of next.assets) assets.set(k, v);
  doc = next ? next.doc : { items: [], groups: [], arrows: [] };
  sel = []; selArrow = null; undoStack.length = 0; redoStack.length = 0;
  normalize(); lastSnap = JSON.stringify(doc); dirty = false;
}
function loadData(res) {
  if (!res) return;
  let parsed;
  try { parsed = parseFile(new Uint8Array(res.data.buffer || res.data, res.data.byteOffset || 0, res.data.byteLength)); }
  catch { return toast('File này không mở được'); }
  resetBoard(parsed); filePath = res.path;
  render();
  if (parsed.view) { view = parsed.view; applyView(); } else fitView(doc.items, 1);
}
async function save(as) {
  endEdit();
  try {
    const data = await buildFile();
    const p = await api.saveFile(as ? null : filePath, data, filePath ? filePath.split(/[\\/]/).pop() : 'ref.mref');
    if (!p) return false;
    filePath = p; dirty = false; updateInfo(); toast('Đã lưu');
    return true;
  } catch { toast('Không lưu được file'); return false; }
}
async function okToDiscard() {
  endEdit();
  if (!dirty || !doc.items.length) return true;
  const r = await ask('Lưu thay đổi?', 'Bảng hiện tại có thay đổi chưa lưu.', [['Huỷ', 'cancel'], ['Không lưu', 'no'], ['Lưu', 'yes', true]]);
  if (r === 'yes') return save(false);
  return r === 'no';
}
async function openFile() { if (await okToDiscard()) loadData(await api.openDialog()); }
async function openPath(p) { if (p && await okToDiscard()) loadData(await api.readFile(p)); }
async function newBoard() { if (!(await okToDiscard())) return; resetBoard(null); filePath = null; render(); fitView([], 1); }
async function quit() { if (await okToDiscard()) api.closeNow(); }
api.onCloseRequest(quit);
api.onOpenPath(openPath);

/* ================= con trỏ ================= */
stage.addEventListener('pointerdown', (e) => {
  closeMenu();
  lastMouse = { x: e.clientX, y: e.clientY };
  const t = e.target;
  const editEl = editingId && els.get(editingId);
  if (editEl && editEl.contains(t) && e.button === 0) return;        // đang gõ chữ
  if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
  endEdit();

  if (e.button === 2) { drag = { type: 'right', sx: e.screenX, sy: e.screenY, moved: false, target: t }; }
  else if (e.button === 1 || (e.button === 0 && spaceDown)) { e.preventDefault(); drag = { type: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; stage.classList.add('panning'); }
  else if (e.button === 0) {
    const w = s2w(e.clientX, e.clientY);
    const start = () => selItems().map((it) => ({ it, cx: it.cx, cy: it.cy, w: it.w, h: it.h, rot: it.rot, size: it.size }));
    const mod = e.ctrlKey && e.shiftKey ? 'mscale' : e.ctrlKey ? 'rotate' : e.altKey && e.shiftKey ? 'mflip' : null;
    if (mod) {
      e.preventDefault();
      const mel = t.closest('.item'), mpn = t.closest('.gpanel');
      if (mel && !sel.includes(mel.dataset.id)) setSel([mel.dataset.id]);
      else if (!mel && mpn) { const ids = doc.items.filter((i) => i.group === mpn.dataset.g).map((i) => i.id); if (!ids.every((id) => sel.includes(id))) setSel(ids); }
      if (sel.length) {
        const b = aabb(selItems());
        drag = { type: mod, x: e.clientX, y: e.clientY, cx: b.cx, cy: b.cy, ax: b.cx, ay: b.cy, a0: Math.atan2(w.y - b.cy, w.x - b.cx), start: start() };
      }
    } else if (t.classList.contains('h') && frameInfo) {
      const k = +t.dataset.h, sg = [[-1, -1], [1, -1], [1, 1], [-1, 1]][(k + 2) % 4];
      const a = rotv(sg[0] * frameInfo.w / 2, sg[1] * frameInfo.h / 2, frameInfo.rot);
      const ax = frameInfo.cx + a.x, ay = frameInfo.cy + a.y;
      drag = { type: 'scale', ax, ay, d0: Math.max(1e-6, Math.hypot(w.x - ax, w.y - ay)), start: start() };
    } else if (t.classList.contains('rot') && frameInfo) {
      drag = { type: 'rotate', cx: frameInfo.cx, cy: frameInfo.cy, a0: Math.atan2(w.y - frameInfo.cy, w.x - frameInfo.cx), start: start() };
    } else {
      const el = t.closest('.item'), lab = t.closest('.gpanel'), ar = t.closest('g[data-a]');
      if (ar) { sel = []; selArrow = ar.dataset.a; renderOverlays(); }
      else if (el || lab) {
        const ids = lab ? doc.items.filter((i) => i.group === lab.dataset.g).map((i) => i.id) : [el.dataset.id];
        if (e.shiftKey) setSel(ids.every((id) => sel.includes(id)) ? sel.filter((id) => !ids.includes(id)) : [...sel, ...ids]);
        else if (!ids.every((id) => sel.includes(id))) setSel(ids);
        else { selArrow = null; renderOverlays(); }
        drag = { type: 'move', x: e.clientX, y: e.clientY, moved: false, start: start() };
      } else {
        if (!e.shiftKey) setSel([]);
        drag = { type: 'marquee', x: e.clientX, y: e.clientY, base: [...sel] };
      }
    }
  }
  if (drag) stage.setPointerCapture(e.pointerId);
});

stage.addEventListener('pointermove', (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
  if (!drag) return;
  const d = drag, w = s2w(e.clientX, e.clientY);
  if (d.type === 'right') {
    if (!d.moved && Math.hypot(e.screenX - d.sx, e.screenY - d.sy) > 4) { d.moved = true; api.dragStart(); }
  } else if (d.type === 'pan') {
    view.x = d.vx + e.clientX - d.x; view.y = d.vy + e.clientY - d.y; applyView();
  } else if (d.type === 'move') {
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    for (const s of d.start) { s.it.cx = s.cx + dx / view.z; s.it.cy = s.cy + dy / view.z; place(s.it, els.get(s.it.id)); }
    renderOverlays();
  } else if (d.type === 'mflip') {
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.done && Math.max(Math.abs(dx), Math.abs(dy)) > 24) { d.done = true; flip(Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'); }
  } else if (d.type === 'scale' || d.type === 'mscale') {
    const k = d.type === 'mscale' ? clamp(Math.exp((e.clientX - d.x) * 0.006), 0.01, 100) : Math.max(0.01, Math.hypot(w.x - d.ax, w.y - d.ay) / d.d0);
    for (const s of d.start) {
      const it = s.it;
      it.cx = d.ax + (s.cx - d.ax) * k; it.cy = d.ay + (s.cy - d.ay) * k;
      if (it.type === 'text') it.size = clamp(s.size * k, 4, 4000); else { it.w = Math.max(4, s.w * k); it.h = Math.max(4, s.h * k); }
      place(it, els.get(it.id));
    }
    d.moved = true; renderOverlays();
  } else if (d.type === 'rotate') {
    let deg = (Math.atan2(w.y - d.cy, w.x - d.cx) - d.a0) * 180 / Math.PI;
    if (e.shiftKey && !e.ctrlKey) deg = Math.round(deg / 15) * 15;
    for (const s of d.start) {
      const p = rotv(s.cx - d.cx, s.cy - d.cy, deg);
      s.it.cx = d.cx + p.x; s.it.cy = d.cy + p.y; s.it.rot = s.rot + deg;
      place(s.it, els.get(s.it.id));
    }
    d.moved = true; renderOverlays();
  } else if (d.type === 'marquee') {
    const x = Math.min(d.x, e.clientX), y = Math.min(d.y, e.clientY), mw = Math.abs(e.clientX - d.x), mh = Math.abs(e.clientY - d.y);
    marquee.hidden = false;
    Object.assign(marquee.style, { left: x + 'px', top: y + 'px', width: mw + 'px', height: mh + 'px' });
    const a = s2w(x, y), b = s2w(x + mw, y + mh), hit = [];
    for (const it of doc.items) { const r = aabb([it]); if (r.x < b.x && r.x + r.w > a.x && r.y < b.y && r.y + r.h > a.y) hit.push(it.id); }
    sel = [...new Set([...d.base, ...hit])]; renderOverlays();
  }
});

function endDrag(e) {
  if (!drag) return;
  const d = drag; drag = null;
  stage.classList.remove('panning'); marquee.hidden = true;
  if (d.type === 'right') {
    if (d.moved) api.dragEnd();
    else if (e.type === 'pointerup') {
      const el = d.target.closest && d.target.closest('.item'), ar = d.target.closest && d.target.closest('g[data-a]');
      if (ar) { sel = []; selArrow = ar.dataset.a; renderOverlays(); }
      else if (el && !sel.includes(el.dataset.id)) setSel([el.dataset.id]);
      else if (!el && d.target.closest && d.target.closest('.gpanel')) setSel(doc.items.filter((i) => i.group === d.target.closest('.gpanel').dataset.g).map((i) => i.id));
      openMenu(e.clientX, e.clientY);
    }
  } else if (d.moved && d.type !== 'marquee') { commit(); render(); }
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('lostpointercapture', endDrag);
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('blur', () => { spaceDown = false; stage.classList.remove('pan'); });

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const z = clamp(view.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 0.02, 40), k = z / view.z;
  view.x = e.clientX - (e.clientX - view.x) * k; view.y = e.clientY - (e.clientY - view.y) * k; view.z = z;
  applyView();
}, { passive: false });

stage.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.item'); if (!el || editingId) return;
  const it = item(el.dataset.id); if (!it) return;
  if (it.type === 'text') startEdit(it, false); else fitView([it], 8);
});

/* ================= kéo thả, dán ================= */
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropEl.hidden = false; });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropEl.hidden = true; });
window.addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; dropEl.hidden = true;
  const at = s2w(e.clientX, e.clientY), files = [...e.dataTransfer.files];
  const mref = files.find((f) => /\.mref$/i.test(f.name));
  if (mref) {
    const p = api.pathForFile(mref);
    if (p) return openPath(p);
    if (await okToDiscard()) loadData({ path: null, data: new Uint8Array(await mref.arrayBuffer()) });
    return;
  }
  const imgs = files.filter(isImageFile);
  if (imgs.length) return addImages(imgs.map((f) => ({ blob: f, name: f.name })), at);
  const html = e.dataTransfer.getData('text/html'), m = html && html.match(/<img[^>]+src="([^"]+)"/i);
  const url = (m && m[1].replace(/&amp;/g, '&')) || e.dataTransfer.getData('text/uri-list').split('\n')[0];
  if (/^data:image\//.test(url)) { try { const b = await (await fetch(url)).blob(); return addImages([{ blob: b, name: 'image' }], at); } catch { /* bỏ qua */ } }
  if (/^https?:/.test(url)) { const r = await api.fetchImage(url.trim()); if (r) return addImages([r], at); }
  toast('Chỉ nhận ảnh PNG, JPG, GIF');
});
document.addEventListener('paste', (e) => {
  const ae = document.activeElement;
  if (ae && ae.isContentEditable) {           // đang gõ: chỉ dán chữ thường
    e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); return;
  }
  if (!modal.hidden) return;
  e.preventDefault();
  const at = s2w(lastMouse.x, lastMouse.y), imgs = [...e.clipboardData.files].filter(isImageFile);
  if (imgs.length) return addImages(imgs.map((f) => ({ blob: f, name: f.name || 'clipboard.png' })), at);
  const text = e.clipboardData.getData('text/plain');
  if (clip && (text === CLIP_MARK || !text)) return pasteClip();
  if (text.trim()) {
    const it = { id: uid(), type: 'text', html: esc(text.slice(0, 5000)).replace(/\r?\n/g, '<br>'), size: Math.max(4, 22 / view.z), color: settings.textColor || '#E8E9EC', cx: at.x, cy: at.y, w: 0, h: 0, rot: 0, fx: false, fy: false, group: null };
    doc.items.push(it); sel = [it.id]; selArrow = null; render(); commit(); render();
  }
});

/* ================= menu chuột phải ================= */
const CMD = {
  open: openFile, save: () => save(false), saveAs: () => save(true), newBoard,
  addImages: async () => addImages(await api.pickImages(), viewCenter()),
  addText: () => addText(s2w(lastMouse.x, lastMouse.y)), arrow: connect,
  alL: () => alignCmd('l'), alCH: () => alignCmd('ch'), alR: () => alignCmd('r'), alT: () => alignCmd('t'), alCV: () => alignCmd('cv'), alB: () => alignCmd('b'),
  dH: () => alignCmd('dh'), dV: () => alignCmd('dv'), pack,
  flipH: () => flip('h'), flipV: () => flip('v'), rotL: () => rotateBy(-90), rotR: () => rotateBy(90), reset: resetXf,
  front: () => reorder(true), back: () => reorder(false),
  group: groupSel, ungroup: ungroupSel, del, dup: duplicate,
  undo, redo, selectAll: () => setSel(doc.items.map((i) => i.id)),
  fit: () => fitView(sel.length ? selItems() : doc.items, 1), z100: () => { const c = viewCenter(); view.z = 1; view.x = innerWidth / 2 - c.x; view.y = innerHeight / 2 - c.y; applyView(); },
  full: () => api.toggleFullscreen(), min: () => api.minimize(), pin: () => setPin(!settings.alwaysOnTop),
  settings: openSettings, update: updateCmd, whatsnew: openWhatsNew, quit,
};
function updateLabel() {
  if (upd.state === 'checking') return 'Đang kiểm tra…';
  if (upd.state === 'available') return `Cập nhật lên v${upd.version}`;
  if (upd.state === 'downloading') return `Đang tải bản mới ${upd.percent || 0}%`;
  if (upd.state === 'downloaded') return 'Khởi động lại để cài bản mới';
  return 'Kiểm tra bản cập nhật';
}
function menuSpec() {
  const n = sel.length, any = n > 0 || !!selArrow, multi = n > 1, inGroup = selItems().some((i) => i.group);
  const S = { sep: true };
  return [
    { label: 'Mở file…', cmd: 'open', key: 'Ctrl+O' },
    { label: 'Lưu', cmd: 'save', key: 'Ctrl+S' },
    { label: 'Lưu thành…', cmd: 'saveAs', key: 'Ctrl+Shift+S' },
    { label: 'Bảng mới', cmd: 'newBoard', key: 'Ctrl+N' },
    { label: 'Thêm ảnh…', cmd: 'addImages', key: 'Ctrl+V để dán' }, S,
    { label: 'Thêm chữ', cmd: 'addText', key: 'T' },
    { label: 'Nối mũi tên các ảnh đang chọn', cmd: 'arrow', key: 'A', off: !multi }, S,
    { label: 'Căn chỉnh', off: !multi, sub: [
      { label: 'Căn trái', cmd: 'alL' }, { label: 'Căn giữa ngang', cmd: 'alCH' }, { label: 'Căn phải', cmd: 'alR' }, S,
      { label: 'Căn trên', cmd: 'alT' }, { label: 'Căn giữa dọc', cmd: 'alCV' }, { label: 'Căn dưới', cmd: 'alB' }, S,
      { label: 'Dàn đều ngang', cmd: 'dH' }, { label: 'Dàn đều dọc', cmd: 'dV' }, { label: 'Xếp gọn thành lưới', cmd: 'pack', key: 'Ctrl+P' }] },
    { label: 'Biến đổi', off: !n, sub: [
      { label: 'Lật ngang', cmd: 'flipH', key: 'H' }, { label: 'Lật dọc', cmd: 'flipV', key: 'V' }, S,
      { label: 'Xoay trái 90°', cmd: 'rotL', key: '[' }, { label: 'Xoay phải 90°', cmd: 'rotR', key: ']' }, S,
      { label: 'Đặt lại xoay / tỉ lệ', cmd: 'reset' }, { label: 'Đưa lên trên cùng', cmd: 'front' }, { label: 'Đưa xuống dưới cùng', cmd: 'back' }, S,
      { label: 'Nhân đôi', cmd: 'dup', key: 'Ctrl+D' }] },
    { label: 'Group', off: !n, sub: [
      { label: 'Tạo group', cmd: 'group', key: 'Ctrl+G' }, { label: 'Rã group', cmd: 'ungroup', key: 'Ctrl+Shift+G', off: !inGroup }] },
    { label: 'Xoá', cmd: 'del', key: 'Del', off: !any, cls: 'danger' }, S,
    { label: 'Khung nhìn', sub: [
      { label: 'Xem vừa tất cả', cmd: 'fit', key: 'Ctrl+0' }, { label: 'Về 100%', cmd: 'z100', key: 'Ctrl+1' }, S,
      { label: 'Toàn màn hình', cmd: 'full', key: 'Ctrl+F' }, { label: 'Thu nhỏ xuống taskbar', cmd: 'min', key: 'Ctrl+M' }, S,
      { label: 'Hoàn tác', cmd: 'undo', key: 'Ctrl+Z', off: !undoStack.length }, { label: 'Làm lại', cmd: 'redo', key: 'Ctrl+Y', off: !redoStack.length }] },
    { label: 'Luôn nằm trên', cmd: 'pin', key: 'Ctrl+T', chk: settings.alwaysOnTop },
    { label: 'Cài đặt…', cmd: 'settings' },
    { label: 'Thoát', cmd: 'quit', key: 'Ctrl+Q' },
  ];
}
function menuHtml(spec) {
  return spec.map((m) => m.sep ? '<div class="ms"></div>' :
    `<div class="mi ${m.off ? 'off' : ''} ${m.chk ? 'chk' : ''} ${m.cls || ''}" ${m.cmd ? `data-cmd="${m.cmd}"` : ''}>${esc(m.label)}` +
    (m.sub ? `<span class="chev">›</span><div class="sub">${menuHtml(m.sub)}</div>` : m.key ? `<kbd>${esc(m.key)}</kbd>` : '') + '</div>').join('');
}
function openMenu(x, y) {
  const spec = menuSpec();
  menu.innerHTML = `<div class="mhead"><img src="../build/icon.png" alt=""><span class="mname"><span class="m">M</span> <span class="a">Ref</span></span>` +
    `<span class="ver">v${esc(appVersion)}</span>${upd.state === 'latest' ? '<span class="latest">latest</span>' : ''}</div>` + menuHtml(spec);
  menu.hidden = false;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (api.nativeMenu && (mh > innerHeight - 8 || mw + 220 > innerWidth - 8)) {   // cửa sổ quá nhỏ: dùng menu của Windows
    menu.hidden = true;
    const head = { label: `M Ref v${appVersion}${upd.state === 'latest' ? ' · latest' : ''}`, off: true };
    return api.nativeMenu([head, { sep: true }, ...spec]);
  }
  const left = clamp(x, 4, innerWidth - mw - 4), top = clamp(y, 4, innerHeight - mh - 4);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  for (const s of menu.querySelectorAll('.sub')) {
    s.classList.toggle('left', left + mw + 216 > innerWidth);
    s.style.display = 'block';
    const r = s.parentElement.getBoundingClientRect();
    s.classList.toggle('up', r.top + s.offsetHeight > innerHeight - 4);
    s.style.display = '';
  }
  menu.style.animation = 'none'; void menu.offsetWidth; menu.style.animation = '';
}
function closeMenu() { menu.hidden = true; }
menu.addEventListener('click', (e) => { const m = e.target.closest('.mi'); if (!m || !m.dataset.cmd || !menu.contains(m)) return; if (e.target.closest('.mi') !== m) return; closeMenu(); run(m.dataset.cmd); });
window.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.button !== 2) closeMenu(); }, true);
function run(cmd) { const f = CMD[cmd]; if (f) Promise.resolve(f()).catch(() => {}); }
if (api.onMenuCmd) api.onMenuCmd(run);

/* ================= modal ================= */
let modalClose = null;
function showModal(html, onClose) {
  closeModal();
  modal.innerHTML = `<div class="dlg" role="dialog">${html}</div>`; modal.hidden = false;
  modalClose = onClose || null;
  const f = modal.querySelector('[autofocus]') || modal.querySelector('.x'); if (f) f.focus();
  return modal.firstChild;
}
function closeModal(val) { if (modal.hidden) return; modal.hidden = true; modal.innerHTML = ''; const f = modalClose; modalClose = null; if (f) f(val); }
modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeModal(); });
modal.addEventListener('click', (e) => { if (e.target.closest('.x')) closeModal(); });
function ask(title, text, buttons) {
  return new Promise((res) => {
    const d = showModal(`<header>${esc(title)}<button class="x" title="Đóng (Esc)">✕</button></header><div class="body">${esc(text)}</div>` +
      `<footer>${buttons.map(([l, v, p]) => `<button class="btn ${p ? 'primary' : ''}" data-v="${v}" ${p ? 'autofocus' : ''}>${esc(l)}</button>`).join('')}</footer>`, (v) => res(v || 'cancel'));
    d.querySelector('footer').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) closeModal(b.dataset.v); });
  });
}
const fmtDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
function openWhatsNew() {
  const w = whatsnew || { version: appVersion, new: [], improved: [], fixed: [] };
  const sec = (t, a) => (a && a.length ? `<h3>${t}</h3><ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  const d = showModal(`<header>What's new <span class="sub2">v${esc(w.version)}${w.date ? ' · ' + fmtDate(w.date) : ''}</span><button class="x" title="Đóng (Esc)">✕</button></header>` +
    `<div class="body">${upd.version && upd.state !== 'latest' ? `<div class="newver">Có bản mới v${esc(upd.version)} <button class="btn" data-upd>Cập nhật</button></div>` : ''}` +
    `${sec('Mới', w.new)}${sec('Cải thiện', w.improved)}${sec('Sửa lỗi', w.fixed)}</div>`);
  const b = d.querySelector('[data-upd]'); if (b) b.onclick = () => { closeModal(); updateCmd(); };
}
const BGS = ['#2B2D31', '#1F2126', '#000000', '#4A4D55', '#8D929C', '#E8E9EC'];
function applyLook() {
  const bg = /^#[0-9a-f]{6}$/i.test(settings.bg) ? settings.bg : '#2B2D31';
  const lum = (parseInt(bg.slice(1, 3), 16) * 299 + parseInt(bg.slice(3, 5), 16) * 587 + parseInt(bg.slice(5, 7), 16) * 114) / 1000;
  document.documentElement.style.setProperty('--stage', bg);
  document.documentElement.style.setProperty('--dot', lum > 140 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.045)');
  stage.classList.toggle('grid', !!settings.grid);
}
function openSettings() {
  const pct = Math.round((settings.opacity || 1) * 100);
  const d = showModal(`<header>Cài đặt<button class="x" title="Đóng (Esc)">✕</button></header><div class="body">
    <h3>Giao diện</h3>
    <div class="row"><span>Màu nền canvas</span><div class="bgs">${BGS.map((c) => `<button class="sw ${c.toLowerCase() === String(settings.bg).toLowerCase() ? 'on' : ''}" data-bg="${c}" style="background:${c}" title="${c}"></button>`).join('')}
      <label class="sw pick" title="Chọn màu khác"><input type="color" id="bgpick" value="${esc(settings.bg)}"></label></div></div>
    <label class="row"><span>Hiện lưới chấm</span><input type="checkbox" id="sgrid" ${settings.grid ? 'checked' : ''}></label>
    <div class="row"><span>Độ rõ cửa sổ</span><input type="range" id="sop" min="20" max="100" value="${pct}" style="--fill:${(pct - 20) / 0.8}%"><span class="val" id="sopv">${pct}%</span></div>
    <label class="row"><span>Luôn nằm trên các cửa sổ khác</span><input type="checkbox" id="spin" ${settings.alwaysOnTop ? 'checked' : ''}></label>
    <h3>Phiên bản</h3>
    <div class="row"><span>M Ref v${esc(appVersion)} ${upd.state === 'latest' ? '<span class="latest">latest</span>' : ''}</span>
      <button class="btn" id="supd">${esc(updateLabel())}</button><button class="btn" id="swn">What's new</button></div>
    <h3>Phím tắt</h3>
    <div class="keys">
      <kbd>Chuột phải</kbd><span>Mở menu</span><kbd>Giữ chuột phải + kéo</kbd><span>Di chuyển cửa sổ</span>
      <kbd>Lăn chuột</kbd><span>Phóng to / thu nhỏ</span><kbd>Chuột giữa / Space + kéo</kbd><span>Di chuyển khung nhìn</span>
      <kbd>Bấm đúp vào ảnh</kbd><span>Phóng ảnh đó ra giữa</span><kbd>Shift + bấm</kbd><span>Chọn thêm / bỏ chọn</span>
      <kbd>Bấm vào nền group</kbd><span>Chọn cả group</span><kbd>Shift khi xoay</kbd><span>Xoay theo nấc 15°</span>
      <kbd>Ctrl + kéo</kbd><span>Xoay ảnh đang chọn</span><kbd>Ctrl+Shift + kéo ngang</kbd><span>Scale ảnh đang chọn</span>
      <kbd>Alt+Shift + kéo ngang / dọc</kbd><span>Lật trái phải / lật trên dưới</span>
      <kbd>Ctrl+F</kbd><span>Toàn màn hình</span><kbd>Ctrl+T</kbd><span>Luôn nằm trên</span>
      <kbd>Ctrl+Z / Ctrl+Y</kbd><span>Hoàn tác / làm lại</span><kbd>Ctrl+D</kbd><span>Nhân đôi</span>
    </div></div>`);
  const setBg = (c) => { settings.bg = c; api.setSettings({ bg: c }); applyLook(); d.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('on', b.dataset.bg.toLowerCase() === c.toLowerCase())); };
  d.querySelector('.bgs').addEventListener('click', (e) => { const b = e.target.closest('[data-bg]'); if (b) setBg(b.dataset.bg); });
  d.querySelector('#bgpick').oninput = (e) => setBg(e.target.value);
  d.querySelector('#sgrid').onchange = (e) => { settings.grid = e.target.checked; api.setSettings({ grid: settings.grid }); applyLook(); };
  d.querySelector('#sop').oninput = (e) => { const v = +e.target.value; e.target.style.setProperty('--fill', (v - 20) / 0.8 + '%'); d.querySelector('#sopv').textContent = v + '%'; settings.opacity = v / 100; api.setOpacity(v / 100); };
  d.querySelector('#spin').onchange = (e) => setPin(e.target.checked);
  d.querySelector('#supd').onclick = () => { closeModal(); updateCmd(); };
  d.querySelector('#swn').onclick = openWhatsNew;
}

/* ================= cập nhật ================= */
const updBtn = $('#upd');
function syncUpd() {
  updBtn.classList.toggle('spin', upd.state === 'checking' || upd.state === 'downloading');
  updBtn.classList.toggle('new', upd.state === 'available' || upd.state === 'downloaded');
  updBtn.classList.toggle('latest', upd.state === 'latest');
  const tip = { checking: 'Đang kiểm tra…', available: `Có bản mới v${upd.version} – bấm để cập nhật`, downloading: `Đang tải bản mới ${upd.percent || 0}%`, downloaded: 'Đang cài bản mới…', latest: 'Đã là bản mới nhất' }[upd.state];
  updBtn.title = 'Kiểm tra cập nhật' + (tip ? ' · ' + tip : '');
  const note = { available: [`Có bản mới v${upd.version}`, 'Cập nhật'], downloading: [`Đang tải bản mới ${upd.percent || 0}%`], downloaded: ['Đang cài bản mới, app sẽ tự mở lại…'] }[upd.state];
  updnote.hidden = !note;
  if (note) updnote.innerHTML = `<i class="dot"></i><span>${esc(note[0])}</span>${note[1] ? `<button class="btn primary">${note[1]}</button>` : ''}`;
}
async function updateCmd() {
  if (upd.state === 'checking' || upd.state === 'downloading') return;
  if (upd.state === 'available') {            // bấm 1 lần: tải xong tự cài và tự mở lại
    if (!(await okToDiscard())) return;
    upd.state = 'downloading'; upd.percent = 0; syncUpd();
    return api.downloadUpdate();
  }
  if (upd.state === 'downloaded') { if (await okToDiscard()) api.installUpdate(); return; }
  manualCheck = true;
  const r = await api.checkUpdate();
  if (r === 'dev') { manualCheck = false; toast('Chỉ kiểm tra được ở bản đã cài đặt'); }
}
api.onUpdate(async (u) => {
  upd = { ...upd, ...u };
  if (u.state === 'latest') { upd.version = null; if (manualCheck) toast('Bạn đang dùng bản mới nhất'); manualCheck = false; }
  if (u.state === 'error') { if (manualCheck) toast('Không kiểm tra được, thử lại sau'); manualCheck = false; upd.state = 'idle'; }
  if (u.state === 'available') manualCheck = false;
  syncUpd();
  if (u.state === 'downloaded' && await okToDiscard()) api.installUpdate();
});
updnote.addEventListener('click', (e) => { if (e.target.closest('button')) updateCmd(); });
updBtn.addEventListener('click', updateCmd);

/* ================= bàn phím ================= */
window.addEventListener('keydown', (e) => {
  const ae = document.activeElement, typing = !!editingId || (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type !== 'checkbox' && ae.type !== 'range'));
  const ctrl = e.ctrlKey || e.metaKey, c = e.code, go = (cmd) => { e.preventDefault(); closeMenu(); run(cmd); };
  if (e.key === 'Escape') {
    if (!modal.hidden) return closeModal();
    if (!menu.hidden) return closeMenu();
    if (editingId) return endEdit();
    if (sel.length || selArrow) return setSel([]);
    if (innerWidth >= screen.width && innerHeight >= screen.height) api.toggleFullscreen();
    return;
  }
  if (ctrl) {                                   // phím tắt dùng được cả khi đang gõ chữ
    if (c === 'KeyS') return go(e.shiftKey ? 'saveAs' : 'save');
    if (c === 'KeyO') return go('open');
    if (c === 'KeyF') return go('full');
    if (c === 'KeyT') return go('pin');
    if (c === 'KeyQ') return go('quit');
    if (c === 'KeyM') return go('min');
    if (c === 'KeyN') return go('newBoard');
  }
  if (typing || !modal.hidden) return;
  if (c === 'Space') { spaceDown = true; stage.classList.add('pan'); e.preventDefault(); return; }
  if (ctrl) {
    if (c === 'KeyZ') return go(e.shiftKey ? 'redo' : 'undo');
    if (c === 'KeyY') return go('redo');
    if (c === 'KeyG') return go(e.shiftKey ? 'ungroup' : 'group');
    if (c === 'KeyA') return go('selectAll');
    if (c === 'KeyD') return go('dup');
    if (c === 'KeyP') return go('pack');
    if (c === 'KeyC') { copySel(); return; }
    if (c === 'Digit0' || c === 'Numpad0') return go('fit');
    if (c === 'Digit1' || c === 'Numpad1') return go('z100');
    return;
  }
  if (e.altKey) return;
  if (c === 'Delete' || c === 'Backspace') return go('del');
  if (c === 'KeyT') return go('addText');
  if (c === 'KeyA') return go('arrow');
  if (c === 'KeyH') return go('flipH');
  if (c === 'KeyV') return go('flipV');
  if (c === 'BracketLeft') return go('rotL');
  if (c === 'BracketRight') return go('rotR');
  if (c === 'Enter' && sel.length === 1 && item(sel[0]).type === 'text') { e.preventDefault(); return startEdit(item(sel[0]), false); }
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[c];
  if (arrow && sel.length) {
    e.preventDefault();
    const k = (e.shiftKey ? 10 : 1) / view.z;
    for (const it of selItems()) { it.cx += arrow[0] * k; it.cy += arrow[1] * k; }
    commit(); render();
  }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; stage.classList.remove('pan'); } });

/* ================= khởi động ================= */
(async () => {
  const init = await api.getInit();
  appVersion = init.version; whatsnew = init.whatsnew; Object.assign(settings, init.settings || {});
  applyLook(); pinBtn.classList.toggle('on', !!settings.alwaysOnTop);
  applyView(); render();
  if (init.openPath) loadData(await api.readFile(init.openPath));
  if (init.packaged) {
    if (settings.lastSeenVersion && settings.lastSeenVersion !== appVersion) openWhatsNew();   // vừa cập nhật xong: hiện bảng thông báo
    if (settings.lastSeenVersion !== appVersion) { settings.lastSeenVersion = appVersion; api.setSettings({ lastSeenVersion: appVersion }); }
    setTimeout(() => api.checkUpdate(), 2500);
  }
})();

/* Chạy thử trong trình duyệt (không có Electron): thay các lệnh hệ thống bằng bản giả */
function browserStub() {
  const noop = () => {};
  return {
    getInit: async () => ({ version: '0.0.0', packaged: false, settings: {}, openPath: null, whatsnew: null }),
    setSettings: noop, openDialog: async () => null, readFile: async () => null, pickImages: async () => [], fetchImage: async () => null,
    saveFile: async (p, data, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data])); a.download = name; a.click(); return name; },
    pathForFile: () => '', setAlwaysOnTop: noop, setOpacity: noop, toggleFullscreen: noop, minimize: noop, dragStart: noop, dragEnd: noop,
    closeNow: noop, checkUpdate: async () => 'dev', downloadUpdate: noop, installUpdate: noop, onUpdate: noop, onCloseRequest: noop, onOpenPath: noop,
  };
}
window.__mref = { get doc() { return doc; }, get view() { return view; }, get sel() { return sel; }, addImages, buildFile, parseFile, loadData, run };
})();
