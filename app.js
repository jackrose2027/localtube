"use strict";

const $ = (id) => document.getElementById(id);
const channels = [];
const knownFiles = new Set();
let view = "guide";
let offset = 0;
let anchor = Math.floor(Date.now() / 1800000) * 1800000;
let activeChannel = null;
let activeVideo = null;
let selectedVideo = null;
let selectedChannel = null;
let activeProgram = null;
let toastTimer;
let draggedVideo = null;
let pendingFolderVideos = [];
const WINDOW_MINUTES = 90;
const MONTH_MINUTES = 30 * 24 * 60;
const PAGE_SIZE = 50;
let guidePage = 0;
let demandPage = 0;
let demandChannel = null;
let playerDemandPage = 0;
let libraryVersion = 0;
let sharedSchedule = null;
const fileCollator = new Intl.Collator(undefined, { numeric: true });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ 38: "&amp;", 60: "&lt;", 62: "&gt;", 34: "&quot;", 39: "&#39;" }[char.charCodeAt(0)]));
const titleOf = (file) => file.name.replace(/\.(mp4|avi|flv|mkv|mp3|iso)$/i, "").replace(/_/g, " ");
const isVideo = (file) => /\.(mp4|avi|flv|mkv|mp3|iso)$/i.test(file.name);
const mediaURLs = new Map();
function mediaURL(video) {
  if (!video.url) video.url = URL.createObjectURL(video.file);
  mediaURLs.delete(video);
  mediaURLs.set(video, video.url);
  for (const [old, url] of mediaURLs) {
    if (mediaURLs.size <= 12) break;
    if (old === video || old === activeVideo || old === selectedVideo) continue;
    URL.revokeObjectURL(url);
    old.url = null;
    mediaURLs.delete(old);
  }
  return video.url;
}
const timeAt = (minutes) => timeFormat.format(new Date(anchor + minutes * 60000));

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 5000);
}

