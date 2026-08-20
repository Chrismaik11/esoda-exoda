/* voice.js — φωνητική καταχώρηση + σάρωση αποδείξεων (Gemini) */
import { $, fmtD, todayISO, money, esc, toast, addDays } from "./util.js";

/* ================= ΦΩΝΗΤΙΚΗ ΚΑΤΑΧΩΡΗΣΗ ================= */
export function voiceSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

/* Κανονικοποίηση ελληνικών: πεζά, χωρίς τόνους, τελικό ς → σ */
function _vNorm(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ς/g, "σ");
}

const _GR_UNITS = {"μηδεν":0,"ενα":1,"εναν":1,"ενοσ":1,"μια":1,"μιαν":1,"δυο":2,"τρια":3,"τρεισ":3,"τεσσερα":4,"τεσσερισ":4,"πεντε":5,"εξι":6,"εφτα":7,"επτα":7,"οκτω":8,"οχτω":8,"εννεα":9,"εννια":9,"δεκα":10,"εντεκα":11,"ενδεκα":11,"δωδεκα":12,"δεκατρια":13,"δεκατρεισ":13,"δεκατεσσερα":14,"δεκατεσσερισ":14,"δεκαπεντε":15,"δεκαεξι":16,"δεκαεφτα":17,"δεκαεπτα":17,"δεκαοκτω":18,"δεκαοχτω":18,"δεκαεννεα":19,"δεκαεννια":19};
const _GR_TENS = {"εικοσι":20,"τριαντα":30,"σαραντα":40,"πενηντα":50,"εξηντα":60,"εβδομηντα":70,"ογδοντα":80,"ενενηντα":90};
const _GR_HUNDREDS = {"εκατο":100,"εκατον":100,"διακοσια":200,"διακοσιεσ":200,"τριακοσια":300,"τριακοσιεσ":300,"τετρακοσια":400,"τετρακοσιεσ":400,"πεντακοσια":500,"πεντακοσιεσ":500,"εξακοσια":600,"εξακοσιεσ":600,"εφτακοσια":700,"επτακοσια":700,"εφτακοσιεσ":700,"επτακοσιεσ":700,"οκτακοσια":800,"οχτακοσια":800,"οκτακοσιεσ":800,"εννιακοσια":900,"εννιακοσιεσ":900};
const _GR_MONTHS_GEN = {"ιανουαριου":1,"φεβρουαριου":2,"μαρτιου":3,"απριλιου":4,"μαιου":5,"ιουνιου":6,"ιουλιου":7,"αυγουστου":8,"σεπτεμβριου":9,"οκτωβριου":10,"νοεμβριου":11,"δεκεμβριου":12};

/* Λέξεις που δηλώνουν αγορά από προμηθευτή (τύπος purchase) */
const _V_PURCHASE_WORDS = ["αγορα","αγορασα","αγορεσ","προμηθευτησ","προμηθευτη","τιμολογιο","εμπορευμα","εμπορευματα","παραγγελια"];
/* Λέξεις που δηλώνουν έσοδο */
const _V_INCOME_WORDS = ["εσοδο","εσοδα","εισπραξη","εισπραξεισ","εισεπραξα","πληρωθηκα","ελαβα","πωλησα","πωληση","εισοδημα","αμοιβη"];
/* Συνώνυμα → κατηγορία λοιπών εξόδων */
const _V_CAT_SYNONYMS = {
  "ρευμα":"ΔΕΚΟ","δεη":"ΔΕΚΟ","νερο":"ΔΕΚΟ","ευδαπ":"ΔΕΚΟ","δεκο":"ΔΕΚΟ","τηλεφωνο":"ΔΕΚΟ","ιντερνετ":"ΔΕΚΟ","κινητο":"ΔΕΚΟ","κοινοχρηστα":"ΔΕΚΟ",
  "βενζινη":"Καύσιμα","βενζινα":"Καύσιμα","πετρελαιο":"Καύσιμα","ντιζελ":"Καύσιμα","καυσιμα":"Καύσιμα","βενζιναδικο":"Καύσιμα",
  "ενοικιο":"Ενοίκιο","νοικι":"Ενοίκιο","ενοικια":"Ενοίκιο",
  "φοροσ":"Φόροι","φορουσ":"Φόροι","φοροι":"Φόροι","εφορια":"Φόροι","φπα":"Φόροι",
  "επισκευη":"Συντήρηση","επισκευεσ":"Συντήρηση","σερβισ":"Συντήρηση","συντηρηση":"Συντήρηση",
  "διοδια":"Μεταφορικά","ταξι":"Μεταφορικά","κουριερ":"Μεταφορικά","μεταφορικα":"Μεταφορικά",
  "καθαριστικα":"Καθαριστικά","απορρυπαντικα":"Καθαριστικά",
  "λογαριασμοσ":"Λογαριασμοί","λογαριασμο":"Λογαριασμοί","λογαριασμοι":"Λογαριασμοί"
};
const _V_STOPWORDS = ["και","με","σε","στο","στη","στην","στον","στα","για","απο","το","τα","τη","την","τον","του","τησ","των","ο","η","οι","ευρω","ευρο","λεπτα","λεπτο","ειναι","ηταν","βαλε","καταχωρησε","καταχωρισε","προσθεσε","γραψε","κανε","εκανα","εχω","περασε","πληρωμη","πληρωσα","εδωσα","εξοδο","εξοδα","δαπανη","ψωνια"];

