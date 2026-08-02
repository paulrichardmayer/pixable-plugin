# Pixable → Figma Plugin: Roadmap

Goal: the full Pixable app running inside a Figma plugin panel, inserting patterns as editable vectors (or image fills when too dense), with the AI feature working and — eventually — reading the file's own color variables as palette source.

Architecture: no fork. `build.mjs` bundles the sibling `../Pixable` checkout into `dist/ui.html` and injects shims. Pixable stays the source of truth; the plugin repo holds only the wrapper.

---

## Phase 1 — Scaffold & boot ✦ current

The app runs inside the Figma panel; patterns insert into the canvas.

- [x] Repo, manifest, main-thread `code.js`
- [x] `build.mjs`: inline `style.css` + 5 JS files + inline scripts into one `ui.html`, strip CSP meta, preserve script order
- [x] `localStorage` shim → `figma.clientStorage` (hydrate-at-boot handshake so reads stay synchronous)
- [x] Download interception: `a.click()` with `download` set → postMessage → `createNodeFromSvg` / `createImage`
- [x] Plugin `id` registered with Figma (`1665490627236631187`, `documentAccess: dynamic-page`). Registered as "Pixatile"; renamed to **Pixel Tile** — the id is what Figma keys on, so the rename needs no re-registration
- [x] First smoke test in Figma desktop — panel opens, app runs

## Phase 2 — Fit & finish

Make it feel native to a plugin panel, not a website in a box.

- [x] Panel 700×700 — square, and under the 820px breakpoint so the phone layout (dock + bottom sheet) loads, which suits a plugin panel and previews a repeating pattern honestly
- [x] **Export size (W × H)** in both control panels, default FHD 1920×1080, persisted. Fields carry the real `.btn` class so they inherit the pill shape and every responsive override rather than drifting. Clamped 16–8192; hotkeys suppressed while typing
- [x] Export honours that size: PNG rasterises the tile and repeats it to exactly W×H (verified pixel-perfect — 0 seam mismatches over 80 boundary samples); SVG fills a W×H frame with instances of one tile component, so the whole pattern stays editable from a single master
- [x] Instance budget: above 2,500 repeats the insert degrades to a raster of the same size (8192² → 4,096 repeats → raster)
- [x] Watchdog on pending inserts — a lost sandbox reply used to leave the export button disabled permanently
- [x] `?figma=1` forces the plugin code path in a plain browser, so the panel UI is testable without a Figma round trip
- [x] Insert lands as a **named frame** (`Pixel Tile · <style> · <SEED>`)
- [x] PNG/SVG relabelled "INSERT PNG/SVG" and report `imported!` on the sandbox's confirmation, not optimistically
- [x] Removed COPY (iframe has no `clipboard-write` permission) and SAVE (canvas is the save destination) in **both** modes; `generate` expands to the full row
- [x] `figma.openExternal` relay for the credit link
- [x] Plugin icon (`assets/icon.png`, 128×128) from the app's own controls face
- [x] **SVG inserts one motif tile, not the whole canvas.** `exportAsSVG` paints every cell across the viewport (4px cells → 56,321 shapes; the 8px default → 12,801). The motif is only `dim²` cells, so `px.buildTileSvg` re-emits a single tile with the app's own `_currentMotif`/`_svgSquareShape`: **257 shapes at every density**, verified rendering with exactly the active palette. Vectors now survive at any grid size
- [x] Node-count guard retained as the safety net for the whole-canvas path (hexagons, which don't tile to a rectangle): >5,000 shapes inserts the raster instead, with a toast saying why
- [ ] Wire `figma.ui.resize` to a drag handle + persist the chosen size
- [ ] Verify Google Fonts actually loads in the iframe; if not, inline Host Grotesk as a data URI

## Phase 3 — AI feature

- [ ] Add `"null"` to `ALLOW_ORIGIN` in `Pixable/proxy/wrangler.toml` (plugin iframes send `Origin: null`; per-IP rate limit already protects quota)
- [ ] **YOU:** redeploy the worker: `cd Pixable/proxy && npx wrangler deploy`
- [ ] Declare the worker URL in `manifest.json` → `networkAccess.allowedDomains`
- [ ] Persist AI cooldown via the storage shim (already covered if Phase 1 shim is complete)

## Phase 4 — Figma-native superpowers

The features that justify installing a plugin instead of using the website.

- [ ] **Palette from file variables**: read the file's color variables/styles via the main thread, offer them as a colorway ("Use this file's palette")
- [ ] Re-insert / update-in-place: remember the node a pattern was inserted as; regenerating replaces it instead of stacking copies
- [ ] Insert as fill on selected shape (pattern → `fills` image on current selection)
- [ ] Optional: seed round-trip via `setPluginData` so selecting an inserted pattern restores its settings

## Phase 5 — Publish

- [x] Plugin icon — `assets/icon.png`
- [ ] Cover art (Community listing needs 1920×960)
- [ ] **YOU:** Figma Community review submission (needs your Figma account; review takes ~1–2 weeks)
- [ ] Decide free vs. paid; wire nothing — Community handles distribution

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Node explosion on dense patterns | Phase 2 threshold → PNG fill fallback |
| Pixable refactors break shims | Shims touch only `localStorage`, anchor `click`, `fetch` targets — all stable surfaces; smoke-test after each Pixable release |
| Worker quota abuse via `Origin: null` | Existing 10 req/min/IP rate limiter; can move to a plugin-specific header check later |
