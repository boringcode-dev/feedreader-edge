<h1>
  <img alt="feedreader logo" src="web-static/favicon.svg" width="70" valign="middle">
  &nbsp;reader&thinsp;<img alt="" src="docs/assets/orange-dot.svg" width="8" height="8" valign="baseline" />
</h1>

<p>
  <strong>A tiny, fast, Cloudflare-native feed reader for engineering and research signals.</strong>
</p>

<p>
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare D1" />
  <img src="https://img.shields.io/badge/Cron-Triggers-F38020?logo=cloudflare&logoColor=white" alt="Cron Triggers" />
  <img src="https://img.shields.io/badge/Node-24-339933?logo=node.js&logoColor=white" alt="Node 24" />
  <a href="https://github.com/boringcode-dev/feedreader-edge/actions/workflows/ci.yml"><img src="https://github.com/boringcode-dev/feedreader-edge/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" />
</p>

![feedreader social card](web-static/og-image.png?v=3)

---

## Screenshot

![feedreader home screen](docs/assets/feedreader-home.png?v=2)

---

## Performance

`feedreader` is server-rendered HTML with vanilla JS/CSS — no framework runtime, no client hydration, no bundler payload. That keeps it genuinely tiny and fast, not just "fast for a SPA."

The home page has no render-blocking asset requests: the stylesheet and pre-paint theme bootstrap are inlined into the HTML, and the response is edge-cached per URL for five minutes. The browser-facing copy is `private, no-store`; the five-minute cache lives in the Worker Cache API. Versioned static assets are served with immutable browser caching; see [`web-static/_headers`](web-static/_headers).

Lighthouse against the production deployment (mobile, simulated throttling):

![Lighthouse report](docs/assets/lighthouse-report.png)

Reproduce locally:

```bash
npx lighthouse https://reader.boringcode.dev --view
```

---

## Features

- **Multi-source feed aggregation**
  - Hacker News
  - GitHub Trending
  - Hugging Face Trending Papers
- **Persistent edge storage** with Cloudflare D1
- **Incremental fetch model** that keeps older items in the database
- **Server-backed incremental loading**: first page loads 12 items, first-load bootstrap/filter/search/refresh show a toast-based loading state, and `View more` appends more items in place
- **Source-aware card summaries**
  - Hacker News cards show **points** and **comments**
  - GitHub cards show **stars**, **today's stars**, and **forks**
  - GitHub repo titles are normalized to canonical `owner/repo` form from the repo URL path
  - Hugging Face cards show **upvotes**
  - published/fetched dates are formatted in the browser locale while preserving the stored UTC calendar date
- **Card host-row actions** for optional bookmarks and a more-actions dialog with Share, Hacker News comments, and Open source
- **Responsive, minimalist UI** with:
  - source filters
  - real source icons in filters, dialog rows, and card metadata
  - RSS-based app icon/favicon branding
  - seven themes — Auto (follows the device), Ink, Paper, Sepia, Terminal, Glacier, and Ember — with a visual swatch picker
  - inline expanding search
  - reader settings dialog for theme, density, and source visibility
  - iPhone landscape safe-area handling so content stays clear of the notch and Dynamic Island
  - compact icon-only Install/Update and For You controls when the preview is open in phone landscape
- **Configurable visible sources** stored in `localStorage`
  - choose which source buttons are shown
  - when 2+ sources are enabled, `All` stays visible and aggregates over the enabled set
  - when exactly 1 source is enabled, only that source button is shown
