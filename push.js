// Pep Pal push client. Loaded as a plain script; exposes window.PepPalPush.
// Set window.PEPPAL_BACKEND before this file loads to point at server.js.
// With no backend set, the app falls back to local notifications while open.
(function () {
  var BACKEND = (typeof window !== "undefined" && window.PEPPAL_BACKEND) || "";
  var DEVICE_KEY = "peppal.deviceId";

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

  function deviceId() { try { return localStorage.getItem(DEVICE_KEY) || ""; } catch (e) { return ""; } }

  async function register() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      var reg = await navigator.serviceWorker.register("/sw.js");
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
      var keyRes = await fetch(BACKEND + "/api/vapid-public-key").then(function (r) { return r.json(); });
      var sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToBytes(keyRes.publicKey),
      });
      var out = await fetch(BACKEND + "/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      }).then(function (r) { return r.json(); });
      if (out && out.deviceId) localStorage.setItem(DEVICE_KEY, out.deviceId);
      return { ok: true, reason: "push" };
    } catch (e) { return { ok: true, reason: "error" }; }
  }

  // reminders: [{ id, at (ISO), title, body }]
  async function sync(reminders) {
    var id = deviceId();
    if (!BACKEND || !id) return false;
    try {
      await fetch(BACKEND + "/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: id, reminders: reminders || [] }),
      });
      return true;
    } catch (e) { return false; }
  }

  async function disable() {
    var id = deviceId();
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      var sub = reg && (await reg.pushManager.getSubscription());
      if (sub) await sub.unsubscribe();
    } catch (e) {}
    if (BACKEND && id) {
      try {
        await fetch(BACKEND + "/api/unregister", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: id }),
        });
      } catch (e) {}
    }
    try { localStorage.removeItem(DEVICE_KEY); } catch (e) {}
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
    installed: installed, deviceId: deviceId, register: register,
    hasBackend: function () { return !!BACKEND; },
  };

  if ("serviceWorker" in navigator) window.addEventListener("load", register);
})();
