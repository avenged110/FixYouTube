# Source analysis: Enhancer for YouTube and Return YouTube Dislike

Sources inspected: `~/Desktop/EnhancerForYouTube` (EFY 3.0.19, minified; beautified for reading)
and `~/Desktop/ReturnYouTubeDislike` (RYD 4.1.7, webpack bundle). Findings were checked against
live YouTube (November 2026): its desktop app bundle, player `base.js`, and the running DOM.

For each feature: how the original works, what FixYouTube does, and why.

---

## A1. Dislike count (RYD)

**RYD.** `ryd.content-script.js` (modules 423 "buttons", 935 "state", 937 "vote data request"):

- Fetches `GET https://returnyoutubedislikeapi.com/votes?videoId=<id>` (optionally with
  `&likeCount=`), de-duplicating per video and aborting on navigation.
- Locates the segmented like/dislike control via a large table of fallback selectors (optionally
  refreshed from the RYD server), clones the like button's text container into the dislike button,
  and swaps the button class from "icon button" to "icon leading" so the label has room.
- Formats with `Intl.NumberFormat(..., { notation: "compact" })` by default; adds ratio bar,
  colors, tooltips, vote submission, Shorts support, etc.

**FixYouTube** (`content/isolated.js`, `background.js`):

- Same API and same DOM technique (clone the like count's text element, switch the button to the
  icon-leading shape), so the number is styled exactly like the like count.
- The request runs in the service worker (host permission), independent of YouTube's page
  CORS/CSP, cached for 3 minutes (the API's own `max-age`), de-duplicated, and retried up to
  three times on failure.
- Only acts on the watch page whose `video-id` matches the URL, so a recycled button from the
  previous video never shows a stale number.
- Mirrors the viewer's own dislike (+1/−1) like YouTube does for likes.
- Toggling the setting off removes the label and restores the button's original classes.
- No ratio bar, colors, tooltips, vote submission, or Shorts support (Shorts are converted).

## A2. Hide clutter buttons, keeping Save (RYD)

**RYD.** `menu-fixer.js` (page world) patches the watch page's `ytd-menu-renderer` controller:

- `createClutterMenuData` rewrites `data`: every top-level button that isn't Like/Dislike (for
  example Share) is converted into a `menuFlexibleItemRenderer` so it can live in the overflow menu.
