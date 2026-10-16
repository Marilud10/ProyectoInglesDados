"use strict";

/* ===== 1. ESTADO JSON =====
   Se carga desde data.json. Si el navegador bloquea fetch (abrir con doble clic),
   se usa este respaldo para que el juego funcione igual. */
const TEAMS = ["sea", "forest"];
const DEFAULT_STATE = {
  config: { maxHistory: 6, rollDurationMs: 2200 },
  teams: {
    sea: { name: "Ocean Tribe", emoji: "🌊", element: "Water", motto: "Deep as the tide, mighty as the storm.",
           traits: ["Calm under pressure", "Ancient wisdom", "Unstoppable currents"], background: "ocean.png", students: [] },
    forest: { name: "Forest Fae", emoji: "🌲", element: "Nature & Magic", motto: "Where moonlight sleeps, magic wakes.",
           traits: ["Wild creativity", "Fairy-fast reflexes", "Roots that never break"], background: "forest.png", students: [] }
  },
  duels: []
};
const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
let nextId = 1, busy = false;

const $ = id => document.getElementById(id);               // puede devolver null: siempre se valida
const rand = n => Math.floor(Math.random() * n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const norm = s => s.trim().replace(/\s+/g, " ");
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ROT  = { 1:[0,0], 2:[0,-90], 3:[90,0], 4:[-90,0], 5:[0,90], 6:[0,180] };   // giro que deja cada cara al frente
const PIPS = { 1:[4], 2:[0,8], 3:[0,4,8], 4:[0,2,6,8], 5:[0,2,4,6,8], 6:[0,2,3,5,6,8] };

async function loadData() {
  try {
    const r = await fetch("data.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    Object.assign(state.config, d.config || {});
    for (const k of TEAMS) {
      const t = d.teams && d.teams[k]; if (!t) continue;
      for (const f of ["name", "emoji", "element", "motto", "background"]) if (typeof t[f] === "string") state.teams[k][f] = t[f];
      if (Array.isArray(t.traits)) state.teams[k].traits = t.traits.map(String);
      if (Array.isArray(t.students)) state.teams[k].students = t.students.filter(s => s && typeof s.name === "string" && s.name.trim()).map(s => ({ id: 0, name: norm(s.name) }));
    }
    if (Array.isArray(d.duels)) state.duels = d.duels;
  } catch (e) { console.info("data.json not available, using defaults:", e.message); }
  TEAMS.forEach(k => state.teams[k].students.forEach(s => { s.id = nextId++; }));
}

/* ===== 2. AUDIO (Web Audio API, sin archivos externos) ===== */
const Sound = {
  ctx: null, on: false, amb: null,
  tone(freq, dur = .15, type = "sine", vol = .12, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur);
  },
  click()   { this.tone(900, .05, "square", .08); },
  rolling() { for (let i = 0; i < 16; i++) this.tone(200 + Math.random() * 300, .06, "triangle", .08, i * .12); },
  win()     { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, .35, "sine", .14, i * .12)); },
  toggle() {                                   // se ejecuta desde un clic: el navegador lo permite
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.on = !this.on;
    if (this.on && !this.amb) {                // música ambiental: 3 tonos graves
      const g = this.ctx.createGain(); g.gain.value = .03; g.connect(this.ctx.destination);
      this.amb = [110, 164.8, 220].map(f => { const o = this.ctx.createOscillator(); o.frequency.value = f; o.connect(g); o.start(); return o; });
    } else if (!this.on && this.amb) { this.amb.forEach(o => o.stop()); this.amb = null; }
    const b = $("audio"); if (b) b.textContent = this.on ? "🔊" : "🔇";
    this.click();
  }
};

/* ===== 3. RENDERIZADO ===== */
function renderLists() {
  for (const k of TEAMS) {
    const t = state.teams[k], ul = $("list-" + k), h = $("t-" + k);
    if (h) h.innerHTML = `${esc(t.emoji)} ${esc(t.name)} <small>${t.students.length}</small>`;
    if (!ul) continue;
    ul.innerHTML = t.students.length
      ? t.students.map(s => `<li data-id="${s.id}"><span>${esc(s.name)}</span><button type="button" data-del="${k}:${s.id}" aria-label="Remove ${esc(s.name)}">✕</button></li>`).join("")
      : `<li class="empty">No students yet</li>`;
  }
}
function renderHistory() {
  const ul = $("history"); if (!ul) return;
  ul.innerHTML = state.duels.slice(0, state.config.maxHistory).map(d =>
    `<li>${esc(d.sea.name)} (${esc(d.sea.roll)}) vs ${esc(d.forest.name)} (${esc(d.forest.roll)}) → <b>${esc(d.winnerName)}</b></li>`).join("");
}
function buildDie(id) {
  const die = $(id); if (!die) return;
  for (let f = 1; f <= 6; f++) {
    const face = document.createElement("div"); face.className = "face f" + f;
    for (let c = 0; c < 9; c++) { const p = document.createElement("span"); if (PIPS[f].includes(c)) p.className = "pip"; face.appendChild(p); }
    die.appendChild(face);
  }
}
function showAlert(msg, ok = false) {
  const a = $("alert"); if (!a) return;
  a.textContent = msg; a.className = ok ? "ok" : "";
}

