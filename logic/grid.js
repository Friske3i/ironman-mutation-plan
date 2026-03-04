export const GRID_SIZE = 10;

export function keyOf(x, y) {
  return `${x},${y}`;
}

export function createOccupiedMap(placements) {
  const occupied = new Map();
  for (const placement of placements) {
    for (let y = placement.anchorY; y < placement.anchorY + placement.size; y += 1) {
      for (let x = placement.anchorX; x < placement.anchorX + placement.size; x += 1) {
        occupied.set(keyOf(x, y), placement.placementId);
      }
    }
  }
  return occupied;
}

export function getPlacementAt(placements, occupied, x, y) {
  const placementId = occupied.get(keyOf(x, y));
  if (!placementId) return null;
  return placements.find((p) => p.placementId === placementId) ?? null;
}

export function canPlace(occupied, anchorX, anchorY, size) {
  if (anchorX + size > GRID_SIZE || anchorY + size > GRID_SIZE) return false;
  for (let y = anchorY; y < anchorY + size; y += 1) {
    for (let x = anchorX; x < anchorX + size; x += 1) {
      if (occupied.has(keyOf(x, y))) return false;
    }
  }
  return true;
}
