// Runs BEFORE the Pixable app scripts. Owns everything the app assumes about
// the browser that isn't true inside a Figma plugin iframe:
//   - localStorage (null origin -> throws) mirrored to figma.clientStorage
//   - <a download> exports rerouted to canvas inserts
//   - boot ordering: hydrate storage first, then run the app in document order
// build.mjs substitutes the base64-encoded app scripts into the placeholder
// below — it must appear exactly once in this file.
(() => {
  'use strict';

  // Null-origin iframes throw on localStorage access; that's our env probe.
  // `?figma=1` forces the same path in an ordinary browser so the plugin UI
  // (export-size row, insert feedback, hidden buttons) can be exercised
  // without a Figma round trip — postMessages just land back on this window.
  let IN_FIGMA = /[?&]figma=1(&|$)/.test(location.search);
  try { void window.localStorage; } catch (e) { IN_FIGMA = true; }

  const post = (m) => parent.postMessage({ pluginMessage: m }, '*');
  // settle() is replaced by ui-overrides.js once the app has booted; the
  // no-op keeps early failures from throwing.
  const px = (window.__px = { IN_FIGMA, post, pendingBtn: null, settle: () => {} });

  // ---- localStorage shim -------------------------------------------------
  // Reads stay synchronous off an in-memory mirror (the app reads storage
  // during init); writes go async to clientStorage and are never awaited.
  const mem = new Map();
  if (IN_FIGMA) {
    const shim = {
      getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
      setItem: (k, v) => {
        mem.set(String(k), String(v));
        post({ type: 'storage-set', key: String(k), value: String(v) });
      },
      removeItem: (k) => { mem.delete(String(k)); post({ type: 'storage-remove', key: String(k) }); },
      clear: () => { for (const k of [...mem.keys()]) shim.removeItem(k); },
      key: (i) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    };
    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  }

  // ---- vector budget -----------------------------------------------------
  // Pixelated mode's SVG export emits one shape per cell across the whole
  // output area, so node count explodes as cells get smaller. Measured on a
  // 1328x768 canvas, by the grid-size slider (px per cell):
  //     4px -> 56,321 shapes (3.3 MB)      16px ->  2,561 shapes
  //     8px -> 12,801 shapes (749 KB)      24px ->    769 shapes
  // So the default (8px) is already ~12.8k nodes. Past the budget we insert
  // the raster instead and say so — which means coarse patterns arrive as
  // editable vectors and fine ones as images, roughly tracking where vectors
  // are actually useful to edit. (Freehand's SVG is a <pattern>, a handful of
  // nodes regardless, so it never trips this.)
  const MAX_VECTOR_NODES = 5000;
  const SHAPE_RE = /<(rect|circle|ellipse|line|polyline|polygon|path|use)\b/g;
  const countShapes = (svg) => (svg.match(SHAPE_RE) || []).length;

  // Re-render the current pattern as PNG bytes. app.js declares
  // buildExportCanvas at top level, so it's global in the bundle.
  async function rasterBytes() {
    if (typeof window.buildExportCanvas !== 'function') return null;
    const { canvas } = window.buildExportCanvas();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ---- pattern naming ----------------------------------------------------
  // Export filenames are the app's only description of what it just made:
  //   pixelgrid-<style>-<SEEDHEX>  |  pixable-freehand
  // Turn them into something readable in the Figma layers panel.
  function prettyName(filename) {
    const base = filename.replace(/\.(png|svg)$/i, '');
    const grid = base.match(/^pixelgrid-(.+)-([0-9A-F]{6})$/i);
    if (grid) return `Pixel Tile · ${grid[1]} · ${grid[2].toUpperCase()}`;
    if (/freehand/i.test(base)) return 'Pixel Tile · freehand';
    return 'Pixel Tile pattern';
  }

  // ---- download interception --------------------------------------------
  // Pixable exports by building an <a download> and clicking it. We read the
  // blob/data URL back out and hand the bytes to the plugin sandbox instead.
  if (IN_FIGMA) {
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const dl = this.getAttribute('download');
      if (!dl) return nativeClick.apply(this, arguments);

      const name = prettyName(dl);
      const fail = (e) => {
        px.settle(false);
        post({ type: 'notify', message: 'Insert failed: ' + e.message });
      };
      const wantVector = /\.svg$/i.test(dl);
      const plan = px.planInsert && px.planInsert(wantVector);

      // Vectors at the requested size: one tile, repeated as instances.
      if (plan && plan.kind === 'vector') {
        return post({ type: 'insert-svg', svg: plan.tile.svg, name, size: plan.size });
      }
      // A raster of the requested size — either PNG was asked for, or the
      // repeat count would have made the vector document unworkable.
      if (plan && plan.kind === 'raster') {
        px.tiledPng(plan.tile.svg, plan.size.w, plan.size.h)
          .then(bytes => {
            if (!bytes) throw new Error('could not rasterise the tile');
            post({
              type: 'insert-png', bytes, name, size: plan.size,
              tooManyRepeats: wantVector ? plan.repeats : 0,
            });
          })
          .catch(fail);
        return;
      }

      // plan.kind === 'fallback': hexagons and freehand, which have no motif
      // tile to repeat, keep the app's own viewport-sized export.
      if (wantVector) {
        fetch(this.href).then(r => r.text())
          .then(async (svg) => {
            const n = countShapes(svg);
            if (n <= MAX_VECTOR_NODES) return post({ type: 'insert-svg', svg, name });
            // Too dense for vectors — degrade to the raster rather than
            // handing Figma a document it will choke on.
            const bytes = await rasterBytes();
            if (!bytes) return post({ type: 'insert-svg', svg, name, heavy: n });
            post({ type: 'insert-png', bytes, name, fellBackFrom: n });
          }).catch(fail);
      } else {
        fetch(this.href).then(r => r.arrayBuffer())
          .then(buf => post({ type: 'insert-png', bytes: new Uint8Array(buf), name })).catch(fail);
      }
    };
  }

  // ---- boot --------------------------------------------------------------
  const SOURCES = __SOURCES__;
  const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));

  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    for (const s of SOURCES) {
      const el = document.createElement('script');
      // Classic script: executes synchronously in global scope, preserving
      // the load order index.html relied on.
      el.textContent = '//# sourceURL=' + s.name + '\n' + decode(s.b64);
      document.body.appendChild(el);
    }
  }

  if (IN_FIGMA) {
    window.addEventListener('message', (e) => {
      const m = e.data && e.data.pluginMessage;
      if (!m) return;
      if (m.type === 'hydrate') {
        for (const [k, v] of Object.entries(m.data || {})) mem.set(k, String(v));
        boot();
      } else if (m.type === 'insert-done') {
        px.settle(true);
      } else if (m.type === 'insert-failed') {
        px.settle(false);
      }
    });
    // If the handshake is lost, boot anyway rather than showing a dead panel.
    setTimeout(boot, 1500);
  } else {
    boot(); // standalone browser preview: real localStorage, no handshake
  }
})();