/* ===== 4. DECORACIÓN: detalles del Océano y del Bosque ===== */
const DECOR = {
  sea: [
    ["rays", "", ""],
    ["fl float", "🪼", "left:8%;top:18%;font-size:2.4rem;color:#4de8ff"],
    ["fl float d2", "🪼", "left:68%;top:46%;font-size:1.8rem;color:#9bf"],
    ["fl swim", "🐟", "top:28%;font-size:1.6rem"],
    ["fl swim rev", "🐠", "top:55%;font-size:1.8rem;animation-duration:20s;animation-delay:-6s"],
    ["fl swim", "🐢", "top:76%;font-size:2.1rem;animation-duration:30s;animation-delay:-12s"],
    ["fl swim rev", "🦈", "top:40%;font-size:2.4rem;opacity:.7;animation-duration:34s"],
    ["fl crab", "🦀", "bottom:34px;left:58%;font-size:1.6rem"],
    ["fl glow", "🪸", "bottom:8px;left:3%;font-size:3rem"],
    ["fl glow", "🪸", "bottom:6px;right:5%;font-size:3.4rem"],
    ["fl", "🐚", "bottom:6px;left:45%;font-size:1.6rem"],
    ["fl", "⚓", "bottom:16px;left:24%;font-size:1.8rem;opacity:.7"],
    ["fl", "⭐", "bottom:10px;left:70%;font-size:1.4rem"]
  ],
  forest: [
    ["fl glow", "🌙", "top:8px;right:12px;font-size:2.6rem;filter:drop-shadow(0 0 16px #fff7d6)"],
    ["fl", "🦉", "top:64px;left:10px;font-size:2rem"],
    ["fl float", "🦋", "left:58%;top:30%;font-size:1.6rem;color:#ff4fd8"],
    ["fl float d2", "🦋", "left:20%;top:62%;font-size:1.4rem;color:#7dffb0"],
    ["fl float", "🧚", "left:35%;top:44%;font-size:2rem;color:#ff4fd8"],
    ["fl float d2", "🧚", "left:76%;top:68%;font-size:1.6rem;color:#c8f"],
    ["fl tree", "🌲", "left:-14px;font-size:6.5rem"],
    ["fl tree", "🌳", "right:-14px;font-size:6rem"],
    ["fl shroom", "🍄", "left:22%;font-size:2rem"],
    ["fl shroom", "🍄", "left:48%;font-size:1.5rem;animation-delay:-1s"],
    ["fl shroom", "🍄", "left:70%;font-size:2.2rem;animation-delay:-2s"],
    ["fl", "🌿", "bottom:4px;left:8%;font-size:1.8rem"],
    ["fl", "🪵", "bottom:4px;left:58%;font-size:1.6rem"],
    ["mist", "", ""]
  ]
};
function put(parent, cls, txt, css) {
  const e = document.createElement("span"); e.className = cls; e.textContent = txt; e.style.cssText = css; parent.appendChild(e);
}
function buildDecor() {
  const s = $("decor-sea"), f = $("decor-forest");
  if (s) {
    DECOR.sea.forEach(d => put(s, ...d));
    for (let i = 0; i < 7; i++) put(s, "weed", "", `left:${4 + i * 14}%;--h:${50 + rand(60)}px;animation-delay:${-Math.random() * 3}s`);
  }
  if (f) {
    DECOR.forest.forEach(d => put(f, ...d));
    for (let i = 0; i < 5; i++) put(f, "vine", "", `left:${8 + i * 19}%;--h:${60 + rand(90)}px;animation-delay:${-Math.random() * 4}s`);
    for (let i = 0; i < 16; i++) put(f, "firefly", "", `left:${rand(95)}%;top:${10 + rand(75)}%;animation-delay:${-Math.random() * 3}s,${-Math.random() * 6}s`);
  }
}

