const elements = {
  title: document.querySelector("#page-title"),
  homeLink: document.querySelector(".home-link"),
  status: document.querySelector("#status"),
  albumList: document.querySelector("#album-list"),
  wall: document.querySelector("#photo-wall"),
  settingsButton: document.querySelector("#settings-button"),
  settingsBackdrop: document.querySelector("#settings-backdrop"),
  settingsPanel: document.querySelector("#settings-panel"),
  random: document.querySelector("#random-order"),
  reverse: document.querySelector("#reverse-order"),
  showName: document.querySelector("#show-name"),
  showTime: document.querySelector("#show-time"),
  count: document.querySelector("#photo-count"),
  lightbox: document.querySelector("#lightbox"),
  lightboxImage: document.querySelector("#lightbox-image"),
  lightboxName: document.querySelector("#lightbox-name"),
  lightboxTime: document.querySelector("#lightbox-time"),
  lightboxPrevious: document.querySelector("#lightbox-previous"),
  lightboxNext: document.querySelector("#lightbox-next"),
  lightboxClose: document.querySelector("#lightbox-close")
};

const state = {
  photos: [],
  visiblePhotos: [],
  shuffledPhotos: null,
  activeIndex: -1,
  returnFocus: null
};

function pathParts() {
  return location.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

function setStatus(message, kind = "info") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
  elements.status.hidden = false;
}

function clearStatus() {
  elements.status.hidden = true;
  elements.status.textContent = "";
  delete elements.status.dataset.kind;
}

function tiltFromId(id, range = 3.6) {
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
  return (((Math.abs(hash) % 1000) / 999) * range * 2 - range).toFixed(2) + "deg";
}

function liftFromId(id) {
  let value = 0;
  for (const character of id) value = (value + character.codePointAt(0)) % 4;
  return `${value * 12}px`;
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[otherIndex]] = [result[otherIndex], result[index]];
  }
  return result;
}

function currentPhotos() {
  if (elements.random.checked) {
    state.shuffledPhotos ??= shuffle(state.photos);
    return [...state.shuffledPhotos];
  }
  const photos = [...state.photos];
  return elements.reverse.checked ? photos.reverse() : photos;
}

function createPhotoCard(photo, index) {
  const card = document.createElement("button");
  card.className = "photo-card";
  card.type = "button";
  card.dataset.photoId = photo.id;
  card.setAttribute("aria-label", `View ${photo.name}`);
  card.style.setProperty("--tilt", tiltFromId(photo.id));
  card.style.setProperty("--lift", liftFromId(photo.id));
  const displayWidth = Math.min(540, Math.round((photo.width / photo.height) * 300));
  card.style.setProperty("--card-width", `${Math.ceil(displayWidth / 0.88235)}px`);

  const frame = document.createElement("span");
  frame.className = "photo-frame";
  frame.style.aspectRatio = `${photo.width} / ${photo.height}`;

  const image = document.createElement("img");
  image.src = photo.src;
  image.alt = photo.name;
  image.width = photo.width;
  image.height = photo.height;
  image.decoding = "async";
  image.loading = index < 2 ? "eager" : "lazy";
  if (index < 2) image.fetchPriority = "high";
  image.addEventListener("load", () => image.classList.add("is-loaded"), { once: true });
  image.addEventListener("error", () => {
    image.classList.add("is-broken");
    frame.setAttribute("aria-label", `${photo.name} failed to load`);
  }, { once: true });
  if (image.complete && image.naturalWidth) image.classList.add("is-loaded");

  const meta = document.createElement("span");
  meta.className = "photo-meta";

  const name = document.createElement("span");
  name.className = "photo-name";
  name.textContent = photo.name;
  name.hidden = !elements.showName.checked;

  const time = document.createElement("time");
  time.className = "photo-time";
  if (photo.takenAt) {
    time.dateTime = photo.takenAt;
    time.textContent = photo.takenAt.replaceAll("-", ".");
  }
  time.hidden = !elements.showTime.checked || !photo.takenAt;

  frame.append(image);
  meta.append(name, time);
  card.append(frame, meta);
  card.addEventListener("click", () => openLightbox(index, card));
  return card;
}

function renderWall() {
  state.visiblePhotos = currentPhotos();
  elements.wall.replaceChildren(...state.visiblePhotos.map(createPhotoCard));
  elements.count.textContent = String(state.visiblePhotos.length);
}

function renderAlbums(albums) {
  elements.albumList.replaceChildren();
  for (const [index, album] of albums.entries()) {
    const link = document.createElement("a");
    link.className = "album-link";
    link.href = `/${encodeURIComponent(album.slug)}/`;
    link.style.setProperty("--tilt", tiltFromId(album.slug + index, 2));

    const cover = document.createElement("span");
    cover.className = "album-cover";
    const covers = Array.isArray(album.covers) ? album.covers : [];
    const photo = covers[Math.floor(Math.random() * covers.length)];
    if (photo) {
      cover.style.aspectRatio = `${photo.width} / ${photo.height}`;
      const image = document.createElement("img");
      image.src = photo.src;
      image.alt = "";
      image.width = photo.width;
      image.height = photo.height;
      image.decoding = "async";
      image.loading = index < 2 ? "eager" : "lazy";
      image.addEventListener("load", () => image.classList.add("is-loaded"), { once: true });
      if (image.complete && image.naturalWidth) image.classList.add("is-loaded");
      cover.append(image);
    } else {
      cover.classList.add("is-empty");
    }

    const info = document.createElement("span");
    info.className = "album-info";
    const name = document.createElement("strong");
    name.textContent = album.name;
    const count = document.createElement("span");
    count.className = "album-count";
    count.textContent = `${album.photoCount} ${album.photoCount === 1 ? "photo" : "photos"}`;

    info.append(name, count);
    link.append(cover, info);
    elements.albumList.append(link);
  }
  elements.albumList.hidden = false;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json();
}

