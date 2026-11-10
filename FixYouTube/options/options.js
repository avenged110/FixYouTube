/* FixYouTube settings page (toolbar popup and options page). */
"use strict";

const form = document.getElementById("settings");
const statusEl = document.getElementById("status");
const qualitySelect = document.getElementById("quality");
const rowSelect = document.getElementById("videosPerRowCount");

for (const { value, label } of FIXYOUTUBE_QUALITIES) qualitySelect.add(new Option(label, value));
for (const count of FIXYOUTUBE_ROW_COUNTS) rowSelect.add(new Option(`${count} cards`, String(count)));

let statusTimer = 0;

function render(settings) {
  for (const key of FIXYOUTUBE_BOOLEAN_KEYS) form.elements[key].checked = settings[key];
  qualitySelect.value = settings.quality;
  rowSelect.value = String(settings.videosPerRowCount);
  qualitySelect.disabled = !settings.autoQuality;
  rowSelect.disabled = !settings.videosPerRow;
}

function readForm() {
  const values = {};
  for (const key of FIXYOUTUBE_BOOLEAN_KEYS) values[key] = form.elements[key].checked;
  values.quality = qualitySelect.value;
  values.videosPerRowCount = Number(rowSelect.value);
  return fixYouTubeNormalizeSettings(values);
}

async function save() {
  const settings = readForm();
  render(settings);
  try {
    await chrome.storage.local.set(settings);
    statusEl.textContent = "Saved";
  } catch (error) {
    statusEl.textContent = `Couldn't save: ${error.message}`;
  }
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 2500);
}

form.addEventListener("change", save);

chrome.storage.local.get(Object.keys(FIXYOUTUBE_DEFAULTS)).then((stored) => {
  render(fixYouTubeNormalizeSettings(stored));
});
