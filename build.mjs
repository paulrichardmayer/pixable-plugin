// Bundle the sibling Pixable web app into dist/ui.html for the Figma plugin.
//
//   node build.mjs [path-to-pixable]     (default: ../Pixable)
//
// What it does, in order:
//   1. strips the CSP <meta> (Figma applies its own iframe CSP)
//   2. inlines style.css as a <style> block
//   3. lifts every <script> (external + inline) out of the document, in order
//   4. appends one loader script that:
//        - installs a localStorage shim backed by figma.clientStorage
//        - intercepts a.click() downloads and turns them into canvas inserts
//        - waits for the 'hydrate' message from code.js, then executes the
//          app scripts sequentially in global scope (classic-script semantics)
// No npm dependencies — Node built-ins only.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pixable = resolve(here, process.argv[2] || '../Pixable');

let html = readFileSync(join(pixable, 'index.html'), 'utf8');

// 1. Drop the CSP meta (multi-line tag).
html = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/i, '');

// 2. Inline the stylesheet.
const css = readFileSync(join(pixable, 'style.css'), 'utf8');
html = html.replace(
  /<link rel="stylesheet" href="style.css"\s*\/?>/i,
  () => `<style>\n${css}\n</style>`
);

// 3. Collect scripts in document order, remove them from the page.
const sources = []; // { name, code }
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_, attrs, inline) => {
  const src = attrs.match(/src="([^"]+)"/);
  if (src) {
    sources.push({ name: src[1], code: readFileSync(join(pixable, src[1]), 'utf8') });
  } else {
    sources.push({ name: `inline-${sources.length}`, code: inline });
  }
  return '';
});
if (sources.length < 5) {
  throw new Error(`expected at least 5 scripts in index.html, found ${sources.length}`);
}

// 4. The loader. App sources travel base64-encoded so no content (regex
// literals, "</script>", unicode) can break the HTML parse.
const payload = JSON.stringify(
  sources.map(s => ({ name: s.name, b64: Buffer.from(s.code, 'utf8').toString('base64') }))
);

const loader = `<script>
(() => {
  'use strict';
  const post = (m) => parent.postMessage({ pluginMessage: m }, '*');

  // ---- environment probe: null-origin plugin iframes throw on localStorage
  let IN_FIGMA = false;
  try { void window.localStorage; } catch (e) { IN_FIGMA = true; }

  // ---- localStorage shim (write-through to figma.clientStorage) ----
  const mem = new Map();
  if (IN_FIGMA) {
    const shim = {
      getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
      setItem: (k, v) => { mem.set(String(k), String(v)); post({ type: 'storage-set', key: String(k), value: String(v) }); },
      removeItem: (k) => { mem.delete(String(k)); post({ type: 'storage-remove', key: String(k) }); },
      clear: () => { for (const k of [...mem.keys()]) shim.removeItem(k); },
      key: (i) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    };
    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  }

  // ---- download interception → canvas insert ----
  // Pixable exports by creating an <a download> and calling .click(). In the
  // plugin we read the blob/data URL back and hand it to code.js instead.
  if (IN_FIGMA) {
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const dl = this.getAttribute('download');
      if (!dl) return nativeClick.apply(this, arguments);
      const name = dl.replace(/\\.(png|svg)$/i, '');
      if (/\\.svg$/i.test(dl)) {
        fetch(this.href).then(r => r.text())
          .then(svg => post({ type: 'insert-svg', svg, name }))
          .catch(e => post({ type: 'notify', message: 'Insert failed: ' + e.message }));
      } else {
        fetch(this.href).then(r => r.arrayBuffer())
          .then(buf => post({ type: 'insert-png', bytes: new Uint8Array(buf), name }))
          .catch(e => post({ type: 'notify', message: 'Insert failed: ' + e.message }));
      }
    };
  }

  // ---- boot: hydrate storage, then run the app scripts in order ----
  const SOURCES = ${payload};
  const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    for (const s of SOURCES) {
      const el = document.createElement('script');
      el.textContent = '//# sourceURL=' + s.name + '\\n' + decode(s.b64);
      document.body.appendChild(el); // classic script: executes synchronously, global scope
    }
  }

  if (IN_FIGMA) {
    window.addEventListener('message', (e) => {
      const m = e.data && e.data.pluginMessage;
      if (m && m.type === 'hydrate') {
        for (const [k, v] of Object.entries(m.data || {})) mem.set(k, String(v));
        boot();
      }
    });
    setTimeout(boot, 1500); // hydrate lost? boot anyway rather than hang
  } else {
    boot(); // standalone (browser preview): native localStorage, no handshake
  }
})();
</script>`;

html = html.replace(/<\/body>/i, loader + '\n</body>');

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'ui.html'), html);
console.log(`dist/ui.html written (${(html.length / 1024).toFixed(0)} KB, ${sources.length} scripts inlined: ${sources.map(s => s.name).join(', ')})`);
