'use strict';

/* ---------- Storage ----------
   sessions: [{ id, start, end, pauses: [{ s, e }] }]   (all times are ms timestamps)
   active:   { start, pauses: [{ s, e|null }] } | null  (the running shift)
   We only store timestamps, so the timer keeps counting while the app is closed. */
const KEY = 'shift-v1';
let S = load();
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.sessions)) return d; } catch (e) {}
  return { sessions: [], active: null };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- Time helpers ---------- */
const H = 3600000, M = 60000, D = 86400000;
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
const dur = ms => { const m = Math.round(Math.max(0, ms) / M); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; };
const durShort = ms => { const m = Math.round(Math.max(0, ms) / M); return Math.floor(m / 60) + ':' + pad(m % 60); };
const fmt = (t, o) => new Date(t).toLocaleDateString('en-GB', o);
const toDateInput = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const pauseMs = (p, now) => p.reduce((a, x) => a + ((x.e ?? now) - x.s), 0);
const workMs = (x, now = Date.now()) => ((x.end ?? now) - x.start) - pauseMs(x.pauses, now);
const activeAsSession = () => S.active && { id: 'active', start: S.active.start, end: null, pauses: S.active.pauses, live: true };
const allSessions = () => { const a = activeAsSession(); return a ? [...S.sessions, a] : S.sessions; };
// A shift belongs to the day it started on.
const sessionsIn = (from, to) => allSessions().filter(x => x.start >= from && x.start < to).sort((a, b) => a.start - b.start);
const total = (list, now = Date.now()) => list.reduce((a, x) => a + workMs(x, now), 0);
const isPaused = () => !!(S.active && S.active.pauses.some(p => p.e == null));

/* ---------- Actions ---------- */
function startShift() { S.active = { start: Date.now(), pauses: [] }; save(); haptic(); render(); }
function togglePause() {
  const now = Date.now(), open = S.active.pauses.find(p => p.e == null);
  if (open) open.e = now; else S.active.pauses.push({ s: now, e: null });
  save(); haptic(); render();
}
function stopShift() {
  const now = Date.now(), a = S.active;
  a.pauses.forEach(p => { if (p.e == null) p.e = now; });
  const sess = { id: uid(), start: a.start, end: now, pauses: a.pauses };
  S.sessions.push(sess); S.active = null; save(); haptic(); render();
  toast('Shift saved · ' + dur(workMs(sess)), 'Undo', () => {
    S.sessions = S.sessions.filter(x => x.id !== sess.id);
    sess.pauses.forEach(p => { if (p.e === now) p.e = null; });
    S.active = { start: sess.start, pauses: sess.pauses }; save(); render();
  });
}
function haptic() { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} }

/* ---------- UI shell ---------- */
const ui = { tab: 'today', calMonth: monthStart(Date.now()), selDay: dayStart(Date.now()), statMode: 'week', statRef: Date.now() };
const icons = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V12M10 20V6M15 20v-9M20 20V4"/></svg>'
};
const TABS = [['today', 'Today'], ['calendar', 'Calendar'], ['stats', 'Stats']];
const $ = s => document.querySelector(s);

