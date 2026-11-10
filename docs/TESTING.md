# Testing

## Automated

```bash
node tests/background.test.js
```

Runs the service worker and shared settings in Node with a mocked `chrome` API against the real
Return YouTube Dislike API: settings validation, install defaults, live lookup, caching,
de-duplication of concurrent requests, input validation, unknown videos (the API returns 0), and
server errors (not cached). All scripts also pass `node --check`.

## Live verification on YouTube (November 8, 2026)

Done in a Chromium browser, signed out, by injecting the exact extension files into live YouTube
pages (each file's text was hash-checked against the file on disk before running). The page-world
and isolated-world scripts ran together with a minimal `chrome.storage`/`runtime` shim.

| Feature | Result |
|---|---|
| A1 Dislike count | "19K" (Big Buck Bunny), "1.3K" (Sintel, API 1,341); updates on in-app navigation; setting off restores the original button; setting on re-renders |
| A2 Action row | Only Like/Dislike, Save, More actions; Share/Download/Report in the menu; Share from the menu opens the share dialog; rebuilt after navigation; Save moves into the menu only at very narrow widths and returns when wider |
| B1 2x speed | Applied on load and after navigation |
| B2 Quality | 2160p60 on a 4K video; 1080p on a 1080p-max video; changing the setting applies to the current video |
| B3 | Stable Volume forced from on to off; autoplay switch forced from on to off (PREF `f5=30000`); Ambient mode off via PREF (no glow canvas); settings menu shows only Annotations, Sleep timer, Playback speed, Quality, sized without gaps; autoplay switch hidden |
| B4 Grid | Channel page: YouTube's 3 per row → 5 per row with even alignment |
| B5 Theater | Turned on after in-app navigation |
| B6 Chat / Shorts | Docked live chat collapses via its own toggle; search page Shorts 10 → 0 with all regular results kept; sidebar and channel Shorts tab hidden; Shorts link → regular watch page without reload |

## Follow-up checks (November 8, 2026)

To limit traffic to YouTube, these were done with one page load plus a few in-app navigations,
testing each piece of logic in place:

| Change | Result |
|---|---|
| Exact counts | Like "110K" → "110,365" (stays after re-renders) |
| Regular frame rates | 4K60 video → 720p30 via filtered `get_watch` response; EFY's `isTypeSupported` hook confirmed obsolete |
| Miniplayer | Pressing `i`: without the block the miniplayer opens on the homepage; with it the video keeps playing on its page |
| Channels | Navigating to `/@LinusTechTips` lands on `/@LinusTechTips/videos` with Videos selected |
| Members-only | 9 members-only videos hidden, 21 regular videos visible |
| Sidebar | Explore, More from YouTube, Report history hidden; full stylesheet parses (10/10 rules) |

## Player menu changes (November 9, 2026)

| Change | Result |
|---|---|
| Settings menu | Fresh page, first open: 112px tall with only Playback speed and Quality (was 305px with gaps); later opens 113px |
| Playback speed | Presets 1.0, 1.5, 1.75, 2.0 shown (1.75 was hidden by YouTube for lack of room); slider and -/+ hidden; panel sized to fit |
| Popup | Labels "4/5/6 cards"; status shown beside the title, so no space below the last setting |

## Control buttons and page cleanup (November 9, 2026)

| Change | Result |
|---|---|
| Speed button | Shows "2x"; opens straight to Playback speed (no main panel, no slide); presets 1.0/1.5/1.75/2.0 with 2.0 filled; clicking 1.5 moved the fill and the label to "1.5x" live |
| Quality button | Shows "1080p"; opens straight to Quality; second click closes; switching from Speed to Quality works; picking 720p closes the menu and updates the label; Left arrow closes instead of showing the main panel |
| Settings button | Hidden (still used internally) |
| Page | Microphone button, related-video chips, and all 20 comment menus hidden (since shown again) |
| Speed panel height | Without the height fix the panel was 73px for 56px of content; with it, 56px |

## Icons and centering (November 9, 2026)

| Change | Result |
|---|---|
| Icons | Both buttons show YouTube's own menu icons (copied from the menu, which is built unseen if needed) |
| Badge | 4K badge mirrored onto the Quality button at the same spot as on the settings button (30px, 10px) |
| Centering | "Quality" and "Playback speed" titles and the speed buttons centered |
| Comments | Comment menus shown again |

## Smaller thumbnails (November 9, 2026)

| Change | Result |
|---|---|
| Related videos | Thumbnails 234px → 117px wide; title column 128px → 245px; thumbnails centered in 66/80/100px rows (0px offset) |
| "New" badge | 0 visible on the watch page after hiding |
| Homepage | Thumbnails 346×195 → 294×166; titles reserve 3 lines (66px + 3px for descenders); channel/views line at the same offset (249px) on every regular card; a 3-line test title showed its descenders unclipped |

## Channel header and mixes (November 10, 2026)

| Change | Result |
|---|---|
| Channel header | Banner area removed: header 373px → 270px (Blender channel) |
| Stacked thumbnails | On playlist cards, the stack (thumbnail and both layers behind it) scaled together to the narrower width; no mix was available in the signed-out feed, which uses the same element |

## Player menus, tooltips, and shopping shelves (November 10, 2026)

| Change | Result |
|---|---|
| Speed/Quality menus | Header and rows tightened (rows 32px); speed panel 10px above and below the buttons (was 24px above); both menus share the same title-area rule |
| Control tooltips | `.ytp-tooltip` hidden unless it is the scrubber preview (`.ytp-preview`, confirmed on hover) |
| Precise seeking | "Pull up for precise seeking" label (`.ytp-tooltip-edu`), pull indicator, and fine-scrubbing strip hidden; the regular preview stays |
| Pull-up gesture | main.js pins pointer moves to the bar during a scrub drag. The same upward drag that opened the fine-scrubbing strip without the block seeked normally to the horizontal position with it (217.0s vs. 217.5s expected) |
| Below the description | Ticket, merch, and shopping shelves hidden (`#ticket-shelf`, `#merch-shelf`, `#shopping-timely-shelf`, and their renderers); none had content on the test video |

## Not covered by these checks

- Loading the packaged extension itself in Chrome (the `document_start` timing of the cookie and
  storage seeding, and the direct `/shorts/<id>` redirect, were verified only as equivalent logic).
- Signed-in-only UI (for example extra action buttons such as Clip or Thanks, and the +1 adjustment
  when you dislike a video yourself).
- Embedded players on other websites.
- The Subtitles menu entry (the test video has no captions; matched by its label) and the
  fullscreen action bar (hidden by its container class).
- The thumbnail hover buttons and the "Add to queue" menu entry (only shown when signed in;
  hidden by selector).
- Direct-load paths of the new changes (channel URL redirect, `ytInitialPlayerResponse` filtering),
  and the popup's new layout in the packaged extension.
