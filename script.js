

// Updated script keeping original program features and fixing:
// - editable inputs (clicks inside inputs don't start drag)
// - container blocks grow downwards (left side fixed) and fit stacked children
// - dragging a nested block out won't "teleport" it
// - input-slot nesting preserved
// - save/load, block designer, palette, code generation preserved

document.addEventListener("DOMContentLoaded", () => {
  const palette = document.getElementById("palette");
  const workspace = document.getElementById("workspace");
  const workspaceContainer = document.getElementById("workspaceContainer");
  const blockDesigner = document.getElementById("blockDesigner");
  const codeOutput = document.getElementById("codeOutput");
  const codeArea = document.getElementById("codeArea");
  const trash = document.getElementById("trash");

  let blocks = []; // all block element references
  let blockDefs = []; // palette + custom block definitions

  // Utility: create SVG element
  function svg(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (let k in attrs) {
      if (k === "textContent") el.textContent = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  // Parse label into parts: text and %inputs (with variable names)
  function parseLabel(label) {
    return label.split(/(%\w+)/g).filter(s => s.length > 0);
  }
function findContainerForBlock(block, containers) {
  for (let container of containers) {
    const innerBlocks = container.containerGroup ? Array.from(container.containerGroup.children) : [];
    if (container.dataset.type === "container" && isInside(block, container)) {
      const deeper = findContainerForBlock(block, innerBlocks.filter(b => b.dataset.type === "container"));
      return deeper || container;
    }
  }
  return null;
}


  // create block (def = {label,type,color,templates})
  // headerHeight saved to g.headerHeight for containers so updateContainerHeight can use it
  function createBlock(def, x = 10, y = 10, providedId = null) {
    const g = svg("g", { class: "block", transform: `translate(${x},${y})` });
    g.dataset.type = def.type;
    g.dataset.color = def.color;
    g.dataset.label = def.label;
    g.dataset.templates = JSON.stringify(def.templates || {});
    g.dataset.id = providedId || crypto.randomUUID();
    g.style.setProperty("--block-color", def.color);

    let width = 140, height = 30;
    const parts = parseLabel(def.label);
    let estWidth = 12;
    parts.forEach(p => { estWidth += p.startsWith("%") ? 64 : p.length * 8; });
    width = Math.max(width, estWidth);

    const headerHeight = height;
    g.headerHeight = headerHeight;

    // Shapes
    if (def.type === "command" || def.type === "container" || def.type === "function") {
        const bg = svg("rect", { width, height, fill: def.color, rx: 8, ry: 8, class: "block-command-rect" });
        g.appendChild(bg);

        if (def.type === "container" || def.type === "function") {
            const innerRect = svg("rect", {
                x: 10, y: height - 8, width: width - 20, height: 100,
                fill: def.type === "function" ? "#ffd7d7" : "#d0e2ff",
                stroke: def.color, "stroke-width": 2, rx: 8, ry: 8, class: "container-inner"
            });
            g.appendChild(innerRect);

            const containerGroup = svg("g", { class: "container-inner-group" });
            containerGroup.setAttribute("transform", `translate(10,${headerHeight + 4})`);
            g.appendChild(containerGroup);

            g.containerGroup = containerGroup;
            g.containerInnerRect = innerRect;
            g.minInnerHeight = 80;
// Auto-detect %placeholder used for the container body from the templates.
// Falls back to "body" if nothing obvious is found.
const allTemplates = Object.values(def.templates || {}).join(" ");
const m = allTemplates.match(/%(body|then|else|area|content|inner)\b/);
g.dataset.containerVar = def.containerVar || (m ? m[1] : "body");
            
            g.nestedBlocks = [];

            // --- BLOCK DROPPING LOGIC ---
            g.addEventListener("mouseenter", () => {
                g.isHoveredContainer = true;
            });
            g.addEventListener("mouseleave", () => {
                g.isHoveredContainer = false;
            });

            containerGroup.addEventListener("blockDropped", (evt) => {
                const childBlock = evt.detail.block;
                if (!g.nestedBlocks) g.nestedBlocks = [];
                g.nestedBlocks.push(childBlock);
                childBlock.parentContainerVar = g.dataset.containerVar;
                g.updateContainerHeight();
            });

            g.updateContainerHeight = function () {
                let yAcc = 0;
                for (const nb of g.nestedBlocks) {
                    nb.setAttribute("transform", `translate(0,${yAcc})`);
                    const bbox = nb.getBBox();
                    yAcc += bbox.height + 8;
                }
                const innerH = Math.max(g.minInnerHeight, yAcc + 12);
                g.containerInnerRect.setAttribute("height", innerH);
                g.containerGroup.setAttribute("transform", `translate(10,${g.headerHeight + 4})`);
            };
        }
    } else if (def.type === "reporter") {
        height = 28;
        const bg = svg("rect", { width, height, fill: def.color, rx: 14, ry: 14, class: "block-reporter-rect" });
        g.appendChild(bg);
        g.headerHeight = height;
    } else if (def.type === "boolean") {
        height = 28;
        const bg = svg("polygon", {
            points: `0,${height/2} ${12},0 ${width-12},0 ${width},${height/2} ${width-12},${height} 12,${height}`,
            fill: def.color, class: "block-boolean-polygon"
        });
        g.appendChild(bg);
        g.headerHeight = height;
    }

    // Label and inputs
    let offsetX = 10;
    g.inputs = {};
    parts.forEach(part => {
        if (part.startsWith("%")) {
            const varName = part.slice(1);
            const fo = svg("foreignObject", {
                x: offsetX,
                y: (def.type === "container" ? 8 : (height / 2) - 10),
                width: 60,
                height: 22,
                class: "block-input-fo"
            });
            fo.dataset.varname = varName;

            const input = document.createElement("input");
            input.classList.add("block-input");
            input.type = "text";
            input.value = "";
            input.dataset.varname = varName;
            input.title = varName;
            input.addEventListener("mousedown", (e) => e.stopPropagation());
            input.addEventListener("click", (e) => e.stopPropagation());

            fo.appendChild(input);
            g.appendChild(fo);
            g.inputs[varName] = { fo, input, childId: null };
            offsetX += 66;
        } else {
            const text = svg("text", {
                x: offsetX,
                y: (def.type === "container" ? 20 : (height / 2) + 5),
                fill: "white",
                "font-weight": "bold",
                "pointer-events": "none",
                textContent: part
            });
            g.appendChild(text);
            offsetX += part.length * 8;
        }
    });

    g.nestedBlocks = g.nestedBlocks || [];
    g.parentBlock = null;
    g.parentInput = null;

    g.addEventListener("mousedown", blockDragStart);
    g.addEventListener("dblclick", () => {
        for (const vn in g.inputs) {
            const info = g.inputs[vn];
            if (info.childId) {
                const child = blocks.find(b => b.dataset.id === info.childId);
                if (child) detachFromParent(child);
                info.childId = null;
                info.fo.innerHTML = "";
                info.fo.appendChild(info.input);
            }
        }
    });

    return g;
}


  // --- Transform helpers (get/set) ---
  function getTransform(el) {
    const t = el.transform.baseVal.getItem(0).matrix;
    return { x: t.e, y: t.f };
  }
  function setTransform(el, x, y) {
    el.setAttribute("transform", `translate(${x},${y})`);
  }

  // --- Drag & Drop state ---
  let dragBlock = null;
  let dragOffset = { x: 0, y: 0 };
  let dragStartFromPalette = false;

  // get SVG point in workspace coordinates
  function svgPoint(clientX, clientY) {
    const pt = workspace.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(workspace.getScreenCTM().inverse());
  }

  // detach a block from a parent (container or input) and preserve its *world* position
  function detachFromParent(block) {
    if (!block.parentBlock && !block.parentInput) return;

    // compute current world position (use getCTM to obtain full transform)
    let worldCTM = block.getCTM();
    const worldX = worldCTM.e;
    const worldY = worldCTM.f;

    // remove references in parent
    if (block.parentInput) {
      const parent = blocks.find(b => b.dataset.id === block.parentInput.parentId);
      if (parent) {
        const info = parent.inputs[block.parentInput.varname];
        if (info) {
          info.childId = null;
          // restore the input element
          info.fo.innerHTML = "";
          info.fo.appendChild(info.input);
        }
      }
      block.parentInput = null;
      block.parentBlock = null;
    } else if (block.parentBlock) {
      const parent = blocks.find(b => b.dataset.id === block.parentBlock);
      if (parent) {
        const idx = parent.nestedBlocks.indexOf(block);
        if (idx >= 0) parent.nestedBlocks.splice(idx, 1);
        if (parent.updateContainerHeight) parent.updateContainerHeight();
      }
      block.parentBlock = null;
    }

    // set the block's transform to the same *world* coords but relative to workspace
    const p = svgPoint(worldX, worldY); // convert screen/world to workspace svg coords
    // However svgPoint expects client coords; worldX/worldY are screen coords; adjust:
    // We can compute inverse using screenCTM: use workspace.getScreenCTM()
    const screenCTM = workspace.getScreenCTM();
    // transform world (SVG root) coords to client space: worldCTM gives screen coords already
    // convert back: create an SVGPoint with worldCTM.e/f and invert
    const pt = workspace.createSVGPoint();
    pt.x = worldX; pt.y = worldY;
    const local = pt.matrixTransform(workspace.getScreenCTM().inverse());
    setTransform(block, local.x, local.y);
    // append to top-level workspace so it becomes independent
    if (block.parentNode !== workspace) workspace.appendChild(block);
  }

  // remove a block permanently
  function removeBlock(block) {
    // detach any nested children first
    if (block.nestedBlocks && block.nestedBlocks.length) {
      for (const nb of [...block.nestedBlocks]) {
        removeBlock(nb);
      }
    }
    // if block is used as input child somewhere, clear that reference
    blocks.forEach(b => {
      for (const vn in b.inputs) {
        if (b.inputs[vn].childId === block.dataset.id) {
          b.inputs[vn].childId = null;
          b.inputs[vn].fo.innerHTML = "";
          b.inputs[vn].fo.appendChild(b.inputs[vn].input);
        }
      }
      // also remove from container nested list if present
      const idx = b.nestedBlocks.indexOf(block);
      if (idx >= 0) b.nestedBlocks.splice(idx, 1);
      if (b.updateContainerHeight) b.updateContainerHeight();
    });

    // finally remove DOM and remove from blocks array
    if (block.parentNode) block.parentNode.removeChild(block);
    blocks = blocks.filter(b => b !== block);
  }

  // snapping detection: return object describing target
  function findSnapTarget(mpos, movingBlock) {
    // prefer input-slot snaps for reporter/boolean
    if (["reporter", "boolean"].includes(movingBlock.dataset.type)) {
      for (const parent of blocks) {
        if (parent === movingBlock) continue;
        for (const vn in parent.inputs) {
          const info = parent.inputs[vn];
          const foRect = info.fo.getBoundingClientRect();
          if (movingBlock._lastMouse) {
            const mx = movingBlock._lastMouse.clientX;
            const my = movingBlock._lastMouse.clientY;
            if (mx >= foRect.left && mx <= foRect.right && my >= foRect.top && my <= foRect.bottom) {
              return { kind: "input", parent: parent, varname: vn, fo: info.fo };
            }
          }
        }
      }
    }

    // container snap (place inside container area)
    for (const candidate of blocks) {
      if (candidate === movingBlock) continue;
      if (candidate.dataset.type === "container") {
        const inner = candidate.containerInnerRect;
        const innerBox = inner.getBBox();
        const t = candidate.getCTM();
        // compute inner rect in client coords
        const p1 = workspace.createSVGPoint(); p1.x = innerBox.x + innerBox.width/2; p1.y = innerBox.y + innerBox.height/2;
        const screen = p1.matrixTransform(candidate.getCTM()); // center in screen coords
        // compare screen position roughly using mouse last pos
        if (movingBlock._lastMouse) {
          const mx = movingBlock._lastMouse.clientX;
          const my = movingBlock._lastMouse.clientY;
          // get bounding rect in client coords to allow containment detection
          const innerRectClient = inner.getBoundingClientRect();
          if (mx >= innerRectClient.left - 8 && mx <= innerRectClient.right + 8 &&
              my >= innerRectClient.top - 8 && my <= innerRectClient.bottom + 8) {
            return { kind: "container", parent: candidate };
          }
        }
      }
    }

    // normal below-snap: choose candidate bottom near mouse
    const candidates = blocks.filter(b => b !== movingBlock && (b.dataset.type === "command" || b.dataset.type === "container"));
    for (const target of candidates) {
      const bbox = target.getBBox();
      const t = target.getCTM();
      const left = t.e;
      const right = t.e + bbox.width;
      const bottom = t.f + bbox.height;
      const mouseX = mpos.x, mouseY = mpos.y;
      if (mouseX > left - 10 && mouseX < right + 10 && mouseY > bottom - 16 && mouseY < bottom + 20) {
        return { kind: "below", target };
      }
    }
    return null;
  }

  // snap actions
  function snapUnder(block, target) {
    // not used directly here (kept for compatibility)
    const t = target.getCTM();
    const bbox = target.getBBox();
    const newX = t.e;
    const newY = t.f + bbox.height + 6;
    detachFromParent(block);
    block.parentBlock = target.dataset.id;
    target.nestedBlocks.push(block);
    // compute stack y
    let stackY = 0;
    for (const nb of target.nestedBlocks) {
      if (nb === block) continue;
      stackY = Math.max(stackY, parseFloat(nb.getAttribute("transform").match(/translate\(([^,]+),([^\)]+)\)/)[2]) + nb.getBBox().height + 8);
    }
    // place inside containerGroup
    block.setAttribute("transform", `translate(0,${stackY})`);
    target.containerGroup.appendChild(block);
    block.parentBlock = target.dataset.id;
    if (target.updateContainerHeight) target.updateContainerHeight();
  }

  function snapToInput(block, parent, varname) {
    detachFromParent(block);
    const info = parent.inputs[varname];
    if (!info) return;
    // replace input with placeholder (we'll keep a div placeholder to reserve FO)
    info.fo.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.style.width = "1px"; placeholder.style.height = "1px";
    info.fo.appendChild(placeholder);
    // compute FO local coordinates to place child
    const foBox = info.fo.getBBox();
    // position block relative to parent (we'll append to parent so transform is relative)
    block.setAttribute("transform", `translate(${foBox.x},${foBox.y})`);
    parent.appendChild(block);
    info.childId = block.dataset.id;
    block.parentInput = { parentId: parent.dataset.id, varname };
    block.parentBlock = parent.dataset.id;
  }

  // If user moves block outside workspace bounds, delete it
  function isPointOutsideWorkspace(clientX, clientY) {
    const rect = workspace.getBoundingClientRect();
    if (clientX < rect.left - 6 || clientX > rect.right + 6 || clientY < rect.top - 6 || clientY > rect.bottom + 6) {
      return true;
    }
    return false;
  }

  // --- Drag handlers ---
  function blockDragStart(evt) {
    evt.preventDefault();
    const target = evt.currentTarget;
    dragBlock = target;
    dragStartFromPalette = false;

    // Compute world position BEFORE detaching so we can preserve it
    const worldCTM = target.getCTM();
    const worldX = worldCTM.e;
    const worldY = worldCTM.f;

    // detach if inside parent so the block becomes top-level but at same visual position
    if (dragBlock.parentInput || dragBlock.parentBlock) {
      // safe detach: this will preserve world position and reparent to workspace
      detachFromParent(dragBlock);
    }

    // Set drag offsets relative to current position
    const pt = svgPoint(evt.clientX, evt.clientY);
    const tf = dragBlock.transform.baseVal.getItem(0).matrix;
    dragOffset.x = pt.x - tf.e;
    dragOffset.y = pt.y - tf.f;

    // bring to top
    workspace.appendChild(dragBlock);

    workspace.addEventListener("mousemove", blockDragMove);
    workspace.addEventListener("mouseup", blockDragEnd);
    document.addEventListener("mouseup", blockDragEnd);
  }

  function blockDragMove(evt) {
    evt.preventDefault();
    if (!dragBlock) return;
    // store last mouse for snapping detection to input
    dragBlock._lastMouse = { clientX: evt.clientX, clientY: evt.clientY };
    const pt = svgPoint(evt.clientX, evt.clientY);
    const newX = pt.x - dragOffset.x;
    const newY = pt.y - dragOffset.y;
    setTransform(dragBlock, newX, newY);
  }

  function blockDragEnd(evt) {
    if (!dragBlock) return;
    // if dropped outside workspace or on trash, remove block
    const outside = isPointOutsideWorkspace(evt.clientX, evt.clientY);
    const trashRect = trash.getBoundingClientRect();
    const overTrash = evt.clientX >= trashRect.left && evt.clientX <= trashRect.right && evt.clientY >= trashRect.top && evt.clientY <= trashRect.bottom;
    if (outside || overTrash) {
      removeBlock(dragBlock);
      dragBlock = null;
      workspace.removeEventListener("mousemove", blockDragMove);
      workspace.removeEventListener("mouseup", blockDragEnd);
      document.removeEventListener("mouseup", blockDragEnd);
      return;
    }

    const mpos = svgPoint(evt.clientX, evt.clientY);
    const snap = findSnapTarget(mpos, dragBlock);
    if (snap) {
      if (snap.kind === "input") {
        snapToInput(dragBlock, snap.parent, snap.varname);
      } else if (snap.kind === "container") {
        // append into container at bottom of stacked children
        const parent = snap.parent;
        detachFromParent(dragBlock);
        parent.nestedBlocks.push(dragBlock);
        parent.containerGroup.appendChild(dragBlock);
        // parent.updateContainerHeight will layout children
        if (parent.updateContainerHeight) parent.updateContainerHeight();
        dragBlock.parentBlock = parent.dataset.id;
      } else if (snap.kind === "below") {
        // put block under target in workspace (not nested)
        const target = snap.target;
        const t = target.getCTM();
        const newX = t.e;
        const newY = t.f + target.getBBox().height + 6;
        detachFromParent(dragBlock);
        workspace.appendChild(dragBlock);
        // convert client coords to svg coords using inverse CTM
        const ptSvg = svgPoint(evt.clientX, evt.clientY);
        setTransform(dragBlock, newX, newY);
      }
    }

    // update any container heights that might have changed
    blocks.forEach(b => { if (b.updateContainerHeight) b.updateContainerHeight(); });

    dragBlock = null;
    workspace.removeEventListener("mousemove", blockDragMove);
    workspace.removeEventListener("mouseup", blockDragEnd);
    document.removeEventListener("mouseup", blockDragEnd);
  }

  // --- Palette drag: create instance while dragging ---
  let dragFromPalette = null;
  let dragFromPaletteEl = null;

function paletteBlockDragStart(evt) {
  // Only start a drag with the LEFT mouse button
  if (evt.button !== 0) return;

  evt.preventDefault();
  const idx = +evt.currentTarget.dataset.index;
  dragFromPalette = blockDefs[idx];
  const pt = svgPoint(evt.clientX, evt.clientY);
  dragFromPaletteEl = createBlock(dragFromPalette, pt.x, pt.y);
  dragFromPaletteEl.style.pointerEvents = "none";
  workspace.appendChild(dragFromPaletteEl);
  workspace.addEventListener("mousemove", paletteDragMove);
  workspace.addEventListener("mouseup", paletteDragEnd);
  document.addEventListener("mouseup", paletteDragEnd);
}


  function paletteDragMove(evt) {
    evt.preventDefault();
    if (!dragFromPaletteEl) return;
    const pt = svgPoint(evt.clientX, evt.clientY);
    setTransform(dragFromPaletteEl, pt.x, pt.y);
    dragFromPaletteEl._lastMouse = { clientX: evt.clientX, clientY: evt.clientY };
  }

  function paletteDragEnd(evt) {
    if (!dragFromPaletteEl) return;
    dragFromPaletteEl.style.pointerEvents = "auto";

    // if dropped outside workspace -> remove
    if (isPointOutsideWorkspace(evt.clientX, evt.clientY)) {
      if (dragFromPaletteEl.parentNode) dragFromPaletteEl.parentNode.removeChild(dragFromPaletteEl);
      dragFromPaletteEl = null;
      dragFromPalette = null;
      workspace.removeEventListener("mousemove", paletteDragMove);
      workspace.removeEventListener("mouseup", paletteDragEnd);
      document.removeEventListener("mouseup", paletteDragEnd);
      return;
    }

    // finalize creation
    blocks.push(dragFromPaletteEl);
    dragFromPaletteEl = null;
    dragFromPalette = null;
    workspace.removeEventListener("mousemove", paletteDragMove);
    workspace.removeEventListener("mouseup", paletteDragEnd);
    document.removeEventListener("mouseup", paletteDragEnd);
  }

// --- Code generation ---
// global store for function bodies during generation
let functionBodies = {};

function generateCodeFromBlock(block, lang, indent = "") {
  const templates = JSON.parse(block.dataset.templates || "{}");
  let template = templates[lang] || templates.javascript || "";

  // gather inputs mapping
  const inputs = {};
  for (const vn in block.inputs) {
    const info = block.inputs[vn];
    if (info.childId) {
      const child = blocks.find(b => b.dataset.id === info.childId);
      if (child) {
        inputs[vn] = generateCodeFromBlock(child, lang, indent + (lang === "python" ? "    " : ""));
      } else {
        inputs[vn] = info.input ? info.input.value : "";
      }
    } else {
      inputs[vn] = info.input ? info.input.value : "";
    }
  }

  // replacements for inputs
  for (const k in inputs) {
    template = template.replaceAll(`%${k}`, inputs[k]);
  }

  // nested blocks
  let innerCode = "";
  if (block.nestedBlocks?.length) {
    innerCode = block.nestedBlocks
      .map(b => generateCodeFromBlock(b, lang, indent + (lang === "python" ? "    " : "")))
      .join(lang === "python" ? "\n" + indent + "    " : "\n");
  }

  // detect if this block is defining a function-like container
  // e.g. "%funcName = %body"
  const funcDefMatch = template.match(/^(\w+)\s*=\s*%body$/);
  if (funcDefMatch && innerCode) {
    const funcName = funcDefMatch[1];
    functionBodies[funcName] = innerCode;
    return ""; // function definition itself doesn't output code here
  }

  // if block is a function call placeholder, replace it with stored body
  if (functionBodies[template.trim()]) {
    return functionBodies[template.trim()];
  }

  // normal container variable replacement
  if (block.dataset.containerVar) {
    const varName = block.dataset.containerVar;
    template = template.replaceAll(`%${varName}`, innerCode || "");
  } else {
    template = template.replace(/%body|%then|%else/g, innerCode || "");
  }

  // cleanup quotes around vars
  template = template.replace(/(\b(?:local|var|let|const|int|float|string|auto|char|double|bool|def|function)\s+)"([^"]+)"(\s*=)/g,
    (match, p1, p2, p3) => p1 + p2 + p3);
  template = template.replace(/=(\s*)"([^"]+)"/g, (match, p1, p2) => '=' + p1 + p2);

  return template;
}
  // --- UI buttons ---
  document.getElementById("newBlockBtn").onclick = () => { blockDesigner.style.display = "flex"; };
  document.getElementById("closeDesignerBtn").onclick = () => { blockDesigner.style.display = "none"; };
  document.getElementById("closeCodeOutputBtn").onclick = () => { codeOutput.style.display = "none"; };

