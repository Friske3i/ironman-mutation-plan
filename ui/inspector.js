export function updateInspectorEdgeInputs() {}

function updateSliderFill(slider) {
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 0);
  const value = Number(slider.value || 0);
  const span = Math.max(1, max - min);
  const ratio = Math.max(0, Math.min(1, (value - min) / span));
  slider.style.setProperty("--edge-slider-fill", `${Math.round(ratio * 100)}%`);
}

function createIoBlock(row, kind) {
  const block = document.createElement("div");
  block.className = `io-block ${kind}`;

  const head = document.createElement("div");
  head.className = "io-block-head";

  const title = document.createElement("span");
  title.className = "io-block-title";
  title.textContent = row.name;

  const values = document.createElement("span");
  values.className = "io-block-values";
  if (kind === "input") {
    values.textContent = `${row.received} / ${row.required}`;
  } else {
    values.textContent = `${row.used} / ${row.produced}`;
  }

  head.appendChild(title);
  head.appendChild(values);
  block.appendChild(head);

  const meter = document.createElement("div");
  meter.className = "io-meter";
  const fill = document.createElement("div");
  fill.className = `io-meter-fill ${kind}`;
  fill.style.width = `${Math.round((row.progress || 0) * 100)}%`;
  meter.appendChild(fill);
  block.appendChild(meter);

  const sub = document.createElement("div");
  sub.className = "io-block-sub";
  sub.textContent = kind === "input"
    ? `不足 ${Math.max(0, row.required - row.received)}`
    : `未使用 ${Math.max(0, row.produced - row.used)}`;
  block.appendChild(sub);

  return block;
}

export function renderInspectorPanel(dom, model, handlers = {}) {
  if (!model) {
    dom.inspectorNodeName.textContent = "未選択";
    dom.inspectorNodeName.contentEditable = "false";
    dom.inspectorRepeatCount.value = "1";
    dom.inspectorRepeatCount.disabled = true;
    dom.inspectorEdgeName.textContent = "未選択";
    dom.inspectorEdgeName.contentEditable = "false";
    dom.inspectorInputs.innerHTML = "";
    dom.inspectorOutputs.innerHTML = "";
    dom.inspectorIoSection?.classList.remove("hidden");
    if (dom.inspectorEdgeSliders) dom.inspectorEdgeSliders.innerHTML = "";
    dom.inspectorEdgeSection.classList.add("hidden");
    return;
  }

  dom.inspectorNodeName.contentEditable = "true";
  dom.inspectorRepeatCount.disabled = false;
  if (document.activeElement !== dom.inspectorRepeatCount) {
    dom.inspectorRepeatCount.value = String(model.repeatCount || 1);
  }
  if (!dom.inspectorRepeatCount.dataset.bound) {
    dom.inspectorRepeatCount.addEventListener("change", () => {
      const next = Math.max(1, Math.ceil(Number(dom.inspectorRepeatCount.value || 1)));
      dom.inspectorRepeatCount.value = String(next);
      handlers.onNodeRepeatChange?.(next);
    });
    dom.inspectorRepeatCount.dataset.bound = "1";
  }

  if (document.activeElement !== dom.inspectorNodeName) {
    dom.inspectorNodeName.textContent = model.nodeName;
  }
  dom.inspectorInputs.innerHTML = "";
  dom.inspectorOutputs.innerHTML = "";

  const inputRows = model.inputs.length ? model.inputs : [];
  const outputRows = model.outputs.length ? model.outputs : [];

  if (!inputRows.length) {
    const empty = document.createElement("div");
    empty.className = "need-card-empty";
    empty.textContent = "必要入力なし";
    dom.inspectorInputs.appendChild(empty);
  } else {
    for (const row of inputRows) {
      dom.inspectorInputs.appendChild(createIoBlock(row, "input"));
    }
  }

  if (!outputRows.length) {
    const empty = document.createElement("div");
    empty.className = "need-card-empty";
    empty.textContent = "供給出力なし";
    dom.inspectorOutputs.appendChild(empty);
  } else {
    for (const row of outputRows) {
      dom.inspectorOutputs.appendChild(createIoBlock(row, "output"));
    }
  }

  if (model.selectedEdge) {
    dom.inspectorIoSection?.classList.add("hidden");
    dom.inspectorEdgeSection.classList.remove("hidden");
    dom.inspectorEdgeName.contentEditable = "true";
    if (document.activeElement !== dom.inspectorEdgeName) {
      dom.inspectorEdgeName.textContent = model.selectedEdge.edgeName || `${model.selectedEdge.fromName} → ${model.selectedEdge.toName}`;
    }

    const rows = model.selectedEdge.transferRows || [];
    dom.inspectorEdgeSliders.innerHTML = "";

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "need-card-empty";
      empty.textContent = "この接続で送れる作物がありません";
      dom.inspectorEdgeSliders.appendChild(empty);
    } else {
      for (const row of rows) {
        const item = document.createElement("div");
        item.className = "edge-transfer-item";

        const head = document.createElement("div");
        head.className = "edge-transfer-head";

        const title = document.createElement("span");
        title.className = "edge-transfer-title";
        title.textContent = row.name;

        const value = document.createElement("span");
        value.className = "edge-transfer-value";
        value.textContent = `${row.value} / ${row.max}`;

        head.appendChild(title);
        head.appendChild(value);
        item.appendChild(head);

        const meta = document.createElement("div");
        meta.className = "edge-transfer-meta";
        meta.textContent = `供給可能 ${row.available} / 接続先必要 ${row.targetNeed} / 他エッジ使用 ${row.usedByOthers} / 残りキャパ ${row.remaining}`;
        item.appendChild(meta);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = String(row.max);
        slider.step = "1";
        slider.value = String(row.value);
        slider.className = "edge-transfer-slider";
        updateSliderFill(slider);
        slider.addEventListener("input", () => {
          const next = Math.max(0, Math.min(row.max, Math.ceil(Number(slider.value || 0))));
          slider.value = String(next);
          updateSliderFill(slider);
          value.textContent = `${next} / ${row.max}`;
          handlers.onEdgeTransferInput?.(row.mutationId, next);
        });
        slider.addEventListener("change", () => {
          const next = Math.max(0, Math.min(row.max, Math.ceil(Number(slider.value || 0))));
          handlers.onEdgeTransferCommit?.(row.mutationId, next);
        });
        item.appendChild(slider);

        dom.inspectorEdgeSliders.appendChild(item);
      }
    }
  } else {
    dom.inspectorIoSection?.classList.remove("hidden");
    dom.inspectorEdgeName.textContent = "未選択";
    dom.inspectorEdgeName.contentEditable = "false";
    if (dom.inspectorEdgeSliders) dom.inspectorEdgeSliders.innerHTML = "";
    dom.inspectorEdgeSection.classList.add("hidden");
  }
}
