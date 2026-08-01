# Pixatile for Figma

Figma plugin wrapper for [Pixable](https://github.com/paulrichardmayer/Pixable) — generate pixel & freehand patterns and insert them into your Figma file as editable vectors or image fills. Ships as **Pixatile**, matching [pixatile.paulrmayer.com](https://pixatile.paulrmayer.com).

## How it works

The plugin does **not** fork Pixable. A build script (`build.mjs`) reads the web app from a sibling `../Pixable` checkout, bundles it into a single `dist/ui.html`, and injects two shims:

- **Storage** — `localStorage` doesn't exist in a plugin iframe; a shim mirrors it to `figma.clientStorage` through the plugin main thread.
- **Downloads** — when the app tries to download a PNG/SVG, the shim intercepts it and inserts the artwork into the Figma canvas instead.

## Build

```
node build.mjs        # reads ../Pixable, writes dist/ui.html
node build.mjs --check # exits 1 if Pixable changed since the last build
```

Then in Figma desktop: **Plugins → Development → Import plugin from manifest…** and pick `manifest.json`.

**Rebuild after every Pixable change.** Figma loads `dist/ui.html` directly with no build step, so a stale bundle keeps running old app code — behaviour then differs from the live site for no visible reason. Each build stamps the Pixable commit into the first line of `dist/ui.html`.

See [ROADMAP.md](ROADMAP.md) for the plan and current status.
