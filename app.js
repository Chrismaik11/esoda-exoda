/* app.js — κύρια λογική Έσοδα–Έξοδα */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDocs, setDoc, addDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
import { $, fmtD, parseD, todayISO, money, esc, GR_MONTHS, ROLES, toast, showScreen, authMsg, showErr, addDays } from "./util.js";
import { computePnL, periodRange } from "./engine.js";
import { voiceSupported, startVoice, parseVoiceRevenue, applyVoiceRevenue, parseVoiceTx, handleReceiptFile, voiceBanner } from "./voice.js";
import { calSetBusiness, calEnabled, calAvailable, calConnect, calDisconnect, calSync, calMarkPaid } from "./calendar.js";

window.__booted = true;

/* ---------- state ---------- */
let app, auth, db;
let user = null;
let businesses = [];
let biz = null;
let role = null;
let tab = "dash";
let gran = "month";
let anchor = todayISO();
let dashPeriod = "month";
let txMonth = todayISO().slice(0, 7) + "-01";
let txSearch = "";
let editTx = null;             // { col: 'incomes'|'expenses', id, data }
let banks = [];                // [{id, name, kind}]
let cats = [];                 // [{id, name, type}]

const METHODS = { cash: "Μετρητά", card: "Κάρτα", bank: "Τράπεζα", iris: "IRIS" };
const PERIODS = { weekly: "Εβδομαδιαίο", monthly: "Μηνιαίο", quarterly: "Τριμηνιαίο", yearly: "Ετήσιο" };
const DEFAULT_CATS = {
  expense: ["ΔΕΚΟ", "Ενοίκιο", "Καύσιμα", "Συντήρηση", "Μεταφορικά", "Αναλώσιμα", "Φόροι", "Λοιπά"],
  income: ["Πωλήσεις", "Υπηρεσίες", "Λοιπά έσοδα"]
};

const base = () => `businesses/${biz.id}`;
const bankName = (id) => (banks.find(b => b.id === id) || {}).name || "";

/* ---------- boot ---------- */
if (String(firebaseConfig.apiKey).startsWith("PASTE")) {
  showScreen("screen-config");
} else {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  onAuthStateChanged(auth, async (u) => {
    user = u;
    if (!u) { showScreen("screen-auth"); return; }
    await loadBusinesses();
  });
}

/* ---------- auth UI ---------- */
$("to-register").onclick = () => { $("auth-login").style.display="none"; $("auth-register").style.display="block"; $("auth-reset").style.display="none"; };
$("to-login").onclick = $("to-login2").onclick = () => { $("auth-login").style.display="block"; $("auth-register").style.display="none"; $("auth-reset").style.display="none"; };
$("to-reset").onclick = () => { $("auth-login").style.display="none"; $("auth-register").style.display="none"; $("auth-reset").style.display="block"; };

$("li-btn").onclick = async () => {
  showErr("li-error", "");
  $("li-btn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("li-email").value.trim(), $("li-pass").value);
  } catch(e) { showErr("li-error", authMsg(e.code)); }
  $("li-btn").disabled = false;
};
$("li-pass").addEventListener("keydown", e => { if (e.key === "Enter") $("li-btn").click(); });

$("rg-btn").onclick = async () => {
  showErr("rg-error", "");
  const name = $("rg-name").value.trim();
  if (!name) { showErr("rg-error", "Γράψε το όνομά σου."); return; }
  $("rg-btn").disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, $("rg-email").value.trim(), $("rg-pass").value);
    await updateProfile(cred.user, { displayName: name });
    toast("Ο λογαριασμός δημιουργήθηκε!");
  } catch(e) { showErr("rg-error", authMsg(e.code)); }
  $("rg-btn").disabled = false;
};

$("rs-btn").onclick = async () => {
  showErr("rs-error", "");
  try {
    await sendPasswordResetEmail(auth, $("rs-email").value.trim());
    toast("Στάλθηκε email επαναφοράς κωδικού.");
    $("to-login2").click();
  } catch(e) { showErr("rs-error", authMsg(e.code)); }
};

/* ---------- businesses ---------- */
async function loadBusinesses() {
  try {
    const q1 = query(collection(db, "businesses"),
      where(`members.${user.uid}`, "in", ["owner", "accountant", "staff"]));
    const snap = await getDocs(q1);
    businesses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    console.error(e); toast("Σφάλμα φόρτωσης επιχειρήσεων"); businesses = [];
  }
  if (businesses.length === 0) { showScreen("screen-newbiz"); return; }
  const lastId = localStorage.getItem("ee_last_biz");
  selectBiz(businesses.find(b => b.id === lastId) || businesses[0]);
}

async function selectBiz(b) {
  biz = b;
  role = (b.members || {})[user.uid] || "staff";
  localStorage.setItem("ee_last_biz", b.id);
  $("hd-biz").textContent = b.name;
  $("hd-role").textContent = ROLES[role] || role;
  const limited = role === "staff";
  /* Το tab «Εργασίες» είναι ορατό σε όλους — το προσωπικό βλέπει μόνο τη
     λίστα εργασιών, όχι τις προγραμματισμένες πληρωμές. */
  $("tab-settings-btn").style.display = limited ? "none" : "";
  if (limited && tab === "settings") tab = "dash";
  showScreen("screen-main");
  calSetBusiness(b.id);
  await loadMeta();
  renderTab();
  refreshDue();
}

/* ---- εκκρεμότητες: σήμα στο tab + συγχρονισμός ημερολογίου ---- */
let dueItems = { scheduled: [], todos: [] };

async function refreshDue() {
  try {
    dueItems.scheduled = [];
    if (role !== "staff") {
      const sSnap = await getDocs(collection(db, `${base()}/scheduled`));
      dueItems.scheduled = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    const tSnap = await getDocs(collection(db, `${base()}/todos`));
    dueItems.todos = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { return; }
  const today = todayISO();
  const n = dueItems.scheduled.filter(s => s.date && s.date <= today).length
          + dueItems.todos.filter(t => !t.done && t.date && t.date <= today).length;
  const btn = $("tab-sched-btn");
  if (btn) {
    const old = btn.querySelector(".tab-badge");
    if (old) old.remove();
    if (n > 0) {
      const b = document.createElement("span");
      b.className = "tab-badge";
      b.textContent = String(n);
      btn.appendChild(b);
    }
  }
  calSync(dueItems.scheduled, dueItems.todos);
}

/* Τράπεζες + κατηγορίες (με seed προεπιλογών την πρώτη φορά) */
async function loadMeta() {
  try {
    const [bSnap, cSnap] = await Promise.all([
      getDocs(collection(db, `${base()}/banks`)),
      getDocs(collection(db, `${base()}/categories`))
    ]);
    banks = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    cats = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (cats.length === 0 && role !== "staff") {
      for (const type of ["expense", "income"]) {
        for (const name of DEFAULT_CATS[type]) {
          const ref = await addDoc(collection(db, `${base()}/categories`), { name, type });
          cats.push({ id: ref.id, name, type });
        }
      }
    }
  } catch(e) { console.error(e); banks = []; cats = []; }
}

$("hd-switch").onclick = async () => {
  if (businesses.length < 2) {
    if (confirm("Έχεις μόνο μία επιχείρηση.\n\nΘες να δημιουργήσεις νέα;")) showScreen("screen-newbiz");
    return;
  }
  const names = businesses.map((b,i) => `${i+1}. ${b.name}`).join("\n");
  const pick = prompt("Διάλεξε επιχείρηση (αριθμός):\n" + names, "1");
  const idx = parseInt(pick, 10) - 1;
  if (businesses[idx]) selectBiz(businesses[idx]);
};

$("hd-logout").onclick = $("nb-logout").onclick = () => signOut(auth);

$("nb-btn").onclick = async () => {
  showErr("nb-error", "");
  const name = $("nb-name").value.trim();
  if (!name) { showErr("nb-error", "Γράψε όνομα επιχείρησης."); return; }
  $("nb-btn").disabled = true;
  try {
    const data = {
      name, vatNumber: $("nb-vat").value.trim() || null,
      ownerUid: user.uid,
      members: { [user.uid]: "owner" },
      createdAt: serverTimestamp()
    };
    const ref = await addDoc(collection(db, "businesses"), data);
    businesses.push({ id: ref.id, ...data });
    $("nb-name").value = ""; $("nb-vat").value = "";
    toast("Η επιχείρηση δημιουργήθηκε!");
    selectBiz(businesses[businesses.length - 1]);
  } catch(e) { console.error(e); showErr("nb-error", "Σφάλμα: " + (e.message || e.code)); }
  $("nb-btn").disabled = false;
};

/* ---------- tabs ---------- */
document.querySelectorAll(".tab-btn").forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  renderTab();
});

