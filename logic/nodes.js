import { GRID_SIZE, getPlacementAt, keyOf } from "./grid.js";

export function createProcessNode(nodeId, name = `Node ${nodeId}`) {
  return {
    nodeId,
    name,
    repeatCount: 1,
    placements: [],
    nextPlacementId: 1,
  };
}

export function addPlacementToNode(node, occupied, mutation, anchorX, anchorY, role) {
  if (!node || !mutation) return false;
  if (anchorX < 0 || anchorY < 0) return false;
  if (anchorX + mutation.size > GRID_SIZE || anchorY + mutation.size > GRID_SIZE) return false;

  const overlaps = new Set();
  for (let y = anchorY; y < anchorY + mutation.size; y += 1) {
    for (let x = anchorX; x < anchorX + mutation.size; x += 1) {
      const placementId = occupied.get(keyOf(x, y));
      if (placementId) overlaps.add(placementId);
    }
  }

  if (overlaps.size) {
    const remain = [];
    for (const placement of node.placements) {
      if (!overlaps.has(placement.placementId)) {
        remain.push(placement);
        continue;
      }
      for (let yy = placement.anchorY; yy < placement.anchorY + placement.size; yy += 1) {
        for (let xx = placement.anchorX; xx < placement.anchorX + placement.size; xx += 1) {
          occupied.delete(keyOf(xx, yy));
        }
      }
    }
    node.placements = remain;
  }

  const placement = {
    placementId: node.nextPlacementId++,
    mutationId: mutation.id,
    anchorX,
    anchorY,
    size: mutation.size,
    role,
  };

  node.placements.push(placement);
  for (let y = placement.anchorY; y < placement.anchorY + placement.size; y += 1) {
    for (let x = placement.anchorX; x < placement.anchorX + placement.size; x += 1) {
      occupied.set(keyOf(x, y), placement.placementId);
    }
  }
  return true;
}

export function removePlacementAtNode(node, occupied, x, y) {
  const placement = getPlacementAt(node.placements, occupied, x, y);
  if (!placement) return false;

  for (let yy = placement.anchorY; yy < placement.anchorY + placement.size; yy += 1) {
    for (let xx = placement.anchorX; xx < placement.anchorX + placement.size; xx += 1) {
      occupied.delete(keyOf(xx, yy));
    }
  }

  node.placements = node.placements.filter((p) => p.placementId !== placement.placementId);
  return true;
}

export function rebuildNodeMeta(node) {
  const maxId = node.placements.reduce((acc, p) => Math.max(acc, p.placementId || 0), 0);
  node.nextPlacementId = maxId + 1;
}

export function computeNodeIO(node) {
  const inputMap = new Map();
  const outputMap = new Map();
  const repeatCount = Math.max(1, Math.ceil(Number(node?.repeatCount || 1)));

  for (const placement of node.placements) {
    const amount = 1;

    if (placement.role === "material") {
      inputMap.set(placement.mutationId, (inputMap.get(placement.mutationId) || 0) + amount);
    } else {
      outputMap.set(placement.mutationId, (outputMap.get(placement.mutationId) || 0) + amount * repeatCount);
    }
  }

  return { inputMap, outputMap };
}
