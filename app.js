'use strict';

/* ---------- Speicher ----------
   sessions: [{ id, start, end, pauses: [{ s, e }] }]   (alle Zeiten als ms-Zeitstempel)
   active:   { start, pauses: [{ s, e|null }] } | null  (die laufende Schicht)
   settings: { name }
   Es werden nur Zeitstempel gespeichert, deshalb läuft der Timer weiter, auch wenn die App geschlossen ist. */
const KEY = 'shift-v1';
let S = load();
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.sessions)) return { active: null, settings: {}, ...d, settings: { name: '', ...(d.settings || {}) } };
  } catch (e) {}
  return { sessions: [], active: null, settings: { name: '' } };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Speichern fehlgeschlagen'); } }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- Zeit-Helfer ---------- */
const H = 3600000, M = 60000, D = 86400000;
const LONG_SHIFT = 12 * H; // ab hier fragt die App, ob das Stoppen vergessen wurde
const pad = n => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const weekStart = t => { const d = new Date(dayStart(t)); return addDays(d.getTime(), -((d.getDay() + 6) % 7)); };
const monthStart = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const addMonths = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); };
const sameDay = (a, b) => dayStart(a) === dayStart(b);
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
const dur = ms => { const m = Math.round(Math.max(0, ms) / M); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min'; };
const durShort = ms => { const m = Math.round(Math.max(0, ms) / M); return Math.floor(m / 60) + ':' + pad(m % 60); };
const fmt = (t, o) => new Date(t).toLocaleDateString('de-DE', o);
const toDateInput = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const pauseMs = (p, now) => p.reduce((a, x) => a + ((x.e ?? now) - x.s), 0);
const workMs = (x, now = Date.now()) => ((x.end ?? now) - x.start) - pauseMs(x.pauses, now);
const activeAsSession = () => S.active && { id: 'active', start: S.active.start, end: null, pauses: S.active.pauses, live: true };
const allSessions = () => { const a = activeAsSession(); return a ? [...S.sessions, a] : S.sessions; };
// Eine Schicht gehört zu dem Tag, an dem sie begonnen hat.
const sessionsIn = (from, to) => allSessions().filter(x => x.start >= from && x.start < to).sort((a, b) => a.start - b.start);
const total = (list, now = Date.now()) => list.reduce((a, x) => a + workMs(x, now), 0);
const breaks = (list, now = Date.now()) => list.reduce((a, x) => a + pauseMs(x.pauses, now), 0);
const isPaused = () => !!(S.active && S.active.pauses.some(p => p.e == null));

/* ---------- Aktionen ---------- */
function startShift() { S.active = { start: Date.now(), pauses: [] }; save(); haptic(); render(); }
function togglePause() {
  const now = Date.now(), open = S.active.pauses.find(p => p.e == null);
  if (open) {
    open.e = now;
    if (now - open.s < 30000) S.active.pauses.splice(S.active.pauses.indexOf(open), 1); // versehentlich angetippte Pause verwerfen
  } else S.active.pauses.push({ s: now, e: null });
  save(); haptic(); render();
}
function stopShift(end = Date.now()) {
  const a = S.active, open = a.pauses.find(p => p.e == null);
  if (open) open.e = end;
  const sess = { id: uid(), start: a.start, end, pauses: a.pauses.filter(p => p.s < end).map(p => ({ s: p.s, e: Math.min(p.e, end) })) };
  S.sessions.push(sess); S.active = null; save(); haptic(); render();
  toast('Gespeichert · ' + dur(workMs(sess)), 'Rückgängig', () => {
    S.sessions = S.sessions.filter(x => x.id !== sess.id);
    if (open) open.e = null;
    S.active = a; save(); render();
  });
}
function haptic() { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} }

/* ---------- Grundgerüst ---------- */
const ui = { tab: 'today', calMonth: monthStart(Date.now()), selDay: dayStart(Date.now()), statMode: 'week', statRef: Date.now(), day: dayStart(Date.now()) };
const icons = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V12M10 20V6M15 20v-9M20 20V4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5"/></svg>'
};
const TABS = [['today', 'Heute'], ['calendar', 'Kalender'], ['stats', 'Statistik'], ['settings', 'Mehr']];
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function buildTabs() {
  $('#tabs').innerHTML = '<span class="pill"></span>' + TABS.map(([k, l]) => `<button data-tab="${k}" aria-label="${l}">${icons[k]}<span>${l}</span></button>`).join('');
}
function syncTabs() {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const on = $(`#tabs button[data-tab="${ui.tab}"]`), pill = $('#tabs .pill');
  pill.style.width = on.offsetWidth + 'px';
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
}

// anim: 'left' | 'right' | 'fade' lässt die Ansicht hereingleiten
function render(anim) {
  document.body.classList.toggle('paused', isPaused());
  document.body.classList.toggle('working', !!S.active && !isPaused());
  const v = $('#view');
  v.innerHTML = ({ today: viewToday, calendar: viewCalendar, stats: viewStats, settings: viewSettings })[ui.tab]();
  if (anim) { v.classList.remove('enter-left', 'enter-right', 'enter-fade'); void v.offsetWidth; v.classList.add('enter-' + anim); }
  syncTabs();
  if (anim) ring.reset(); else ring.keep();
  tick();
}
function slide(sel, dir) {
  const el = $(sel); if (!el) return;
  el.classList.remove('slide-left', 'slide-right'); void el.offsetWidth; el.classList.add(dir > 0 ? 'slide-left' : 'slide-right');
}

