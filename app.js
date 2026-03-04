import {
  addPlacementToNode,
  computeNodeIO,
  createOccupiedMap,
  createProcessNode,
  getPlacementAt,
  planDemands,
  rebuildNodeMeta,
  removePlacementAtNode,
} from "./logic.js";
import {
  buildGrid,
  getDomRefs,
  populateNodeControls,
  renderActiveNodeInfo,
  renderDemandTable,
  renderEdgeList,
  renderEstimate,
  renderGridCells,
  renderInspectorPanel,
  renderModeInfo,
  renderNodeCanvas,
  renderPalette,
  renderWarnings,
  setPanelOpen,
  updateModeInputs,
} from "./ui/index.js";

const PROJECT_FILE_VERSION = 6;
const INITIAL_CANVAS_VIEW = { x: -2860, y: -1900, zoom: 1 };

const state = {
  mutations: [],
  mutationMap: new Map(),
  selectedMutationId: null,
  mode: "place",
  planNodes: [],
  selectedNodeId: null,
  nextNodeId: 1,
  activeOccupied: new Map(),
  edgePolicies: [],
  selectedEdgeKey: null,
  highlightedMutationId: null,
  demandNodeHighlightMode: null,
  demandNodeHighlightMutationId: null,
  demandNodeHighlightNodeIds: new Set(),
  warnings: [],
  nodePositions: {},
  canvasView: { ...INITIAL_CANVAS_VIEW },
  pendingEdgeFromNodeId: null,
  gridDraft: null,
  mutationAvgColors: new Map(),
  paletteFocusSourceId: null,
  paletteFocusedMutationIds: new Set(),
  paletteFocusAmounts: new Map(),
  hoveredMutationId: null,
  isGridRightMouseDown: false,
  isGridPaintActive: false,
  gridStrokeDirty: false,
  lastPaintCellKey: null,
  suppressNextGridClick: false,
  nodeHistory: { undo: [], redo: [] },
  gridHistory: { undo: [], redo: [] },
  isApplyingHistory: false,
};

const dom = getDomRefs();
let gridRefreshFrame = 0;
let pendingGridRecalc = false;
init();

async function init() {
  const config = await fetch("./config.json").then((r) => r.json());
  state.mutations = config.mutations;
  state.mutationMap = new Map(state.mutations.map((m) => [m.id, m]));
  state.selectedMutationId = state.mutations[0]?.id ?? null;
  state.mutationAvgColors = await buildMutationAverageColors(state.mutations);

  createNode("Node 1", { recordHistory: false });
  refreshActiveOccupied();

  bindEvents();
  buildGrid(dom, {
    onCellClick: handleGridLeftClick,
    onCellRightClick: handleGridRightClick,
    onCellPointerDown: handleGridPointerDown,
    onCellPointerEnter: handleGridPointerEnter,
    onCellPointerUp: handleGridPointerUp,
  });

  populateNodeControls(state, dom);
  updateModeInputs(dom);
  syncRolePicker(dom.roleSelect.value || "material");
  renderPalette(state, dom, onSelectMutation, focusMaterialsForMutation);
  renderModeInfo(state, dom);
  syncDeleteModeButton();
  updateGridCursorState();
  updateUndoRedoButtons();
  renderActiveNodeInfo(state, dom);
  renderGridCells(state, dom, getPlacementAt);
  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderInspector();
  recalcAndRenderPlan();
}

function bindEvents() {
  dom.searchInput.addEventListener("input", () => renderPalette(state, dom, onSelectMutation, focusMaterialsForMutation));
  dom.saveBtn.addEventListener("click", savePlan);
  dom.nodeUndoBtn.addEventListener("click", undoNodeEditor);
  dom.nodeRedoBtn.addEventListener("click", redoNodeEditor);
  dom.addNodeBtn.addEventListener("click", () => createNode());
  dom.loadBtn.addEventListener("click", loadPlan);
  dom.projectFileInput.addEventListener("change", handleProjectFileSelected);
  dom.resetBtn.addEventListener("click", resetPlan);

  dom.openGridBtn.addEventListener("click", openGridEditor);
  dom.openEdgeBtn.addEventListener("click", () => setPanelOpen(dom.edgePanel, true));
  dom.openDemandBtn.addEventListener("click", () => setPanelOpen(dom.demandPanel, true));
  dom.closeEdgeBtn.addEventListener("click", () => setPanelOpen(dom.edgePanel, false));
  dom.closeDemandBtn.addEventListener("click", () => setPanelOpen(dom.demandPanel, false));
  dom.gridApplyBtn.addEventListener("click", applyGridEdits);
  dom.gridCancelBtn.addEventListener("click", cancelGridEdits);
  dom.gridUndoBtn.addEventListener("click", undoGridEditor);
  dom.gridRedoBtn.addEventListener("click", redoGridEditor);
  dom.toggleDeleteBtn.addEventListener("click", toggleDeleteMode);
  dom.clearGridBtn.addEventListener("click", clearActiveGrid);

  dom.rolePicker?.addEventListener("click", (event) => {
    const button = event.target.closest(".role-chip");
    if (!button) return;
    const role = button.dataset.role;
    if (!role) return;
    dom.roleSelect.value = role;
    syncRolePicker(role);
  });

  dom.inspectorEditGridBtn.addEventListener("click", openGridEditor);
  dom.inspectorDeleteNodeBtn.addEventListener("click", deleteActiveNode);
  dom.inspectorNodeName.addEventListener("blur", commitInlineNodeRename);
  dom.inspectorNodeName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      dom.inspectorNodeName.blur();
    }
  });
  dom.inspectorEdgeName.addEventListener("blur", commitInlineEdgeRename);
  dom.inspectorEdgeName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      dom.inspectorEdgeName.blur();
    }
  });
  dom.inspectorDeleteEdgeBtn.addEventListener("click", deleteSelectedEdge);

  dom.addEdgeBtn.addEventListener("click", upsertEdgePolicyFromForm);
  dom.edgeMode.addEventListener("change", () => updateModeInputs(dom));

  dom.nodeSelect.addEventListener("change", () => {
    clearAllDemandHighlights();
    state.selectedNodeId = Number(dom.nodeSelect.value);
    state.selectedEdgeKey = null;
    refreshActiveOccupied();
    renderActiveNodeInfo(state, dom);
    renderGridCells(state, dom, getPlacementAt);
    renderNodeCanvas(state, dom, nodeCanvasHandlers);
    renderTargetNeeds();
    renderInspector();
  });

  dom.palette.addEventListener("mouseover", (event) => {
    const item = event.target.closest(".palette-item");
    if (!item || !dom.palette.contains(item)) return;
    const mutationId = Number(item.dataset.mutationId);
    state.hoveredMutationId = Number.isNaN(mutationId) ? null : mutationId;
  });

  dom.palette.addEventListener("mouseleave", () => {
    state.hoveredMutationId = null;
  });

  dom.grid.addEventListener("mouseover", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || !dom.grid.contains(cell)) return;
    const mutationId = Number(cell.dataset.mutationId);
    state.hoveredMutationId = Number.isNaN(mutationId) ? null : mutationId;
  });

  dom.grid.addEventListener("mouseleave", () => {
    state.hoveredMutationId = null;
  });

  window.addEventListener("keydown", (event) => {
    const withCtrlOrMeta = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const typing = isTypingTarget(event.target);

    if (withCtrlOrMeta && key === "s") {
      event.preventDefault();
      savePlan();
      return;
    }

    if (withCtrlOrMeta && key === "o") {
      event.preventDefault();
      loadPlan();
      return;
    }

    if (typing) return;

    if (key === "r") {
      event.preventDefault();
      focusByHoveredMutation("requirements");
      return;
    }

    if (key === "u") {
      event.preventDefault();
      focusByHoveredMutation("upstream");
      return;
    }

    if (withCtrlOrMeta && key === "z" && !event.shiftKey) {
      event.preventDefault();
      if (!dom.gridPanel.classList.contains("hidden")) undoGridEditor();
      else undoNodeEditor();
      return;
    }

    if (withCtrlOrMeta && (key === "y" || (key === "z" && event.shiftKey))) {
      event.preventDefault();
      if (!dom.gridPanel.classList.contains("hidden")) redoGridEditor();
      else redoNodeEditor();
      return;
    }

    if (event.key === "Escape") {
      state.mode = "place";
      renderModeInfo(state, dom);
      syncDeleteModeButton();
      updateGridCursorState();
    }
    if (event.key === "Delete") {
      deleteSelectedEdge();
    }
  });

  window.addEventListener("pointerup", (event) => {
    if (event.button === 0) {
      finishGridStroke();
    }
    if (event.button !== 2) return;
    state.isGridRightMouseDown = false;
    updateGridCursorState();
  });
}

