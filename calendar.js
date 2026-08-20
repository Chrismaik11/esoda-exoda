/* calendar.js — συγχρονισμός πληρωμών & εργασιών με Google Calendar
   Χρησιμοποιεί Google Identity Services (token client) + Calendar REST API.
   Δεν χρειάζεται gapi — μόνο fetch με access token.

   ΣΗΜΕΙΩΣΗ: το Client ID είναι το ίδιο που χρησιμοποιεί και το oikonomika,
   εγγεγραμμένο για origin https://chrismaik11.github.io — άρα δουλεύει
   αυτούσιο για την εφαρμογή σε chrismaik11.github.io/esoda-exoda. */

import { toast } from "./util.js";

const CLIENT_ID = "383530832987-7qc2u32rmpu9585fao6dg6hbjp1j0t9u.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TZ = "Europe/Athens";

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;
let bizKey = "";           // ξεχωριστό index ανά επιχείρηση

const idxKey = () => `ee_gcal_idx_${bizKey}`;
const onKey = () => `ee_gcal_on_${bizKey}`;

export function calSetBusiness(bizId) { bizKey = bizId || ""; }
export function calEnabled() { return localStorage.getItem(onKey()) === "1"; }
export function calAvailable() {
  return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
}

function loadIndex() {
  try { return JSON.parse(localStorage.getItem(idxKey()) || "{}"); } catch(e) { return {}; }
}
function saveIndex(idx) {
  try { localStorage.setItem(idxKey(), JSON.stringify(idx)); } catch(e) {}
}

/* Έγκυρο event id για Google Calendar: μόνο [a-v0-9], μήκος ≥5.
   Το hex των χαρακτήρων καλύπτει και κεφαλαία/ελληνικά ids. */
function eventId(key) {
  let hex = "";
  for (let i = 0; i < key.length; i++) hex += key.charCodeAt(i).toString(16).padStart(2, "0");
  return "ee" + hex;
}

function ensureTokenClient() {
  if (tokenClient || !calAvailable()) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {}          // ορίζεται ανά κλήση
  });
  return tokenClient;
}

/* Ζητά access token. interactive=false → σιωπηλά (αν έχει ήδη δοθεί άδεια). */
function getToken({ interactive }) {
  return new Promise((resolve, reject) => {
    if (accessToken && Date.now() < tokenExpiry - 60000) { resolve(accessToken); return; }
    const tc = ensureTokenClient();
    if (!tc) { reject(new Error("no-gis")); return; }
    tc.callback = (resp) => {
      if (resp && resp.access_token) {
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) * 1000);
        resolve(accessToken);
      } else {
        reject(new Error(resp && resp.error ? resp.error : "no-token"));
      }
    };
    try { tc.requestAccessToken({ prompt: interactive ? "consent" : "" }); }
    catch(e) { reject(e); }
  });
}

/* Σύνδεση από τις Ρυθμίσεις */
export async function calConnect() {
  if (!calAvailable()) { toast("Δεν φόρτωσε το Google — έλεγξε τη σύνδεση"); return false; }
  try {
    await getToken({ interactive: true });
    localStorage.setItem(onKey(), "1");
    toast("Συνδέθηκε με Google Calendar ✓");
    return true;
  } catch(e) {
    if (String(e.message) !== "popup_closed") toast("Η σύνδεση ακυρώθηκε");
    return false;
  }
}

export function calDisconnect() {
  localStorage.removeItem(onKey());
  if (accessToken && calAvailable()) {
    try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch(e) {}
  }
  accessToken = null; tokenExpiry = 0;
  toast("Αποσυνδέθηκε από Google Calendar");
}

/* ---- κατασκευή γεγονότων ---- */
function timed(dateISO) {
  return {
    start: { dateTime: `${dateISO}T09:00:00`, timeZone: TZ },
    end:   { dateTime: `${dateISO}T09:30:00`, timeZone: TZ }
  };
}
/* Υπενθύμιση: μία μέρα πριν στις 09:00 και την ίδια ώρα του γεγονότος */
const REMINDERS = { useDefault: false, overrides: [
  { method: "popup", minutes: 24 * 60 },
  { method: "popup", minutes: 0 }
] };

function money(n) {
  return new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" })
    .format(Math.round((n || 0) * 100) / 100);
}