function durationLabel(seconds) {
  if (!seconds) return "Reading...";
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}:` : ""}${Math.floor(minutes / 60) ? String(minutes % 60).padStart(2, "0") : minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function finishLibraryDrag() {
  draggedVideo = null;
  $("new-folder-drop").hidden = true;
  document.querySelectorAll(".drag-target, .is-dragging").forEach((element) => {
    element.classList.remove("drag-target", "is-dragging");
  });
}

function moveToFolder(videos, destination) {
  for (const video of videos) {
    for (const channel of channels) {
      const index = channel.videos.indexOf(video);
      if (index !== -1) channel.videos.splice(index, 1);
    }
    destination.videos.push(video);
    if (activeVideo === video) activeChannel = destination;
    try {
      localStorage.setItem("airwave:folder:" + video.key, JSON.stringify({ path: destination.path, name: destination.name }));
    } catch (error) { /* Keep the folder in memory when local storage is unavailable. */ }
  }
  for (let i = channels.length - 1; i >= 0; i--) {
    if (!channels[i].videos.length) channels.splice(i, 1);
  }
  libraryVersion++;
  relinkFavorites();
  guidePage = Math.min(guidePage, Math.max(0, Math.ceil(channels.length / PAGE_SIZE) - 1));
  render();
  toast(`${videos.length} video${videos.length === 1 ? "" : "s"} moved to ${destination.name}.`);
}

function wireLibraryDrag(element, video, channel) {
  if (video) {
    element.draggable = true;
    element.title += " · Drag onto another video to create a folder, or onto a channel name to move";
    element.addEventListener("dragstart", (event) => {
      draggedVideo = video;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/x-airwave-video", video.key);
      element.classList.add("is-dragging");
      $("new-folder-drop").hidden = false;
    });
    element.addEventListener("dragend", () => { finishLibraryDrag(); render(); });
  }
  element.addEventListener("dragover", (event) => {
    if (!draggedVideo || draggedVideo === video || (!video && channel && channel.videos.includes(draggedVideo))) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    element.classList.add("drag-target");
  });
  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) element.classList.remove("drag-target");
  });
  element.addEventListener("drop", (event) => {
    if (!draggedVideo || draggedVideo === video) return;
    event.preventDefault();
    event.stopPropagation();
    const source = draggedVideo;
    finishLibraryDrag();
    if (!video && channel) {
      if (!channel.videos.includes(source)) moveToFolder([source], channel);
      return;
    }
    pendingFolderVideos = video ? [video, source] : [source];
    $("folder-selection").textContent = `${pendingFolderVideos.length} video${pendingFolderVideos.length === 1 ? "" : "s"}. Creates a channel in locatube; original files stay where they are.`;
    $("folder-name").value = "New folder";
    $("folder-dialog").showModal();
    $("folder-name").select();
  });
}

wireLibraryDrag($("new-folder-drop"), null, null);
$("cancel-folder").onclick = () => $("folder-dialog").close();
$("folder-dialog").addEventListener("close", () => { pendingFolderVideos = []; });
$("folder-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("folder-name").value.trim();
  if (!name) { $("folder-name").focus(); return; }
  if (!pendingFolderVideos.length) return;
  const channel = { name, path: "airwave-folder:" + crypto.randomUUID(), videos: [] };
  channels.push(channel);
  moveToFolder(pendingFolderVideos, channel);
  $("folder-dialog").close();
});

function selectProgram(channel, video) {
  if (selectedVideo && selectedVideo !== video && activeVideo === selectedVideo && !$("guide-preview").paused) savePlaybackPosition($("guide-preview"));
  if (selectedVideo !== video) document.querySelector(".preview-screen").classList.remove("playing");
  selectedVideo = video;
  selectedChannel = channel;
  const number = String(channels.indexOf(channel) + 1).padStart(3, "0");
  $("selected-channel").textContent = channel.name;
  $("selected-number").textContent = `Channel ${number}`;
  $("selected-title").textContent = video.title;
  $("selected-favorite-slot").replaceChildren(favoriteButton(video));
  $("selected-meta").textContent = `${video.format}  |  ${video.duration ? durationLabel(video.duration) : video.externalOnly ? "VLC · estimated 30 min slot" : video.metadataRead ? "Duration unavailable · estimated 30 min slot" : "Reading duration..."}${video.position ? "  |  Resume " + durationLabel(video.position) : ""}`;
  const size = video.file.size / (1024 * 1024);
  const count = scheduleFor(channel).pool.length;
  $("selected-description").textContent = `${video.file.name} · ${size >= 1024 ? (size / 1024).toFixed(1) + " GB" : size.toFixed(1) + " MB"} · ${count} video${count === 1 ? "" : "s"} in rotation · 30-day guide.`;
  $("preview-channel").textContent = `${number} · ${channel.name}`;
  $("preview-label").textContent = video.externalOnly ? "Open in VLC" : "Play here";
  $("preview-play").disabled = false;
  requestMetadata(video);
  if (video.externalOnly) {
    if ($("guide-preview").hasAttribute("src")) { $("guide-preview").removeAttribute("src"); $("guide-preview").load(); }
  } else if ($("guide-preview").getAttribute("src") !== mediaURL(video)) $("guide-preview").src = mediaURL(video);
  document.querySelectorAll(".program").forEach((program) => program.classList.toggle("selected", program.dataset.videoKey === video.key && program.dataset.channelPath === channel.path));
  document.querySelectorAll(".channel-row").forEach((row) => row.classList.toggle("selected", row.dataset.channelPath === channel.path));
}

function playInPreview(channel, video, program = null) {
  savePlaybackPosition();
  $("player").pause();
  activeChannel = channel;
  activeVideo = video;
  activeProgram = program;
  syncFavoriteButtons();
  selectProgram(channel, video);
  $("preview-screen").classList.add("playing");
  $("guide-preview").play().catch((error) => {
    if (error.name !== "NotAllowedError" && error.name !== "AbortError") toast("This video could not be played in the browser.");
  });
}

$("guide-preview").addEventListener("loadedmetadata", () => {
  const duration = $("guide-preview").duration;
  if (Number.isFinite(duration) && duration > 0) $("guide-preview").currentTime = Math.min(selectedVideo ? selectedVideo.position || 0.1 : 0.1, Math.max(0, duration - 0.1));
});
$("preview-play").onclick = () => {
  if (!selectedChannel || !selectedVideo) return;
  if (selectedVideo.externalOnly) {
    playVideo(selectedChannel, selectedVideo);
    return;
  }
  playInPreview(selectedChannel, selectedVideo);
};
$("guide-preview").addEventListener("timeupdate", () => {
  if (activeVideo === selectedVideo && !$("guide-preview").paused) savePlaybackPosition($("guide-preview"));
});

function scheduleFor(channel) {
  const shared = channel.path.startsWith("airwave-video:");
  let base = shared ? sharedSchedule : channel.scheduleBase;
  if (!base || base.version !== libraryVersion) {
    const pool = shared
      ? channels.filter((item) => item.path.startsWith("airwave-video:")).flatMap((item) => item.videos)
      : channel.videos;
    let seed = 2166136261;
    for (const char of shared ? "airwave-shared" : channel.path) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
    const playlist = pool.slice();
    for (let i = playlist.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = Math.floor(seed / 4294967296 * (i + 1));
      [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    }
    const lengths = playlist.map((video) => Math.max(1 / 60, (video.duration || 1800) / 60));
    const prefix = [0];
    const indices = new Map();
    playlist.forEach((video, index) => { prefix.push(prefix[index] + lengths[index]); indices.set(video, index); });
    base = { version: libraryVersion, pool, playlist, lengths, prefix, indices, total: prefix[prefix.length - 1] };
    if (shared) sharedSchedule = base;
    else channel.scheduleBase = base;
  }
  const first = channel.videos[0];
  const rotation = ((base.indices.get(first) || 0) + 1) % base.playlist.length;
  return { ...base, first, firstLength: Math.max(1 / 60, (first.duration || 1800) / 60), rotation };
}

function programsBetween(channel, start, end, limit = Infinity) {
  start = Math.max(0, start);
  end = Math.min(MONTH_MINUTES, end);
  if (start >= end) return [];
  const schedule = scheduleFor(channel);
  const programs = [];
  if (start < schedule.firstLength) programs.push({ video: schedule.first, start: 0, end: Math.min(schedule.firstLength, MONTH_MINUTES) });
  const time = Math.max(start, schedule.firstLength);
  let within = (schedule.prefix[schedule.rotation] + time - schedule.firstLength) % schedule.total;
  if (schedule.total - within < 0.00000001) within = 0;
  let low = 0;
  let high = schedule.playlist.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (schedule.prefix[mid + 1] <= within + 0.00000001) low = mid + 1;
    else high = mid;
  }
  let index = low;
  let position = time - (within - schedule.prefix[index]);
  while (position < end - 0.00000001 && programs.length < limit) {
    const next = position + schedule.lengths[index];
    programs.push({ video: schedule.playlist[index], start: position, end: Math.min(next, MONTH_MINUTES) });
    position = next;
    index = (index + 1) % schedule.playlist.length;
  }
  return programs;
}

function pageControls(root, page, total, changePage) {
  root.replaceChildren();
  root.hidden = total <= PAGE_SIZE;
  if (root.hidden) return;
  const previous = document.createElement("button");
  previous.className = "secondary";
  previous.textContent = "Previous";
  previous.disabled = page === 0;
  previous.onclick = () => changePage(page - 1);
  const label = document.createElement("span");
  label.textContent = `${page * PAGE_SIZE + 1}-${Math.min(total, (page + 1) * PAGE_SIZE)} of ${total.toLocaleString()}`;
  const next = document.createElement("button");
  next.className = "secondary";
  next.textContent = "Next";
  next.disabled = (page + 1) * PAGE_SIZE >= total;
  next.onclick = () => changePage(page + 1);
  const pageInput = document.createElement("input");
  pageInput.type = "number";
  pageInput.min = 1;
  pageInput.max = Math.ceil(total / PAGE_SIZE);
  pageInput.value = page + 1;
  pageInput.setAttribute("aria-label", "Jump to page");
  pageInput.title = "Jump to page";
  pageInput.onchange = () => {
    const value = Number(pageInput.value);
    if (Number.isInteger(value) && value >= 1 && value <= Number(pageInput.max)) changePage(value - 1);
    else pageInput.value = page + 1;
  };
  root.append(previous, label, pageInput, next);
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderGuide() {
  const date = new Date(anchor + offset * 60000);
  $("guide-date").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "numeric", day: "numeric" }).format(date);
  $("guide-day").min = localDate(new Date(anchor));
  $("guide-day").max = localDate(new Date(anchor + (MONTH_MINUTES - WINDOW_MINUTES) * 60000));
  $("guide-day").value = localDate(date);
  $("earlier").disabled = offset <= 0;
  $("later").disabled = offset >= MONTH_MINUTES - WINDOW_MINUTES;
  $("times").innerHTML = Array.from({ length: 3 }, (_, i) => `<div class="time-slot">${escapeHTML(timeAt(offset + i * 30))}</div>`).join("");
  $("channel-total").textContent = String(channels.length).padStart(2, "0");
  $("empty-state").hidden = channels.length > 0;
  $("channel-rows").replaceChildren();
  guidePage = Math.min(guidePage, Math.max(0, Math.ceil(channels.length / PAGE_SIZE) - 1));
  pageControls($("guide-pages"), guidePage, channels.length, (page) => { guidePage = page; $("guide-scroll").scrollTop = 0; renderGuide(); });
  channels.slice(guidePage * PAGE_SIZE, (guidePage + 1) * PAGE_SIZE).forEach((channel, pageIndex) => {
    const channelIndex = guidePage * PAGE_SIZE + pageIndex;
    const row = document.createElement("div");
    row.className = "channel-row";
    row.dataset.channelPath = channel.path;
    row.innerHTML = `<div class="channel-cell" title="${escapeHTML(channel.name)}"><span class="channel-number">${String(channelIndex + 1).padStart(2, "0")}</span><div class="channel-name">${escapeHTML(channel.name)}<small>${channel.videos.length} VIDEO${channel.videos.length === 1 ? "" : "S"}</small></div></div><div class="program-track"></div>`;
    const channelCell = row.firstElementChild;
    channelCell.setAttribute("role", "button");
    channelCell.tabIndex = 0;
    channelCell.setAttribute("aria-label", "Browse all videos in " + channel.name);
    channelCell.onclick = () => openChannelBucket(channel);
    channelCell.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); openChannelBucket(channel); } };
    wireLibraryDrag(channelCell, null, channel);
    const track = row.lastElementChild;
    const entries = programsBetween(channel, offset, offset + WINDOW_MINUTES, 40);
    for (const entry of entries) {
      const video = entry.video;
      requestMetadata(video);
      const start = Math.max(entry.start, offset);
      const end = Math.min(entry.end, offset + WINDOW_MINUTES);
      const program = document.createElement("button");
      program.className = "program";
      program.dataset.videoKey = video.key;
      program.dataset.channelPath = channel.path;
      program.addEventListener("mouseenter", () => { if (!draggedVideo && $("guide-preview").paused) selectProgram(channel, video); });
      program.addEventListener("focus", () => selectProgram(channel, video));
      program.style.left = `${(start - offset) / WINDOW_MINUTES * 100}%`;
      program.style.width = `${(end - start) / WINDOW_MINUTES * 100}%`;
      if ((end - start) / WINDOW_MINUTES < 0.03) program.style.padding = "0";
      program.title = `${video.title} · ${timeAt(entry.start)} - ${timeAt(entry.end)} · Click to play or resume`;
      program.innerHTML = `<span class="program-title">${escapeHTML(video.title)}</span><span class="program-time">${escapeHTML(timeAt(entry.start))} &nbsp;·&nbsp; ${video.duration ? escapeHTML(durationLabel(video.duration)) : "30 min slot"}</span>`;
      program.addEventListener("click", () => {
        if (!$("guide-preview").paused && !video.externalOnly) playInPreview(channel, video, entry);
        else playVideo(channel, video, entry);
      });
      wireLibraryDrag(program, video, channel);
      track.append(program);
    }
    if (entries.length && entries[entries.length - 1].end < offset + WINDOW_MINUTES) {
      const more = document.createElement("button");
      more.className = "program";
      const start = entries[entries.length - 1].end;
      more.style.left = `${(start - offset) / WINDOW_MINUTES * 100}%`;
      more.style.width = `${(offset + WINDOW_MINUTES - start) / WINDOW_MINUTES * 100}%`;
      more.textContent = "More short programs · On Demand";
      more.onclick = () => openChannelBucket(channel);
      track.append(more);
    }
    $("channel-rows").append(row);
  });
  if (channels.includes(selectedChannel) && scheduleFor(selectedChannel).pool.includes(selectedVideo)) selectProgram(selectedChannel, selectedVideo);
  else if (channels.length) selectProgram(channels[0], programsBetween(channels[0], offset, offset + WINDOW_MINUTES, 1)[0].video);
}

function openChannelBucket(channel) {
  demandChannel = channel;
  demandPage = 0;
  $("search").value = "";
  setView("demand");
  $("demand-view").scrollTop = 0;
}

function renderDemand(root = $("demand-view")) {
  const inPlayer = root === $("player-demand-list");
  root.replaceChildren();
  if (!channels.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="eyebrow">YOUR COLLECTION, ON YOUR TERMS</div><h2>Something worth watching.</h2><p>Add your videos and pick a favorite.</p><button class="primary">Choose a video folder</button>`;
    empty.querySelector("button").onclick = () => $("folder-input").click();
    root.append(empty);
    return;
  }
  if (!inPlayer && demandChannel) {
    const bucket = document.createElement("div");
    bucket.className = "bucket-heading";
    const back = document.createElement("button");
    back.className = "secondary";
    back.textContent = "All media";
    back.onclick = () => { demandChannel = null; demandPage = 0; renderDemand(); };
    const title = document.createElement("strong");
    title.textContent = demandChannel.name + " · " + demandChannel.videos.length + " files";
    bucket.append(back, title);
    root.append(bucket);
  }
  const query = (inPlayer ? $("player-search") : $("search")).value.trim().toLocaleLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const matches = [];
  for (const channel of !inPlayer && demandChannel ? [demandChannel] : channels) {
    const channelText = channel.name.toLocaleLowerCase();
    for (const video of channel.videos) {
      const text = `${video.title} ${video.file.name} ${video.path} ${video.format}`.toLocaleLowerCase();
      if (terms.every((term) => channelText.includes(term) || text.includes(term))) matches.push({ channel, video });
    }
  }
  if (inPlayer) $("player-search-results").textContent = `${matches.length.toLocaleString()} found`;
  let page = inPlayer ? playerDemandPage : demandPage;
  page = Math.min(page, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));
  if (inPlayer) playerDemandPage = page;
  else demandPage = page;
  let previousChannel = null;
  let list;
  for (const { channel, video } of matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    if (channel !== previousChannel) {
      const section = document.createElement("section");
      section.className = "demand-section";
      section.innerHTML = `<h2 class="demand-heading">${escapeHTML(channel.name)} <span>${channel.videos.length} FILE${channel.videos.length === 1 ? "" : "S"}</span></h2><ul class="video-list"></ul>`;
      if (!inPlayer) wireLibraryDrag(section.firstElementChild, null, channel);
      list = section.lastElementChild;
      root.append(section);
      previousChannel = channel;
    }
    requestMetadata(video);
    const button = document.createElement("button");
    button.className = "video-row";
    button.title = video.title;
    const duration = video.duration ? durationLabel(video.duration) : video.externalOnly ? "VLC" : video.metadataRead ? "Unknown" : "Reading...";
    button.innerHTML = `<span class="video-play" aria-hidden="true">&#9655;</span><span class="video-title">${escapeHTML(video.title)} <small>${escapeHTML(video.format)}</small></span><span class="video-duration" aria-label="Duration: ${escapeHTML(duration)}">${escapeHTML(duration)}</span>`;
    button.onclick = () => playVideo(channel, video);
    if (inPlayer && video === activeVideo) button.setAttribute("aria-current", "true");
    if (!inPlayer) wireLibraryDrag(button, video, channel);
    const item = document.createElement("li");
    item.className = "media-list-item";
    item.append(button, favoriteButton(video));
    list.append(item);
  }
  if (!matches.length) { const empty = document.createElement("div"); empty.className = "no-results"; empty.textContent = "No files match your search."; root.append(empty); }
  const controls = document.createElement("div");
  controls.className = "page-controls";
  pageControls(controls, page, matches.length, (next) => {
    if (inPlayer) playerDemandPage = next;
    else demandPage = next;
    root.scrollTop = 0;
    renderDemand(root);
  });
  root.append(controls);
}