- **Debounced client-side search UX** backed by the server API
- **Explicit empty states** for no-result source filters and searches
- **Connectivity indicator** that shows a no-wifi icon while offline and silently refreshes the current view when the browser reconnects
- **Scheduled refresh** every 1 hour on wall-clock boundaries
- **Manual refresh** from the header re-fetches the current feed view from backend stored items only; it does **not** re-fetch upstream sources
- **Persisted visited-link dimming** for feed card titles across reload/reopen using local storage
- **Optional article preview** (off by default, toggled in Reader settings) that opens a reader view beside the feed on wide screens or full-screen on phones, with inline links/emphasis, image captions, tables, publication date/reading time, a Workers AI Markdown fallback for PDFs, Office documents, and HTML pages with no readable blocks, source-specific Hacker News comments, and an **Open source** button
- **Saved articles** with an optional per-card bookmark toggle, a `Saved` filter, and a preview-panel toggle; bookmark controls are disabled by default and can be enabled in Reader settings, with saved items stored locally under `feedreader.bookmarks`
- **PWA-ready assets and offline caching** including manifest, service worker, touch icons, cached shell assets, cached `/api/items` responses for previously visited views, a standalone launch veil, and skeleton loading states
- **Reconnect list refresh** re-fetches the current view from backend stored items only; it does **not** refresh upstream sources
- **Cloudflare-native deployment** with Workers, D1, Cron Triggers, and Workers Static Assets

---

## Why feedreader?

`feedreader` is designed for people who want a small, understandable reader instead of a large feed platform.

It optimizes for:

- simple operations
- low infrastructure overhead
- straightforward data ownership
- easy extension when adding more sources

---

## Tech stack

### Runtime

- TypeScript
- Cloudflare Workers
- Web Standard APIs
- `node-html-parser`

### Frontend

- Server-rendered HTML
- Vanilla JavaScript
- Plain CSS

### Storage

- Cloudflare D1

### Deployment

- Cloudflare Workers
- Cron Triggers
- Workers Static Assets

---

## Architecture

At a high level:

1. source adapters fetch upstream content
2. items are upserted into D1 by `(source, external_id)`
3. the Worker reads stored items ordered by article date descending
4. the cron trigger refreshes hourly on wall-clock boundaries

Key properties:

- old items are retained in the database
- fetch failures do not wipe existing data
- sources without a native article date fall back to the initial fetch time (`first_seen_at`) for ordering
- later refreshes preserve the original published/fetched ordering timestamps for existing items

---

## Project structure

```text
core/                   platform-agnostic domain logic, source adapters,
                        refresh orchestration, SSR rendering
platforms/cloudflare/   Worker entrypoint, D1 repository, migrations,
                        wrangler config
web-static/             CSS, JS, icons, manifest, service worker
docs/assets/            README screenshots and supporting images
```

---

## Getting started

### Prerequisites

- Node.js 24+
- npm
- a Cloudflare account for remote deployment

### Run locally

```bash
npm install
npm run db:migrate:local
npm run dev
```

Then open:

- `http://127.0.0.1:8788`

### Run tests

```bash
npm run typecheck
npm test
```

### First-time Cloudflare setup

```bash
npm install
wrangler login
wrangler d1 create feedreader
# copy the returned database_id into platforms/cloudflare/wrangler.toml
wrangler secret put REFRESH_SECRET --config platforms/cloudflare/wrangler.toml
npm run db:migrate:remote
```

### Deploy

```bash
npm run deploy
```

If you are reproducing this deployment in another Cloudflare account, bind the Worker to a custom domain in Cloudflare or use the generated `*.workers.dev` hostname.

---

## Configuration

Bindings configured in `platforms/cloudflare/wrangler.toml`:

- `DB` — D1 database binding
- `ASSETS` — Workers Static Assets binding for `web-static/`
- `SELF` — service binding back to the same Worker for per-source refresh fan-out

Runtime configuration:

| Variable                      |           Default | Description                                                    |
| ----------------------------- | ----------------: | -------------------------------------------------------------- |
| `FEEDREADER_ITEMS_PER_SOURCE` |              `20` | Per-source item count used in source dashboard/health contexts |
| `FEEDREADER_USER_AGENT`       |  `feedreader/0.1` | Outbound fetch user agent                                      |
| `FEEDREADER_AI_PREVIEW_FALLBACK` |           `true` | Workers AI Markdown fallback for PDFs/Office documents and empty previews; `false` disables it |
| `REFRESH_SECRET`              | _required secret_ | Shared secret for internal per-source refresh fan-out routes   |

---

## Scheduling

The scheduler runs through a **Cloudflare Cron Trigger**.

Behavior:

- runs hourly via `0 * * * *`
- does **not** perform an immediate refresh just because a deploy completed
- fans out one fresh Worker invocation per source to stay within free-tier CPU budgets

