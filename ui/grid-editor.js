import { GRID_SIZE } from "../logic.js";

export function renderModeInfo(state, dom) {
  dom.modeInfo.textContent = `モード: ${state.mode === "place" ? "配置" : "削除"}`;
}

export function renderActiveNodeInfo(state, dom) {
  const node = state.planNodes.find((n) => n.nodeId === state.selectedNodeId);
  dom.activeNodeInfo.textContent = `編集ノード: ${node ? node.name : "なし"}`;
}

export function buildGrid(dom, handlers) {
  dom.grid.innerHTML = "";
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.addEventListener("click", (event) => handlers.onCellClick(x, y, event));
      cell.addEventListener("contextmenu", (event) => handlers.onCellRightClick(x, y, event));
      cell.addEventListener("pointerdown", (event) => handlers.onCellPointerDown?.(x, y, event));
      cell.addEventListener("pointerenter", (event) => handlers.onCellPointerEnter?.(x, y, event));
      cell.addEventListener("pointerup", (event) => handlers.onCellPointerUp?.(x, y, event));
      dom.grid.appendChild(cell);
    }
  }
}

export function renderGridCells(state, dom, getPlacementAt) {
  const activeNode = state.planNodes.find((n) => n.nodeId === state.selectedNodeId);
  const placements = activeNode?.placements || [];
  const occupied = state.activeOccupied;

  const cells = dom.grid.querySelectorAll(".cell");
  cells.forEach((cell) => {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    const placement = getPlacementAt(placements, occupied, x, y);
    if (!placement) {
      if (cell.dataset.renderKey === "empty") return;
      cell.className = "cell";
      delete cell.dataset.mutationId;
      cell.dataset.renderKey = "empty";
      cell.innerHTML = "";
      return;
    }

    const isAnchor = placement.anchorX === x && placement.anchorY === y;
    const size = Math.max(1, Number(placement.size || 1));
    const endX = placement.anchorX + size - 1;
    const endY = placement.anchorY + size - 1;
    const highlighted = state.highlightedMutationId != null && state.highlightedMutationId === placement.mutationId;
    const renderKey = [
      placement.placementId,
      placement.mutationId,
      placement.role || "material",
      size,
      isAnchor ? 1 : 0,
      x === placement.anchorX ? 1 : 0,
      x === endX ? 1 : 0,
      y === placement.anchorY ? 1 : 0,
      y === endY ? 1 : 0,
      highlighted ? 1 : 0,
    ].join("|");

    if (cell.dataset.renderKey === renderKey) return;

    cell.dataset.renderKey = renderKey;
    cell.className = "cell";
    cell.dataset.mutationId = String(placement.mutationId);
    cell.innerHTML = "";
    cell.classList.add("occupied");
    cell.classList.add(`role-${placement.role || "material"}`);
    cell.classList.add("in-placement");
    if (x === placement.anchorX) cell.classList.add("edge-left");
    if (x === endX) cell.classList.add("edge-right");
    if (y === placement.anchorY) cell.classList.add("edge-top");
    if (y === endY) cell.classList.add("edge-bottom");

    if (isAnchor) {
      cell.classList.add("anchor");
      cell.classList.add("placement-anchor");
      const mutation = state.mutationMap.get(placement.mutationId);
      const block = document.createElement("div");
      block.className = "placement-block";
      block.classList.add(`role-${placement.role || "material"}`);
      block.style.setProperty("--placement-size", String(size));

      if (highlighted) {
        block.classList.add("highlight");
      }

      if (mutation) {
        const img = document.createElement("img");
        img.className = "placement-icon";
        img.src = mutation.image;
        img.alt = mutation.name;
        block.appendChild(img);
      }
      cell.appendChild(block);
    }

    if (highlighted) {
      cell.classList.add("highlight");
    }
  });
}