function render() {
  if (draggedVideo) return;
  renderGuide();
  if (view === "demand") renderDemand();
  if (view === "favorites") renderFavorites();
  $("guide-pages").hidden = view !== "guide" || channels.length <= PAGE_SIZE;
  if ($("player-dialog").open && $("player-demand").open) renderDemand($("player-demand-list"));
  const count = channels.reduce((sum, channel) => sum + channel.videos.length, 0);
  $("export-playlist").disabled = count === 0 && favItems.size === 0;
  $("library-count").textContent = count ? `${channels.length} channel${channels.length === 1 ? "" : "s"} / ${count} video${count === 1 ? "" : "s"}` : "Your personal lineup";
}

function setView(next) {
  view = next;
  $("guide-view").hidden = view !== "guide";
  $("demand-view").hidden = view !== "demand";
  $("favorites-view").hidden = view !== "favorites";
  $("guide-pages").hidden = view !== "guide" || channels.length <= PAGE_SIZE;
  $("timeline-controls").hidden = view !== "guide";
  $("search-wrap").hidden = view === "guide";
  $("view-label").textContent = view === "guide" ? "CHANNEL GUIDE" : view === "favorites" ? "FAVORITES" : "YOUR COLLECTION";
  for (const name of ["guide", "demand", "favorites"]) {
    $(`${name}-tab`).classList.toggle("active", name === view);
    $(`${name}-tab`).setAttribute("aria-selected", String(name === view));
    $(`${name}-tab`).tabIndex = name === view ? 0 : -1;
  }
  if (view === "demand") renderDemand();
  if (view === "favorites") renderFavorites();
}