On-demand refresh is available through:

- the header refresh button for re-fetching the current backend-stored feed view
- `POST /api/refresh` for triggering an immediate upstream source refresh across all sources

---

## API

### `GET /healthz`

Returns service health and per-source refresh status.

### `GET /api/items`

Returns feed items for incremental loading.

Query params:

- `source` — optional source filter (`hackernews`, `github`, `huggingface`)
- `sources` — optional comma-separated aggregate source set used when the client wants the `All` view scoped to enabled sources (for example `hackernews,github`)
- `q` — optional case-insensitive search query across title, summary, author, URL host/path, and stored metadata
- `limit` — page size
- `offset` — pagination offset

### `GET /api/preview`

Returns a reader view for a stored feed item: rich text segments, image blocks with captions, table blocks, and publication/reading-time metadata.

- `url` — required; must exactly match the URL of an item currently stored in D1

The Worker fetches the article with a 10-second timeout and a 400 KB HTML cap, rejects non-public hosts, and never returns upstream markup. When the built-in extractor finds no readable blocks or the response is a document (PDF/Office), the Worker can convert it through Workers AI's Markdown conversion with a 5 MB cap; set `FEEDREADER_AI_PREVIEW_FALLBACK=false` to disable that fallback. Inline targets and images are restricted to validated public http(s) URLs. Responses are edge-cached for 30 minutes. Returns `404` for unknown URLs and `502` when the upstream page cannot be previewed.

### `POST /api/refresh`

Triggers an immediate upstream refresh across all sources and returns per-source outcomes.

### `POST /internal/refresh/:source`

Internal fan-out route used by the Worker itself. It requires the `X-Refresh-Secret` header and is not intended for external callers.

---

## Data model

The service stores a cumulative feed history.

Each fetch:

- upserts items by `(source, external_id)`
- updates refresh state in `sync_state`
- preserves older items already in the database

The UI/API render items from the full stored set, ordered by article date descending.

Presentation-layer note:

- the source adapters persist raw metadata into `metadata_json`
- the card-building layer turns that metadata into user-visible summary lines
- current rendered metrics are:
  - Hacker News: points and comments
  - GitHub: stars, today, forks
  - Hugging Face Papers: upvotes
- source icons are not embedded in the brief text itself
- the current card layout renders the real source icon inline before the host/domain line

---

## UI behavior

### Search

- the search control expands inline in the header
- clicking the search icon focuses the input
- the input renders at `16px` to avoid common iOS Safari auto-zoom behavior
- typing is debounced and only triggers the search API once the query reaches at least 2 characters
- closing the search control clears the query and resets the feed only when an active query exists
- closing an empty visible search box just hides the control and does not refetch `/api/items`
- the browser's native `type="search"` clear button is suppressed so the app's search toggle/close control is the only clear affordance

### Loading and empty states

- first-load bootstrap queries, source filter changes, searches, `View more`, and header refresh use skeleton cards instead of a loading toast
- skeletons appear after a short delay (150 ms when a feed is already on screen, immediately when the grid is empty) so fast responses do not flash a placeholder; replace loads swap the current grid for skeleton cards, while `View more` appends three skeleton rows
- the grid exposes `aria-busy` while loading, skeleton cards are `aria-hidden`, and a visually hidden live region announces the loading message
- completed loads crossfade into the new cards using the View Transitions API where available and a Web Animations fade as the fallback; a failed request restores the previous cards
- `prefers-reduced-motion: reduce` disables shimmer and transition animations while keeping the state changes
- source-filter and search requests that return zero items replace the list with an empty-state message instead of leaving stale cards on screen
- `View more` disables itself while an append request is in flight and hides itself when the current result set has no further page

### Offline and connectivity

- installed PWAs show a theme-matched launch veil instead of a blank frame while the shell starts; it fades out after the first content frame and is never displayed in a regular browser tab
- the app shell and previously fetched `GET /api/items` views are cached by the service worker for offline reuse
- this offline/PWA behavior requires a secure-context origin where service workers are available (for example `localhost` or HTTPS)
- when the browser goes offline, a no-wifi indicator appears in the header action row instead of showing connectivity toasts
- if an offline view has no cached `/api/items` response yet, the list is replaced with `Offline and no cached items are available for this view yet.`
- when the browser comes back online, the no-wifi indicator disappears and the current view is re-fetched silently from `/api/items`
- reconnect refreshes backend-stored items only; it does not trigger upstream source refetches

