/*
 * FixYouTube service worker.
 *
 * Fetches dislike counts from the Return YouTube Dislike API on behalf of
 * the content script. Doing this here (with a host permission for the API)
 * keeps the request independent of YouTube's page CORS/CSP rules, lets us
 * de-duplicate concurrent requests, and caches results briefly.
 */
"use strict";

importScripts("shared/settings.js");

const API_URL = "https://returnyoutubedislikeapi.com/votes?videoId=";
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CACHE_TTL_MS = 3 * 60 * 1000; // Matches the API's own max-age=180.
const CACHE_MAX_ENTRIES = 200;
const REQUEST_TIMEOUT_MS = 10 * 1000;

/** videoId -> { time, promise } */
const cache = new Map();

function fetchVotes(videoId) {
  const now = Date.now();
  const hit = cache.get(videoId);
  if (hit && now - hit.time < CACHE_TTL_MS) return hit.promise;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const promise = fetch(API_URL + encodeURIComponent(videoId), {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "omit",
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      const dislikes = Number(data?.dislikes);
      if (!Number.isFinite(dislikes) || dislikes < 0) throw new Error("Malformed response");
      return { dislikes: Math.round(dislikes) };
    })
    .finally(() => clearTimeout(timer));

  // Failed lookups must not be cached, so a later navigation can retry.
  promise.catch(() => {
    if (cache.get(videoId)?.promise === promise) cache.delete(videoId);
  });

  cache.set(videoId, { time: now, promise });
  if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  return promise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "fixyoutube:get-dislikes") return false;
  if (!sender.tab || !VIDEO_ID_RE.test(message.videoId || "")) {
    sendResponse({ ok: false, error: "Invalid request" });
    return false;
  }
  fetchVotes(message.videoId)
    .then((result) => sendResponse({ ok: true, videoId: message.videoId, dislikes: result.dislikes }))
    .catch((error) => sendResponse({ ok: false, videoId: message.videoId, error: String(error?.message || error) }));
  return true; // Keep the channel open for the async response.
});

// Seed defaults on install so the options page always has a full object.
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(Object.keys(FIXYOUTUBE_DEFAULTS));
  await chrome.storage.local.set(fixYouTubeNormalizeSettings(stored));
});
