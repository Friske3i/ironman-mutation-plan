export function renderDemandTable(rows, dom, onSelectRow) {
  dom.demandBody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (row.shortage > 0) tr.classList.add("demand-shortage");
    else if (row.surplus > 0) tr.classList.add("demand-surplus");
    else tr.classList.add("demand-satisfied");
    tr.innerHTML = `<td>${row.name}</td><td>${row.tier === 999 ? "-" : row.tier}</td><td>${row.required}</td><td>${row.supplied}</td><td>${row.shortage}</td><td>${row.surplus}</td>`;
    tr.addEventListener("click", () => onSelectRow(row));
    dom.demandBody.appendChild(tr);
  }
}

export function renderEstimate(value, dom) {
  dom.estimate.textContent = "";
  dom.estimate.style.display = "none";
}

export function renderWarnings(messages, dom) {
  dom.warnings.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("div");
    item.className = "warning-item";
    item.textContent = message;
    dom.warnings.appendChild(item);
  }
}