let metadataQueue = [];
let readingMetadata = false;
let metadataStartTimer = null;
let renderTimer = null;

function requestMetadata(video) {
  if (video.metadataRead || video.metadataQueued || video.externalOnly) return;
  video.metadataQueued = true;
  if (metadataQueue.length >= 150) metadataQueue.shift().metadataQueued = false;
  metadataQueue.push(video);
  if (!readingMetadata && !metadataStartTimer) metadataStartTimer = setTimeout(() => { metadataStartTimer = null; scanMetadata(); }, 0);
}

function readDuration(video) {
  return new Promise((resolve) => {
    try {
      const cached = Number(localStorage.getItem("airwave:duration:" + video.key));
      if (Number.isFinite(cached) && cached > 0) { video.duration = cached; video.metadataRead = true; video.metadataQueued = false; resolve(); return; }
    } catch (error) { /* Metadata can be read without local storage. */ }
    const probe = document.createElement(video.format === "MP3" ? "audio" : "video");
    const url = URL.createObjectURL(video.file);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      video.metadataRead = true;
      video.metadataQueued = false;
      clearTimeout(timer);
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        video.duration = probe.duration;
        try { localStorage.setItem("airwave:duration:" + video.key, String(video.duration)); } catch (error) { /* The session still retains the duration. */ }
      }
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(url);
      resolve();
    };
    const timer = setTimeout(finish, 5000);
    probe.preload = "metadata";
    probe.onloadedmetadata = finish;
    probe.onerror = finish;
    probe.src = url;
  });
}