/* ---------- Heute ---------- */
const RING = 2 * Math.PI * 130;
const ring = {
  last: null,
  reset() { this.last = null; },
  keep() { if (this.last === null) this.last = -1; },
  // Ein voller Ring pro gearbeiteter Stunde. Beim Übergang zur nächsten Stunde springt er ohne Animation zurück.
  set(frac) {
    const el = $('#ring'); if (!el) return;
    if (this.last === null) { // Einblenden: Ring füllt sich von null auf den aktuellen Wert
      el.style.transition = 'none'; el.style.strokeDashoffset = RING; void el.getBoundingClientRect();
      el.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.22,.9,.3,1), stroke .5s';
      setTimeout(() => { el.style.transition = ''; }, 1250);
    } else if (this.last < 0 || frac < this.last) { // neu gezeichnet oder neue Stunde: ohne Animation setzen
      el.style.transition = 'none'; el.style.strokeDashoffset = RING * (1 - frac); void el.getBoundingClientRect(); el.style.transition = '';
      this.last = frac; return;
    }
    el.style.strokeDashoffset = RING * (1 - frac);
    this.last = frac;
  }
};
function viewToday() {
  const now = Date.now(), state = !S.active ? 'idle' : isPaused() ? 'paused' : 'running';
  const btns = {
    idle: `<button class="big go" data-act="start"><span class="ic">▶</span>Arbeit starten</button>`,
    running: `<button class="big pause" data-act="pause"><span class="ic">❚❚</span>Pause</button><button class="big stop" data-act="stop"><span class="ic">■</span>Beenden</button>`,
    paused: `<button class="big resume" data-act="pause"><span class="ic">▶</span>Weiter</button><button class="big stop" data-act="stop"><span class="ic">■</span>Beenden</button>`
  }[state];
  const list = sessionsIn(dayStart(now), addDays(dayStart(now), 1));
  const longRun = S.active && now - S.active.start > LONG_SHIFT;
  return `
  <h1>Heute</h1><p class="sub">${fmt(now, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
  ${installHint()}
  ${longRun ? `<div class="glass card warn"><div class="row"><div class="grow"><div class="name">Schicht läuft seit ${dur(now - S.active.start)}</div>
    <div class="meta">Vielleicht vergessen zu beenden? Lege die richtige Endzeit fest.</div></div></div>
    <button class="btn small primary" data-act="finish" style="margin-top:12px">Endzeit festlegen</button></div>` : ''}
  <div class="timer ${state}" id="timer">
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <defs>
        <linearGradient id="g-work" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ff5d6"/><stop offset="1" stop-color="#2fc79a"/></linearGradient>
        <linearGradient id="g-pause" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>
      </defs>
      <circle class="track" cx="150" cy="150" r="130"/>
      <circle class="prog" id="ring" cx="150" cy="150" r="130" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/>
    </svg>
    <div class="center">
      <div class="state"><span class="dot"></span>${{ idle: 'Bereit', running: 'Bei der Arbeit', paused: 'In Pause' }[state]}</div>
      <div class="clock" id="clock">00:00:00</div>
      <div class="since" id="since">${state === 'idle' ? 'Tippe auf Start, wenn du anfängst' : ''}</div>
      ${S.active ? `<button class="edit-start" data-act="editstart">Startzeit ändern</button>` : ''}
    </div>
  </div>
  <div class="controls" data-state="${state}">${btns}</div>
  <div class="hero" style="margin-top:20px">
    <div class="glass"><b id="t-day">0 min</b><span>Heute</span></div>
    <div class="glass"><b id="t-week">0 min</b><span>Diese Woche</span></div>
  </div>
  <h2>Schichten heute</h2>
  ${sessionList(list)}
  <button class="btn block ghost" data-act="add" data-day="${dayStart(now)}">＋ Eintrag nachtragen</button>`;
}

function installHint() {
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false; try { dismissed = localStorage.getItem('shift-hint') === '1'; } catch (e) {}
  if (standalone || dismissed) return '';
  return `<div class="glass card hint"><div class="row"><div class="grow"><div class="name">Als App installieren</div>
    <div class="meta">In Safari auf <b>Teilen</b> und dann <b>Zum Home-Bildschirm</b> tippen.</div></div>
    <button class="x" data-act="hidehint" aria-label="Ausblenden">✕</button></div></div>`;
}

function sessionList(list) {
  if (!list.length) return `<div class="glass empty"><div class="empty-ic">☾</div>Noch keine Schichten</div>`;
  return `<div class="glass list">${list.map((x, i) => {
    const br = pauseMs(x.pauses, Date.now());
    return `<div class="sess ${x.live ? 'live' : ''}" style="--i:${i}" ${x.live ? 'data-act="editstart"' : `data-edit="${x.id}"`}>
      <span class="bar-ic"></span>
      <div class="grow"><div class="name">${hm(x.start)} – ${x.live ? 'jetzt' : hm(x.end)}${!x.live && !sameDay(x.start, x.end) ? ' <small class="plus1">+1</small>' : ''}</div>
      <div class="meta">${br ? 'Pause ' + dur(br) : 'Ohne Pause'}${x.live ? ' · läuft' : ''}</div></div>
      <div class="dur" ${x.live ? 'data-live-dur' : ''}>${dur(workMs(x))}</div>
      ${x.live ? '' : '<span class="chev">›</span>'}
    </div>`;
  }).join('')}</div>`;
}

