// Pixable plugin — Figma main thread (sandbox).
// The UI iframe is the whole Pixable web app (built by build.mjs). This side
// only does what the iframe can't: clientStorage persistence and canvas writes.

figma.showUI(__html__, { width: 480, height: 720, themeColors: false });

// ---- storage bridge -------------------------------------------------------
// The UI's localStorage shim keeps an in-memory mirror; we hydrate it once at
// boot (before the app scripts run — the UI waits for this message) and then
// receive write-through updates.
async function hydrate() {
  const keys = await figma.clientStorage.keysAsync();
  const data = {};
  for (const k of keys) data[k] = await figma.clientStorage.getAsync(k);
  figma.ui.postMessage({ type: 'hydrate', data });
}
hydrate();

// ---- canvas inserts -------------------------------------------------------
// Place a new node at the viewport center, select it, and keep it in view.
function placeNode(node, name) {
  node.name = name;
  node.x = Math.round(figma.viewport.center.x - node.width / 2);
  node.y = Math.round(figma.viewport.center.y - node.height / 2);
  figma.currentPage.appendChild(node);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}

function insertSvg(svg, name) {
  const node = figma.createNodeFromSvg(svg);
  placeNode(node, name);
  figma.notify(`Inserted "${name}" as vectors`);
}

function insertPng(bytes, name) {
  const image = figma.createImage(new Uint8Array(bytes));
  const rect = figma.createRectangle();
  // Match the image's own pixel size so the fill is 1:1.
  return image.getSizeAsync().then(({ width, height }) => {
    rect.resize(width, height);
    rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
    placeNode(rect, name);
    figma.notify(`Inserted "${name}" as image`);
  });
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
        insertSvg(msg.svg, msg.name || 'Pixable pattern');
        break;
      case 'insert-png':
        await insertPng(msg.bytes, msg.name || 'Pixable pattern');
        break;
      case 'open-url':
        // window.open shim — Figma sandbox has no opener; use openExternal.
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
    figma.notify(`Pixable: ${e.message}`, { error: true });
  }
};
