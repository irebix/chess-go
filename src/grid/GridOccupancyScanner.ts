import { gridSlotsOccupiedByBounds, type GridRect } from "./GridGeometry";
import {
  GRID_AUXILIARY_TOP_LEVEL_NAMES,
  STANDARD_GRID_TEMPLATE,
  type GridTemplate
} from "./GridTemplate";

export interface GridLayerSnapshot {
  id: number;
  name: string;
  kind?: unknown;
  visible: boolean;
  boundsNoEffects?: GridRect;
}

export interface GridOccupancySnapshot {
  documentId: number;
  scannedAt: number;
  scannedTopLevelLayerCount: number;
  occupiedSlots: Set<string>;
  slotLayerIds: Map<string, number[]>;
  layoutScanDurationMs: number;
}

export function isGridAuxiliaryTopLevelName(name: string): boolean {
  return GRID_AUXILIARY_TOP_LEVEL_NAMES.includes(name);
}

export function isGridCanvasBackdropBounds(
  bounds: GridRect | undefined,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): boolean {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return false;
  const tolerance = 0.5;
  return normalized.left <= tolerance
    && normalized.top <= tolerance
    && normalized.right >= template.canvas.width - tolerance
    && normalized.bottom >= template.canvas.height - tolerance;
}

export function isGridOccupancyExcludedLayer(
  layer: Pick<GridLayerSnapshot, "name" | "boundsNoEffects">,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): boolean {
  return isGridAuxiliaryTopLevelName(layer.name)
    || isGridCanvasBackdropBounds(layer.boundsNoEffects, template);
}

export function scanGridLayerSnapshots(
  documentId: number,
  layers: readonly GridLayerSnapshot[],
  template: GridTemplate = STANDARD_GRID_TEMPLATE,
  now: () => number = () => Date.now()
): GridOccupancySnapshot {
  const startedAt = now();
  const occupiedSlots = new Set<string>();
  const slotLayerIds = new Map<string, number[]>();
  let scannedTopLevelLayerCount = 0;

  for (const layer of layers) {
    if (isGridOccupancyExcludedLayer(layer, template)) continue;
    scannedTopLevelLayerCount += 1;
    const bounds = normalizeBounds(layer.boundsNoEffects);
    if (!bounds) continue;
    for (const slot of gridSlotsOccupiedByBounds(bounds, template)) {
      occupiedSlots.add(slot.id);
      const ids = slotLayerIds.get(slot.id);
      if (ids) {
        if (!ids.includes(layer.id)) ids.push(layer.id);
      } else {
        slotLayerIds.set(slot.id, [layer.id]);
      }
    }
  }

  const finishedAt = now();
  return {
    documentId,
    scannedAt: finishedAt,
    scannedTopLevelLayerCount,
    occupiedSlots,
    slotLayerIds,
    layoutScanDurationMs: Math.max(0, finishedAt - startedAt)
  };
}

function normalizeBounds(bounds: GridRect | undefined): GridRect | undefined {
  if (!bounds) return undefined;
  const normalized = {
    left: Number(bounds.left),
    top: Number(bounds.top),
    right: Number(bounds.right),
    bottom: Number(bounds.bottom)
  };
  return Object.values(normalized).every(Number.isFinite)
    && normalized.right > normalized.left
    && normalized.bottom > normalized.top
    ? normalized
    : undefined;
}
