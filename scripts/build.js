import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import exifr from "exifr";
import { imageSize } from "image-size-next";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const photosDirectory = path.join(root, "photos");
const sourceDirectory = path.join(root, "src");
const outputDirectory = path.join(root, "dist");
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const validAlbumName = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const naturalSort = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const defaultPhotoNamePatterns = [
  /^(?:img|dsc|dscn|dscf|pxl|dji|gopr|mvimg|image|photo)[-_ ]?[a-z]?\d.*$/iu,
  /^(?:screenshot|screen[ _-]?shot|截屏|屏幕快照|微信图片|mmexport|wx_camera|whatsapp[ _-]?image|signal|telegram).*$/iu,
  /^\d{4}[-_.]\d{1,2}[-_.]\d{1,2}(?:[ T_-].*)?$/u,
  /^\d{8,}(?:[-_ ]\d+)*$/u,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  /^[0-9a-f]{24,}$/iu
];
let warningCount = 0;

function warn(message) {
  warningCount += 1;
  console.warn(`Warning: ${message}`);
}

function json(data) {
  return JSON.stringify(data, null, 2) + "\n";
}

function formatDate(value) {
  if (!isValidDate(value)) return null;
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function dateFromParts(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const value = new Date(year, month - 1, day);
  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 2199 ||
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day
  ) {
    return null;
  }
  return value;
}

function dateFromRelativePath(relativePath) {
  const directories = relativePath.split("/").slice(0, -1);
  for (let index = 0; index <= directories.length - 3; index += 1) {
    if (!/^\d{4}$/.test(directories[index])) continue;
    if (!/^\d{1,2}$/.test(directories[index + 1])) continue;
    if (!/^\d{1,2}$/.test(directories[index + 2])) continue;
    const date = dateFromParts(directories[index], directories[index + 1], directories[index + 2]);
    if (date) return date;
  }
  for (const directory of directories) {
    const match = directory.match(/^(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})$/);
    if (!match) continue;
    const date = dateFromParts(match[1], match[2], match[3]);
    if (date) return date;
  }
  return null;
}

function displayNameFromFilename(filename) {
  const name = path.basename(filename, path.extname(filename)).trim();
  return defaultPhotoNamePatterns.some((pattern) => pattern.test(name)) ? null : name;
}

async function findPhotoFiles(directory, prefix = "") {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("."))
    .sort((left, right) => naturalSort.compare(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await findPhotoFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(relativePath);
    }
  }
  return files;
}

function compareBuiltPhotos(left, right) {
  if (left.sortTime !== null && right.sortTime !== null && left.sortTime !== right.sortTime) {
    return left.sortTime - right.sortTime;
  }
  if (left.sortTime !== null && right.sortTime === null) return -1;
  if (left.sortTime === null && right.sortTime !== null) return 1;
  return naturalSort.compare(left.relativePath, right.relativePath);
}

async function readExif(filePath) {
  try {
    const [metadata, orientation] = await Promise.all([
      exifr.parse(filePath, ["DateTimeOriginal", "CreateDate"]),
      exifr.orientation(filePath)
    ]);
    return { ...(metadata ?? {}), Orientation: orientation };
  } catch (error) {
    warn(`Could not read EXIF from ${path.relative(root, filePath)}: ${error.message}`);
    return {};
  }
}

async function buildPhoto(album, relativePath, mediaDirectory) {
  const sourcePath = path.join(photosDirectory, album, ...relativePath.split("/"));
  const extension = path.extname(relativePath).toLowerCase();
  const bytes = await readFile(sourcePath);
  let dimensions;
  try {
    dimensions = imageSize(bytes);
  } catch (error) {
    throw new Error(`Could not read image dimensions for ${path.relative(root, sourcePath)}: ${error.message}`);
  }
  if (!dimensions.width || !dimensions.height) {
    throw new Error(`Image dimensions are missing for ${path.relative(root, sourcePath)}`);
  }

  const metadata = extension === ".gif" ? {} : await readExif(sourcePath);
  const id = createHash("sha256")
    .update(album)
    .update("\0")
    .update(relativePath)
    .update("\0")
    .update(bytes)
    .digest("hex")
    .slice(0, 20);
  const outputFilename = `${id}${extension}`;
  await copyFile(sourcePath, path.join(mediaDirectory, outputFilename));

  let width = dimensions.width;
  let height = dimensions.height;
  const orientation = Number(metadata.Orientation ?? dimensions.orientation);
  if ([5, 6, 7, 8].includes(orientation)) [width, height] = [height, width];

  const exifDate = isValidDate(metadata.DateTimeOriginal)
    ? metadata.DateTimeOriginal
    : isValidDate(metadata.CreateDate)
      ? metadata.CreateDate
      : null;
  const takenDate = exifDate ?? dateFromRelativePath(relativePath);

  return {
    id,
    src: `/media/${album}/${outputFilename}`,
    name: displayNameFromFilename(relativePath),
    takenAt: formatDate(takenDate),
    width,
    height,
    sortTime: takenDate?.getTime() ?? null,
    relativePath
  };
}