function scheduleGridRefresh(options = {}) {
  const { recalc = false } = options;
  pendingGridRecalc = pendingGridRecalc || recalc;
  if (gridRefreshFrame) return;

  gridRefreshFrame = window.requestAnimationFrame(() => {
    gridRefreshFrame = 0;
    renderGridCells(state, dom, getPlacementAt);
    if (pendingGridRecalc) {
      pendingGridRecalc = false;
      recalcAndRenderPlan({ skipNodeCanvas: !dom.gridPanel.classList.contains("hidden") });
    }
  });
}

function applyGridEditAt(x, y, options = {}) {
  const { deferRecalc = false } = options;
  const active = getActiveNode();
  if (!active) return false;

  if (state.mode === "delete") {
    const removed = removePlacementAtNode(active, state.activeOccupied, x, y);
    if (!removed) return false;
    refreshActiveOccupied();
    scheduleGridRefresh({ recalc: !deferRecalc });
    return true;
  }

  const mutation = state.mutationMap.get(state.selectedMutationId);
  if (!mutation) return false;
  const roleRaw = dom.roleSelect.value;
  const role = roleRaw === "material" ? "material" : "intermediate";
  const placed = addPlacementToNode(active, state.activeOccupied, mutation, x, y, role);
  if (!placed) return false;
  refreshActiveOccupied();
  scheduleGridRefresh({ recalc: !deferRecalc });
  return true;
}

function beginGridStroke(x, y) {
  if (state.isGridPaintActive) return;
  state.isGridPaintActive = true;
  state.gridStrokeDirty = false;
  state.lastPaintCellKey = `${x},${y}`;
  state.suppressNextGridClick = true;
  recordGridHistory();
  const changed = applyGridEditAt(x, y, { deferRecalc: true });
  if (changed) state.gridStrokeDirty = true;
}