/* Διαβάζει αριθμό (ψηφία ή ελληνικές λέξεις) από θέση i → {value, consumed} ή null */
function _vNumAt(toks, i) {
  if (!toks[i] || toks[i].used) return null;
  const digits = toks[i].tok.replace(/,/g, ".").replace(/[^\d.]/g, "");
  if (/^\d+(\.\d+)?$/.test(digits) && digits !== ".") return { value: parseFloat(digits), consumed: 1 };
  let total = 0, cur = 0, j = i, matched = false;
  while (j < toks.length && !toks[j].used) {
    const w = toks[j].tok;
    if (_GR_HUNDREDS[w] != null) cur += _GR_HUNDREDS[w];
    else if (_GR_TENS[w] != null) cur += _GR_TENS[w];
    else if (_GR_UNITS[w] != null) cur += _GR_UNITS[w];
    else if (w === "χιλια" || w === "χιλιεσ" || w === "χιλιαδεσ") { total += (cur || 1) * 1000; cur = 0; }
    else break;
    matched = true; j++;
  }
  if (!matched) return null;
  return { value: total + cur, consumed: j - i };
}
function _vMarkUsed(toks, i, n) { for (let k = i; k < i + n && k < toks.length; k++) toks[k].used = true; }

function _vTokenize(raw) {
  const words = raw.trim().replace(/€/g, " ευρώ ").replace(/[.;!?·]/g, " ").split(/\s+/).filter(Boolean);
  return words.map(orig => ({ orig, tok: _vNorm(orig).replace(/[^a-zα-ω0-9,.]/g, ""), used: false }));
}

/* Ημερομηνία: σήμερα/χθες/προχθές/«στις 15»/«15 Ιουλίου» → YYYY-MM-DD */
function _vExtractDate(toks) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let date = fmtD(today);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used) continue;
    const w = toks[i].tok;
    if (w === "σημερα") { toks[i].used = true; break; }
    if (w === "χθεσ" || w === "εχθεσ" || w === "χτεσ") { date = fmtD(addDays(today, -1)); toks[i].used = true; break; }
    if (w === "προχθεσ" || w === "προχτεσ") { date = fmtD(addDays(today, -2)); toks[i].used = true; break; }
    const n = _vNumAt(toks, i);
    if (n && n.value >= 1 && n.value <= 31 && Number.isInteger(n.value)) {
      const after = toks[i + n.consumed];
      const before = i > 0 ? toks[i - 1].tok : "";
      if (after && _GR_MONTHS_GEN[after.tok] != null) {
        const m = _GR_MONTHS_GEN[after.tok];
        let d = new Date(today.getFullYear(), m - 1, n.value);
        if (d > today) d = new Date(today.getFullYear() - 1, m - 1, n.value);
        date = fmtD(d); _vMarkUsed(toks, i, n.consumed + 1); break;
      }
      if (before === "στισ") {
        let d = new Date(today.getFullYear(), today.getMonth(), n.value);
        if (d > today) d = new Date(today.getFullYear(), today.getMonth() - 1, n.value);
        date = fmtD(d); toks[i - 1].used = true; _vMarkUsed(toks, i, n.consumed); break;
      }
    }
  }
  return date;
}

