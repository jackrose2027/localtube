"use strict";

const favItems = new Map();
const favFolders = new Set();
const favLinks = new Map();
const favMediaKeys = new Map();
const favSelected = new Set();
let favFolder = "";
let favPage = 0;
let favFolderPage = 0;
let favRenamePath = null;
let favDraggedKey = null;
let favDraggedFolder = null;
let favStorageWarning = false;

function normalizeFavoriteFolder(path) {
  if (typeof path !== "string" || path.length > 2000) throw new Error("Invalid favorites folder path.");
  if (!path) return "";
  const parts = path.split("/");
  if (parts.length > 64 || parts.some((part) => !part || part !== part.trim() || [".", ".."].includes(part) || part.includes(String.fromCharCode(92)) || Array.from(part).some((char) => char.charCodeAt(0) < 32))) throw new Error("Use folder names separated by /, without empty names or dot segments.");
  return parts.join("/");
}

function addFavoriteParents(path, folders = favFolders) {
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
}

function validateFavoriteManifest(data) {
  if (!data || data.type !== "airwave-favorites" || data.version !== 1 || !Array.isArray(data.folders) || !Array.isArray(data.items) || data.folders.length > 10000 || data.items.length > 50000) throw new Error("Choose a locatube favorites playlist (version 1).");
  const folders = new Set();
  const items = new Map();
  for (const folder of data.folders) addFavoriteParents(normalizeFavoriteFolder(folder), folders);
  for (const item of data.items) {
    if (!item || typeof item.name !== "string" || item.name.length > 500 || !isVideo({ name: item.name }) || typeof item.path !== "string" || !item.path || item.path.length > 6000 || typeof item.title !== "string" || item.title.length > 1024 || !Number.isSafeInteger(item.size) || item.size < 0 || !Number.isSafeInteger(item.lastModified) || item.lastModified < 0) throw new Error("The playlist contains an invalid media reference.");
    const key = `${item.path}|${item.size}|${item.lastModified}`;
    if (item.key !== key || items.has(key)) throw new Error("The playlist contains an invalid or duplicate file identifier.");
    const folder = normalizeFavoriteFolder(item.folder);
    addFavoriteParents(folder, folders);
    const localPath = item.localPath ? vlcFileURL(item.localPath) : "";
    items.set(key, { key, title: item.title, name: item.name, path: item.path, size: item.size, lastModified: item.lastModified, folder, localPath, duration: Number.isFinite(item.duration) && item.duration > 0 ? item.duration : null });
  }
  if (folders.size > 10000) throw new Error("This playlist contains too many favorites folders.");
  return { folders, items };
}

function favoriteManifest() {
  return { type: "airwave-favorites", version: 1, folders: Array.from(favFolders), items: Array.from(favItems.values(), (record) => {
    const link = favLinks.get(record.key);
    return { ...record, duration: link && link.video.duration || record.duration, localPath: link && link.video.localPath || record.localPath || "" };
  }) };
}

function persistFavorites() {
  try { localStorage.setItem("airwave:favorites:v1", JSON.stringify(favoriteManifest())); favStorageWarning = false; }
  catch (error) {
    if (!favStorageWarning) toast("Favorites work for this session, but local storage is full or unavailable. Export locatube to keep a backup.");
    favStorageWarning = true;
  }
}

function relinkFavorites() {
  const byKey = new Map();
  const byIdentity = new Map();
  for (const channel of channels) {
    for (const video of channel.videos) {
      const link = { channel, video };
      byKey.set(video.key, link);
      const identity = `${video.file.name}|${video.file.size}|${video.file.lastModified}`;
      byIdentity.set(identity, byIdentity.has(identity) ? null : link);
    }
  }
  const identities = new Map();
  for (const record of favItems.values()) {
    const identity = `${record.name}|${record.size}|${record.lastModified}`;
    identities.set(identity, (identities.get(identity) || 0) + 1);
  }
  favLinks.clear();
  favMediaKeys.clear();
  for (const record of favItems.values()) {
    const identity = `${record.name}|${record.size}|${record.lastModified}`;
    const link = byKey.get(record.key) || (identities.get(identity) === 1 ? byIdentity.get(identity) : null);
    if (link) { favLinks.set(record.key, link); favMediaKeys.set(link.video.key, record.key); }
  }
  syncFavoriteButtons();
}