- It wraps `maybeUpdateFlexibleMenuImpl` (YouTube's width-fitting routine) and, with the option on,
  forces `flexAsTopLevelButtons` to an empty array, so every flexible item (Save, Download, Clip,
  Thanks, ...) goes into "More actions".

**YouTube internals (verified live).** `ytd-menu-renderer` renders `data.topLevelButtons` plus
`flexAsTopLevelButtons` (a subset of `data.flexibleItems[].menuFlexibleItemRenderer.topLevelButton`)
in the row; the remaining flexible items appear in "More actions". `resetFlexibleItems()` shows
all flexible items; `maybeUpdateFlexibleMenuImpl()` and `shrinkFlexibleMenu()` remove items while
the row wraps (`hostElement.scrollHeight > max(row heights) + 16`).

**FixYouTube** (`content/main.js`, section A2):

- Same data rewrite as RYD, with one improvement: when converting a view-model button, the actual
  command is unwrapped from its `serialCommand`/`innertubeCommand` wrapper, so the menu entry runs
  the same command the button did (verified: Share from the menu opens the share dialog).
- Save is identified by its `addToPlaylist…` endpoint or `PLAYLIST_ADD` icon (not by text), moved
  first, and pinned as the only visible flexible button.
- `resetFlexibleItems`, `maybeUpdateFlexibleMenuImpl`, and `shrinkFlexibleMenu` are replaced on the
  controller instance, so YouTube can't re-show other buttons on resize or re-render.
- Using YouTube's own wrap test, Save moves into the menu only if the row would otherwise wrap
  (very narrow windows), and comes back as soon as the row widens.

## B1. Default speed 2x (EFY)

**EFY.** `youtube-main.js` keeps the default speed in `z`; on each new video (`onStateChange` 1,
`yt-player-updated`) it calls `player.setPlaybackRate(z)` (or sets `video.playbackRate` when
"override speeds" is on), forces 1x for live streams, and saves/restores the rate around ads.

**FixYouTube.** For every eligible player, once per video ID: `setPlaybackRate(2)`, re-applied
until the player is confirmed playing at 2x (YouTube's initialization can't override it), then
left alone so you can change speed during the video. Ads are skipped (`ad-showing`); the speed is
applied when the content starts. Live streams stay at 1x (as EFY). Works in embeds too.

## B2. Automatic quality, everywhere (EFY)

**EFY.** `Xa()`: `getAvailableQualityLevels()`; if the preferred level is available,
`setPlaybackQuality` + `setPlaybackQualityRange(level)`, otherwise the highest available level;
writes `localStorage["yt-player-quality"]`. Separate settings for videos / playlists / embeds /
fullscreen; the main script excludes `/embed/` (a separate embed script handles those).

**FixYouTube.** One setting for every player (watch, playlist, embed, channel trailer; thumbnail
hover previews excluded). Chooses the highest available level at or below the target (EFY falls
back to the absolute highest, which could exceed the target), and calls
`setPlaybackQualityRange(q, q)` + `setPlaybackQuality(q)`, re-applied until the video is playing.
Also writes `yt-player-quality` so new videos start at that quality. Verified: 2160p60 on a 4K
video, 1080p fallback on a 1080p video, live change of the setting applies to the current video.

## B3. Autoplay, Stable Volume, Ambient mode, Voice boost (EFY + YouTube internals)

**EFY** only handles autoplay: it clicks the player's autoplay switch when it's on (retrying every
2 s until the switch exists) and writes `sessionStorage["yt-player-autonavstate"]`. EFY has no
Stable Volume, Ambient mode, or Voice boost options.

**YouTube internals (from `base.js` / app bundle, verified live):**

| Feature | Stored in | "Off" value |
|---|---|---|
| Autoplay | `PREF` cookie flags 141 (explicit) + 140 (off) | `f5=30000` |
| Ambient mode | `PREF` cookie flags 192 (explicit) + 190 (on) | flag 192 set, 190 clear (`f7 \|= 0x40`) |
| Stable Volume | `localStorage["yt-player-drc-pref"]` | `0` |
| Voice boost | `localStorage["yt-player-voice-boost"]` | `0` |

**FixYouTube:**

- At `document_start` (before YouTube reads them) it writes the four preferences above, plus the
  session autoplay state, so YouTube starts with them off.
- At runtime, per video: `setDrcUserPreference(0)` / `setVoiceBoostUserPreference(0)` if needed,
  and EFY's autoplay-switch click (the only method that updates the player, app, session, and
  cookie together: verified; YouTube can re-enable autoplay from server-side state, which the
  `PREF` cookie alone doesn't prevent). A 2 s safety check repeats this, and an "Up next"
  countdown is canceled if one ever appears.
- Hidden: the player's autoplay switch (CSS), and the Stable Volume / Ambient mode / Voice boost
  (and modern-player "Autoplay") entries in the settings menu. Menu entries are flagged
  synchronously as the menu builds them, so the menu sizes itself without gaps (verified).
- Ambient mode's glow containers are also hidden by CSS as a fallback (guarded so they can never
  hide the player).

## B4. Videos per row (EFY)

**EFY.** Sets `--ytd-rich-grid-items-per-row` (with `!important`) on `ytd-rich-item-renderer` for
specific page types, separate counts for home, Shorts, posts, channel videos, channel Shorts,
plus shelf rules showing the first N items.

**FixYouTube.** One count (4–6) for all rich-grid pages (home, subscriptions, channels). Same
custom-property override, plus normalized item margins: YouTube flags "first column" items using
its *own* column count, which misaligned rows by 8 px after overriding (measured); FixYouTube's
rows line up exactly. Shelf rules as in EFY.

## B5. Theater mode, info cards, end screens (EFY)

**EFY.** Theater: on `yt-page-data-updated` for watch pages, calls the hotkey manager's
`toggleTheaterMode()` if not already in theater. Cards/end screens: `unloadModule("annotations_module")`
per video plus CSS for `.ytp-ce-element`, `.ytp-iv-*`, ended-mode `.html5-endscreen` and
`.ytp-fullscreen-grid`.

**FixYouTube.**
- Theater: sets YouTube's own `wide=1` cookie at `document_start` (YouTube then renders theater
  mode server-side, with no layout jump), and on every watch navigation clicks the player's
  theater button if needed (the hotkey manager EFY used no longer exists in current YouTube;
  verified). Applied once per navigation, so you can still leave theater mode for a video.
- Cards and end screens: EFY's module unload per video, plus CSS for the end-screen elements,
  card button/teaser, and the end-of-video video wall.

## B6. Live chat, Shorts (EFY)

**EFY.** Chat: CSS hides `ytd-live-chat-frame#chat` and the chat teaser; in theater mode with the
chat docked, calls the chat frame's `onShowHideChat()` so the player isn't squeezed. Shorts:
CSS hides Shorts shelves/items/guide entries; "Convert shorts" redirects `/shorts/<id>` to
`/watch?v=<id>` at `document_start` and on `yt-navigate-start` (full page reload).