/* Ποσό σε ευρώ: «5,50» / «πέντε ευρώ και πενήντα λεπτά» / «πέντε κόμμα πέντε» */
function _vExtractAmount(toks) {
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used) continue;
    const n = _vNumAt(toks, i);
    if (!n) continue;
    let amount = n.value;
    let end = i + n.consumed;
    _vMarkUsed(toks, i, n.consumed);
    if (toks[end] && !toks[end].used && (toks[end].tok === "ευρω" || toks[end].tok === "ευρο")) { toks[end].used = true; end++; }
    if (toks[end] && !toks[end].used && (toks[end].tok === "και" || toks[end].tok === "κομμα")) {
      const n2 = _vNumAt(toks, end + 1);
      if (n2 && n2.value <= 99) {
        amount = toks[end].tok === "κομμα" ? parseFloat(String(n.value) + "." + String(n2.value)) : n.value + n2.value / 100;
        toks[end].used = true;
        _vMarkUsed(toks, end + 1, n2.consumed);
        const after = end + 1 + n2.consumed;
        if (toks[after] && (toks[after].tok === "λεπτα" || toks[after].tok === "λεπτο" || toks[after].tok === "ευρω")) toks[after].used = true;
      }
    }
    return amount;
  }
  return null;
}

/* ---- Ταμείο: «τζίρος 850 ευρώ και 45 κουβέρ» ---- */
export function parseVoiceRevenue(raw) {
  const toks = _vTokenize(raw);
  const res = { gross: null, covers: null, date: null };
  res.date = _vExtractDate(toks);
  /* κουβέρ: αριθμός δίπλα στη λέξη «κουβέρ»/«άτομα» */
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used) continue;
    const w = toks[i].tok;
    if (w === "κουβερ" || w === "ατομα" || w === "πελατεσ") {
      let n = null, at = -1;
      /* κοίτα πρώτα πριν, μετά μετά τη λέξη */
      for (let j = i - 1; j >= 0; j--) { if (!toks[j].used) { const t = _vNumAt(toks, j); if (t && j + t.consumed === i) { n = t; at = j; } break; } }
      if (!n) { const t = _vNumAt(toks, i + 1); if (t) { n = t; at = i + 1; } }
      if (n && Number.isInteger(n.value)) { res.covers = n.value; _vMarkUsed(toks, at, n.consumed); toks[i].used = true; }
      else toks[i].used = true;
      break;
    }
  }
  ["τζιροσ","τζιρο","ταμειο","εισπραξεισ","εισπραξη"].forEach(k => toks.forEach(t => { if (!t.used && t.tok === k) t.used = true; }));
  res.gross = _vExtractAmount(toks);
  return res;
}
export function applyVoiceRevenue(res, transcript) {
  if (res.date) $("rv-date").value = res.date;
  if (res.gross != null && res.gross >= 0) $("rv-gross").value = String(Math.round(res.gross * 100) / 100);
  if (res.covers != null) $("rv-covers").value = String(res.covers);
  const parts = [];
  if (res.gross != null) parts.push("Τζίρος: " + money(res.gross)); else parts.push("⚠️ Δεν κατάλαβα το ποσό — συμπλήρωσέ το");
  if (res.covers != null) parts.push(res.covers + " κουβέρ");
  if (res.date !== todayISO()) parts.push("Ημ/νία: " + new Date(res.date).toLocaleDateString("el-GR"));
  _voiceBanner("rv-voice-info", transcript, parts);
  if (navigator.vibrate) { try { navigator.vibrate(30); } catch(e) {} }
}