### Reader settings dialog

- the configure button opens a `Reader settings` dialog
- settings are grouped into tabs:
  - `Appearance` — Theme and UI density
  - `Reading` — Article preview, bookmarks, and AI personalization
  - `Sources` — visible sources
- tabs support click, arrow keys, Home, and End; validation jumps to `Sources` or `Reading` when that tab needs attention
- themes are shown as a 2-column swatch grid; density options sit below in a 2-column row
- the selected theme is applied when the dialog is saved, and the settings form scrolls internally on short screens
- clicking the dialog backdrop closes it
- background page scrolling is locked while the dialog is open
- selected sources are stored in `localStorage` under `feedreader.sources`
- selected density is stored in `localStorage` under `feedreader.uiDensity`
- selected theme is stored in `localStorage` under `feedreader.theme`; valid values are `system` (default), `dark`, `light`, `sepia`, `terminal`, `glacier`, and `ember`
- `system` resolves to the device's current light/dark preference and follows changes live; existing `dark`/`light` preferences keep working
- an inline pre-paint theme init script applies the stored preference before first paint, avoiding a light/dark flash (the script is read from `web-static/static/theme-init.js` and inlined with the stylesheet)
- article preview is off by default and stored in `localStorage` under `feedreader.articlePreviewEnabled`
- bookmark controls are off by default and stored in `localStorage` under `feedreader.bookmarksEnabled`; enabling them shows the bookmark controls and Saved filter, and disabling them hides those controls without deleting saved items
- source-specific filters render as **real icon-only buttons**
- `For You` shows a sparkle icon with its label; in phone landscape while preview is open it collapses to the icon only
- the source dialog renders **real source icons** before each source name
- density options are:
  - `Comfortable` (default)
  - `Compact`
- if **2 or more** sources are enabled, the filter bar shows:
  - `All`
  - each enabled source
- if **exactly 1** source is enabled, the filter bar shows only that source
- the `All` view aggregates only over the enabled source set, not over disabled sources

### Article preview

- when enabled in Reader settings, clicking any card (including its title) loads a reader view in a right-hand panel instead of opening a new tab
- while the preview request is in flight, the panel keeps the card title and shows a preview skeleton after a short delay; the loaded title and content fade in, and a failed request replaces the skeleton with a readable error message
- transient upstream `429`/`5xx` responses are retried once with jitter; blocked sources, timeouts, unsupported formats, and failed fetches get specific messages
- the visible loading message is visually hidden while the skeleton is shown; the panel remains `aria-busy` and a live region announces the loading state
- `Cmd`/`Ctrl`/`Shift`-clicking a title still opens the article in a new tab
- the panel shows the extracted title, byline, publication date/reading time, rich text with validated inline links/emphasis/inline code, image blocks with captions and intrinsic dimensions, and semantic tables; images load directly from the source with lazy loading and no referrer; `Open source` opens the original page
- consecutive list items render as one list and prose uses the full preview width; figures are capped in height so a single image cannot dominate the panel
- previews are source-aware: GitHub README previews drop the `GitHub - ` title prefix and decorative SVG/badge images, while Hugging Face paper previews render the abstract, authors, arXiv/PDF/project/GitHub links, and citing model, dataset, space, and collection lists instead of community comment chrome
- Hacker News items also show a **Comments** action inside the preview and card `…` dialogs; other sources omit it
- each card’s `…` dialog includes an **Open source** action that opens the article directly without opening the preview
- **Share** uses the device/browser share sheet when available and falls back to copying the article link; it is available in both the card and preview `…` dialogs
- external links inside the preview open in a new tab with `noopener noreferrer` and no referrer
- the article currently being previewed is highlighted in the feed; the preview header shows the card’s stats/date metadata without repeating the title
- previous/next buttons at the bottom of the panel move through the currently rendered feed or Saved list; when the last rendered card is previewed, Next stays enabled if more pages exist and loads the next page before advancing
- previews are fetched by the Worker via `GET /api/preview?url=…`; only URLs already stored as feed items are accepted, and upstream HTML is never injected into the page
- successful previews are edge-cached for 30 minutes via the Cache API and browser-facing responses are `private, no-store`
- on screens wider than 900px the preview panel is an aside fixed on the right at about 65% of the width and 0.8rem top/bottom insets, with the bookmark, `…`, and Close controls in its header; the page keeps its normal scroll behavior
- at 900px or narrower the borderless panel covers the full viewport and the footer places the bookmark, `…`, and Close after Previous/Next (in both portrait and landscape). Above 900px the aside header holds the bookmark, `…`, and Close. The `…` button opens a settings-style dialog headed by the article title with its source icon/host and a close button, with the actions stacked as full-width rows over the standard backdrop (dismiss with the close button, backdrop, Escape, or by choosing an action). Content respects left/right safe-area insets in iPhone landscape; while the panel covers the viewport the `theme-color` tint matches the panel surface so the status-bar strip blends with it
- on phones, the glass preview header and footer slide away while scrolling down and return when scrolling up; the desktop aside keeps its chrome visible
- on phones, dragging right from the left screen edge drags the fullscreen preview with the finger and reveals the feed underneath; releasing past about 30% of the width (or a quick flick) closes the preview and returns to the same feed position, while a shorter drag springs back. Vertical drags from the edge still scroll the article, the gesture is ignored while the `…` dialog is open, and rotating cancels it. In a regular Safari tab the system edge-back gesture may take precedence; the app gesture is reliable in the installed PWA
- preview is available on every device; phones open the reader view full-screen, and the Reading option is always shown in Reader settings

