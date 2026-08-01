// Runs AFTER the Pixable app scripts. Plugin-only UI adjustments — the web app
// stays untouched, so these are all re-applied on every build.
(() => {
  'use strict';
  const px = window.__px;
  if (!px) return;

  // ---- single-tile vector export -----------------------------------------
  // app.js's exportAsSVG paints every cell across the whole viewport, which is
  // right for a downloaded file and wrong for Figma: the default density is
  // ~12.8k nodes. The motif itself is only dim² cells (~256) no matter how
  // small the cells are, so we re-emit just one tile using the app's own
  // helpers. That's the editable unit anyway — Figma can repeat it.
  //
  // This file is injected after the app's scripts, so app.js's top-level
  // declarations (`state` is a `const`, so it never lands on `window`) are in
  // lexical scope here.
  px.buildTileSvg = () => {
    try {
      if (typeof _currentMotif !== 'function' || typeof _svgSquareShape !== 'function') return null;
      // Hexagons don't tile to a rectangle; let those take the old path.
      const shape = state.editGrid ? 'square' : state.tileShape;
      if (shape === 'hexagon') return null;

      const cellPx = state.gridSize;
      const { palette, motif } = _currentMotif();
      const dim = motif.length;
      const size = dim * cellPx;

      let inner = `<rect width="${size}" height="${size}" fill="${state.colors[0]}"/>\n`;
      for (let row = 0; row < dim; row++) {
        for (let col = 0; col < dim; col++) {
          inner += _svgSquareShape(
            shape, col * cellPx, row * cellPx, cellPx, col, row, palette[motif[row][col]].color
          );
        }
      }
      return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `
           + `viewBox="0 0 ${size} ${size}">\n${inner}</svg>`,
        shapes: dim * dim + 1,
      };
    } catch (e) {
      return null; // any surprise in app internals falls back to the full export
    }
  };

  // Everything below mutates the DOM for the plugin panel; the builder above
  // is pure, so it stays available in a plain browser for testing.
  if (!px.IN_FIGMA) return;

  // ---- export button feedback -------------------------------------------
  // The insert is a round trip through the sandbox, so the button waits for
  // code.js's confirmation rather than lying optimistically.
  function wireExport(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      px.pendingBtn = btn;
      btn.textContent = '…';
      btn.disabled = true;
    }, true); // capture: run before app.js's own handler builds the anchor
  }

  // Restore the button once the sandbox reports back (or the insert failed).
  px.settle = (ok) => {
    const btn = px.pendingBtn;
    px.pendingBtn = null;
    if (!btn) return;
    const orig = btn.dataset.label || btn.textContent;
    btn.disabled = false;
    btn.textContent = ok ? 'imported!' : 'failed';
    setTimeout(() => { btn.textContent = orig; }, 1600);
  };

  wireExport('btn-png');
  wireExport('btn-svg');

  // ---- removals ----------------------------------------------------------
  // COPY: image clipboard writes need a clipboard-write permission the plugin
  // iframe isn't granted, so the button could only ever report "unavailable".
  // Inserting straight to canvas covers the same intent.
  //
  // SAVE: slots live in clientStorage with base64 thumbnails and compete for
  // its quota; in Figma the canvas itself is the save destination.
  const style = document.createElement('style');
  style.textContent = `
    #btn-copy, #btn-save, #fh-save { display: none !important; }
    /* generate takes the full row once save is gone */
    #btn-generate, #fh-generate { width: 100% !important; flex: 1 1 100% !important; }
    /* the two remaining export buttons split the row evenly */
    #btn-png, #btn-svg { flex: 1 1 0 !important; }
  `;
  document.head.appendChild(style);

  // Relabel exports for the Figma context — these read as canvas actions now,
  // not file downloads.
  const relabel = { 'btn-png': 'INSERT PNG', 'btn-svg': 'INSERT SVG' };
  for (const [id, text] of Object.entries(relabel)) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.dataset.label = text; }
  }

  // ---- external links ----------------------------------------------------
  // Plugin iframes have no opener; route clicks through figma.openExternal.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="http"]');
    if (!a) return;
    e.preventDefault();
    px.post({ type: 'open-url', url: a.href });
  }, true);
})();
