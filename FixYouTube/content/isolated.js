/*
 * FixYouTube: isolated-world content script.
 *
 * Responsibilities:
 *   - Load settings from chrome.storage and hand them to the page-world
 *     script (content/main.js), live-updating on change.
 *   - (A1) Render the Return YouTube Dislike count on the dislike button.
 *   - (B4) Inject the videos-per-row grid stylesheet.
 *
 * Runs at document_start in every youtube.com / youtube-nocookie.com frame.
 */
(() => {
  "use strict";

  if (globalThis.__fixYouTubeIsolated) return;
  globalThis.__fixYouTubeIsolated = true;

  const IS_TOP_FRAME = window.top === window;
  const PATH = location.pathname;
  if (PATH.startsWith("/live_chat")) return; // The chat frame is hidden; nothing to do there.

  let settings = fixYouTubeNormalizeSettings(null);
  let settingsLoaded = false;

  // ---------------------------------------------------------------------------
  // Settings bridge (isolated world -> page world)
  // ---------------------------------------------------------------------------

  function publishSettings() {
    if (!settingsLoaded) return;
    // A JSON string crosses the world boundary reliably; objects do not.
    document.dispatchEvent(new CustomEvent("fixyoutube:settings", { detail: JSON.stringify(settings) }));
  }

  // The page-world script asks for settings when it starts, covering the case
  // where it initializes after our first publish.
  document.addEventListener("fixyoutube:request-settings", publishSettings);

  // The page-world script needs the frame-rate choice synchronously at
  // document_start (before YouTube's first player response arrives), so the
  // last known value is also kept in the page's localStorage.
  const FRAME_RATE_KEY = "fixyoutube-regular-frame-rate";

  function onSettingsChanged() {
    try {
      localStorage.setItem(FRAME_RATE_KEY, settings.regularFrameRate ? "1" : "0");
    } catch (e) {
      /* Storage unavailable (some embeds); the live setting still applies. */
    }
    publishSettings();
    applyGridStyle();
    dislikes.onSettingsChanged();
  }

  chrome.storage.local.get(Object.keys(FIXYOUTUBE_DEFAULTS)).then((stored) => {
    settings = fixYouTubeNormalizeSettings(stored);
    settingsLoaded = true;
    onSettingsChanged();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!Object.keys(changes).some((key) => key in FIXYOUTUBE_DEFAULTS)) return;
    const next = { ...settings };
    for (const [key, change] of Object.entries(changes)) {
      if (key in FIXYOUTUBE_DEFAULTS) next[key] = change.newValue;
    }
    settings = fixYouTubeNormalizeSettings(next);
    onSettingsChanged();
  });

  // ---------------------------------------------------------------------------
  // (B4) Videos per row
  // ---------------------------------------------------------------------------
  //
  // EFY overrides YouTube's --ytd-rich-grid-items-per-row custom property on
  // grid items. We do the same, and additionally normalize item margins:
  // YouTube marks "first column" items using its *own* column count, which
  // misaligns rows by a few pixels once the count is overridden.

  const GRID_STYLE_ID = "fixyoutube-grid-style";

  function gridCss(n) {
    const item = "ytd-rich-item-renderer:not([is-slim-media]):not([is-post]):not([is-shorts-grid])";
    return `
html.fixyoutube-grid ytd-browse ytd-rich-grid-renderer #contents > ${item}:not([is-shelf-item]) {
  --ytd-rich-grid-items-per-row: ${n} !important;
  margin-left: calc(var(--ytd-rich-grid-item-margin, 16px) / 2) !important;
  margin-right: calc(var(--ytd-rich-grid-item-margin, 16px) / 2) !important;
}
html.fixyoutube-grid ytd-browse ytd-rich-shelf-renderer:not([is-shorts]) ${item}[is-shelf-item] {
  --ytd-rich-grid-items-per-row: ${n} !important;
}
html.fixyoutube-grid ytd-browse ytd-rich-shelf-renderer:not([is-shorts]) ${item}[is-shelf-item]:nth-child(-n + ${n}) {
  display: block !important;
}`;
  }

  function applyGridStyle() {
    if (!IS_TOP_FRAME) return;
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle("fixyoutube-grid", settings.videosPerRow);
    let style = document.getElementById(GRID_STYLE_ID);
    if (!settings.videosPerRow) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = GRID_STYLE_ID;
      // <head> may not exist yet at document_start; <html> is fine for <style>.
      (document.head || root).appendChild(style);
    }
    const css = gridCss(settings.videosPerRowCount);
    if (style.textContent !== css) style.textContent = css;
  }

  // ---------------------------------------------------------------------------
  // (A1) Dislike count, and exact like/dislike numbers
  // ---------------------------------------------------------------------------

  const dislikes = (() => {
    const COUNT_ATTR = "data-fixyoutube-dislikes";
    const SHAPED_ATTR = "data-fixyoutube-shaped";
    const TEXT_CLASSES = ["ytSpecButtonShapeNextButtonTextContent", "yt-spec-button-shape-next__button-text-content"];
    const ICON_BUTTON = ["ytSpecButtonShapeNextIconButton", "yt-spec-button-shape-next--icon-button"];
    const ICON_LEADING = ["ytSpecButtonShapeNextIconLeading", "yt-spec-button-shape-next--icon-leading"];
    // Exact counts with thousands separators ("1,234"), for likes and dislikes.
    const formatter = new Intl.NumberFormat("en-US");

    /** Current lookup: { videoId, status: "loading"|"ok"|"error", dislikes, pressedAtLoad } */
    let current = null;
    let scheduled = false;
    let retryTimer = 0;

    function currentVideoId() {
      if (location.pathname !== "/watch") return null;
      const id = new URLSearchParams(location.search).get("v");
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }

    /** Finds the like/dislike buttons that belong to the visible watch page for `videoId`. */
    function findButtons(videoId) {
      for (const root of document.querySelectorAll("ytd-watch-flexy, ytd-watch-grid")) {
        if (root.hidden || root.getAttribute("video-id") !== videoId) continue;
        const scope = root.querySelector("ytd-watch-metadata #actions") || root.querySelector("#top-level-buttons-computed");
        if (!scope) continue;
        const like =
          scope.querySelector("like-button-view-model button") ||
          scope.querySelector("#segmented-like-button button");
        const dislike =
          scope.querySelector("dislike-button-view-model button") ||
          scope.querySelector("#segmented-dislike-button button");
        if (like && dislike) return { like, dislike };
      }
      return null;
    }

    function textTemplate(likeButton) {
      for (const cls of TEXT_CLASSES) {
        const el = likeButton.querySelector(`.${cls}`);
        if (el) return el;
      }
      return null;
    }

    function shapeAsLeadingIcon(button) {
      if (button.hasAttribute(SHAPED_ATTR)) return;
      const removed = ICON_BUTTON.filter((c) => button.classList.contains(c));
      button.setAttribute(SHAPED_ATTR, removed.join(" "));
      for (const c of ICON_BUTTON) button.classList.remove(c);
      // Mirror the naming scheme YouTube currently uses on this button.
      const modern = removed.length === 0 || removed.includes(ICON_BUTTON[0]);
      button.classList.add(modern ? ICON_LEADING[0] : ICON_LEADING[1]);
    }

    function unshape(button) {
      if (!button.hasAttribute(SHAPED_ATTR)) return;
      const original = button.getAttribute(SHAPED_ATTR).split(" ").filter(Boolean);
      for (const c of ICON_LEADING) button.classList.remove(c);
      for (const c of original) button.classList.add(c);
      button.removeAttribute(SHAPED_ATTR);
    }

    function removeAll() {
      for (const el of document.querySelectorAll(`[${COUNT_ATTR}]`)) el.remove();
      for (const el of document.querySelectorAll(`[${SHAPED_ATTR}]`)) unshape(el);
    }

    /**
     * Rewrites YouTube's abbreviated like count ("110K") as an exact number
     * ("110,365"). The exact count comes from the button's own accessible
     * label ("like this video along with 110,365 other people"), which
     * excludes the viewer's own like; that is added back like YouTube does.
     */
    function renderLikes(like) {
      const text = textTemplate(like);
      // No label number: the count is hidden by the creator or not rendered yet.
      const match = text && (like.getAttribute("aria-label") || "").match(/\d[\d,.\s]*/);
      if (!match) return;
      const likes = Number(match[0].replace(/\D/g, ""));
      const pressed = like.getAttribute("aria-pressed") === "true";
      const formatted = formatter.format(likes + (pressed ? 1 : 0));
      if (text.textContent !== formatted) text.textContent = formatted;
    }

    function render() {
      scheduled = false;
      const videoId = currentVideoId();
      if (!videoId) return;

      // Exact like count: always on, independent of the dislike setting.
      const found = findButtons(videoId);
      if (found) renderLikes(found.like);

      if (!settings.dislikeCount || !settingsLoaded) return;
      if (!current || current.videoId !== videoId) {
        request(videoId);
        return;
      }
      if (current.status !== "ok") return;

      if (!found) return;
      const { like, dislike } = found;

      // Remove counts that YouTube left behind on recycled, now-unrelated buttons.
      for (const stale of document.querySelectorAll(`[${COUNT_ATTR}]`)) {
        if (!dislike.contains(stale)) stale.remove();
      }

      // Reflect the viewer's own vote, like YouTube does for the like count.
      const pressed = dislike.getAttribute("aria-pressed") === "true";
      if (current.pressedAtLoad === undefined) current.pressedAtLoad = pressed;
      const count = Math.max(0, current.dislikes + (pressed ? 1 : 0) - (current.pressedAtLoad ? 1 : 0));
      const text = formatter.format(count);

      let label = dislike.querySelector(`[${COUNT_ATTR}]`);
      if (!label) {
        const template = textTemplate(like);
        label = template ? template.cloneNode(false) : document.createElement("div");
        if (!template) label.className = TEXT_CLASSES[0];
        label.removeAttribute("id");
        label.setAttribute(COUNT_ATTR, "");
        label.setAttribute("aria-hidden", "true");
        const feedback = dislike.querySelector(":scope > yt-touch-feedback-shape");
        dislike.insertBefore(label, feedback || null);
      }
      if (label.textContent !== text) label.textContent = text;
      shapeAsLeadingIcon(dislike);
    }

    function request(videoId) {
      clearTimeout(retryTimer);
      current = { videoId, status: "loading", dislikes: 0, pressedAtLoad: undefined, attempts: 1 };
      send(current);
    }

    function send(lookup) {
      let pending;
      try {
        pending = chrome.runtime.sendMessage({ type: "fixyoutube:get-dislikes", videoId: lookup.videoId });
      } catch (e) {
        // The extension was updated or reloaded while this tab stayed open.
        lookup.status = "error";
        return;
      }
      pending
        .then((response) => {
          if (current !== lookup) return;
          if (response?.ok) {
            lookup.status = "ok";
            lookup.dislikes = response.dislikes;
            schedule();
          } else {
            failed(lookup);
          }
        })
        .catch(() => {
          if (current === lookup) failed(lookup);
        });
    }

    function failed(lookup) {
      lookup.status = "error";
      if (lookup.attempts >= 3) return;
      retryTimer = setTimeout(() => {
        if (current !== lookup) return;
        lookup.attempts += 1;
        lookup.status = "loading";
        send(lookup);
      }, 4000 * lookup.attempts);
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      // rAF doesn't run in background tabs; use a timer there instead.
      if (document.hidden) setTimeout(() => scheduled && render(), 250);
      else requestAnimationFrame(() => scheduled && render());
    }

    function onSettingsChanged() {
      if (!settings.dislikeCount) removeAll();
      schedule();
    }

    if (IS_TOP_FRAME) {
      // YouTube is a single-page app that freely re-renders the action row, so
      // watch the DOM (throttled to one check per frame) and our own vote.
      // Changes inside the video player (time display, controls) are never
      // relevant here and are skipped.
      const observer = new MutationObserver((records) => {
        if (scheduled) return;
        const relevant = records.some((r) => {
          const element = r.target.nodeType === Node.ELEMENT_NODE ? r.target : r.target.parentElement;
          return !element?.closest(".html5-video-player");
        });
        if (relevant) schedule();
      });
      const start = () =>
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
          attributeFilter: ["aria-pressed", "aria-label", "video-id", "hidden"],
        });
      if (document.documentElement) start();
      document.addEventListener("yt-navigate-finish", schedule);
      // A render queued with rAF just before the tab was hidden runs now.
      document.addEventListener("visibilitychange", () => scheduled && render());
    }

    return { onSettingsChanged };
  })();
})();