/* ---- Fuzzy αντιστοίχιση ονόματος (κατηγορία / τράπεζα) στα tokens ---- */
function _vTokScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return a.length + 2;
  if (a.length >= 4 && b.length >= 4) {
    const n = Math.min(a.length, b.length, 5);
    if (a.slice(0, n) === b.slice(0, n)) return n;
  }
  return 0;
}

/* items: [{name, ...}] → επιστρέφει το item με το καλύτερο σκορ (ή null)
   και μαρκάρει used τα tokens που ταίριαξαν. */
function _vMatchName(toks, items, useSynonyms) {
  let best = null, bestScore = 0;
  items.forEach(it => {
    const nameToks = _vNorm(it.name).split(/[^a-zα-ω0-9]+/).filter(w => w.length >= 3);
    let score = 0;
    toks.forEach(t => {
      if (t.used || !t.tok || t.tok.length < 3) return;
      const cands = [t.tok];
      if (useSynonyms && _V_CAT_SYNONYMS[t.tok]) cands.push(_vNorm(_V_CAT_SYNONYMS[t.tok]));
      let tBest = 0;
      nameToks.forEach(nt => cands.forEach(c => { tBest = Math.max(tBest, _vTokScore(c, nt)); }));
      score += tBest;
    });
    if (score > bestScore) { bestScore = score; best = it; }
  });
  if (!best || bestScore < 4) return null;
  const nameToks = _vNorm(best.name).split(/[^a-zα-ω0-9]+/).filter(w => w.length >= 3);
  toks.forEach(t => {
    if (t.used || !t.tok || t.tok.length < 3) return;
    const cands = [t.tok];
    if (useSynonyms && _V_CAT_SYNONYMS[t.tok]) cands.push(_vNorm(_V_CAT_SYNONYMS[t.tok]));
    if (nameToks.some(nt => cands.some(c => _vTokScore(c, nt) > 0))) t.used = true;
  });
  return best;
}

/* ---- Κίνηση (έσοδο/έξοδο): «40 ευρώ ΔΕΗ χθες με κάρτα Πειραιώς»,
        «αγορά 320 ευρώ Μύλοι Αχαΐας», «είσπραξη 150 ευρώ από πελάτη» ----
   ctx = { cats: [{name, type}], banks: [{id, name, kind}] } */
export function parseVoiceTx(raw, ctx) {
  ctx = ctx || {};
  const cats = ctx.cats || [], banksList = ctx.banks || [];
  const toks = _vTokenize(raw);
  const res = { type: "expense", purchase: false, amount: null, date: null,
                category: null, supplier: null, method: null, bankId: null, note: "" };
  res.date = _vExtractDate(toks);
  res.amount = _vExtractAmount(toks);

  /* τύπος */
  let typeExplicit = false;
  toks.forEach(t => {
    if (t.used) return;
    if (_V_INCOME_WORDS.includes(t.tok)) { res.type = "income"; typeExplicit = true; t.used = true; }
    else if (_V_PURCHASE_WORDS.includes(t.tok)) { res.type = "expense"; res.purchase = true; typeExplicit = true; t.used = true; }
  });

  /* τρόπος πληρωμής */
  toks.forEach(t => {
    if (t.used) return;
    const w = t.tok;
    if (w === "μετρητα" || w === "μετρητοισ" || w === "cash") { res.method = "cash"; t.used = true; }
    else if (w === "καρτα" || w === "pos" || w === "ποσ" || w === "χρεωστικη" || w === "πιστωτικη") { res.method = "card"; t.used = true; }
    else if (w === "τραπεζα" || w === "καταθεση" || w === "εμβασμα" || w === "μεταφορα") { res.method = "bank"; t.used = true; }
    else if (w === "ιρισ" || w === "iris") { res.method = "iris"; t.used = true; }
  });

  /* τράπεζα/κάρτα με όνομα */
  if (banksList.length > 0) {
    let pool = banksList;
    if (res.method === "card") pool = banksList.filter(b => b.kind === "card");
    else if (res.method === "bank" || res.method === "iris") pool = banksList.filter(b => b.kind !== "card");
    let bank = _vMatchName(toks, pool, false);
    if (!bank && !res.method) bank = _vMatchName(toks, banksList, false);
    if (bank) {
      res.bankId = bank.id;
      if (!res.method) res.method = bank.kind === "card" ? "card" : "bank";
    }
  }

  /* κατηγορία: πρώτα του τύπου, μετά (αν όχι ρητός τύπος) του άλλου */
  if (!res.purchase) {
    let cat = _vMatchName(toks, cats.filter(c => c.type === res.type), true);
    if (!cat && !typeExplicit) {
      const other = res.type === "expense" ? "income" : "expense";
      cat = _vMatchName(toks, cats.filter(c => c.type === other), true);
      if (cat) res.type = other;
    }
    if (cat) res.category = cat.name;
    else {
      for (const t of toks) {
        if (t.used) continue;
        const c = _V_CAT_SYNONYMS[t.tok];
        if (c) { res.category = c; t.used = true; break; }
      }
    }
  }

  /* ό,τι απέμεινε */
  const rest = toks.filter(t => !t.used && t.tok && !_V_STOPWORDS.includes(t.tok))
    .map(t => t.orig.replace(/[,.]$/, "")).join(" ").trim();
  if (res.purchase) res.supplier = rest || null;
  else if (!res.category && rest && res.type === "expense") res.category = rest;
  else res.note = rest;
  return res;
}

