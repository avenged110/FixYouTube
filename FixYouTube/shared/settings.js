/*
 * FixYouTube: shared settings definition.
 *
 * Loaded by the service worker (importScripts), the isolated-world content
 * script, and the options page. Only the user-configurable features live
 * here; every other feature is always on.
 */
"use strict";

// eslint-disable-next-line no-unused-vars
const FIXYOUTUBE_DEFAULTS = Object.freeze({
  // (A1) Show the Return YouTube Dislike count on the dislike button.
  dislikeCount: true,
  // (B1) Play every video at 2x by default.
  defaultSpeed: true,
  // (B2) Automatically select a resolution.
  autoQuality: true,
  quality: "hd2160",
  // (B4) Number of videos per row on the homepage, subscriptions, and channels.
  videosPerRow: true,
  videosPerRowCount: 4,
  // (B7) Avoid high-frame-rate (48 fps and up) video formats.
  regularFrameRate: false,
});

// eslint-disable-next-line no-unused-vars
const FIXYOUTUBE_QUALITIES = Object.freeze([
  { value: "highres", label: "4320p (8K)" },
  { value: "hd2880", label: "2880p (5K)" },
  { value: "hd2160", label: "2160p (4K)" },
  { value: "hd1440", label: "1440p" },
  { value: "hd1080", label: "1080p" },
  { value: "hd720", label: "720p" },
  { value: "large", label: "480p" },
  { value: "medium", label: "360p" },
  { value: "small", label: "240p" },
  { value: "tiny", label: "144p" },
]);

// eslint-disable-next-line no-unused-vars
const FIXYOUTUBE_ROW_COUNTS = Object.freeze([4, 5, 6]);

// eslint-disable-next-line no-unused-vars
const FIXYOUTUBE_BOOLEAN_KEYS = Object.freeze(
  Object.keys(FIXYOUTUBE_DEFAULTS).filter((key) => typeof FIXYOUTUBE_DEFAULTS[key] === "boolean"),
);

/** Returns a complete, validated settings object from stored values. */
// eslint-disable-next-line no-unused-vars
function fixYouTubeNormalizeSettings(stored) {
  const s = { ...FIXYOUTUBE_DEFAULTS, ...(stored || {}) };
  for (const key of FIXYOUTUBE_BOOLEAN_KEYS) {
    s[key] = typeof s[key] === "boolean" ? s[key] : FIXYOUTUBE_DEFAULTS[key];
  }
  if (!FIXYOUTUBE_QUALITIES.some((q) => q.value === s.quality)) s.quality = FIXYOUTUBE_DEFAULTS.quality;
  s.videosPerRowCount = Number(s.videosPerRowCount);
  if (!FIXYOUTUBE_ROW_COUNTS.includes(s.videosPerRowCount)) s.videosPerRowCount = FIXYOUTUBE_DEFAULTS.videosPerRowCount;
  // Drop unknown keys so nothing stale is forwarded to the page.
  return Object.fromEntries(Object.keys(FIXYOUTUBE_DEFAULTS).map((k) => [k, s[k]]));
}