function finishGridStroke() {
  if (!state.isGridPaintActive) return;
  state.isGridPaintActive = false;
  state.lastPaintCellKey = null;

  if (!state.gridStrokeDirty) {
    if (state.gridHistory.undo.length) {
      state.gridHistory.undo.pop();
      updateUndoRedoButtons();
    }
    pendingGridRecalc = false;
    window.requestAnimationFrame(() => {
      state.suppressNextGridClick = false;
    });
    return;
  }

  scheduleGridRefresh({ recalc: true });
  window.requestAnimationFrame(() => {
    state.suppressNextGridClick = false;
  });
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function createNode(name, options = {}) {
  const { recordHistory = true } = options;
  if (recordHistory) recordNodeHistory();

  const nodeId = state.nextNodeId++;
  const node = createProcessNode(nodeId, name || `Node ${nodeId}`);
  state.planNodes.push(node);
  state.selectedNodeId = nodeId;
  state.nodePositions[nodeId] = state.nodePositions[nodeId] || {
    x: 120 + ((nodeId - 1) % 4) * 220,
    y: 120 + Math.floor((nodeId - 1) / 4) * 220,
  };

  refreshActiveOccupied();
  populateNodeControls(state, dom);
  renderActiveNodeInfo(state, dom);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderEdgeList(state, dom, edgeHandlers);
  renderInspector();
  recalcAndRenderPlan();
}

function deleteActiveNode() {
  const active = getActiveNode();
  if (!active) return;

  recordNodeHistory();
  const idx = state.planNodes.findIndex((node) => node.nodeId === active.nodeId);
  if (idx < 0) return;

  state.planNodes.splice(idx, 1);
  delete state.nodePositions[active.nodeId];
  state.edgePolicies = state.edgePolicies.filter((edge) => edge.fromNodeId !== active.nodeId && edge.toNodeId !== active.nodeId);
  state.selectedEdgeKey = null;
  state.pendingEdgeFromNodeId = null;

  if (!state.planNodes.length) {
    createNode("Node 1", { recordHistory: false });
    return;
  }

  const nextIdx = Math.max(0, Math.min(idx, state.planNodes.length - 1));
  state.selectedNodeId = state.planNodes[nextIdx].nodeId;
  refreshActiveOccupied();
  enforceSourceSupplyCaps();

  populateNodeControls(state, dom);
  renderActiveNodeInfo(state, dom);
  renderGridCells(state, dom, getPlacementAt);
  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderInspector();
  recalcAndRenderPlan();
}

function getNodeEditorSnapshot() {
  return {
    planNodes: state.planNodes.map((node) => ({
      ...node,
      placements: node.placements.map((placement) => ({ ...placement })),
    })),
    edgePolicies: state.edgePolicies.map((edge) => ({ ...edge, allocations: { ...(edge.allocations || {}) } })),
    nodePositions: Object.fromEntries(Object.entries(state.nodePositions).map(([key, value]) => [key, { ...value }])),
    selectedNodeId: state.selectedNodeId,
    selectedEdgeKey: state.selectedEdgeKey,
    nextNodeId: state.nextNodeId,
    canvasView: { ...state.canvasView },
    pendingEdgeFromNodeId: state.pendingEdgeFromNodeId,
  };
}

function normalizePlacementRoles(planNodes) {
  for (const node of planNodes) {
    if (!Array.isArray(node.placements)) continue;
    for (const placement of node.placements) {
      placement.role = placement.role === "material" ? "material" : "intermediate";
    }
  }
}

function normalizeNodeRepeatCounts(planNodes) {
  for (const node of planNodes) {
    node.repeatCount = Math.max(1, Math.ceil(Number(node.repeatCount || 1)));
  }
}

function getDefaultEdgeName(fromNodeId, toNodeId) {
  const from = state.planNodes.find((node) => node.nodeId === fromNodeId)?.name || String(fromNodeId);
  const to = state.planNodes.find((node) => node.nodeId === toNodeId)?.name || String(toNodeId);
  return `${from} → ${to}`;
}

function normalizeEdgePolicies(edges) {
  if (!Array.isArray(edges)) return [];
  return edges
    .map((edge) => {
      const fromNodeId = Number(edge.fromNodeId);
      const toNodeId = Number(edge.toNodeId);
      if (Number.isNaN(fromNodeId) || Number.isNaN(toNodeId) || fromNodeId === toNodeId) return null;

      const allocations = {};
      if (edge.allocations && typeof edge.allocations === "object") {
        for (const [key, value] of Object.entries(edge.allocations)) {
          const mutationId = Number(key);
          const amount = Math.max(0, Math.ceil(Number(value || 0)));
          if (Number.isNaN(mutationId) || amount <= 0) continue;
          allocations[String(mutationId)] = amount;
        }
      }

      return {
        fromNodeId,
        toNodeId,
        name: String(edge.name || "").trim() || getDefaultEdgeName(fromNodeId, toNodeId),
        mode: edge.mode === "ratio" ? "ratio" : "fixed",
        fixedSupply: Math.max(0, Math.ceil(Number(edge.fixedSupply || 0))),
        ratio: Math.min(1, Math.max(0, Number(edge.ratio || 0))),
        allocations,
      };
    })
    .filter(Boolean);
}

function getAllocation(edge, mutationId) {
  const key = String(mutationId);
  return Math.max(0, Math.ceil(Number(edge.allocations?.[key] || 0)));
}

function setAllocation(edge, mutationId, amount) {
  if (!edge.allocations || typeof edge.allocations !== "object") edge.allocations = {};
  const key = String(mutationId);
  const normalized = Math.max(0, Math.ceil(Number(amount || 0)));
  if (normalized <= 0) {
    delete edge.allocations[key];
    return;
  }
  edge.allocations[key] = normalized;
}

function enforceSourceSupplyCaps(sourceNodeId = null) {
  const sourceIds = sourceNodeId == null
    ? [...new Set(state.edgePolicies.map((edge) => edge.fromNodeId))]
    : [sourceNodeId];

  for (const fromNodeId of sourceIds) {
    const sourceNode = state.planNodes.find((node) => node.nodeId === fromNodeId);
    if (!sourceNode) continue;
    const io = computeNodeIO(sourceNode);
    const availableByMutation = new Map([...io.outputMap.entries()].map(([mutationId, amount]) => [Number(mutationId), Math.max(0, Math.ceil(amount))]));
    const outgoing = state.edgePolicies.filter((edge) => edge.fromNodeId === fromNodeId);
    if (!outgoing.length) continue;

    for (const edge of outgoing) {
      if (!edge.allocations || typeof edge.allocations !== "object") edge.allocations = {};
      for (const key of Object.keys(edge.allocations)) {
        const mutationId = Number(key);
        if (!availableByMutation.has(mutationId) || availableByMutation.get(mutationId) <= 0) {
          delete edge.allocations[key];
        }
      }
    }

    for (const [mutationId, available] of availableByMutation.entries()) {
      let remaining = available;
      for (const edge of outgoing) {
        const current = getAllocation(edge, mutationId);
        const next = Math.min(current, remaining);
        setAllocation(edge, mutationId, next);
        remaining -= next;
      }
    }
  }
}

function applyNodeEditorSnapshot(snapshot) {
  state.isApplyingHistory = true;
  state.planNodes = snapshot.planNodes.map((node) => ({
    ...node,
    placements: node.placements.map((placement) => ({ ...placement })),
  }));
  normalizePlacementRoles(state.planNodes);
  normalizeNodeRepeatCounts(state.planNodes);
  state.edgePolicies = normalizeEdgePolicies(snapshot.edgePolicies);
  enforceSourceSupplyCaps();
  state.nodePositions = Object.fromEntries(Object.entries(snapshot.nodePositions || {}).map(([key, value]) => [key, { ...value }]));
  state.selectedNodeId = snapshot.selectedNodeId;
  state.selectedEdgeKey = snapshot.selectedEdgeKey;
  state.nextNodeId = snapshot.nextNodeId;
  state.canvasView = { ...(snapshot.canvasView || INITIAL_CANVAS_VIEW) };
  state.pendingEdgeFromNodeId = snapshot.pendingEdgeFromNodeId ?? null;
  state.planNodes.forEach((node) => rebuildNodeMeta(node));

  if (!state.planNodes.length) {
    createNode("Node 1", { recordHistory: false });
  }
  if (!state.planNodes.some((node) => node.nodeId === state.selectedNodeId)) {
    state.selectedNodeId = state.planNodes[0]?.nodeId ?? null;
  }

  refreshActiveOccupied();
  populateNodeControls(state, dom);
  renderActiveNodeInfo(state, dom);
  renderGridCells(state, dom, getPlacementAt);
  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderTargetNeeds();
  recalcAndRenderPlan();
  state.isApplyingHistory = false;
}

function recordNodeHistory() {
  if (state.isApplyingHistory) return;
  state.nodeHistory.undo.push(getNodeEditorSnapshot());
  if (state.nodeHistory.undo.length > 100) state.nodeHistory.undo.shift();
  state.nodeHistory.redo = [];
  updateUndoRedoButtons();
}

function undoNodeEditor() {
  if (!state.nodeHistory.undo.length) return;
  state.nodeHistory.redo.push(getNodeEditorSnapshot());
  const snapshot = state.nodeHistory.undo.pop();
  applyNodeEditorSnapshot(snapshot);
  updateUndoRedoButtons();
}

function redoNodeEditor() {
  if (!state.nodeHistory.redo.length) return;
  state.nodeHistory.undo.push(getNodeEditorSnapshot());
  const snapshot = state.nodeHistory.redo.pop();
  applyNodeEditorSnapshot(snapshot);
  updateUndoRedoButtons();
}

function getGridSnapshot() {
  const active = getActiveNode();
  if (!active) return null;
  return {
    nodeId: active.nodeId,
    nextPlacementId: active.nextPlacementId,
    placements: active.placements.map((placement) => ({ ...placement })),
  };
}

function applyGridSnapshot(snapshot) {
  const node = state.planNodes.find((item) => item.nodeId === snapshot.nodeId);
  if (!node) return;
  node.placements = snapshot.placements.map((placement) => ({ ...placement }));
  node.nextPlacementId = snapshot.nextPlacementId;
  state.selectedNodeId = snapshot.nodeId;
  refreshActiveOccupied();
  renderGridCells(state, dom, getPlacementAt);
  recalcAndRenderPlan({ skipNodeCanvas: !dom.gridPanel.classList.contains("hidden") });
}

function recordGridHistory() {
  if (state.isApplyingHistory) return;
  const snapshot = getGridSnapshot();
  if (!snapshot) return;
  state.gridHistory.undo.push(snapshot);
  if (state.gridHistory.undo.length > 200) state.gridHistory.undo.shift();
  state.gridHistory.redo = [];
  updateUndoRedoButtons();
}

function undoGridEditor() {
  if (!state.gridHistory.undo.length) return;
  const current = getGridSnapshot();
  if (current) state.gridHistory.redo.push(current);
  const snapshot = state.gridHistory.undo.pop();
  applyGridSnapshot(snapshot);
  updateUndoRedoButtons();
}

function redoGridEditor() {
  if (!state.gridHistory.redo.length) return;
  const current = getGridSnapshot();
  if (current) state.gridHistory.undo.push(current);
  const snapshot = state.gridHistory.redo.pop();
  applyGridSnapshot(snapshot);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  dom.nodeUndoBtn.disabled = state.nodeHistory.undo.length === 0;
  dom.nodeRedoBtn.disabled = state.nodeHistory.redo.length === 0;
  dom.gridUndoBtn.disabled = state.gridHistory.undo.length === 0;
  dom.gridRedoBtn.disabled = state.gridHistory.redo.length === 0;
}

function syncRolePicker(activeRole) {
  const roleButtons = dom.rolePicker?.querySelectorAll(".role-chip") || [];
  roleButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.role === activeRole);
  });
}