/* ===== 5. PARTÍCULAS: hadas, burbujas y hojas ===== */
function fairy() {
  const fx = $("fx"); if (!fx) return;
  const p = document.createElement("span"), s = 3 + Math.random() * 7, c = Math.random() < .5 ? "77,232,255" : "255,79,216";
  p.className = "fairy";
  p.style.cssText = `left:${Math.random() * 100}%;width:${s}px;height:${s}px;background:rgba(${c},.9);box-shadow:0 0 ${s * 3}px rgba(${c},1);--dx:${(Math.random() - .5) * 160}px;animation-duration:${6 + Math.random() * 8}s`;
  fx.appendChild(p); p.addEventListener("animationend", () => p.remove());
}
function drift(parentId, cls, txt, css, secs) {      // crea un elemento que sube/baja y se elimina solo
  const par = $(parentId); if (!par) return;
  const e = document.createElement("span"); e.className = cls; e.textContent = txt;
  e.style.cssText = `left:${rand(95)}%;--dx:${rand(80) - 40}px;animation-duration:${secs + Math.random() * 5}s;${css}`;
  par.appendChild(e); e.addEventListener("animationend", () => e.remove());
}
const burst = n => { for (let i = 0; i < n; i++) setTimeout(fairy, i * 25); };

/* ===== 6. REGISTRO DE ESTUDIANTES ===== */
const exists = n => TEAMS.some(k => state.teams[k].students.some(s => s.name.toLowerCase() === n.toLowerCase()));
function addStudent() {
  const input = $("name"), sel = $("faction"); if (!input || !sel) return;
  const name = norm(input.value), k = sel.value;
  if (!name) { showAlert("Please type a valid name (it can't be empty)."); input.focus(); return; }
  if (!state.teams[k]) return;
  if (exists(name)) { showAlert(`"${name}" is already registered.`); return; }
  state.teams[k].students.push({ id: nextId++, name });
  input.value = ""; input.focus(); showAlert(""); Sound.click(); renderLists();
}
function bulkAdd() {                                  // reparte al azar y mantiene los equipos equilibrados
  const ta = $("bulk"); if (!ta) return;
  const seen = new Set(), names = [];
  ta.value.split(/[\n,;]+/).map(norm).filter(Boolean).forEach(n => {
    const l = n.toLowerCase();
    if (!seen.has(l) && !exists(n)) { seen.add(l); names.push(n.slice(0, 30)); }
  });
  if (!names.length) { showAlert("Paste at least one new name (one per line or separated by commas)."); return; }
  shuffle(names);
  const c = { sea: 0, forest: 0 };
  names.forEach(n => {
    const a = state.teams.sea.students.length, b = state.teams.forest.students.length;
    const k = a === b ? (Math.random() < .5 ? "sea" : "forest") : (a < b ? "sea" : "forest");
    state.teams[k].students.push({ id: nextId++, name: n }); c[k]++;
  });
  ta.value = "";
  showAlert(`✅ ${names.length} students split at random: ${c.sea} → ${state.teams.sea.name}, ${c.forest} → ${state.teams.forest.name}.`, true);
  Sound.click(); renderLists();
}
function reshuffle() {                                // vuelve a repartir a todos
  const all = shuffle([...state.teams.sea.students, ...state.teams.forest.students]);
  if (all.length < 2) { showAlert("Add at least 2 students to shuffle teams."); return; }
  state.teams.sea.students = []; state.teams.forest.students = [];
  const start = rand(2);
  all.forEach((s, i) => state.teams[TEAMS[(i + start) % 2]].students.push(s));
  showAlert("🔀 Teams shuffled!", true); Sound.click(); renderLists();
}
function clearAll() {
  if (busy || !window.confirm("Remove ALL students from both teams?")) return;
  TEAMS.forEach(k => { state.teams[k].students = []; });
  showAlert(""); renderLists();
}
function removeStudent(k, id) {
  if (busy || !state.teams[k]) return;
  state.teams[k].students = state.teams[k].students.filter(s => s.id !== Number(id));
  renderLists();
}

/* ===== 7. IMÁGENES DE FONDO (una por equipo) ===== */
function setBg(k, url) {
  const el = $("bg-" + k); if (!el || !url) return;
  const img = new Image();
  img.onload = () => el.style.setProperty("--img", `url("${url}")`);
  img.onerror = () => console.info("Background image not found:", url);
  img.src = url;
}
function onFile(k, e) {
  const f = e.target.files && e.target.files[0];
  if (!f || !f.type.startsWith("image/")) { showAlert("Please choose an image file."); return; }
  setBg(k, URL.createObjectURL(f));
}