// ==================== Block Designer Handlers ====================

document.getElementById("addBlockBtn").onclick = () => {
  const label = document.getElementById("blockLabel").value.trim();
  const type = document.getElementById("blockType").value;
  const color = document.getElementById("blockColor").value;
  const templateJS = document.getElementById("templateJS").value.trim();
  const templatePy = document.getElementById("templatePy").value.trim();
  const templateC = document.getElementById("templateC").value.trim();
  if (!label) { alert("Label required"); return; }
  const newDef = { label, type, color, templates: { javascript: templateJS || "", python: templatePy || "", c: templateC || "" } };
  blockDefs.push(newDef);
  addPaletteEntry(newDef, blockDefs.length - 1);
  blockDesigner.style.display = "none";
  // clear inputs
  document.getElementById("blockLabel").value = "";
  document.getElementById("templateJS").value = "";
  document.getElementById("templatePy").value = "";
  document.getElementById("templateC").value = "";
};

document.getElementById("generateBtn").onclick = () => {
  const lang = document.getElementById("langSelect").value;
  functionBodies = {}; // reset
  const rootBlocks = blocks.filter(b => !b.parentBlock && !b.parentInput);
  const codeParts = rootBlocks.map(b => generateCodeFromBlock(b, lang));
  codeOutput.style.display = "flex";
  codeArea.textContent = codeParts.join("\n");
};