function _voiceBanner(elId, transcript, parts) {
  const el = $(elId);
  if (!el) return;
  el.innerHTML = `<div class="voice-summary"><b>Άκουσα: «${esc(transcript)}»</b>${parts.map(esc).join(" · ")}<br><span style="opacity:.8">Έλεγξε τα στοιχεία και πάτα Καταχώρηση.</span></div>`;
}

/* ---- overlay μικροφώνου (κοινό) ---- */
let _voiceRec = null, _voiceCancelled = false;
function _voiceCloseOverlay() { const el = $("voice-overlay"); if (el) el.remove(); }
function _voiceCancel() { _voiceCancelled = true; if (_voiceRec) { try { _voiceRec.abort(); } catch(e) {} } _voiceCloseOverlay(); }

export function startVoice({ hints, onText }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Ο browser δεν υποστηρίζει φωνητική αναγνώριση"); return; }
  _voiceCloseOverlay();
  _voiceCancelled = false;
  const overlay = document.createElement("div");
  overlay.className = "voice-overlay";
  overlay.id = "voice-overlay";
  overlay.innerHTML = `
    <div class="voice-panel">
      <div class="voice-mic-circle listening">🎤</div>
      <div class="voice-status">Σε ακούω…</div>
      <div class="voice-transcript" id="voice-transcript"></div>
      <div class="voice-hint">${hints}</div>
      <button class="voice-cancel" id="voice-cancel-btn" type="button">Ακύρωση</button>
    </div>`;
  document.body.appendChild(overlay);
  $("voice-cancel-btn").onclick = _voiceCancel;
  overlay.onclick = e => { if (e.target === overlay) _voiceCancel(); };

  const rec = new SR();
  _voiceRec = rec;
  rec.lang = "el-GR";
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;

  let finalText = "";
  rec.onresult = e => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
      else interim += e.results[i][0].transcript;
    }
    const el = $("voice-transcript");
    if (el) el.textContent = (finalText + interim).trim();
  };
  rec.onerror = e => {
    _voiceRec = null; _voiceCloseOverlay();
    if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Δώσε άδεια χρήσης μικροφώνου στον browser");
    else if (e.error === "no-speech") toast("Δεν άκουσα κάτι — δοκίμασε ξανά");
    else if (e.error === "network") toast("Η αναγνώριση φωνής χρειάζεται internet");
    else if (e.error !== "aborted") toast("Σφάλμα μικροφώνου (" + e.error + ")");
  };
  rec.onend = () => {
    _voiceRec = null; _voiceCloseOverlay();
    if (_voiceCancelled) return;
    const text = finalText.trim();
    if (text) onText(text);
  };
  try { rec.start(); } catch(err) { _voiceRec = null; _voiceCloseOverlay(); toast("Δεν ήταν δυνατή η εκκίνηση του μικροφώνου"); }
}

