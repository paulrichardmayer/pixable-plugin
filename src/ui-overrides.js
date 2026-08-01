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

  // ---- export size --------------------------------------------------------
  // Figma wants a concrete artboard size, not "whatever the viewport was".
  // Default FHD; clamped to something Figma can actually hold.
  const SIZE_KEY = 'pixatile.exportSize';
  const DEFAULT_SIZE = { w: 1920, h: 1080 };
  const MIN_PX = 16, MAX_PX = 8192;
  // Above this many repeats the instance grid stops being worth it, so the
  // insert degrades to a raster of the same size rather than a slow document.
  const MAX_INSTANCES = 2500;

  const clamp = (n, fallback) => {
    const v = Math.round(Number(n));
    return Number.isFinite(v) && v > 0 ? Math.min(MAX_PX, Math.max(MIN_PX, v)) : fallback;
  };

  px.exportSize = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(SIZE_KEY));
      return { w: clamp(raw.w, DEFAULT_SIZE.w), h: clamp(raw.h, DEFAULT_SIZE.h) };
    } catch (e) {
      return { ...DEFAULT_SIZE };
    }
  };
  const saveSize = (s) => localStorage.setItem(SIZE_KEY, JSON.stringify(s));

  // Rasterise the motif tile and repeat it to fill exactly w×h — seamless at
  // any size, and independent of the viewport the app happens to be showing.
  px.tiledPng = async (tileSvg, w, h) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = rej;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tileSvg);
    });
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false; // keep pixel edges crisp when repeating
    const pattern = cx.createPattern(img, 'repeat');
    cx.fillStyle = pattern;
    cx.fillRect(0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  };

  // Decide how an insert of the current pattern at the current size should go.
  px.planInsert = (wantVector) => {
    const size = px.exportSize();
    const tile = px.buildTileSvg && px.buildTileSvg();
    if (!tile) return { kind: 'fallback', size };
    const m = tile.svg.match(/width="(\d+)"/);
    const tilePx = m ? +m[1] : 0;
    if (!wantVector || !tilePx) return { kind: 'raster', size, tile };
    const repeats = Math.ceil(size.w / tilePx) * Math.ceil(size.h / tilePx);
    // Too many repeats to stay editable — a raster of the same size is better
    // than a document Figma struggles with.
    if (repeats > MAX_INSTANCES) return { kind: 'raster', size, tile, repeats };
    return { kind: 'vector', size, tile, repeats };
  };

  // Everything below mutates the DOM for the plugin panel; the builder above
  // is pure, so it stays available in a plain browser for testing.
  if (!px.IN_FIGMA) return;

  // ---- export button feedback -------------------------------------------
  // The insert is a round trip through the sandbox, so the button waits for
  // code.js's confirmation rather than lying optimistically.
  // A disabled button with no reply would be stuck forever, so every pending
  // insert carries a watchdog. Rasterising a large size takes a second or two,
  // hence the generous window.
  const SETTLE_TIMEOUT_MS = 15000;
  let watchdog = null;

  function wireExport(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      px.pendingBtn = btn;
      btn.textContent = '…';
      btn.disabled = true;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => px.settle(false), SETTLE_TIMEOUT_MS);
    }, true); // capture: run before app.js's own handler builds the anchor
  }

  // Restore the button once the sandbox reports back (or the insert failed).
  px.settle = (ok) => {
    clearTimeout(watchdog);
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
    #btn-copy, #btn-save, #fh-copy, #fh-save { display: none !important; }
    /* generate takes the full row once save is gone */
    #btn-generate, #fh-generate { width: 100% !important; flex: 1 1 100% !important; }
    /* the two remaining export buttons split the row evenly */
    #btn-png, #btn-svg, #fh-png, #fh-svg { flex: 1 1 0 !important; }

    /* Export size. The fields carry the real .btn class so they inherit the
       pill shape, colour and every responsive size override for free — at the
       phone breakpoint .btn drops to 16px/13px padding, and hardcoding here
       would silently drift out of step. */
    .px-size-row { display: flex; align-items: center; gap: 8px; }
    .px-size-field {
      flex: 1 1 0; gap: 6px; justify-content: space-between; cursor: text;
    }
    .px-size-field:hover { filter: none; }   /* not a button; don't react like one */
    .px-size-field:active { transform: none; }
    .px-size-field label { opacity: .55; letter-spacing: .04em; cursor: text; }
    .px-size-field input {
      flex: 1 1 0; min-width: 0; width: 100%;
      background: transparent; border: none; outline: none;
      font: inherit; color: inherit; text-align: right; -moz-appearance: textfield;
    }
    .px-size-field input::-webkit-outer-spin-button,
    .px-size-field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .px-size-x { font-weight: 700; opacity: .5; }
  `;
  document.head.appendChild(style);

  // ---- export size control ------------------------------------------------
  // Injected into both control panels, above the export buttons, using the
  // app's own .ctrl-label / .btn-row structure.
  function buildSizeRow(exportRow) {
    const size = px.exportSize();
    const label = document.createElement('span');
    label.className = 'ctrl-label';
    label.textContent = 'export size';

    const row = document.createElement('div');
    row.className = 'btn-row px-size-row';
    row.innerHTML =
      '<div class="btn px-size-field"><label>W</label>'
      + `<input type="number" inputmode="numeric" value="${size.w}" aria-label="Export width"></div>`
      + '<span class="px-size-x">×</span>'
      + '<div class="btn px-size-field"><label>H</label>'
      + `<input type="number" inputmode="numeric" value="${size.h}" aria-label="Export height"></div>`;

    // Clicking anywhere on the pill focuses its input, like a real field.
    for (const f of row.querySelectorAll('.px-size-field')) {
      f.addEventListener('click', () => f.querySelector('input').focus());
    }

    const [wIn, hIn] = row.querySelectorAll('input');
    const commit = () => {
      const next = { w: clamp(wIn.value, DEFAULT_SIZE.w), h: clamp(hIn.value, DEFAULT_SIZE.h) };
      wIn.value = next.w; hIn.value = next.h;   // reflect the clamp back
      saveSize(next);
    };
    for (const input of [wIn, hIn]) {
      input.addEventListener('change', commit);
      input.addEventListener('blur', commit);
      // Space/letter hotkeys must not fire while typing a number.
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') input.blur();
      });
    }
    exportRow.parentNode.insertBefore(label, exportRow);
    exportRow.parentNode.insertBefore(row, exportRow);
  }

  for (const id of ['btn-png', 'fh-png']) {
    const btn = document.getElementById(id);
    const exportRow = btn && btn.closest('.btn-row');
    if (exportRow) buildSizeRow(exportRow);
  }

  // Relabel exports for the Figma context — these read as canvas actions now,
  // not file downloads.
  const relabel = { 'btn-png': 'INSERT PNG', 'btn-svg': 'INSERT SVG' };
  for (const [id, text] of Object.entries(relabel)) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.dataset.label = text; }
  }

  // ---- credit pill -> full version ---------------------------------------
  // In the panel the byline is less useful than a way out to the full app.
  const madeBy = document.getElementById('made-by-tag');
  if (madeBy) {
    madeBy.textContent = 'go to full version';
    madeBy.href = 'https://pixatile.paulrmayer.com/';
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
