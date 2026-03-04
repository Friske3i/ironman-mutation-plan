import { GRID_SIZE, computeNodeIO } from "../logic.js";

const NODE_WIDTH = 136;
const NODE_HEIGHT = 136;
const NODE_SNAP = 16;
const WORLD_WIDTH = 6000;
const WORLD_HEIGHT = 4000;
const WORLD_ORIGIN_X = WORLD_WIDTH / 2;
const WORLD_ORIGIN_Y = WORLD_HEIGHT / 2;

function snap(value) {
  return Math.round(value / NODE_SNAP) * NODE_SNAP;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCurvePath(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const cpOffset = Math.max(60, Math.abs(dx) * 0.35);
  const c1x = x1 + cpOffset;
  const c1y = y1;
  const c2x = x2 - cpOffset;
  const c2y = y2;
  return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
}

function createMidArrow(pathElement, color) {
  const total = pathElement.getTotalLength();
  if (!Number.isFinite(total) || total <= 0) return null;

  const mid = total * 0.5;
  const prev = pathElement.getPointAtLength(Math.max(0, mid - 2));
  const curr = pathElement.getPointAtLength(mid);
  const next = pathElement.getPointAtLength(Math.min(total, mid + 2));
  const angle = Math.atan2(next.y - prev.y, next.x - prev.x);

  const length = 14;
  const width = 10;
  const tipX = curr.x + Math.cos(angle) * (length / 2);
  const tipY = curr.y + Math.sin(angle) * (length / 2);
  const baseX = curr.x - Math.cos(angle) * (length / 2);
  const baseY = curr.y - Math.sin(angle) * (length / 2);
  const nx = Math.cos(angle + Math.PI / 2) * (width / 2);
  const ny = Math.sin(angle + Math.PI / 2) * (width / 2);
  const p1 = `${tipX},${tipY}`;
  const p2 = `${baseX + nx},${baseY + ny}`;
  const p3 = `${baseX - nx},${baseY - ny}`;

  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  arrow.setAttribute("points", `${p1} ${p2} ${p3}`);
  arrow.setAttribute("fill", color);
  arrow.style.pointerEvents = "none";
  return arrow;
}

function getNodeEdgeAnchor(fromCenter, toCenter, inset = 0) {
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const absDx = Math.abs(dx) || 0.0001;
  const absDy = Math.abs(dy) || 0.0001;
  const halfW = Math.max(8, NODE_WIDTH / 2 - inset);
  const halfH = Math.max(8, NODE_HEIGHT / 2 - inset);
  const tx = halfW / absDx;
  const ty = halfH / absDy;
  const t = Math.min(tx, ty);
  return {
    x: fromCenter.x + dx * t,
    y: fromCenter.y + dy * t,
  };
}

function colorFromMutationId(state, mutationId) {
  return state.mutationAvgColors?.get(mutationId) || "#3b82f6";
}

function estimateStagesForNode(node, mutationMap) {
  const targets = (node.placements || []).filter((placement) => placement.role !== "material");
  if (!targets.length) return 0;

  let longest = 0;
  for (const target of targets) {
    const stage = mutationMap.get(target.mutationId)?.maxGrowthStage || 0;
    if (stage > longest) longest = stage;
  }

  const longestRows = targets.filter((target) => (mutationMap.get(target.mutationId)?.maxGrowthStage || 0) === longest);
  const n = longestRows.length;

  let base = longest;
  if (n > 0) {
    let harmonic = 0;
    for (let k = 1; k <= n; k += 1) harmonic += 1 / k;
    base = longest + 4 * harmonic;
  }

  const repeatCount = Math.max(1, Math.ceil(Number(node.repeatCount || 1)));
  return base * repeatCount;
}

function logicalNodeCenter(position) {
  return { x: position.x + NODE_WIDTH / 2, y: position.y + NODE_HEIGHT / 2 };
}

function logicalToCanvas(point) {
  return {
    x: point.x + WORLD_ORIGIN_X,
    y: point.y + WORLD_ORIGIN_Y,
  };
}

function canvasToLogical(point) {
  return {
    x: point.x - WORLD_ORIGIN_X,
    y: point.y - WORLD_ORIGIN_Y,
  };
}

function buildNodeShortages(state) {
  const ioByNode = new Map();
  for (const node of state.planNodes) {
    ioByNode.set(node.nodeId, computeNodeIO(node));
  }

  const incomingByNode = new Map();
  for (const edge of state.edgePolicies) {
    const allocation = edge.allocations && typeof edge.allocations === "object" ? edge.allocations : {};
    let incoming = incomingByNode.get(edge.toNodeId);
    if (!incoming) {
      incoming = new Map();
      incomingByNode.set(edge.toNodeId, incoming);
    }
    for (const [mutationIdRaw, amountRaw] of Object.entries(allocation)) {
      const mutationId = Number(mutationIdRaw);
      if (Number.isNaN(mutationId)) continue;
      const amount = Math.max(0, Math.ceil(Number(amountRaw || 0)));
      if (amount <= 0) continue;
      incoming.set(mutationId, (incoming.get(mutationId) || 0) + amount);
    }
  }

  const shortagesByNode = new Map();
  for (const node of state.planNodes) {
    const inputMap = ioByNode.get(node.nodeId)?.inputMap || new Map();
    const incoming = incomingByNode.get(node.nodeId) || new Map();
    const rows = [];
    for (const [mutationIdRaw, requiredRaw] of inputMap.entries()) {
      const mutationId = Number(mutationIdRaw);
      const required = Math.max(0, Math.ceil(Number(requiredRaw || 0)));
      const received = Math.max(0, Math.ceil(Number(incoming.get(mutationId) || 0)));
      const shortage = Math.max(0, required - received);
      if (shortage <= 0) continue;
      rows.push({ mutationId, shortage });
    }
    rows.sort((a, b) => b.shortage - a.shortage || a.mutationId - b.mutationId);
    shortagesByNode.set(node.nodeId, rows);
  }

  return shortagesByNode;
}

export function renderNodeCanvas(state, dom, handlers) {
  const canvas = dom.nodeCanvas;
  canvas.innerHTML = "";

  const view = state.canvasView || { x: -2860, y: -1900, zoom: 1 };
  let liveView = { ...view };

  const viewport = document.createElement("div");
  viewport.className = "node-viewport";
  canvas.appendChild(viewport);

  const world = document.createElement("div");
  world.className = "node-world";
  world.style.width = `${WORLD_WIDTH}px`;
  world.style.height = `${WORLD_HEIGHT}px`;
  world.style.transformOrigin = "0 0";
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  viewport.appendChild(world);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`);
  world.appendChild(svg);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <marker id="arrow-fixed" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="strokeWidth" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#60a5fa"></path>
    </marker>
    <marker id="arrow-ratio" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="strokeWidth" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b"></path>
    </marker>
    <marker id="arrow-selected" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="strokeWidth" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e"></path>
    </marker>
    <marker id="arrow-preview" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="strokeWidth" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316"></path>
    </marker>
  `;
  svg.appendChild(defs);

  const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const previewLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(edgeLayer);
  svg.appendChild(previewLayer);

  const shortagesByNode = buildNodeShortages(state);

  const nodeElements = new Map();
  let hoverTargetNodeId = null;

  function setHoverTargetNode(nodeId) {
    if (hoverTargetNodeId === nodeId) return;
    if (hoverTargetNodeId != null && nodeElements.has(hoverTargetNodeId)) {
      nodeElements.get(hoverTargetNodeId).classList.remove("connect-target");
    }
    hoverTargetNodeId = nodeId;
    if (hoverTargetNodeId != null && nodeElements.has(hoverTargetNodeId)) {
      nodeElements.get(hoverTargetNodeId).classList.add("connect-target");
    }
  }

  function drawEdges() {
    edgeLayer.innerHTML = "";

    for (const edge of state.edgePolicies) {
      const fromPos = state.nodePositions[edge.fromNodeId];
      const toPos = state.nodePositions[edge.toNodeId];
      if (!fromPos || !toPos) continue;

      const edgeKey = `${edge.fromNodeId}->${edge.toNodeId}`;
      const isSelected = state.selectedEdgeKey === edgeKey;

      const fromCenter = logicalToCanvas(logicalNodeCenter(fromPos));
      const toCenter = logicalToCanvas(logicalNodeCenter(toPos));
      const start = getNodeEdgeAnchor(fromCenter, toCenter, 10);
      const end = getNodeEdgeAnchor(toCenter, fromCenter, 28);
      const x1 = start.x;
      const y1 = start.y;
      const x2 = end.x;
      const y2 = end.y;
      const d = getCurvePath(x1, y1, x2, y2);

      const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hitPath.setAttribute("class", "edge-hit");
      hitPath.setAttribute("d", d);
      hitPath.setAttribute("fill", "none");
      hitPath.setAttribute("stroke", "transparent");
      hitPath.setAttribute("stroke-width", "14");
      hitPath.style.pointerEvents = "stroke";
      hitPath.addEventListener("click", (event) => {
        event.stopPropagation();
        handlers.onSelectEdge(edge);
      });
      edgeLayer.appendChild(hitPath);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const modeColor = edge.mode === "fixed" ? "#60a5fa" : "#f59e0b";
      const strokeColor = isSelected ? modeColor : "#64748b";
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", strokeColor);
      path.setAttribute("stroke-width", isSelected ? "3" : "2");
      path.setAttribute("stroke-linecap", "round");
      path.style.pointerEvents = "none";
      edgeLayer.appendChild(path);

      const midArrow = createMidArrow(path, strokeColor);
      if (midArrow) edgeLayer.appendChild(midArrow);
    }
  }

  function toWorld(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return {
      x: (screenX - liveView.x) / liveView.zoom,
      y: (screenY - liveView.y) / liveView.zoom,
    };
  }

  function applyView(nextView) {
    liveView = nextView;
    world.style.transform = `translate(${nextView.x}px, ${nextView.y}px) scale(${nextView.zoom})`;
  }

  let pendingPreview = null;
  const pendingFromId = state.pendingEdgeFromNodeId;
  const pendingFromPos = pendingFromId != null ? state.nodePositions[pendingFromId] : null;
  const pendingFromCenter = pendingFromPos ? logicalToCanvas(logicalNodeCenter(pendingFromPos)) : null;

  function updatePendingPreview(clientX, clientY) {
    if (!pendingFromCenter || !pendingPreview) return;
    const target = toWorld(clientX, clientY);
    const d = getCurvePath(pendingFromCenter.x, pendingFromCenter.y, target.x, target.y);
    pendingPreview.setAttribute("d", d);

    const candidate = document.elementFromPoint(clientX, clientY)?.closest(".node-item");
    if (!candidate) {
      setHoverTargetNode(null);
      return;
    }
    const targetNodeId = Number(candidate.dataset.nodeId);
    if (Number.isNaN(targetNodeId) || targetNodeId === pendingFromId) {
      setHoverTargetNode(null);
      return;
    }
    setHoverTargetNode(targetNodeId);
  }

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;
    const nextZoom = clamp(view.zoom * zoomFactor, 0.25, 2.5);

    const wx = (sx - view.x) / view.zoom;
    const wy = (sy - view.y) / view.zoom;
    const nextX = sx - wx * nextZoom;
    const nextY = sy - wy * nextZoom;

    handlers.onViewportChange({ x: nextX, y: nextY, zoom: nextZoom }, true);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const inNode = event.target.closest(".node-item");
    const inEdge = event.target.closest(".edge-hit");
    if (inEdge) return;
    if (inNode) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = liveView.x;
    const baseY = liveView.y;
    let moved = false;

    function onMove(moveEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
      const nextView = { x: baseX + dx, y: baseY + dy, zoom: liveView.zoom };
      applyView(nextView);
      handlers.onViewportChange(nextView, false);
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      handlers.onViewportChange(liveView, true);
      if (!moved) handlers.onClearEdgeSelection?.();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  drawEdges();

  for (const processNode of state.planNodes) {
    const pos = state.nodePositions[processNode.nodeId] || { x: 0, y: 0 };

    const node = document.createElement("div");
    const nodeIsActive = state.selectedEdgeKey == null && state.selectedNodeId === processNode.nodeId;
    const isDemandHighlighted = state.demandNodeHighlightNodeIds?.has(processNode.nodeId);
    const demandClass = isDemandHighlighted
      ? state.demandNodeHighlightMode === "producer"
        ? "demand-producer"
        : "demand-consumer"
      : "";
    node.className = `node-item ${nodeIsActive ? "active" : ""} ${state.pendingEdgeFromNodeId === processNode.nodeId ? "pending-source" : ""} ${demandClass}`;
    node.style.left = `${pos.x + WORLD_ORIGIN_X}px`;
    node.style.top = `${pos.y + WORLD_ORIGIN_Y}px`;
    node.dataset.nodeId = String(processNode.nodeId);

    const shortages = shortagesByNode.get(processNode.nodeId) || [];
    if (shortages.length) {
      const shortageStrip = document.createElement("div");
      shortageStrip.className = "node-shortages";
      for (const row of shortages.slice(0, 6)) {
        const badge = document.createElement("div");
        badge.className = "node-shortage-badge";

        const mutation = state.mutationMap.get(row.mutationId);
        const icon = document.createElement("img");
        icon.className = "node-shortage-icon";
        icon.src = mutation?.image || "";
        icon.alt = mutation?.name || `#${row.mutationId}`;
        badge.appendChild(icon);

        const amount = document.createElement("span");
        amount.className = "node-shortage-count";
        amount.textContent = String(row.shortage);
        badge.appendChild(amount);

        badge.title = `${mutation?.name || `#${row.mutationId}`} 不足 ${row.shortage}`;
        shortageStrip.appendChild(badge);
      }
      node.appendChild(shortageStrip);
    }

    const title = document.createElement("div");
    title.className = "node-title";
    title.textContent = processNode.name;
    node.appendChild(title);

    const nodeEstimate = estimateStagesForNode(processNode, state.mutationMap);
    if (nodeEstimate > 0) {
      const estimate = document.createElement("div");
      estimate.className = "node-stage-estimate";
      estimate.textContent = nodeEstimate.toFixed(1);
      node.appendChild(estimate);
    }

    const thumbnail = document.createElement("div");
    thumbnail.className = "node-thumb";
    const occupied = new Map();
    for (const placement of processNode.placements) {
      for (let y = placement.anchorY; y < placement.anchorY + placement.size; y += 1) {
        for (let x = placement.anchorX; x < placement.anchorX + placement.size; x += 1) {
          occupied.set(`${x},${y}`, placement.mutationId);
        }
      }
    }
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const pixel = document.createElement("div");
        const mutationId = occupied.get(`${x},${y}`);
        pixel.className = `node-thumb-cell ${mutationId != null ? "filled" : ""}`;
        if (mutationId != null) {
          pixel.style.background = colorFromMutationId(state, mutationId);
        }
        thumbnail.appendChild(pixel);
      }
    }
    node.appendChild(thumbnail);

    const repeatCount = Math.max(1, Math.ceil(Number(processNode.repeatCount || 1)));
    const repeatBadge = document.createElement("div");
    repeatBadge.className = "node-repeat-badge";
    repeatBadge.title = `リピート数 x${repeatCount}`;
    repeatBadge.textContent = `⟳${repeatCount}`;
    node.appendChild(repeatBadge);

    node.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();

      const start = canvasToLogical(toWorld(event.clientX, event.clientY));
      const baseX = pos.x;
      const baseY = pos.y;
      let moved = false;
      let moveHistoryRecorded = false;

      function onMove(moveEvent) {
        const curr = canvasToLogical(toWorld(moveEvent.clientX, moveEvent.clientY));
        const rawX = baseX + (curr.x - start.x);
        const rawY = baseY + (curr.y - start.y);
        const nextX = snap(rawX);
        const nextY = snap(rawY);
        if (Math.abs(nextX - baseX) > 0 || Math.abs(nextY - baseY) > 0) {
          moved = true;
          if (!moveHistoryRecorded) {
            handlers.onNodeMoveStart?.(processNode.nodeId, baseX, baseY);
            moveHistoryRecorded = true;
          }
        }
        node.style.left = `${nextX + WORLD_ORIGIN_X}px`;
        node.style.top = `${nextY + WORLD_ORIGIN_Y}px`;
        handlers.onNodeMove(processNode.nodeId, nextX, nextY, false);
        drawEdges();
      }

      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const finalX = (Number.parseInt(node.style.left, 10) || (baseX + WORLD_ORIGIN_X)) - WORLD_ORIGIN_X;
        const finalY = (Number.parseInt(node.style.top, 10) || (baseY + WORLD_ORIGIN_Y)) - WORLD_ORIGIN_Y;
        handlers.onNodeMove(processNode.nodeId, finalX, finalY, true);
        if (!moved) {
          const handled = handlers.onNodeActivate?.(processNode.nodeId);
          if (!handled) handlers.onSelectNode(processNode.nodeId);
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onStartEdgeFrom?.(processNode.nodeId);
    });

    nodeElements.set(processNode.nodeId, node);
    world.appendChild(node);
  }

  if (pendingFromCenter) {
    pendingPreview = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pendingPreview.setAttribute("fill", "none");
    pendingPreview.setAttribute("stroke", "#f97316");
    pendingPreview.setAttribute("stroke-width", "2");
    pendingPreview.setAttribute("stroke-dasharray", "4 4");
    pendingPreview.setAttribute("marker-end", "url(#arrow-preview)");
    previewLayer.appendChild(pendingPreview);

    viewport.addEventListener("pointermove", (event) => {
      updatePendingPreview(event.clientX, event.clientY);
    });
    viewport.addEventListener("pointerleave", () => {
      setHoverTargetNode(null);
    });
  }
}