/* ================= ΣΑΡΩΣΗ ΑΠΟΔΕΙΞΗΣ (Gemini) ================= */
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

function _showScanOverlay(msg) {
  _voiceCloseOverlay();
  const overlay = document.createElement("div");
  overlay.className = "voice-overlay";
  overlay.id = "voice-overlay";
  overlay.innerHTML = `
    <div class="voice-panel">
      <div class="voice-mic-circle working">📷</div>
      <div class="voice-status" id="scan-status">${esc(msg)}</div>
      <div class="voice-hint">Η ανάλυση γίνεται με Google Gemini — συνήθως 3–8 δευτερόλεπτα.</div>
      <button class="voice-cancel" id="voice-cancel-btn" type="button">Ακύρωση</button>
    </div>`;
  document.body.appendChild(overlay);
  $("voice-cancel-btn").onclick = _voiceCloseOverlay;
}

/* Σμίκρυνση εικόνας ώστε το αίτημα να είναι μικρό και γρήγορο */
function shrinkImage(file, maxDim = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxDim) { const k = maxDim / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Δεν ήταν δυνατή η ανάγνωση της εικόνας")); };
    img.src = url;
  });
}

async function geminiExtract(base64) {
  const key = localStorage.getItem("ee_gemini_key");
  const prompt = `Διάβασε αυτή την ελληνική απόδειξη/τιμολόγιο (μπορεί να είναι και χειρόγραφη) και απάντησε ΜΟΝΟ με JSON, χωρίς markdown:
{"amount": <τελικό πληρωτέο ποσό, αριθμός>, "date": "<YYYY-MM-DD ή null>", "supplier": "<επωνυμία εκδότη ή null>", "supplierVat": "<ΑΦΜ εκδότη, 9 ψηφία, ή null>", "isPurchase": <true αν είναι τιμολόγιο προμηθευτή για εμπορεύματα/πρώτες ύλες, false για λοιπά έξοδα π.χ. λογαριασμοί/καύσιμα/σούπερ μάρκετ>, "category": "<σύντομη κατηγορία στα ελληνικά π.χ. ΔΕΚΟ, Καύσιμα, Συντήρηση, ή null>", "confidence": <0 έως 1>}`;
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: base64 } }] }],
    generationConfig: { temperature: 0, response_mime_type: "application/json" }
  };
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      if (r.status === 400 || r.status === 403) throw Object.assign(new Error("badkey"), { fatal: true });
      if (!r.ok) { lastErr = new Error("HTTP " + r.status); continue; }
      const j = await r.json();
      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) { lastErr = new Error("Κενή απάντηση"); continue; }
      return JSON.parse(m[0]);
    } catch(e) {
      if (e.fatal) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error("Αποτυχία ανάλυσης");
}

export async function handleReceiptFile(file, { onData, onBadKey } = {}) {
  _showScanOverlay("Ανάλυση απόδειξης…");
  try {
    const base64 = await shrinkImage(file);
    const data = await geminiExtract(base64);
    _voiceCloseOverlay();
    if (!data || typeof data !== "object") { toast("Δεν αναγνωρίστηκαν στοιχεία"); return; }
    if (onData) onData(data);
  } catch(e) {
    _voiceCloseOverlay();
    if (e.message === "badkey") {
      localStorage.removeItem("ee_gemini_key");
      toast("Το κλειδί Gemini δεν έγινε δεκτό — βάλε το ξανά");
      if (onBadKey) onBadKey();
    } else {
      toast("Η σάρωση απέτυχε: " + (e.message || "άγνωστο σφάλμα"));
    }
  }
}

/* Κοινό banner σύνοψης (φωνητική & σάρωση) — το γεμίζει το app.js */
export function voiceBanner(elId, title, parts) {
  const el = $(elId);
  if (!el) return;
  el.innerHTML = `<div class="voice-summary"><b>${esc(title)}</b>${parts.map(esc).join(" · ")}<br><span style="opacity:.8">Έλεγξε τα στοιχεία και πάτα Καταχώρηση.</span></div>`;
}