document.getElementById("saveBtn").onclick = () => {
  saveWorkspace();
  alert("Workspace saved to localStorage.");
};

document.getElementById("clearBtn").onclick = () => {
  if (!confirm("Clear workspace and palette to defaults?")) return;
  localStorage.removeItem("svgBlockEditor.save");
  location.reload();
};

// ==================== Palette / Workspace Functions ====================

function addPaletteEntry(def, idx) {
  const div = document.createElement("div");
  div.classList.add("palette-block");
  div.textContent = def.label.replace(/%\w+/g, "_");
  div.style.backgroundColor = def.color;
  div.dataset.index = idx;

  div.addEventListener("mousedown", paletteBlockDragStart);

  div.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const niceName = def.label.replace(/%\w+/g, "_");
    const ok = confirm(`Delete the block "${niceName}" from the palette?\n\n(Note: existing blocks already placed in the workspace will remain.)`);
    if (!ok) return;
    blockDefs.splice(idx, 1);
    palette.innerHTML = "";
    blockDefs.forEach((def, i) => addPaletteEntry(def, i));
    try { saveWorkspace(); } catch (_) {}
  });

  palette.appendChild(div);
}

function initPalette(defaults) {
  palette.innerHTML = "";
  blockDefs = defaults.slice();
  blockDefs.forEach((def, i) => addPaletteEntry(def, i));
}