function tick() {
  const now = Date.now();
  if (dayStart(now) !== ui.day) { // Mitternacht: alles neu zeichnen
    ui.day = dayStart(now); if (ui.selDay === addDays(ui.day, -1)) ui.selDay = ui.day; render(); return;
  }
  if (ui.tab !== 'today') return;
  const c = $('#clock'); if (!c) return;
  const a = activeAsSession();
  if (a) {
    const w = workMs(a, now);
    c.textContent = clock(w);
    ring.set((w % H) / H);
    const br = pauseMs(a.pauses, now), open = a.pauses.find(p => p.e == null);
    $('#since').textContent = open
      ? 'Pause läuft · ' + (now - open.s >= H ? clock(now - open.s) : clock(now - open.s).slice(3))
      : 'Seit ' + hm(a.start) + ' Uhr' + (br ? ' · Pause ' + durShort(br) : '');
    $$('[data-live-dur]').forEach(e => e.textContent = dur(w));
  }
  $('#t-day').textContent = dur(total(sessionsIn(dayStart(now), addDays(dayStart(now), 1)), now));
  $('#t-week').textContent = dur(total(sessionsIn(weekStart(now), addDays(weekStart(now), 7)), now));
}
setInterval(tick, 1000);

/* ---------- Kalender ---------- */
function viewCalendar() {
  const m = ui.calMonth, mt = total(sessionsIn(m, addMonths(m, 1)));
  const isNow = m === monthStart(Date.now());
  return `
  <h1>Kalender</h1><p class="sub">${mt ? dur(mt) + ' gearbeitet im ' + fmt(m, { month: 'long' }) : 'Im ' + fmt(m, { month: 'long' }) + ' noch nichts erfasst'}</p>
  <div class="cal-head"><button data-cal="-1" aria-label="Vorheriger Monat">‹</button>
    <span class="t">${fmt(m, { month: 'long', year: 'numeric' })}</span>
    <button data-cal="1" aria-label="Nächster Monat">›</button></div>
  ${isNow ? '' : '<button class="today-btn" data-act="caltoday">Heute</button>'}
  <div class="glass cal anim" id="cal">${calCells()}</div>
  <div id="day-detail">${dayDetail(ui.selDay)}</div>`;
}
function calCells() {
  const m = ui.calMonth, first = weekStart(m), next = addMonths(m, 1), today = dayStart(Date.now());
  let cells = WD.map(d => `<div class="dow">${d}</div>`).join(''), i = 0;
  for (let d = first; d < next || (new Date(d).getDay() !== 1); d = addDays(d, 1), i++) {
    const list = sessionsIn(d, addDays(d, 1)), t = total(list);
    const cls = ['day', d < m || d >= next ? 'out' : '', list.length ? 'has' : '', d === today ? 'today' : '', d === ui.selDay ? 'sel' : '', list.some(x => x.live) ? 'live' : ''].join(' ');
    cells += `<button class="${cls}" style="--h:${Math.min(t / (10 * H), 1).toFixed(2)};--i:${i}" data-day="${d}">${new Date(d).getDate()}<small>${t >= M ? durShort(t) : ''}</small></button>`;
  }
  return cells;
}
function selectDay(day) {
  if (ui.calMonth !== monthStart(day)) { ui.selDay = day; ui.calMonth = monthStart(day); return render(); }
  ui.selDay = day;
  $$('.day').forEach(b => b.classList.toggle('sel', +b.dataset.day === day));
  const dd = $('#day-detail'); dd.innerHTML = dayDetail(day);
  dd.classList.remove('pop'); void dd.offsetWidth; dd.classList.add('pop');
  haptic();
}

function dayDetail(day) {
  const now = Date.now(), list = sessionsIn(day, addDays(day, 1)), t = total(list, now);
  const head = `<h2>${fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>`;
  const addBtn = `<button class="btn block ghost" data-act="add" data-day="${day}">＋ Eintrag hinzufügen</button>`;
  if (!list.length) return head + `<div class="glass empty"><div class="empty-ic">☾</div>Keine Arbeitszeit erfasst</div>` + addBtn;

  // Skala der Zeitleiste: von der vollen Stunde vor Beginn bis zur vollen Stunde nach Ende.
  const from = Math.floor(list[0].start / H) * H;
  const lastEnd = Math.max(...list.map(x => x.end ?? now));
  const to = Math.max(Math.ceil(lastEnd / H) * H, from + 2 * H);
  const pct = v => ((v - from) / (to - from) * 100).toFixed(2) + '%';
  let segs = '', steps = '', k = 0;
  list.forEach(x => {
    const end = x.end ?? now;
    segs += `<i class="w" style="left:${pct(x.start)};width:calc(${pct(end)} - ${pct(x.start)});--i:${k++}"></i>`;
    steps += `<div class="step"><span class="b w"></span><span class="tm">${hm(x.start)}</span><span>Arbeitsbeginn</span></div>`;
    x.pauses.forEach(p => {
      const pe = p.e ?? now;
      segs += `<i class="p" style="left:${pct(p.s)};width:calc(${pct(pe)} - ${pct(p.s)});--i:${k++}"></i>`;
      steps += `<div class="step"><span class="b p"></span><span class="tm">${hm(p.s)}</span><span>Pause · ${p.e == null ? 'läuft' : dur(pe - p.s)}</span></div>`;
    });
    steps += `<div class="step"><span class="b e"></span><span class="tm">${x.end ? hm(x.end) : 'jetzt'}</span><span>${x.end ? 'Feierabend' : 'Arbeitet noch'}</span></div>`;
  });
  const marks = [], span = (to - from) / H, stepH = span > 12 ? 4 : span > 8 ? 3 : span > 4 ? 2 : 1;
  for (let h = from; h <= to; h += stepH * H) marks.push(`<span>${pad(new Date(h).getHours())}</span>`);
  const br = breaks(list, now);
  return head + `
  <div class="glass tl">
    <div class="name big-num">${dur(t)}</div><div class="meta">gearbeitet${br ? ' · ' + dur(br) + ' Pause' : ''}</div>
    <div class="tl-bar">${segs}</div>
    <div class="tl-scale">${marks.join('')}</div>
    <div class="legend"><span><i style="background:var(--accent)"></i>Arbeit</span><span><i style="background:var(--pause)"></i>Pause</span></div>
    <div class="tl-steps">${steps}</div>
  </div>
  ${sessionList(list)}${addBtn}`;
}