function syncDeleteModeButton() {
  dom.toggleDeleteBtn.classList.toggle("active", state.mode === "delete");
}

function updateGridCursorState() {
  dom.grid.classList.toggle("cursor-delete", state.mode === "delete");
  dom.grid.classList.toggle("cursor-eyedrop", state.mode !== "delete" && state.isGridRightMouseDown);
}

function toggleDeleteMode() {
  state.mode = state.mode === "delete" ? "place" : "delete";
  renderModeInfo(state, dom);
  syncDeleteModeButton();
  updateGridCursorState();
}

function clearActiveGrid() {
  const active = getActiveNode();
  if (!active) return;
  recordGridHistory();
  active.placements = [];
  active.nextPlacementId = 1;
  refreshActiveOccupied();
  scheduleGridRefresh({ recalc: true });
}

function createNodeDraftSnapshot(node) {
  return {
    nodeId: node.nodeId,
    nextPlacementId: node.nextPlacementId,
    placements: node.placements.map((placement) => ({ ...placement })),
  };
}

function openGridEditor() {
  const active = getActiveNode();
  if (!active) return;
  state.gridDraft = createNodeDraftSnapshot(active);
  renderTargetNeeds();
  setPanelOpen(dom.gridPanel, true);
}

function applyGridEdits() {
  state.gridDraft = null;
  setPanelOpen(dom.gridPanel, false);
  recalcAndRenderPlan();
}

function cancelGridEdits() {
  if (state.gridDraft) {
    const node = state.planNodes.find((item) => item.nodeId === state.gridDraft.nodeId);
    if (node) {
      node.placements = state.gridDraft.placements.map((placement) => ({ ...placement }));
      node.nextPlacementId = state.gridDraft.nextPlacementId;
      if (node.nodeId === state.selectedNodeId) {
        refreshActiveOccupied();
        renderGridCells(state, dom, getPlacementAt);
      }
    }
  }
  state.gridDraft = null;
  setPanelOpen(dom.gridPanel, false);
  recalcAndRenderPlan();
}

function commitInlineNodeRename() {
  const active = getActiveNode();
  if (!active) return;
  const nextName = dom.inspectorNodeName.textContent.trim();
  if (!nextName) {
    dom.inspectorNodeName.textContent = active.name;
    return;
  }
  if (nextName === active.name) return;
  recordNodeHistory();
  active.name = nextName;
  renderActiveNodeInfo(state, dom);
  populateNodeControls(state, dom);
  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderInspector();
}

function updateActiveNodeRepeatCount(nextRepeatCount) {
  const active = getActiveNode();
  if (!active) return;
  const normalized = Math.max(1, Math.ceil(Number(nextRepeatCount || 1)));
  if (active.repeatCount === normalized) return;

  recordNodeHistory();
  active.repeatCount = normalized;
  enforceSourceSupplyCaps(active.nodeId);

  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderInspector();
  recalcAndRenderPlan();
}

function commitInlineEdgeRename() {
  const edge = getSelectedEdge();
  if (!edge) {
    dom.inspectorEdgeName.textContent = "未選択";
    return;
  }

  const fallback = getDefaultEdgeName(edge.fromNodeId, edge.toNodeId);
  const nextName = dom.inspectorEdgeName.textContent.trim() || fallback;
  if (nextName === edge.name) return;

  recordNodeHistory();
  edge.name = nextName;
  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderInspector();
}

function getActiveNode() {
  return state.planNodes.find((n) => n.nodeId === state.selectedNodeId) || null;
}

function refreshActiveOccupied() {
  const active = getActiveNode();
  state.activeOccupied = createOccupiedMap(active?.placements || []);
}

function onSelectMutation(mutationId) {
  state.selectedMutationId = mutationId;
  state.mode = "place";
  renderPalette(state, dom, onSelectMutation, focusMaterialsForMutation);
  renderModeInfo(state, dom);
  syncDeleteModeButton();
  updateGridCursorState();
}

function focusByHoveredMutation(mode) {
  const mutationId = state.hoveredMutationId;
  if (mutationId == null || !state.mutationMap.has(mutationId)) return;

  if (mode === "requirements") {
    focusMaterialsForMutation(mutationId, { openGridPanel: false, resetSearch: false });
    return;
  }

  focusUsersForMaterial(mutationId, { openGridPanel: false, resetSearch: false });
}

function handleGridPointerDown(_x, _y, event) {
  if (event.button === 0) {
    event.preventDefault();
    beginGridStroke(_x, _y);
    return;
  }
  if (event.button !== 2) return;
  state.isGridRightMouseDown = true;
  updateGridCursorState();
}