async function getAlbums() {
  await mkdir(photosDirectory, { recursive: true });
  const entries = await readdir(photosDirectory, { withFileTypes: true });
  const albums = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const album of albums) {
    if (!validAlbumName.test(album)) {
      throw new Error(`Invalid album directory "${album}". Use lowercase letters, numbers, hyphens, and underscores only.`);
    }
  }
  return albums.sort(naturalSort.compare);
}

async function getConfig(albums) {
  const configPath = path.join(root, "gallery.config.json");
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { albums: {}, order: [] };
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in gallery.config.json: ${error.message}`);
    throw error;
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("gallery.config.json must contain a JSON object.");
  }
  const albumConfig = config.albums ?? {};
  if (!albumConfig || typeof albumConfig !== "object" || Array.isArray(albumConfig)) {
    throw new Error("gallery.config.json albums must be an object.");
  }

  for (const [album, settings] of Object.entries(albumConfig)) {
    if (!albums.includes(album)) {
      throw new Error(`Configured album "${album}" does not exist under photos/.`);
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error(`Configuration for album "${album}" must be an object.`);
    }
    if (typeof settings.title !== "string" || !settings.title.trim()) {
      throw new Error(`Configured title for album "${album}" must be a non-empty string.`);
    }
  }

  const order = config.order ?? [];
  if (!Array.isArray(order)) {
    throw new Error("gallery.config.json order must be an array of album names.");
  }
  const seenAlbums = new Set();
  for (const album of order) {
    if (typeof album !== "string" || !albums.includes(album)) {
      throw new Error(`Ordered album "${album}" does not exist under photos/.`);
    }
    if (seenAlbums.has(album)) {
      throw new Error(`Album "${album}" appears more than once in gallery.config.json order.`);
    }
    seenAlbums.add(album);
  }
  return { albums: albumConfig, order };
}

async function build() {
  const [html] = await Promise.all([
    readFile(path.join(sourceDirectory, "index.html"), "utf8"),
    readFile(path.join(sourceDirectory, "style.css"), "utf8"),
    readFile(path.join(sourceDirectory, "app.js"), "utf8")
  ]);
  const albums = await getAlbums();
  const config = await getConfig(albums);
  const orderedAlbums = [
    ...config.order,
    ...albums.filter((album) => !config.order.includes(album))
  ];

  await rm(outputDirectory, { recursive: true, force: true });
  await Promise.all([
    mkdir(path.join(outputDirectory, "data"), { recursive: true }),
    mkdir(path.join(outputDirectory, "media"), { recursive: true })
  ]);
  await Promise.all([
    copyFile(path.join(sourceDirectory, "index.html"), path.join(outputDirectory, "index.html")),
    copyFile(path.join(sourceDirectory, "style.css"), path.join(outputDirectory, "style.css")),
    copyFile(path.join(sourceDirectory, "app.js"), path.join(outputDirectory, "app.js"))
  ]);

  const albumSummaries = [];
  let photoCount = 0;
  for (const album of orderedAlbums) {
    const sourceAlbum = path.join(photosDirectory, album);
    const outputAlbum = path.join(outputDirectory, album);
    const mediaAlbum = path.join(outputDirectory, "media", album);
    await Promise.all([
      mkdir(outputAlbum, { recursive: true }),
      mkdir(mediaAlbum, { recursive: true })
    ]);

    const relativePaths = await findPhotoFiles(sourceAlbum);
    const builtPhotos = [];
    for (const relativePath of relativePaths) {
      builtPhotos.push(await buildPhoto(album, relativePath, mediaAlbum));
    }
    builtPhotos.sort(compareBuiltPhotos);
    const photos = builtPhotos.map(({ sortTime, relativePath, ...photo }) => photo);
    const title = config.albums[album]?.title.trim() || album;

    await Promise.all([
      writeFile(path.join(outputAlbum, "index.html"), html),
      writeFile(path.join(outputDirectory, "data", `${album}.json`), json({ album, title, photos }))
    ]);
    albumSummaries.push({
      slug: album,
      name: title,
      photoCount: photos.length,
      covers: photos.map(({ src, width, height }) => ({ src, width, height }))
    });
    photoCount += photos.length;
    console.log(`Built ${album}: ${photos.length} photo${photos.length === 1 ? "" : "s"}`);
  }

  await writeFile(path.join(outputDirectory, "albums.json"), json({ albums: albumSummaries }));
  console.log(`Done: ${albums.length} album${albums.length === 1 ? "" : "s"}, ${photoCount} photo${photoCount === 1 ? "" : "s"}, ${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  console.log(`Output: ${path.relative(process.cwd(), outputDirectory) || outputDirectory}`);
}

build().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
