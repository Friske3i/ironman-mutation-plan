function buildRequirementsTooltip(mutation, mutationMap) {
  if (!Array.isArray(mutation.conditions) || mutation.conditions.length === 0) {
    return `${mutation.name}\n要求素材: なし`;
  }

  const totals = new Map();
  for (const condition of mutation.conditions) {
    const materialId = Number(condition.id);
    const amount = Math.max(1, Math.ceil(Number(condition.amount || 0)));
    totals.set(materialId, (totals.get(materialId) || 0) + amount);
  }

  const rows = [...totals.entries()]
    .map(([materialId, amount]) => ({
      name: mutationMap.get(materialId)?.name || `#${materialId}`,
      amount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const details = rows.map((row) => `- ${row.name} x ${row.amount}`).join("\n");
  return `${mutation.name}\n要求素材:\n${details}`;
}

export function renderPalette(state, dom, onSelectMutation, onContextMutation) {
  const keyword = dom.searchInput.value.trim().toLowerCase();
  const rows = state.mutations.filter((m) => m.name.toLowerCase().includes(keyword));
  const focusAmounts = state.paletteFocusAmounts || new Map();
  const focusedIds = state.paletteFocusedMutationIds || new Set();

  rows.sort((a, b) => {
    const aIsSource = state.paletteFocusSourceId === a.id ? 1 : 0;
    const bIsSource = state.paletteFocusSourceId === b.id ? 1 : 0;
    if (aIsSource !== bIsSource) return bIsSource - aIsSource;

    const aFocus = focusedIds.has(a.id) ? 1 : 0;
    const bFocus = focusedIds.has(b.id) ? 1 : 0;
    if (aFocus !== bFocus) return bFocus - aFocus;

    const aAmount = Number(focusAmounts.get(a.id) || 0);
    const bAmount = Number(focusAmounts.get(b.id) || 0);
    if (aAmount !== bAmount) return bAmount - aAmount;

    return a.name.localeCompare(b.name);
  });

  dom.palette.innerHTML = "";
  rows.forEach((mutation) => {
    const item = document.createElement("button");
    const isFocusedMaterial = focusedIds.has(mutation.id);
    const isSource = state.paletteFocusSourceId === mutation.id;
    item.className = `palette-item ${state.selectedMutationId === mutation.id ? "active" : ""} ${isFocusedMaterial ? "focus-material" : ""} ${isSource ? "focus-source" : ""}`;
    item.type = "button";
    item.dataset.mutationId = String(mutation.id);
    item.title = buildRequirementsTooltip(mutation, state.mutationMap);
    const amount = Number(focusAmounts.get(mutation.id) || 0);
    const badge = amount > 0 ? `<small class="focus-amount">x${amount}</small>` : "";
    item.innerHTML = `<img src="${mutation.image}" alt="${mutation.name}"/><span>${mutation.name}</span>${badge}`;
    item.addEventListener("click", () => onSelectMutation(mutation.id));
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      onContextMutation?.(mutation.id);
    });
    dom.palette.appendChild(item);
  });

  const selected = state.mutationMap.get(state.selectedMutationId);
  dom.selectedInfo.textContent = `選択: ${selected ? selected.name : "なし"}`;
}