async function scanMetadata() {
  if (readingMetadata) return;
  readingMetadata = true;
  while (metadataQueue.length) {
    $("library-status").textContent = `Reading visible media details · ${metadataQueue.length} queued`;
    await Promise.all(metadataQueue.splice(0, 2).map(readDuration));
    libraryVersion++;
    if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 250);
  }
  readingMetadata = false;
  $("library-status").textContent = "Ready · details load as you browse";
}

let folderImportQueue = Promise.resolve();
function chooseFolderImport(entries) {
  const result = folderImportQueue.then(() => new Promise((resolve, reject) => {
    const count = entries.filter((entry) => isVideo(entry.file || entry)).length;
    if (!count) { toast("No supported media files found in this folder."); resolve(); return; }
    $("import-count").textContent = `${count.toLocaleString()} media file${count === 1 ? "" : "s"} found. How should they appear in your guide?`;
    const dialog = $("import-dialog");
    dialog.returnValue = "cancel";
    dialog.onclose = async () => {
      dialog.onclose = null;
      try {
        if (["folder", "individual"].includes(dialog.returnValue)) await importFiles(entries, dialog.returnValue === "individual", false);
        resolve();
      } catch (error) { reject(error); }
    };
    dialog.showModal();
  }));
  folderImportQueue = result.catch(() => {});
  return result;
}

let importQueue = Promise.resolve();
function importFiles(entries, separateChannels = false, restoreFolders = true) {
  const result = importQueue.then(() => importBatch(entries, separateChannels, restoreFolders));
  importQueue = result.catch(() => {});
  return result;
}

