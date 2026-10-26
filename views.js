"use strict";

const PAGE_VIEW_PRESETS = [
  { id: "classic", label: "Original Cable", mode: "guide", layout: "classic", density: "normal", preview: "normal" },
  { id: "guide-compact", label: "01 · Compact Guide", mode: "guide", layout: "classic", density: "compact", preview: "mini" },
  { id: "guide-roomy", label: "02 · Comfortable Guide", mode: "guide", layout: "classic", density: "roomy", preview: "normal" },
  { id: "guide-full", label: "03 · Full-Screen Guide", mode: "guide", layout: "classic", density: "normal", preview: "hidden" },
  { id: "guide-wide", label: "04 · Wide Channel Guide", mode: "guide", layout: "wide", density: "normal", preview: "mini" },
  { id: "guide-split", label: "05 · Split-Screen Guide", mode: "guide", layout: "split", density: "normal", preview: "normal" },
  { id: "guide-left", label: "06 · Left Preview Guide", mode: "guide", layout: "left-preview", density: "normal", preview: "normal" },
  { id: "guide-mini", label: "07 · Mini Preview Guide", mode: "guide", layout: "classic", density: "normal", preview: "mini" },
  { id: "guide-cinema", label: "08 · Cinema Guide", mode: "guide", layout: "cinema", density: "normal", preview: "normal" },
  { id: "guide-quiet", label: "09 · Quiet Guide", mode: "guide", layout: "quiet", density: "compact", preview: "hidden" },
  { id: "guide-large", label: "10 · Large-Type Guide", mode: "guide", layout: "classic", density: "large", preview: "mini" },
  { id: "list-compact", label: "11 · Compact On Demand", mode: "demand", layout: "list", density: "compact", preview: "hidden" },
  { id: "list-roomy", label: "12 · Comfortable On Demand", mode: "demand", layout: "list", density: "roomy", preview: "normal" },
  { id: "list-two", label: "13 · Two-Column Library", mode: "demand", layout: "two-columns", density: "normal", preview: "mini" },
  { id: "list-three", label: "14 · Three-Column Library", mode: "demand", layout: "three-columns", density: "normal", preview: "hidden" },
  { id: "list-cards", label: "15 · Video Card Wall", mode: "demand", layout: "cards", density: "normal", preview: "mini" },
  { id: "list-posters", label: "16 · Poster Library", mode: "demand", layout: "posters", density: "roomy", preview: "hidden" },
  { id: "list-shelves", label: "17 · Channel Shelves", mode: "demand", layout: "shelves", density: "normal", preview: "mini" },
  { id: "list-columns", label: "18 · Channel Columns", mode: "demand", layout: "channel-columns", density: "compact", preview: "hidden" },
  { id: "list-text", label: "19 · Text-Only Library", mode: "demand", layout: "text", density: "compact", preview: "hidden" },
  { id: "list-large", label: "20 · Large-Type Library", mode: "demand", layout: "list", density: "large", preview: "hidden" },
  { id: "favorites-compact", label: "21 · Compact Favorites", mode: "favorites", layout: "list", density: "compact", preview: "hidden" },
  { id: "favorites-folders", label: "22 · Favorites Folder Desk", mode: "favorites", layout: "folder-desk", density: "normal", preview: "hidden" },
  { id: "favorites-cards", label: "23 · Favorites Card Wall", mode: "favorites", layout: "cards", density: "normal", preview: "hidden" },
  { id: "favorites-split", label: "24 · Split-Screen Favorites", mode: "favorites", layout: "split", density: "normal", preview: "normal" },
  { id: "favorites-large", label: "25 · Large-Type Favorites", mode: "favorites", layout: "list", density: "large", preview: "hidden" }
];

function applyPageView(id) {
  const preset = PAGE_VIEW_PRESETS.find((item) => item.id === id) || PAGE_VIEW_PRESETS[0];
  document.body.dataset.pageView = preset.id;
  document.body.dataset.layout = preset.layout;
  document.body.dataset.density = preset.density;
  document.body.dataset.preview = preset.preview;
  $("layout-view").value = preset.id;
  try { localStorage.setItem("airwave:page-view", preset.id); } catch (error) { /* Layout selection still works for this session. */ }
  setView(preset.mode);
}

function initializeViews() {
  $("layout-view").replaceChildren();
  for (const preset of PAGE_VIEW_PRESETS) { const option = document.createElement("option"); option.value = preset.id; option.textContent = preset.label; $("layout-view").append(option); }
  $("layout-view").onchange = () => applyPageView($("layout-view").value);
  let id = "classic";
  try { id = localStorage.getItem("airwave:page-view") || id; } catch (error) { /* Use the original cable layout without storage. */ }
  applyPageView(id);
}