/* ---------- Statistik ---------- */
function period() {
  if (ui.statMode === 'week') { const f = weekStart(ui.statRef); return { from: f, to: addDays(f, 7) }; }
  const f = monthStart(ui.statRef); return { from: f, to: addMonths(f, 1) };
}
function periodLabel({ from, to }, long) {
  if (ui.statMode === 'month') return fmt(from, { month: 'long', year: 'numeric' });
  const kw = isoWeek(from);
  const range = fmt(from, { day: 'numeric', month: 'short' }) + ' – ' + fmt(addDays(to, -1), { day: 'numeric', month: 'short', year: 'numeric' });
  return long ? 'KW ' + kw + ' · ' + range : 'KW ' + kw;
}
function isoWeek(t) {
  const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / D - 3 + (w1.getDay() + 6) % 7) / 7);
}
function viewStats() {
  const p = period(), now = Date.now(), today = dayStart(now);
  const days = [];
  for (let d = p.from; d < p.to; d = addDays(d, 1)) days.push({ d, t: total(sessionsIn(d, addDays(d, 1)), now) });
  const max = Math.max(H, ...days.map(x => x.t));
  const list = sessionsIn(p.from, p.to), t = total(list, now), worked = days.filter(x => x.t > 0).length;
  const br = breaks(list, now), week = ui.statMode === 'week';
  const longest = days.reduce((a, x) => x.t > a.t ? x : a, { t: 0 });
  const bars = days.map((x, i) => `<div class="col ${x.t ? '' : 'zero'} ${x.d === today ? 'cur' : ''}" data-day="${x.d}" data-goday>
      <b>${x.t ? durShort(x.t) : ''}</b><i style="height:${(x.t / max * 100).toFixed(1)}%;--i:${i}"></i>
      <span>${week ? WD[i] : (new Date(x.d).getDate() % 5 === 1 ? new Date(x.d).getDate() : '')}</span></div>`).join('');
  return `
  <h1>Statistik</h1><p class="sub">Deine Arbeitszeit auf einen Blick</p>
  <div class="seg" data-mode-on="${ui.statMode}"><span class="seg-pill"></span><button data-mode="week" class="${week ? 'on' : ''}">Woche</button><button data-mode="month" class="${week ? '' : 'on'}">Monat</button></div>
  <div class="nav-row"><button data-stat="-1" aria-label="Zurück">‹</button><span class="t">${periodLabel(p, true)}</span><button data-stat="1" aria-label="Weiter">›</button></div>
  <div class="glass chart" id="chart"><div class="bars ${week ? '' : 'dense'}">${bars}</div></div>
  <div class="hero" style="margin-top:12px">
    <div class="glass"><b>${dur(t)}</b><span>Gesamt</span></div>
    <div class="glass"><b>${worked}</b><span>Arbeitstage</span></div>
  </div>
  <div class="hero" style="margin-top:12px">
    <div class="glass"><b>${dur(worked ? t / worked : 0)}</b><span>Ø pro Arbeitstag</span></div>
    <div class="glass"><b>${dur(br)}</b><span>Pausen</span></div>
  </div>
  ${longest.t ? `<div class="glass card" style="margin-top:12px"><div class="row"><div class="grow"><div class="meta">Längster Tag</div>
    <div class="name">${fmt(longest.d, { weekday: 'long', day: 'numeric', month: 'long' })}</div></div><div class="dur">${dur(longest.t)}</div></div></div>` : ''}
  <button class="btn primary block cta" data-act="pdf">${week ? 'Woche' : 'Monat'} als PDF exportieren</button>`;
}

