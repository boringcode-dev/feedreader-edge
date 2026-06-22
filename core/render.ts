// Port of web/templates/index.html (Go html/template) to a template-literal
// function. html/template auto-escapes every {{.Field}} interpolation into
// its HTML/attribute context — escapeHtml() below reproduces that for every
// interpolated value. All other markup (head, header SVGs, settings dialog)
// has zero template directives in the original and is copied verbatim.

import type { CardView, ErrorView } from './domain.ts';

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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sourceIconPath(source: string): string {
  switch (source) {
    case 'hackernews':
      return '/static/source-icons/hackernews.svg';
    case 'github':
      return '/static/source-icons/github.svg';
    case 'huggingface':
      return '/static/source-icons/huggingface.svg';
    case 'alphaxiv':
      return '/static/source-icons/alphaxiv.png';
    default:
      return '';
  }
}

function renderFilterButton(filter: SourceFilterView): string {
  const activeClass = filter.active ? ' is-active' : '';
  if (filter.key === 'all') {
    return `<button class="filter-button${activeClass}" type="button" data-filter="${escapeHtml(filter.key)}" aria-label="${escapeHtml(filter.label)}" title="${escapeHtml(filter.label)}">All</button>`;
  }
  return `<button class="filter-button${activeClass} filter-button--icon" type="button" data-filter="${escapeHtml(filter.key)}" aria-label="${escapeHtml(filter.label)}" title="${escapeHtml(filter.label)}">
              <img class="source-icon-image source-icon-image--filter source-icon-image--${escapeHtml(filter.key)}" src="${escapeHtml(filter.iconPath ?? '')}" alt="" aria-hidden="true" />
            </button>`;
}

function renderErrorBanner(error: ErrorView): string {
  return `<div class="error-banner">${escapeHtml(error.label)}: ${escapeHtml(error.error)}</div>`;
}

function renderCard(card: CardView): string {
  const briefAttrs = [
    card.briefPrefix
      ? ` data-brief-prefix="${escapeHtml(card.briefPrefix)}"`
      : '',
    card.briefSuffix
      ? ` data-brief-suffix="${escapeHtml(card.briefSuffix)}"`
      : '',
    card.briefDateIso
      ? ` data-brief-date-iso="${escapeHtml(card.briefDateIso)}" data-brief-date-kind="${escapeHtml(card.briefDateKind)}"`
      : '',
  ].join('');
  const briefBlock = card.brief
    ? `
          <p class="item-brief"${briefAttrs}>
            <span class="item-brief-text">${escapeHtml(card.brief)}</span>
          </p>`
    : '';
  return `
        <article class="item-card" data-source="${escapeHtml(card.source)}">
          <h2 class="item-title">
            <span class="item-index">${card.index}.</span>
            <a href="${escapeHtml(card.url)}" target="_blank" rel="noreferrer">${escapeHtml(card.title)}</a>
          </h2>${briefBlock}
          <p class="item-host"><img class="source-icon-image source-icon-image--host source-icon-image--${escapeHtml(card.source)}" src="${escapeHtml(sourceIconPath(card.source))}" alt="" aria-hidden="true" /><span class="item-host-text">${escapeHtml(card.host)}</span></p>
        </article>`;
}

