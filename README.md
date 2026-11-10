# FixYouTube

A single Chromium extension (Manifest V3) that replaces the handful of features used from
**Enhancer for YouTube** and **Return YouTube Dislike**, and nothing else.

## Install (unpacked)

1. Open `chrome://extensions` (or your Chromium browser's equivalent).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the inner `FixYouTube` folder in this directory.
4. Disable **Enhancer for YouTube** and **Return YouTube Dislike** (running them alongside
   FixYouTube would apply overlapping changes twice).
5. Reload any open YouTube tabs.

Settings: click the FixYouTube toolbar icon (or **Details → Extension options**). Changes apply
to open YouTube tabs immediately.

## Settings (toolbar popup)

| Setting | What it does | Default |
|---|---|---|
| Show Dislike Count | Dislike count on the dislike button, from *Return YouTube Dislike* data | On |
| Automatically Select 2x Speed | 2x playback speed for every video, except live streams | On |
| Automatically Select Resolution | Chosen resolution in every player (watch page, playlists, embeds, channel trailers) | On, 2160p (4K) |
| Video Cards Per Row | 4, 5, or 6 video cards per row on the homepage, subscriptions, and channel pages | On, 4 |
| Use Standard Frame Rates | 24/25/30fps instead of 48/50/60fps | Off |

## Always On

These have no setting:

- **Action row:** only Like/Dislike, Save, and "More actions" are shown; everything else moves into
  the "More actions" menu.
- **Exact counts:** like and dislike counts are shown as exact numbers (for example "110,365").
- **Turned off and hidden:** Autoplay, Stable Volume, Ambient mode, and Voice boost.
- **Player controls:** the settings button is replaced by YouTube's own Playback speed and Quality
  icons (the Quality one keeps YouTube's 4K/HD badge); each opens its menu directly. Subtitles,
  Sleep timer, and the other removed settings are gone. The speed menu shows only 1x, 1.5x, 1.75x,
  and 2x, centered, with the current speed filled.
- **Fullscreen:** the action bar above the controls (like, dislike, comments, share, ask, more) is
  hidden.
- **Theater mode:** turned on automatically.
- **Removed:** info cards and end screens.
- **Live chat:** hidden.
- **Shorts:** hidden everywhere, and Shorts links open as regular videos.
- **No miniplayer or picture-in-picture:** videos only play on their own page.
- **Video cards:** the hover buttons are removed: Mute and Subtitles/CC on hover previews, or
  "Watch later" and "Add to queue" when autoplay on hover is turned off. The "Add to queue" menu
  entry is hidden too.
- **Channel pages:** open on the Videos tab; members-only videos are hidden; the banner area at the
  top of the header is removed.
- **Page:** the search-by-voice (microphone) button, the filter chips above the related videos are
  hidden.
- **Player:** the Speed and Quality menus are compact; hovering the controls shows no tooltips;
  the "Pull up for precise seeking" gesture is disabled (dragging upward while scrubbing just
  keeps scrubbing), and its hint is hidden.
- **Below the description:** event tickets, merch, and shopping shelves are hidden.
- **Thumbnails:** the "New" badge is hidden everywhere. Related videos on watch pages use
  half-width thumbnails, vertically centered in their row, so titles get more room. On the homepage, subscriptions, and channel pages, thumbnails are slightly smaller
  (centered) so titles show up to three lines; every card reserves three lines, so the channel
  and view-count lines line up across cards. Mixes and playlists (stacked thumbnails) shrink the
  same way.
- **Sidebar:** "Explore", "More from YouTube", and "Report history" are hidden.

Behavior details:

- **Like and dislike counts**: the like count comes from YouTube itself; if you like or dislike a
  video, the count updates by one.
- **Save** stays visible whenever it fits on the row. In a very narrow window, where keeping it would
  push "More actions" onto a second line, Save moves into the menu until the window is wider again.
- **Quality**: if a video doesn't offer the selected quality, the highest quality below it is used
  (for example 1080p on a 1080p-only video).
- **Speed and quality** are applied once per video; you can still change either while watching.
- **Regular frame rates**: on videos uploaded at 50/60 fps, YouTube often offers regular frame rates
  only at lower resolutions (for example 720p), so these videos play at that resolution. Applies
  from the next video you open.
- **Channels**: a channel's main link opens its Videos tab; the Home tab is still one click away.
- **Shorts**: links to Shorts open the regular watch page in place (no reload); a direct
  `youtube.com/shorts/…` URL redirects to `/watch?v=…` before any Shorts UI loads.

## Project layout

```
FixYouTube/             The extension (load this folder)
  manifest.json
  background.js         Service worker: dislike-count lookups (cached, de-duplicated)
  shared/settings.js    Setting defaults and validation (shared by all parts)
  content/main.js       Page-world script: player, menu, theater, autoplay, Shorts navigation
  content/isolated.js   Isolated-world script: settings bridge, dislike count, grid layout
  content/youtube.css   Always-on hiding rules
  options/              Settings page (also the toolbar popup)
  icons/
docs/ANALYSIS.md        How EFY and RYD implement each feature, and how FixYouTube does
docs/TESTING.md         What was verified, and how
tests/                  Node test for the service worker and settings
tools/make_icons.py     Regenerates the icons
```

## Permissions

- `storage`: saves your settings.
- `https://returnyoutubedislikeapi.com/*`: fetches dislike counts (only the video ID is sent).
- Content scripts run on `www.youtube.com` and `www.youtube-nocookie.com` (embedded players).
