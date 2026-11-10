// Applies the stored theme before first paint so the page never flashes the
// server-rendered default. Keep this file synchronous and dependency-free.
(() => {
  const themes = ["dark", "light", "sepia", "terminal", "glacier", "ember"];
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