function handleGridPointerEnter(x, y, event) {
  if (!state.isGridPaintActive) return;
  if ((event.buttons & 1) === 0) return;
  const cellKey = `${x},${y}`;
  if (state.lastPaintCellKey === cellKey) return;
  state.lastPaintCellKey = cellKey;
  const changed = applyGridEditAt(x, y, { deferRecalc: true });
  if (changed) state.gridStrokeDirty = true;
}

function handleGridPointerUp(_x, _y, event) {
  if (event.button === 0) {
    finishGridStroke();
    return;
  }
  if (event.button !== 2) return;
  state.isGridRightMouseDown = false;
  updateGridCursorState();
}

function handleGridLeftClick(x, y, event) {
  event.preventDefault();
  if (state.suppressNextGridClick) {
    state.suppressNextGridClick = false;
    return;
  }
  recordGridHistory();
  const changed = applyGridEditAt(x, y, { deferRecalc: false });
  if (!changed && state.gridHistory.undo.length) {
    state.gridHistory.undo.pop();
    updateUndoRedoButtons();
  }
}

function handleGridRightClick(x, y, event) {
  event.preventDefault();
  const active = getActiveNode();
  if (!active) return;

  const placement = getPlacementAt(active.placements, state.activeOccupied, x, y);
  if (placement) {
    state.selectedMutationId = placement.mutationId;
    const role = placement.role === "material" ? "material" : "intermediate";
    dom.roleSelect.value = role;
    syncRolePicker(role);
    state.mode = "place";
    renderPalette(state, dom, onSelectMutation, focusMaterialsForMutation);
    renderModeInfo(state, dom);
    syncDeleteModeButton();
    updateGridCursorState();
    return;
  }

  state.mode = "delete";
  renderModeInfo(state, dom);
  syncDeleteModeButton();
  updateGridCursorState();
}

function upsertEdgePolicyFromForm() {
  const fromNodeId = Number(dom.edgeFrom.value);
  const toNodeId = Number(dom.edgeTo.value);
  const mode = dom.edgeMode.value;
  const fixedSupply = Math.max(0, Math.ceil(Number(dom.fixedSupply.value || 0)));
  const ratio = Math.min(1, Math.max(0, Number(dom.ratio.value || 0)));
  upsertEdgePolicyData(fromNodeId, toNodeId, mode, fixedSupply, ratio);
}

function upsertEdgePolicyData(fromNodeId, toNodeId, mode, fixedSupply, ratio) {
  if (Number.isNaN(fromNodeId) || Number.isNaN(toNodeId) || fromNodeId === toNodeId) return;
  recordNodeHistory();

  const idx = state.edgePolicies.findIndex((e) => e.fromNodeId === fromNodeId && e.toNodeId === toNodeId);
  const existing = idx >= 0 ? state.edgePolicies[idx] : null;
  const next = {
    fromNodeId,
    toNodeId,
    name: existing?.name || getDefaultEdgeName(fromNodeId, toNodeId),
    mode,
    fixedSupply,
    ratio,
    allocations: { ...(existing?.allocations || {}) },
  };
  if (idx >= 0) state.edgePolicies[idx] = next;
  else state.edgePolicies.push(next);

  enforceSourceSupplyCaps(fromNodeId);

  state.selectedEdgeKey = `${fromNodeId}->${toNodeId}`;
  state.pendingEdgeFromNodeId = null;
  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderInspector();
  recalcAndRenderPlan();
}

function getSelectedEdge() {
  if (!state.selectedEdgeKey) return null;
  const [fromRaw, toRaw] = state.selectedEdgeKey.split("->");
  const fromNodeId = Number(fromRaw);
  const toNodeId = Number(toRaw);
  return state.edgePolicies.find((e) => e.fromNodeId === fromNodeId && e.toNodeId === toNodeId) || null;
}

function deleteSelectedEdge() {
  const edge = getSelectedEdge();
  if (!edge) return;
  recordNodeHistory();
  state.edgePolicies = state.edgePolicies.filter((e) => !(e.fromNodeId === edge.fromNodeId && e.toNodeId === edge.toNodeId));
  state.selectedEdgeKey = null;
  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderInspector();
  recalcAndRenderPlan();
}

