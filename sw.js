/* Service worker — Έσοδα–Έξοδα
   Στρατηγική: network-first με cache fallback (πάντα φρέσκο online, δουλεύει offline). */
const CACHE = "ee-v4";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./util.js",
  "./engine.js", "./voice.js", "./calendar.js", "./config.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  /* Μόνο same-origin GET — τα αιτήματα προς Firebase/Gemini δεν τα αγγίζουμε. */
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() =>
      caches.match(e.request).then((m) => m || caches.match("./index.html"))
    )
  );
});