// ==================== Save / Load Workspace ====================

function serializeWorkspace() {
  const blockStates = blocks.map(b => {
    const tf = getTransform(b);
    const inputState = {};
    for (const vn in b.inputs) {
      inputState[vn] = {
        value: b.inputs[vn].input ? b.inputs[vn].input.value : "",
        childId: b.inputs[vn].childId
      };
    }
    return {
      id: b.dataset.id,
      label: b.dataset.label,
      type: b.dataset.type,
      color: b.dataset.color,
      templates: JSON.parse(b.dataset.templates || "{}"),
      x: tf.x,
      y: tf.y,
      parentBlock: b.parentBlock || null,
      parentInput: b.parentInput || null,
      inputState,
      nestedIds: b.nestedBlocks ? b.nestedBlocks.map(nb => nb.dataset.id) : []
    };
  });
  const payload = { blockDefs, blockStates, savedAt: Date.now() };
  localStorage.setItem("svgBlockEditor.save", JSON.stringify(payload));
  return payload;
}

function saveWorkspace() {
  return serializeWorkspace();
}

function loadWorkspaceFromStorage(payload = null) {
  const raw = payload || localStorage.getItem("svgBlockEditor.save");
  if (!raw) return false;
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;

    initPalette(data.blockDefs || defaultBlocks());

    blocks.forEach(b => { if (b.parentNode) b.parentNode.removeChild(b); });
    blocks = [];

    const idToEl = {};
    for (const st of data.blockStates || []) {
      const defLike = { label: st.label, type: st.type, color: st.color, templates: st.templates || {} };
      const el = createBlock(defLike, st.x || 10, st.y || 10, st.id);
      for (const vn in st.inputState) {
        if (el.inputs[vn]) el.inputs[vn].input.value = st.inputState[vn].value;
      }
      blocks.push(el);
      idToEl[st.id] = el;
      workspace.appendChild(el);
    }

    for (const st of data.blockStates || []) {
      const el = idToEl[st.id];
      if (!el) continue;
      if (st.nestedIds && st.nestedIds.length) {
        st.nestedIds.forEach(nid => {
          const childEl = idToEl[nid];
          if (childEl) attachNestedBlock(el, childEl);
        });
      }
      if (st.parentBlock) {
        const parentEl = idToEl[st.parentBlock];
        if (parentEl) attachChildInput(parentEl, el, st.parentInput);
      }
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// ==================== Export / Import ====================

document.getElementById("exportMenu").addEventListener("change", function() {
  const action = this.value;
  this.value = "";

  if (!action) return;

  if (action.startsWith("export")) {
    let data;
    const serialized = serializeWorkspace();

    if (action === "export-blocks") {
      data = { blockDefs };
    } else if (action === "export-workspace") {
      data = { blockStates: serialized.blockStates };
    } else if (action === "export-project") {
      const lang = document.getElementById("langSelect").value;
      const code = generateCode(lang);
      data = { blockDefs, blockStates: serialized.blockStates, code, lang };
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${action}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (action === "import") {
    document.getElementById("importFile").click();
  }
});

document.getElementById("importFile").addEventListener("change", function(evt) {
  const file = evt.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);

      if (data.blockDefs) {
        blockDefs = data.blockDefs;
        palette.innerHTML = "";
        blockDefs.forEach((def, i) => addPaletteEntry(def, i));
      }

      if (data.blockStates) {
        loadWorkspaceFromStorage(data); // rebuild workspace from imported state
      }

      if (data.code && data.lang) {
        document.getElementById("langSelect").value = data.lang;
        document.getElementById("codeArea").textContent = data.code;
        document.getElementById("codeOutput").style.display = "flex";
      }

      saveWorkspace(); 
      alert("Import successful!");
    } catch (err) {
      alert("Invalid JSON file");
      console.error(err);
    }
  };
  reader.readAsText(file);
  evt.target.value = "";
});



 function addPaletteEntry(def, idx) {
  const div = document.createElement("div");
  div.classList.add("palette-block");
  div.textContent = def.label.replace(/%\w+/g, "_");
  div.style.backgroundColor = def.color;
  div.dataset.index = idx;
div.dataset.blockType = def.type; // store type
div.dataset.containerVar = def.containerVar || ""; // for containers or functions


  // Drag (left mouse only; right-click is handled by contextmenu below)
  div.addEventListener("mousedown", paletteBlockDragStart);

  // Right-click to delete this block definition from the palette
  div.addEventListener("contextmenu", (e) => {
    e.preventDefault(); // stop the browser context menu
    const niceName = def.label.replace(/%\w+/g, "_");
    const ok = confirm(`Delete the block "${niceName}" from the palette?\n\n(Note: existing blocks already placed in the workspace will remain.)`);
    if (!ok) return;

    // Remove this definition
    blockDefs.splice(idx, 1);

    // Rebuild palette with fresh indices
    palette.innerHTML = "";
    for (let i = 0; i < blockDefs.length; i++) {
      addPaletteEntry(blockDefs[i], i);
    }

    // Persist the change (saves blockDefs + current workspace state)
    try { saveWorkspace(); } catch (_) {}
  });

  palette.appendChild(div);
}


  // initialize palette with defaults (or load from storage)
  function initPalette(defaults) {
    palette.innerHTML = "";
    blockDefs = defaults.slice();
    for (let i = 0; i < blockDefs.length; i++) addPaletteEntry(blockDefs[i], i);
  }

  // Save & Load workspace state to localStorage
  function serializeWorkspace() {
    // save blockDefs and blocks with their state
    const blockStates = blocks.map(b => {
      const tf = getTransform(b);
      // capture inputs values and child IDs
      const inputState = {};
      for (const vn in b.inputs) {
        inputState[vn] = {
          value: b.inputs[vn].input ? b.inputs[vn].input.value : "",
          childId: b.inputs[vn].childId
        };
      }
      return {
        id: b.dataset.id,
        label: b.dataset.label,
        type: b.dataset.type,
        color: b.dataset.color,
        templates: JSON.parse(b.dataset.templates || "{}"),
        x: tf.x,
        y: tf.y,
        parentBlock: b.parentBlock || null,
        parentInput: b.parentInput || null,
        inputState,
        nestedIds: b.nestedBlocks ? b.nestedBlocks.map(nb => nb.dataset.id) : []
      };
    });
    const payload = { blockDefs, blockStates, savedAt: Date.now() };
    localStorage.setItem("svgBlockEditor.save", JSON.stringify(payload));
    return payload;
  }

  function saveWorkspace() {
    return serializeWorkspace();
  }

  function loadWorkspaceFromStorage() {
    const raw = localStorage.getItem("svgBlockEditor.save");
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      // load palette defs
      initPalette(data.blockDefs || defaultBlocks());
      // clear existing workspace blocks
      blocks.forEach(b => { if (b.parentNode) b.parentNode.removeChild(b); });
      blocks = [];

      // create blocks from states (first create all nodes without attaching relationships)
      const idToEl = {};
      for (const st of data.blockStates || []) {
        const defLike = { label: st.label, type: st.type, color: st.color, templates: st.templates || {} };
        const el = createBlock(defLike, st.x || 10, st.y || 10, st.id);
        // set input values
        for (const vn in st.inputState) {
          if (el.inputs[vn]) {
            const val = st.inputState[vn].value;
            el.inputs[vn].input.value = val;
          }
        }
        blocks.push(el);
        idToEl[st.id] = el;
        workspace.appendChild(el);
      }

      // Now re-establish relationships (container nesting and input nesting)
      for (const st of data.blockStates || []) {
        const el = idToEl[st.id];
        if (!el) continue;
        // nested container children
        if (st.nestedIds && st.nestedIds.length) {
          for (const childId of st.nestedIds) {
            const childEl = idToEl[childId];
            if (!childEl) continue;
            el.nestedBlocks.push(childEl);
            el.containerGroup.appendChild(childEl);
            // position child stacked (vertical stacking)
            const idx = el.nestedBlocks.indexOf(childEl);
            const y = el.nestedBlocks.slice(0, idx).reduce((acc, nb) => acc + nb.getBBox().height + 8, 0);
            childEl.setAttribute("transform", `translate(0,${y})`);
            childEl.parentBlock = el.dataset.id;
          }
          if (el.updateContainerHeight) el.updateContainerHeight();
        }
        // input children
        if (st.inputState) {
          for (const vn in st.inputState) {
            const childId = st.inputState[vn].childId;
            if (childId) {
              const childEl = idToEl[childId];
              if (!childEl) continue;
              const info = el.inputs[vn];
              if (!info) continue;
              info.fo.innerHTML = "";
              info.fo.appendChild(document.createElement("div"));
              // place child at FO coords relative to parent
              const foBox = info.fo.getBBox();
              childEl.setAttribute("transform", `translate(${foBox.x},${foBox.y})`);
              el.appendChild(childEl);
              info.childId = childEl.dataset.id;
              childEl.parentInput = { parentId: el.dataset.id, varname: vn };
              childEl.parentBlock = el.dataset.id;
            }
          }
        }
      }

      return true;
    } catch (e) {
      console.error("Failed to load workspace:", e);
      return false;
    }
  }

  // --- Default blocks ---
  function defaultBlocks() {
    return [
      {
        label: "say %text",
        type: "command",
        color: "#4C97FF",
        templates: {
          javascript: "console.log(%text);",
          python: "print(%text)",
          c: "printf(\"%s\\n\", %text);"
        }
      },
      {
        label: "wait %seconds seconds",
        type: "command",
        color: "#FFAB19",
        templates: {
          javascript: "await new Promise(r => setTimeout(r, %seconds * 1000));",
          python: "import time\ntime.sleep(%seconds)",
          c: "sleep(%seconds);"
        }
      },
      {
        label: "repeat %times times",
        type: "container",
        color: "#FF6680",
        templates: {
          javascript: "for (let i = 0; i < %times; i++) {\n%body\n}",
          python: "for i in range(%times):\n    %body",
          c: "for (int i = 0; i < %times; i++) {\n%body\n}"
        }
      },
      {
        label: "if %condition then",
        type: "container",
        color: "#2EBA55",
        templates: {
          javascript: "if (%condition) {\n%body\n}",
          python: "if %condition:\n    %body",
          c: "if (%condition) {\n%body\n}"
        }
      },
      {
        label: "if %condition then else",
        type: "container",
        color: "#1E90FF",
        templates: {
          javascript: "if (%condition) {\n%then\n} else {\n%else\n}",
          python: "if %condition:\n    %then\nelse:\n    %else",
          c: "if (%condition) {\n%then\n} else {\n%else\n}"
        }
      },
      {
        label: "%a + %b",
        type: "reporter",
        color: "#FFCA28",
        templates: {
          javascript: "(%a + %b)",
          python: "(%a + %b)",
          c: "(%a + %b)"
        }
      },
      {
        label: "%a > %b",
        type: "boolean",
        color: "#F44336",
        templates: {
          javascript: "(%a > %b)",
          python: "(%a > %b)",
          c: "(%a > %b)"
        }
      }
    ];
  }

  // --- Initialization: load saved or default ---
  if (!loadWorkspaceFromStorage()) {
    initPalette(defaultBlocks());
    // start with empty workspace
    blocks = [];
  }

  // expose save on unload as precaution
  window.addEventListener("beforeunload", () => {
    try { saveWorkspace(); } catch (e) {}
  });

  // export for console debugging (optional)
  window.SVGEditor = { blocks, blockDefs, saveWorkspace, loadWorkspaceFromStorage, serializeWorkspace };
});