export function renderIndexPage(data: PageData): string {
  const searchOpenClass = data.searchOpen ? ' is-search-active' : '';
  const searchFormOpenClass = data.searchOpen ? ' is-open' : '';
  const searchToggleActiveClass = data.searchOpen ? ' is-active' : '';
  const searchToggleLabel = data.searchOpen ? 'Close search' : 'Search feed';
  const searchToggleExpanded = data.searchOpen ? 'true' : 'false';
  const hiddenSourceValue =
    data.currentSource !== 'all' ? escapeHtml(data.currentSource) : '';
  const errorsBlock =
    data.errors.length > 0
      ? `
    <section class="shell error-stack">
      ${data.errors.map(renderErrorBanner).join('\n      ')}
    </section>`
      : '';
  const cardsHiddenClass = data.cards.length === 0 ? ' is-hidden' : '';
  const emptyHiddenClass = data.cards.length > 0 ? ' is-hidden' : '';
  const footerHiddenClass = data.cards.length === 0 ? ' is-hidden' : '';
  const viewMoreHidden =
    data.cards.length === 0 || !data.hasNext ? ' hidden' : '';

  return `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>reader</title>
    <meta name="application-name" content="reader" />
    <meta name="description" content="Tiny feed reader for Hacker News, GitHub Trending, Hugging Face Papers, and alphaXiv." />
    <link rel="canonical" href="${escapeHtml(data.canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="reader" />
    <meta property="og:title" content="reader — engineering and research signals" />
    <meta property="og:description" content="Tiny feed reader for Hacker News, GitHub Trending, Hugging Face Papers, and alphaXiv." />
    <meta property="og:url" content="${escapeHtml(data.canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(data.socialImageUrl)}" />
    <meta property="og:image:alt" content="reader social preview showing branded feed cards for engineering and research sources" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="reader — engineering and research signals" />
    <meta name="twitter:description" content="Tiny feed reader for Hacker News, GitHub Trending, Hugging Face Papers, and alphaXiv." />
    <meta name="twitter:image" content="${escapeHtml(data.socialImageUrl)}" />
    <meta name="twitter:image:alt" content="reader social preview showing branded feed cards for engineering and research sources" />
    <meta name="color-scheme" content="dark light" />
    <meta name="theme-color" content="#111e2c" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111e2c" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#e1ebf7" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="reader" />
    <link rel="manifest" href="/site.webmanifest?v=10" />
    <link rel="icon" href="/favicon.svg?v=8" sizes="any" type="image/svg+xml" />
    <link rel="shortcut icon" href="/favicon.svg?v=8" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=8" />
    <link rel="stylesheet" href="/static/style.css?v=39" />
    <script src="/static/app.js?v=31" defer></script>
  </head>
  <body>
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
            ${data.sourceFilters.map(renderFilterButton).join('\n            ')}
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
      <form class="config-dialog-form" method="dialog">
        <div class="config-dialog-header">
          <h2>Reader settings</h2>
          <button class="icon-button config-close" type="button" data-source-config-close aria-label="Close reader settings" title="Close reader settings">
            <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M18 6L6 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
          </button>
        </div>
        <p class="config-dialog-copy">Adjust the reader appearance and choose which sources appear in the feed.</p>
        <section class="config-section" aria-labelledby="config-theme-title">
          <div class="config-section-header">
            <h3 id="config-theme-title" class="config-section-title">Theme</h3>
          </div>
          <div class="config-options config-options--two-column config-options--choice-grid">
            <label class="config-option config-option--choice">
              <input type="radio" name="ui-theme" value="dark" data-theme-option checked />
              <span class="config-option-body config-option-body--choice">
                <span class="config-option-icon" aria-hidden="true">
                  <svg class="choice-icon" viewBox="0 0 24 24">
                    <path d="M21 12.8A9 9 0 1 1 11.2 3a7.2 7.2 0 0 0 9.8 9.8Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                  </svg>
                </span>
                <span class="config-option-title">Dark</span>
              </span>
            </label>
            <label class="config-option config-option--choice">
              <input type="radio" name="ui-theme" value="light" data-theme-option />
              <span class="config-option-body config-option-body--choice">
                <span class="config-option-icon" aria-hidden="true">
                  <svg class="choice-icon" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>
                  </svg>
                </span>
                <span class="config-option-title">Light</span>
              </span>
            </label>
          </div>
        </section>
        <section class="config-section" aria-labelledby="config-density-title">
          <div class="config-section-header">
            <h3 id="config-density-title" class="config-section-title">UI density</h3>
          </div>
          <div class="config-options config-options--two-column config-options--choice-grid">
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
                <span class="config-option-title">Hugging Face Papers Trending</span>
              </span>
            </label>
            <label class="config-option">
              <input type="checkbox" value="alphaxiv" data-source-option checked />
              <img class="source-icon-image source-icon-image--dialog source-icon-image--alphaxiv" src="/static/source-icons/alphaxiv.png" alt="" aria-hidden="true" />
              <span class="config-option-body">
                <span class="config-option-title">alphaXiv</span>
              </span>
            </label>
          </div>
        </section>
        <div class="config-dialog-actions">
          <button class="dialog-button" type="button" data-source-config-cancel>Cancel</button>
          <button class="dialog-button dialog-button-primary" type="button" data-source-config-save>Save</button>
        </div>
        <p class="config-dialog-meta">Build ${escapeHtml(data.appVersion)}</p>
      </form>
    </dialog>
${errorsBlock}
    <main class="shell page-body">
      <section class="cards-grid${cardsHiddenClass}" data-card-grid data-current-source="${escapeHtml(data.currentSource)}" data-page-size="${data.pageSize}" data-has-next="${data.hasNext ? 'true' : 'false'}" aria-busy="false">
        ${data.cards.map(renderCard).join('\n        ')}
      </section>

      <div class="empty-state${emptyHiddenClass}" data-empty-state>${escapeHtml(data.emptyMessage)}</div>

      <div class="footer-actions${footerHiddenClass}" data-footer-actions>
        <button class="view-more" type="button" data-view-more${viewMoreHidden}>View more</button>
      </div>
      <footer class="site-footer">
        <p><span class="footer-copyright">© ${data.currentYear}</span><span class="footer-sep">·</span><a class="footer-link" href="https://github.com/boringcode-dev/feedreader-edge" target="_blank" rel="noreferrer"><img class="footer-github-mark" src="/static/source-icons/github.svg" alt="" aria-hidden="true" /><span>GitHub</span></a></p>
      </footer>
    </main>
  </body>
</html>
`;
}