function getTransferRowsForEdge(edge) {
  const sourceNode = state.planNodes.find((node) => node.nodeId === edge.fromNodeId);
  const targetNode = state.planNodes.find((node) => node.nodeId === edge.toNodeId);
  if (!sourceNode || !targetNode) return [];

  const sourceOut = computeNodeIO(sourceNode).outputMap;
  const targetIn = computeNodeIO(targetNode).inputMap;

  const rows = [];
  for (const [mutationIdRaw, producedAmount] of sourceOut.entries()) {
    const mutationId = Number(mutationIdRaw);
    const targetNeed = Math.max(0, Math.ceil(Number(targetIn.get(mutationId) || 0)));
    if (targetNeed <= 0) continue;

    const available = Math.max(0, Math.ceil(Number(producedAmount || 0)));
    const current = getAllocation(edge, mutationId);
    const usedByOthers = state.edgePolicies
      .filter((candidate) => candidate.fromNodeId === edge.fromNodeId && candidate !== edge)
      .reduce((sum, candidate) => sum + getAllocation(candidate, mutationId), 0);
    const sharedCap = Math.max(0, available - usedByOthers);
    const max = Math.max(0, Math.min(sharedCap, targetNeed));
    const value = Math.min(current, max);
    if (value !== current) setAllocation(edge, mutationId, value);
    const remaining = Math.max(0, sharedCap - value);

    rows.push({
      mutationId,
      name: state.mutationMap.get(mutationId)?.name || `#${mutationId}`,
      available,
      targetNeed,
      usedByOthers,
      max,
      value,
      remaining,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function updateSelectedEdgeTransfer(mutationId, amount) {
  const edge = getSelectedEdge();
  if (!edge) return;

  const rows = getTransferRowsForEdge(edge);
  const row = rows.find((item) => item.mutationId === mutationId);
  if (!row) return;
  const next = Math.max(0, Math.min(row.max, Math.ceil(Number(amount || 0))));

  setAllocation(edge, mutationId, next);
}

function commitSelectedEdgeTransfer(mutationId, amount) {
  const edge = getSelectedEdge();
  if (!edge) return;
  recordNodeHistory();

  const rows = getTransferRowsForEdge(edge);
  const row = rows.find((item) => item.mutationId === mutationId);
  if (!row) return;
  const next = Math.max(0, Math.min(row.max, Math.ceil(Number(amount || 0))));

  setAllocation(edge, mutationId, next);
  enforceSourceSupplyCaps(edge.fromNodeId);

  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  recalcAndRenderPlan();
}

const edgeHandlers = {
  onEdit(edge) {
    dom.edgeFrom.value = String(edge.fromNodeId);
    dom.edgeTo.value = String(edge.toNodeId);
    dom.edgeMode.value = edge.mode;
    dom.fixedSupply.value = String(edge.fixedSupply ?? 0);
    dom.ratio.value = String(edge.ratio ?? 0);
    updateModeInputs(dom);

    state.selectedEdgeKey = `${edge.fromNodeId}->${edge.toNodeId}`;
    renderEdgeList(state, dom, edgeHandlers);
    renderNodeCanvas(state, dom, nodeCanvasHandlers);
    renderInspector();
  },
  onDelete(edge) {
    recordNodeHistory();
    state.edgePolicies = state.edgePolicies.filter((e) => !(e.fromNodeId === edge.fromNodeId && e.toNodeId === edge.toNodeId));
    if (state.selectedEdgeKey === `${edge.fromNodeId}->${edge.toNodeId}`) state.selectedEdgeKey = null;
    renderEdgeList(state, dom, edgeHandlers);
    renderNodeCanvas(state, dom, nodeCanvasHandlers);
    renderInspector();
    recalcAndRenderPlan();
  },
};

const nodeCanvasHandlers = {
  onNodeMoveStart() {
    recordNodeHistory();
  },
  onSelectNode(nodeId) {
    clearAllDemandHighlights();
    state.selectedNodeId = nodeId;
    state.selectedEdgeKey = null;
    state.pendingEdgeFromNodeId = null;
    refreshActiveOccupied();
    dom.nodeSelect.value = String(nodeId);
    renderActiveNodeInfo(state, dom);
    renderGridCells(state, dom, getPlacementAt);
    renderNodeCanvas(state, dom, nodeCanvasHandlers);
    renderEdgeList(state, dom, edgeHandlers);
    renderTargetNeeds();
    renderInspector();
  },
  onNodeMove(nodeId, x, y, commit) {
    state.nodePositions[nodeId] = { x, y };
    if (commit) {
      renderNodeCanvas(state, dom, nodeCanvasHandlers);
    }
  },
  onCreateEdge(fromNodeId, toNodeId) {
    upsertEdgePolicyData(fromNodeId, toNodeId, "fixed", 0, 0);
  },
  onStartEdgeFrom(nodeId) {
    if (state.pendingEdgeFromNodeId === nodeId) {
      state.pendingEdgeFromNodeId = null;
    } else {
      state.pendingEdgeFromNodeId = nodeId;
      state.selectedEdgeKey = null;
    }
    renderNodeCanvas(state, dom, nodeCanvasHandlers);
    renderEdgeList(state, dom, edgeHandlers);
    renderInspector();
  },
  onNodeActivate(nodeId) {
    if (state.pendingEdgeFromNodeId == null) return false;
    if (state.pendingEdgeFromNodeId === nodeId) {
      state.pendingEdgeFromNodeId = null;
      renderNodeCanvas(state, dom, nodeCanvasHandlers);
      return true;
    }
    upsertEdgePolicyData(state.pendingEdgeFromNodeId, nodeId, "fixed", 0, 0);
    return true;
  },
  onSelectEdge(edge) {
    edgeHandlers.onEdit(edge);
  },
  onClearEdgeSelection() {
    state.selectedEdgeKey = null;
    state.pendingEdgeFromNodeId = null;
    renderNodeCanvas(state, dom, nodeCanvasHandlers);
    renderEdgeList(state, dom, edgeHandlers);
    renderInspector();
  },
  onViewportChange(view, commit = true) {
    state.canvasView = view;
    if (commit) {
      renderNodeCanvas(state, dom, nodeCanvasHandlers);
    }
  },
};

function recalcAndRenderPlan(options = {}) {
  const { skipNodeCanvas = false } = options;
  enforceSourceSupplyCaps();
  const result = planDemands(state);
  state.warnings = result.warnings;

  renderDemandTable(result.rows, dom, (row) => {
    applyDemandRowNodeHighlight(row);
    setPanelOpen(dom.demandPanel, false);
  });
  renderEstimate(result.estimateStages, dom);
  renderWarnings(result.warnings, dom);
  renderTargetNeeds();
  if (!skipNodeCanvas) {
    renderNodeCanvas(state, dom, nodeCanvasHandlers);
  }
  renderInspector();
}

function clearDemandRowNodeHighlight() {
  state.demandNodeHighlightMode = null;
  state.demandNodeHighlightMutationId = null;
  state.demandNodeHighlightNodeIds = new Set();
}

function clearAllDemandHighlights() {
  state.highlightedMutationId = null;
  clearDemandRowNodeHighlight();
}

function applyDemandRowNodeHighlight(row) {
  if (!row) return;

  let mode = null;
  if (row.shortage > 0) mode = "consumer";
  else if (row.surplus > 0) mode = "producer";

  if (!mode) {
    clearDemandRowNodeHighlight();
    renderNodeCanvas(state, dom, nodeCanvasHandlers);
    return;
  }

  const isSameSelection =
    state.demandNodeHighlightMode === mode &&
    state.demandNodeHighlightMutationId === row.mutationId;
  if (isSameSelection) {
    clearDemandRowNodeHighlight();
    renderNodeCanvas(state, dom, nodeCanvasHandlers);
    return;
  }

  const nodeIds = new Set();
  for (const node of state.planNodes) {
    const io = computeNodeIO(node);
    if (mode === "producer") {
      const produced = Math.max(0, Math.ceil(Number(io.outputMap.get(row.mutationId) || 0)));
      if (produced <= 0) continue;
      const outgoing = state.edgePolicies.filter((edge) => edge.fromNodeId === node.nodeId);
      const allocated = outgoing.reduce((sum, edge) => sum + getAllocation(edge, row.mutationId), 0);
      const surplus = Math.max(0, produced - allocated);
      if (surplus > 0) nodeIds.add(node.nodeId);
      continue;
    }

    const required = Math.max(0, Math.ceil(Number(io.inputMap.get(row.mutationId) || 0)));
    if (required <= 0) continue;
    const incoming = state.edgePolicies.filter((edge) => edge.toNodeId === node.nodeId);
    const received = incoming.reduce((sum, edge) => sum + getAllocation(edge, row.mutationId), 0);
    const shortage = Math.max(0, required - received);
    if (shortage > 0) nodeIds.add(node.nodeId);
  }

  state.highlightedMutationId = row.mutationId;
  state.demandNodeHighlightMode = mode;
  state.demandNodeHighlightMutationId = row.mutationId;
  state.demandNodeHighlightNodeIds = nodeIds;
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
}

function renderTargetNeeds() {
  dom.targetNeedsList.innerHTML = "";
  const active = getActiveNode();
  if (!active) {
    const li = document.createElement("li");
    li.className = "need-empty";
    li.textContent = "接続先なし";
    dom.targetNeedsList.appendChild(li);
    return;
  }

  const outgoing = state.edgePolicies.filter((edge) => edge.fromNodeId === active.nodeId);
  if (!outgoing.length) {
    const li = document.createElement("li");
    li.className = "need-empty";
    li.textContent = "接続先なし";
    dom.targetNeedsList.appendChild(li);
    return;
  }

  for (const edge of outgoing) {
    const toNode = state.planNodes.find((node) => node.nodeId === edge.toNodeId);
    if (!toNode) continue;
    const io = computeNodeIO(toNode);
    const incomingToTarget = state.edgePolicies.filter((candidate) => candidate.toNodeId === edge.toNodeId);
    const li = document.createElement("li");
    li.className = "need-card";

    const title = document.createElement("div");
    title.className = "need-card-title";
    title.textContent = `${toNode.name}`;
    li.appendChild(title);

    const rows = [...io.inputMap.entries()]
      .map(([mutationIdRaw, requiredRaw]) => {
        const mutationId = Number(mutationIdRaw);
        const required = Math.max(0, Math.ceil(Number(requiredRaw || 0)));
        const supplied = Math.max(0, Math.ceil(Number(edge.allocations?.[String(mutationId)] || 0)));
        const suppliedByOthers = incomingToTarget
          .filter((candidate) => candidate.fromNodeId !== edge.fromNodeId)
          .reduce((sum, candidate) => sum + getAllocation(candidate, mutationId), 0);
        const shortageAfterOthers = Math.max(0, required - suppliedByOthers);
        return {
          mutationId,
          required: shortageAfterOthers,
          supplied,
          name: state.mutationMap.get(mutationId)?.name || `#${mutationId}`,
        };
      })
      .filter((row) => row.required > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "need-card-empty";
      empty.textContent = "他接続で充足済み";
      li.appendChild(empty);
      dom.targetNeedsList.appendChild(li);
      continue;
    }

    const chips = document.createElement("div");
    chips.className = "need-chips";

    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "need-chip";
      button.textContent = `${row.name} 要求量${row.required} / 供給量${row.supplied}`;
      button.addEventListener("click", () => focusMaterialsForMutation(row.mutationId));
      chips.appendChild(button);
    }

    li.appendChild(chips);
    dom.targetNeedsList.appendChild(li);
  }
}

function getFallbackColor(mutationId) {
  const hue = (Number(mutationId) * 57) % 360;
  return `hsl(${hue} 68% 52%)`;
}

function getAverageColorFromImage(src, fallback) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        resolve(fallback);
        return;
      }
      const size = 24;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 24) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count += 1;
      }
      if (!count) {
        resolve(fallback);
        return;
      }
      const avg = `rgb(${Math.round(r / count)} ${Math.round(g / count)} ${Math.round(b / count)})`;
      resolve(avg);
    };
    img.onerror = () => resolve(fallback);
    img.src = src;
  });
}

