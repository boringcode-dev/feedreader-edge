(() => {
  const root = document.documentElement;
  const availableSources = ["hackernews", "github", "huggingface", "alphaxiv"];
  const sourceLabels = {
    hackernews: "Hacker News",
    github: "GitHub Trending",
    huggingface: "Hugging Face Trending Papers",
    alphaxiv: "alphaXiv",
  };
  const sourceIconPaths = {
    hackernews: "/static/source-icons/hackernews.svg",
    github: "/static/source-icons/github.svg",
    huggingface: "/static/source-icons/huggingface.svg",
    alphaxiv: "/static/source-icons/alphaxiv.png",
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
  const themeStorageKey = "feedreader.theme";
  const interestsStorageKey = "feedreader.interests";
  const aiPersonalizationStorageKey = "feedreader.aiPersonalizationEnabled";
  const interestsMaxLength = 300;
  const defaultInterests =
    "startups, engineering, open-source, Artificial Intelligence (AI), Machine Learning (ML)";
  const installPromptHiddenStorageKey = "feedreader.installPromptHidden";
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  const loadedAppVersion = document.body.dataset.appVersion || "";
  const updateCheckIntervalMs = 15 * 60 * 1000;

  let activeFilter = cardsGrid?.dataset.currentSource || "all";
  let selectedSources = loadSelectedSources();
  let uiDensity = loadUIDensity();
  let visitedLinks = loadVisitedLinks();
  let interests = loadInterests();
  let aiPersonalizationEnabled = interests !== "" && loadAiPersonalizationEnabled();
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

  function emptyMessageForState({ source, query }) {
    if (offlineViewUnavailable) {
      return "Offline and no cached items are available for this view yet.";
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

  const cardTemplate = (item) => `
    <article class="item-card" data-source="${escapeHtml(item.source || "")}">
      <h2 class="item-title">
        <span class="item-index">${escapeHtml(item.index ?? "")}.</span>
        <a href="${escapeAttr(item.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(item.title || "")}</a>
      </h2>
      ${item.brief ? `<p class="item-brief"${item.brief_prefix ? ` data-brief-prefix="${escapeAttr(item.brief_prefix)}"` : ""}${item.brief_suffix ? ` data-brief-suffix="${escapeAttr(item.brief_suffix)}"` : ""}${item.brief_date_iso ? ` data-brief-date-iso="${escapeAttr(item.brief_date_iso)}" data-brief-date-kind="${escapeAttr(item.brief_date_kind || "")}"` : ""}><span class="item-brief-text">${escapeHtml(item.brief)}</span></p>` : ""}
      <p class="item-host"><img class="source-icon-image source-icon-image--host source-icon-image--${escapeAttr(item.source || "")}" src="${escapeAttr(sourceIconPaths[item.source] || "")}" alt="" aria-hidden="true" /><span class="item-host-text">${escapeHtml(item.host || hostLabel(item.url || ""))}</span></p>
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
    if (selectedSources.length > 1) {
      return ["all", ...selectedSources];
    }
    return [...selectedSources];
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
      searchSourceInput.value = activeFilter === "all" ? "" : activeFilter;
    }
    if (controlsRow) {
      controlsRow.classList.toggle("is-search-active", isVisible);
    }
  };

  const updateURL = () => {
    const url = new URL(window.location.href);
    if (activeFilter === "all") {
      url.searchParams.delete("source");
    } else {
      url.searchParams.set("source", activeFilter);
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

  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    localStorage.setItem(themeStorageKey, theme);
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        "content",
        theme === "dark" ? "#111e2c" : "#e1ebf7",
      );
      document.querySelectorAll('meta[name="theme-color"]').forEach((node) => {
        const media = node.getAttribute("media");
        if (!media) {
          node.setAttribute(
            "content",
            theme === "dark" ? "#111e2c" : "#e1ebf7",
          );
        }
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

  const fetchItems = async ({
    source,
    query,
    offset,
    append,
    loadingMessage,
    showLoadingToast = true,
  }) => {
    syncConnectivityState();
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
      showToast("Feed refreshed", "success");
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
    cardsGrid.addEventListener("click", (event) => {
      const link = event.target.closest(".item-title a");
      if (!link) return;
      rememberVisitedLink(link.href);
    });

    cardsGrid.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      if (window.getSelection().toString() !== "") return;
      const card = event.target.closest(".item-card");
      const link = card?.querySelector(".item-title a");
      link?.click();
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
  applyVisitedLinkState();
  localizeBriefDates();
  const shouldBootstrapRefetch =
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
