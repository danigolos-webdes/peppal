// Pep Pal push client. Loaded as a plain script; exposes window.PepPalPush.
// Set window.PEPPAL_BACKEND before this file loads to point at server.js.
// With no backend set, the app falls back to local notifications while open.
(function () {
  var BACKEND = (typeof window !== "undefined" && window.PEPPAL_BACKEND) || "";
  var TOKEN_KEY = "peppal.sessionToken";

  function b64ToBytes(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([].map.call(raw, function (c) { return c.charCodeAt(0); }));
  }

  // Showing a reminder needs only Notification. PushManager is needed for
  // server-sent ones, so it must not gate the no-backend case.
  function supported() { return "Notification" in window; }
  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && supported();
  }
  function isIos() {
    try {
      var ua = navigator.userAgent || "";
      return /iphone|ipad|ipod/i.test(ua) ||
        (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    } catch (e) { return false; }
  }

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }

  // One anonymous pass per device, kept so we don't create accounts endlessly.
  async function session() {
    var t = token();
    if (t) return t;
    var res = await fetch(BACKEND + "/api/push/device", { method: "POST" }).then(function (r) { return r.json(); });
    if (!res || !res.sessionToken) throw new Error("no session");
    localStorage.setItem(TOKEN_KEY, res.sessionToken);
    return res.sessionToken;
  }

  function authHeaders(t) {
    return { "Content-Type": "application/json", Authorization: "Bearer " + t };
  }

  async function register() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      // Relative, not "/sw.js": the app is served from a subpath
      // (github.io/<repo>/), where an absolute path 404s and push dies silently.
      var reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      await navigator.serviceWorker.ready;
      return reg;
    } catch (e) { return null; }
  }

  // Ask permission, subscribe, hand the subscription to the backend.
  // Resolves { ok, reason } — reason is "unsupported" | "denied" | "no-backend" | "error".
  async function enable() {
    if (!supported()) return { ok: false, reason: "unsupported" };
    // iOS only exposes notifications to a PWA on the home screen.
    if (isIos() && !installed()) return { ok: false, reason: "needs-install" };
    var perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "denied" };
    var reg = await register();
    if (!BACKEND || !pushSupported() || !reg) return { ok: true, reason: "no-backend" };
    try {
      var t = await session();
      var keyRes = await fetch(BACKEND + "/api/vapid-public-key").then(function (r) { return r.json(); });
      var sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToBytes(keyRes.publicKey),
      });
      await fetch(BACKEND + "/api/push/register", {
        method: "POST",
        headers: authHeaders(t),
        body: JSON.stringify({ subscription: sub }),
      });
      return { ok: true, reason: "push" };
    } catch (e) { return { ok: true, reason: "error" }; }
  }

  // reminders: [{ id, at (ISO), title, body }]
  async function sync(reminders) {
    if (!BACKEND || !token()) return false;
    try {
      await fetch(BACKEND + "/api/push/reminders", {
        method: "POST",
        headers: authHeaders(token()),
        body: JSON.stringify({ reminders: reminders || [] }),
      });
      return true;
    } catch (e) { return false; }
  }

  async function disable() {
    var endpoint = null;
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      var sub = reg && (await reg.pushManager.getSubscription());
      if (sub) { endpoint = sub.endpoint; await sub.unsubscribe(); }
    } catch (e) {}
    if (BACKEND && token() && endpoint) {
      try {
        await fetch(BACKEND + "/api/push/unregister", {
          method: "POST",
          headers: authHeaders(token()),
          body: JSON.stringify({ endpoint: endpoint }),
        });
      } catch (e) {}
    }
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // Standalone = installed to the home screen. iOS only delivers push then.
  function installed() {
    try {
      return !!(window.navigator.standalone || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches));
    } catch (e) { return false; }
  }

  // Proof it works: fire one notification straight away.
  async function test(title, body) {
    try {
      if (!supported() || Notification.permission !== "granted") return false;
      var reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, { body: body, icon: "./icon-192.png", tag: "peppal-test" });
      } else {
        new Notification(title, { body: body, icon: "./icon-192.png" });
      }
      return true;
    } catch (e) { return false; }
  }

  window.PepPalPush = {
    supported: supported, pushSupported: pushSupported, isIos: isIos, test: test,
    enable: enable, sync: sync, disable: disable,
    installed: installed, token: token, register: register,
    hasBackend: function () { return !!BACKEND; },
  };

  if ("serviceWorker" in navigator) window.addEventListener("load", register);
})();
