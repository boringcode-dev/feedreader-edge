// Applies the stored theme before first paint so the page never flashes the
// server-rendered default. Keep this file synchronous and dependency-free.
(() => {
  const themes = ["dark", "light", "sepia", "terminal", "glacier", "ember"];

  // Show the launch veil before first paint only when running as an installed
  // app. Modern browsers report display-mode; older iOS only exposes
  // navigator.standalone.
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    window.navigator.standalone === true;
  if (standalone) {
    document.documentElement.dataset.standalone = "true";
  }

  try {
    const stored = localStorage.getItem("feedreader.theme");
    const preference = stored === null ? "system" : stored;
    const resolved =
      preference === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : themes.includes(preference)
          ? preference
          : "dark";
    document.documentElement.dataset.theme = resolved;

    const density = localStorage.getItem("feedreader.uiDensity");
    if (density === "compact") {
      document.documentElement.dataset.uiDensity = "compact";
    }
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
})();
