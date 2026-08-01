# CLAUDE.md — pixable-plugin

## Communication style
Be concise and brief. Short explanations, no restating what the diff shows. Always call out explicitly — as a separate "**You need to:**" line — any step the user must do themselves (Figma desktop actions, wrangler deploys, auth, Community submission).

## What this repo is
Figma plugin wrapper around the Pixable web app. **Never copy/fork Pixable source into this repo** — `build.mjs` bundles it from the sibling checkout at `../Pixable` into `dist/ui.html` (git-ignored). Fixes to app behavior belong in the Pixable repo; only shims and plugin glue live here.

## Key facts
- `manifest.json` → `main: code.js` (Figma sandbox), `ui: dist/ui.html` (iframe).
- Plugin iframes have no `localStorage` (null origin) — the injected shim mirrors an in-memory copy to `figma.clientStorage` via postMessage; hydration happens before app scripts run. Don't add direct `localStorage` calls.
- Downloads are intercepted (`HTMLAnchorElement.prototype.click`) and become canvas inserts. Don't "fix" Pixable's export code to bypass anchors.
- The AI proxy CORS allowlist lives in `Pixable/proxy/wrangler.toml`; plugin origin is the literal string `null`. Redeploys are user-run (`npx wrangler deploy`).
- Build: `node build.mjs` (no npm deps, Node built-ins only). Test = import `manifest.json` in Figma desktop — there is no automated test rig; say so instead of claiming verification.

## User-owned steps (never attempt these yourself)
- Creating/linking the dev plugin in Figma desktop (produces the manifest `id`)
- `wrangler deploy` of the proxy
- Figma Community publishing