async function importBatch(entries, separateChannels, restoreFolders) {
  const channelLookup = new Map(channels.map((channel) => [channel.path, channel]));
  let processed = 0;
  let added = 0;
  let supported = 0;
  for (const entry of entries) {
    if (++processed % 200 === 0) {
      $("library-status").textContent = `Importing ${processed.toLocaleString()} of ${entries.length.toLocaleString()} files...`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const file = entry.file || entry;
    if (!isVideo(file)) continue;
    supported++;
    const path = entry.path || file.webkitRelativePath || file.name;
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "My videos";
    const key = `${path}|${file.size}|${file.lastModified}`;
    if (knownFiles.has(key)) continue;
    knownFiles.add(key);
    let savedFolder = null;
    try {
      const saved = JSON.parse(localStorage.getItem("airwave:folder:" + key));
      if (saved && typeof saved.path === "string" && typeof saved.name === "string") savedFolder = saved;
    } catch (error) { /* Folder organization still works without local storage. */ }
    const destination = (restoreFolders && savedFolder) || (separateChannels
      ? { path: "airwave-video:" + key, name: titleOf(file) }
      : { path: folder, name: folder.split("/").pop() });
    if (!restoreFolders) {
      try { localStorage.setItem("airwave:folder:" + key, JSON.stringify(destination)); }
      catch (error) { /* The chosen import layout still works for this session. */ }
    }
    let channel = channelLookup.get(destination.path);
    if (!channel) {
      channel = { name: destination.name, path: destination.path, videos: [] };
      channelLookup.set(destination.path, channel);
      channels.push(channel);
    }
    let position = 0;
    try {
      const saved = Number(localStorage.getItem("airwave:position:" + key));
      if (Number.isFinite(saved) && saved > 0) position = saved;
    } catch (error) { /* Resume still works in memory when storage is unavailable. */ }
    const format = file.name.split(".").pop().toUpperCase();
    const video = { file, key, position, path, format, externalOnly: ["AVI", "FLV", "ISO"].includes(format), title: titleOf(file), url: null, duration: null };
    channel.videos.push(video);
    added++;
  }
  if (!added) {
    toast(supported ? "These videos are already in your lineup." : "No supported media found. Choose MP4, AVI, FLV, MKV, MP3, or ISO files.");
    return;
  }
  channels.forEach((channel) => channel.videos.sort((a, b) => fileCollator.compare(a.file.name, b.file.name)));
  channels.sort((a, b) => fileCollator.compare(a.path, b.path));
  libraryVersion++;
  relinkFavorites();
  render();
  toast(`${added} video${added === 1 ? "" : "s"} added. Your lineup is ready.`);
  $("library-status").textContent = "Ready · details load as you browse";
}

function savePlaybackPosition(source) {
  const player = source instanceof HTMLMediaElement ? source : activeVideo === selectedVideo && !$("guide-preview").paused ? $("guide-preview") : $("player");
  if (!activeVideo || player.readyState < 1 || !Number.isFinite(player.currentTime)) return;
  activeVideo.position = player.ended ? 0 : player.currentTime;
  try {
    localStorage.setItem("airwave:position:" + activeVideo.key, String(activeVideo.position));
  } catch (error) { /* Keep the in-memory position if local storage is unavailable. */ }
}

function playVideo(channel, selection, program = null) {
  savePlaybackPosition();
  $("guide-preview").pause();
  $("player").pause();
  activeChannel = channel;
  const video = typeof selection === "number" ? channel.videos[selection] : selection;
  activeVideo = video;
  activeProgram = program;
  $("player-favorite").dataset.favoriteKey = video.key;
  syncFavoriteButtons();
  selectProgram(channel, video);
  $("player-channel").textContent = `CHANNEL ${String(channels.indexOf(channel) + 1).padStart(2, "0")} / ${channel.name}`;
  $("player-title").textContent = video.title;
  $("player-position").textContent = `Channel ${channels.indexOf(channel) + 1} of ${channels.length}`;
  $("player-error").hidden = true;
  $("next-video").disabled = channels.length < 2;
  $("previous-video").disabled = channels.length < 2;
  $("player").removeAttribute("src");
  $("player").load();
  if (!video.externalOnly) $("player").src = mediaURL(video);
  if (!$("player-dialog").open) {
    $("player-demand").open = false;
    playerDemandPage = 0;
    $("player-search").value = "";
    $("player-dialog").showModal();
  }
  if ($("player-demand").open) renderDemand($("player-demand-list"));
  if (video.externalOnly) {
    showPlaybackError();
    showVLC();
    return;
  }
  $("player").play().catch((error) => {
    if (error.name !== "NotAllowedError" && error.name !== "AbortError") showPlaybackError();
  });
}

function showPlaybackError() {
  $("player-error").textContent = "This format or codec needs an external player. Use Open in VLC above. MP4, MP3, and browser-compatible MKV files can play here; AVI, FLV, and ISO use VLC. VLC playback positions cannot be tracked by this page.";
  $("player-error").hidden = false;
}

function changeChannel(direction) {
  if (!activeChannel || !channels.length) return;
  const channel = channels[(channels.indexOf(activeChannel) + direction + channels.length) % channels.length];
  const program = programsBetween(channel, offset, offset + WINDOW_MINUTES, 1)[0];
  playVideo(channel, program.video, program);
}

function nextVideo() { changeChannel(1); }
function previousVideo() { changeChannel(-1); }

function changeProgram(direction) {
  if (!activeChannel || !activeVideo) return;
  if (activeProgram) {
    let point = direction > 0 ? activeProgram.end + 0.0000001 : activeProgram.start - 0.0000001;
    if (point >= MONTH_MINUTES) point = 0;
    if (point < 0) point = MONTH_MINUTES - 0.0000001;
    const program = programsBetween(activeChannel, point, point + WINDOW_MINUTES, 1)[0];
    if (program) playVideo(activeChannel, program.video, program);
  } else {
    const schedule = scheduleFor(activeChannel);
    const index = schedule.indices.get(activeVideo) ?? 0;
    const next = (index + direction + schedule.playlist.length) % schedule.playlist.length;
    playVideo(activeChannel, schedule.playlist[next]);
  }
}

function playNextProgram() { changeProgram(1); }

$("add-folder").onclick = $("empty-add").onclick = () => $("folder-input").click();
$("add-files").onclick = () => $("files-input").click();
for (const input of [$("folder-input"), $("files-input")]) {
  input.onchange = async () => {
    const files = Array.from(input.files);
    input.value = "";
    try {
      if (input === $("folder-input")) await chooseFolderImport(files);
      else await importFiles(files, true);
    }
    catch (error) { toast("Import could not finish. Please try again."); }
  };
}
$("guide-tab").onclick = () => setView("guide");
$("demand-tab").onclick = () => { demandChannel = null; setView("demand"); };
$("favorites-tab").onclick = () => { $("search").value = ""; setView("favorites"); };
for (const name of ["guide", "demand", "favorites"]) {
  $(`${name}-tab`).onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = ["guide", "demand", "favorites"];
    const next = event.key === "Home" ? "guide" : event.key === "End" ? "favorites" : tabs[(tabs.indexOf(name) + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length];
    setView(next);
    $(`${next}-tab`).focus();
  };
}
let searchTimer;
$("search").oninput = () => { demandPage = 0; favPage = 0; favFolderPage = 0; clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (view === "favorites") renderFavorites(); else renderDemand(); }, 150); };
let playerSearchTimer;
$("player-search").oninput = () => { playerDemandPage = 0; clearTimeout(playerSearchTimer); playerSearchTimer = setTimeout(() => renderDemand($("player-demand-list")), 150); };
$("player-demand").addEventListener("toggle", () => {
  if ($("player-demand").open) renderDemand($("player-demand-list"));
});
$("earlier").onclick = () => { offset = Math.max(0, offset - WINDOW_MINUTES); renderGuide(); };
$("later").onclick = () => { offset = Math.min(MONTH_MINUTES - WINDOW_MINUTES, offset + WINDOW_MINUTES); renderGuide(); };
$("now").onclick = () => { offset = Math.min(MONTH_MINUTES - WINDOW_MINUTES, Math.max(0, Math.floor((Date.now() - anchor) / 1800000) * 30)); renderGuide(); };
$("guide-day").onchange = () => {
  const date = new Date($("guide-day").value + "T00:00:00");
  if (!Number.isFinite(date.getTime())) return;
  offset = Math.max(0, Math.min(MONTH_MINUTES - WINDOW_MINUTES, (date.getTime() - anchor) / 60000));
  renderGuide();
};
$("close-player").onclick = () => $("player-dialog").close();
$("player-dialog").addEventListener("close", () => {
  savePlaybackPosition();
  activeVideo = null;
  activeChannel = null;
  activeProgram = null;
  $("player-demand").open = false;
  $("player").pause();
  $("player").removeAttribute("src");
  $("player").load();
});
$("player-dialog").addEventListener("click", (event) => { if (event.target === $("player-dialog")) { const box = $("player-dialog").getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $("player-dialog").close(); } });
$("next-video").onclick = nextVideo;
$("previous-video").onclick = previousVideo;
$("next-program").onclick = () => changeProgram(1);
$("previous-program").onclick = () => changeProgram(-1);
$("player").addEventListener("loadedmetadata", () => {
  if (!activeVideo) return;
  const duration = $("player").duration;
  if (Number.isFinite(duration) && duration > 0 && activeVideo.duration !== duration) {
    activeVideo.duration = duration;
    activeVideo.metadataRead = true;
    libraryVersion++;
  }
  const position = activeVideo.position;
  $("player").currentTime = position < $("player").duration ? position : 0;
});
$("player").addEventListener("pause", savePlaybackPosition);
window.addEventListener("pagehide", savePlaybackPosition);
$("player").addEventListener("ended", playNextProgram);
$("player").addEventListener("error", () => { if ($("player").hasAttribute("src")) showPlaybackError(); });