function renderTab() {
  document.querySelectorAll(".tab-btn").forEach(x => x.classList.toggle("active", x.dataset.tab === tab));
  editTx = null;
  if (tab === "dash") renderDash();
  else if (tab === "revenue") renderRevenue();
  else if (tab === "tx") renderTx();
  else if (tab === "sched") renderSched();
  else if (tab === "report") renderReport();
  else renderSettings();
}
const content = () => $("tab-content");

/* ---------- helpers κινήσεων ---------- */
function monthLabel(iso) { const d = parseD(iso); return `${GR_MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function shiftMonth(iso, n) { const d = parseD(iso); d.setMonth(d.getMonth()+n); return fmtD(new Date(d.getFullYear(), d.getMonth(), 1)); }
function fmtShortDate(s) { return new Date(s).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit" }); }

function txTitle(t) {
  if (t._col === "incomes") return t.category || "Έσοδο";
  return t.type === "purchase" ? (t.supplierName || "Αγορά") : (t.category || "Λοιπά");
}
function txSub(t) {
  const bits = [fmtShortDate(t.date)];
  if (t.paymentMethod) bits.push(METHODS[t.paymentMethod] || t.paymentMethod);
  if (t.bankId && bankName(t.bankId)) bits.push(bankName(t.bankId));
  if (t.source === "mydata") bits.push("myDATA");
  if (t.type === "purchase") bits.push("αγορά");
  if (t.note) bits.push(t.note);
  return bits.join(" · ");
}
function txRow(t, withActions) {
  const isInc = t._col === "incomes";
  const actions = withActions && t.source !== "mydata"
    ? `<button class="btn-del" data-edit="${t._col}:${t.id}" title="Επεξεργασία">✎</button>
       <button class="btn-del" data-del="${t._col}:${t.id}" title="Διαγραφή">✕</button>` : "";
  return `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(txTitle(t))}</div>
        <div class="row-sub">${esc(txSub(t))}</div>
      </div>
      <div class="row-amount ${isInc ? "pos" : "neg"}">${isInc ? "" : "− "}${money(t.amount)}</div>
      ${actions}
    </div>`;
}

async function fetchRange(col, from, to) {
  const snap = await getDocs(query(
    collection(db, `${base()}/${col}`),
    where("date", ">=", from), where("date", "<=", to)));
  return snap.docs.map(d => ({ id: d.id, _col: col, ...d.data() }));
}

/* ============ ΣΥΝΟΨΗ ============ */
async function renderDash() {
  content().innerHTML = `
    <div class="gran-row" style="margin-top:14px">
      ${[["day","Ημέρα"],["week","Εβδομάδα"],["month","Μήνας"],["year","Έτος"]].map(([g,l]) =>
        `<button class="gran-btn ${dashPeriod===g?"active":""}" data-dp="${g}">${l}</button>`).join("")}
    </div>
    <div class="card" id="dash-hero"><div class="spinner">Υπολογισμός…</div></div>
    <div id="dash-banks"></div>
    <div class="section-title">Πρόσφατες κινήσεις</div>
    <div class="card" id="dash-recent"><div class="spinner">Φόρτωση…</div></div>
    <div id="dash-sched-wrap"></div>`;
  content().querySelectorAll("[data-dp]").forEach(b => b.onclick = () => { dashPeriod = b.dataset.dp; renderDash(); });
  loadDash();
}

async function loadDash() {
  const [from, to, label] = periodRange(dashPeriod, todayISO());
  try {
    const [incAll, expAll, revSnap] = await Promise.all([
      getDocs(collection(db, `${base()}/incomes`)),
      getDocs(collection(db, `${base()}/expenses`)),
      getDocs(query(collection(db, `${base()}/revenues`), where("date", ">=", from), where("date", "<=", to)))
    ]);
    const incomes = incAll.docs.map(d => ({ id: d.id, _col: "incomes", ...d.data() }));
    const expenses = expAll.docs.map(d => ({ id: d.id, _col: "expenses", ...d.data() }));
    let gross = 0; revSnap.forEach(d => { gross += d.data().gross || 0; });

    const inP = (t) => t.date >= from && t.date <= to;
    const incP = incomes.filter(inP).reduce((s,t) => s + (t.amount||0), 0);
    const expP = expenses.filter(inP).reduce((s,t) => s + (t.amount||0), 0);
    const totalIn = gross + incP;
    const balance = totalIn - expP;
    const bc = balance >= 0 ? "var(--green)" : "var(--red)";
    $("dash-hero").innerHTML = `
      <div class="row-sub" style="text-align:center">${esc(label)} · Ισοζύγιο</div>
      <div class="hero-amount" style="color:${bc}">${money(balance)}</div>
      <div class="hero-split">
        <div><div class="row-sub">↓ Έσοδα</div><div class="hero-mini pos">${money(totalIn)}</div>
          ${gross > 0 && incP > 0 ? `<div class="row-sub">τζίρος ${money(gross)} + λοιπά ${money(incP)}</div>` : ""}</div>
        <div><div class="row-sub">↑ Έξοδα</div><div class="hero-mini neg">${money(expP)}</div></div>
      </div>
      <div class="row-sub" style="text-align:center;margin-top:6px">χωρίς πάγια/μισθοδοσία — βλ. Αναφορά</div>`;

    /* υπόλοιπα τραπεζών/καρτών (όλες οι κινήσεις με τράπεζα) */
    if (banks.length > 0) {
      const bal = {};
      incomes.forEach(t => { if (t.bankId) bal[t.bankId] = (bal[t.bankId] || 0) + (t.amount||0); });
      expenses.forEach(t => { if (t.bankId) bal[t.bankId] = (bal[t.bankId] || 0) - (t.amount||0); });
      $("dash-banks").innerHTML = `
        <div class="section-title">Τράπεζες & Κάρτες</div>
        <div class="card">${banks.map(b => `
          <div class="row">
            <div class="row-main"><div class="row-title">${b.kind === "card" ? "💳" : "🏦"} ${esc(b.name)}</div>
            <div class="row-sub">από κινήσεις</div></div>
            <div class="row-amount ${(bal[b.id]||0) >= 0 ? "pos" : "neg"}">${money(bal[b.id] || 0)}</div>
          </div>`).join("")}</div>`;
    } else $("dash-banks").innerHTML = "";

    /* πρόσφατες */
    const recent = incomes.concat(expenses)
      .sort((a,b) => b.date.localeCompare(a.date)).slice(0, 6);
    $("dash-recent").innerHTML = recent.length === 0
      ? `<div class="empty">Καμία κίνηση ακόμα — πήγαινε στις Κινήσεις</div>`
      : recent.map(t => txRow(t, false)).join("");
  } catch(e) { console.error(e); $("dash-hero").innerHTML = `<div class="empty">Σφάλμα φόρτωσης</div>`; }

  /* εκκρεμότητες: πληρωμές + εργασίες με προθεσμία (σύντομη ματιά) */
  loadDashPending();
}

async function loadDashPending() {
  const today = todayISO();
  const items = [];
  try {
    if (role !== "staff") {
      const sSnap = await getDocs(collection(db, `${base()}/scheduled`));
      sSnap.forEach(d => {
        const s = d.data();
        if (s.date) items.push({ kind: "pay", label: s.label, date: s.date, amount: s.amount, type: s.type });
      });
    }
    const tSnap = await getDocs(collection(db, `${base()}/todos`));
    tSnap.forEach(d => {
      const t = d.data();
      if (t.date && !t.done) items.push({ kind: "todo", label: t.text, date: t.date });
    });
  } catch(e) { $("dash-sched-wrap").innerHTML = ""; return; }

  items.sort((a,b) => a.date.localeCompare(b.date));
  const top = items.slice(0, 4);
  $("dash-sched-wrap").innerHTML = top.length === 0 ? "" : `
    <div class="section-title">Εκκρεμότητες</div>
    <div class="card">${top.map(i => {
      const late = i.date <= today;
      return `
      <div class="row">
        <div class="row-main">
          <div class="row-title">${i.kind === "pay" ? "💸" : "⬜"} ${esc(i.label)}</div>
          <div class="row-sub" style="${late ? "color:var(--red);font-weight:600" : ""}">${late ? "⚠ " : ""}${fmtShortDate(i.date)}</div>
        </div>
        ${i.kind === "pay" ? `<div class="row-amount ${i.type === "income" ? "pos" : "neg"}">${money(i.amount)}</div>` : ""}
      </div>`; }).join("")}
      <div class="row-sub" style="margin-top:8px">Διαχείριση στο tab «Εργασίες»</div>
    </div>`;
}

async function loadTodos() {
  try {
    const snap = await getDocs(collection(db, `${base()}/todos`));
    const today = todayISO();
    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (a.date || "9999").localeCompare(b.date || "9999");
      });
    $("task-todos").innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input type="text" class="form-input" id="todo-input" placeholder="Νέα εργασία…" style="flex:1">
        <button class="btn-primary" id="todo-add" style="width:auto;margin-top:0;padding:11px 16px">+</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:${todos.length ? "12px" : "0"}">
        <span class="row-sub" style="flex:none">Προθεσμία (προαιρ.):</span>
        <input type="date" class="form-input" id="todo-date" style="flex:1;padding:7px 10px;font-size:13px">
      </div>
      ${todos.map(t => {
        const late = !t.done && t.date && t.date <= today;
        return `
        <div class="row">
          <input type="checkbox" data-todo-toggle="${t.id}" ${t.done ? "checked" : ""} style="width:18px;height:18px;flex:none">
          <div class="row-main">
            <div class="row-title" style="${t.done ? "text-decoration:line-through;color:var(--ink-3)" : ""}">${esc(t.text)}</div>
            ${t.date ? `<div class="row-sub" style="${late ? "color:var(--red);font-weight:600" : ""}">${late ? "⚠ " : "📅 "}${fmtShortDate(t.date)}${calEnabled() ? " · στο ημερολόγιο" : ""}</div>` : ""}
          </div>
          <button class="btn-del" data-todo-del="${t.id}">✕</button>
        </div>`; }).join("")}`;
    $("todo-add").onclick = async () => {
      const text = $("todo-input").value.trim();
      if (!text) return;
      const date = $("todo-date").value || null;
      await addDoc(collection(db, `${base()}/todos`), { text, date, done: false, createdAt: serverTimestamp() });
      $("todo-input").value = ""; $("todo-date").value = "";
      loadTodos(); refreshDue();
    };
    $("todo-input").addEventListener("keydown", e => { if (e.key === "Enter") $("todo-add").click(); });
    $("task-todos").querySelectorAll("[data-todo-toggle]").forEach(c => c.onchange = async () => {
      await setDoc(doc(db, `${base()}/todos/${c.dataset.todoToggle}`), { done: c.checked }, { merge: true });
      loadTodos(); refreshDue();
    });
    $("task-todos").querySelectorAll("[data-todo-del]").forEach(b => b.onclick = async () => {
      await deleteDoc(doc(db, `${base()}/todos/${b.dataset.todoDel}`));
      loadTodos(); refreshDue();
    });
  } catch(e) { console.error(e); $("task-todos").innerHTML = `<div class="empty">Σφάλμα φόρτωσης</div>`; }
}

