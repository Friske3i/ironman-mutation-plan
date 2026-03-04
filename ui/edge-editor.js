export function populateNodeControls(state, dom) {
  const options = state.planNodes.map((node) => `<option value="${node.nodeId}">${node.name}</option>`).join("");
  dom.nodeSelect.innerHTML = options;
  dom.edgeFrom.innerHTML = options;
  dom.edgeTo.innerHTML = options;
  if (state.selectedNodeId != null) {
    dom.nodeSelect.value = String(state.selectedNodeId);
  }
}

export function updateModeInputs(dom) {
  const mode = dom.edgeMode.value;
  dom.fixedSupply.disabled = mode !== "fixed";
  dom.ratio.disabled = mode !== "ratio";
}

export function renderEdgeList(state, dom, handlers) {
  dom.edgeList.innerHTML = "";
  for (const edge of state.edgePolicies) {
    const edgeKey = `${edge.fromNodeId}->${edge.toNodeId}`;
    const from = state.planNodes.find((n) => n.nodeId === edge.fromNodeId)?.name || edge.fromNodeId;
    const to = state.planNodes.find((n) => n.nodeId === edge.toNodeId)?.name || edge.toNodeId;

    const li = document.createElement("li");
    if (state.selectedEdgeKey === edgeKey) li.classList.add("active");
    const edgeName = String(edge.name || `${from} → ${to}`);
    const transfers = Object.entries(edge.allocations || {})
      .map(([mutationId, amount]) => ({
        name: state.mutationMap.get(Number(mutationId))?.name || `#${mutationId}`,
        amount: Math.max(0, Math.ceil(Number(amount || 0))),
      }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const transferSummary = transfers.length
      ? transfers.map((row) => `${row.name} x ${row.amount}`).join(", ")
      : "供給未設定";
    li.innerHTML = `<div>${edgeName}</div><div>${from} → ${to}</div><div>${transferSummary}</div>`;
    li.addEventListener("click", () => handlers.onEdit(edge));

    const actions = document.createElement("div");
    actions.className = "edge-actions";

    const remove = document.createElement("button");
    remove.textContent = "削除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.onDelete(edge);
    });

    actions.appendChild(remove);
    li.appendChild(actions);
    dom.edgeList.appendChild(li);
  }
}