/* ===== 8. DUELO ===== */
function spin(k, value) {
  const die = $("d-" + k), w = $("w-" + k); if (!die || !ROT[value]) return;
  const [rx, ry] = ROT[value], turns = 720 + rand(2) * 360;   // vueltas extra: no cambian la cara final
  die.style.transition = "none"; die.style.transform = "rotateX(0) rotateY(0)"; void die.offsetWidth;
  die.style.transition = ""; die.style.transform = `rotateX(${rx + turns}deg) rotateY(${ry + turns}deg)`;
  if (w) w.classList.add("rolling");
}
function roll() {
  if (busy) return;
  const sea = state.teams.sea.students, forest = state.teams.forest.students;
  if (!sea.length || !forest.length) { showAlert("Both teams need at least one student before rolling."); return; }
  busy = true; showAlert("");
  const btn = $("roll"); if (btn) btn.disabled = true;
  const a = sea[rand(sea.length)], b = forest[rand(forest.length)];
  let ra, rb; do { ra = 1 + rand(6); rb = 1 + rand(6); } while (ra === rb);   // empate = se repite
  const nm = { sea: a.name, forest: b.name };
  TEAMS.forEach(k => { const n = $("n-" + k), s = $("s-" + k); if (n) n.textContent = nm[k]; if (s) s.textContent = ""; });
  const res = $("result"); if (res) res.textContent = "The dice are rolling…";
  document.querySelectorAll("li.pick").forEach(l => l.classList.remove("pick"));
  Sound.rolling(); burst(30); spin("sea", ra); spin("forest", rb);

  setTimeout(() => {
    TEAMS.forEach(k => { const w = $("w-" + k); if (w) w.classList.remove("rolling"); });
    const sS = $("s-sea"), sF = $("s-forest"); if (sS) sS.textContent = ra; if (sF) sF.textContent = rb;
    const seaWins = ra > rb, winner = seaWins ? a : b, wk = seaWins ? "sea" : "forest";
    const li = document.querySelector(`li[data-id="${winner.id}"]`); if (li) li.classList.add("pick");
    if (res) res.innerHTML = `<b>${esc(winner.name)}</b> wins ${seaWins ? ra : rb} to ${seaWins ? rb : ra}`;
    state.duels.unshift({ sea: { name: a.name, roll: ra }, forest: { name: b.name, roll: rb }, winnerName: winner.name, winnerTeam: wk, at: new Date().toISOString() });
    renderHistory(); showWinner(wk, winner.name, ra, rb);
    busy = false; if (btn) btn.disabled = false;
  }, state.config.rollDurationMs || 2200);
}

/* ===== 9. ALERTA DE GANADOR (con las características del equipo) ===== */
function showWinner(wk, student, ra, rb) {
  const t = state.teams[wk], ov = $("winner"), m = $("modal"); if (!t || !ov || !m) return;
  const set = (id, txt) => { const e = $(id); if (e) e.textContent = txt; };
  m.className = "modal " + wk;
  set("w-emoji", t.emoji); set("w-team", t.name); set("w-student", student);
  set("w-score", `Dice: ${state.teams.sea.name} ${ra} — ${rb} ${state.teams.forest.name}`);
  set("w-motto", `“${t.motto}”`); set("w-element", t.element);
  const tr = $("w-traits"); if (tr) tr.innerHTML = t.traits.map(x => `<li>${esc(x)}</li>`).join("");
  ov.hidden = false; Sound.win(); burst(120);
  const c = $("w-close"); if (c) c.focus();
}
function closeWinner() { const ov = $("winner"); if (ov) ov.hidden = true; }

/* ===== 10. INICIO ===== */
async function init() {
  await loadData();                                   // el estado queda listo antes de renderizar
  const sel = $("faction");
  if (sel) sel.innerHTML = TEAMS.map(k => `<option value="${k}">${esc(state.teams[k].emoji + " " + state.teams[k].name)}</option>`).join("");
  buildDie("d-sea"); buildDie("d-forest"); buildDecor();
  spin("sea", 1); spin("forest", 1);
  TEAMS.forEach(k => { const w = $("w-" + k); if (w) w.classList.remove("rolling"); setBg(k, state.teams[k].background); });
  renderLists(); renderHistory();

  const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
  on("add", "click", addStudent); on("split", "click", bulkAdd); on("reshuffle", "click", reshuffle); on("clear", "click", clearAll);
  on("name", "keydown", e => { if (e.key === "Enter") addStudent(); });
  on("roll", "click", roll); on("audio", "click", () => Sound.toggle()); on("w-close", "click", closeWinner);
  on("img-sea", "change", e => onFile("sea", e)); on("img-forest", "change", e => onFile("forest", e));
  on("winner", "click", e => { if (e.target === $("winner")) closeWinner(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeWinner(); });
  document.addEventListener("click", e => {           // botones ✕ (delegación de eventos)
    const t = e.target instanceof Element ? e.target.closest("[data-del]") : null;
    if (t) { const [k, id] = t.dataset.del.split(":"); removeStudent(k, id); }
  });
  setInterval(() => {
    if (document.hidden) return;
    fairy();
    if (Math.random() < .7) drift("decor-sea", "bubble", "", `width:${6 + rand(16)}px;height:${6 + rand(16)}px`, 5);
    if (Math.random() < .4) drift("decor-forest", "fl leaf", "🍃", "font-size:1.1rem", 8);
  }, 350);
  burst(25);
}
document.addEventListener("DOMContentLoaded", init);