function paymentEvent(s) {
  const inc = s.type === "income";
  return {
    summary: `${inc ? "💰" : "💸"} ${s.label} ${inc ? "+" : "−"}${money(s.amount)}`,
    description: [
      `${inc ? "Είσπραξη" : "Πληρωμή"}: ${money(s.amount)}`,
      s.category ? `Κατηγορία: ${s.category}` : "",
      s.repeat === "monthly" ? "Επαναλαμβάνεται κάθε μήνα" : "",
      "\n— Έσοδα–Έξοδα"
    ].filter(Boolean).join("\n"),
    ...timed(s.date),
    reminders: REMINDERS
  };
}

function todoEvent(t) {
  return {
    summary: `${t.done ? "✅" : "⬜"} ${t.text}`,
    description: "— Έσοδα–Έξοδα · εργασία",
    ...timed(t.date),
    reminders: t.done ? { useDefault: false, overrides: [] } : REMINDERS
  };
}

/* ---- συγχρονισμός ---- */
let busy = false, again = false;

/* scheduled: [{id, label, amount, date, type, category, repeat}]
   todos:     [{id, text, date, done}] (μόνο όσα έχουν date) */
export async function calSync(scheduled, todos) {
  if (!calEnabled() || !calAvailable()) return;
  if (busy) { again = true; return; }
  busy = true;
  try { await run(scheduled, todos); }
  catch(e) { console.error("Calendar sync:", e); }
  finally {
    busy = false;
    if (again) { again = false; setTimeout(() => calSync(scheduled, todos), 400); }
  }
}

async function run(scheduled, todos) {
  let token;
  try { token = await getToken({ interactive: false }); }
  catch(e) { return; }                     // χωρίς σιωπηλό token — δεν ενοχλούμε τον χρήστη
  const headers = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };

  const desired = {};
  (scheduled || []).forEach(s => { if (s.date) desired["pay_" + s.id] = paymentEvent(s); });
  (todos || []).forEach(t => { if (t.date) desired["todo_" + t.id] = todoEvent(t); });

  const index = loadIndex();
  let apiDisabled = false;

  for (const key of Object.keys(desired)) {
    const eid = eventId(key);
    const body = desired[key];
    try {
      const get = await fetch(`${API}/${eid}`, { headers });
      if (get.ok) {
        await fetch(`${API}/${eid}`, { method: "PATCH", headers, body: JSON.stringify(body) });
      } else {
        const ins = await fetch(API, { method: "POST", headers, body: JSON.stringify({ ...body, id: eid }) });
        if (!ins.ok) {
          const err = await ins.json().catch(() => ({}));
          const msg = err?.error?.message || "";
          if (/has not been used|disabled|API/i.test(msg)) { apiDisabled = true; break; }
          /* 409 duplicate → κάνε patch */
          await fetch(`${API}/${eid}`, { method: "PATCH", headers, body: JSON.stringify(body) });
        }
      }
      index[key] = eid;
    } catch(e) { console.error("cal item", key, e); }
  }

  /* ό,τι έφυγε από την εφαρμογή, φεύγει και από το ημερολόγιο */
  if (!apiDisabled) {
    for (const key of Object.keys(index)) {
      if (!desired[key]) {
        try { await fetch(`${API}/${index[key]}`, { method: "DELETE", headers }); } catch(e) {}
        delete index[key];
      }
    }
  }
  saveIndex(index);
  if (apiDisabled) toast("Ενεργοποίησε το Google Calendar API στο Cloud Console");
}

/* Όταν μια πληρωμή εξοφλείται: κρατάμε το γεγονός στο ημερολόγιο ως ιστορικό
   (το βγάζουμε από το index ώστε να μην σβηστεί) και το σημειώνουμε. */
export async function calMarkPaid(sched) {
  if (!calEnabled() || !calAvailable()) return;
  const key = "pay_" + sched.id;
  const index = loadIndex();
  const eid = index[key];
  if (!eid) return;
  delete index[key];
  saveIndex(index);
  try {
    const token = await getToken({ interactive: false });
    await fetch(`${API}/${eid}`, {
      method: "PATCH",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: `✅ ${sched.label} — εξοφλήθηκε`,
        reminders: { useDefault: false, overrides: [] }
      })
    });
  } catch(e) {}
}