/* ============ ΤΑΜΕΙΟ ============ */
async function renderRevenue() {
  content().innerHTML = `
    <div class="section-title">Ημερήσιος τζίρος</div>
    <div class="card">
      <div id="rv-voice-info"></div>
      ${voiceSupported() ? `<button class="voice-btn" id="rv-voice-btn" type="button">🎤 Φωνητική καταχώρηση</button>` : ""}
      <label class="form-label">Ημερομηνία</label>
      <input type="date" class="form-input" id="rv-date" value="${todayISO()}">
      <div class="grid-2">
        <div><label class="form-label">Τζίρος (€)</label>
        <input type="number" class="form-input" id="rv-gross" inputmode="decimal" step="0.01" min="0" placeholder="0,00"></div>
        <div><label class="form-label">Κουβέρ (προαιρ.)</label>
        <input type="number" class="form-input" id="rv-covers" inputmode="numeric" min="0" placeholder="—"></div>
      </div>
      <button class="btn-primary" id="rv-save">Καταχώρηση</button>
    </div>
    <div class="section-title">Τελευταίες 14 ημέρες</div>
    <div class="card" id="rv-list"><div class="spinner">Φόρτωση…</div></div>`;

  if ($("rv-voice-btn")) $("rv-voice-btn").onclick = () => startVoice({
    hints: "π.χ. «τζίρος 850 ευρώ»<br>«χθες 1.200 ευρώ και 45 κουβέρ»",
    onText: (text) => applyVoiceRevenue(parseVoiceRevenue(text), text)
  });

  $("rv-save").onclick = async () => {
    const date = $("rv-date").value;
    const gross = parseFloat($("rv-gross").value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Διάλεξε ημερομηνία"); return; }
    if (!(gross >= 0)) { toast("Γράψε ποσό"); return; }
    const covers = parseInt($("rv-covers").value, 10);
    try {
      await setDoc(doc(db, `${base()}/revenues/${date}`), {
        date, gross, covers: isNaN(covers) ? null : covers,
        source: "manual", updatedBy: user.uid, updatedAt: serverTimestamp()
      }, { merge: true });
      toast("Καταχωρήθηκε ✓"); $("rv-gross").value = ""; $("rv-covers").value = "";
      loadRevList();
    } catch(e) { console.error(e); toast("Σφάλμα καταχώρησης"); }
  };
  loadRevList();
}

async function loadRevList() {
  try {
    const snap = await getDocs(query(
      collection(db, `${base()}/revenues`), orderBy("date", "desc"), limit(14)));
    const rows = snap.docs.map(d => d.data());
    $("rv-list").innerHTML = rows.length === 0 ? `<div class="empty">Καμία καταχώρηση ακόμα</div>` :
      rows.map(r => `
        <div class="row">
          <div class="row-main">
            <div class="row-title">${new Date(r.date).toLocaleDateString("el-GR",{weekday:"short",day:"2-digit",month:"2-digit"})}</div>
            <div class="row-sub">${r.covers ? r.covers + " κουβέρ · " : ""}${r.source === "rezervo" ? "αυτόματο" : "χειροκίνητο"}</div>
          </div>
          <div class="row-amount pos">${money(r.gross)}</div>
        </div>`).join("");
  } catch(e) { console.error(e); $("rv-list").innerHTML = `<div class="empty">Σφάλμα φόρτωσης</div>`; }
}

/* ============ ΚΙΝΗΣΕΙΣ ============ */
function catOptions(type, selected) {
  const list = cats.filter(c => c.type === type);
  let opts = "";
  if (type === "expense") opts += `<option value="__purchase" ${selected === "__purchase" ? "selected" : ""}>Αγορά (προμηθευτής)</option>`;
  opts += list.map(c => `<option value="${esc(c.name)}" ${selected === c.name ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  opts += `<option value="__free" ${selected === "__free" ? "selected" : ""}>Άλλη κατηγορία…</option>`;
  return opts;
}

function renderTx() {
  const t = editTx;
  const initialType = t ? (t.col === "incomes" ? "income" : "expense") : "expense";
  content().innerHTML = `
    <div class="section-title">${t ? "Επεξεργασία κίνησης" : "Νέα κίνηση"}</div>
    <div class="card">
      <div id="tx-voice-info"></div>
      <div class="tool-row">
        ${voiceSupported() ? `<button class="voice-btn" id="tx-voice-btn" type="button">🎤 Φωνητική</button>` : ""}
        <button class="voice-btn scan-btn" id="tx-scan-btn" type="button">📷 Σκάναρε απόδειξη</button>
      </div>
      <input type="file" id="tx-scan-file" accept="image/*" capture="environment" style="display:none">
      <div id="tx-key-card" style="display:none;background:var(--amber-bg);border:1px solid var(--amber);border-radius:10px;padding:10px 12px;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">Κλειδί Gemini API για τη σάρωση</div>
        <div class="muted" style="font-size:12px;margin-bottom:8px">Δωρεάν από <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> — αποθηκεύεται μόνο σε αυτή τη συσκευή.</div>
        <input type="password" class="form-input" id="tx-key-input" placeholder="AIza…">
        <button class="btn-primary" id="tx-key-save" style="margin-top:8px">Αποθήκευση κλειδιού</button>
      </div>
      <div class="type-toggle">
        <button class="type-btn" data-tx-type="income">↓ Έσοδο</button>
        <button class="type-btn" data-tx-type="expense">↑ Έξοδο</button>
      </div>
      <div class="grid-2">
        <div><label class="form-label">Ημερομηνία</label>
        <input type="date" class="form-input" id="tx-date" value="${todayISO()}"></div>
        <div><label class="form-label">Ποσό (€)</label>
        <input type="number" class="form-input" id="tx-amount" inputmode="decimal" step="0.01" min="0" placeholder="0,00"></div>
      </div>
      <label class="form-label">Κατηγορία</label>
      <select class="form-select" id="tx-cat"></select>
      <div id="tx-free-wrap" style="display:none">
        <label class="form-label">Κατηγορία (ελεύθερο κείμενο)</label>
        <input type="text" class="form-input" id="tx-cat-free" placeholder="π.χ. Διαφήμιση">
      </div>
      <div id="tx-supplier-wrap" style="display:none">
        <label class="form-label">Προμηθευτής</label>
        <input type="text" class="form-input" id="tx-supplier" placeholder="π.χ. Μύλοι Αχαΐας">
        <label class="form-label">ΑΦΜ προμηθευτή (προαιρ.)</label>
        <input type="text" class="form-input" id="tx-supvat" inputmode="numeric" placeholder="—">
      </div>
      <div class="grid-2">
        <div><label class="form-label">Τρόπος πληρωμής</label>
        <select class="form-select" id="tx-method">
          ${Object.entries(METHODS).map(([k,l]) => `<option value="${k}">${l}</option>`).join("")}
        </select></div>
        <div id="tx-bank-wrap" style="display:none"><label class="form-label">Τράπεζα/Κάρτα</label>
        <select class="form-select" id="tx-bank"></select></div>
      </div>
      <label class="form-label">Σημείωση (προαιρ.)</label>
      <input type="text" class="form-input" id="tx-note" placeholder="—">
      <button class="btn-primary" id="tx-save">${t ? "Αποθήκευση αλλαγών" : "Καταχώρηση"}</button>
      ${t ? `<button class="btn-secondary" id="tx-cancel" style="margin-top:8px">Ακύρωση επεξεργασίας</button>` : ""}
    </div>
    <div class="section-title">Κινήσεις μήνα</div>
    <div class="period-nav">
      <button class="pn-btn" id="tx-prev">‹</button>
      <div class="label">${monthLabel(txMonth)}</div>
      <button class="pn-btn" id="tx-next">›</button>
    </div>
    <input type="text" class="form-input" id="tx-search" placeholder="🔍 Αναζήτηση…" value="${esc(txSearch)}" style="margin-bottom:10px">
    <div class="card" id="tx-list"><div class="spinner">Φόρτωση…</div></div>`;

  let txType = initialType;
  const setType = (ty) => {
    txType = ty;
    content().querySelectorAll("[data-tx-type]").forEach(b => {
      b.classList.toggle("active-in", ty === "income" && b.dataset.txType === "income");
      b.classList.toggle("active-out", ty === "expense" && b.dataset.txType === "expense");
    });
    $("tx-cat").innerHTML = catOptions(ty, null);
    syncCatUI();
  };
  const syncCatUI = () => {
    const v = $("tx-cat").value;
    $("tx-supplier-wrap").style.display = v === "__purchase" ? "" : "none";
    $("tx-free-wrap").style.display = v === "__free" ? "" : "none";
  };
  const syncBankUI = () => {
    const m = $("tx-method").value;
    const need = m === "card" || m === "bank" || m === "iris";
    $("tx-bank-wrap").style.display = need ? "" : "none";
    if (need) {
      const pool = banks.filter(b => m === "card" ? b.kind === "card" : b.kind !== "card");
      $("tx-bank").innerHTML = pool.length === 0
        ? `<option value="">— πρόσθεσε στις Ρυθμίσεις —</option>`
        : `<option value="">—</option>` + pool.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
    }
  };
  content().querySelectorAll("[data-tx-type]").forEach(b => b.onclick = () => setType(b.dataset.txType));
  $("tx-cat").onchange = syncCatUI;
  $("tx-method").onchange = syncBankUI;
  setType(txType);
  syncBankUI();

  /* prefill σε επεξεργασία */
  if (t) {
    const d = t.data;
    $("tx-date").value = d.date;
    $("tx-amount").value = String(d.amount);
    if (t.col === "expenses" && d.type === "purchase") {
      $("tx-cat").value = "__purchase";
      $("tx-supplier").value = d.supplierName || "";
      $("tx-supvat").value = d.supplierVat || "";
    } else if (d.category && cats.some(c => c.name === d.category && c.type === txType)) {
      $("tx-cat").value = d.category;
    } else if (d.category) {
      $("tx-cat").value = "__free";
      $("tx-cat-free").value = d.category;
    }
    syncCatUI();
    if (d.paymentMethod) { $("tx-method").value = d.paymentMethod; syncBankUI(); }
    if (d.bankId) $("tx-bank").value = d.bankId;
    $("tx-note").value = d.note || "";
    if ($("tx-cancel")) $("tx-cancel").onclick = () => { editTx = null; renderTx(); };
  }

  /* φωνητική */
  if ($("tx-voice-btn")) $("tx-voice-btn").onclick = () => startVoice({
    hints: "π.χ. «40 ευρώ ΔΕΗ χθες με κάρτα»<br>«αγορά 320 ευρώ Μύλοι Αχαΐας»<br>«είσπραξη 150 ευρώ από πελάτη»",
    onText: (text) => {
      const r = parseVoiceTx(text, { cats, banks });
      setType(r.type);
      if (r.date) $("tx-date").value = r.date;
      if (r.amount != null && r.amount > 0) $("tx-amount").value = String(Math.round(r.amount * 100) / 100);
      if (r.purchase) { $("tx-cat").value = "__purchase"; if (r.supplier) $("tx-supplier").value = r.supplier; }
      else if (r.category) {
        if (cats.some(c => c.name === r.category && c.type === r.type)) $("tx-cat").value = r.category;
        else { $("tx-cat").value = "__free"; $("tx-cat-free").value = r.category; }
      }
      syncCatUI();
      if (r.method) { $("tx-method").value = r.method; syncBankUI(); }
      if (r.bankId) $("tx-bank").value = r.bankId;
      if (r.note) $("tx-note").value = r.note;
      const parts = [];
      parts.push(r.type === "income" ? "↓ Έσοδο" : (r.purchase ? "↑ Αγορά (προμηθευτής)" : "↑ Έξοδο"));
      if (r.amount != null && r.amount > 0) parts.push("Ποσό: " + money(r.amount)); else parts.push("⚠️ Δεν κατάλαβα το ποσό");
      if (r.purchase && r.supplier) parts.push("Προμηθευτής: " + r.supplier);
      if (!r.purchase && r.category) parts.push("Κατηγορία: " + r.category);
      if (r.method) parts.push(METHODS[r.method] + (r.bankId ? " (" + bankName(r.bankId) + ")" : ""));
      if (r.date !== todayISO()) parts.push("Ημ/νία: " + new Date(r.date).toLocaleDateString("el-GR"));
      if (r.note) parts.push("Σημ.: " + r.note);
      voiceBanner("tx-voice-info", `Άκουσα: «${text}»`, parts);
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch(e) {} }
    }
  });

  /* σάρωση */
  $("tx-scan-btn").onclick = () => {
    if (!localStorage.getItem("ee_gemini_key")) { $("tx-key-card").style.display = ""; $("tx-key-input").focus(); return; }
    $("tx-scan-file").click();
  };
  $("tx-key-save").onclick = () => {
    const k = $("tx-key-input").value.trim();
    if (!k) { toast("Επικόλλησε το κλειδί"); return; }
    localStorage.setItem("ee_gemini_key", k);
    $("tx-key-card").style.display = "none";
    toast("Το κλειδί αποθηκεύτηκε ✓");
    $("tx-scan-file").click();
  };
  $("tx-scan-file").onchange = (e) => {
    if (e.target.files && e.target.files[0]) handleReceiptFile(e.target.files[0], {
      onData: (d) => {
        setType("expense");
        const isPurchase = !!d.isPurchase;
        if (typeof d.amount === "number" && d.amount > 0) $("tx-amount").value = String(Math.round(d.amount * 100) / 100);
        if (d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) $("tx-date").value = d.date;
        if (isPurchase) {
          $("tx-cat").value = "__purchase";
          if (d.supplier) $("tx-supplier").value = d.supplier;
          if (d.supplierVat) $("tx-supvat").value = String(d.supplierVat).replace(/\D/g, "");
        } else if (d.category) {
          if (cats.some(c => c.name === d.category && c.type === "expense")) $("tx-cat").value = d.category;
          else { $("tx-cat").value = "__free"; $("tx-cat-free").value = d.category; }
        }
        syncCatUI();
        const parts = [];
        parts.push(isPurchase ? "Αγορά (προμηθευτής)" : "Έξοδο");
        if (typeof d.amount === "number" && d.amount > 0) parts.push("Ποσό: " + money(d.amount)); else parts.push("⚠️ Δεν βρέθηκε ποσό");
        if (d.supplier) parts.push("Προμηθευτής: " + d.supplier);
        if (d.category && !isPurchase) parts.push("Κατηγορία: " + d.category);
        if (d.date) parts.push("Ημ/νία: " + new Date(d.date).toLocaleDateString("el-GR"));
        if (typeof d.confidence === "number" && d.confidence < 0.6) parts.push("⚠️ Χαμηλή βεβαιότητα — έλεγξε προσεκτικά");
        voiceBanner("tx-voice-info", "Από τη σάρωση:", parts);
      },
      onBadKey: () => { $("tx-key-card").style.display = ""; }
    });
    e.target.value = "";
  };

  /* αποθήκευση */
  $("tx-save").onclick = async () => {
    const date = $("tx-date").value;
    const amount = parseFloat($("tx-amount").value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(amount > 0)) { toast("Συμπλήρωσε ημερομηνία και ποσό"); return; }
    const catV = $("tx-cat").value;
    const method = $("tx-method").value;
    const needBank = method === "card" || method === "bank" || method === "iris";
    const bankId = needBank ? ($("tx-bank").value || null) : null;
    const note = $("tx-note").value.trim() || null;
    let payload, col;
    if (txType === "income") {
      col = "incomes";
      payload = {
        date, amount,
        category: catV === "__free" ? ($("tx-cat-free").value.trim() || "Λοιπά έσοδα") : catV,
        paymentMethod: method, bankId, note, source: "manual"
      };
    } else {
      col = "expenses";
      const purchase = catV === "__purchase";
      payload = {
        date, amount,
        type: purchase ? "purchase" : "misc",
        category: purchase ? "Αγορές" : (catV === "__free" ? ($("tx-cat-free").value.trim() || "Λοιπά") : catV),
        supplierName: purchase ? ($("tx-supplier").value.trim() || null) : null,
        supplierVat: purchase ? ($("tx-supvat").value.trim() || null) : null,
        paymentMethod: method, bankId, note, source: "manual"
      };
    }
    try {
      if (editTx) {
        if (editTx.col !== col) {
          await deleteDoc(doc(db, `${base()}/${editTx.col}/${editTx.id}`));
          await addDoc(collection(db, `${base()}/${col}`), { ...payload, createdAt: serverTimestamp() });
        } else {
          await setDoc(doc(db, `${base()}/${col}/${editTx.id}`), payload, { merge: true });
        }
        toast("Αποθηκεύτηκε ✓");
        editTx = null;
      } else {
        await addDoc(collection(db, `${base()}/${col}`), { ...payload, createdAt: serverTimestamp() });
        toast("Καταχωρήθηκε ✓");
      }
      txMonth = date.slice(0, 7) + "-01";
      renderTx();
    } catch(e) { console.error(e); toast("Σφάλμα καταχώρησης"); }
  };

  $("tx-prev").onclick = () => { txMonth = shiftMonth(txMonth, -1); renderTx(); };
  $("tx-next").onclick = () => { txMonth = shiftMonth(txMonth, 1); renderTx(); };
  $("tx-search").oninput = () => { txSearch = $("tx-search").value; loadTxList(); };
  loadTxList();
}

async function loadTxList() {
  const from = txMonth;
  const d = parseD(txMonth);
  const to = fmtD(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  try {
    const [incomes, expenses] = await Promise.all([
      fetchRange("incomes", from, to), fetchRange("expenses", from, to)
    ]);
    let rows = incomes.concat(expenses).sort((a,b) => b.date.localeCompare(a.date));
    const q = txSearch.trim().toLowerCase();
    if (q) rows = rows.filter(t =>
      (txTitle(t) + " " + (t.note || "") + " " + (t.supplierName || "") + " " + String(t.amount)).toLowerCase().includes(q));
    const totIn = rows.filter(t => t._col === "incomes").reduce((s,t) => s + (t.amount||0), 0);
    const totEx = rows.filter(t => t._col === "expenses").reduce((s,t) => s + (t.amount||0), 0);
    $("tx-list").innerHTML = rows.length === 0 ? `<div class="empty">Καμία κίνηση</div>` :
      `<div class="pnl-row"><span>Έσοδα ${money(totIn)} · Έξοδα ${money(totEx)}</span><span class="v" style="color:${totIn-totEx >= 0 ? "var(--green)" : "var(--red)"}">${money(totIn - totEx)}</span></div>` +
      rows.map(t => txRow(t, true)).join("");
    $("tx-list").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm("Διαγραφή κίνησης;")) return;
      const [col, id] = b.dataset.del.split(":");
      try { await deleteDoc(doc(db, `${base()}/${col}/${id}`)); loadTxList(); toast("Διαγράφηκε"); }
      catch(e) { toast("Σφάλμα διαγραφής"); }
    });
    $("tx-list").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
      const [col, id] = b.dataset.edit.split(":");
      const all = incomes.concat(expenses);
      const t = all.find(x => x._col === col && x.id === id);
      if (!t) return;
      editTx = { col, id, data: t };
      renderTx();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  } catch(e) { console.error(e); $("tx-list").innerHTML = `<div class="empty">Σφάλμα φόρτωσης</div>`; }
}

/* ============ ΠΛΗΡΩΜΕΣ (προγραμματισμένες) ============ */
function renderSched() {
  const canPay = role !== "staff";
  content().innerHTML = (canPay ? `
    <div class="section-title">Νέα προγραμματισμένη πληρωμή</div>
    <div class="card">
      <label class="form-label">Περιγραφή</label>
      <input type="text" class="form-input" id="sc-label" placeholder="π.χ. Δόση ΕΦΚΑ, ΦΠΑ τριμήνου">
      <div class="grid-2">
        <div><label class="form-label">Ποσό (€)</label>
        <input type="number" class="form-input" id="sc-amount" inputmode="decimal" step="0.01" min="0"></div>
        <div><label class="form-label">Ημερομηνία</label>
        <input type="date" class="form-input" id="sc-date" value="${todayISO()}"></div>
      </div>
      <div class="grid-2">
        <div><label class="form-label">Τύπος</label>
        <select class="form-select" id="sc-type">
          <option value="expense">Πληρωμή (έξοδο)</option>
          <option value="income">Είσπραξη (έσοδο)</option>
        </select></div>
        <div><label class="form-label">Επανάληψη</label>
        <select class="form-select" id="sc-repeat">
          <option value="none">Καμία</option>
          <option value="monthly">Κάθε μήνα</option>
        </select></div>
      </div>
      <label class="form-label">Κατηγορία (προαιρ.)</label>
      <input type="text" class="form-input" id="sc-cat" placeholder="π.χ. Φόροι">
      <button class="btn-primary" id="sc-save">Προσθήκη</button>
    </div>
    <div id="sc-groups"><div class="spinner">Φόρτωση…</div></div>` : "") + `
    <div class="section-title">Λίστα εργασιών</div>
    <div class="card" id="task-todos"><div class="spinner">Φόρτωση…</div></div>`;

  loadTodos();
  if (!canPay) return;

  $("sc-save").onclick = async () => {
    const label = $("sc-label").value.trim();
    const amount = parseFloat($("sc-amount").value);
    const date = $("sc-date").value;
    if (!label || !(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Συμπλήρωσε περιγραφή, ποσό και ημερομηνία"); return; }
    try {
      await addDoc(collection(db, `${base()}/scheduled`), {
        label, amount, date, type: $("sc-type").value,
        category: $("sc-cat").value.trim() || null,
        repeat: $("sc-repeat").value, createdAt: serverTimestamp()
      });
      toast("Προστέθηκε ✓"); renderSched(); refreshDue();
    } catch(e) { console.error(e); toast("Σφάλμα"); }
  };
  loadSched();
}

async function loadSched() {
  try {
    const snap = await getDocs(collection(db, `${base()}/scheduled`));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.date.localeCompare(b.date));
    const today = todayISO();
    const week = fmtD(addDays(parseD(today), 7));
    const groups = [
      ["⚠ Καθυστερημένες", items.filter(s => s.date < today)],
      ["📅 Σήμερα", items.filter(s => s.date === today)],
      ["📆 Επόμενες 7 ημέρες", items.filter(s => s.date > today && s.date <= week)],
      ["🗓 Μελλοντικά", items.filter(s => s.date > week)]
    ];
    $("sc-groups").innerHTML = items.length === 0
      ? `<div class="card" style="margin-top:14px"><div class="empty">Καμία προγραμματισμένη πληρωμή</div></div>`
      : groups.filter(([,list]) => list.length > 0).map(([title, list]) => `
        <div class="section-title">${title} (${list.length})</div>
        <div class="card">${list.map(s => `
          <div class="row">
            <div class="row-main">
              <div class="row-title">${esc(s.label)}</div>
              <div class="row-sub">${fmtShortDate(s.date)}${s.category ? " · " + esc(s.category) : ""}${s.repeat === "monthly" ? " · κάθε μήνα" : ""}</div>
            </div>
            <div class="row-amount ${s.type === "income" ? "pos" : "neg"}">${money(s.amount)}</div>
            <button class="btn-del" data-paid="${s.id}" title="Έγινε">✓</button>
            <button class="btn-del" data-scdel="${s.id}" title="Διαγραφή">✕</button>
          </div>`).join("")}</div>`).join("");

    $("sc-groups").querySelectorAll("[data-paid]").forEach(b => b.onclick = async () => {
      const s = items.find(x => x.id === b.dataset.paid);
      if (!s) return;
      if (!confirm(`Καταχώρηση «${s.label}» (${money(s.amount)}) ως ${s.type === "income" ? "έσοδο" : "έξοδο"} σήμερα;`)) return;
      try {
        const col = s.type === "income" ? "incomes" : "expenses";
        const payload = s.type === "income"
          ? { date: todayISO(), amount: s.amount, category: s.category || "Λοιπά έσοδα", paymentMethod: "cash", bankId: null, note: s.label, source: "scheduled" }
          : { date: todayISO(), amount: s.amount, type: "misc", category: s.category || "Λοιπά", supplierName: null, supplierVat: null, paymentMethod: "cash", bankId: null, note: s.label, source: "scheduled" };
        await addDoc(collection(db, `${base()}/${col}`), { ...payload, createdAt: serverTimestamp() });
        await calMarkPaid(s);
        if (s.repeat === "monthly") {
          const d = parseD(s.date); d.setMonth(d.getMonth() + 1);
          await setDoc(doc(db, `${base()}/scheduled/${s.id}`), { date: fmtD(d) }, { merge: true });
        } else {
          await deleteDoc(doc(db, `${base()}/scheduled/${s.id}`));
        }
        toast("Καταχωρήθηκε ✓");
        loadSched(); refreshDue();
      } catch(e) { console.error(e); toast("Σφάλμα"); }
    });
    $("sc-groups").querySelectorAll("[data-scdel]").forEach(b => b.onclick = async () => {
      if (!confirm("Διαγραφή;")) return;
      try { await deleteDoc(doc(db, `${base()}/scheduled/${b.dataset.scdel}`)); loadSched(); refreshDue(); }
      catch(e) { toast("Σφάλμα διαγραφής"); }
    });
  } catch(e) { console.error(e); $("sc-groups").innerHTML = `<div class="empty">Σφάλμα φόρτωσης</div>`; }
}

/* ============ ΑΝΑΦΟΡΑ ============ */
function shiftAnchor(n) {
  const d = parseD(anchor);
  if (gran === "day") d.setDate(d.getDate() + n);
  else if (gran === "week") d.setDate(d.getDate() + 7*n);
  else if (gran === "month") d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  anchor = fmtD(d);
}
function prevAnchor() {
  const d = parseD(anchor);
  if (gran === "day") d.setDate(d.getDate() - 1);
  else if (gran === "week") d.setDate(d.getDate() - 7);
  else if (gran === "month") d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return fmtD(d);
}

async function renderReport() {
  content().innerHTML = `
    <div class="gran-row" style="margin-top:14px">
      ${[["day","Ημέρα"],["week","Εβδομάδα"],["month","Μήνας"],["year","Έτος"]].map(([g,l]) =>
        `<button class="gran-btn ${gran===g?"active":""}" data-g="${g}">${l}</button>`).join("")}
    </div>
    <div class="period-nav">
      <button class="pn-btn" id="rp-prev">‹</button>
      <div class="label" id="rp-label">…</div>
      <button class="pn-btn" id="rp-next">›</button>
    </div>
    <div class="card" id="rp-pnl"><div class="spinner">Υπολογισμός…</div></div>
    <div id="rp-cats"></div>
    <div class="section-title">Αγορές ανά προμηθευτή</div>
    <div class="card" id="rp-sup"><div class="spinner">Φόρτωση…</div></div>`;

  content().querySelectorAll("[data-g]").forEach(b => b.onclick = () => { gran = b.dataset.g; renderReport(); });
  $("rp-prev").onclick = () => { shiftAnchor(-1); renderReport(); };
  $("rp-next").onclick = () => { shiftAnchor(1); renderReport(); };
  loadReport();
}

async function loadReport() {
  const [from, to, label] = periodRange(gran, anchor);
  const [pFrom, pTo] = periodRange(gran, prevAnchor());
  $("rp-label").textContent = label;
  try {
    const [revSnap, expenses, incomes, pRevSnap, pExpenses, pIncomes] = await Promise.all([
      getDocs(query(collection(db, `${base()}/revenues`), where("date", ">=", from), where("date", "<=", to))),
      fetchRange("expenses", from, to),
      fetchRange("incomes", from, to),
      getDocs(query(collection(db, `${base()}/revenues`), where("date", ">=", pFrom), where("date", "<=", pTo))),
      fetchRange("expenses", pFrom, pTo),
      fetchRange("incomes", pFrom, pTo)
    ]);
    const revenues = {};
    revSnap.forEach(d => { revenues[d.id] = d.data().gross || 0; });

    let recurring = [], limited = (role === "staff");
    if (!limited) {
      try {
        const recSnap = await getDocs(collection(db, `${base()}/recurringCosts`));
        recurring = recSnap.docs.map(d => d.data());
      } catch(e) { limited = true; }
    }

    const pnl = computePnL({ revenues, expenses, recurring }, from, to);
    const incSum = Math.round(incomes.reduce((s,t) => s + (t.amount||0), 0) * 100) / 100;
    const totalRevenue = Math.round((pnl.revenue + incSum) * 100) / 100;
    const profit = Math.round((pnl.profit + incSum) * 100) / 100;

    /* σύγκριση με προηγούμενη περίοδο */
    let pGross = 0; pRevSnap.forEach(d => { pGross += d.data().gross || 0; });
    const pInc = pIncomes.reduce((s,t) => s + (t.amount||0), 0);
    const pExp = pExpenses.reduce((s,t) => s + (t.amount||0), 0);
    const curIn = totalRevenue, curEx = pnl.purchases + pnl.misc;
    const prevIn = pGross + pInc, prevEx = pExp;
    const pct = (cur, prev) => prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);
    const dIn = pct(curIn, prevIn), dEx = pct(curEx, prevEx);

    const days = Math.max(1, Math.round((parseD(to) - parseD(from)) / 86400000) + 1);
    const avgExp = curEx / days;

    const rows = [["Τζίρος", pnl.revenue, "pos"]];
    if (incSum > 0) rows.push(["Λοιπά έσοδα", incSum, "pos"]);
    rows.push(["Αγορές", pnl.purchases, "neg"], ["Λοιπά έξοδα", pnl.misc, "neg"]);
    if (!limited) rows.push(["Πάγια", pnl.fixed, "neg"], ["Μισθοδοσία", pnl.payroll, "neg"]);
    let html = rows.map(([l,v,c]) =>
      `<div class="pnl-row"><span>${l}</span><span class="v" style="color:${c==="pos"?"var(--green)":"var(--red)"}">${c==="neg"?"− ":""}${money(v)}</span></div>`).join("");
    if (!limited) {
      const pc = profit >= 0 ? "var(--green)" : "var(--red)";
      html += `<div class="pnl-row pnl-profit"><span><strong>Αποτέλεσμα</strong></span><span class="v" style="color:${pc}">${money(profit)}</span></div>`;
      const margin = totalRevenue > 0 ? Math.max(0, Math.min(100, (profit / totalRevenue) * 100)) : 0;
      html += `<div class="row-sub" style="margin-top:8px">Περιθώριο: ${totalRevenue > 0 ? margin.toFixed(1) + "%" : "—"}</div><div class="bar"><div style="width:${margin}%"></div></div>`;
    } else {
      html += `<p class="muted" style="margin-top:10px">Ο ρόλος σου δεν έχει πρόσβαση σε πάγια, μισθοδοσία και αποτέλεσμα.</p>`;
    }
    html += `<div class="row-sub" style="margin-top:10px">vs προηγούμενη περίοδο: Έσοδα ${dIn >= 0 ? "+" : ""}${dIn}% · Έξοδα ${dEx >= 0 ? "+" : ""}${dEx}%${gran !== "day" ? ` · Μέσα έξοδα/ημέρα: ${money(avgExp)}` : ""}</div>`;
    $("rp-pnl").innerHTML = html;

    /* ανά κατηγορία */
    const catBars = (list, labelTitle, colorVar) => {
      const map = {};
      list.forEach(t => {
        const key = t._col === "expenses" && t.type === "purchase" ? "Αγορές" : (t.category || "Λοιπά");
        map[key] = (map[key] || 0) + (t.amount||0);
      });
      const entries = Object.entries(map).sort((a,b) => b[1] - a[1]);
      if (entries.length === 0) return "";
      const total = entries.reduce((s,[,v]) => s+v, 0);
      const max = entries[0][1] || 1;
      return `<div class="section-title">${labelTitle}</div><div class="card">` +
        entries.map(([name, v]) => `
          <div style="padding:7px 0">
            <div style="display:flex;justify-content:space-between;font-size:13.5px">
              <span>${esc(name)}</span><span style="font-weight:600">${money(v)} · ${Math.round(v/total*100)}%</span>
            </div>
            <div class="bar" style="margin-top:4px"><div style="width:${Math.round(v/max*100)}%;background:${colorVar}"></div></div>
          </div>`).join("") + `</div>`;
    };
    $("rp-cats").innerHTML =
      catBars(expenses, "Έξοδα ανά κατηγορία", "var(--red)") +
      catBars(incomes, "Λοιπά έσοδα ανά κατηγορία", "var(--green)");

    /* προμηθευτές */
    const map = {}; let supTotal = 0;
    for (const e of expenses) {
      if (e.type !== "purchase") continue;
      const key = e.supplierVat || e.supplierName || "—";
      if (!map[key]) map[key] = { vat: e.supplierVat || null, supplier: e.supplierName || "— Χωρίς προμηθευτή —", total: 0, count: 0 };
      map[key].total += e.amount || 0;
      map[key].count += 1;
      supTotal += e.amount || 0;
    }
    const suppliers = Object.values(map)
      .map(s => ({ ...s, total: Math.round(s.total * 100) / 100, pct: supTotal ? Math.round((s.total / supTotal) * 1000) / 10 : 0 }))
      .sort((a, b) => b.total - a.total);
    $("rp-sup").innerHTML = suppliers.length === 0 ? `<div class="empty">Καμία αγορά στην περίοδο</div>` :
      suppliers.map(s => `
        <div class="row">
          <div class="row-main">
            <div class="row-title">${esc(s.supplier)}</div>
            <div class="row-sub">${s.count} παραστατικά${s.vat ? " · ΑΦΜ " + esc(s.vat) : ""} · ${s.pct}%</div>
          </div>
          <div class="row-amount">${money(s.total)}</div>
        </div>`).join("");
  } catch(e) {
    console.error(e);
    $("rp-pnl").innerHTML = `<div class="empty">Σφάλμα αναφοράς — ${esc(e.message || "")}</div>`;
    $("rp-sup").innerHTML = `<div class="empty">—</div>`;
  }
}

/* ============ ΡΥΘΜΙΣΕΙΣ ============ */
function renderSettings() {
  if (role === "staff") { tab = "dash"; renderTab(); return; }
  content().innerHTML = `
    <div class="section-title">Τράπεζες & Κάρτες</div>
    <div class="card">
      <div id="st-banks"></div>
      <div class="grid-2" style="margin-top:10px">
        <div><input type="text" class="form-input" id="st-bank-name" placeholder="π.χ. Πειραιώς"></div>
        <div><select class="form-select" id="st-bank-kind">
          <option value="bank">Τραπεζικός λογ/σμός</option>
          <option value="card">Κάρτα</option>
        </select></div>
      </div>
      <button class="btn-primary" id="st-bank-add">+ Προσθήκη</button>
    </div>

    <div class="section-title">Κατηγορίες εξόδων</div>
    <div class="card">
      <div id="st-cats-expense"></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input type="text" class="form-input" id="st-cat-exp-name" placeholder="Νέα κατηγορία εξόδων" style="flex:1">
        <button class="btn-primary" id="st-cat-exp-add" style="width:auto;margin-top:0;padding:11px 16px">+</button>
      </div>
    </div>

    <div class="section-title">Κατηγορίες εσόδων</div>
    <div class="card">
      <div id="st-cats-income"></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input type="text" class="form-input" id="st-cat-inc-name" placeholder="Νέα κατηγορία εσόδων" style="flex:1">
        <button class="btn-primary" id="st-cat-inc-add" style="width:auto;margin-top:0;padding:11px 16px">+</button>
      </div>
    </div>

    <div class="section-title">Πάγια & Μισθοδοσία</div>
    <div class="card">
      <label class="form-label">Περιγραφή</label>
      <input type="text" class="form-input" id="rc-label" placeholder="π.χ. Ενοίκιο, Μισθός Γιώργου">
      <div class="grid-2">
        <div><label class="form-label">Ποσό (€)</label>
        <input type="number" class="form-input" id="rc-amount" inputmode="decimal" step="0.01" min="0"></div>
        <div><label class="form-label">Περίοδος</label>
        <select class="form-select" id="rc-period">
          <option value="monthly">Μηνιαίο</option><option value="weekly">Εβδομαδιαίο</option>
          <option value="quarterly">Τριμηνιαίο</option><option value="yearly">Ετήσιο</option>
        </select></div>
      </div>
      <div class="grid-2">
        <div><label class="form-label">Κατηγορία</label>
        <select class="form-select" id="rc-cat">
          <option value="fixed">Πάγιο</option><option value="payroll">Μισθοδοσία</option>
        </select></div>
        <div><label class="form-label">Έναρξη</label>
        <input type="date" class="form-input" id="rc-start" value="${todayISO().slice(0,7)}-01"></div>
      </div>
      <button class="btn-primary" id="rc-save">Προσθήκη</button>
      <div id="rc-list" style="margin-top:14px"><div class="spinner">Φόρτωση…</div></div>
      <p class="muted" style="margin-top:10px">Τα ποσά κατανέμονται αυτόματα ημερησίως στις αναφορές.</p>
    </div>

    <div class="section-title">Ειδοποιήσεις — Google Calendar</div>
    <div class="card">
      <div class="muted" id="st-cal-status"></div>
      <p class="muted" style="margin-top:6px;font-size:12.5px">Οι προγραμματισμένες πληρωμές και οι εργασίες με προθεσμία μπαίνουν στο ημερολόγιό σου (09:00) με υπενθύμιση μία ημέρα πριν και την ίδια ημέρα — το κινητό σε ειδοποιεί κανονικά.</p>
      <div class="grid-2" style="margin-top:10px">
        <div><button class="btn-secondary" id="st-cal-connect">Σύνδεση</button></div>
        <div><button class="btn-secondary" id="st-cal-disconnect" style="color:var(--red)">Αποσύνδεση</button></div>
      </div>
    </div>

    <div class="section-title">Σάρωση αποδείξεων (Gemini)</div>
    <div class="card">
      <div class="muted" id="st-key-status"></div>
      <input type="password" class="form-input" id="st-key-input" placeholder="AIza… (νέο κλειδί)" style="margin-top:8px">
      <div class="grid-2" style="margin-top:8px">
        <div><button class="btn-secondary" id="st-key-save">Αποθήκευση</button></div>
        <div><button class="btn-secondary" id="st-key-del" style="color:var(--red)">Διαγραφή κλειδιού</button></div>
      </div>
    </div>`;

  /* τράπεζες */
  const drawBanks = () => {
    $("st-banks").innerHTML = banks.length === 0 ? `<div class="empty">Καμία τράπεζα/κάρτα</div>` :
      banks.map(b => `
        <div class="row">
          <div class="row-main"><div class="row-title">${b.kind === "card" ? "💳" : "🏦"} ${esc(b.name)}</div>
          <div class="row-sub">${b.kind === "card" ? "Κάρτα" : "Τραπεζικός λογαριασμός"}</div></div>
          <button class="btn-del" data-bank-del="${b.id}">✕</button>
        </div>`).join("");
    $("st-banks").querySelectorAll("[data-bank-del]").forEach(x => x.onclick = async () => {
      if (!confirm("Διαγραφή; (οι παλιές κινήσεις κρατούν το όνομα)")) return;
      await deleteDoc(doc(db, `${base()}/banks/${x.dataset.bankDel}`));
      banks = banks.filter(b => b.id !== x.dataset.bankDel);
      drawBanks();
    });
  };
  drawBanks();
  $("st-bank-add").onclick = async () => {
    const name = $("st-bank-name").value.trim();
    if (!name) { toast("Γράψε όνομα"); return; }
    const kind = $("st-bank-kind").value;
    try {
      const ref = await addDoc(collection(db, `${base()}/banks`), { name, kind });
      banks.push({ id: ref.id, name, kind });
      $("st-bank-name").value = "";
      drawBanks(); toast("Προστέθηκε ✓");
    } catch(e) { toast("Σφάλμα"); }
  };

  /* κατηγορίες */
  const drawCats = (type) => {
    const el = $(type === "expense" ? "st-cats-expense" : "st-cats-income");
    const list = cats.filter(c => c.type === type);
    el.innerHTML = list.length === 0 ? `<div class="empty">Καμία κατηγορία</div>` :
      list.map(c => `
        <div class="row">
          <div class="row-main"><div class="row-title" style="font-size:14px">${esc(c.name)}</div></div>
          <button class="btn-del" data-cat-del="${c.id}">✕</button>
        </div>`).join("");
    el.querySelectorAll("[data-cat-del]").forEach(x => x.onclick = async () => {
      if (!confirm("Διαγραφή κατηγορίας; (οι παλιές κινήσεις την κρατούν)")) return;
      await deleteDoc(doc(db, `${base()}/categories/${x.dataset.catDel}`));
      cats = cats.filter(c => c.id !== x.dataset.catDel);
      drawCats(type);
    });
  };
  drawCats("expense"); drawCats("income");
  const addCat = async (type, inputId) => {
    const name = $(inputId).value.trim();
    if (!name) return;
    try {
      const ref = await addDoc(collection(db, `${base()}/categories`), { name, type });
      cats.push({ id: ref.id, name, type });
      $(inputId).value = "";
      drawCats(type); toast("Προστέθηκε ✓");
    } catch(e) { toast("Σφάλμα"); }
  };
  $("st-cat-exp-add").onclick = () => addCat("expense", "st-cat-exp-name");
  $("st-cat-inc-add").onclick = () => addCat("income", "st-cat-inc-name");

  /* πάγια */
  $("rc-save").onclick = async () => {
    const label = $("rc-label").value.trim();
    const amount = parseFloat($("rc-amount").value);
    if (!label || !(amount > 0)) { toast("Συμπλήρωσε περιγραφή και ποσό"); return; }
    try {
      await addDoc(collection(db, `${base()}/recurringCosts`), {
        label, amount, period: $("rc-period").value, category: $("rc-cat").value,
        startDate: $("rc-start").value || todayISO(), allocationMethod: "calendar",
        createdAt: serverTimestamp()
      });
      toast("Προστέθηκε ✓"); $("rc-label").value = ""; $("rc-amount").value = "";
      loadRecList();
    } catch(e) { console.error(e); toast("Σφάλμα"); }
  };
  loadRecList();

  /* Google Calendar */
  const drawCal = () => {
    const el = $("st-cal-status");
    if (!el) return;
    if (!calAvailable()) el.textContent = "Το Google δεν φόρτωσε — έλεγξε τη σύνδεση στο internet.";
    else if (calEnabled()) el.textContent = "✓ Συνδεδεμένο — οι πληρωμές και οι εργασίες συγχρονίζονται.";
    else el.textContent = "Δεν είναι συνδεδεμένο. Πάτα «Σύνδεση» για ειδοποιήσεις στο κινητό.";
  };
  drawCal();
  $("st-cal-connect").onclick = async () => {
    if (await calConnect()) { drawCal(); refreshDue(); }
  };
  $("st-cal-disconnect").onclick = () => { calDisconnect(); drawCal(); };

  /* κλειδί Gemini */
  const drawKey = () => {
    $("st-key-status").textContent = localStorage.getItem("ee_gemini_key")
      ? "✓ Υπάρχει αποθηκευμένο κλειδί σε αυτή τη συσκευή."
      : "Δεν υπάρχει κλειδί — δωρεάν από aistudio.google.com/apikey.";
  };
  drawKey();
  $("st-key-save").onclick = () => {
    const k = $("st-key-input").value.trim();
    if (!k) { toast("Επικόλλησε το κλειδί"); return; }
    localStorage.setItem("ee_gemini_key", k);
    $("st-key-input").value = "";
    drawKey(); toast("Αποθηκεύτηκε ✓");
  };
  $("st-key-del").onclick = () => { localStorage.removeItem("ee_gemini_key"); drawKey(); toast("Διαγράφηκε"); };
}

async function loadRecList() {
  try {
    const snap = await getDocs(collection(db, `${base()}/recurringCosts`));
    const rows = snap.docs.map(x => ({ id: x.id, ...x.data() }));
    $("rc-list").innerHTML = rows.length === 0 ? `<div class="empty">Κανένα πάγιο ακόμα</div>` :
      rows.map(r => `
        <div class="row">
          <div class="row-main">
            <div class="row-title">${esc(r.label)}</div>
            <div class="row-sub">${PERIODS[r.period] || r.period} · ${r.category === "payroll" ? "Μισθοδοσία" : "Πάγιο"} · από ${new Date(r.startDate).toLocaleDateString("el-GR")}</div>
          </div>
          <div class="row-amount">${money(r.amount)}</div>
          <button class="btn-del" data-del="${r.id}">✕</button>
        </div>`).join("");
    $("rc-list").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm("Διαγραφή; (Θα αφαιρεθεί και από παλιές αναφορές.)")) return;
      try { await deleteDoc(doc(db, `${base()}/recurringCosts/${b.dataset.del}`)); loadRecList(); toast("Διαγράφηκε"); }
      catch(e) { toast("Σφάλμα διαγραφής"); }
    });
  } catch(e) { console.error(e); $("rc-list").innerHTML = `<div class="empty">Σφάλμα φόρτωσης</div>`; }
}
