/* Pre-boot theme (UX-G1): set data-theme BEFORE first paint so a light-OS user
   does not see a dark flash. Same-origin file, not inline, because the CSP is
   script-src 'self'. Mirrors store/prefs.ts loadPrefs: the stored `themeMode`
   (else legacy `theme`) wins; "system" / nothing stored follows the OS. */
(function () {
  try {
    var mode = "system";
    try {
      var p = JSON.parse(localStorage.getItem("qz.prefs") || "{}");
      if (p.themeMode === "dark" || p.themeMode === "light" || p.themeMode === "system") mode = p.themeMode;
      else if (p.theme === "dark" || p.theme === "light") mode = p.theme;
    } catch (e) {}
    var theme = mode;
    if (mode === "system") {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
