// Port of web/templates/index.html (Go html/template) to a template-literal
// function. html/template auto-escapes every {{.Field}} interpolation into
// its HTML/attribute context — escapeHtml() below reproduces that for every
// interpolated value. All other markup (head, header SVGs, settings dialog)
// has zero template directives in the original and is copied verbatim.

import type { CardView, ErrorView } from "./domain.ts";

export interface SourceFilterView {
  key: string;
  label: string;
  iconPath?: string;
  active: boolean;
}

export interface PageData {
  cards: CardView[];
  errors: ErrorView[];
  sourceFilters: SourceFilterView[];
  currentSource: string;
  searchQuery: string;
  searchOpen: boolean;
  emptyMessage: string;
  pageSize: number;
  hasNext: boolean;
  currentYear: number;
  canonicalUrl: string;
  socialImageUrl: string;
  appVersion: string;
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sourceIconPath(source: string): string {
  switch (source) {
    case "hackernews":
      return "/static/source-icons/hackernews.svg";
    case "github":
      return "/static/source-icons/github.svg";
    case "huggingface":
      return "/static/source-icons/huggingface.svg";
    default:
      return "";
  }
}

function renderFilterButton(filter: SourceFilterView): string {
  const activeClass = filter.active ? " is-active" : "";
  if (filter.key === "all") {
    return `<button class="filter-button${activeClass}" type="button" data-filter="${escapeHtml(filter.key)}" aria-label="${escapeHtml(filter.label)}" title="${escapeHtml(filter.label)}">${escapeHtml(filter.label)}</button>`;
  }
  return `<button class="filter-button${activeClass} filter-button--icon" type="button" data-filter="${escapeHtml(filter.key)}" aria-label="${escapeHtml(filter.label)}" title="${escapeHtml(filter.label)}">
              <img class="source-icon-image source-icon-image--filter source-icon-image--${escapeHtml(filter.key)}" src="${escapeHtml(filter.iconPath ?? "")}" alt="" aria-hidden="true" />
            </button>`;
}

function renderErrorBanner(error: ErrorView): string {
  return `<div class="error-banner">${escapeHtml(error.label)}: ${escapeHtml(error.error)}</div>`;
}

interface ThemeChoice {
  value: string;
  label: string;
  description: string;
}

const themeChoices: ThemeChoice[] = [
  { value: "system", label: "Auto", description: "Follows device" },
  { value: "dark", label: "Ink", description: "Dark" },
  { value: "light", label: "Paper", description: "Light" },
  { value: "sepia", label: "Sepia", description: "Warm" },
  { value: "terminal", label: "Terminal", description: "High contrast" },
  { value: "glacier", label: "Glacier", description: "Cool light" },
  { value: "ember", label: "Ember", description: "Warm dark" },
];

function renderThemeOption(choice: ThemeChoice, checked: boolean): string {
  const swatchClass = `theme-swatch theme-swatch--${choice.value}`;
  return `<label class="theme-option">
              <input type="radio" name="ui-theme" value="${escapeHtml(choice.value)}" data-theme-option${checked ? " checked" : ""} />
              <span class="theme-option-body">
                <span class="${swatchClass}" aria-hidden="true">
                  <span class="theme-swatch-line theme-swatch-line--title"></span>
                  <span class="theme-swatch-line theme-swatch-line--meta"></span>
                  <span class="theme-swatch-dot"></span>
                </span>
                <span class="theme-option-label">
                  <span class="theme-option-title">${escapeHtml(choice.label)}</span>
                  <span class="theme-option-copy">${escapeHtml(choice.description)}</span>
                </span>
                <span class="theme-option-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2"/>
                  </svg>
                </span>
              </span>
            </label>`;
}

function renderCard(card: CardView): string {
  const briefAttrs = [
    card.briefPrefix
      ? ` data-brief-prefix="${escapeHtml(card.briefPrefix)}"`
      : "",
    card.briefSuffix
      ? ` data-brief-suffix="${escapeHtml(card.briefSuffix)}"`
      : "",
    card.briefDateIso
      ? ` data-brief-date-iso="${escapeHtml(card.briefDateIso)}" data-brief-date-kind="${escapeHtml(card.briefDateKind)}"`
      : "",
  ].join("");
  const briefBlock = card.brief
    ? `
          <p class="item-brief"${briefAttrs}>
            <span class="item-brief-text">${escapeHtml(card.brief)}</span>
          </p>`
    : "";
  const moreAction = `<button class="item-action item-action--more" type="button" data-card-more aria-label="More article actions" title="More article actions" aria-haspopup="dialog" aria-expanded="false" aria-controls="card-actions-dialog"><svg class="item-action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg></button>`;
  return `
        <article class="item-card" data-source="${escapeHtml(card.source)}" data-comments-url="${escapeHtml(card.commentsUrl ?? "")}">
          <h2 class="item-title">
            <span class="item-index">${card.index}.</span>
            <a href="${escapeHtml(card.url)}" target="_blank" rel="noreferrer">${escapeHtml(card.title)}</a>
          </h2>${briefBlock}
          <p class="item-host"><img class="source-icon-image source-icon-image--host source-icon-image--${escapeHtml(card.source)}" src="${escapeHtml(sourceIconPath(card.source))}" alt="" aria-hidden="true" /><span class="item-host-text">${escapeHtml(card.host)}</span><span class="item-actions"><button class="item-bookmark" type="button" data-bookmark-toggle aria-label="Save for later" title="Save for later" aria-pressed="false"><svg class="bookmark-icon bookmark-icon--outline" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/></svg><svg class="bookmark-icon bookmark-icon--filled" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z" fill="currentColor"/></svg></button>${moreAction}</span></p>
        </article>`;
}

export function renderIndexPage(data: PageData): string {
  const searchOpenClass = data.searchOpen ? " is-search-active" : "";
  const searchFormOpenClass = data.searchOpen ? " is-open" : "";
  const searchToggleActiveClass = data.searchOpen ? " is-active" : "";
  const searchToggleLabel = data.searchOpen ? "Close search" : "Search feed";
  const searchToggleExpanded = data.searchOpen ? "true" : "false";
  const hiddenSourceValue =
    data.currentSource !== "all" ? escapeHtml(data.currentSource) : "";
  const errorsBlock =
    data.errors.length > 0
      ? `
    <section class="shell error-stack">
      ${data.errors.map(renderErrorBanner).join("\n      ")}
    </section>`
      : "";
  const cardsHiddenClass = data.cards.length === 0 ? " is-hidden" : "";
  const emptyHiddenClass = data.cards.length > 0 ? " is-hidden" : "";
  const footerHiddenClass = data.cards.length === 0 ? " is-hidden" : "";
  const viewMoreHidden =
    data.cards.length === 0 || !data.hasNext ? " hidden" : "";

  return `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>reader</title>
    <meta name="application-name" content="reader" />
    <meta name="description" content="Tiny feed reader for Hacker News, GitHub Trending, and Hugging Face Trending Papers." />
    <link rel="canonical" href="${escapeHtml(data.canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="reader" />
    <meta property="og:title" content="reader — engineering and research signals" />
    <meta property="og:description" content="Tiny feed reader for Hacker News, GitHub Trending, and Hugging Face Trending Papers." />
    <meta property="og:url" content="${escapeHtml(data.canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(data.socialImageUrl)}" />
    <meta property="og:image:alt" content="reader social preview showing branded feed cards for engineering and research sources" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="reader — engineering and research signals" />
    <meta name="twitter:description" content="Tiny feed reader for Hacker News, GitHub Trending, and Hugging Face Trending Papers." />
    <meta name="twitter:image" content="${escapeHtml(data.socialImageUrl)}" />
    <meta name="twitter:image:alt" content="reader social preview showing branded feed cards for engineering and research sources" />
    <meta name="color-scheme" content="dark light" />
    <meta name="theme-color" content="#0e141b" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0e141b" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f3ec" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="reader" />
    <link rel="manifest" href="/site.webmanifest?v=17" />
    <link rel="icon" href="/favicon.svg?v=8" sizes="any" type="image/svg+xml" />
    <link rel="shortcut icon" href="/favicon.svg?v=8" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=8" />
    <script src="/static/theme-init.js?v=1"></script>
    <link rel="stylesheet" href="/static/style.css?v=122" />
    <script src="/static/app.js?v=101" defer></script>
  </head>
  <body data-app-version="${escapeHtml(data.appVersion)}">
    <header class="shell page-header">
      <div class="toast" data-toast role="status" aria-live="polite"></div>
      <div class="header-top">
        <h1 class="brand"><img class="brand-mark" src="/favicon.svg?v=7" alt="" aria-hidden="true" /><span>reader</span></h1>
        <div class="header-actions">
          <span class="connection-indicator is-hidden" data-connection-indicator role="img" aria-label="Internet disconnected" title="Internet disconnected">
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2.5 8.8a14.5 14.5 0 0 1 19 0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <path d="M5.5 12.4a10.1 10.1 0 0 1 13 0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <path d="M8.9 16a5.2 5.2 0 0 1 6.2 0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <circle cx="12" cy="19" r="1.3" fill="currentColor"/>
              <path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.9"/>
            </svg>
          </span>
          <button class="pill-button update-button is-hidden" type="button" data-update-button aria-label="A new version is available — tap to refresh" title="A new version is available — tap to refresh">
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.5c2.6 2 4 5.3 4 9.3 0 2.4-.5 4.4-1.3 6l-2.7 3-2.7-3c-.8-1.6-1.3-3.6-1.3-6 0-4 1.4-7.3 4-9.3Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              <circle cx="12" cy="10.5" r="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <path d="M8.7 14.5l-2.6 1.3.4-3.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M15.3 14.5l2.6 1.3-.4-3.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
            <span>New version</span>
          </button>
          <button class="pill-button install-button is-hidden" type="button" data-install-button aria-label="Install reader" title="Install reader">
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.5v10.6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <path d="M7.8 10.7l4.2 4.2 4.2-4.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M4.5 18.2h15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
            </svg>
            <span>Install</span>
          </button>
          <button class="icon-button refresh-button" type="button" data-refresh-button aria-label="Refresh feed" title="Refresh feed">
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
          </button>
          <button class="icon-button config-toggle" type="button" data-source-config-open aria-label="Open reader settings" title="Open reader settings">
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <path d="M16 7h4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <circle cx="13" cy="7" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <path d="M4 12h3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <path d="M11 12h9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <circle cx="9" cy="12" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <path d="M4 17h10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <path d="M18 17h2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              <circle cx="16" cy="17" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="controls-row${searchOpenClass}" data-controls-row>
        <div class="filter-cluster">
          <nav class="segmented" data-filter-nav aria-label="Source filters">
            ${data.sourceFilters.map(renderFilterButton).join("\n            ")}
          </nav>
        </div>
        <div class="search-cluster">
          <form class="search-form${searchFormOpenClass}" data-search-form role="search" method="get" action="/">
            <label class="sr-only" for="feedreader-search">Search feed</label>
            <input type="hidden" name="source" value="${hiddenSourceValue}" data-search-source />
            <input id="feedreader-search" class="search-input" type="search" name="q" value="${escapeHtml(data.searchQuery)}" placeholder="Search title, summary, author, host" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" data-search-input />
          </form>
          <button class="icon-button search-toggle${searchToggleActiveClass}" type="button" data-search-toggle aria-label="${searchToggleLabel}" aria-expanded="${searchToggleExpanded}" title="${searchToggleLabel}">
            <svg class="theme-icon search-icon-search" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M16 16l4 4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
            <svg class="theme-icon search-icon-close" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M18 6L6 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
          </button>
        </div>
      </div>
    </header>

    <dialog class="config-dialog" data-source-config-dialog>
      <form class="config-dialog-form config-dialog-form--settings" method="dialog">
        <div class="config-dialog-header">
          <h2>Reader settings</h2>
          <button class="icon-button config-close" type="button" data-source-config-close aria-label="Close reader settings" title="Close reader settings">
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M18 6L6 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
          </button>
        </div>
        <p class="config-dialog-copy">Adjust the reader's appearance, reading, personalization, and sources.</p>
        <div class="config-tabs" role="tablist" aria-label="Reader settings sections">
          <button class="config-tab" id="config-tab-appearance" type="button" role="tab" aria-selected="true" aria-controls="config-panel-appearance" data-config-tab="appearance">Appearance</button>
          <button class="config-tab" id="config-tab-reading" type="button" role="tab" aria-selected="false" aria-controls="config-panel-reading" data-config-tab="reading" tabindex="-1">Reading</button>
          <button class="config-tab" id="config-tab-sources" type="button" role="tab" aria-selected="false" aria-controls="config-panel-sources" data-config-tab="sources" tabindex="-1">Sources</button>
        </div>
        <div class="config-tab-panels">
        <div class="config-tab-panel" id="config-panel-appearance" role="tabpanel" aria-labelledby="config-tab-appearance" data-config-panel="appearance">
        <section class="config-section" aria-labelledby="config-theme-title">
          <div class="config-section-header">
            <h3 id="config-theme-title" class="config-section-title">Theme</h3>
            <p class="config-section-copy">Auto follows your device's light or dark setting.</p>
          </div>
          <div class="config-options config-options--theme-grid">
            ${themeChoices.map((choice, index) => renderThemeOption(choice, index === 1)).join("\n            ")}
          </div>
        </section>
        <section class="config-section" aria-labelledby="config-density-title">
          <div class="config-section-header">
            <h3 id="config-density-title" class="config-section-title">UI density</h3>
          </div>
          <div class="config-options config-options--two-column">
            <label class="config-option config-option--choice">
              <input type="radio" name="ui-density" value="current" data-density-option checked />
              <span class="config-option-body config-option-body--choice">
                <span class="config-option-icon" aria-hidden="true">
                  <svg class="choice-icon" viewBox="0 0 24 24">
                    <path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
                    <path d="M7 5.2v3.6M17 5.2v3.6M7 10.2v3.6M17 10.2v3.6M7 15.2v3.6M17 15.2v3.6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.4" opacity="0.7"/>
                  </svg>
                </span>
                <span class="config-option-title">Comfortable</span>
              </span>
            </label>
            <label class="config-option config-option--choice">
              <input type="radio" name="ui-density" value="compact" data-density-option />
              <span class="config-option-body config-option-body--choice">
                <span class="config-option-icon" aria-hidden="true">
                  <svg class="choice-icon" viewBox="0 0 24 24">
                    <path d="M5 8h14M5 12h14M5 16h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"/>
                    <path d="M7 7v1.8M17 7v1.8M7 11v1.8M17 11v1.8M7 15v1.8M17 15v1.8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.2" opacity="0.55"/>
                  </svg>
                </span>
                <span class="config-option-title">Compact</span>
              </span>
            </label>
          </div>
        </section>
        </div>
        <div class="config-tab-panel" id="config-panel-reading" role="tabpanel" aria-labelledby="config-tab-reading" data-config-panel="reading" hidden>
        <section class="config-section" data-article-preview-section aria-labelledby="config-reading-title">
          <div class="config-section-header">
            <h3 id="config-reading-title" class="config-section-title">Article preview</h3>
            <p class="config-section-copy">Read articles in a reader view without leaving the feed.</p>
          </div>
          <div class="config-options">
            <label class="config-option">
              <input type="checkbox" data-article-preview-toggle />
              <span class="config-option-icon" aria-hidden="true">
                <svg class="choice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8">
                  <path d="M4 5.5h7.5a1.5 1.5 0 0 1 1.5 1.5v12a2 2 0 0 0-2-2H4Z"/>
                  <path d="M20 5.5h-7.5A1.5 1.5 0 0 0 11 7v12a2 2 0 0 1 2-2h7Z"/>
                </svg>
              </span>
              <span class="config-option-body">
                <span class="config-option-title">Preview articles in a reader view</span>
              </span>
            </label>
          </div>
        </section>
        <section class="config-section" data-bookmarks-section aria-labelledby="config-bookmarks-title">
          <div class="config-section-header">
            <h3 id="config-bookmarks-title" class="config-section-title">Bookmarks</h3>
            <p class="config-section-copy">Save articles for later and show the Saved filter.</p>
          </div>
          <div class="config-options">
            <label class="config-option">
              <input type="checkbox" data-bookmarks-toggle />
              <span class="config-option-icon" aria-hidden="true">
                <svg class="choice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8">
                  <path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z"/>
                </svg>
              </span>
              <span class="config-option-body">
                <span class="config-option-title">Enable bookmarks</span>
              </span>
            </label>
          </div>
        </section>
        <section class="config-section" aria-labelledby="config-personalization-title">
          <div class="config-section-header">
            <h3 id="config-personalization-title" class="config-section-title">AI personalization</h3>
            <p class="config-section-copy">Rerank your feed by your interests using AI. Stored only in this browser.</p>
          </div>
          <div class="config-options">
            <label class="config-option">
              <input type="checkbox" data-ai-personalization-toggle />
              <span class="config-option-icon" aria-hidden="true">
                <svg class="choice-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.937A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L13.5 8.5a2 2 0 0 0 1.437 1.437l6.135 1.582a.5.5 0 0 1 0 .962L14.937 14.063A2 2 0 0 0 13.5 15.5l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                </svg>
              </span>
              <span class="config-option-body">
                <span class="config-option-title">Enable personalized ranking</span>
              </span>
            </label>
          </div>
          <textarea class="interests-input" data-interests-input rows="3" maxlength="300" placeholder="fullstack development, software engineering, computer science, AI, machine learning, LLMs"></textarea>
        </section>
        </div>
        <div class="config-tab-panel" id="config-panel-sources" role="tabpanel" aria-labelledby="config-tab-sources" data-config-panel="sources" hidden>
        <section class="config-section" aria-labelledby="config-sources-title">
          <div class="config-section-header">
            <h3 id="config-sources-title" class="config-section-title">Sources</h3>
            <p class="config-section-copy">Show or hide sources in the filter bar and the combined feed view.</p>
          </div>
          <div class="config-options">
            <label class="config-option">
              <input type="checkbox" value="hackernews" data-source-option checked />
              <img class="source-icon-image source-icon-image--dialog source-icon-image--hackernews" src="/static/source-icons/hackernews.svg" alt="" aria-hidden="true" />
              <span class="config-option-body">
                <span class="config-option-title">Hacker News</span>
              </span>
            </label>
            <label class="config-option">
              <input type="checkbox" value="github" data-source-option checked />
              <img class="source-icon-image source-icon-image--dialog source-icon-image--github" src="/static/source-icons/github.svg" alt="" aria-hidden="true" />
              <span class="config-option-body">
                <span class="config-option-title">GitHub Trending</span>
              </span>
            </label>
            <label class="config-option">
              <input type="checkbox" value="huggingface" data-source-option checked />
              <img class="source-icon-image source-icon-image--dialog source-icon-image--huggingface" src="/static/source-icons/huggingface.svg" alt="" aria-hidden="true" />
              <span class="config-option-body">
                <span class="config-option-title">Hugging Face Trending Papers</span>
              </span>
            </label>
          </div>
        </section>
        </div>
        </div>
        <div class="config-dialog-footer-row">
          <p class="config-dialog-meta">Build ${escapeHtml(data.appVersion)}</p>
          <div class="config-dialog-actions">
            <button class="dialog-button" type="button" data-source-config-cancel>
              <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                <path d="M18 6L6 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              </svg>
              <span>Cancel</span>
            </button>
            <button class="dialog-button dialog-button-primary" type="button" data-source-config-save>
              <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              </svg>
              <span>Save</span>
            </button>
          </div>
        </div>
      </form>
    </dialog>

    <dialog class="config-dialog install-dialog" data-install-dialog>
      <form class="config-dialog-form" method="dialog">
        <div class="config-dialog-header">
          <h2>Install reader</h2>
          <button class="icon-button config-close" type="button" data-install-dialog-close aria-label="Close install prompt" title="Close install prompt">
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M18 6L6 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
          </button>
        </div>
        <img class="install-dialog-screenshot" data-install-screenshot-mobile src="/manifest-assets/screenshot-mobile.png?v=6" alt="reader running as an installed app on mobile" width="430" height="932" loading="lazy" />
        <img class="install-dialog-screenshot install-dialog-screenshot-tablet is-hidden" data-install-screenshot-tablet src="/manifest-assets/screenshot-tablet.png?v=5" alt="reader running as an installed app on iPad" width="820" height="1180" loading="lazy" />
        <img class="install-dialog-screenshot install-dialog-screenshot-desktop is-hidden" data-install-screenshot-desktop src="/manifest-assets/screenshot-wide.png?v=5" alt="reader running as an installed app on desktop" width="1440" height="1120" loading="lazy" />
        <p class="config-dialog-copy">Add reader to your home screen for a faster, full-screen experience with offline access to your last feed.</p>
        <ol class="install-steps is-hidden" data-install-steps>
          <li>
            Tap the Share icon
            <span class="install-steps-icon" aria-hidden="true">
              <svg class="theme-icon" viewBox="0 0 24 24">
                <path d="M12 14V4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
                <path d="M8.5 7.5L12 4l3.5 3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                <path d="M6 10v8.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              </svg>
            </span>
            in Safari's toolbar.
          </li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
        </ol>
        <div class="config-dialog-footer-row" data-install-dialog-footer>
          <div class="config-dialog-actions">
            <button class="dialog-button" type="button" data-install-dialog-hide>Don't show again</button>
            <button class="dialog-button dialog-button-primary" type="button" data-install-dialog-confirm>
              <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3.5v10.6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
                <path d="M7.8 10.7l4.2 4.2 4.2-4.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                <path d="M4.5 18.2h15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
              </svg>
              Install app
            </button>
          </div>
        </div>
      </form>
    </dialog>
${errorsBlock}
    <main class="shell page-body" data-page-body>
      <div class="feed-column">
      <p class="personalized-indicator is-hidden" data-personalized-indicator>
        <svg class="personalized-indicator-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.937A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L13.5 8.5a2 2 0 0 0 1.437 1.437l6.135 1.582a.5.5 0 0 1 0 .962L14.937 14.063A2 2 0 0 0 13.5 15.5l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
        </svg>
        Personalized by AI
      </p>
      <section class="cards-grid${cardsHiddenClass}" data-card-grid data-current-source="${escapeHtml(data.currentSource)}" data-page-size="${data.pageSize}" data-has-next="${data.hasNext ? "true" : "false"}" aria-busy="false">
        ${data.cards.map(renderCard).join("\n        ")}
      </section>

      <div class="empty-state${emptyHiddenClass}" data-empty-state>${escapeHtml(data.emptyMessage)}</div>

      <div class="footer-actions${footerHiddenClass}" data-footer-actions>
        <button class="view-more" type="button" data-view-more${viewMoreHidden}>
          <span data-view-more-label>View more</span>
          <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
          </svg>
        </button>
      </div>
      <footer class="site-footer">
        <p><span class="footer-copyright">© ${data.currentYear}</span><span class="footer-sep">·</span><a class="footer-link" href="https://github.com/boringcode-dev/feedreader-edge" target="_blank" rel="noreferrer"><img class="footer-github-mark" src="/static/source-icons/github.svg" alt="" aria-hidden="true" /><span>GitHub</span></a></p>
      </footer>
      </div>
      <aside class="preview-panel is-hidden" data-preview-panel aria-label="Article preview">
        <div class="preview-panel-header">
          <div class="preview-panel-header-info">
            <p class="preview-panel-source">
              <img class="source-icon-image source-icon-image--host is-hidden" data-preview-source-icon src="" alt="" aria-hidden="true" />
              <span class="preview-panel-source-label" data-preview-source-label></span>
            </p>
            <p class="preview-panel-card-meta is-hidden" data-preview-meta></p>
          </div>
          <div class="preview-panel-actions">
            <button class="icon-button preview-panel-bookmark" type="button" data-preview-bookmark aria-label="Save for later" title="Save for later" aria-pressed="false">
              <svg class="bookmark-icon bookmark-icon--outline" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/>
              </svg>
              <svg class="bookmark-icon bookmark-icon--filled" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z" fill="currentColor"/>
              </svg>
            </button>
            <button class="icon-button preview-panel-overflow" type="button" data-preview-overflow aria-label="More article actions" title="More article actions" aria-haspopup="dialog" aria-expanded="false" aria-controls="preview-actions-dialog">
              <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="5" cy="12" r="1.6" fill="currentColor"/>
                <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
                <circle cx="19" cy="12" r="1.6" fill="currentColor"/>
              </svg>
            </button>
            <button class="icon-button preview-panel-close" type="button" data-preview-close aria-label="Close article preview" title="Close article preview">
              <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                <path d="M18 6L6 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              </svg>
            </button>
          </div>
          <dialog class="config-dialog preview-actions-dialog" id="preview-actions-dialog" data-preview-actions-dialog aria-label="Article actions">
            <div class="config-dialog-form">
              <div class="config-dialog-header preview-actions-header">
                <div class="preview-actions-heading">
                  <h2 class="preview-actions-title" data-preview-actions-title>Article actions</h2>
                  <p class="preview-actions-source">
                    <img class="source-icon-image source-icon-image--host is-hidden" data-preview-actions-source-icon src="" alt="" aria-hidden="true" />
                    <span data-preview-actions-source-label></span>
                  </p>
                </div>
                <button class="icon-button config-close" type="button" data-preview-actions-close aria-label="Close article actions" title="Close article actions">
                  <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                    <path d="M18 6L6 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                  </svg>
                </button>
              </div>
              <div class="config-options preview-actions-dialog-options">
                <button class="config-option preview-actions-dialog-option" type="button" data-preview-menu-share aria-label="Share article" title="Share article">
                  <span class="config-option-icon" aria-hidden="true">
                    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 15V4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
                      <path d="M8.5 7.5L12 4l3.5 3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                      <path d="M6 11v7.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                    </svg>
                  </span>
                  <span class="config-option-body">
                    <span class="config-option-title">Share</span>
                  </span>
                </button>
                <a class="config-option preview-actions-dialog-option is-hidden" data-preview-menu-comments href="#" target="_blank" rel="noreferrer noopener" aria-label="Comments" title="Comments">
                  <span class="config-option-icon" aria-hidden="true">
                    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/>
                    </svg>
                  </span>
                  <span class="config-option-body">
                    <span class="config-option-title">Comments</span>
                  </span>
                </a>
                <a class="config-option preview-actions-dialog-option" data-preview-menu-open href="#" target="_blank" rel="noreferrer noopener" aria-label="Open source" title="Open source">
                  <span class="config-option-icon" aria-hidden="true">
                    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 5h5v5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                      <path d="M19 5l-8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                    </svg>
                  </span>
                  <span class="config-option-body">
                    <span class="config-option-title">Open source</span>
                  </span>
                </a>
              </div>
            </div>
          </dialog>
        </div>
        <div class="preview-panel-scroll" data-preview-scroll aria-live="polite">
          <h2 class="preview-panel-title" data-preview-title>Article preview</h2>
          <p class="preview-panel-byline is-hidden" data-preview-byline></p>
          <p class="preview-panel-reading-meta is-hidden" data-preview-reading-meta></p>
          <p class="preview-panel-status" data-preview-status>Select an article to preview it here.</p>
          <div class="preview-panel-content" data-preview-content></div>
        </div>
        <div class="preview-panel-footer">
          <button class="preview-panel-nav" type="button" data-preview-prev aria-label="Previous article" title="Previous article" disabled>
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14.5 6.5 9 12l5.5 5.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
            <span>Previous</span>
          </button>
          <button class="preview-panel-nav" type="button" data-preview-next aria-label="Next article" title="Next article" disabled>
            <span>Next</span>
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9.5 6.5 15 12l-5.5 5.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
          </button>
        </div>
      </aside>
      <dialog class="config-dialog preview-actions-dialog card-actions-dialog" id="card-actions-dialog" data-card-actions-dialog aria-label="Article actions">
        <div class="config-dialog-form">
          <div class="config-dialog-header preview-actions-header">
            <div class="preview-actions-heading">
              <h2 class="preview-actions-title" data-card-actions-title>Article actions</h2>
              <p class="preview-actions-source">
                <img class="source-icon-image source-icon-image--host is-hidden" data-card-actions-source-icon src="" alt="" aria-hidden="true" />
                <span data-card-actions-source-label></span>
              </p>
            </div>
            <button class="icon-button config-close" type="button" data-card-actions-close aria-label="Close article actions" title="Close article actions">
              <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                <path d="M18 6L6 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              </svg>
            </button>
          </div>
          <div class="config-options preview-actions-dialog-options">
            <button class="config-option preview-actions-dialog-option" type="button" data-card-menu-share aria-label="Share article" title="Share article">
              <span class="config-option-icon" aria-hidden="true">
                <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 15V4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
                  <path d="M8.5 7.5L12 4l3.5 3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                  <path d="M6 11v7.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                </svg>
              </span>
              <span class="config-option-body">
                <span class="config-option-title">Share</span>
              </span>
            </button>
            <a class="config-option preview-actions-dialog-option is-hidden" data-card-menu-comments href="#" target="_blank" rel="noreferrer noopener" aria-label="Comments" title="Comments">
              <span class="config-option-icon" aria-hidden="true">
                <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/>
                </svg>
              </span>
              <span class="config-option-body">
                <span class="config-option-title">Comments</span>
              </span>
            </a>
            <a class="config-option preview-actions-dialog-option" data-card-menu-open href="#" target="_blank" rel="noreferrer noopener" aria-label="Open source" title="Open source">
              <span class="config-option-icon" aria-hidden="true">
                <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14 5h5v5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                  <path d="M19 5l-8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                  <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                </svg>
              </span>
              <span class="config-option-body">
                <span class="config-option-title">Open source</span>
              </span>
            </a>
          </div>
        </div>
      </dialog>
    </main>
  </body>
</html>
`;
}