const vlcRoots = new Map();

function showVLC() {
  if (!activeVideo) return;
  $("player").pause();
  $("vlc-file").textContent = activeVideo.file.name;
  const parent = activeVideo.path.includes("/") ? activeVideo.path.slice(0, activeVideo.path.lastIndexOf("/")) : "";
  $("vlc-path").value = activeVideo.localPath || (parent && vlcRoots.has(parent) ? vlcRoots.get(parent) + encodeURIComponent(activeVideo.file.name) : "");
  $("vlc-path").setCustomValidity("");
  if (!$("vlc-dialog").open) $("vlc-dialog").showModal();
}

function vlcFileURL(value) {
  const path = value.trim().split(String.fromCharCode(92)).join("/");
  if (!path || Array.from(path).some((char) => char.charCodeAt(0) < 32)) throw new Error("Enter the full local file path.");
  let url;
  if (path.startsWith("file://")) url = new URL(path);
  else if (/^[a-z]:/i.test(path) && path[2] === "/") url = new URL("file:///" + path.split("/").map((part, index) => index === 0 ? part : encodeURIComponent(part)).join("/"));
  else if (path.startsWith("//")) url = new URL("file:" + path.split("/").map((part, index) => index < 3 ? part : encodeURIComponent(part)).join("/"));
  else if (path.startsWith("/")) url = new URL("file://" + path.split("/").map(encodeURIComponent).join("/"));
  else throw new Error("Enter an absolute path, such as C:/Videos/movie.iso or /home/you/Videos/movie.iso.");
  if (url.protocol !== "file:") throw new Error("Only local file paths are allowed.");
  return url.href;
}

function vlcTarget() {
  const input = $("vlc-path");
  try {
    const url = vlcFileURL(input.value);
    input.setCustomValidity("");
    activeVideo.localPath = url;
    const parent = activeVideo.path.includes("/") ? activeVideo.path.slice(0, activeVideo.path.lastIndexOf("/")) : "";
    if (parent) vlcRoots.set(parent, url.slice(0, url.lastIndexOf("/") + 1));
    return url;
  } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); return null; }
}

