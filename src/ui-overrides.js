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
        size,
      };
    } catch (e) {
      return null; // any surprise in app internals falls back to the full export
    }
  };

  // ---- export size --------------------------------------------------------
  // Figma wants a concrete artboard size, not "whatever the viewport was".
  // Default FHD; clamped to something Figma can actually hold.
  const SIZE_KEY = 'pixeltile.exportSize';
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

  // Past this many shapes a single flat SVG gets slow to edit in Figma.
  const MAX_VECTOR_NODES = 5000;
  const SHAPE_RE = /<(rect|circle|ellipse|line|polyline|polygon|path|use)\b/g;
  const countShapes = (svg) => (svg.match(SHAPE_RE) || []).length;
  const svgUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  const loadImage = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('could not load the pattern image'));
    img.src = src;
  });

  async function canvasBytes(cv) {
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    if (!blob) throw new Error('could not encode PNG');
    return new Uint8Array(await blob.arrayBuffer());
  }

  // Repeat one tile image to fill exactly w×h — seamless at any size, and
  // independent of the viewport the app happens to be showing.
  px.repeatToPng = async (img, w, h) => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false; // keep pixel edges crisp when repeating
    cx.fillStyle = cx.createPattern(img, 'repeat');
    cx.fillRect(0, 0, w, h);
    return canvasBytes(cv);
  };

  // Draw an image (usually an SVG that already describes the full artwork)
  // onto a w×h canvas. The browser does any <pattern> tiling itself.
  async function drawToPng(img, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvasBytes(cv);
  }

  // Kept for tests and older callers: tile SVG in, repeated PNG bytes out.
  px.tiledPng = async (tileSvg, w, h) => px.repeatToPng(await loadImage(svgUrl(tileSvg)), w, h);

  // ---- exports, per mode ----------------------------------------------------
  // Every path ends in one of two sandbox messages:
  //   insert-svg { svg, size? }  size present → repeat the svg as a tile component
  //   insert-png { bytes, size? } size present → frame is exactly that size
  // `why` travels with a raster that stood in for requested vectors, so the
  // sandbox can tell the user rather than silently handing them pixels.

  // Pixelated square/circle/triangle/diamond: one motif tile, repeated.
  async function exportMotifTile(tile, wantVector, size) {
    const tilePx = tile.size;
    const repeats = Math.ceil(size.w / tilePx) * Math.ceil(size.h / tilePx);
    if (wantVector && repeats <= MAX_INSTANCES) {
      return { type: 'insert-svg', svg: tile.svg, size };
    }
    const bytes = await px.tiledPng(tile.svg, size.w, size.h);
    return { type: 'insert-png', bytes, size, why: wantVector ? { repeats } : null };
  }

  // Hexagons don't repeat on a square tile, but the app's own emitter takes a
  // target width/height — so draw the hex field at exactly W×H.
  async function exportHexagons(wantVector, size) {
    const { palette, motif } = _currentMotif();
    const inner = _svgHexagons(motif, palette, state.gridSize, size.w, size.h);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" `
      + `viewBox="0 0 ${size.w} ${size.h}"><rect width="${size.w}" height="${size.h}" `
      + `fill="${state.colors[0]}"/>\n${inner}</svg>`;
    const shapes = countShapes(inner);
    if (wantVector && shapes <= MAX_VECTOR_NODES) return { type: 'insert-svg', svg };
    const bytes = await drawToPng(await loadImage(svgUrl(svg)), size.w, size.h);
    return { type: 'insert-png', bytes, size, why: wantVector ? { shapes } : null };
  }

  // Freehand SVG: freehand.js emits <svg><rect bg/><rect fill="url(#p)"/></svg>
  // where #p is one verified repeat — true vector elements after editing or AI,
  // or an embedded raster tile for the parametric generators. Figma's SVG
  // importer can't be trusted with <pattern> fills, so we unpack it:
  //   vector content → that tile as a component, repeated
  //   raster content → the browser renders the pattern at exactly W×H
  async function exportFreehandSvg(svg, wantVector, size) {
    const root = svg.match(/<svg\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/);
    const pat = svg.match(/<pattern\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"[^>]*>([\s\S]*?)<\/pattern>/);

    if (!pat || !root) {
      // No verified repeat — the app fell back to a plain snapshot. It can't
      // tile, so insert it at its natural size rather than stretching it.
      const img = await loadImage(svgUrl(svg));
      const bytes = await drawToPng(img, img.naturalWidth || 1200, img.naturalHeight || 1200);
      return { type: 'insert-png', bytes, why: { snapshot: true } };
    }

    const [, pw, ph, content] = pat;
    const bg = (svg.match(/<rect\b[^>]*\bfill="(?!url\()([^"]+)"/) || [])[1];
    const isRaster = /<image\b/.test(content);

    if (wantVector && !isRaster) {
      // The repeat period is usually fractional (e.g. 174.757px). Instances
      // placed at fractional offsets show hairline seams in Figma, so snap the
      // tile to whole pixels — a <0.3% rescale, invisible, and seam-free.
      const tw = Math.max(1, Math.round(pw)), th = Math.max(1, Math.round(ph));
      const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}" `
        + `viewBox="0 0 ${tw} ${th}">`
        + (bg ? `<rect width="${tw}" height="${th}" fill="${bg}"/>` : '')
        + `<g transform="scale(${(tw / pw).toFixed(6)} ${(th / ph).toFixed(6)})">${content}</g></svg>`;
      const repeats = Math.ceil(size.w / tw) * Math.ceil(size.h / th);
      if (repeats <= MAX_INSTANCES) return { type: 'insert-svg', svg: tileSvg, size };
      return rasterFreehand(svg, root, size, { repeats });
    }
    return rasterFreehand(svg, root, size, wantVector ? { rasterStyle: true } : null);
  }

  // Resize the freehand document's canvas to W×H (root + the full-bleed rects)
  // and let the browser tile the pattern — no fractional-tile seams.
  async function rasterFreehand(svg, root, size, why) {
    const [, W0, H0] = root;
    const sized = svg
      .replace(/<svg\b[^>]*>/, (tag) => tag
        .replace(/\bwidth="[\d.]+"/, `width="${size.w}"`)
        .replace(/\bheight="[\d.]+"/, `height="${size.h}"`)
        .replace(/\bviewBox="[^"]*"/, `viewBox="0 0 ${size.w} ${size.h}"`))
      .replace(new RegExp(`<rect width="${W0}" height="${H0}"`, 'g'),
        `<rect width="${size.w}" height="${size.h}"`);
    const bytes = await drawToPng(await loadImage(svgUrl(sized)), size.w, size.h);
    return { type: 'insert-png', bytes, size, why };
  }

  // Freehand PNG: freehand.js hands over one verified repeat tile (or, when no
  // period verifies, the whole canvas). A tile gets repeated to W×H.
  async function exportFreehandPng(res, size) {
    // Our own object URL: the app's was revoked the moment it clicked.
    const url = URL.createObjectURL(await (await res).blob());
    try {
      const img = await loadImage(url);
      const cv = document.getElementById('canvas');
      const isSnapshot = cv && img.naturalWidth === cv.width && img.naturalHeight === cv.height;
      if (isSnapshot) {
        const bytes = await drawToPng(img, img.naturalWidth, img.naturalHeight);
        return { type: 'insert-png', bytes, why: { snapshot: true } };
      }
      return { type: 'insert-png', bytes: await px.repeatToPng(img, size.w, size.h), size };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Entry point from the download interceptor in ui-shim.js. `res` is the
  // fetch of the app's export, started synchronously inside its click. Returns
  // the message for the sandbox; the shim posts it (or reports the failure).
  px.handleExport = async ({ res, wantVector, freehand }) => {
    const size = px.exportSize();
    if (freehand) {
      if (!wantVector) return exportFreehandPng(res, size);
      return exportFreehandSvg(await (await res).text(), wantVector, size);
    }
    // Pixelated builds its output from app state; the app's own export (in
    // `res`) is viewport-sized and unused. Swallow it so it can't reject loudly.
    res.catch(() => {});
    const shape = state.editGrid ? 'square' : state.tileShape;
    if (shape === 'hexagon') return exportHexagons(wantVector, size);
    const tile = px.buildTileSvg();
    if (!tile) throw new Error('could not build the pattern tile');
    return exportMotifTile(tile, wantVector, size);
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

  for (const id of ['btn-png', 'btn-svg', 'fh-png', 'fh-svg']) wireExport(id);

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
  const relabel = {
    'btn-png': 'INSERT PNG', 'btn-svg': 'INSERT SVG',
    'fh-png': 'INSERT PNG', 'fh-svg': 'INSERT SVG',
  };
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

  // ---- AI panel: fit without scrolling --------------------------------------
  // Product rule: no scroll bars in the plugin. At 720px the full web survey
  // measured 683px of a 688px cap (5px spare) and 825px in its worst state
  // (chips picked + both "Other" boxes + an error). Trims, chosen for overlap:
  //   mood   − dense, sparse (level/refine cover density), monochrome (the
  //            palette decides colour), smooth (≈ soft), glitchy (≈ chaotic)
  //   theme  − down to one row; "Other" still takes any theme
  //   detail − slider hidden and pinned to "balanced"; denser/sparser refine
  //            chips adjust density after generating
  // Result: 478px default, ~620px worst case. The website keeps everything.
  const AI_DROP = {
    'mood-tags': ['dense', 'sparse', 'monochrome', 'smooth', 'glitchy'],
    'culture-tags': ['Aztec', 'Celtic', 'Tribal', 'Brutalist', 'Ukiyo-e'],
  };
  for (const [group, tags] of Object.entries(AI_DROP)) {
    for (const tag of tags) {
      const chip = document.querySelector(`#${group} [data-tag="${tag}"]`);
      if (chip) chip.remove();
    }
  }
  const detailInput = document.getElementById('ai-detail');
  if (detailInput) {
    // Through the app's own input handler, so survey.detail follows — a value
    // saved from an earlier session must not linger invisibly.
    detailInput.value = '3';
    detailInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // With the detail slider hidden, the app's advice to "lower the detail"
  // points at a control that isn't there. Its error mapper lives in a closure,
  // so rewrite the rendered text instead — both the survey and refine errors.
  const DETAIL_ADVICE = [
    [/\s*Lower the detail and try again\.?/i, ' Try again in a moment.'],
    [/Try again, or lower the detail\.?/i, 'Try again in a moment.'],
  ];
  const errorObserver = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!el) continue;
      let text = el.textContent;
      for (const [re, to] of DETAIL_ADVICE) text = text.replace(re, to);
      if (text !== el.textContent) el.textContent = text;   // no-op on the second pass
    }
  });
  for (const id of ['ai-error', 'ai-result-error']) {
    const el = document.getElementById(id);
    if (el) errorObserver.observe(el, { childList: true, characterData: true, subtree: true });
  }

  const aiStyle = document.createElement('style');
  aiStyle.textContent = `
    #ai-step-1 .ai-detail-head,
    #ai-step-1 .ai-detail-head + .slider-row { display: none !important; }
    /* The slider used to separate theme from the fast/best toggle; without it
       they sat 4px apart. Restore the panel's 14px section rhythm. */
    #ai-step-1 .ai-quality { margin-top: 14px !important; }
    /* Belt and braces for the no-scrollbar rule: everything is sized to fit,
       but an unforeseen overflow should never paint a bar. */
    #ai-panel { scrollbar-width: none; }
    #ai-panel::-webkit-scrollbar { display: none; }
  `;
  document.head.appendChild(aiStyle);

  // ---- corner buttons vs open panels ---------------------------------------
  // The web layout assumes a tall browser window. In a 720px panel the floating
  // cards reach the corners, so the edit button lands on INSERT PNG and the
  // mode toggle on the AI generate button. Rather than hardcode which pairs
  // collide at which size, measure: any corner control overlapping an open
  // card steps aside until that card closes.
  const PANEL_IDS = ['panel', 'fh-panel', 'ai-panel'];
  const CORNER_IDS = ['edit-btn', 'mode-toggle', 'made-by-tag'];
  const yieldStyle = document.createElement('style');
  yieldStyle.textContent = '.px-yield { visibility: hidden !important; pointer-events: none !important; }';
  document.head.appendChild(yieldStyle);

  const overlaps = (a, b) =>
    !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

  function openCardRects() {
    return PANEL_IDS
      .map(id => document.getElementById(id))
      .filter(p => p && getComputedStyle(p).display !== 'none')
      .map(p => (p.querySelector('.panel-card') || p).getBoundingClientRect())
      .filter(r => r.width > 0 && r.height > 0);
  }

  function resolveCollisions() {
    const cards = openCardRects();
    for (const id of CORNER_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      // visibility:hidden keeps the box, so measuring while hidden is safe.
      const r = el.getBoundingClientRect();
      el.classList.toggle('px-yield', r.width > 0 && cards.some(c => overlaps(r, c)));
    }
  }

  // Panels open via inline style or class changes from several code paths;
  // watch them rather than hook each one. Re-check after the open animation.
  let settleCheck = null;
  const scheduleCollisions = () => {
    resolveCollisions();
    clearTimeout(settleCheck);
    settleCheck = setTimeout(resolveCollisions, 400);
  };
  const collisionObserver = new MutationObserver(scheduleCollisions);
  for (const id of PANEL_IDS) {
    const p = document.getElementById(id);
    if (p) collisionObserver.observe(p, { attributes: true, attributeFilter: ['style', 'class'] });
  }
  collisionObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', scheduleCollisions);
  scheduleCollisions();

  // ---- keyboard focus ----------------------------------------------------
  // Figma opens the plugin with focus still on its canvas, so the first Space
  // would pan Figma instead of randomising. Take focus once the app is up.
  setTimeout(() => { try { window.focus(); } catch (e) { /* not permitted */ } }, 0);

  // ---- external links ----------------------------------------------------
  // Plugin iframes have no opener; route clicks through figma.openExternal.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="http"]');
    if (!a) return;
    e.preventDefault();
    px.post({ type: 'open-url', url: a.href });
  }, true);
})();
