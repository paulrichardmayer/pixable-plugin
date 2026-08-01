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
- [x] Plugin `id` registered with Figma (`1665490627236631187`, name "Pixatile", `documentAccess: dynamic-page`)
- [x] First smoke test in Figma desktop — panel opens, app runs

## Phase 2 — Fit & finish

Make it feel native to a plugin panel, not a website in a box.

- [x] Panel default 880×720 — deliberately above Pixable's 820px phone breakpoint, so the desktop layout (and no mobile dock/scrim) is what loads
- [x] Insert lands as a **named frame** (`Pixatile · <style> · <SEED>`)
- [x] PNG/SVG relabelled "INSERT PNG/SVG" and report `imported!` on the sandbox's confirmation, not optimistically
- [x] Removed COPY (iframe has no `clipboard-write` permission) and SAVE (canvas is the save destination); `generate` expands to the full row
- [x] `figma.openExternal` relay for the credit link
- [x] Plugin icon (`assets/icon.png`, 128×128) from the app's own controls face
- [x] Node-count guard: shapes counted before insert; above 5,000 the raster goes in instead, with a toast saying why. Measured counts (1328×768 canvas, by px-per-cell): 4px → 56,321 · 8px → 12,801 · 16px → 2,561 · 24px → 769
- [ ] **Insert one tile, not the whole canvas.** The real fix for the above — the export covers the entire viewport, so the default density is ~12.8k nodes and always rasterises. Emitting a single motif tile would put coarse *and* fine patterns in as editable vectors, and Figma can repeat the tile
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