$("open-vlc").onclick = showVLC;
$("close-vlc").onclick = () => $("vlc-dialog").close();
$("vlc-path").oninput = () => $("vlc-path").setCustomValidity("");
$("vlc-form").onsubmit = (event) => {
  event.preventDefault();
  const url = vlcTarget();
  if (url) window.location.href = "vlc://" + url;
};
$("vlc-playlist").onclick = () => {
  const target = vlcTarget();
  if (!target) return;
  const newline = String.fromCharCode(10);
  const title = Array.from(activeVideo.title).filter((char) => char.charCodeAt(0) >= 32).join("");
  const contents = ["#EXTM3U", "#EXTINF:-1," + title, "#EXTVLCOPT:start-time=" + Math.floor(activeVideo.position || 0), target, ""].join(newline);
  downloadPlaylist(contents, activeVideo.title.replace(/[<>:"|?*]/g, "_") + ".m3u8");
};

function downloadPlaylist(contents, name) {
  const url = URL.createObjectURL(new Blob([contents], { type: "audio/x-mpegurl;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let playlistChannel = null;
let playlistRoot = "";

function playlistVideos() {
  if ($("playlist-scope").value === "favorites") return favoritePlaylistVideos();
  if ($("playlist-scope").value === "all") return channels.flatMap((channel) => channel.videos);
  if (!playlistChannel) return [];
  const schedule = scheduleFor(playlistChannel);
  const videos = [schedule.first];
  for (let i = 0; i < schedule.playlist.length - 1; i++) videos.push(schedule.playlist[(schedule.rotation + i) % schedule.playlist.length]);
  return videos;
}

function updatePlaylistSummary() {
  const videos = playlistVideos();
  $("playlist-count").textContent = `${videos.length.toLocaleString()} file${videos.length === 1 ? "" : "s"}, in playback order. Each file is included once.`;
  const sample = videos.find((video) => !video.localPath) || videos[0];
  $("playlist-path-example").textContent = sample ? `Example path: [media base folder]/${sample.path}` : "";
  $("playlist-root").setCustomValidity("");
}

function showPlaylistExport(scope = "channel") {
  if (!channels.length && !favItems.size) { toast("Add media or favorites before exporting a playlist."); return; }
  playlistChannel = activeChannel || selectedChannel || channels[0] || null;
  $("playlist-scope").value = playlistChannel && scope !== "favorites" ? "channel" : "favorites";
  $("playlist-root").value = playlistRoot;
  updatePlaylistSummary();
  $("playlist-dialog").showModal();
}

function buildVLCPlaylist(videos, basePath) {
  const lines = ["#EXTM3U"];
  let root = null;
  for (const video of videos) {
    const parent = video.path.includes("/") ? video.path.slice(0, video.path.lastIndexOf("/")) : "";
    let target;
    if (video.localPath) target = vlcFileURL(video.localPath);
    else if (parent && vlcRoots.has(parent)) target = vlcRoots.get(parent) + encodeURIComponent(video.file.name);
    else {
      if (!root) {
        if (!basePath.trim()) throw new Error("Enter the full media base folder path so VLC can find the original files.");
        root = vlcFileURL(basePath);
        if (!root.endsWith("/")) root += "/";
      }
      target = new URL(video.path.split("/").map(encodeURIComponent).join("/"), root).href;
    }
    const title = Array.from(video.title).filter((char) => char.charCodeAt(0) >= 32).join("");
    lines.push(`#EXTINF:${Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration) : -1},${title}`, target);
  }
  return lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

$("export-playlist").onclick = () => showPlaylistExport();
$("player-export-playlist").onclick = () => showPlaylistExport();
$("cancel-playlist").onclick = () => $("playlist-dialog").close();
$("playlist-scope").onchange = updatePlaylistSummary;
$("playlist-root").oninput = () => $("playlist-root").setCustomValidity("");
$("playlist-form").onsubmit = (event) => {
  event.preventDefault();
  try {
    const videos = playlistVideos();
    if (!videos.length) throw new Error("Choose a playlist scope that contains media.");
    const contents = buildVLCPlaylist(videos, $("playlist-root").value);
    downloadPlaylist(contents, "locatube.m3u8");
    playlistRoot = $("playlist-root").value;
    $("playlist-dialog").close();
    toast(`VLC playlist exported with ${videos.length.toLocaleString()} files.`);
  } catch (error) {
    $("playlist-root").setCustomValidity(error.message);
    $("playlist-root").reportValidity();
  }
};

async function readDroppedEntries(roots) {
  const pending = roots.map((entry) => ({ entry, parent: "" }));
  const files = [];
  while (pending.length) {
    const batch = pending.splice(Math.max(0, pending.length - 16), 16);
    await Promise.all(batch.map(async ({ entry, parent }) => {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        files.push({ file, path: parent + file.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        while (true) {
          const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          if (!children.length) break;
          for (const child of children) pending.push({ entry: child, parent: parent + entry.name + "/" });
        }
      }
    }));
  }
  return files;
}

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  if (!Array.from(event.dataTransfer.types).includes("Files")) return;
  event.preventDefault();
  dragDepth++;
  $("drop-overlay").hidden = false;
});
window.addEventListener("dragover", (event) => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("drop-overlay").hidden = true; });
window.addEventListener("drop", async (event) => {
  if (!Array.from(event.dataTransfer.types).includes("Files")) return;
  event.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  const items = Array.from(event.dataTransfer.items || []);
  const fallback = Array.from(event.dataTransfer.files);
  const roots = items.map((item) => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null).filter(Boolean);
  try {
    const entries = roots.length ? await readDroppedEntries(roots) : fallback;
    const hasFolders = roots.some((entry) => entry.isDirectory) || entries.some((entry) => (entry.path || entry.webkitRelativePath || "").includes("/"));
    if (hasFolders) await chooseFolderImport(entries);
    else await importFiles(entries, true);
  } catch (error) {
    toast("Could not read this folder. Try the Add video folder button instead.");
  }
});

$("save-app").onclick = async () => {
  const button = $("save-app");
  button.disabled = true;
  try {
    const fetchText = async (path) => { const response = await fetch(path); if (!response.ok) throw new Error("Download failed"); return response.text(); };
    const [html, css, favoritesJS, viewsJS, appJS] = await Promise.all([fetchText("index.html"), fetchText("style.css"), fetchText("favorites.js"), fetchText("views.js"), fetchText("app.js")]);
    const js = [favoritesJS, viewsJS, appJS].join(String.fromCharCode(10) + ";" + String.fromCharCode(10));
    const page = new DOMParser().parseFromString(html, "text/html");
    const style = page.createElement("style");
    style.textContent = css;
    page.querySelector("link[rel=stylesheet]").replaceWith(style);
    page.querySelectorAll("script, iframe").forEach((node) => node.remove());
    const script = page.createElement("script");
    script.id = "offline-code";
    script.textContent = js.split("</script").join("<" + String.fromCharCode(92) + "/script");
    page.body.append(script);
    const standalone = "<!DOCTYPE html>" + page.documentElement.outerHTML;
    const url = URL.createObjectURL(new Blob([standalone], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "locatube.html";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast("Open locatube.html anytime, even offline. Select your video folders again when you reopen it.");
  } catch (error) {
    toast("Could not save the offline app. Please try again while connected.");
  } finally { button.disabled = false; }
};

function initialize() {
  initializeFavorites();
  initializeViews();
  if (document.getElementById("offline-code")) $("save-app").hidden = true;
  for (const name of ["guide", "demand", "favorites"]) $(`${name}-tab`).tabIndex = name === view ? 0 : -1;
  const updateClock = () => { $("clock").textContent = timeFormat.format(new Date()); };
  updateClock();
  setInterval(updateClock, 10000);
  render();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
else initialize();
