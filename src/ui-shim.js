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
  let IN_FIGMA = false;
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

  // ---- pattern naming ----------------------------------------------------
  // Export filenames are the app's only description of what it just made:
  //   pixelgrid-<style>-<SEEDHEX>  |  pixable-freehand
  // Turn them into something readable in the Figma layers panel.
  function prettyName(filename) {
    const base = filename.replace(/\.(png|svg)$/i, '');
    const grid = base.match(/^pixelgrid-(.+)-([0-9A-F]{6})$/i);
    if (grid) return `Pixatile · ${grid[1]} · ${grid[2].toUpperCase()}`;
    if (/freehand/i.test(base)) return 'Pixatile · freehand';
    return 'Pixatile pattern';
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
      if (/\.svg$/i.test(dl)) {
        fetch(this.href).then(r => r.text())
          .then(svg => post({ type: 'insert-svg', svg, name })).catch(fail);
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
