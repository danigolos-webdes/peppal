// Pep Pal analytics — counts, not people.
//
// Off unless you configure it. Two supported shapes, set BEFORE this script:
//   window.PEPPAL_ANALYTICS = { provider: "plausible", domain: "peppal.app" }
//   window.PEPPAL_ANALYTICS = { provider: "beacon", url: "https://your-backend/api/stat" }
//
// Rules this file keeps, on purpose:
//   - no cookies, no localStorage, no device or user id of any kind
//   - no event properties — only a name from the allowlist below
//   - nothing about doses, tests, medication, partners or the PEP window
//   - Do Not Track and Global Privacy Control are honoured, silently
(function () {
  var CFG = (typeof window !== "undefined" && window.PEPPAL_ANALYTICS) || null;

  // The complete list of what may ever be counted. Adding to this list is a
  // decision about privacy, so it lives here rather than at the call sites.
  var ALLOWED = [
    "app_open",
    "installed_to_home",
    "reminders_enabled",
    "passcode_enabled",
    "learn_opened",
    "pep_window_opened",
    "about_opened"
  ];

  function optedOut() {
    try {
      if (navigator.globalPrivacyControl) return true;
      var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      return dnt === "1" || dnt === "yes";
    } catch (e) { return false; }
  }

  var live = !!CFG && !optedOut();

  if (live && CFG.provider === "plausible") {
    var s = document.createElement("script");
    s.defer = true;
    s.setAttribute("data-domain", CFG.domain);
    s.src = CFG.src || "https://plausible.io/js/script.js";
    document.head.appendChild(s);
  }

  function event(name) {
    if (!live || ALLOWED.indexOf(name) === -1) return;
    try {
      if (CFG.provider === "plausible" && window.plausible) { window.plausible(name); return; }
      if (CFG.provider === "beacon" && CFG.url) {
        var body = JSON.stringify({ event: name });
        if (navigator.sendBeacon) navigator.sendBeacon(CFG.url, new Blob([body], { type: "application/json" }));
        else fetch(CFG.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true });
      }
    } catch (e) {}
  }

  window.PepPalStats = { event: event, enabled: function () { return live; }, allowed: ALLOWED.slice() };
  event("app_open");
})();
