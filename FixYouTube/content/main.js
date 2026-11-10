/*
 * FixYouTube: page-world ("MAIN") content script.
 *
 * Runs at document_start, before YouTube's own scripts, so that preference
 * cookies and storage entries are in place when the app and player read them.
 * It owns everything that needs YouTube's JavaScript APIs:
 *
 *   (A2) Hide clutter buttons (keep Like/Dislike and Save)
 *   (B1) Default playback speed (2x)          [setting]
 *   (B2) Automatic playback quality            [setting]
 *   (B3) Autoplay / Stable Volume / Ambient mode / Voice boost off
 *   (B5) Theater mode on; info cards and end screens off
 *   (B6) Live chat collapsed; Shorts converted to regular videos
 *   (B7) Regular frame rates                   [setting]
 *   (C)  No miniplayer / picture-in-picture; channels open on "Videos";
 *        sidebar sections and "Add to queue" hidden
 *   (D)  Player controls: "Playback speed" and "Quality" buttons replace the
 *        settings button; trimmed speed presets with the current one filled
 *
 * Settings arrive from content/isolated.js through a DOM CustomEvent.
 */
(() => {
  "use strict";

  if (window.__fixYouTubeMain) return;
  window.__fixYouTubeMain = true;

  const IS_TOP_FRAME = window.top === window;
  const IS_EMBED = /^\/embed\//.test(location.pathname);
  if (location.pathname.startsWith("/live_chat")) return; // Hidden chat frame.

  const VIDEO_ID = "[A-Za-z0-9_-]{11}";
  const SHORTS_PATH_RE = new RegExp(`^/shorts/(${VIDEO_ID})`);
  const SHORTS_FEED_RE = /^\/shorts\/?$/;

  // ===========================================================================
  // (B6) Convert Shorts: direct loads
  // ===========================================================================
  // EFY redirects /shorts/<id> to /watch?v=<id>. We do the same at
  // document_start, before any Shorts UI is fetched or painted.

  if (IS_TOP_FRAME && !IS_EMBED) {
    const short = location.pathname.match(SHORTS_PATH_RE);
    if (short) {
      location.replace(`/watch?v=${short[1]}`);
      return;
    }
    if (SHORTS_FEED_RE.test(location.pathname)) {
      location.replace("/");
      return;
    }
  }

  // ===========================================================================
  // (C) Channels open on their "Videos" tab: direct loads
  // ===========================================================================
  // A channel's bare URL (/@name, /channel/UC..., /c/name, /user/name) shows
  // the Home tab. The Home tab's own link is /<channel>/featured, so only the
  // bare URL is redirected and the Home tab stays reachable.

  const CHANNEL_ROOT_RE = /^\/(@[^/]+|channel\/UC[\w-]{22}|c\/[^/]+|user\/[^/]+)\/?$/;
  const VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA"; // YouTube's browse params for the Videos tab.

  if (IS_TOP_FRAME && !IS_EMBED && CHANNEL_ROOT_RE.test(location.pathname)) {
    location.replace(`${location.pathname.replace(/\/$/, "")}/videos${location.search}${location.hash}`);
    return;
  }

  // ===========================================================================
  // (B7) Regular frame rates
  // ===========================================================================
  // EFY made MediaSource.isTypeSupported() reject "framerate=48+" types. Current
  // YouTube no longer includes the frame rate in those probes (verified), so
  // instead we remove 48+ fps video formats from the player response itself
  // (both the response embedded in the page and the ones fetched during in-app
  // navigation and in embeds). If a video has no regular-frame-rate format at
  // all, its formats are left untouched so it still plays.

  const FRAME_RATE_KEY = "fixyoutube-regular-frame-rate";
  let regularFrameRate = false;
  try {
    regularFrameRate = localStorage.getItem(FRAME_RATE_KEY) === "1";
  } catch (e) {
    /* ignore */
  }

  function filterFormats(formats) {
    if (!Array.isArray(formats)) return formats;
    const isVideo = (f) => typeof f?.mimeType === "string" && f.mimeType.startsWith("video/");
    const kept = formats.filter((f) => !isVideo(f) || !(f.fps >= 48));
    return kept.some(isVideo) ? kept : formats;
  }

  /** Filters every player response found in `value` (searched a few levels deep). */
  function filterPlayerResponses(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 4) return false;
    let changed = false;
    const data = value.streamingData;
    if (data && typeof data === "object") {
      for (const key of ["adaptiveFormats", "formats"]) {
        const next = filterFormats(data[key]);
        if (next !== data[key] && next.length !== data[key].length) {
          data[key] = next;
          changed = true;
        }
      }
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object" && filterPlayerResponses(child, depth + 1)) changed = true;
    }
    return changed;
  }

  // The watch page embeds its first player response as a global variable.
  {
    let initial;
    try {
      Object.defineProperty(window, "ytInitialPlayerResponse", {
        configurable: true,
        enumerable: true,
        get: () => initial,
        set: (value) => {
          if (regularFrameRate) filterPlayerResponses(value);
          initial = value;
        },
      });
    } catch (e) {
      /* Already defined: nothing to intercept. */
    }
  }

  // Later player responses arrive through fetch().
  const PLAYER_API_RE = /\/youtubei\/v1\/(player|get_watch)\b/;
  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await nativeFetch.apply(this, arguments);
    if (!regularFrameRate) return response;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
    if (!PLAYER_API_RE.test(url) || !response.ok) return response;
    try {
      const json = await response.clone().json();
      if (!filterPlayerResponses(json)) return response;
      return new Response(JSON.stringify(json), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (e) {
      return response;
    }
  };

  // ===========================================================================
  // (C) No picture-in-picture (browser popup players)
  // ===========================================================================

  try {
    // Explicit requests (the player's button, keyboard shortcut, or API).
    const refusePip = () => Promise.reject(new DOMException("Picture-in-picture is disabled.", "NotAllowedError"));
    HTMLVideoElement.prototype.requestPictureInPicture = refusePip;
    if (window.documentPictureInPicture) window.documentPictureInPicture.requestWindow = refusePip;
    // Chrome's automatic picture-in-picture when switching tabs is driven by
    // this Media Session action; never register it.
    const mediaSession = navigator.mediaSession;
    if (mediaSession?.setActionHandler) {
      const setActionHandler = mediaSession.setActionHandler.bind(mediaSession);
      mediaSession.setActionHandler = (action, handler) =>
        action === "enterpictureinpicture" ? undefined : setActionHandler(action, handler);
    }
  } catch (e) {
    /* ignore */
  }

  // ===========================================================================
  // (B3, B5) Preferences seeded before YouTube reads them
  // ===========================================================================

  /**
   * YouTube stores boolean preferences as bit flags in the PREF cookie:
   * flag N lives in key "f<floor(N/31)+1>" (hex) at bit N % 31.
   *   140 = autoplay off, 141 = autoplay explicitly set   ("f5=30000")
   *   190 = ambient mode on, 192 = ambient mode explicitly set
   */
  function setPrefFlag(params, flag, on) {
    const key = `f${Math.floor(flag / 31) + 1}`;
    const bit = 1 << flag % 31;
    let value = parseInt(params.get(key) || "0", 16) || 0;
    value = on ? value | bit : value & ~bit;
    if (value === 0) params.delete(key);
    else params.set(key, value.toString(16));
  }

  function seedPrefCookie() {
    const match = document.cookie.match(/(?:^|;\s*)PREF=([^;]*)/);
    const params = new Map();
    for (const part of (match ? match[1] : "").split("&")) {
      if (!part) continue;
      const i = part.indexOf("=");
      params.set(i < 0 ? part : part.slice(0, i), i < 0 ? "" : part.slice(i + 1));
    }
    setPrefFlag(params, 141, true); // Autoplay: explicitly chosen...
    setPrefFlag(params, 140, true); // ...and off.
    setPrefFlag(params, 192, true); // Ambient mode: explicitly chosen...
    setPrefFlag(params, 190, false); // ...and off.
    const value = [...params].map(([k, v]) => `${k}=${v}`).join("&");
    if (match && match[1] === value) return;
    document.cookie = `PREF=${value}; domain=.youtube.com; path=/; max-age=63072000; secure`;
  }

  /** Writes an entry in the format YouTube's player storage wrapper expects. */
  function setPlayerStorage(storage, key, value, lifetimeMs) {
    const now = Date.now();
    const entry = { data: JSON.stringify(value), creation: now };
    if (lifetimeMs) entry.expiration = now + lifetimeMs;
    storage.setItem(key, JSON.stringify(entry));
  }

  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  try {
    // Stable Volume ("DRC") and Voice boost default to off for every video.
    setPlayerStorage(localStorage, "yt-player-drc-pref", 0, ONE_YEAR_MS);
    setPlayerStorage(localStorage, "yt-player-voice-boost", 0, ONE_YEAR_MS);
  } catch (e) {
    /* Storage can be unavailable in some embedded contexts. */
  }

  if (IS_TOP_FRAME && !IS_EMBED) {
    try {
      seedPrefCookie();
      // Session autoplay state the player consults: 1 = off, 2 = on.
      setPlayerStorage(sessionStorage, "yt-player-autonavstate", 1);
      // Theater mode is rendered server-side from this cookie, so the first
      // paint is already in theater mode (no layout jump).
      document.cookie = "wide=1; domain=.youtube.com; path=/; max-age=63072000; secure";
    } catch (e) {
      /* Cookies or storage blocked; runtime enforcement below still applies. */
    }
  }

  // ===========================================================================
  // Settings (from the isolated world)
  // ===========================================================================

  let settings = null;

  document.addEventListener("fixyoutube:settings", (event) => {
    let next;
    try {
      next = JSON.parse(event.detail);
    } catch (e) {
      return;
    }
    const previous = settings;
    settings = next;
    regularFrameRate = next.regularFrameRate === true;
    onSettingsChanged(previous, next);
  });
  // (The initial settings request is sent at the end of this file, once every
  // declaration it depends on has been initialized.)

  function onSettingsChanged(previous, next) {
    if (next.autoQuality) rememberQualityPreference(next.quality);
    for (const player of attachedPlayers) {
      if (!player.isConnected) continue;
      const state = playerStates.get(player);
      // Apply changed settings to what is playing right now.
      if (next.defaultSpeed && (!previous || !previous.defaultSpeed) && state) state.speedDone = false;
      if (next.autoQuality && (!previous || !previous.autoQuality || previous.quality !== next.quality) && state) {
        state.qualityDone = false;
      }
      handlePlayer(player);
    }
  }

  // ===========================================================================
  // (B1, B2, B3, B5) Per-player handling
  // ===========================================================================

  const QUALITY_ORDER = ["highres", "hd2880", "hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny"];
  const QUALITY_HEIGHT = {
    highres: 4320,
    hd2880: 2880,
    hd2160: 2160,
    hd1440: 1440,
    hd1080: 1080,
    hd720: 720,
    large: 480,
    medium: 360,
    small: 240,
    tiny: 144,
  };
  const SPEED = 2;
  const PLAYING = 1;

  const attachedPlayers = new Set();
  const ignoredPlayers = new WeakSet();
  const playerStates = new WeakMap();

  function isEligiblePlayer(player) {
    if (player.id === "inline-preview-player" || player.id === "shorts-player") return false;
    // Hover previews on thumbnails are muted throwaway players.
    return !player.closest("ytd-video-preview, #video-preview, ytd-shorts");
  }

  function attachPlayer(player) {
    if (attachedPlayers.has(player) || ignoredPlayers.has(player)) return;
    if (!isEligiblePlayer(player)) {
      ignoredPlayers.add(player);
      return;
    }
    if (typeof player.getPlayerState !== "function") return; // API not ready yet; rescanned later.
    attachedPlayers.add(player);
    player.addEventListener("onStateChange", () => handlePlayer(player));
    player.addEventListener("onPlaybackRateChange", () => {
      updateControlLabels(player);
      markSelectedSpeed(player);
    });
    player.addEventListener("onPlaybackQualityChange", () => updateControlLabels(player));
    // The settings menu builds its items when first opened and sizes itself in
    // the same task, so items must be flagged synchronously (a MutationObserver
    // callback runs before layout) for the menu to size around what remains.
    // Only the menu is observed, not the whole (frequently updating) player.
    const menu = player.querySelector(":scope > .ytp-settings-menu") || player;
    new MutationObserver(() => hideSettingsMenuItems(player)).observe(menu, { childList: true, subtree: true });
    hideSettingsMenuItems(player);
    ensureControlButtons(player);
    handlePlayer(player);
  }

  function isAdShowing(player) {
    return player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");
  }

  function call(player, method, ...args) {
    try {
      return typeof player[method] === "function" ? player[method](...args) : undefined;
    } catch (e) {
      return undefined;
    }
  }

  function handlePlayer(player) {
    if (!player.isConnected) {
      attachedPlayers.delete(player);
      return;
    }
    ensureControlButtons(player);
    updateControlLabels(player);
    if (isAdShowing(player)) return; // Leave ads alone; apply once content starts.

    const data = call(player, "getVideoData");
    const videoId = data?.video_id;
    if (!videoId) return;

    let state = playerStates.get(player);
    if (!state || state.videoId !== videoId) {
      state = { videoId, speedDone: false, qualityDone: false, setupDone: false };
      playerStates.set(player, state);
    }
    const playerState = call(player, "getPlayerState");

    if (!state.setupDone) {
      state.setupDone = true;
      // (B5) Info cards and end screens: same as EFY, unload the module that
      // renders them (this is also what the player's "Annotations" switch does).
      call(player, "unloadModule", "annotations_module");
    }
    // (B3) Stable Volume and Voice boost off (also seeded in storage above).
    if (call(player, "getDrcUserPreference") === 1) call(player, "setDrcUserPreference", 0);
    const voiceBoost = call(player, "getVoiceBoostUserPreference");
    if (voiceBoost !== undefined && voiceBoost !== 0) call(player, "setVoiceBoostUserPreference", 0);
    // (B3) Autoplay off.
    disableAutoplay(player);

    if (!settings) return; // Speed and quality wait for the user's settings.

    // (B1) Default speed. Re-applied until confirmed while playing, so that
    // YouTube's own initialization cannot override it; after that the viewer
    // is free to change the speed for the rest of the video.
    if (!state.speedDone) {
      if (!settings.defaultSpeed || data.isLive) {
        state.speedDone = true; // Live streams stay at 1x, like EFY.
      } else {
        const rates = call(player, "getAvailablePlaybackRates");
        if (Array.isArray(rates) && rates.length > 1 && call(player, "getPlaybackRate") !== SPEED) {
          call(player, "setPlaybackRate", SPEED);
        }
        if (playerState === PLAYING && call(player, "getPlaybackRate") === SPEED) state.speedDone = true;
      }
    }

    // (B2) Quality. Applies to every eligible player (watch pages, playlists,
    // embeds, channel trailers), unlike EFY's per-context settings.
    if (!state.qualityDone) {
      if (!settings.autoQuality) {
        state.qualityDone = true;
      } else {
        const chosen = pickQuality(call(player, "getAvailableQualityLevels"), settings.quality);
        if (chosen) {
          call(player, "setPlaybackQualityRange", chosen, chosen);
          call(player, "setPlaybackQuality", chosen);
          if (playerState === PLAYING) state.qualityDone = true;
        }
      }
    }
  }

  /** Highest available quality at or below the target; otherwise the lowest available. */
  function pickQuality(levels, target) {
    if (!Array.isArray(levels)) return null;
    const available = levels.filter((q) => QUALITY_ORDER.includes(q));
    if (!available.length) return null;
    available.sort((a, b) => QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b));
    const targetIndex = QUALITY_ORDER.indexOf(target);
    return available.find((q) => QUALITY_ORDER.indexOf(q) >= targetIndex) || available[available.length - 1];
  }

  /** Lets the player start new videos at the chosen quality (as EFY does). */
  function rememberQualityPreference(quality) {
    const height = QUALITY_HEIGHT[quality];
    if (!height) return;
    try {
      setPlayerStorage(localStorage, "yt-player-quality", { quality: height, previousQuality: height }, ONE_YEAR_MS);
    } catch (e) {
      /* ignore */
    }
  }

  function disableAutoplay(player) {
    if (IS_EMBED) return;
    // Clicking YouTube's own toggle (EFY's approach) is the only method that
    // updates every layer: the player, the app, the session, and the PREF cookie.
    const toggle = player.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (toggle) (toggle.closest("button") || toggle).click();
    // Belt and braces: cancel an "Up next" countdown if one ever appears.
    const cancel = player.querySelector(".ytp-autonav-endscreen-upnext-cancel-button");
    if (cancel && cancel.offsetParent !== null) cancel.click();
  }

  // ===========================================================================
  // (B5) Theater mode
  // ===========================================================================

  let theaterTarget = null;
  let theaterTimer = 0;

  function requestTheater() {
    if (IS_EMBED || !IS_TOP_FRAME) return;
    theaterTarget = location.href;
    clearTimeout(theaterTimer);
    let attempts = 0;
    const attempt = () => {
      if (theaterTarget !== location.href || location.pathname !== "/watch") return;
      const flexy = document.querySelector("ytd-watch-flexy:not([hidden])");
      const player = flexy?.querySelector("#movie_player");
      const sizeButton = player?.querySelector(".ytp-size-button");
      if (flexy && sizeButton && !flexy.playerUnavailable) {
        theaterTarget = null;
        if (!flexy.theater && !flexy.hasAttribute("theater") && !flexy.hasAttribute("fullscreen")) sizeButton.click();
        return;
      }
      if (++attempts < 40) theaterTimer = setTimeout(attempt, 250);
    };
    attempt();
  }

  // ===========================================================================
  // (A2) Hide clutter buttons, keeping Save
  // ===========================================================================
  //
  // Like RYD, we work on the data model of the watch page's ytd-menu-renderer
  // rather than hiding DOM nodes, so every moved action keeps working from the
  // "More actions" menu. YouTube renders `flexAsTopLevelButtons` (a subset of
  // `data.flexibleItems`) in the row and the rest in the overflow menu. We:
  //   1. move every non-Like/Dislike top-level button (Share, Shop, Ask, ...)
  //      into flexibleItems, with Save placed first;
  //   2. pin `flexAsTopLevelButtons` to just the Save button (RYD pins it to
  //      none), replacing YouTube's width-fitting logic for this menu. Only if
  //      the row is too narrow to hold Save without wrapping (YouTube's own
  //      test) does Save move into the menu too, until the row widens again.

  const PATCHED = Symbol.for("fixyoutube.menu-patched");
  const SAVE_COLLAPSED = Symbol.for("fixyoutube.save-collapsed");
  const LAST_WIDTH = Symbol.for("fixyoutube.last-width");
  const transformedData = new WeakSet();

  function isReactionModel(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 8) return false;
    for (const [key, child] of Object.entries(value)) {
      const k = key.toLowerCase();
      if (k.includes("likebutton") || k.includes("dislikebutton")) return true;
      if ((key === "iconName" || key === "iconType") && typeof child === "string" && /^(DIS)?LIKE(_|$)/.test(child)) {
        return true;
      }
      if (isReactionModel(child, depth + 1)) return true;
    }
    return false;
  }

  function isSaveModel(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 10) return false;
    for (const [key, child] of Object.entries(value)) {
      if (key === "addToPlaylistServiceEndpoint" || key === "addToPlaylistEndpoint") return true;
      if ((key === "iconName" || key === "iconType") && child === "PLAYLIST_ADD") return true;
      if (isSaveModel(child, depth + 1)) return true;
    }
    return false;
  }

  /** Extracts the actual command from a view-model tap handler. */
  function unwrapCommand(command) {
    if (!command || typeof command !== "object") return null;
    if (command.innertubeCommand) return command.innertubeCommand;
    const steps = command.serialCommand?.commands;
    if (Array.isArray(steps)) {
      const step = steps.find((s) => s?.innertubeCommand);
      if (step) return step.innertubeCommand;
    }
    return command;
  }

  function toFlexibleItem(topLevelButton) {
    const button = topLevelButton?.buttonViewModel || topLevelButton?.buttonRenderer;
    if (!button) return null;
    const label = [button.title, button.accessibilityText, button.tooltip].find((v) => typeof v === "string" && v.trim());
    const text = button.text && typeof button.text === "object" ? button.text : label ? { runs: [{ text: label }] } : null;
    const endpoint = unwrapCommand(button.onTap || button.serviceEndpoint || button.navigationEndpoint || button.command);
    const icon = button.iconName || button.icon?.iconType;
    if (!text || !endpoint) return null;
    return {
      menuFlexibleItemRenderer: {
        menuItem: {
          menuServiceItemRenderer: {
            text,
            serviceEndpoint: endpoint,
            ...(icon ? { icon: { iconType: icon } } : {}),
            ...(button.trackingParams ? { trackingParams: button.trackingParams } : {}),
          },
        },
        topLevelButton,
      },
    };
  }

  function transformMenuData(data) {
    if (!data || !Array.isArray(data.topLevelButtons)) return null;
    const kept = [];
    const moved = [];
    for (const button of data.topLevelButtons) {
      if (isReactionModel(button)) {
        kept.push(button);
        continue;
      }
      const item = toFlexibleItem(button);
      if (item) moved.push(item);
      else kept.push(button); // Unknown shape: leave it alone rather than lose it.
    }
    const flexibleItems = [...moved, ...(Array.isArray(data.flexibleItems) ? data.flexibleItems : [])];
    const saveIndex = flexibleItems.findIndex(isSaveModel);
    if (saveIndex > 0) flexibleItems.unshift(flexibleItems.splice(saveIndex, 1)[0]);
    const result = { ...data, topLevelButtons: kept, flexibleItems };
    transformedData.add(result);
    return result;
  }

  function desiredVisibleButtons(controller) {
    const items = controller.data?.flexibleItems;
    if (!Array.isArray(items)) return undefined;
    if (controller[SAVE_COLLAPSED]) return [];
    const save = items.find(isSaveModel);
    const button = save?.menuFlexibleItemRenderer?.topLevelButton;
    return button ? [button] : [];
  }

  function applyMenu(controller) {
    if (controller.data && !transformedData.has(controller.data)) {
      const next = transformMenuData(controller.data);
      if (next) controller.data = next;
    }
    const wanted = desiredVisibleButtons(controller);
    if (wanted === undefined) return;
    const current = controller.flexAsTopLevelButtons;
    const same =
      Array.isArray(current) && current.length === wanted.length && current.every((b, i) => b === wanted[i]);
    if (!same) controller.flexAsTopLevelButtons = wanted;
  }

  function patchMenu(menu) {
    const controller = menu.polymerController || menu;
    if (!controller || controller[PATCHED]) {
      if (controller?.[PATCHED] && controller.data && !transformedData.has(controller.data)) applyMenu(controller);
      return;
    }
    if (typeof controller.maybeUpdateFlexibleMenuImpl !== "function" || !("flexAsTopLevelButtons" in controller)) return;
    Object.defineProperty(controller, PATCHED, { value: true });

    // YouTube's resize-driven fitter (runs after every resize and re-render):
    // replaced by our fixed layout plus YouTube's own wrap check.
    controller.maybeUpdateFlexibleMenuImpl = function () {
      this.pendingFlexibleMenuUpdate = undefined;
      const host = this.hostElement;
      if (host) {
        const width = host.clientWidth;
        const grew = width > (this[LAST_WIDTH] ?? 0);
        this[LAST_WIDTH] = width;
        const rowHeight = Math.max(
          this.topLevelButtonsContainer?.scrollHeight || 0,
          this.flexibleItemButtonsContainer?.scrollHeight || 0,
        );
        if (grew) this[SAVE_COLLAPSED] = false; // Room may have opened up: show Save again.
        else if (host.scrollHeight > rowHeight + 16) this[SAVE_COLLAPSED] = true; // Row wraps.
      }
      applyMenu(this);
    }.bind(controller);
    // Called when new data is stamped; it would show every flexible item.
    controller.resetFlexibleItems = function () {
      this[SAVE_COLLAPSED] = false;
      const wanted = desiredVisibleButtons(this);
      if (wanted !== undefined) this.flexAsTopLevelButtons = wanted;
      queueMicrotask(() => applyMenu(this)); // Transform outside YouTube's observer.
    };
    // YouTube's one-button-at-a-time shrink step; wrapping is handled above.
    controller.shrinkFlexibleMenu = function () {};
    applyMenu(controller);
  }

  // ===========================================================================
  // (B3) Hide the player's settings for Stable Volume / Ambient mode / Voice
  // boost / Autoplay (the autoplay switch itself is hidden by CSS), plus
  // Subtitles and Sleep timer, and trim the playback speed panel
  // ===========================================================================

  /** Elements flagged with this attribute are hidden by youtube.css. */
  const HIDDEN_ATTR = "data-fixyoutube-hidden";
  const HIDDEN_MENU_LABELS = /^(stable volume|ambient mode|voice boost|autoplay|sleep timer|subtitles(\/cc)?|captions)$/i;
  /** Playback speed presets kept (YouTube also offers 1.25x and a 3x upsell). */
  const KEPT_SPEED_PRESETS = new Set(["1", "1.5", "1.75", "2"]);
  const MENU_ITEM_CHECKED = "data-fixyoutube-checked";
  const SPEED_PRESET_SHOWN = "data-fixyoutube-shown";
  const SPEED_SELECTED = "data-fixyoutube-selected";

  function hideSettingsMenuItems(player) {
    const menu = player.querySelector(":scope > .ytp-settings-menu");
    let changed = false;
    for (const item of player.querySelectorAll(`.ytp-settings-menu .ytp-menuitem:not([${MENU_ITEM_CHECKED}])`)) {
      const label = (item.querySelector(".ytp-menuitem-label")?.textContent || item.getAttribute("aria-label") || "").trim();
      if (!label) continue; // Not populated yet; check again later.
      item.setAttribute(MENU_ITEM_CHECKED, "");
      if (HIDDEN_MENU_LABELS.test(label) || item.classList.contains("ytp-drc-menu-item")) {
        item.setAttribute(HIDDEN_ATTR, "");
        changed = true;
      }
    }
    // Playback speed presets: keep 1x, 1.5x, 1.75x, 2x. YouTube hides presets
    // that don't fit (often 1.75x); with two removed, the kept ones all fit.
    const presetSelector = `.ytp-settings-menu .ytp-variable-speed-panel-preset-button-wrapper:not([${MENU_ITEM_CHECKED}])`;
    for (const wrapper of player.querySelectorAll(presetSelector)) {
      const value = parseFloat(wrapper.querySelector("button")?.textContent || "");
      if (Number.isNaN(value)) continue;
      wrapper.setAttribute(MENU_ITEM_CHECKED, "");
      if (KEPT_SPEED_PRESETS.has(String(value))) {
        wrapper.setAttribute(SPEED_PRESET_SHOWN, "");
        wrapper.setAttribute("aria-hidden", "false");
      } else {
        wrapper.setAttribute(HIDDEN_ATTR, "");
      }
      changed = true;
    }
    if (changed) markSelectedSpeed(player);
    if (menu) {
      closeOrphanedMainPanel(player, menu);
      if (changed) fitSettingsMenu(menu);
    }
  }

  /** Fills the preset button of the current playback speed (updated live). */
  function markSelectedSpeed(player) {
    const rate = call(player, "getPlaybackRate");
    for (const wrapper of player.querySelectorAll(`.ytp-variable-speed-panel-preset-button-wrapper[${SPEED_PRESET_SHOWN}]`)) {
      const value = parseFloat(wrapper.querySelector("button")?.textContent || "");
      wrapper.toggleAttribute(SPEED_SELECTED, value === rate);
    }
  }

  /**
   * YouTube builds a menu panel and sets its pixel height in the same task
   * (the first time it is opened), before this script can flag items, so the
   * panel would keep the height of what was removed. Shrink the inline heights
   * to the content; this runs before the next paint.
   */
  function fitSettingsMenu(menu) {
    for (const panel of menu.querySelectorAll(".ytp-popup-content > .ytp-panel")) {
      const body = panel.querySelector(":scope > .ytp-panel-menu, :scope > .ytp-variable-speed-panel-content");
      if (!body?.style.height) continue;
      const set = parseFloat(body.style.height);
      body.style.height = "0px"; // scrollHeight is then the content's own height.
      const natural = body.scrollHeight;
      const delta = set - natural;
      if (!(delta > 0) || !natural) {
        body.style.height = `${set}px`; // Content fills it (or scrolls): leave as is.
        continue;
      }
      body.style.height = `${natural}px`;
      for (const el of [panel, menu]) {
        const height = parseFloat(el.style.height);
        if (height) el.style.height = `${height - delta}px`;
      }
    }
  }

  // ===========================================================================
  // Player controls: separate "Playback speed" and "Quality" buttons
  // ===========================================================================
  // With everything else removed, the settings menu only leads to these two
  // submenus. The settings button is hidden (youtube.css) and replaced by two
  // buttons that each open their submenu directly: they open YouTube's own
  // menu and step straight into the submenu in the same task, before anything
  // is painted. The menu's main panel is never shown (youtube.css); if YouTube
  // ever returns to it (for example the Left arrow key), the menu is closed.

  const CONTROL_ATTR = "data-fixyoutube-control";
  const CONTROLS = [
    { id: "speed", label: "Playback speed", item: /^playback speed$/i, panel: ".ytp-variable-speed-panel-content" },
    { id: "quality", label: "Quality", item: /^quality$/i, panel: ".ytp-quality-menu" },
  ];

  function ensureControlButtons(player) {
    const settingsButton = player.querySelector(".ytp-settings-button");
    if (!settingsButton || player.querySelector(`[${CONTROL_ATTR}]`)) return;
    for (const control of CONTROLS) {
      const button = document.createElement("button");
      button.className = "ytp-button fixyoutube-control-button";
      button.setAttribute(CONTROL_ATTR, control.id);
      button.setAttribute("aria-haspopup", "true");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        openSubmenu(player, control);
      });
      settingsButton.before(button);
    }
    // The quality badge (4K, HD, ...) YouTube shows on the settings button is
    // mirrored onto the Quality button whenever YouTube changes it.
    new MutationObserver(() => updateQualityBadge(player, settingsButton)).observe(settingsButton, {
      attributes: true,
      attributeFilter: ["class"],
    });
    updateQualityBadge(player, settingsButton);
    copyMenuIcons(player, settingsButton);
    updateControlLabels(player);
  }

  /**
   * Uses YouTube's own icons from the menu entries. The menu builds its
   * entries the first time it opens, so if needed it is opened and closed
   * again in the same task (never painted).
   */
  function copyMenuIcons(player, settingsButton) {
    const menu = player.querySelector(":scope > .ytp-settings-menu");
    if (!menu) return;
    if (!menu.querySelector(".ytp-menuitem") && !isMenuOpen(menu)) {
      settingsButton.click();
      settingsButton.click();
    }
    for (const control of CONTROLS) {
      const button = player.querySelector(`[${CONTROL_ATTR}="${control.id}"]`);
      if (!button || button.querySelector("svg")) continue;
      const svg = findMenuItem(menu, control)?.querySelector(".ytp-menuitem-icon svg");
      if (svg) button.prepend(svg.cloneNode(true));
    }
  }

  function findMenuItem(menu, control) {
    return [...menu.querySelectorAll(".ytp-menuitem")].find((el) =>
      control.item.test((el.querySelector(".ytp-menuitem-label")?.textContent || "").trim()),
    );
  }

  const BADGE_PROPERTIES = ["background-image", "background-color", "border-radius", "width", "height", "top", "right", "bottom", "left"];

  function updateQualityBadge(player, settingsButton) {
    const button = player.querySelector(`[${CONTROL_ATTR}="quality"]`);
    if (!button) return;
    let badge = button.querySelector(".fixyoutube-quality-badge");
    const hasBadge = [...settingsButton.classList].some((c) => /-badge(-grey)?$/.test(c));
    if (!hasBadge) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "fixyoutube-quality-badge";
      button.append(badge);
    }
    // YouTube's badge is the settings button's ::after; take its exact style.
    const style = getComputedStyle(settingsButton, "::after");
    for (const property of BADGE_PROPERTIES) badge.style.setProperty(property, style.getPropertyValue(property));
  }

  /** Tooltips and accessible names carry the current values. */
  function updateControlLabels(player) {
    const speed = player.querySelector(`[${CONTROL_ATTR}="speed"]`);
    const quality = player.querySelector(`[${CONTROL_ATTR}="quality"]`);
    const rate = call(player, "getPlaybackRate");
    if (speed) setLabel(speed, typeof rate === "number" ? `Playback speed: ${rate}x` : "Playback speed");
    if (quality) {
      const height = QUALITY_HEIGHT[call(player, "getPlaybackQuality")];
      setLabel(quality, height ? `Quality: ${height}p` : "Quality");
    }
  }

  function setLabel(element, text) {
    if (element.title === text) return;
    element.title = text;
    element.setAttribute("aria-label", text);
  }

  function isMenuOpen(menu) {
    return !!menu && menu.style.display !== "none" && menu.offsetParent !== null;
  }

  function openSubmenu(player, control) {
    const settingsButton = player.querySelector(".ytp-settings-button");
    const menu = player.querySelector(":scope > .ytp-settings-menu");
    if (!settingsButton || !menu) return;
    if (isMenuOpen(menu)) {
      const showing = menu.querySelector(`.ytp-popup-content > .ytp-panel ${control.panel}, .ytp-popup-content > ${control.panel}`);
      settingsButton.click(); // Close.
      if (showing) return; // Same button again: just close.
    }
    settingsButton.click(); // Open YouTube's menu (main panel, never painted)...
    const item = findMenuItem(menu, control);
    if (item) item.click(); // ...and step into the submenu in the same task.
    else settingsButton.click(); // Not available (for example ads): close again.
  }

  /** The main panel alone means YouTube stepped back out of a submenu. */
  function closeOrphanedMainPanel(player, menu) {
    if (!isMenuOpen(menu)) return;
    const panels = menu.querySelectorAll(".ytp-popup-content > .ytp-panel");
    if (panels.length === 1 && !panels[0].querySelector(".ytp-panel-header")) {
      player.querySelector(".ytp-settings-button")?.click();
    }
  }

  // ===========================================================================
  // (B6) Live chat: collapse it so the player is not squeezed beside an empty
  // panel (EFY does this in theater mode); CSS hides what remains.
  // ===========================================================================

  let lastChatCollapse = 0;

  function collapseLiveChat() {
    const flexy = document.querySelector("ytd-watch-flexy[live-chat-present-and-expanded]:not([hidden])");
    if (!flexy || Date.now() - lastChatCollapse < 1000) return;
    const chat = flexy.querySelector("ytd-live-chat-frame#chat");
    const target = [chat, chat?.polymerController].find((o) => typeof o?.onShowHideChat === "function");
    if (!target) return;
    lastChatCollapse = Date.now();
    try {
      target.onShowHideChat();
    } catch (e) {
      /* ignore */
    }
  }

  // ===========================================================================
  // (C) No miniplayer
  // ===========================================================================
  // EFY's custom script removed <ytd-miniplayer> and the player's miniplayer
  // button after each navigation, and deleted the <video> element on other
  // pages. We stop the miniplayer at its source instead: every way of opening
  // it (the "i" key, the player button, "Add to queue") goes through YouTube's
  // "activate miniplayer" app actions, which are swallowed here, so the video
  // simply keeps playing on its own page (verified). If YouTube ever opens it
  // some other way, it is closed (which stops the video), and CSS keeps it
  // invisible meanwhile.

  if (IS_TOP_FRAME && !IS_EMBED) {
    window.addEventListener(
      "yt-action",
      (event) => {
        const name = event.detail?.actionName;
        if (typeof name === "string" && /activate-miniplayer/i.test(name)) event.stopImmediatePropagation();
      },
      true,
    );
  }

  function closeMiniplayer() {
    const app = document.querySelector("ytd-app");
    const controller = app?.polymerController || app;
    if (!controller?.miniplayerIsActive) return;
    const close = [...document.querySelectorAll("ytd-miniplayer .ytp-miniplayer-close-button")].find(
      (b) => b.offsetParent !== null,
    );
    if (close) close.click();
    else call(document.querySelector("ytd-miniplayer .html5-video-player") || {}, "stopVideo");
  }

  function disablePictureInPicture() {
    for (const video of document.querySelectorAll("video:not([disablepictureinpicture])")) {
      video.disablePictureInPicture = true;
    }
  }

  // ===========================================================================
  // (C) Channels open on their "Videos" tab: in-app navigation
  // ===========================================================================

  /** Points a channel-root navigation at the Videos tab instead of Home. */
  function retargetChannelEndpoint(endpoint) {
    const meta = endpoint?.commandMetadata?.webCommandMetadata;
    const browse = endpoint?.browseEndpoint;
    if (!meta || !browse || typeof meta.url !== "string") return;
    const [path, query = ""] = meta.url.split("?");
    if (!CHANNEL_ROOT_RE.test(path)) return;
    meta.url = `${path.replace(/\/$/, "")}/videos${query ? `?${query}` : ""}`;
    browse.params = VIDEOS_TAB_PARAMS;
  }

  if (IS_TOP_FRAME && !IS_EMBED) {
    // Runs before YouTube's router (capture phase on window).
    window.addEventListener("yt-navigate", (event) => retargetChannelEndpoint(event.detail?.endpoint), true);
  }

  /** Fallback: a channel page that still landed on Home switches to Videos. */
  function ensureChannelVideosTab() {
    if (!CHANNEL_ROOT_RE.test(location.pathname)) return;
    const tab = document.querySelector('ytd-browse[page-subtype="channels"]:not([hidden]) yt-tab-shape[tab-title="Videos"]');
    if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
  }

  // ===========================================================================
  // (C) Sidebar sections and "Add to queue" menu entries
  // ===========================================================================

  const HIDDEN_GUIDE_SECTIONS = /^(explore|more from youtube)$/i;

  function flagGuideSections() {
    // Re-checked every time: YouTube can re-stamp a section with other content.
    for (const section of document.querySelectorAll("ytd-guide-section-renderer")) {
      const title = section.querySelector("#guide-section-title")?.textContent.trim();
      const links = [...section.querySelectorAll("ytd-guide-entry-renderer > a")].map((a) => a.getAttribute("href"));
      // "Report history" sits alone in its own section; hide the whole section
      // so no empty divider remains.
      const onlyReportHistory = links.length > 0 && links.every((href) => href === "/reporthistory");
      section.toggleAttribute(HIDDEN_ATTR, (!!title && HIDDEN_GUIDE_SECTIONS.test(title)) || onlyReportHistory);
    }
  }

  function flagQueueMenuItems() {
    // Popup menu entries are recycled between menus, so re-check every time.
    for (const item of document.querySelectorAll(
      "ytd-popup-container ytd-menu-service-item-renderer, ytd-popup-container yt-list-item-view-model",
    )) {
      item.toggleAttribute(HIDDEN_ATTR, /^add to queue$/i.test(item.textContent.trim()));
    }
  }

  // ===========================================================================
  // (B6) Convert Shorts: in-app navigation
  // ===========================================================================

  function shortsVideoId(url) {
    try {
      const u = new URL(url, location.href);
      if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
      return u.pathname.match(SHORTS_PATH_RE)?.[1] || null;
    } catch (e) {
      return null;
    }
  }

  /** Opens /watch?v=<id> through YouTube's own router (no page reload). */
  function navigateToWatch(videoId) {
    const url = `/watch?v=${videoId}`;
    const app = document.querySelector("ytd-app");
    if (!app) {
      location.assign(url);
      return;
    }
    app.dispatchEvent(
      new CustomEvent("yt-navigate", {
        bubbles: true,
        composed: true,
        detail: {
          endpoint: {
            commandMetadata: { webCommandMetadata: { url, webPageType: "WEB_PAGE_TYPE_WATCH", rootVe: 3832 } },
            watchEndpoint: { videoId },
          },
        },
      }),
    );
  }

  if (IS_TOP_FRAME && !IS_EMBED) {
    // Intercept plain left-clicks on Shorts links before YouTube's handlers.
    // (Middle/modified clicks open a new tab, which the redirect above handles.)
    window.addEventListener(
      "click",
      (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = event.composedPath().find((n) => n instanceof HTMLAnchorElement && n.href);
        const videoId = anchor && shortsVideoId(anchor.href);
        if (!videoId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        navigateToWatch(videoId);
      },
      true,
    );

    // Fallback for any other route into the Shorts player (EFY's approach).
    document.addEventListener(
      "yt-navigate-start",
      (event) => {
        const url = event.detail?.url || "";
        const videoId = shortsVideoId(url);
        if (videoId) location.replace(`/watch?v=${videoId}`);
        else if (SHORTS_FEED_RE.test(url.split("?")[0])) location.replace("/");
      },
      true,
    );

    document.addEventListener("yt-navigate-finish", (event) => {
      if (event.detail?.pageType === "watch" || location.pathname === "/watch") requestTheater();
      ensureChannelVideosTab();
      scheduleScan();
    });
    document.addEventListener("yt-page-data-updated", () => {
      if (location.pathname === "/watch") requestTheater();
      scheduleScan();
    });
  }

  document.addEventListener("yt-player-updated", () => scheduleScan(), true);

  // ===========================================================================
  // Scrubber: no "Pull up for precise seeking". While a drag that started on
  // the progress bar is in progress, every pointer move is replayed with its
  // vertical position pinned to the bar, so YouTube never sees a pull upward.
  // Horizontal scrubbing is unchanged.
  // ===========================================================================

  {
    let dragBar = null;
    const replayed = new WeakSet();
    const MOVE_TYPES = ["pointermove", "mousemove"];

    window.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;
        dragBar = event.target instanceof Element ? event.target.closest(".ytp-progress-bar-container") : null;
      },
      true
    );
    const endDrag = () => (dragBar = null);
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);

    const pin = (event) => {
      if (!dragBar || replayed.has(event) || !dragBar.isConnected) return;
      const rect = dragBar.getBoundingClientRect();
      const y = Math.round(rect.top + rect.height / 2);
      if (event.clientY === y) return;
      event.stopImmediatePropagation();
      const Ctor = event instanceof PointerEvent ? PointerEvent : MouseEvent;
      const copy = new Ctor(event.type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: event.clientX,
        clientY: y,
        screenX: event.screenX,
        screenY: event.screenY + (y - event.clientY),
        buttons: event.buttons,
        button: event.button,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
      });
      replayed.add(copy);
      event.target.dispatchEvent(copy);
    };
    for (const type of MOVE_TYPES) window.addEventListener(type, pin, true);
  }

  // ===========================================================================
  // DOM scanning (one pass per frame at most)
  // ===========================================================================

  let scanQueued = false;

  function scan() {
    scanQueued = false;
    disablePictureInPicture();
    for (const player of document.querySelectorAll(".html5-video-player")) attachPlayer(player);
    for (const player of attachedPlayers) {
      if (!player.isConnected) attachedPlayers.delete(player);
    }
    if (IS_TOP_FRAME && !IS_EMBED) {
      for (const menu of document.querySelectorAll("ytd-watch-metadata ytd-menu-renderer")) patchMenu(menu);
      collapseLiveChat();
      closeMiniplayer();
      flagGuideSections();
      flagQueueMenuItems();
    }
  }

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    // rAF batches work into the next frame; it doesn't run in background tabs,
    // where a timer is used instead (one wake-up rather than two per scan).
    if (document.hidden) setTimeout(() => scanQueued && scan(), 300);
    else requestAnimationFrame(() => scanQueued && scan());
  }
  // A scan queued with rAF just before the tab was hidden runs now.
  document.addEventListener("visibilitychange", () => scanQueued && scan());

  /** True for DOM changes inside a player we already handle (its time display,
   *  progress bar, and controls update constantly while the mouse is over it). */
  function isInsideAttachedPlayer(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const player = element?.closest(".html5-video-player");
    return !!player && attachedPlayers.has(player);
  }

  const observer = new MutationObserver((records) => {
    if (!scanQueued && records.some((r) => !isInsideAttachedPlayer(r.target))) scheduleScan();
  });
  const startObserving = () =>
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["live-chat-present-and-expanded"],
    });
  if (document.documentElement) startObserving();
  else document.addEventListener("readystatechange", startObserving, { once: true });

  // A low-frequency safety net: YouTube can sit for long stretches without DOM
  // mutations (so nothing above fires) while a player finishes initializing or
  // the server-side autoplay state re-enables the switch.
  setInterval(() => {
    scheduleScan();
    for (const player of attachedPlayers) {
      if (player.isConnected) disableAutoplay(player);
    }
  }, 2000);

  // Ask the isolated world for settings (it may answer synchronously).
  document.dispatchEvent(new CustomEvent("fixyoutube:request-settings"));
  scheduleScan();
})();