async function buildMutationAverageColors(mutations) {
  const entries = await Promise.all(
    mutations.map(async (mutation) => {
      const fallback = getFallbackColor(mutation.id);
      const color = await getAverageColorFromImage(mutation.image, fallback);
      return [mutation.id, color];
    }),
  );
  return new Map(entries);
}

function collectDirectMaterials(mutationId) {
  const acc = new Map();
  const mutation = state.mutationMap.get(mutationId);
  if (!mutation || !Array.isArray(mutation.conditions) || !mutation.conditions.length) return acc;

  for (const condition of mutation.conditions) {
    const total = Math.max(1, Math.ceil(Number(condition.amount || 0)));
    const childId = Number(condition.id);
    acc.set(childId, (acc.get(childId) || 0) + total);
  }

  return acc;
}

function focusMaterialsForMutation(mutationId, options = {}) {
  const { openGridPanel = true, resetSearch = true } = options;
  if (state.paletteFocusSourceId === mutationId) {
    state.paletteFocusSourceId = null;
    state.paletteFocusedMutationIds = new Set();
    state.paletteFocusAmounts = new Map();
    renderPalette(state, dom, onSelectMutation, focusMaterialsForMutation);
    updateUndoRedoButtons();
    return;
  }

  const mutation = state.mutationMap.get(mutationId);
  if (!mutation) return;
  const requirements = collectDirectMaterials(mutationId);

  state.paletteFocusSourceId = mutationId;
  state.paletteFocusedMutationIds = new Set(requirements.keys());
  state.paletteFocusAmounts = new Map(requirements.entries());

  const firstMaterialId = [...state.paletteFocusedMutationIds][0];
  const nextSelectedId = firstMaterialId != null ? firstMaterialId : mutationId;
  state.selectedMutationId = nextSelectedId;
  dom.roleSelect.value = "material";
  syncRolePicker("material");
  state.mode = "place";
  renderModeInfo(state, dom);
  syncDeleteModeButton();

  if (resetSearch) dom.searchInput.value = "";
  renderPalette(state, dom, onSelectMutation, focusMaterialsForMutation);
  if (openGridPanel) {
    setPanelOpen(dom.gridPanel, true);
  }
}

function collectDirectUsers(materialMutationId) {
  const acc = new Map();
  for (const mutation of state.mutations) {
    if (!Array.isArray(mutation.conditions)) continue;
    let total = 0;
    for (const condition of mutation.conditions) {
      if (Number(condition.id) !== materialMutationId) continue;
      total += Math.max(1, Math.ceil(Number(condition.amount || 0)));
    }
    if (total > 0) {
      acc.set(mutation.id, total);
    }
  }
  return acc;
}

function focusUsersForMaterial(mutationId, options = {}) {
  const { openGridPanel = true, resetSearch = true } = options;
  if (state.paletteFocusSourceId === mutationId) {
    state.paletteFocusSourceId = null;
    state.paletteFocusedMutationIds = new Set();
    state.paletteFocusAmounts = new Map();
    renderPalette(state, dom, onSelectMutation, focusMaterialsForMutation);
    return;
  }

  const users = collectDirectUsers(mutationId);
  state.paletteFocusSourceId = mutationId;
  state.paletteFocusedMutationIds = new Set(users.keys());
  state.paletteFocusAmounts = new Map(users.entries());

  state.selectedMutationId = mutationId;
  state.mode = "place";
  renderModeInfo(state, dom);
  syncDeleteModeButton();

  if (resetSearch) dom.searchInput.value = "";
  renderPalette(state, dom, onSelectMutation, focusMaterialsForMutation);
  if (openGridPanel) {
    setPanelOpen(dom.gridPanel, true);
  }
}