### Bookmarks

- bookmark controls are off by default and can be enabled in Reader settings
- when enabled, every feed card has a bookmark toggle at the right of its host row; clicking it does not open the article
- when enabled, the preview panel header (aside layout) or footer (fullscreen layout) has the same toggle for the article currently open
- when enabled, a `Saved` filter at the end of the filter bar shows saved articles and their count; search filters the saved list locally
- bookmarks store a display snapshot (title, source, brief, host) in `localStorage` under `feedreader.bookmarks`, so they survive source pruning and offline use without a server API
- the list is capped at 500 entries; removing a bookmark updates the count and, while the Saved view is active, removes the card immediately
- disabling bookmarks hides the card and preview toggles plus the Saved filter, leaves the Saved view if it was active, and keeps saved items in `localStorage` for when the feature is re-enabled
- the per-card toggle is available on every device; the preview panel also exposes it while reading
- the bookmark toggle sits beside the card’s more-actions button; the preview panel header also exposes it while reading

---

## Roadmap

Potential next improvements:

- more sources (blogs, changelogs, newsletters, papers)
- server-side pagination
- source weighting and ranking controls
- more source-specific parsing fixtures
- export/import support

---

## Contributing

Contributions are welcome.

A good contribution flow:

1. fork the repository
2. create a branch
3. make changes
4. run verification locally
5. open a pull request

Example local verification:

```bash
npm run typecheck
npm test
npm run db:migrate:local
```

## CI/CD

- CI runs on pull requests and `main` pushes.
- CI checks type safety, unit tests, and a local D1 migration smoke run.
- Pull requests get a Cloudflare version preview commented on the PR.
- Non-`main` branch pushes get an automatic per-branch preview alias in the Actions run summary; branches with an open PR defer to the PR preview.
- Deploy runs on `main` pushes and manual dispatch.
- Deploy validates Cloudflare credentials, re-runs verification, applies remote D1 migrations, and deploys the Worker.

---

## Security

For security concerns, please email [hi@boringcode.dev](mailto:hi@boringcode.dev) instead of using the issue tracker. See [SECURITY.md](SECURITY.md) for more details.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## Repository hygiene

Generated runtime artifacts are intentionally ignored:

```gitignore
node_modules/
.wrangler/
.dev.vars
.envrc
*.log
```

This keeps the repository focused on source code, static assets, and documentation.
