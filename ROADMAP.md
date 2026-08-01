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
- [ ] First manual smoke test in Figma desktop (both modes, save/restore, insert SVG + PNG)

## Phase 2 — Fit & finish

Make it feel native to a plugin panel, not a website in a box.

- [ ] Panel sizing: pick default (≈480×720), wire `figma.ui.resize` to a drag handle
- [ ] Lean on the existing mobile layout (dock + bottom sheet) for narrow widths; replace pinch-zoom with wheel/trackpad
- [ ] Node-count guard: estimate cell count before SVG insert; above ~5k cells insert as PNG image fill instead (with a toast explaining why)
- [ ] Relabel export buttons in plugin context ("Insert as vectors" / "Insert as image") via injected CSS/JS, not Pixable edits
- [ ] `window.open` (credit link) → `figma.openExternal` relay
- [ ] Google Fonts: either bundle the Host Grotesk woff2 as data URI or declare fonts domains in `networkAccess`

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

- [ ] Icons + cover art (Figma Community listing needs 128×128 icon, 1920×960 cover)
- [ ] **YOU:** Figma Community review submission (needs your Figma account; review takes ~1–2 weeks)
- [ ] Decide free vs. paid; wire nothing — Community handles distribution

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Node explosion on dense patterns | Phase 2 threshold → PNG fill fallback |
| Pixable refactors break shims | Shims touch only `localStorage`, anchor `click`, `fetch` targets — all stable surfaces; smoke-test after each Pixable release |
| Worker quota abuse via `Origin: null` | Existing 10 req/min/IP rate limiter; can move to a plugin-specific header check later |