**FixYouTube.**
- Chat: same CSS (plus the player's "Live chat" quick-action button), and collapses the chat
  whenever it's expanded (verified live: the player returns to full width).
- Shorts: EFY's selectors updated for current YouTube (`grid-shelf-view-model`,
  `ytm-shorts-lockup-view-model[-v2]`, `yt-lockup-view-model`, channel `yt-tab-shape[tab-title="Shorts"]`,
  "Shorts" filter chips). Verified on search: 10 visible Shorts → 0, all regular results kept,
  sidebar entry removed.
- Convert: clicks on Shorts links are intercepted and opened through YouTube's own router
  (`yt-navigate` on `ytd-app`), so there's no page reload (verified). Direct `/shorts/<id>`
  loads redirect at `document_start` (as EFY); `yt-navigate-start` remains a fallback.

## B7. Regular frame rates (EFY "block HFR formats")

**EFY.** Replaces `MediaSource.isTypeSupported` so any type string containing `framerate=48`+ is
reported unsupported, and the player skips those formats.

**Current YouTube (verified).** The player's support probes no longer include a frame rate (only
the codec), so EFY's method no longer has any effect.

**FixYouTube.** Removes video formats of 48 fps and up from the player response itself: the one
embedded in the page (`ytInitialPlayerResponse`, intercepted at `document_start`) and the ones
fetched by the app (`/youtubei/v1/player`, `/get_watch`; embeds that fetch their player response
are covered the same way, but this wasn't tested). Works with
YouTube's current server-driven streaming (verified: a 4K60 video played at 720p30, its highest
regular-frame-rate format). If a video has no regular-frame-rate format, it's left alone so it
still plays. The setting is mirrored to the page's `localStorage` so it's known before the first
response arrives.

## C. Additional always-on changes

- **Miniplayer.** EFY's custom script removed `<ytd-miniplayer>` and the player's miniplayer button
  after each navigation, and deleted the `<video>` element off watch pages. FixYouTube blocks it
  at the source: every route into the miniplayer (the `i` key, the player button, "Add to queue")
  goes through YouTube's `yt-activate-miniplayer…` app actions, which are swallowed before the
  app sees them (verified: pressing `i` leaves the video playing on its page). If the miniplayer
  opens anyway, it's closed (stopping the video), and CSS keeps it hidden.
- **Picture-in-picture.** `requestPictureInPicture` and Document PiP are refused, every `<video>`
  gets `disablePictureInPicture`, the Media Session `enterpictureinpicture` handler (Chrome's
  automatic PiP on tab switch) is never registered, and the PiP button is hidden.
- **Hover buttons.** Current YouTube (signed in, verified) shows two circular buttons in the
  top-right of a card's hover preview: Mute and Subtitles/CC (`yt-inline-player-controls
  .ytInlinePlayerControlsTopRightControls`); they're hidden, so they can't be clicked or focused.
  With autoplay on hover turned off in YouTube's settings, cards instead show "Watch later" and
  "Add to queue" buttons (`yt-thumbnail-hover-overlay-toggle-actions-view-model`, verified signed
  in); those are hidden too, along with older equivalents; the
  "Add to queue" entry in video menus is hidden as well, since it opens the miniplayer queue.
- **Channels → Videos.** Direct loads of a bare channel URL redirect to `/videos` at
  `document_start`; in-app navigation is retargeted by rewriting the navigation endpoint (URL and
  the Videos tab's browse params) before YouTube's router handles it (verified), with a tab click
  as a fallback. `/featured` (the Home tab's own link) is left alone.
- **Members-only.** Channel-page items carrying YouTube's members badge are hidden (verified on a
  channel: 9 members-only videos hidden, 21 regular videos kept).
- **Sidebar.** Sections titled "Explore" / "More from YouTube" and the "Report history" section are
  flagged and hidden (re-checked on every scan, since YouTube can re-stamp sections). Titles are
  matched in English. Link-based section rules were avoided: links such as `/premium` could also
  appear in other sections when signed in.

## Efficiency notes

- Both content scripts watch the DOM, batched into one pass per frame (or one timer in background
  tabs, where frames don't run). Changes inside an already-handled video player (its time display
  and controls tick constantly while the mouse is over it) are skipped.
- The per-player observer that hides settings entries watches only the settings menu.
- Players that are never handled (thumbnail previews) are remembered and skipped.
- **Exact counts.** Like: the exact number from the button's accessible label (+1 if you liked it).
  Dislike: `Intl.NumberFormat("en-US")`.