/* ---------- PDF-Export ---------- */
async function exportPdf(btn) {
  if (!window.jspdf) { toast('PDF-Funktion lädt noch, bitte gleich nochmal versuchen'); return; }
  btn && btn.classList.add('busy');
  try {
    const p = period(), now = Date.now(), list = sessionsIn(p.from, p.to);
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(20); doc.text('Arbeitszeitnachweis', 40, 60);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(110);
    doc.text((S.settings.name ? S.settings.name + ' · ' : '') + periodLabel(p, true), 40, 82);
    doc.text('Erstellt am ' + fmt(now, { day: '2-digit', month: '2-digit', year: 'numeric' }), W - 40, 82, { align: 'right' });

    const t = total(list, now), br = breaks(list, now), days = new Set(list.map(x => dayStart(x.start))).size;
    [['Arbeitszeit gesamt', dur(t)], ['Arbeitstage', String(days)], ['Pausen gesamt', dur(br)], ['Ø pro Arbeitstag', dur(days ? t / days : 0)]]
      .forEach(([k, v], i) => {
        const x = 40 + i * ((W - 80) / 4);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110); doc.text(k, x, 118);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20); doc.text(v, x, 138);
      });

    const body = list.map(x => [
      fmt(x.start, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }),
      hm(x.start), x.end ? hm(x.end) + (sameDay(x.start, x.end) ? '' : ' (+1)') : 'läuft',
      x.pauses.length ? x.pauses.map(q => hm(q.s) + '–' + (q.e ? hm(q.e) : '…')).join(', ') : '–',
      durShort(pauseMs(x.pauses, now)), durShort(workMs(x, now))
    ]);
    doc.autoTable({
      startY: 165, head: [['Datum', 'Beginn', 'Ende', 'Pausen', 'Pause', 'Arbeitszeit']], body,
      foot: [['Summe', '', '', '', durShort(br), durShort(t)]],
      theme: 'striped', styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [24, 140, 112] }, footStyles: { fillColor: [235, 245, 241], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: c => { if (c.column.index >= 4) c.cell.styles.halign = 'right'; }
    });
    let y = doc.lastAutoTable.finalY + 24;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110);
    if (!list.length) { doc.text('In diesem Zeitraum wurde keine Arbeitszeit erfasst.', 40, y); y += 20; }
    // Unterschriftenfeld
    y = Math.max(y + 50, 0);
    if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 100; }
    doc.setDrawColor(160);
    doc.line(40, y, 250, y); doc.line(W - 250, y, W - 40, y);
    doc.text('Datum, Unterschrift Arbeitnehmer/in', 40, y + 14); doc.text('Datum, Unterschrift Arbeitgeber/in', W - 250, y + 14);

    const name = 'Arbeitszeit_' + (ui.statMode === 'week' ? 'KW' + pad(isoWeek(p.from)) + '_' + new Date(p.from).getFullYear() : toDateInput(p.from).slice(0, 7)) + '.pdf';
    await shareFile(new File([doc.output('blob')], name, { type: 'application/pdf' }), 'Arbeitszeitnachweis');
  } finally { btn && btn.classList.remove('busy'); }
}
async function shareFile(file, title) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); } catch (e) {}
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- Mehr / Einstellungen ---------- */
function viewSettings() {
  const n = S.sessions.length, first = n ? Math.min(...S.sessions.map(x => x.start)) : null;
  return `
  <h1>Mehr</h1><p class="sub">Einstellungen und deine Daten</p>
  <h2>Für den PDF-Export</h2>
  <div class="glass field-card"><label for="s-name">Name</label>
    <input type="text" id="s-name" placeholder="z. B. Max Mustermann" value="${esc(S.settings.name)}" autocomplete="name" enterkeyhint="done"></div>
  <p class="note">Steht oben im Arbeitszeitnachweis.</p>
  <h2>Datensicherung</h2>
  <div class="glass list">
    <button class="sess" data-act="backup"><span class="set-ic">⇪</span><div class="grow"><div class="name">Backup speichern</div><div class="meta">Alle Schichten als Datei sichern</div></div><span class="chev">›</span></button>
    <label class="sess" for="restore"><span class="set-ic">⇩</span><div class="grow"><div class="name">Backup einlesen</div><div class="meta">Aus einer Datei laden oder hinzufügen</div></div><span class="chev">›</span></label>
  </div>
  <input type="file" id="restore" accept="application/json,.json" hidden>
  <p class="note">Deine Daten liegen nur auf diesem iPhone. Speichere ab und zu ein Backup, zum Beispiel in iCloud Drive, damit nichts verloren geht, wenn du das Handy wechselst.</p>
  <h2>Übersicht</h2>
  <div class="glass card"><div class="row"><div class="grow"><div class="meta">Gespeicherte Schichten</div><div class="name">${n}</div></div>
    ${first ? `<div style="text-align:right"><div class="meta">Erfasst seit</div><div class="name">${fmt(first, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>` : ''}</div></div>
  <button class="btn block danger" data-act="wipe" style="margin-top:8px">Alle Daten löschen</button>
  <p class="note center">Shift · Version 1.1</p>`;
}
function backup() {
  const data = JSON.stringify({ app: 'shift', version: 1, exported: Date.now(), sessions: S.sessions, settings: S.settings }, null, 1);
  shareFile(new File([data], 'Shift-Backup_' + toDateInput(Date.now()) + '.json', { type: 'application/json' }), 'Shift Backup');
}
// Lokale Zeitangaben ({ date: 'JJJJ-MM-TT', start: 'HH:MM', end: 'HH:MM' }) werden in Zeitstempel umgewandelt,
// damit Import-Dateien unabhängig von der Zeitzone des Geräts funktionieren.
function fromFile(x) {
  if (typeof x.start === 'number' && typeof x.end === 'number' && Array.isArray(x.pauses)) return { id: x.id || uid(), start: x.start, end: x.end, pauses: x.pauses };
  if (typeof x.date !== 'string' || typeof x.start !== 'string' || typeof x.end !== 'string') return null;
  const b = buildSession({ date: x.date, start: x.start, end: x.end, pauses: x.pauses || [] }, true);
  return typeof b === 'string' ? null : { id: x.id || uid(), ...b };
}
function restore(file) {
  const r = new FileReader();
  r.onload = () => {
    let d; try { d = JSON.parse(r.result); } catch (e) {}
    const list = d && Array.isArray(d.sessions) ? d.sessions.map(fromFile) : [];
    if (!list.length || list.includes(null)) return toast('Diese Datei ist kein gültiges Shift-Backup');
    const replace = () => {
      S.sessions = list;
      if (d.settings) S.settings = { ...S.settings, ...d.settings };
      save(); render(); toast('Backup wiederhergestellt');
    };
    // Hinzufügen übernimmt nur Schichten, die sich mit keiner vorhandenen überschneiden – doppeltes Einlesen schadet also nicht.
    const merge = () => {
      const fresh = list.filter(n => !S.sessions.some(s => s.start < n.end && s.end > n.start) && !(S.active && n.end > S.active.start));
      S.sessions.push(...fresh); save(); render();
      toast(fresh.length ? fresh.length + ' Schichten hinzugefügt' : 'Alle Schichten waren schon vorhanden');
    };
    if (!S.sessions.length) return confirmSheet('Backup wiederherstellen?', `Die Datei enthält ${list.length} Schichten.`, 'Wiederherstellen', false, replace);
    openSheet(`<h3>Backup einlesen</h3><p class="sheet-text">Die Datei enthält ${list.length} Schichten. Du hast aktuell ${S.sessions.length} Schichten. Möchtest du die Schichten aus der Datei hinzufügen oder deine aktuellen Schichten damit ersetzen?</p>
      <div class="actions"><button class="btn primary" data-merge>Hinzufügen</button></div>
      <div class="actions" style="margin-top:10px"><button class="btn" data-close>Abbrechen</button><button class="btn danger" data-replace>Ersetzen</button></div>`,
      e => { if (e.target.closest('[data-merge]')) { closeModal(); merge(); } if (e.target.closest('[data-replace]')) { closeModal(); replace(); } });
  };
  r.readAsText(file);
}

/* ---------- Bottom-Sheets ---------- */
function openSheet(html, onClick) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="back" data-close></div><div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
  root.onclick = e => { if (e.target.closest('[data-close]')) return closeModal(); onClick && onClick(e); };
}
function closeModal() {
  const root = $('#modal-root'); if (!root.firstChild) return;
  root.classList.add('closing'); root.onclick = null;
  setTimeout(() => { root.innerHTML = ''; root.classList.remove('closing'); }, 260);
}
function confirmSheet(title, text, label, danger, fn) {
  openSheet(`<h3>${title}</h3><p class="sheet-text">${text}</p>
    <div class="actions"><button class="btn" data-close>Abbrechen</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-ok>${label}</button></div>`,
    e => { if (e.target.closest('[data-ok]')) { closeModal(); fn(); } });
}

/* Eintrag hinzufügen / bearbeiten */
function openEditor(id, day) {
  const x = id ? S.sessions.find(s => s.id === id) : null;
  const base = x ? x.start : day + 8 * H;
  const draft = {
    id, date: toDateInput(base), start: x ? hm(x.start) : '08:00', end: x ? hm(x.end) : defaultEnd(day),
    pauses: x ? x.pauses.map(p => ({ s: hm(p.s), e: hm(p.e) })) : [{ s: '12:00', e: '12:30' }]
  };
  const html = () => `
      <h3>${x ? 'Schicht bearbeiten' : 'Schicht nachtragen'}</h3>
      <div class="field"><label>Datum</label><input type="date" id="f-date" value="${draft.date}"></div>
      <div class="field"><label>Beginn</label><input type="time" id="f-start" value="${draft.start}"></div>
      <div class="field"><label>Ende</label><input type="time" id="f-end" value="${draft.end}"></div>
      <h2 style="margin-top:18px">Pausen</h2>
      ${draft.pauses.map((p, i) => `<div class="pause-row">
        <input type="time" data-p="${i}" data-k="s" value="${p.s}" aria-label="Pause von"><span class="to">bis</span><input type="time" data-p="${i}" data-k="e" value="${p.e}" aria-label="Pause bis">
        <button class="x" data-rm="${i}" aria-label="Pause entfernen">✕</button></div>`).join('')}
      <button class="btn small" data-addp>＋ Pause hinzufügen</button>
      <div class="sum" id="f-sum"></div>
      <div class="err" id="f-err"></div>
      <div class="actions">${x ? '<button class="btn danger" data-del>Löschen</button>' : ''}<button class="btn" data-close>Abbrechen</button><button class="btn primary" data-save>Speichern</button></div>`;
  const read = () => {
    draft.date = $('#f-date').value; draft.start = $('#f-start').value; draft.end = $('#f-end').value;
    $$('[data-p]').forEach(i => draft.pauses[+i.dataset.p][i.dataset.k] = i.value);
  };
  // Zeigt beim Tippen schon die berechnete Arbeitszeit an.
  const preview = () => {
    read(); const r = buildSession(draft, true);
    $('#f-sum').innerHTML = typeof r === 'string' ? '' : `Arbeitszeit <b>${dur(workMs(r))}</b>${r.pauses.length ? ' · Pause ' + dur(pauseMs(r.pauses)) : ''}${sameDay(r.start, r.end) ? '' : ' · endet am Folgetag'}`;
  };
  const draw = () => {
    $('.sheet').innerHTML = '<div class="grab"></div>' + html(); preview();
    $('.sheet').oninput = preview;
  };
  openSheet('', e => {
    const t = e.target;
    if (t.closest('[data-addp]')) { read(); const last = draft.pauses[draft.pauses.length - 1]; draft.pauses.push(last ? { s: last.e, e: last.e } : { s: '12:00', e: '12:30' }); return draw(); }
    if (t.closest('[data-rm]')) { read(); draft.pauses.splice(+t.closest('[data-rm]').dataset.rm, 1); return draw(); }
    if (t.closest('[data-del]')) {
      const old = x; S.sessions = S.sessions.filter(s => s.id !== x.id); save(); closeModal(); render();
      return toast('Schicht gelöscht', 'Rückgängig', () => { S.sessions.push(old); save(); render(); });
    }
    if (t.closest('[data-save]')) {
      read();
      const r = buildSession(draft);
      if (typeof r === 'string') { const er = $('#f-err'); er.textContent = r; er.classList.remove('shake'); void er.offsetWidth; er.classList.add('shake'); return; }
      if (x) Object.assign(x, r); else S.sessions.push({ id: uid(), ...r });
      save(); closeModal(); ui.selDay = dayStart(r.start); render();
      toast(x ? 'Änderung gespeichert' : 'Schicht nachgetragen');
    }
  });
  draw();
}
// Für heute schlägt die App die aktuelle Uhrzeit (abgerundet) als Ende vor, damit nichts in der Zukunft liegt.
function defaultEnd(day) {
  const now = Date.now();
  if (day !== dayStart(now) || now >= day + 16.5 * H) return '16:30';
  return hm(Math.floor(now / (5 * M)) * 5 * M);
}
// Wandelt die Formularwerte in Zeitstempel um. Ein Ende vor dem Beginn heißt: die Schicht ging über Mitternacht.
function buildSession(d, quiet) {
  if (!d.date || !d.start || !d.end) return 'Bitte Datum, Beginn und Ende ausfüllen.';
  const [y, mo, da] = d.date.split('-').map(Number);
  const at = hhmm => { const [h, m] = hhmm.split(':').map(Number); return new Date(y, mo - 1, da, h, m).getTime(); };
  const start = at(d.start);
  let end = at(d.end); if (end <= start) end = addDays(end, 1);
  if (end > Date.now() + M) return 'Die Schicht darf nicht in der Zukunft enden.';
  const pauses = [];
  for (const p of d.pauses) {
    if (!p.s || !p.e) return 'Bitte alle Pausenzeiten ausfüllen.';
    let s = at(p.s); if (s < start) s = addDays(s, 1);
    let e = at(p.e); if (e <= s) e = addDays(e, 1);
    if (s < start || e > end) return 'Pausen müssen zwischen Beginn und Ende liegen.';
    pauses.push({ s, e });
  }
  pauses.sort((a, b) => a.s - b.s);
  for (let i = 1; i < pauses.length; i++) if (pauses[i].s < pauses[i - 1].e) return 'Pausen dürfen sich nicht überschneiden.';
  if (!quiet) {
    const clash = S.sessions.find(s => s.id !== d.id && s.start < end && s.end > start);
    if (clash) return 'Überschneidet sich mit einer anderen Schicht (' + hm(clash.start) + '–' + hm(clash.end) + ').';
    if (S.active && end > S.active.start) return 'Überschneidet sich mit der laufenden Schicht.';
  }
  return { start, end, pauses };
}

/* Startzeit der laufenden Schicht korrigieren (z. B. wenn man vergessen hat, rechtzeitig zu starten) */
function editStart() {
  const a = S.active;
  openSheet(`<h3>Startzeit ändern</h3>
    <div class="field"><label>Datum</label><input type="date" id="f-date" value="${toDateInput(a.start)}"></div>
    <div class="field"><label>Beginn</label><input type="time" id="f-start" value="${hm(a.start)}"></div>
    <div class="err" id="f-err"></div>
    <div class="actions"><button class="btn" data-close>Abbrechen</button><button class="btn primary" data-save>Speichern</button></div>`, e => {
    if (!e.target.closest('[data-save]')) return;
    const [y, mo, da] = $('#f-date').value.split('-').map(Number), [h, m] = $('#f-start').value.split(':').map(Number);
    const t = new Date(y, mo - 1, da, h, m).getTime();
    const firstPause = a.pauses.length ? a.pauses[0].s : Infinity;
    const lastEnd = Math.max(0, ...S.sessions.map(s => s.end));
    let err = '';
    if (isNaN(t)) err = 'Bitte Datum und Uhrzeit ausfüllen.';
    else if (t > Date.now()) err = 'Der Beginn darf nicht in der Zukunft liegen.';
    else if (t > firstPause) err = 'Der Beginn muss vor der ersten Pause liegen.';
    else if (t < lastEnd) err = 'Überschneidet sich mit der Schicht davor (Ende ' + hm(lastEnd) + ').';
    if (err) { $('#f-err').textContent = err; return; }
    a.start = t; save(); closeModal(); render(); toast('Startzeit geändert');
  });
}
/* Endzeit festlegen, wenn das Beenden vergessen wurde */
function finishForgotten() {
  const a = S.active, suggest = Math.min(Date.now(), a.start + 8.5 * H);
  openSheet(`<h3>Endzeit festlegen</h3>
    <p class="sheet-text">Begonnen am ${fmt(a.start, { weekday: 'long', day: 'numeric', month: 'long' })} um ${hm(a.start)} Uhr.</p>
    <div class="field"><label>Datum</label><input type="date" id="f-date" value="${toDateInput(suggest)}"></div>
    <div class="field"><label>Ende</label><input type="time" id="f-end" value="${hm(suggest)}"></div>
    <div class="err" id="f-err"></div>
    <div class="actions"><button class="btn" data-close>Abbrechen</button><button class="btn primary" data-save>Schicht beenden</button></div>`, e => {
    if (!e.target.closest('[data-save]')) return;
    const [y, mo, da] = $('#f-date').value.split('-').map(Number), [h, m] = $('#f-end').value.split(':').map(Number);
    const t = new Date(y, mo - 1, da, h, m).getTime();
    if (isNaN(t) || t <= a.start) return $('#f-err').textContent = 'Das Ende muss nach dem Beginn liegen.';
    if (t > Date.now()) return $('#f-err').textContent = 'Das Ende darf nicht in der Zukunft liegen.';
    closeModal(); stopShift(t);
  });
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, label, fn) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${label ? `<button>${label}</button>` : ''}`;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  if (label) el.querySelector('button').onclick = () => { fn(); el.classList.remove('on'); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), label ? 5000 : 2600);
}

/* ---------- Ereignisse ---------- */
const TAB_ORDER = TABS.map(t => t[0]);
document.addEventListener('click', e => {
  const t = e.target.closest('button,[data-edit],[data-goday]'); if (!t || t.closest('#modal-root,#toast')) return;
  const d = t.dataset;
  if (d.tab) {
    if (d.tab === ui.tab) return;
    const dir = TAB_ORDER.indexOf(d.tab) > TAB_ORDER.indexOf(ui.tab) ? 'left' : 'right';
    ui.tab = d.tab; window.scrollTo(0, 0); haptic(); render(dir); return;
  }
  if (d.act === 'start') return startShift();
  if (d.act === 'pause') return togglePause();
  if (d.act === 'stop') return stopShift();
  if (d.act === 'add') return openEditor(null, +d.day);
  if (d.act === 'pdf') return exportPdf(t);
  if (d.act === 'editstart') return editStart();
  if (d.act === 'finish') return finishForgotten();
  if (d.act === 'backup') return backup();
  if (d.act === 'hidehint') { try { localStorage.setItem('shift-hint', '1'); } catch (er) {} const c = t.closest('.hint'); c.classList.add('gone'); setTimeout(() => c.remove(), 300); return; }
  if (d.act === 'wipe') return confirmSheet('Alle Daten löschen?', 'Alle Schichten werden endgültig gelöscht. Das kann nicht rückgängig gemacht werden. Speichere vorher ein Backup, wenn du die Daten noch brauchst.', 'Endgültig löschen', true, () => {
    S = { sessions: [], active: null, settings: S.settings }; save(); render(); toast('Alle Daten gelöscht');
  });
  if (d.act === 'caltoday') { const today = dayStart(Date.now()); const dir = today > ui.calMonth ? 1 : -1; ui.calMonth = monthStart(today); ui.selDay = today; render(); slide('#cal', dir); return; }
  if (d.edit) return openEditor(d.edit);
  if (d.cal) { ui.calMonth = addMonths(ui.calMonth, +d.cal); render(); slide('#cal', +d.cal); return; }
  if (d.goday != null) { ui.tab = 'calendar'; ui.selDay = +d.day; ui.calMonth = monthStart(+d.day); window.scrollTo(0, 0); render('left'); return; }
  if (d.day) return selectDay(+d.day);
  if (d.mode) { if (d.mode === ui.statMode) return; ui.statMode = d.mode; ui.statRef = Date.now(); $('.seg').dataset.modeOn = d.mode; setTimeout(() => { render(); slide('#chart', d.mode === 'month' ? 1 : -1); }, 230); return; }
  if (d.stat) { ui.statRef = ui.statMode === 'week' ? addDays(ui.statRef, 7 * d.stat) : addMonths(ui.statRef, +d.stat); render(); slide('#chart', +d.stat); return; }
});
document.addEventListener('change', e => {
  if (e.target.id === 's-name') { S.settings.name = e.target.value.trim(); save(); toast('Name gespeichert'); }
  if (e.target.id === 'restore' && e.target.files[0]) { restore(e.target.files[0]); e.target.value = ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 's-name') e.target.blur(); });

// Wischen zwischen Monaten (Kalender) und Zeiträumen (Statistik)
let touch = null;
document.addEventListener('touchstart', e => { const el = e.target.closest('#cal,#chart'); touch = el ? { x: e.touches[0].clientX, y: e.touches[0].clientY, el } : null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    const dir = dx < 0 ? 1 : -1;
    if (touch.el.id === 'cal') { ui.calMonth = addMonths(ui.calMonth, dir); render(); slide('#cal', dir); }
    else { ui.statRef = ui.statMode === 'week' ? addDays(ui.statRef, 7 * dir) : addMonths(ui.statRef, dir); render(); slide('#chart', dir); }
  }
  touch = null;
}, { passive: true });

document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#modal-root').firstChild) { S = load(); render(); } });
window.addEventListener('resize', syncTabs);

buildTabs();
render('fade');
requestAnimationFrame(() => $('#tabs').classList.add('ready'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
