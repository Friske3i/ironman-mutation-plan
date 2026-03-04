import { computeNodeIO } from "./nodes.js";

export function estimateStagesFromNodes(planNodes, mutationMap) {
  const repeatMultiplier = Math.max(
    1,
    ...planNodes.map((node) => Math.max(1, Math.ceil(Number(node.repeatCount || 1)))),
  );

  const placements = planNodes.flatMap((node) => node.placements);
  const targets = placements.filter((p) => p.role !== "material");
  if (!targets.length) {
    return { base: 0, multiplier: repeatMultiplier, total: 0 };
  }

  let longest = 0;
  for (const p of targets) {
    const stage = mutationMap.get(p.mutationId)?.maxGrowthStage || 0;
    if (stage > longest) longest = stage;
  }

  const longestRows = targets.filter((p) => (mutationMap.get(p.mutationId)?.maxGrowthStage || 0) === longest);
  const n = longestRows.length;
  if (n <= 0) {
    const base = longest;
    return { base, multiplier: repeatMultiplier, total: base * repeatMultiplier };
  }

  let harmonic = 0;
  for (let k = 1; k <= n; k += 1) harmonic += 1 / k;
  const base = longest + 4 * harmonic;
  return { base, multiplier: repeatMultiplier, total: base * repeatMultiplier };
}

export function planDemands(state) {
  const required = new Map();
  const supplied = new Map();
  const tiers = new Map();
  const warnings = [];

  const ioByNode = new Map();
  for (const node of state.planNodes) {
    const io = computeNodeIO(node);
    ioByNode.set(node.nodeId, io);
  }

  for (const node of state.planNodes) {
    const io = ioByNode.get(node.nodeId);
    for (const [mutationId, amount] of io.inputMap.entries()) {
      required.set(mutationId, (required.get(mutationId) || 0) + Math.ceil(amount));
      if (!tiers.has(mutationId)) tiers.set(mutationId, 1);
    }
    for (const [mutationId, amount] of io.outputMap.entries()) {
      supplied.set(mutationId, (supplied.get(mutationId) || 0) + Math.ceil(amount));
      if (!tiers.has(mutationId)) tiers.set(mutationId, 0);
    }
  }

  for (const edge of state.edgePolicies) {
    const fromIo = ioByNode.get(edge.fromNodeId);
    const toIo = ioByNode.get(edge.toNodeId);
    if (!fromIo || !toIo) {
      warnings.push(`未定義ノード参照のエッジ: ${edge.fromNodeId} -> ${edge.toNodeId}`);
      continue;
    }

    if (edge.mode === "ratio" && Number(edge.ratio || 0) > 1) {
      warnings.push(`ratioが1を超過: ${edge.fromNodeId} -> ${edge.toNodeId}`);
    }

    if (edge.mode === "fixed" && Number(edge.fixedSupply || 0) < 0) {
      warnings.push(`fixedSupplyが負数: ${edge.fromNodeId} -> ${edge.toNodeId}`);
    }
  }

  const ids = new Set([...required.keys(), ...supplied.keys()]);
  const rows = [...ids]
    .map((id) => {
      const req = Math.ceil(required.get(id) || 0);
      const sup = Math.ceil(supplied.get(id) || 0);
      return {
        mutationId: id,
        name: state.mutationMap.get(id)?.name || `#${id}`,
        tier: tiers.get(id) ?? 999,
        required: req,
        supplied: sup,
        shortage: Math.max(0, req - sup),
        surplus: Math.max(0, sup - req),
      };
    })
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  return {
    rows,
    estimateStages: estimateStagesFromNodes(state.planNodes, state.mutationMap),
    warnings,
  };
}
