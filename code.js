// Pixatile plugin — Figma main thread (sandbox).
// The UI iframe is the whole Pixable web app (built by build.mjs). This side
// only does what the iframe can't: clientStorage persistence and canvas writes.

// 880 wide is deliberate: Pixable switches to its phone layout at 820px, and
// the plugin panel should read as a desktop tool.
figma.showUI(__html__, { width: 880, height: 720, themeColors: false });

// ---- storage bridge -------------------------------------------------------
// The UI's localStorage shim keeps an in-memory mirror; we hydrate it once at
// boot (the UI waits for this message before running the app) and then receive
// write-through updates.
async function hydrate() {
  const keys = await figma.clientStorage.keysAsync();
  const data = {};
  for (const k of keys) data[k] = await figma.clientStorage.getAsync(k);
  figma.ui.postMessage({ type: 'hydrate', data });
}
hydrate();

// ---- canvas inserts -------------------------------------------------------
// Every insert lands as a named frame, so the layers panel says what the
// pattern is and the artwork can be moved/duplicated as one object.
function placeFrame(frame, name) {
  frame.name = name;
  frame.x = Math.round(figma.viewport.center.x - frame.width / 2);
  frame.y = Math.round(figma.viewport.center.y - frame.height / 2);
  figma.currentPage.appendChild(frame);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
}

function insertSvg(svg, name) {
  // createNodeFromSvg already returns a FrameNode wrapping the vectors.
  const frame = figma.createNodeFromSvg(svg);
  frame.fills = [];
  placeFrame(frame, name);
  return frame;
}

async function insertPng(bytes, name) {
  const image = figma.createImage(new Uint8Array(bytes));
  const { width, height } = await image.getSizeAsync();
  const rect = figma.createRectangle();
  rect.resize(width, height);
  rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
  rect.name = 'pattern';

  const frame = figma.createFrame();
  frame.resize(width, height);
  frame.fills = [];
  frame.clipsContent = true;
  frame.appendChild(rect);
  rect.x = 0;
  rect.y = 0;
  placeFrame(frame, name);
  return frame;
}

// ---- messages from the UI -------------------------------------------------
figma.ui.onmessage = async (msg) => {
  try {
    switch (msg.type) {
      case 'storage-set':
        await figma.clientStorage.setAsync(msg.key, msg.value);
        break;
      case 'storage-remove':
        await figma.clientStorage.deleteAsync(msg.key);
        break;
      case 'insert-svg':
        insertSvg(msg.svg, msg.name || 'Pixatile pattern');
        figma.ui.postMessage({ type: 'insert-done' });
        if (msg.heavy) {
          figma.notify(`${msg.heavy.toLocaleString()} shapes — this may be slow to edit`);
        }
        break;
      case 'insert-png':
        await insertPng(msg.bytes, msg.name || 'Pixatile pattern');
        figma.ui.postMessage({ type: 'insert-done' });
        if (msg.fellBackFrom) {
          figma.notify(
            `Too dense for vectors (${msg.fellBackFrom.toLocaleString()} shapes) — inserted as an image`
          );
        }
        break;
      case 'open-url':
        figma.openExternal(msg.url);
        break;
      case 'notify':
        figma.notify(msg.message);
        break;
      case 'resize':
        figma.ui.resize(msg.width, msg.height);
        break;
    }
  } catch (e) {
    figma.notify(`Pixatile: ${e.message}`, { error: true });
    // Only an insert owns a pending button — a failed storage write must not
    // settle one.
    if (msg.type === 'insert-svg' || msg.type === 'insert-png') {
      figma.ui.postMessage({ type: 'insert-failed' });
    }
  }
};