function render() {
  document.body.classList.toggle('paused', isPaused());
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${icons[k]}${l}</button>`).join('');
  $('#view').innerHTML = ({ today: viewToday, calendar: viewCalendar, stats: viewStats })[ui.tab]();
  tick();
}

/* ---------- Today ---------- */
const RING = 2 * Math.PI * 130;
function viewToday() {
  const now = Date.now(), state = !S.active ? 'idle' : isPaused() ? 'paused' : 'running';
  const btns = {
    idle: `<button class="big go" data-act="start">Start work</button>`,
    running: `<button class="big pause" data-act="pause">Pause</button><button class="big stop" data-act="stop">Stop</button>`,
    paused: `<button class="big resume" data-act="pause">Resume</button><button class="big stop" data-act="stop">Stop</button>`
  }[state];
  const list = sessionsIn(dayStart(now), addDays(dayStart(now), 1));
  return `
  <h1>Today</h1><p class="sub">${fmt(now, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
  <div class="timer ${state}" id="timer">
    <svg viewBox="0 0 300 300">
      <defs>
        <linearGradient id="g-work" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ff5d6"/><stop offset="1" stop-color="#2fc79a"/></linearGradient>
        <linearGradient id="g-pause" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>
      </defs>
      <circle class="track" cx="150" cy="150" r="130"/>
      <circle class="prog" id="ring" cx="150" cy="150" r="130" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/>
    </svg>
    <div class="center">
      <div class="state"><span class="dot"></span>${{ idle: 'Ready', running: 'Working', paused: 'On break' }[state]}</div>
      <div class="clock" id="clock">00:00:00</div>
      <div class="since" id="since">${state === 'idle' ? 'Tap start when you begin' : ''}</div>
    </div>
  </div>
  <div class="controls">${btns}</div>
  <div class="hero" style="margin-top:18px">
    <div class="glass"><b id="t-day">0h 00m</b><span>Today</span></div>
    <div class="glass"><b id="t-week">0h 00m</b><span>This week</span></div>
  </div>
  <h2>Today's shifts</h2>
  ${sessionList(list)}
  <button class="btn block" data-act="add" data-day="${dayStart(now)}" style="margin-top:4px">+ Add entry manually</button>`;
}

function sessionList(list) {
  if (!list.length) return `<div class="glass empty">No shifts yet</div>`;
  return `<div class="glass list">${list.map(x => {
    const br = pauseMs(x.pauses, Date.now());
    return `<div class="sess" ${x.live ? '' : `data-edit="${x.id}"`}>
      <span class="bar-ic" style="${x.live ? 'animation:pulse 2s infinite' : ''}"></span>
      <div class="grow"><div class="name">${hm(x.start)} – ${x.live ? 'now' : hm(x.end)}${!x.live && !sameDay(x.start, x.end) ? ' <small style="color:var(--dim)">+1</small>' : ''}</div>
      <div class="meta">${br ? 'Break ' + dur(br) : 'No break'}${x.live ? ' · running' : ''}</div></div>
      <div class="dur" ${x.live ? 'data-live-dur' : ''}>${dur(workMs(x))}</div>
    </div>`;
  }).join('')}</div>`;
}

function tick() {
  const now = Date.now();
  if (ui.tab !== 'today') return;
  const c = $('#clock'); if (!c) return;
  const a = activeAsSession();
  if (a) {
    const w = workMs(a, now);
    c.textContent = clock(w);
    $('#ring').style.strokeDashoffset = RING * (1 - (w % H) / H); // one full ring per worked hour
    const br = pauseMs(a.pauses, now);
    const open = a.pauses.find(p => p.e == null);
    $('#since').textContent = open ? 'Break running · ' + (now - open.s >= H ? clock(now - open.s) : clock(now - open.s).slice(3)) : 'Since ' + hm(a.start) + (br ? ' · Break ' + durShort(br) : '');
    document.querySelectorAll('[data-live-dur]').forEach(e => e.textContent = dur(w));
  }
  $('#t-day').textContent = dur(total(sessionsIn(dayStart(now), addDays(dayStart(now), 1)), now));
  $('#t-week').textContent = dur(total(sessionsIn(weekStart(now), addDays(weekStart(now), 7)), now));
}
setInterval(tick, 1000);

/* ---------- Calendar ---------- */
function viewCalendar() {
  const m = ui.calMonth, first = weekStart(m), next = addMonths(m, 1), today = dayStart(Date.now());
  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let d = first; d < next || (new Date(d).getDay() !== 1); d = addDays(d, 1)) {
    const list = sessionsIn(d, addDays(d, 1)), t = total(list);
    const cls = ['day', d < m || d >= next ? 'out' : '', list.length ? 'has' : '', d === today ? 'today' : '', d === ui.selDay ? 'sel' : '', list.some(x => x.live) ? 'live' : ''].join(' ');
    cells += `<button class="${cls}" style="--h:${Math.min(t / (10 * H), 1).toFixed(2)}" data-day="${d}">${new Date(d).getDate()}<small>${t >= M ? durShort(t) : ''}</small></button>`;
  }
  const mt = total(sessionsIn(m, next));
  return `
  <h1>Calendar</h1><p class="sub">${dur(mt)} worked in ${fmt(m, { month: 'long' })}</p>
  <div class="cal-head"><button data-cal="-1">‹</button><span class="t">${fmt(m, { month: 'long', year: 'numeric' })}</span><button data-cal="1">›</button></div>
  <div class="glass cal">${cells}</div>
  ${dayDetail(ui.selDay)}`;
}

function dayDetail(day) {
  const now = Date.now(), list = sessionsIn(day, addDays(day, 1)), t = total(list, now);
  const head = `<h2>${fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>`;
  const addBtn = `<button class="btn block" data-act="add" data-day="${day}" style="margin-top:4px">+ Add entry</button>`;
  if (!list.length) return head + `<div class="glass empty">No work recorded</div>` + addBtn;

  // Timeline scale: from the first full hour before the start to the full hour after the end.
  const from = Math.floor(list[0].start / H) * H;
  const lastEnd = Math.max(...list.map(x => x.end ?? now));
  const to = Math.max(Math.ceil(lastEnd / H) * H, from + 2 * H);
  const pct = v => ((v - from) / (to - from) * 100).toFixed(2) + '%';
  let segs = '', steps = '';
  list.forEach(x => {
    const end = x.end ?? now;
    segs += `<i class="w" style="left:${pct(x.start)};width:calc(${pct(end)} - ${pct(x.start)})"></i>`;
    steps += `<div class="step"><span class="b w"></span><span class="tm">${hm(x.start)}</span><span>Started work</span></div>`;
    x.pauses.forEach(p => {
      const pe = p.e ?? now;
      segs += `<i class="p" style="left:${pct(p.s)};width:calc(${pct(pe)} - ${pct(p.s)})"></i>`;
      steps += `<div class="step"><span class="b p"></span><span class="tm">${hm(p.s)}</span><span>Break · ${p.e == null ? 'running' : dur(pe - p.s)}</span></div>`;
    });
    steps += `<div class="step"><span class="b e"></span><span class="tm">${x.end ? hm(x.end) : 'now'}</span><span>${x.end ? 'Finished' : 'Still working'}</span></div>`;
  });
  const marks = [];
  const stepH = (to - from) / H > 8 ? 3 : (to - from) / H > 4 ? 2 : 1;
  for (let h = from; h <= to; h += stepH * H) marks.push(`<span>${pad(new Date(h).getHours())}</span>`);
  const br = list.reduce((a, x) => a + pauseMs(x.pauses, now), 0);
  return head + `
  <div class="glass tl">
    <div class="row"><div class="grow"><div class="name" style="font-size:22px">${dur(t)}</div><div class="meta">worked${br ? ' · ' + dur(br) + ' break' : ''}</div></div></div>
    <div class="tl-bar">${segs}</div>
    <div class="tl-scale">${marks.join('')}</div>
    <div class="legend"><span><i style="background:var(--accent)"></i>Work</span><span><i style="background:var(--pause)"></i>Break</span></div>
    <div class="tl-steps">${steps}</div>
  </div>
  ${sessionList(list)}${addBtn}`;
}

/* ---------- Stats ---------- */
function period() {
  if (ui.statMode === 'week') { const f = weekStart(ui.statRef); return { from: f, to: addDays(f, 7) }; }
  const f = monthStart(ui.statRef); return { from: f, to: addMonths(f, 1) };
}
function periodLabel({ from, to }) {
  if (ui.statMode === 'month') return fmt(from, { month: 'long', year: 'numeric' });
  return fmt(from, { day: 'numeric', month: 'short' }) + ' – ' + fmt(addDays(to, -1), { day: 'numeric', month: 'short', year: 'numeric' });
}
function viewStats() {
  const p = period(), now = Date.now(), today = dayStart(now);
  const days = [];
  for (let d = p.from; d < p.to; d = addDays(d, 1)) days.push({ d, t: total(sessionsIn(d, addDays(d, 1)), now) });
  const max = Math.max(H, ...days.map(x => x.t));
  const list = sessionsIn(p.from, p.to), t = total(list, now), worked = days.filter(x => x.t > 0).length;
  const br = list.reduce((a, x) => a + pauseMs(x.pauses, now), 0);
  const week = ui.statMode === 'week';
  const bars = days.map(x => `<div class="col ${x.t ? '' : 'zero'} ${x.d === today ? 'cur' : ''}">
      <b>${x.t ? durShort(x.t) : ''}</b><i style="height:${(x.t / max * 100).toFixed(1)}%"></i>
      <span>${week ? fmt(x.d, { weekday: 'short' }).slice(0, 2) : (new Date(x.d).getDate() % 5 === 1 ? new Date(x.d).getDate() : '')}</span></div>`).join('');
  return `
  <h1>Stats</h1><p class="sub">Your working time at a glance</p>
  <div class="seg"><button data-mode="week" class="${week ? 'on' : ''}">Week</button><button data-mode="month" class="${week ? '' : 'on'}">Month</button></div>
  <div class="nav-row"><button data-stat="-1">‹</button><span class="t">${periodLabel(p)}</span><button data-stat="1">›</button></div>
  <div class="glass chart"><div class="bars ${week ? '' : 'dense'}">${bars}</div></div>
  <div class="hero" style="margin-top:12px">
    <div class="glass"><b>${dur(t)}</b><span>Total</span></div>
    <div class="glass"><b>${worked}</b><span>Days worked</span></div>
  </div>
  <div class="hero" style="margin-top:12px">
    <div class="glass"><b>${dur(worked ? t / worked : 0)}</b><span>Average per day</span></div>
    <div class="glass"><b>${dur(br)}</b><span>Breaks</span></div>
  </div>
  <button class="btn primary block" data-act="pdf" style="margin-top:18px;padding:15px">Export ${week ? 'week' : 'month'} as PDF</button>`;
}

/* ---------- PDF export ---------- */
async function exportPdf() {
  if (!window.jspdf) { toast('PDF tool is still loading, try again'); return; }
  const p = period(), now = Date.now(), list = sessionsIn(p.from, p.to);
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text('Work Time Report', 40, 60);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(110);
  doc.text(periodLabel(p), 40, 82);
  doc.text('Created ' + fmt(now, { day: 'numeric', month: 'long', year: 'numeric' }), W - 40, 82, { align: 'right' });

  const t = total(list, now), br = list.reduce((a, x) => a + pauseMs(x.pauses, now), 0);
  const days = new Set(list.map(x => dayStart(x.start))).size;
  doc.setTextColor(20); doc.setFontSize(11);
  [['Total worked', dur(t)], ['Days worked', String(days)], ['Breaks', dur(br)], ['Average per day', dur(days ? t / days : 0)]]
    .forEach(([k, v], i) => {
      const x = 40 + i * ((W - 80) / 4);
      doc.setTextColor(110); doc.text(k, x, 118);
      doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(v, x, 138);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    });

  const body = list.map(x => [
    fmt(x.start, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }),
    hm(x.start), x.end ? hm(x.end) + (sameDay(x.start, x.end) ? '' : ' (+1)') : 'running',
    x.pauses.length ? x.pauses.map(q => hm(q.s) + '–' + (q.e ? hm(q.e) : '…')).join(', ') : '–',
    durShort(pauseMs(x.pauses, now)), durShort(workMs(x, now))
  ]);
  doc.autoTable({
    startY: 165, head: [['Date', 'Start', 'End', 'Breaks', 'Break', 'Worked']], body,
    foot: [['Total', '', '', '', durShort(br), durShort(t)]],
    theme: 'striped', styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [24, 140, 112] }, footStyles: { fillColor: [235, 245, 241], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } }
  });
  if (!list.length) doc.text('No work recorded in this period.', 40, doc.lastAutoTable.finalY + 24);

  const name = 'Work-time_' + toDateInput(p.from) + '.pdf';
  const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Work Time Report' }); } catch (e) {}
  } else doc.save(name);
}

/* ---------- Edit / add entry ---------- */
function openEditor(id, day) {
  const x = id ? S.sessions.find(s => s.id === id) : null;
  const base = x ? x.start : day + 8 * H;
  const draft = {
    id, date: toDateInput(base), start: x ? hm(x.start) : '08:00', end: x ? hm(x.end) : '16:30',
    pauses: x ? x.pauses.map(p => ({ s: hm(p.s), e: hm(p.e) })) : [{ s: '12:00', e: '12:30' }]
  };
  const draw = () => {
    $('#modal-root').innerHTML = `<div class="back" data-close></div><div class="sheet">
      <h3>${x ? 'Edit shift' : 'Add shift'}</h3>
      <div class="field"><label>Date</label><input type="date" id="f-date" value="${draft.date}"></div>
      <div class="field"><label>Start</label><input type="time" id="f-start" value="${draft.start}"></div>
      <div class="field"><label>End</label><input type="time" id="f-end" value="${draft.end}"></div>
      <h2 style="margin-top:18px">Breaks</h2>
      ${draft.pauses.map((p, i) => `<div class="pause-row">
        <input type="time" data-p="${i}" data-k="s" value="${p.s}"><input type="time" data-p="${i}" data-k="e" value="${p.e}">
        <button class="x" data-rm="${i}">✕</button></div>`).join('')}
      <button class="btn small" data-addp>+ Add break</button>
      <div class="err" id="f-err"></div>
      <div class="actions">${x ? '<button class="btn danger" data-del>Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>
    </div>`;
  };
  const read = () => {
    draft.date = $('#f-date').value; draft.start = $('#f-start').value; draft.end = $('#f-end').value;
    document.querySelectorAll('[data-p]').forEach(i => draft.pauses[+i.dataset.p][i.dataset.k] = i.value);
  };
  draw();
  $('#modal-root').onclick = e => {
    const t = e.target;
    if (t.closest('[data-close]')) return closeModal();
    if (t.closest('[data-addp]')) { read(); draft.pauses.push({ s: '12:00', e: '12:30' }); return draw(); }
    if (t.closest('[data-rm]')) { read(); draft.pauses.splice(+t.closest('[data-rm]').dataset.rm, 1); return draw(); }
    if (t.closest('[data-del]')) {
      const old = x; S.sessions = S.sessions.filter(s => s.id !== x.id); save(); closeModal(); render();
      return toast('Shift deleted', 'Undo', () => { S.sessions.push(old); save(); render(); });
    }
    if (t.closest('[data-save]')) {
      read();
      const r = buildSession(draft);
      if (typeof r === 'string') { $('#f-err').textContent = r; return; }
      if (x) Object.assign(x, r); else S.sessions.push({ id: uid(), ...r });
      save(); closeModal(); ui.selDay = dayStart(r.start); render();
    }
  };
}
// Turns the form values into timestamps. An end time before the start time means the shift ran past midnight.
function buildSession(d) {
  if (!d.date || !d.start || !d.end) return 'Please fill in date, start and end.';
  const [y, mo, da] = d.date.split('-').map(Number);
  const at = hhmm => { const [h, m] = hhmm.split(':').map(Number); return new Date(y, mo - 1, da, h, m).getTime(); };
  const start = at(d.start);
  let end = at(d.end); if (end <= start) end = addDays(end, 1);
  if (end - start > D) return 'A shift cannot be longer than 24 hours.';
  const pauses = [];
  for (const p of d.pauses) {
    if (!p.s || !p.e) return 'Please fill in all break times.';
    let s = at(p.s); if (s < start) s = addDays(s, 1);
    let e = at(p.e); if (e <= s) e = addDays(e, 1);
    if (s < start || e > end) return 'Breaks must be between start and end.';
    pauses.push({ s, e });
  }
  pauses.sort((a, b) => a.s - b.s);
  for (let i = 1; i < pauses.length; i++) if (pauses[i].s < pauses[i - 1].e) return 'Breaks must not overlap.';
  const clash = S.sessions.find(s => s.id !== d.id && s.start < end && s.end > start);
  if (clash) return 'This overlaps another shift (' + hm(clash.start) + '–' + hm(clash.end) + ').';
  return { start, end, pauses };
}
function closeModal() { $('#modal-root').innerHTML = ''; $('#modal-root').onclick = null; }

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, label, fn) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${label ? `<button>${label}</button>` : ''}`;
  el.classList.add('on');
  if (label) el.querySelector('button').onclick = () => { fn(); el.classList.remove('on'); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 5000);
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button,[data-edit]'); if (!t || t.closest('#modal-root,#toast')) return;
  const d = t.dataset;
  if (d.tab) { ui.tab = d.tab; window.scrollTo(0, 0); render(); return; }
  if (d.act === 'start') return startShift();
  if (d.act === 'pause') return togglePause();
  if (d.act === 'stop') return stopShift();
  if (d.act === 'add') return openEditor(null, +d.day);
  if (d.act === 'pdf') return exportPdf();
  if (d.edit) return openEditor(d.edit);
  if (d.cal) { ui.calMonth = addMonths(ui.calMonth, +d.cal); return render(); }
  if (d.day) { ui.selDay = +d.day; return render(); }
  if (d.mode) { ui.statMode = d.mode; ui.statRef = Date.now(); return render(); }
  if (d.stat) { ui.statRef = ui.statMode === 'week' ? addDays(ui.statRef, 7 * d.stat) : addMonths(ui.statRef, +d.stat); return render(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { S = load(); render(); } });

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
