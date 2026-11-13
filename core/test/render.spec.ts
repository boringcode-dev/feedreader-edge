import { describe, expect, it } from "vitest";
import { renderIndexPage } from "../render.ts";

function renderPage(): string {
  return renderIndexPage({
    cards: [],
    errors: [],
    sourceFilters: [],
    currentSource: "all",
    searchQuery: "",
    searchOpen: false,
    emptyMessage: "No items yet.",
    pageSize: 12,
    hasNext: false,
    currentYear: 2026,
    canonicalUrl: "https://example.com/",
    socialImageUrl: "https://example.com/og.png",
    appVersion: "test",
    inlineCss: ":root{--bg:#000}",
    themeInitScript: "document.documentElement.dataset.theme='dark';",
  });
}

describe("renderIndexPage", () => {
  it("renders the launch veil and accessible feed status hooks", () => {
    const html = renderPage();
    expect(html).toContain('class="boot-veil" data-boot-veil aria-hidden="true"');
    expect(html).toContain(
      '<p class="sr-only" data-feed-status role="status" aria-live="polite"></p>',
    );
  });

  it("inlines the theme/bootstrap assets and versions app.js", () => {
    const html = renderPage();
    expect(html).toContain("<style>:root{--bg:#000}</style>");
    expect(html).toContain(
      "<script>document.documentElement.dataset.theme='dark';</script>",
    );
    expect(html).toContain('/static/app.js?v=109');
    expect(html).not.toContain("style.css");
    expect(html).not.toContain("theme-init.js");
  });
});
