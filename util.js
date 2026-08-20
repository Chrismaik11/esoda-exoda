/* util.js — κοινές βοηθητικές συναρτήσεις */
export const $ = (id) => document.getElementById(id);
export const pad = (n) => String(n).padStart(2, "0");
export const fmtD = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export const parseD = (s) => { const [y,m,dd] = s.split("-").map(Number); return new Date(y, m-1, dd); };
export const todayISO = () => fmtD(new Date());
export const money = (n) => new Intl.NumberFormat("el-GR",{style:"currency",currency:"EUR"}).format(Math.round((n||0)*100)/100);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const GR_MONTHS = ["Ιανουάριος","Φεβρουάριος","Μάρτιος","Απρίλιος","Μάιος","Ιούνιος","Ιούλιος","Αύγουστος","Σεπτέμβριος","Οκτώβριος","Νοέμβριος","Δεκέμβριος"];
export const ROLES = { owner: "Ιδιοκτήτης", accountant: "Λογιστής", staff: "Προσωπικό" };

let toastT = null;
export function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}
export function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
}
export function authMsg(code) {
  const m = {
    "auth/invalid-email": "Μη έγκυρο email.",
    "auth/user-not-found": "Δεν βρέθηκε λογαριασμός με αυτό το email.",
    "auth/wrong-password": "Λάθος κωδικός.",
    "auth/invalid-credential": "Λάθος email ή κωδικός.",
    "auth/email-already-in-use": "Υπάρχει ήδη λογαριασμός με αυτό το email.",
    "auth/weak-password": "Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.",
    "auth/too-many-requests": "Πολλές προσπάθειες — δοκίμασε ξανά σε λίγο.",
    "auth/network-request-failed": "Πρόβλημα σύνδεσης στο internet."
  };
  return m[code] || "Κάτι πήγε στραβά (" + code + ").";
}
export function showErr(id, msg) { const el = $(id); el.textContent = msg; el.style.display = msg ? "block" : "none"; }

export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const daysInYear = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
export const daysInQuarter = (y, m) => { const q = Math.floor(m / 3) * 3; return daysInMonth(y, q) + daysInMonth(y, q + 1) + daysInMonth(y, q + 2); };
