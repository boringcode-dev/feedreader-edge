(() => {
  const root = document.documentElement;
  const availableSources = ["hackernews", "github", "huggingface"];
  const sourceLabels = {
    hackernews: "Hacker News",
    github: "GitHub Trending",
    huggingface: "Hugging Face Trending Papers",
  };
  const sourceIconPaths = {
    hackernews: "/static/source-icons/hackernews.svg",
    github: "/static/source-icons/github.svg",
    huggingface: "/static/source-icons/huggingface.svg",
  };
  const filterNav = document.querySelector("[data-filter-nav]");
  const controlsRow = document.querySelector("[data-controls-row]");
  const configOpenButton = document.querySelector("[data-source-config-open]");
  const configDialog = document.querySelector("[data-source-config-dialog]");
  const configCloseButtons = Array.from(
    document.querySelectorAll(
      "[data-source-config-close], [data-source-config-cancel]",
    ),
  );
  const configSaveButton = document.querySelector("[data-source-config-save]");
  const configOptions = Array.from(
    document.querySelectorAll("[data-source-option]"),
  );
  const densityOptions = Array.from(
    document.querySelectorAll("[data-density-option]"),
  );
  const themeOptions = Array.from(
    document.querySelectorAll("[data-theme-option]"),
  );
  const aiPersonalizationToggle = document.querySelector(
    "[data-ai-personalization-toggle]",
  );
  const interestsInput = document.querySelector("[data-interests-input]");
  const articlePreviewToggle = document.querySelector(
    "[data-article-preview-toggle]",
  );
  const pageBody = document.querySelector("[data-page-body]");
  const previewPanel = document.querySelector("[data-preview-panel]");
  const previewCloseButton = document.querySelector("[data-preview-close]");
  const previewScroll = document.querySelector("[data-preview-scroll]");
  const previewTitle = document.querySelector("[data-preview-title]");
  const previewByline = document.querySelector("[data-preview-byline]");
  const previewReadingMeta = document.querySelector(
    "[data-preview-reading-meta]",
  );
  const previewStatus = document.querySelector("[data-preview-status]");
  const previewContent = document.querySelector("[data-preview-content]");
  const previewOpenLink = document.querySelector("[data-preview-open]");
  const previewCommentsLink = document.querySelector("[data-preview-comments]");
  const previewSourceIcon = document.querySelector("[data-preview-source-icon]");
  const previewSourceLabel = document.querySelector(
    "[data-preview-source-label]",
  );
  const previewMeta = document.querySelector("[data-preview-meta]");
  const previewPrevButton = document.querySelector("[data-preview-prev]");
  const previewNextButton = document.querySelector("[data-preview-next]");
  const previewBookmarkButton = document.querySelector(
    "[data-preview-bookmark]",
  );
  const personalizedIndicator = document.querySelector(
    "[data-personalized-indicator]",
  );
  const connectionIndicator = document.querySelector(
    "[data-connection-indicator]",
  );
  const cardsGrid = document.querySelector("[data-card-grid]");
  const emptyState = document.querySelector("[data-empty-state]");
  const footerActions = document.querySelector("[data-footer-actions]");
  const viewMoreButton = document.querySelector("[data-view-more]");
  const searchToggle = document.querySelector("[data-search-toggle]");
  const searchForm = document.querySelector("[data-search-form]");
  const searchInput = document.querySelector("[data-search-input]");
  const searchSourceInput = document.querySelector("[data-search-source]");
  const refreshButton = document.querySelector("[data-refresh-button]");
  const themeToggle = document.querySelector("[data-theme-toggle]");
  const installButton = document.querySelector("[data-install-button]");
  const installDialog = document.querySelector("[data-install-dialog]");
  const installDialogCloseButtons = Array.from(
    document.querySelectorAll("[data-install-dialog-close]"),
  );
  const installConfirmButton = document.querySelector(
    "[data-install-dialog-confirm]",
  );
  const installDialogHideButton = document.querySelector(
    "[data-install-dialog-hide]",
  );
  const installSteps = document.querySelector("[data-install-steps]");
  const installScreenshotMobile = document.querySelector(
    "[data-install-screenshot-mobile]",
  );
  const installScreenshotTablet = document.querySelector(
    "[data-install-screenshot-tablet]",
  );
  const installScreenshotDesktop = document.querySelector(
    "[data-install-screenshot-desktop]",
  );
  const toast = document.querySelector("[data-toast]");
  const updateButton = document.querySelector("[data-update-button]");
  const pageSize = Number(cardsGrid?.dataset.pageSize || 12);
  const searchDebounceMs = 1100;
  const sourceConfigStorageKey = "feedreader.sources";
  const densityConfigStorageKey = "feedreader.uiDensity";
  const visitedLinksStorageKey = "feedreader.visited";
  const visitedLinksLimit = 500;
  const bookmarksStorageKey = "feedreader.bookmarks";
  const bookmarksLimit = 500;
  const themeStorageKey = "feedreader.theme";
  const interestsStorageKey = "feedreader.interests";
  const aiPersonalizationStorageKey = "feedreader.aiPersonalizationEnabled";
  const articlePreviewStorageKey = "feedreader.articlePreviewEnabled";
  const interestsMaxLength = 300;
  const defaultInterests =
    "startups, engineering, open-source, Artificial Intelligence (AI), Machine Learning (ML)";
  const installPromptHiddenStorageKey = "feedreader.installPromptHidden";
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  const loadedAppVersion = document.body.dataset.appVersion || "";
  const updateCheckIntervalMs = 15 * 60 * 1000;

  const initialView = new URL(window.location.href).searchParams.get("view");
  let activeFilter =
    initialView === "saved"
      ? "saved"
      : cardsGrid?.dataset.currentSource || "all";
  let selectedSources = loadSelectedSources();
  let uiDensity = loadUIDensity();
  let visitedLinks = loadVisitedLinks();
  let bookmarks = loadBookmarks();
  let interests = loadInterests();
  let aiPersonalizationEnabled = interests !== "" && loadAiPersonalizationEnabled();
  let articlePreviewEnabled = loadArticlePreviewEnabled();
  let personalizedActive = false;
  let installPromptHidden = loadInstallPromptHidden();
  let activeQuery = (searchInput?.value || "").trim();
  let searchOpen = Boolean(activeQuery);
  let loadedCount = cardsGrid
    ? cardsGrid.querySelectorAll(".item-card").length
    : 0;
  let hasNext = cardsGrid?.dataset.hasNext === "true";
  let searchTimer = null;
  let ignoreNextEmptySearchInput = false;
  let requestSequence = 0;
  let refreshInFlight = false;
  let feedLoading = false;
  let feedLoadingMode = "";
  let activeToastKind = "";
  let browserOnline = navigator.onLine;
  let offlineViewUnavailable = false;
  let reconnectRefetchInFlight = false;
  let deferredInstallPrompt = null;
  let previewRequestSequence = 0;
  let previewAbortController = null;
  let currentPreviewItem = null;

  function emptyMessageForState({ source, query }) {
    if (offlineViewUnavailable) {
      return "Offline and no cached items are available for this view yet.";
    }
    if (source === "saved") {
      return query
        ? "No saved articles match your search."
        : "No saved articles yet. Tap the bookmark icon on any card to save it for later.";
    }
    if (query) {
      if (source && source !== "all") {
        return `No matches found in ${sourceLabels[source] || "this source"}. Try a different query.`;
      }
      return "No matches found. Try a different query.";
    }
    if (source && source !== "all") {
      return `No items found in ${sourceLabels[source] || "this source"} right now.`;
    }
    return "No items yet. The scheduler will populate the feed automatically.";
  }

  const bookmarkIcons = `<svg class="bookmark-icon bookmark-icon--outline" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/></svg><svg class="bookmark-icon bookmark-icon--filled" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z" fill="currentColor"/></svg>`;

  const cardTemplate = (item) => `
    <article class="item-card" data-source="${escapeHtml(item.source || "")}" data-comments-url="${escapeAttr(item.comments_url || "")}">
      <h2 class="item-title">
        <span class="item-index">${escapeHtml(item.index ?? "")}.</span>
        <a href="${escapeAttr(item.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(item.title || "")}</a>
      </h2>
      ${item.brief ? `<p class="item-brief"${item.brief_prefix ? ` data-brief-prefix="${escapeAttr(item.brief_prefix)}"` : ""}${item.brief_suffix ? ` data-brief-suffix="${escapeAttr(item.brief_suffix)}"` : ""}${item.brief_date_iso ? ` data-brief-date-iso="${escapeAttr(item.brief_date_iso)}" data-brief-date-kind="${escapeAttr(item.brief_date_kind || "")}"` : ""}><span class="item-brief-text">${escapeHtml(item.brief)}</span></p>` : ""}
      <p class="item-host"><img class="source-icon-image source-icon-image--host source-icon-image--${escapeAttr(item.source || "")}" src="${escapeAttr(sourceIconPaths[item.source] || "")}" alt="" aria-hidden="true" /><span class="item-host-text">${escapeHtml(item.host || hostLabel(item.url || ""))}</span><button class="item-bookmark" type="button" data-bookmark-toggle aria-label="Save for later" title="Save for later" aria-pressed="false">${bookmarkIcons}</button></p>
    </article>
  `;

  const browserLocales =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || "en-US"];

  function formatLocalizedBriefDate(dateISO, dateKind) {
    if (!dateISO || !dateKind) return "";
    const parsed = new Date(dateISO);
    if (Number.isNaN(parsed.getTime())) return "";
    const label =
      dateKind === "published"
        ? "Published"
        : dateKind === "fetched"
          ? "Fetched"
          : "";
    if (!label) return "";
    const formattedDate = new Intl.DateTimeFormat(browserLocales, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(parsed);
    return `${label} ${formattedDate}`;
  }

  function composeBriefText({ prefix, dateISO, dateKind, suffix }) {
    const prefixParts = [];
    if (prefix) {
      prefixParts.push(prefix);
    }
    const localizedDate = formatLocalizedBriefDate(dateISO, dateKind);
    if (localizedDate) {
      prefixParts.push(localizedDate);
    }
    const leading = prefixParts.join(" · ");
    if (suffix) {
      return leading ? `${leading} - ${suffix}` : suffix;
    }
    return leading;
  }

  function localizeBriefDates(scope = document) {
    scope.querySelectorAll?.(".item-brief").forEach((brief) => {
      const dateISO = brief.dataset.briefDateIso || "";
      const dateKind = brief.dataset.briefDateKind || "";
      if (!dateISO || !dateKind) return;
      const prefix = brief.dataset.briefPrefix || "";
      const suffix = brief.dataset.briefSuffix || "";
      const localized = composeBriefText({
        prefix,
        dateISO,
        dateKind,
        suffix,
      });
      if (!localized) return;
      const textNode = brief.querySelector(".item-brief-text");
      if (textNode) {
        textNode.textContent = localized;
      } else {
        brief.textContent = localized;
      }
    });
  }

  function normalizeSelectedSources(rawValue) {
    const values = Array.isArray(rawValue) ? rawValue : [];
    const seen = new Set();
    return values.filter((value) => {
      if (!availableSources.includes(value) || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function normalizeUIDensity(rawValue) {
    return rawValue === "compact" ? "compact" : "current";
  }

  function normalizeVisitedHref(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) return "";
    try {
      return new URL(value, window.location.origin).toString();
    } catch {
      return value;
    }
  }

  function loadVisitedLinks() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(visitedLinksStorageKey) || "null",
      );
      const values = Array.isArray(parsed) ? parsed : [];
      const seen = new Set();
      return values
        .map((value) => normalizeVisitedHref(value))
        .filter((value) => {
          if (!value || seen.has(value)) return false;
          seen.add(value);
          return true;
        })
        .slice(-visitedLinksLimit);
    } catch {
      return [];
    }
  }

  function persistVisitedLinks() {
    localStorage.setItem(
      visitedLinksStorageKey,
      JSON.stringify(visitedLinks.slice(-visitedLinksLimit)),
    );
  }

  function applyVisitedLinkState() {
    if (!cardsGrid) return;
    const visitedSet = new Set(visitedLinks);
    cardsGrid.querySelectorAll(".item-title a").forEach((link) => {
      const normalized = normalizeVisitedHref(link.href);
      link.classList.toggle(
        "is-visited",
        normalized !== "" && visitedSet.has(normalized),
      );
    });
  }

  function rememberVisitedLink(rawHref) {
    const href = normalizeVisitedHref(rawHref);
    if (!href) return;
    const next = visitedLinks.filter((value) => value !== href);
    next.push(href);
    visitedLinks = next.slice(-visitedLinksLimit);
    persistVisitedLinks();
    applyVisitedLinkState();
  }

  function normalizeBookmark(raw) {
    if (!raw || typeof raw !== "object") return null;
    const url = normalizeVisitedHref(raw.url);
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!url || !title) return null;
    return {
      url,
      title,
      source: typeof raw.source === "string" ? raw.source : "",
      commentsUrl:
        typeof raw.commentsUrl === "string" && isHttpUrl(raw.commentsUrl)
          ? normalizeVisitedHref(raw.commentsUrl)
          : "",
      brief: typeof raw.brief === "string" ? raw.brief.trim() : "",
      host: typeof raw.host === "string" ? raw.host.trim() : "",
      savedAt:
        typeof raw.savedAt === "string"
          ? raw.savedAt
          : new Date(0).toISOString(),
    };
  }

  function loadBookmarks() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(bookmarksStorageKey) || "null",
      );
      if (!Array.isArray(parsed)) return [];
      const seen = new Set();
      return parsed
        .map(normalizeBookmark)
        .filter((bookmark) => {
          if (!bookmark || seen.has(bookmark.url)) return false;
          seen.add(bookmark.url);
          return true;
        })
        .slice(-bookmarksLimit);
    } catch {
      return [];
    }
  }

  function persistBookmarks() {
    localStorage.setItem(
      bookmarksStorageKey,
      JSON.stringify(bookmarks.slice(-bookmarksLimit)),
    );
  }

  function isBookmarked(rawUrl) {
    const url = normalizeVisitedHref(rawUrl);
    if (!url) return false;
    return bookmarks.some((bookmark) => bookmark.url === url);
  }

  function cardDataFromCard(card) {
    const link = card?.querySelector(".item-title a");
    if (!link) return null;
    const url = normalizeVisitedHref(link.getAttribute("href") || "");
    const title = (link.textContent || "").trim();
    if (!url || !title) return null;
    const brief = (card.querySelector(".item-brief-text")?.textContent || "").trim();
    const separatorIndex = brief.indexOf(" - ");
    return {
      url,
      title,
      source: card.dataset.source || "",
      commentsUrl: card.dataset.commentsUrl || "",
      brief,
      briefMeta:
        separatorIndex >= 0
          ? brief.slice(0, separatorIndex).trim()
          : brief,
      host: (card.querySelector(".item-host-text")?.textContent || "").trim(),
    };
  }

  function bookmarkDataFromCard(card) {
    const data = cardDataFromCard(card);
    return data
      ? {
          url: data.url,
          title: data.title,
          source: data.source,
          commentsUrl: data.commentsUrl,
          brief: data.brief,
          host: data.host,
          savedAt: new Date().toISOString(),
        }
      : null;
  }

  function toggleBookmark(data) {
    const url = normalizeVisitedHref(data?.url);
    if (!url) return false;
    const index = bookmarks.findIndex((bookmark) => bookmark.url === url);
    let saved;
    if (index >= 0) {
      bookmarks.splice(index, 1);
      saved = false;
    } else {
      bookmarks.push({
        ...data,
        url,
        savedAt: data.savedAt || new Date().toISOString(),
      });
      if (bookmarks.length > bookmarksLimit) {
        bookmarks = bookmarks.slice(-bookmarksLimit);
      }
      saved = true;
    }
    persistBookmarks();
    applyBookmarkState();
    renderFilters();
    if (activeFilter === "saved") {
      renderSavedFeed({ query: activeQuery });
    }
    return saved;
  }

  function toggleBookmarkFromCard(card) {
    const data = bookmarkDataFromCard(card);
    if (!data) return;
    const saved = toggleBookmark(data);
    showToast(saved ? "Saved for later" : "Removed from saved");
  }

  function savedMatchesQuery(bookmark, query) {
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (terms.length === 0) return true;
    const haystack = [
      bookmark.title,
      bookmark.brief,
      bookmark.host,
      sourceLabels[bookmark.source] || bookmark.source,
      bookmark.url,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  function applyBookmarkState() {
    if (cardsGrid) {
      cardsGrid.querySelectorAll(".item-card").forEach((card) => {
        const link = card.querySelector(".item-title a");
        const button = card.querySelector("[data-bookmark-toggle]");
        if (!link || !button) return;
        const saved = isBookmarked(link.getAttribute("href") || "");
        button.classList.toggle("is-saved", saved);
        button.setAttribute("aria-pressed", String(saved));
        const label = saved ? "Remove from saved" : "Save for later";
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
      });
    }
    if (previewBookmarkButton) {
      const saved = currentPreviewItem
        ? isBookmarked(currentPreviewItem.url)
        : false;
      previewBookmarkButton.classList.toggle("is-saved", saved);
      previewBookmarkButton.setAttribute("aria-pressed", String(saved));
      const label = saved ? "Remove from saved" : "Save for later";
      previewBookmarkButton.setAttribute("aria-label", label);
      previewBookmarkButton.setAttribute("title", label);
      previewBookmarkButton.disabled = !currentPreviewItem;
    }
  }

  function previewCardIndex() {
    if (!currentPreviewItem || !cardsGrid) return -1;
    const cards = Array.from(cardsGrid.querySelectorAll(".item-card"));
    return cards.findIndex((card) => {
      const link = card.querySelector(".item-title a");
      return (
        link &&
        normalizeVisitedHref(link.getAttribute("href") || "") ===
          currentPreviewItem.url
      );
    });
  }

  function applyPreviewActiveCardState() {
    if (!cardsGrid) return;
    const activeUrl = currentPreviewItem?.url || "";
    cardsGrid.querySelectorAll(".item-card").forEach((card) => {
      const link = card.querySelector(".item-title a");
      const isActive =
        activeUrl !== "" &&
        link &&
        normalizeVisitedHref(link.getAttribute("href") || "") === activeUrl;
      card.classList.toggle("is-previewing", Boolean(isActive));
    });
  }

  function updatePreviewNavigation() {
    const cardCount = cardsGrid
      ? cardsGrid.querySelectorAll(".item-card").length
      : 0;
    const index = previewCardIndex();
    if (previewPrevButton) {
      previewPrevButton.disabled = index <= 0;
    }
    if (previewNextButton) {
      previewNextButton.disabled = index < 0 || index >= cardCount - 1;
    }
  }

  function navigatePreview(direction) {
    if (!currentPreviewItem || !cardsGrid) return;
    const cards = Array.from(cardsGrid.querySelectorAll(".item-card"));
    const index = previewCardIndex();
    if (index < 0) return;
    const targetCard = cards[index + direction];
    if (!targetCard) return;
    const data = cardDataFromCard(targetCard);
    if (!data) return;
    rememberVisitedLink(data.url);
    openArticlePreview(data);
    targetCard.scrollIntoView({ block: "nearest" });
  }

  function loadSelectedSources() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(sourceConfigStorageKey) || "null",
      );
      const normalized = normalizeSelectedSources(parsed);
      return normalized.length > 0 ? normalized : [...availableSources];
    } catch {
      return [...availableSources];
    }
  }

  function loadUIDensity() {
    try {
      return normalizeUIDensity(
        localStorage.getItem(densityConfigStorageKey) || "current",
      );
    } catch {
      return "current";
    }
  }

  function persistSelectedSources() {
    localStorage.setItem(
      sourceConfigStorageKey,
      JSON.stringify(selectedSources),
    );
  }

  function persistUIDensity() {
    localStorage.setItem(densityConfigStorageKey, uiDensity);
  }

  function loadInterests() {
    try {
      const stored = localStorage.getItem(interestsStorageKey);
      return stored === null ? defaultInterests : stored.trim();
    } catch {
      return defaultInterests;
    }
  }

  function persistInterests(next) {
    localStorage.setItem(interestsStorageKey, next);
  }

  function loadAiPersonalizationEnabled() {
    try {
      return localStorage.getItem(aiPersonalizationStorageKey) === "true";
    } catch {
      return false;
    }
  }

  function persistAiPersonalizationEnabled(next) {
    localStorage.setItem(aiPersonalizationStorageKey, next ? "true" : "false");
  }

  function loadArticlePreviewEnabled() {
    try {
      return localStorage.getItem(articlePreviewStorageKey) === "true";
    } catch {
      return false;
    }
  }

  function persistArticlePreviewEnabled(next) {
    localStorage.setItem(articlePreviewStorageKey, next ? "true" : "false");
  }

  function loadInstallPromptHidden() {
    try {
      return localStorage.getItem(installPromptHiddenStorageKey) === "true";
    } catch {
      return false;
    }
  }

  function persistInstallPromptHidden() {
    localStorage.setItem(installPromptHiddenStorageKey, "true");
  }

  function syncThemeOptions() {
    themeOptions.forEach((option) => {
      option.checked = option.value === root.dataset.theme;
    });
  }

  function currentThemeSelection() {
    return themeOptions.find((option) => option.checked)?.value || "dark";
  }

  function syncDialogOpenState(isOpen) {
    root.classList.toggle("is-dialog-open", isOpen);
    document.body.classList.toggle("is-dialog-open", isOpen);
  }

  function applyUIDensity(nextDensity, { persist = true } = {}) {
    uiDensity = normalizeUIDensity(nextDensity);
    if (uiDensity === "current") {
      root.removeAttribute("data-ui-density");
    } else {
      root.dataset.uiDensity = uiDensity;
    }
    if (persist) {
      persistUIDensity();
    }
  }

  function shouldRestrictAllSources() {
    return (
      selectedSources.length > 0 &&
      selectedSources.length < availableSources.length
    );
  }

  function visibleFilterKeys() {
    const keys =
      selectedSources.length > 1
        ? ["all", ...selectedSources]
        : [...selectedSources];
    return [...keys, "saved"];
  }

  function personalizationConfigured() {
    return aiPersonalizationEnabled && interests !== "";
  }

  function shouldShowPersonalized() {
    return (
      activeFilter === "all" && personalizationConfigured() && !activeQuery
    );
  }

  function renderFilters() {
    if (!filterNav) return;
    const keys = visibleFilterKeys();
    filterNav.innerHTML = keys
      .map((key) => {
        const isActive = key === activeFilter;
        if (key === "all") {
          return `<button class="filter-button${isActive ? " is-active" : ""}" type="button" data-filter="${key}" aria-pressed="${String(isActive)}" aria-label="For You" title="For You">For You</button>`;
        }
        if (key === "saved") {
          const count = bookmarks.length;
          const label =
            count > 0 ? `Saved articles (${count})` : "Saved articles";
          return `<button class="filter-button filter-button--saved${isActive ? " is-active" : ""}" type="button" data-filter="saved" aria-pressed="${String(isActive)}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${bookmarkIcons}${count > 0 ? `<span class="filter-badge">${count}</span>` : ""}</button>`;
        }
        return `<button class="filter-button filter-button--icon${isActive ? " is-active" : ""}" type="button" data-filter="${key}" aria-pressed="${String(isActive)}" aria-label="${escapeAttr(sourceLabels[key] || key)}" title="${escapeAttr(sourceLabels[key] || key)}"><img class="source-icon-image source-icon-image--filter source-icon-image--${escapeAttr(key)}" src="${escapeAttr(sourceIconPaths[key] || "")}" alt="" aria-hidden="true" /></button>`;
      })
      .join(""); // Fixed local source definitions only; all interpolated values are escaped above.
  }

  function renderPersonalizedIndicator() {
    if (!personalizedIndicator) return;
    personalizedIndicator.classList.toggle("is-hidden", !personalizedActive);
  }

  function syncConfigOptions() {
    configOptions.forEach((option) => {
      option.checked = selectedSources.includes(option.value);
    });
  }

  function syncPersonalizationOptions() {
    if (aiPersonalizationToggle) {
      aiPersonalizationToggle.checked = aiPersonalizationEnabled;
    }
    if (interestsInput) {
      interestsInput.value = interests;
    }
  }

  function syncArticlePreviewOption() {
    if (articlePreviewToggle) {
      articlePreviewToggle.checked = articlePreviewEnabled;
    }
  }

  function syncDensityOptions() {
    densityOptions.forEach((option) => {
      option.checked = option.value === uiDensity;
    });
  }

  function currentSourceSelection() {
    return configOptions
      .filter((option) => option.checked)
      .map((option) => option.value);
  }

  function currentDensitySelection() {
    return densityOptions.find((option) => option.checked)?.value || "current";
  }

  function ensureActiveFilterIsVisible() {
    const visibleKeys = visibleFilterKeys();
    if (!visibleKeys.includes(activeFilter)) {
      activeFilter = visibleKeys[0] || "all";
    }
  }

  const renderConnectionIndicator = () => {
    if (!connectionIndicator) return;
    connectionIndicator.classList.toggle("is-hidden", browserOnline);
    connectionIndicator.setAttribute("aria-hidden", String(browserOnline));
  };

  const syncConnectivityState = () => {
    browserOnline = navigator.onLine;
    renderConnectionIndicator();
  };

  const showUpdateButton = () => {
    updateButton?.classList.remove("is-hidden");
  };

  let checkingForUpdate = false;
  const checkForUpdate = async () => {
    if (!loadedAppVersion || checkingForUpdate) return;
    checkingForUpdate = true;
    try {
      const response = await fetch("/api/version", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.version && payload.version !== loadedAppVersion) {
        showUpdateButton();
      }
    } catch {
      // Offline or request failed — try again on the next visibility/focus
      // event rather than erroring the page.
    } finally {
      checkingForUpdate = false;
    }
  };

  const renderViewMore = () => {
    const showActions = loadedCount > 0;
    if (footerActions) {
      footerActions.classList.toggle("is-hidden", !showActions);
    }
    if (!viewMoreButton) return;
    const showButton = hasNext && loadedCount > 0;
    const loadingMore = feedLoading && feedLoadingMode === "append";
    viewMoreButton.hidden = !showButton;
    viewMoreButton.disabled = !showButton || refreshInFlight || feedLoading;
    viewMoreButton.textContent = loadingMore ? "Loading…" : "View more";
  };

  const renderFeedBody = () => {
    if (cardsGrid) {
      const showCards = loadedCount > 0;
      cardsGrid.classList.toggle("is-hidden", !showCards);
      cardsGrid.classList.toggle(
        "is-loading",
        feedLoading && feedLoadingMode !== "append" && showCards,
      );
      cardsGrid.setAttribute("aria-busy", String(feedLoading));
    }
    if (emptyState) {
      emptyState.textContent = emptyMessageForState({
        source: activeFilter,
        query: activeQuery,
      });
      emptyState.classList.toggle("is-hidden", feedLoading || loadedCount > 0);
    }
    renderViewMore();
  };

  const setFeedLoading = (
    active,
    { mode = "replace", message = "", showLoadingToast = true } = {},
  ) => {
    feedLoading = active;
    feedLoadingMode = active ? mode : "";
    if (active) {
      if (showLoadingToast) {
        showToast(message, "loading", { persistent: true });
      }
    } else if (showLoadingToast) {
      hideToast({ onlyKind: "loading" });
    }
    renderFeedBody();
  };

  const renderSearch = () => {
    const isVisible = searchOpen || Boolean(activeQuery);
    if (searchForm) {
      searchForm.classList.toggle("is-open", isVisible);
      searchForm.setAttribute("aria-hidden", String(!isVisible));
    }
    if (searchInput) {
      searchInput.disabled = !isVisible;
      if (isVisible) {
        searchInput.removeAttribute("tabindex");
      } else {
        searchInput.setAttribute("tabindex", "-1");
      }
    }
    if (searchToggle) {
      searchToggle.classList.toggle("is-active", isVisible);
      searchToggle.setAttribute("aria-expanded", String(isVisible));
      searchToggle.setAttribute(
        "aria-label",
        isVisible ? "Close search" : "Search feed",
      );
      searchToggle.setAttribute(
        "title",
        isVisible ? "Close search" : "Search feed",
      );
    }
    if (searchSourceInput) {
      searchSourceInput.value =
        activeFilter === "all" || activeFilter === "saved"
          ? ""
          : activeFilter;
    }
    if (controlsRow) {
      controlsRow.classList.toggle("is-search-active", isVisible);
    }
  };

  const updateURL = () => {
    const url = new URL(window.location.href);
    if (activeFilter === "saved") {
      url.searchParams.set("view", "saved");
      url.searchParams.delete("source");
    } else {
      url.searchParams.delete("view");
      if (activeFilter === "all") {
        url.searchParams.delete("source");
      } else {
        url.searchParams.set("source", activeFilter);
      }
    }
    if (activeQuery) {
      url.searchParams.set("q", activeQuery);
    } else {
      url.searchParams.delete("q");
    }
    history.replaceState({}, "", `${url.pathname}${url.search}`);
  };

  let toastTimer = null;
  const hideToast = ({ onlyKind } = {}) => {
    if (!toast) return;
    if (onlyKind && activeToastKind !== onlyKind) {
      return;
    }
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toast.classList.remove(
      "is-visible",
      "is-error",
      "is-loading",
      "is-offline",
    );
    toast.textContent = "";
    activeToastKind = "";
  };

  const showToast = (
    message,
    kind = "success",
    { persistent = false } = {},
  ) => {
    if (!toast) return;
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toast.textContent = message;
    toast.classList.toggle("is-error", kind === "error");
    toast.classList.toggle("is-loading", kind === "loading");
    toast.classList.toggle("is-offline", kind === "offline");
    toast.classList.add("is-visible");
    activeToastKind = kind;
    if (persistent) {
      return;
    }
    toastTimer = window.setTimeout(() => {
      hideToast();
    }, 2200);
  };

  function isHttpUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  const setPreviewStatus = (message, { hidden = false } = {}) => {
    if (!previewStatus) return;
    previewStatus.textContent = hidden ? "" : message;
    previewStatus.classList.toggle("is-hidden", hidden);
  };

  const setPreviewSource = (source, host) => {
    const label = sourceLabels[source] || source || "";
    if (previewSourceLabel) {
      previewSourceLabel.textContent = host ? `${label} · ${host}` : label;
    }
    if (previewSourceIcon) {
      const iconPath = sourceIconPaths[source] || "";
      previewSourceIcon.src = iconPath;
      previewSourceIcon.classList.toggle("is-hidden", iconPath === "");
    }
  };

  const setPreviewCommentsLink = (rawUrl) => {
    if (!previewCommentsLink) return;
    const target =
      typeof rawUrl === "string" && isHttpUrl(rawUrl)
        ? normalizeVisitedHref(rawUrl)
        : "";
    previewCommentsLink.href = target || "#";
    previewCommentsLink.classList.toggle("is-hidden", target === "");
    if (target === "") {
      previewCommentsLink.setAttribute("aria-hidden", "true");
      previewCommentsLink.setAttribute("tabindex", "-1");
    } else {
      previewCommentsLink.removeAttribute("aria-hidden");
      previewCommentsLink.removeAttribute("tabindex");
    }
  };

  const renderPreviewSegmentMarks = (segment) => {
    let node = document.createTextNode(segment.text);
    const wrappers = [];
    if (segment.code) wrappers.push("code");
    if (segment.em) wrappers.push("em");
    if (segment.strong) wrappers.push("strong");
    for (const tagName of wrappers) {
      const wrapper = document.createElement(tagName);
      wrapper.appendChild(node);
      node = wrapper;
    }
    return node;
  };

  const renderPreviewSegments = (container, segments) => {
    let index = 0;
    while (index < segments.length) {
      const segment = segments[index];
      if (
        !segment ||
        typeof segment.text !== "string" ||
        segment.text === ""
      ) {
        index += 1;
        continue;
      }
      if (!segment.href || !isHttpUrl(segment.href)) {
        container.appendChild(renderPreviewSegmentMarks(segment));
        index += 1;
        continue;
      }

      const anchor = document.createElement("a");
      anchor.href = segment.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.referrerPolicy = "no-referrer";
      while (index < segments.length) {
        const current = segments[index];
        if (
          !current ||
          current.href !== segment.href ||
          typeof current.text !== "string" ||
          current.text === ""
        ) {
          break;
        }
        anchor.appendChild(renderPreviewSegmentMarks(current));
        index += 1;
      }
      container.appendChild(anchor);
    }
  };

  const renderPreviewTable = (block) => {
    const rows = Array.isArray(block.rows)
      ? block.rows.filter((row) => Array.isArray(row))
      : [];
    if (rows.length === 0) return null;

    const wrap = document.createElement("div");
    wrap.className = "preview-panel-table-wrap";
    const table = document.createElement("table");
    table.className = "preview-panel-table";
    const appendRow = (parent, cells, tagName) => {
      const row = document.createElement("tr");
      for (const cell of cells) {
        const element = document.createElement(tagName);
        if (tagName === "th") element.scope = "col";
        element.textContent = typeof cell === "string" ? cell : "";
        row.appendChild(element);
      }
      parent.appendChild(row);
    };

    if (block.header === true) {
      const thead = document.createElement("thead");
      appendRow(thead, rows[0], "th");
      table.appendChild(thead);
    }
    const tbody = document.createElement("tbody");
    for (const row of block.header === true ? rows.slice(1) : rows) {
      appendRow(tbody, row, "td");
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  };

  const renderPreviewBlocks = (blocks) => {
    if (!previewContent) return;
    previewContent.replaceChildren();
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "image") {
        if (typeof block.src !== "string" || !isHttpUrl(block.src)) continue;
        const figure = document.createElement("figure");
        figure.className = "preview-panel-figure";
        const image = document.createElement("img");
        image.className = "preview-panel-image";
        image.alt = typeof block.alt === "string" ? block.alt : "";
        image.loading = "lazy";
        image.decoding = "async";
        if (
          Number.isFinite(block.width) &&
          Number.isFinite(block.height) &&
          block.width > 0 &&
          block.height > 0
        ) {
          image.setAttribute("width", String(Math.round(block.width)));
          image.setAttribute("height", String(Math.round(block.height)));
        }
        // Server-validated public http(s) URLs only; direct loading is
        // intentional (no image proxy). No-referrer keeps the reader URL out
        // of the image request.
        image.referrerPolicy = "no-referrer";
        image.addEventListener("load", () => {
          if (
            image.naturalWidth > 0 &&
            image.naturalWidth < 32 &&
            image.naturalHeight < 32
          ) {
            figure.remove();
          }
        }, { once: true });
        image.addEventListener("error", () => figure.remove(), { once: true });
        image.src = block.src;
        figure.appendChild(image);
        const caption =
          typeof block.caption === "string" ? block.caption.trim() : "";
        if (caption !== "") {
          const figcaption = document.createElement("figcaption");
          figcaption.className = "preview-panel-caption";
          figcaption.textContent = caption;
          figure.appendChild(figcaption);
        }
        previewContent.appendChild(figure);
        continue;
      }
      if (block.type === "table") {
        const table = renderPreviewTable(block);
        if (table) previewContent.appendChild(table);
        continue;
      }

      const tagName =
        block.type === "heading"
          ? "h3"
          : block.type === "quote"
            ? "blockquote"
            : block.type === "code"
              ? "pre"
              : "p";
      const element = document.createElement(tagName);
      if (block.type === "list") {
        element.classList.add("preview-panel-list");
      }
      if (Array.isArray(block.segments)) {
        renderPreviewSegments(element, block.segments);
        if (element.childNodes.length === 0) continue;
      } else {
        if (typeof block.text !== "string" || block.text === "") continue;
        element.textContent = block.text;
      }
      previewContent.appendChild(element);
    }
  };

  const resetPreviewPanel = () => {
    previewPanel?.classList.add("is-hidden");
    currentPreviewItem = null;
    pageBody?.classList.remove("is-preview-open");
    document.body.classList.remove("is-preview-open");
    previewContent?.replaceChildren();
    if (previewByline) {
      previewByline.textContent = "";
      previewByline.classList.add("is-hidden");
    }
    if (previewReadingMeta) {
      previewReadingMeta.textContent = "";
      previewReadingMeta.classList.add("is-hidden");
    }
    if (previewTitle) {
      previewTitle.textContent = "Article preview";
    }
    if (previewOpenLink) {
      previewOpenLink.href = "#";
    }
    setPreviewCommentsLink("");
    if (previewMeta) {
      previewMeta.textContent = "";
      previewMeta.classList.add("is-hidden");
    }
    setPreviewStatus("Select an article to preview it here.");
    applyBookmarkState();
    applyPreviewActiveCardState();
    updatePreviewNavigation();
  };

  const closeArticlePreview = () => {
    previewRequestSequence += 1;
    previewAbortController?.abort();
    previewAbortController = null;
    resetPreviewPanel();
  };

  const openArticlePreview = ({
    url,
    title,
    source,
    host,
    brief,
    briefMeta,
    commentsUrl,
  }) => {
    if (!url || !isHttpUrl(url) || !previewPanel) {
      return;
    }

    currentPreviewItem = {
      url: normalizeVisitedHref(url),
      title,
      source,
      host,
      brief,
      commentsUrl,
    };
    applyBookmarkState();
    applyPreviewActiveCardState();
    updatePreviewNavigation();
    if (previewMeta) {
      const metaText = typeof briefMeta === "string" ? briefMeta.trim() : "";
      previewMeta.textContent = metaText;
      previewMeta.classList.toggle("is-hidden", metaText === "");
    }

    previewRequestSequence += 1;
    const requestId = previewRequestSequence;
    previewAbortController?.abort();
    const controller = new AbortController();
    previewAbortController = controller;

    previewPanel.classList.remove("is-hidden");
    previewPanel.setAttribute("aria-busy", "true");
    pageBody?.classList.add("is-preview-open");
    document.body.classList.add("is-preview-open");
    setPreviewSource(source, host);
    setPreviewCommentsLink(commentsUrl);
    if (previewTitle) {
      previewTitle.textContent = title || "Article preview";
    }
    if (previewByline) {
      previewByline.textContent = "";
      previewByline.classList.add("is-hidden");
    }
    if (previewReadingMeta) {
      previewReadingMeta.textContent = "";
      previewReadingMeta.classList.add("is-hidden");
    }
    if (previewOpenLink) {
      previewOpenLink.href = url;
    }
    previewContent?.replaceChildren();
    setPreviewStatus("Loading preview…");
    previewScroll?.scrollTo({ top: 0 });

    fetch(`/api/preview?url=${encodeURIComponent(url)}&v=4`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (requestId !== previewRequestSequence) return null;
        if (!response.ok) {
          throw new Error(`preview failed: ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        if (!payload || requestId !== previewRequestSequence) return;
        const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
        const nextTitle =
          typeof payload.title === "string" && payload.title.trim() !== ""
            ? payload.title
            : title;
        if (previewTitle) {
          previewTitle.textContent = nextTitle || "Article preview";
        }
        const bylineParts = [payload.byline, payload.site_name].filter(
          (value) => typeof value === "string" && value.trim() !== "",
        );
        if (previewByline) {
          previewByline.textContent = bylineParts.join(" · ");
          previewByline.classList.toggle(
            "is-hidden",
            bylineParts.length === 0,
          );
        }
        if (previewReadingMeta) {
          const readingParts = [];
          const publishedLabel = formatLocalizedBriefDate(
            payload.published_at,
            "published",
          );
          if (publishedLabel) readingParts.push(publishedLabel);
          if (
            typeof payload.reading_minutes === "number" &&
            payload.reading_minutes > 0
          ) {
            readingParts.push(`${payload.reading_minutes} min read`);
          }
          previewReadingMeta.textContent = readingParts.join(" · ");
          previewReadingMeta.classList.toggle(
            "is-hidden",
            readingParts.length === 0,
          );
        }
        renderPreviewBlocks(blocks);
        setPreviewStatus(
          "No readable text was found. Open the source to read the article.",
          { hidden: blocks.length > 0 },
        );
      })
      .catch((error) => {
        if (
          error?.name === "AbortError" ||
          requestId !== previewRequestSequence
        ) {
          return;
        }
        previewContent?.replaceChildren();
        previewByline?.classList.add("is-hidden");
        previewReadingMeta?.classList.add("is-hidden");
        setPreviewStatus(
          "Preview isn't available for this article. Open the source to read it.",
        );
      })
      .finally(() => {
        if (requestId === previewRequestSequence) {
          previewPanel.setAttribute("aria-busy", "false");
        }
      });
  };

  if (previewCloseButton) {
    previewCloseButton.addEventListener("click", closeArticlePreview);
  }

  if (previewBookmarkButton) {
    previewBookmarkButton.addEventListener("click", () => {
      if (!currentPreviewItem) return;
      const saved = toggleBookmark(currentPreviewItem);
      showToast(saved ? "Saved for later" : "Removed from saved");
    });
  }

  if (previewPrevButton) {
    previewPrevButton.addEventListener("click", () => navigatePreview(-1));
  }

  if (previewNextButton) {
    previewNextButton.addEventListener("click", () => navigatePreview(1));
  }

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      previewPanel &&
      !previewPanel.classList.contains("is-hidden")
    ) {
      closeArticlePreview();
    }
  });

  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    localStorage.setItem(themeStorageKey, theme);
    if (metaThemeColor) {
      // The installed iOS PWA uses theme-color for the opaque status bar;
      // keep every variant in sync with the user's explicit theme choice.
      document.querySelectorAll('meta[name="theme-color"]').forEach((node) => {
        node.setAttribute("content", theme === "dark" ? "#111e2c" : "#e1ebf7");
      });
    }
    if (themeToggle) {
      themeToggle.setAttribute(
        "aria-label",
        `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
      );
      themeToggle.setAttribute(
        "title",
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      );
    }
  };

  const setRefreshButtonLoading = (active) => {
    if (!refreshButton) return;
    refreshButton.disabled = active;
    refreshButton.classList.toggle("is-loading", active);
    refreshButton.setAttribute(
      "aria-label",
      active ? "Refreshing feed" : "Refresh feed",
    );
    refreshButton.setAttribute(
      "title",
      active ? "Refreshing feed" : "Refresh feed",
    );
  };

  const renderSavedFeed = ({ query = "" } = {}) => {
    const saved = bookmarks
      .filter((bookmark) => savedMatchesQuery(bookmark, query))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    if (cardsGrid) {
      const html = saved
        .map((bookmark, i) =>
          cardTemplate({
            source: bookmark.source,
            index: i + 1,
            title: bookmark.title,
            url: bookmark.url,
            comments_url: bookmark.commentsUrl || "",
            brief: bookmark.brief || undefined,
            host: bookmark.host,
          }),
        )
        .join("");
      cardsGrid.innerHTML = html; // HTML is built from escaped stored fields.
      cardsGrid.dataset.hasNext = "false";
      cardsGrid.dataset.currentSource = "saved";
    }
    loadedCount = saved.length;
    hasNext = false;
    offlineViewUnavailable = false;
    personalizedActive = false;
    renderPersonalizedIndicator();
    applyVisitedLinkState();
    applyBookmarkState();
    localizeBriefDates(cardsGrid);
    renderFeedBody();
    applyPreviewActiveCardState();
    updatePreviewNavigation();
  };

  const fetchItems = async ({
    source,
    query,
    offset,
    append,
    loadingMessage,
    showLoadingToast = true,
  }) => {
    syncConnectivityState();
    if (source === "saved") {
      requestSequence += 1;
      renderSavedFeed({ query });
      setFeedLoading(false);
      return;
    }
    const personalize = shouldShowPersonalized();
    const requestId = ++requestSequence;
    setFeedLoading(true, {
      mode: append ? "append" : "replace",
      message:
        loadingMessage ||
        (append
          ? "Loading more items…"
          : personalize
            ? "Personalizing feed…"
            : "Loading feed…"),
      showLoadingToast,
    });

    try {
      let response;
      if (personalize) {
        const body = { interests, limit: pageSize, offset };
        if (shouldRestrictAllSources()) {
          body.sources = selectedSources;
        }
        response = await fetch("/api/personalize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });
      } else {
        const url = new URL("/api/items", window.location.origin);
        url.searchParams.set("limit", String(pageSize));
        url.searchParams.set("offset", String(offset));
        if (source && source !== "all") {
          url.searchParams.set("source", source);
        } else if (shouldRestrictAllSources()) {
          url.searchParams.set("sources", selectedSources.join(","));
        }
        if (query) {
          url.searchParams.set("q", query);
        }
        response = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
      }
      if (!response.ok) {
        throw new Error(`fetch failed: ${response.status}`);
      }
      const payload = await response.json();
      if (requestId !== requestSequence) {
        return;
      }

      const offlineCacheMiss = Boolean(payload.offline && payload.cache_miss);
      const items = payload.items || [];
      if (append && offlineCacheMiss) {
        renderFeedBody();
        return;
      }

      offlineViewUnavailable = !append && offlineCacheMiss;
      hasNext = Boolean(payload.has_next);
      if (cardsGrid) {
        cardsGrid.dataset.hasNext = hasNext ? "true" : "false";
        cardsGrid.dataset.currentSource = source || "all";
      }

      if (!append && cardsGrid) {
        cardsGrid.innerHTML = "";
        loadedCount = 0;
      }

      if (cardsGrid) {
        const html = items.map((item) => cardTemplate(item)).join("");
        if (html) {
          cardsGrid.insertAdjacentHTML("beforeend", html); // HTML is built from escaped API fields plus fixed local icon paths.
          localizeBriefDates(cardsGrid);
        }
      }
      loadedCount = append ? loadedCount + items.length : items.length;
      applyVisitedLinkState();
      applyBookmarkState();
      applyPreviewActiveCardState();
      updatePreviewNavigation();

      if (personalize) {
        personalizedActive = payload.personalization !== "none";
        if (!append && payload.personalization === "none") {
          showToast("Personalization unavailable, showing latest", "error");
        }
      } else {
        personalizedActive = false;
      }
      renderPersonalizedIndicator();
      renderFeedBody();
    } finally {
      if (requestId === requestSequence) {
        setFeedLoading(false, { showLoadingToast });
      }
    }
  };

  const cancelPendingSearch = () => {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
  };

  const currentSearchInputValue = () => (searchInput?.value || "").trim();

  const focusSearchInput = () => {
    if (!searchInput) return;
    void searchForm?.offsetWidth;
    searchInput.focus({ preventScroll: true });
    const valueLength = searchInput.value.length;
    if (typeof searchInput.setSelectionRange === "function") {
      searchInput.setSelectionRange(valueLength, valueLength);
    }
  };

  const applySearch = async (
    nextQuery,
    { collapseWhenEmpty = false, loadingMessage } = {},
  ) => {
    cancelPendingSearch();
    activeQuery = nextQuery;
    searchOpen = Boolean(nextQuery) || (searchOpen && !collapseWhenEmpty);
    renderSearch();
    updateURL();
    await fetchItems({
      source: activeFilter,
      query: activeQuery,
      offset: 0,
      append: false,
      loadingMessage:
        loadingMessage || (nextQuery ? "Searching feed…" : "Loading feed…"),
    });
  };

  const scheduleSearch = () => {
    searchOpen = true;
    renderSearch();
    cancelPendingSearch();
    searchTimer = window.setTimeout(async () => {
      const nextQuery = currentSearchInputValue();
      if (nextQuery.length < 2) {
        return;
      }
      try {
        await applySearch(nextQuery, {
          loadingMessage: "Searching feed…",
        });
      } catch (error) {
        showToast("Failed to search feed", "error");
      }
    }, searchDebounceMs);
  };

  const clearSearch = async ({ collapseWhenEmpty = false } = {}) => {
    cancelPendingSearch();
    ignoreNextEmptySearchInput = true;
    if (searchInput) {
      searchInput.value = "";
    }
    if (!activeQuery) {
      searchOpen = !collapseWhenEmpty;
      renderSearch();
      return;
    }
    await applySearch("", {
      collapseWhenEmpty,
      loadingMessage: "Loading feed…",
    });
  };

  async function refetchCurrentView({
    loadingMessage = "Loading feed…",
    showLoadingToast = true,
  } = {}) {
    ensureActiveFilterIsVisible();
    renderFilters();
    renderSearch();
    updateURL();
    await fetchItems({
      source: activeFilter,
      query: activeQuery,
      offset: 0,
      append: false,
      loadingMessage,
      showLoadingToast,
    });
  }

  async function refetchCurrentViewAfterReconnect() {
    syncConnectivityState();
    if (!browserOnline || refreshInFlight || reconnectRefetchInFlight) {
      return false;
    }
    reconnectRefetchInFlight = true;
    try {
      await refetchCurrentView({ showLoadingToast: false });
      return true;
    } catch (error) {
      return false;
    } finally {
      reconnectRefetchInFlight = false;
    }
  }

  async function refreshFeedList() {
    syncConnectivityState();
    if (!browserOnline || refreshInFlight) {
      return false;
    }
    refreshInFlight = true;
    cancelPendingSearch();
    setRefreshButtonLoading(true);
    renderFeedBody();
    try {
      await refetchCurrentView({ loadingMessage: "Refreshing feed…" });
      showToast(
        activeFilter === "saved" ? "Saved list refreshed" : "Feed refreshed",
        "success",
      );
      return true;
    } catch (error) {
      showToast("Refresh failed", "error");
      return false;
    } finally {
      refreshInFlight = false;
      setRefreshButtonLoading(false);
      renderFeedBody();
    }
  }

  function openConfigDialog() {
    syncConfigOptions();
    syncDensityOptions();
    syncThemeOptions();
    syncPersonalizationOptions();
    syncArticlePreviewOption();
    if (typeof configDialog?.showModal === "function" && !configDialog.open) {
      configDialog.showModal();
      syncDialogOpenState(true);
      return;
    }
    if (configDialog) {
      configDialog.setAttribute("open", "open");
    }
    syncDialogOpenState(true);
  }

  function closeConfigDialog() {
    if (configDialog?.open && typeof configDialog.close === "function") {
      configDialog.close();
      syncDialogOpenState(false);
      return;
    }
    configDialog?.removeAttribute("open");
    syncDialogOpenState(false);
  }

  function isStandaloneDisplay() {
    return (
      window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
      window.navigator.standalone === true
    );
  }

  function isIOSDevice() {
    const ua = navigator.userAgent || "";
    if (/iphone|ipad|ipod/i.test(ua)) return true;
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }

  function isIPadDevice() {
    const ua = navigator.userAgent || "";
    if (/ipad/i.test(ua)) return true;
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }

  function isMobileDevice() {
    if (
      navigator.userAgentData &&
      typeof navigator.userAgentData.mobile === "boolean"
    ) {
      return navigator.userAgentData.mobile;
    }
    if (isIOSDevice()) return true;
    return window.matchMedia?.("(pointer: coarse)")?.matches === true;
  }

  function showInstallButton() {
    if (installPromptHidden) return;
    installButton?.classList.remove("is-hidden");
  }

  function hideInstallButton() {
    installButton?.classList.add("is-hidden");
  }

  function openInstallDialog() {
    if (typeof installDialog?.showModal === "function" && !installDialog.open) {
      installDialog.showModal();
      syncDialogOpenState(true);
      return;
    }
    if (installDialog) {
      installDialog.setAttribute("open", "open");
    }
    syncDialogOpenState(true);
  }

  function closeInstallDialog() {
    if (installDialog?.open && typeof installDialog.close === "function") {
      installDialog.close();
      syncDialogOpenState(false);
      return;
    }
    installDialog?.removeAttribute("open");
    syncDialogOpenState(false);
  }

  async function applyDialogSettings(
    nextSources,
    nextDensity,
    nextTheme,
    nextPersonalizationEnabled,
    nextInterests,
    nextArticlePreviewEnabled,
  ) {
    const normalizedSources = normalizeSelectedSources(nextSources);
    if (normalizedSources.length === 0) {
      showToast("Select at least one source", "error");
      return;
    }
    const normalizedInterests = (nextInterests || "")
      .trim()
      .slice(0, interestsMaxLength);
    if (nextPersonalizationEnabled && !normalizedInterests) {
      showToast("Add a few interests to enable For You", "error");
      return;
    }
    const normalizedDensity = normalizeUIDensity(nextDensity);
    const normalizedTheme = nextTheme === "light" ? "light" : "dark";
    const sourcesChanged =
      normalizedSources.length !== selectedSources.length ||
      normalizedSources.some(
        (value, index) => value !== selectedSources[index],
      );
    const densityChanged = normalizedDensity !== uiDensity;
    const themeChanged = normalizedTheme !== root.dataset.theme;
    const interestsChanged = normalizedInterests !== interests;
    const personalizationEnabledChanged =
      nextPersonalizationEnabled !== aiPersonalizationEnabled;
    const articlePreviewEnabledChanged =
      nextArticlePreviewEnabled !== articlePreviewEnabled;

    if (themeChanged) {
      applyTheme(normalizedTheme);
    }

    if (densityChanged) {
      applyUIDensity(normalizedDensity);
    }

    if (interestsChanged) {
      interests = normalizedInterests;
      persistInterests(interests);
    }

    if (personalizationEnabledChanged) {
      aiPersonalizationEnabled = nextPersonalizationEnabled;
      persistAiPersonalizationEnabled(aiPersonalizationEnabled);
    }

    if (articlePreviewEnabledChanged) {
      articlePreviewEnabled = nextArticlePreviewEnabled;
      persistArticlePreviewEnabled(articlePreviewEnabled);
      if (!articlePreviewEnabled) {
        closeArticlePreview();
      }
    }

    if (!sourcesChanged && !interestsChanged && !personalizationEnabledChanged) {
      syncDensityOptions();
      closeConfigDialog();
      return;
    }

    selectedSources = normalizedSources;
    persistSelectedSources();
    syncConfigOptions();
    syncDensityOptions();
    closeConfigDialog();
    await refetchCurrentView({ loadingMessage: "Loading feed…" });
  }

  if (filterNav) {
    filterNav.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      const nextFilter = button.dataset.filter || "all";
      if (nextFilter === activeFilter) return;
      cancelPendingSearch();
      activeFilter = nextFilter;
      activeQuery = currentSearchInputValue();
      searchOpen = searchOpen || Boolean(activeQuery);
      renderFilters();
      renderSearch();
      updateURL();
      try {
        await fetchItems({
          source: activeFilter,
          query: activeQuery,
          offset: 0,
          append: false,
          loadingMessage: "Loading feed…",
        });
      } catch (error) {
        showToast("Failed to load feed", "error");
      }
    });
  }

  if (configOpenButton) {
    configOpenButton.addEventListener("click", () => {
      openConfigDialog();
    });
  }

  configCloseButtons.forEach((button) => {
    button.addEventListener("click", () => {
      closeConfigDialog();
    });
  });

  if (configSaveButton) {
    configSaveButton.addEventListener("click", async () => {
      try {
        await applyDialogSettings(
          currentSourceSelection(),
          currentDensitySelection(),
          currentThemeSelection(),
          aiPersonalizationToggle?.checked ?? false,
          interestsInput?.value ?? "",
          articlePreviewToggle?.checked ?? false,
        );
      } catch (error) {
        showToast("Failed to apply reader settings", "error");
      }
    });
  }

  if (configDialog) {
    configDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeConfigDialog();
    });

    configDialog.addEventListener("click", (event) => {
      if (event.target === configDialog) {
        closeConfigDialog();
      }
    });
  }

  if (installButton) {
    installButton.addEventListener("click", () => {
      openInstallDialog();
    });
  }

  installDialogCloseButtons.forEach((button) => {
    button.addEventListener("click", () => {
      closeInstallDialog();
    });
  });

  if (installConfirmButton) {
    installConfirmButton.addEventListener("click", async () => {
      if (!deferredInstallPrompt) {
        closeInstallDialog();
        return;
      }
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      closeInstallDialog();
      promptEvent.prompt();
      try {
        await promptEvent.userChoice;
      } finally {
        hideInstallButton();
      }
    });
  }

  if (installDialogHideButton) {
    installDialogHideButton.addEventListener("click", () => {
      installPromptHidden = true;
      persistInstallPromptHidden();
      hideInstallButton();
      closeInstallDialog();
    });
  }

  if (installDialog) {
    installDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeInstallDialog();
    });

    installDialog.addEventListener("click", (event) => {
      if (event.target === installDialog) {
        closeInstallDialog();
      }
    });
  }

  if (filterNav) {
    filterNav.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && document.activeElement?.dataset?.filter) {
        document.activeElement.click();
      }
    });
  }

  if (searchToggle) {
    searchToggle.addEventListener("click", async () => {
      const hasDraftOrQuery = Boolean(currentSearchInputValue() || activeQuery);
      if (!searchOpen && !hasDraftOrQuery) {
        ignoreNextEmptySearchInput = false;
        searchOpen = true;
        renderSearch();
        focusSearchInput();
        return;
      }

      try {
        await clearSearch({ collapseWhenEmpty: true });
      } catch (error) {
        showToast("Failed to clear search", "error");
      }
    });
  }

  if (searchForm) {
    searchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await applySearch(currentSearchInputValue(), {
          loadingMessage: "Searching feed…",
        });
      } catch (error) {
        showToast("Failed to search feed", "error");
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      if (ignoreNextEmptySearchInput && currentSearchInputValue() === "") {
        ignoreNextEmptySearchInput = false;
        return;
      }
      ignoreNextEmptySearchInput = false;
      scheduleSearch();
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        clearSearch({ collapseWhenEmpty: true }).catch(() => {
          showToast("Failed to clear search", "error");
        });
        searchToggle?.focus();
      }
    });
  }

  if (viewMoreButton) {
    viewMoreButton.addEventListener("click", async () => {
      if (feedLoading) return;
      viewMoreButton.disabled = true;
      try {
        await fetchItems({
          source: activeFilter,
          query: activeQuery,
          offset: loadedCount,
          append: true,
          loadingMessage: "Loading more items…",
        });
      } catch (error) {
        showToast("Failed to load more items", "error");
      } finally {
        renderFeedBody();
      }
    });
  }

  if (cardsGrid) {
    const isPlainLeftClick = (event) =>
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey;

    cardsGrid.addEventListener("click", (event) => {
      const bookmarkButton = event.target.closest("[data-bookmark-toggle]");
      if (bookmarkButton) {
        event.preventDefault();
        toggleBookmarkFromCard(bookmarkButton.closest(".item-card"));
        return;
      }

      const clickedLink = event.target.closest(".item-title a");
      if (clickedLink) {
        rememberVisitedLink(clickedLink.href);
      }

      const card = event.target.closest(".item-card");
      const link = card?.querySelector(".item-title a");
      if (!link) return;
      if (window.getSelection().toString() !== "") return;

      if (articlePreviewEnabled) {
        if (!isPlainLeftClick(event)) return;
        const data = cardDataFromCard(card);
        if (!data || !isHttpUrl(data.url)) return;
        event.preventDefault();
        openArticlePreview(data);
        return;
      }

      if (event.target.closest("a")) return;
      link.click();
    });
  }

  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      await refreshFeedList();
    });
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
    });
  }

  const installScreenshotVariant = isIPadDevice()
    ? "tablet"
    : isMobileDevice()
      ? "mobile"
      : "desktop";
  installScreenshotMobile?.classList.toggle(
    "is-hidden",
    installScreenshotVariant !== "mobile",
  );
  installScreenshotTablet?.classList.toggle(
    "is-hidden",
    installScreenshotVariant !== "tablet",
  );
  installScreenshotDesktop?.classList.toggle(
    "is-hidden",
    installScreenshotVariant !== "desktop",
  );

  if (!isStandaloneDisplay()) {
    if (isIOSDevice()) {
      installSteps?.classList.remove("is-hidden");
      // No native install prompt on iOS, so there's nothing for the primary
      // button to confirm — keep "Don't show again" as the only footer action.
      installConfirmButton?.classList.add("is-hidden");
      showInstallButton();
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      showInstallButton();
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      hideInstallButton();
      closeInstallDialog();
    });
  }

  window.addEventListener("offline", () => {
    browserOnline = false;
    hideToast({ onlyKind: "loading" });
    renderConnectionIndicator();
  });

  window.addEventListener("online", () => {
    browserOnline = true;
    renderConnectionIndicator();
    refetchCurrentViewAfterReconnect().catch(() => {});
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== bookmarksStorageKey) return;
    bookmarks = loadBookmarks();
    applyBookmarkState();
    renderFilters();
    if (activeFilter === "saved") {
      renderSavedFeed({ query: activeQuery });
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then((registration) => registration.update().catch(() => {}))
        .catch(() => {});
    });
  }

  updateButton?.addEventListener("click", () => {
    window.location.reload();
  });

  // An installed PWA reopened from the home screen on iOS/iPadOS resumes a
  // frozen page rather than re-running this script, so neither a periodic
  // timer nor "load" alone can see a deploy that happened while it was
  // backgrounded. visibilitychange/pageshow catch the resume itself; the
  // interval is a fallback for long foreground sessions that never trigger
  // either.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  window.addEventListener("pageshow", () => checkForUpdate());
  window.setInterval(() => {
    if (document.visibilityState === "visible") checkForUpdate();
  }, updateCheckIntervalMs);

  const savedTheme = localStorage.getItem(themeStorageKey);
  applyTheme(savedTheme === "light" ? "light" : "dark");
  applyUIDensity(uiDensity, { persist: false });

  syncConfigOptions();
  syncDensityOptions();
  syncArticlePreviewOption();
  applyVisitedLinkState();
  applyBookmarkState();
  applyPreviewActiveCardState();
  updatePreviewNavigation();
  localizeBriefDates();
  const shouldBootstrapRefetch =
    activeFilter === "saved" ||
    shouldShowPersonalized() ||
    (activeFilter === "all"
      ? selectedSources.length !== availableSources.length
      : !selectedSources.includes(activeFilter));
  ensureActiveFilterIsVisible();
  renderFilters();
  renderSearch();
  renderFeedBody();
  setRefreshButtonLoading(false);
  renderConnectionIndicator();

  if (shouldBootstrapRefetch) {
    refetchCurrentView({ loadingMessage: "Loading feed…" }).catch(() => {
      showToast("Failed to load configured sources", "error");
    });
  }

  function hostLabel(rawURL) {
    try {
      const url = new URL(rawURL);
      return url.hostname.replace(/^www\./, "");
    } catch {
      return rawURL;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
