# Static Photo Gallery

A framework-free, build-time photo gallery. Each direct child folder under `photos/` becomes an album at the matching URL.

```text
photos/hello/  ->  /hello
photos/japan/  ->  /japan
```

## Use

1. Put browser-supported images (`jpg`, `jpeg`, `png`, `webp`, `gif`, or `avif`) in an album folder.
2. Keep album folder names URL-safe: lowercase letters, numbers, hyphens, and underscores.
3. Build the deployable site:

   ```bash
   npm install
   npm run build
   ```

4. Preview locally:

   ```bash
   python3 -m http.server 8000 -d dist
   ```

Open `http://localhost:8000/` to browse all albums, or visit an album directly such as `http://localhost:8000/hello`. Each album card selects one of its photos at random as the cover whenever the homepage loads.

Use `gallery.config.json` to give URL-safe album folders display titles in any language:

```json
{
  "order": ["japan", "hello"],
  "albums": {
    "hello": { "title": "你好" },
    "japan": { "title": "日本旅行" }
  }
}
```

The folder name remains the URL (`photos/japan/` → `/japan`), while the configured title appears on the homepage, album page, and browser tab. Albums without a configured title fall back to their folder name.

The optional `order` array controls homepage album order. Listed albums appear first in that exact order; albums omitted from the array are appended using their natural folder-name order. Unknown or duplicate names cause the build to fail instead of silently producing an unexpected order.

`dist/` is generated and should not be edited manually. For Cloudflare Pages, upload `dist/` as the static output directory using the web interface.

Photo names come from filenames. Dates come from EXIF `DateTimeOriginal`, with `CreateDate` as fallback; photos without either date remain undated.