function renderInspector() {
  const active = getActiveNode();
  if (!active) {
    renderInspectorPanel(dom, null);
    return;
  }

  const io = computeNodeIO(active);
  const incomingEdges = state.edgePolicies.filter((edge) => edge.toNodeId === active.nodeId);
  const inputs = [...io.inputMap.entries()]
    .map(([mutationId, amount]) => {
      const required = Math.max(0, Math.ceil(Number(amount || 0)));
      const received = incomingEdges.reduce((sum, edge) => sum + getAllocation(edge, Number(mutationId)), 0);
      const progress = required > 0 ? Math.min(1, received / required) : 1;
      return {
        name: state.mutationMap.get(mutationId)?.name || `#${mutationId}`,
        required,
        received,
        progress,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const outgoingEdges = state.edgePolicies.filter((edge) => edge.fromNodeId === active.nodeId);
  const outputs = [...io.outputMap.entries()]
    .map(([mutationId, amount]) => {
      const produced = Math.max(0, Math.ceil(Number(amount || 0)));
      const used = outgoingEdges.reduce((sum, edge) => sum + getAllocation(edge, Number(mutationId)), 0);
      const progress = produced > 0 ? Math.min(1, used / produced) : 1;
      return {
        name: state.mutationMap.get(mutationId)?.name || `#${mutationId}`,
        produced,
        used,
        progress,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectedEdge = getSelectedEdge();
  const edgeModel = selectedEdge
    ? {
        edgeName: selectedEdge.name || getDefaultEdgeName(selectedEdge.fromNodeId, selectedEdge.toNodeId),
        fromName: state.planNodes.find((n) => n.nodeId === selectedEdge.fromNodeId)?.name || String(selectedEdge.fromNodeId),
        toName: state.planNodes.find((n) => n.nodeId === selectedEdge.toNodeId)?.name || String(selectedEdge.toNodeId),
        transferRows: getTransferRowsForEdge(selectedEdge),
      }
    : null;

  renderInspectorPanel(dom, {
    nodeName: active.name,
    repeatCount: active.repeatCount || 1,
    inputs,
    outputs,
    selectedEdge: edgeModel,
  }, {
    onNodeRepeatChange: updateActiveNodeRepeatCount,
    onEdgeTransferInput: updateSelectedEdgeTransfer,
    onEdgeTransferCommit: commitSelectedEdgeTransfer,
  });
}

function savePlan() {
  const data = {
    version: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    planNodes: state.planNodes,
    edgePolicies: state.edgePolicies,
    nodePositions: state.nodePositions,
    canvasView: state.canvasView,
    selectedNodeId: state.selectedNodeId,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `ironman-mutation-plan-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadPlan() {
  dom.projectFileInput.value = "";
  dom.projectFileInput.click();
}

async function handleProjectFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const raw = await file.text();
    const data = JSON.parse(raw);
    restoreProjectFromData(data);
  } catch {
    window.alert("プロジェクトファイルの読み込みに失敗しました。JSON形式を確認してください。");
  }
}

function restoreProjectFromData(data) {
  state.nodeHistory = { undo: [], redo: [] };
  state.gridHistory = { undo: [], redo: [] };
  state.isApplyingHistory = false;

  state.planNodes = Array.isArray(data.planNodes) ? data.planNodes : [];
  normalizePlacementRoles(state.planNodes);
  normalizeNodeRepeatCounts(state.planNodes);
  state.planNodes.forEach((node) => rebuildNodeMeta(node));
  state.edgePolicies = normalizeEdgePolicies(Array.isArray(data.edgePolicies) ? data.edgePolicies : []);
  enforceSourceSupplyCaps();
  state.nodePositions = data.nodePositions && typeof data.nodePositions === "object" ? data.nodePositions : {};
  state.canvasView = data.canvasView && typeof data.canvasView === "object" ? data.canvasView : { ...INITIAL_CANVAS_VIEW };
  if (typeof state.canvasView.x === "number" && typeof state.canvasView.y === "number") {
    if (state.canvasView.x > -1000 && state.canvasView.y > -700) {
      state.canvasView = {
        x: state.canvasView.x - 3000,
        y: state.canvasView.y - 2000,
        zoom: state.canvasView.zoom || 1,
      };
    }
  }

  const maxNodeId = state.planNodes.reduce((acc, n) => Math.max(acc, n.nodeId || 0), 0);
  state.nextNodeId = maxNodeId + 1;
  if (!state.planNodes.length) createNode("Node 1", { recordHistory: false });

  state.selectedNodeId = Number(data.selectedNodeId) || state.planNodes[0].nodeId;
  if (!state.planNodes.some((node) => node.nodeId === state.selectedNodeId)) {
    state.selectedNodeId = state.planNodes[0].nodeId;
  }
  state.selectedEdgeKey = null;
  state.pendingEdgeFromNodeId = null;
  state.gridDraft = null;
  state.paletteFocusSourceId = null;
  state.paletteFocusedMutationIds = new Set();
  state.paletteFocusAmounts = new Map();
  clearDemandRowNodeHighlight();
  state.isGridRightMouseDown = false;
  refreshActiveOccupied();

  populateNodeControls(state, dom);
  syncRolePicker(dom.roleSelect.value || "material");
  renderPalette(state, dom, onSelectMutation, focusMaterialsForMutation);
  renderModeInfo(state, dom);
  syncDeleteModeButton();
  updateGridCursorState();
  updateUndoRedoButtons();
  renderActiveNodeInfo(state, dom);
  renderGridCells(state, dom, getPlacementAt);
  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderInspector();
  recalcAndRenderPlan();
}

function resetPlan() {
  state.nodeHistory = { undo: [], redo: [] };
  state.gridHistory = { undo: [], redo: [] };
  state.isApplyingHistory = false;
  state.planNodes = [];
  state.edgePolicies = [];
  state.nodePositions = {};
  state.nextNodeId = 1;
  state.selectedEdgeKey = null;
  state.highlightedMutationId = null;
  state.mode = "place";
  state.canvasView = { ...INITIAL_CANVAS_VIEW };
  state.pendingEdgeFromNodeId = null;
  state.gridDraft = null;
  state.paletteFocusSourceId = null;
  state.paletteFocusedMutationIds = new Set();
  state.paletteFocusAmounts = new Map();
  clearDemandRowNodeHighlight();
  state.isGridRightMouseDown = false;
  dom.roleSelect.value = "material";
  syncRolePicker("material");

  createNode("Node 1", { recordHistory: false });
  refreshActiveOccupied();

  populateNodeControls(state, dom);
  renderModeInfo(state, dom);
  syncDeleteModeButton();
  updateGridCursorState();
  updateUndoRedoButtons();
  renderActiveNodeInfo(state, dom);
  renderGridCells(state, dom, getPlacementAt);
  renderEdgeList(state, dom, edgeHandlers);
  renderNodeCanvas(state, dom, nodeCanvasHandlers);
  renderInspector();
  recalcAndRenderPlan();
}
