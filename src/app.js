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
  lightboxTrack: document.querySelector("#lightbox-track"),
  lightboxPrevious: document.querySelector("#lightbox-previous"),
  lightboxNext: document.querySelector("#lightbox-next"),
  lightboxClose: document.querySelector("#lightbox-close")
};

const state = {
  photos: [],
  visiblePhotos: [],
  shuffledPhotos: null,
  activeIndex: -1,
  returnFocus: null,
  lightboxMoving: false,
  lightboxDirection: 0
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

function cardWidthForPhoto(photo) {
  const imageWidth = Math.min(540, Math.round((photo.width / photo.height) * 300));
  return `${imageWidth + 61}px`;
}

function stablePhotoId(photo) {
  if (photo.id) return photo.id;
  const filename = photo.src.split("/").pop() || photo.src;
  return filename.replace(/\.[^.]+$/, "");
}

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting && entry.intersectionRatio < 0.15) continue;
        entry.target.classList.add("is-revealed");
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: [0, 0.15] })
  : null;

function observeReveal(element, index) {
  element.classList.add("wall-polaroid");
  element.style.setProperty("--reveal-delay", `${Math.min(index, 6) * 35}ms`);
  if (prefersReducedMotion.matches || !revealObserver) {
    element.classList.add("is-revealed");
    return;
  }
  revealObserver.observe(element);
}

function stopObserving(container) {
  if (!revealObserver) return;
  for (const element of container.querySelectorAll(".wall-polaroid")) {
    revealObserver.unobserve(element);
  }
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
  card.className = "polaroid photo-card";
  card.type = "button";
  card.dataset.photoId = photo.id;
  card.setAttribute("aria-label", `View ${photo.name}`);
  card.style.setProperty("--tilt", tiltFromId(photo.id));
  card.style.setProperty("--lift", liftFromId(photo.id));
  card.style.setProperty("--card-width", cardWidthForPhoto(photo));

  const frame = document.createElement("span");
  frame.className = "polaroid-frame photo-frame";
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
  meta.className = "polaroid-meta photo-meta";

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
  observeReveal(card, index);
  return card;
}

function renderWall() {
  state.visiblePhotos = currentPhotos();
  stopObserving(elements.wall);
  elements.wall.replaceChildren(...state.visiblePhotos.map(createPhotoCard));
  elements.count.textContent = String(state.visiblePhotos.length);
}

function renderAlbums(albums) {
  stopObserving(elements.albumList);
  elements.albumList.replaceChildren();
  for (const [index, album] of albums.entries()) {
    const link = document.createElement("a");
    link.className = "polaroid album-link";
    link.href = `/${encodeURIComponent(album.slug)}/`;

    const cover = document.createElement("span");
    cover.className = "polaroid-frame album-cover";
    const covers = Array.isArray(album.covers) ? album.covers : [];
    const photo = covers[Math.floor(Math.random() * covers.length)];
    if (photo) {
      link.style.setProperty("--tilt", tiltFromId(stablePhotoId(photo)));
      link.style.setProperty("--card-width", cardWidthForPhoto(photo));
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
      link.style.setProperty("--tilt", tiltFromId(album.slug + index, 2));
      link.style.setProperty("--card-width", "361px");
      cover.classList.add("is-empty");
    }

    const info = document.createElement("span");
    info.className = "polaroid-meta album-info";
    const name = document.createElement("strong");
    name.textContent = album.name;
    const count = document.createElement("span");
    count.className = "album-count";
    count.textContent = `${album.photoCount} ${album.photoCount === 1 ? "photo" : "photos"}`;

    info.append(name, count);
    link.append(cover, info);
    observeReveal(link, index);
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
}

function photoAt(index) {
  const count = state.visiblePhotos.length;
  return count ? state.visiblePhotos[(index + count) % count] : null;
}

function createLightboxSlide(photo, offset) {
  const slide = document.createElement("div");
  slide.className = "lightbox-slide";
  slide.setAttribute("aria-hidden", String(offset !== 0));

  const figure = document.createElement("figure");
  figure.className = "polaroid lightbox-figure";
  figure.style.setProperty("--card-width", cardWidthForPhoto(photo));

  const frame = document.createElement("span");
  frame.className = "polaroid-frame lightbox-frame";
  frame.style.aspectRatio = `${photo.width} / ${photo.height}`;

  const image = document.createElement("img");
  image.src = photo.src;
  image.alt = offset === 0 ? photo.name : "";
  image.width = photo.width;
  image.height = photo.height;
  image.decoding = "async";
  image.loading = offset === 0 ? "eager" : "lazy";
  image.addEventListener("load", () => image.classList.add("is-loaded"), { once: true });
  if (image.complete && image.naturalWidth) image.classList.add("is-loaded");
  frame.append(image);

  const caption = document.createElement("figcaption");
  caption.className = "polaroid-meta lightbox-caption";
  const name = document.createElement("span");
  name.className = "photo-name lightbox-name";
  name.textContent = photo.name;
  name.hidden = !elements.showName.checked;
  const time = document.createElement("time");
  time.className = "photo-time lightbox-time";
  if (photo.takenAt) {
    time.dateTime = photo.takenAt;
    time.textContent = photo.takenAt.replaceAll("-", ".");
  }
  time.hidden = !elements.showTime.checked || !photo.takenAt;
  caption.append(name, time);
  figure.append(frame, caption);
  slide.append(figure);
  return slide;
}

function renderLightboxSlides() {
  const current = photoAt(state.activeIndex);
  if (!current) return;
  const slides = [-1, 0, 1].map((offset) => createLightboxSlide(photoAt(state.activeIndex + offset), offset));
  elements.lightboxTrack.classList.remove("is-animating");
  elements.lightboxTrack.style.transform = "translateX(-100%)";
  elements.lightboxTrack.replaceChildren(...slides);
  state.lightboxMoving = false;
  state.lightboxDirection = 0;
  const hideNavigation = state.visiblePhotos.length < 2;
  elements.lightboxPrevious.hidden = hideNavigation;
  elements.lightboxNext.hidden = hideNavigation;
}

function openLightbox(index, card) {
  state.activeIndex = index;
  state.returnFocus = card;
  renderLightboxSlides();
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
  if (count < 2 || state.lightboxMoving) return;
  state.lightboxMoving = true;
  state.lightboxDirection = direction > 0 ? 1 : -1;
  elements.lightboxTrack.classList.remove("is-animating");
  elements.lightboxTrack.style.transform = "translateX(-100%)";
  void elements.lightboxTrack.offsetWidth;
  elements.lightboxTrack.classList.add("is-animating");
  requestAnimationFrame(() => {
    elements.lightboxTrack.style.transform = direction > 0 ? "translateX(-200%)" : "translateX(0)";
  });
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

elements.lightboxTrack.addEventListener("transitionend", (event) => {
  if (event.propertyName !== "transform" || !state.lightboxMoving) return;
  const count = state.visiblePhotos.length;
  state.activeIndex = (state.activeIndex + state.lightboxDirection + count) % count;
  renderLightboxSlides();
});

elements.lightbox.addEventListener("click", (event) => {
  if (event.target === elements.lightbox || event.target.classList.contains("lightbox-slide")) {
    closeLightbox();
  }
});

elements.lightbox.addEventListener("close", () => {
  document.body.classList.remove("lightbox-open");
  const target = state.returnFocus;
  state.activeIndex = -1;
  state.lightboxMoving = false;
  state.lightboxDirection = 0;
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