async function loadHome() {
  document.title = "Photo Gallery";
  elements.title.textContent = "Photo Gallery";
  elements.homeLink.hidden = true;
  try {
    const data = await fetchJson("/albums.json");
    clearStatus();
    if (data.albums.length === 0) {
      setStatus("No albums yet. Add a folder under photos/ and run npm run build.");
      return;
    }
    renderAlbums(data.albums);
  } catch (error) {
    console.error(error);
    setStatus("The album list could not be loaded. Run npm run build and serve the dist directory.", "error");
  }
}

async function loadAlbum(album) {
  document.title = `${album} — Photo Gallery`;
  elements.title.textContent = album;
  elements.homeLink.hidden = false;
  elements.settingsButton.hidden = false;
  try {
    const data = await fetchJson(`/data/${encodeURIComponent(album)}.json`);
    if (!Array.isArray(data.photos)) throw new Error("Invalid album index");
    const displayTitle = data.title || album;
    document.title = `${displayTitle} — Photo Gallery`;
    elements.title.textContent = displayTitle;
    state.photos = data.photos;
    clearStatus();
    elements.wall.hidden = false;
    renderWall();
    if (state.photos.length === 0) setStatus("This album is empty. Add photos and run npm run build again.");
  } catch (error) {
    console.error(error);
    elements.wall.hidden = true;
    setStatus("This album could not be loaded. It may not exist or its index may be missing.", "error");
  }
}

function setSettingsOpen(open) {
  elements.settingsPanel.hidden = !open;
  elements.settingsBackdrop.hidden = !open;
  elements.settingsButton.setAttribute("aria-expanded", String(open));
  elements.settingsButton.setAttribute("aria-label", open ? "Close settings panel" : "Open settings panel");
  if (open) elements.random.focus();
  else elements.settingsButton.focus();
}

function updateCaptionVisibility() {
  for (const name of document.querySelectorAll(".photo-name")) name.hidden = !elements.showName.checked;
  for (const time of document.querySelectorAll(".photo-time")) {
    time.hidden = !elements.showTime.checked || !time.dateTime;
  }
  if (elements.lightbox.open && state.activeIndex >= 0) updateLightbox();
}

function updateLightbox() {
  const photo = state.visiblePhotos[state.activeIndex];
  if (!photo) return;
  elements.lightboxImage.src = photo.src;
  elements.lightboxImage.alt = photo.name;
  const photoRatio = photo.width / photo.height;
  const figureRatio = 1 / (0.249 + 0.88235 / photoRatio);
  elements.lightboxImage.closest(".lightbox-figure").style.setProperty("--figure-ratio", figureRatio);
  elements.lightboxName.textContent = photo.name;
  elements.lightboxName.hidden = !elements.showName.checked;
  elements.lightboxTime.textContent = photo.takenAt ? photo.takenAt.replaceAll("-", ".") : "";
  elements.lightboxTime.dateTime = photo.takenAt || "";
  elements.lightboxTime.hidden = !elements.showTime.checked || !photo.takenAt;
  const hideNavigation = state.visiblePhotos.length < 2;
  elements.lightboxPrevious.hidden = hideNavigation;
  elements.lightboxNext.hidden = hideNavigation;
}

function openLightbox(index, card) {
  state.activeIndex = index;
  state.returnFocus = card;
  updateLightbox();
  document.body.classList.add("lightbox-open");
  elements.lightbox.showModal();
  elements.lightboxClose.focus();
}

function closeLightbox() {
  if (!elements.lightbox.open) return;
  elements.lightbox.close();
}

function moveLightbox(direction) {
  const count = state.visiblePhotos.length;
  if (count < 2) return;
  state.activeIndex = (state.activeIndex + direction + count) % count;
  updateLightbox();
}

elements.settingsButton.addEventListener("click", () => {
  setSettingsOpen(elements.settingsPanel.hidden);
});
elements.settingsBackdrop.addEventListener("click", () => setSettingsOpen(false));

elements.random.addEventListener("change", () => {
  if (elements.random.checked) elements.reverse.checked = false;
  else state.shuffledPhotos = null;
  renderWall();
});

elements.reverse.addEventListener("change", () => {
  if (elements.reverse.checked) {
    elements.random.checked = false;
    state.shuffledPhotos = null;
  }
  renderWall();
});

elements.showName.addEventListener("change", updateCaptionVisibility);
elements.showTime.addEventListener("change", updateCaptionVisibility);
elements.lightboxClose.addEventListener("click", closeLightbox);
elements.lightboxPrevious.addEventListener("click", () => moveLightbox(-1));
elements.lightboxNext.addEventListener("click", () => moveLightbox(1));

elements.lightbox.addEventListener("click", (event) => {
  if (event.target === elements.lightbox) closeLightbox();
});

elements.lightbox.addEventListener("close", () => {
  document.body.classList.remove("lightbox-open");
  const target = state.returnFocus;
  state.activeIndex = -1;
  state.returnFocus = null;
  if (target?.isConnected) target.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.settingsPanel.hidden && !elements.lightbox.open) {
    event.preventDefault();
    setSettingsOpen(false);
  }
  if (!elements.lightbox.open) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveLightbox(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    moveLightbox(1);
  }
});

const parts = pathParts();
if (parts.length === 0) loadHome();
else if (parts.length === 1) loadAlbum(parts[0]);
else setStatus("This page does not exist.", "error");