function favoriteButton(video) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "favorite-toggle";
  button.dataset.favoriteKey = video.key;
  button.onclick = (event) => { event.stopPropagation(); toggleFavorite(video); };
  const favorite = favItems.has(favMediaKeys.get(video.key) || video.key);
  button.textContent = favorite ? "★" : "☆";
  button.setAttribute("aria-pressed", String(favorite));
  button.setAttribute("aria-label", (favorite ? "Remove " : "Add ") + video.title + (favorite ? " from favorites" : " to favorites"));
  button.title = favorite ? "Remove from favorites" : "Add to favorites";
  return button;
}

function syncFavoriteButtons() {
  $("export-playlist").disabled = channels.length === 0 && favItems.size === 0;
  document.querySelectorAll("[data-favorite-key]").forEach((button) => {
    const favorite = favItems.has(favMediaKeys.get(button.dataset.favoriteKey) || button.dataset.favoriteKey);
    button.textContent = favorite ? "★" + (button.dataset.favoriteLabel ? " Favorited" : "") : "☆" + (button.dataset.favoriteLabel ? " Favorite" : "");
    button.setAttribute("aria-pressed", String(favorite));
    button.setAttribute("aria-label", favorite ? "Remove from favorites" : "Add to favorites");
    button.title = favorite ? "Remove from favorites" : "Add to favorites";
  });
}

function toggleFavorite(video) {
  if (!video) return;
  const key = favMediaKeys.get(video.key) || video.key;
  if (favItems.has(key)) { favItems.delete(key); favSelected.delete(key); }
  else favItems.set(video.key, { key: video.key, title: video.title, name: video.file.name, path: video.path, size: video.file.size, lastModified: video.file.lastModified, folder: "", localPath: video.localPath || "", duration: video.duration || null });
  relinkFavorites();
  persistFavorites();
  if (view === "favorites") renderFavorites();
}

function favoriteInFolder(record, folder = favFolder) {
  return !folder || record.folder === folder || record.folder.startsWith(folder + "/");
}

function favoritePlaylistVideos() {
  return Array.from(favItems.values()).filter((record) => favoriteInFolder(record)).map((record) => {
    const link = favLinks.get(record.key);
    return { ...(link ? link.video : record), path: record.path, title: record.title, file: link ? link.video.file : { name: record.name, size: record.size, lastModified: record.lastModified }, localPath: link && link.video.localPath || record.localPath || "", duration: link && link.video.duration || record.duration };
  });
}

function relocateFavoriteFolder(from, to) {
  to = normalizeFavoriteFolder(to);
  if (!from || !favFolders.has(from)) throw new Error("Choose a favorites folder to move.");
  if (to === from) return;
  if (!to || to.startsWith(from + "/")) throw new Error("A folder cannot be moved inside itself.");
  if (favFolders.has(to)) throw new Error("A favorites folder with that name already exists.");
  const folders = Array.from(favFolders);
  for (const path of folders) {
    if (path === from || path.startsWith(from + "/")) { favFolders.delete(path); favFolders.add(to + path.slice(from.length)); }
  }
  addFavoriteParents(to);
  for (const record of favItems.values()) if (record.folder === from || record.folder.startsWith(from + "/")) record.folder = to + record.folder.slice(from.length);
  if (favFolder === from || favFolder.startsWith(from + "/")) favFolder = to + favFolder.slice(from.length);
}

function wireFavoriteDrop(element, folder) {
  element.addEventListener("dragover", (event) => {
    if (!favDraggedKey && favDraggedFolder === null) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; element.classList.add("drag-target");
  });
  element.addEventListener("dragleave", (event) => { if (!element.contains(event.relatedTarget)) element.classList.remove("drag-target"); });
  element.addEventListener("drop", (event) => {
    if (!favDraggedKey && favDraggedFolder === null) return;
    event.preventDefault(); event.stopPropagation();
    try {
      if (favDraggedKey && favItems.has(favDraggedKey)) favItems.get(favDraggedKey).folder = folder;
      else if (favDraggedFolder !== null) relocateFavoriteFolder(favDraggedFolder, (folder ? folder + "/" : "") + favDraggedFolder.split("/").pop());
      favDraggedKey = null; favDraggedFolder = null;
      persistFavorites(); renderFavorites();
    } catch (error) { toast(error.message); }
    element.classList.remove("drag-target");
  });
}

function openFavoriteFolder(folder) { favFolder = folder; favPage = 0; favFolderPage = 0; $("search").value = ""; renderFavorites(); }

