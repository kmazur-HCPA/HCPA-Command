/* Command — Stone theme switcher
   Modes: "auto" (default), "day", "evening".
   Auto = evening from EVENING_START to DAY_START, America/New_York time.
   Loaded as a classic script in <head> (before CSS paints) to avoid a flash. */
(function () {
  var KEY = "cmd-theme-mode";
  var EVENING_START = 18 * 60;      // 6:00 PM
  var DAY_START = 6 * 60 + 30;      // 6:30 AM
  var root = document.documentElement;
  var META = { day: "#D5CFC4", evening: "#3A3631" };

  function minutesET() {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false
    }).formatToParts(new Date());
    var h = 0, m = 0;
    parts.forEach(function (p) {
      if (p.type === "hour") h = parseInt(p.value, 10) % 24;
      if (p.type === "minute") m = parseInt(p.value, 10);
    });
    return h * 60 + m;
  }

  function getMode() {
    try {
      var stored = localStorage.getItem(KEY);
      return stored === "day" || stored === "evening" ? stored : "auto";
    } catch { return "auto"; }
  }

  function resolve(mode) {
    if (mode === "day" || mode === "evening") return mode;
    var t = minutesET();
    return (t >= EVENING_START || t < DAY_START) ? "evening" : "day";
  }

  function apply(fade) {
    var next = resolve(getMode());
    if (root.getAttribute("data-theme") === next) return;
    if (fade) {
      root.classList.add("theme-fading");
      setTimeout(function () { root.classList.remove("theme-fading"); }, 1400);
    }
    root.setAttribute("data-theme", next);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", META[next]);
    root.dispatchEvent(new CustomEvent("cmd-themechange", { detail: { theme: next, mode: getMode() } }));
  }

  // Initial paint: no fade.
  apply(false);
  // Scheduled switches fade gently.
  setInterval(function () { apply(true); }, 60 * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) apply(true); });

  // Public API for the Settings control.
  window.CommandTheme = {
    getMode: getMode,
    current: function () { return root.getAttribute("data-theme"); },
    setMode: function (mode) {
      if (["auto", "day", "evening"].indexOf(mode) === -1) return;
      try { localStorage.setItem(KEY, mode); } catch { /* storage blocked: mode applies for this visit */ }
      apply(true);
    }
  };
})();