function renderFavorites() {
  const crumbs = $("favorite-breadcrumbs");
  crumbs.replaceChildren();
  const crumb = (label, path) => {
    const button = document.createElement("button"); button.className = "quiet"; button.textContent = label; button.onclick = () => openFavoriteFolder(path); wireFavoriteDrop(button, path); crumbs.append(button);
  };
  crumb("All favorites", "");
  const parts = favFolder.split("/").filter(Boolean);
  parts.forEach((part, index) => { const separator = document.createElement("span"); separator.textContent = "/"; crumbs.append(separator); crumb(part, parts.slice(0, index + 1).join("/")); });
  $("favorite-rename-folder").disabled = !favFolder;
  $("favorite-remove-folder").disabled = !favFolder;
  $("favorite-move-selected").disabled = !favSelected.size;
  $("favorite-move-selected").textContent = `Move selected here${favSelected.size ? " (" + favSelected.size + ")" : ""}`;
  $("favorite-export-vlc").disabled = !Array.from(favItems.values()).some((record) => favoriteInFolder(record));
  const query = $("search").value.trim().toLocaleLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const children = Array.from(favFolders).filter((path) => {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    return query ? (!favFolder || path.startsWith(favFolder + "/")) && path.toLocaleLowerCase().includes(query) : parent === favFolder;
  }).sort(fileCollator.compare);
  const folders = $("favorite-folders"); folders.replaceChildren(); folders.hidden = children.length === 0;
  favFolderPage = Math.min(favFolderPage, Math.max(0, Math.ceil(children.length / PAGE_SIZE) - 1));
  children.slice(favFolderPage * PAGE_SIZE, (favFolderPage + 1) * PAGE_SIZE).forEach((path) => {
    const button = document.createElement("button"); button.className = "favorite-folder"; button.textContent = "▱ " + (query ? path : path.split("/").pop()); button.title = path; button.onclick = () => openFavoriteFolder(path);
    button.draggable = true;
    button.addEventListener("dragstart", (event) => { favDraggedFolder = path; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/x-airwave-favorite-folder", path); });
    button.addEventListener("dragend", () => { favDraggedFolder = null; });
    wireFavoriteDrop(button, path); folders.append(button);
  });
  const folderPages = document.createElement("div"); folderPages.className = "page-controls"; pageControls(folderPages, favFolderPage, children.length, (page) => { favFolderPage = page; renderFavorites(); }); folders.append(folderPages);
  const records = Array.from(favItems.values()).filter((record) => (query ? favoriteInFolder(record) : record.folder === favFolder) && terms.every((term) => `${record.title} ${record.name} ${record.path} ${record.folder}`.toLocaleLowerCase().includes(term)));
  const missing = Array.from(favItems.keys()).filter((key) => !favLinks.has(key)).length;
  $("favorite-status").textContent = `${favItems.size.toLocaleString()} favorites · ${records.length.toLocaleString()} in this view${missing ? " · " + missing.toLocaleString() + " need their original files re-added to play" : ""}`;
  const root = $("favorite-items"); root.replaceChildren();
  const list = document.createElement("ul"); list.className = "video-list"; root.append(list);
  favPage = Math.min(favPage, Math.max(0, Math.ceil(records.length / PAGE_SIZE) - 1));
  records.slice(favPage * PAGE_SIZE, (favPage + 1) * PAGE_SIZE).forEach((record) => {
    const link = favLinks.get(record.key);
    if (link) requestMetadata(link.video);
    const item = document.createElement("li"); item.className = "media-list-item favorite-item";
    const select = document.createElement("input"); select.type = "checkbox"; select.checked = favSelected.has(record.key); select.setAttribute("aria-label", "Select " + record.title + " to move");
    select.onchange = () => { if (select.checked) favSelected.add(record.key); else favSelected.delete(record.key); $("favorite-move-selected").disabled = !favSelected.size; $("favorite-move-selected").textContent = `Move selected here (${favSelected.size})`; };
    const play = document.createElement("button"); play.className = "video-row";
    const duration = link && link.video.duration || record.duration;
    play.innerHTML = `<span class="video-play" aria-hidden="true">&#9655;</span><span class="video-title">${escapeHTML(record.title)}<small>${escapeHTML(record.folder || "Unfiled")}${link ? "" : " · Re-add file to play"}</small></span><span class="video-duration">${duration ? escapeHTML(durationLabel(duration)) : "Unknown"}</span>`;
    play.onclick = () => { if (link) playVideo(link.channel, link.video); else { toast("Select the original media file to reconnect this favorite."); $("files-input").click(); } };
    item.draggable = true;
    item.addEventListener("dragstart", (event) => { favDraggedKey = record.key; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/x-airwave-favorite", record.key); });
    item.addEventListener("dragend", () => { favDraggedKey = null; });
    item.append(select, play, favoriteButton(link ? link.video : { ...record, file: { name: record.name, size: record.size, lastModified: record.lastModified } }));
    list.append(item);
  });
  if (!records.length) { const empty = document.createElement("p"); empty.className = "no-results"; empty.textContent = favItems.size ? "No favorites here. Drag favorites into a folder, or select them and use Move selected here." : "Star a video in the library or player to add a favorite."; root.append(empty); }
  const pages = document.createElement("div"); pages.className = "page-controls"; pageControls(pages, favPage, records.length, (page) => { favPage = page; renderFavorites(); }); root.append(pages);
}

function initializeFavorites() {
  try {
    const saved = localStorage.getItem("airwave:favorites:v1");
    if (saved) { const parsed = validateFavoriteManifest(JSON.parse(saved)); parsed.folders.forEach((path) => favFolders.add(path)); parsed.items.forEach((item, key) => favItems.set(key, item)); }
  } catch (error) { toast("Saved favorites could not be loaded. Import an locatube backup to restore them."); }
  relinkFavorites();
  $("player-favorite").onclick = () => toggleFavorite(activeVideo);
  $("favorite-new-folder").onclick = () => {
    favRenamePath = null; $("favorite-folder-title").textContent = "New favorites folder"; $("favorite-folder-name").value = ""; $("favorite-folder-parent").textContent = "Inside: " + (favFolder || "All favorites") + ". Use / to create subfolders."; $("favorite-folder-name").setCustomValidity(""); $("favorite-folder-dialog").showModal();
  };
  $("favorite-rename-folder").onclick = () => {
    if (!favFolder) return; favRenamePath = favFolder; $("favorite-folder-title").textContent = "Rename favorites folder"; $("favorite-folder-name").value = favFolder.split("/").pop(); $("favorite-folder-parent").textContent = "Subfolders and favorites will move with it."; $("favorite-folder-name").setCustomValidity(""); $("favorite-folder-dialog").showModal();
  };
  $("favorite-folder-cancel").onclick = () => $("favorite-folder-dialog").close();
  $("favorite-folder-name").oninput = () => $("favorite-folder-name").setCustomValidity("");
  $("favorite-folder-form").onsubmit = (event) => {
    event.preventDefault();
    try {
      const parent = favRenamePath ? favRenamePath.slice(0, Math.max(0, favRenamePath.lastIndexOf("/"))) : favFolder;
      const name = $("favorite-folder-name").value.trim(); if (!name) throw new Error("Enter a folder name.");
      const path = normalizeFavoriteFolder((parent ? parent + "/" : "") + name);
      if (favRenamePath) relocateFavoriteFolder(favRenamePath, path);
      else { if (favFolders.has(path)) throw new Error("That folder already exists."); addFavoriteParents(path); }
      persistFavorites(); $("favorite-folder-dialog").close(); renderFavorites();
    } catch (error) { $("favorite-folder-name").setCustomValidity(error.message); $("favorite-folder-name").reportValidity(); }
  };
  $("favorite-remove-folder").onclick = () => {
    if (!favFolder || !window.confirm("Remove this favorites folder and its subfolders? Its videos stay favorited and move to the parent folder. Original media files are never changed.")) return;
    const from = favFolder; const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    for (const record of favItems.values()) if (favoriteInFolder(record, from)) record.folder = parent;
    for (const folder of Array.from(favFolders)) if (folder === from || folder.startsWith(from + "/")) favFolders.delete(folder);
    favFolder = parent; persistFavorites(); renderFavorites();
  };
  $("favorite-move-selected").onclick = () => { for (const key of favSelected) if (favItems.has(key)) favItems.get(key).folder = favFolder; favSelected.clear(); persistFavorites(); renderFavorites(); };
  $("favorite-export-vlc").onclick = () => showPlaylistExport("favorites");
  $("favorite-export-airwave").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(favoriteManifest(), null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "locatube.favorites.json"; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  $("favorite-import").onclick = () => $("favorite-import-input").click();
  $("favorite-import-input").onchange = async () => {
    const file = $("favorite-import-input").files[0]; $("favorite-import-input").value = ""; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Choose a locatube playlist smaller than 10 MB.");
      const data = validateFavoriteManifest(JSON.parse(await file.text()));
      data.folders.forEach((path) => favFolders.add(path)); data.items.forEach((item, key) => favItems.set(key, item));
      favFolder = ""; favPage = 0; favFolderPage = 0; relinkFavorites(); persistFavorites(); $("search").value = ""; setView("favorites"); toast(`Imported ${data.items.size.toLocaleString()} favorites. Re-add original media files to reconnect any missing videos.`);
    } catch (error) { toast(error.message); }
  };
}
