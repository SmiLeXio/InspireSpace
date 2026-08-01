import type { CanvasNode, Viewport } from "../../types/canvas";
import { compactStackLayout } from "../../lib/stackLayout";

export { compactStackLayout } from "../../lib/stackLayout";

export interface StackGroup {
  id: string;
  title: string;
  anchorX: number;
  anchorY: number;
  members: CanvasNode[];
  topId: string;
}

export interface StackBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface StackLayout {
  positions: Map<string, { x: number; y: number; row: number; column: number; index: number }>;
  bounds: StackBounds;
  columns: number;
}

export interface FocusOffsetOptions {
  clearance?: number;
  nodeGap?: number;
  passes?: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const STACK_GAP = 24;
export const STACK_SAFE_MARGIN = 24;
export const STACK_FOCUS_CLEARANCE = 56;
export const STACK_NEIGHBOR_GAP = 28;

const inferredOrder = (node: CanvasNode) => node.stackOrder ?? node.zIndex;

export const collectStackGroups = (nodes: CanvasNode[]) => {
  const grouped = new Map<string, CanvasNode[]>();
  for (const node of nodes) {
    if (!node.parentId && node.stackId) {
      grouped.set(node.stackId, [...(grouped.get(node.stackId) ?? []), node]);
    }
  }

  const result = new Map<string, StackGroup>();
  for (const [id, members] of grouped) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) => inferredOrder(a) - inferredOrder(b));
    const reference = ordered.find((member) => member.stackAnchorX != null && member.stackAnchorY != null) ?? ordered.at(-1)!;
    const anchorX = reference.stackAnchorX ?? reference.x;
    const anchorY = reference.stackAnchorY ?? reference.y;
    result.set(id, {
      id,
      title: reference.stackTitle || "未命名堆叠",
      anchorX,
      anchorY,
      members: ordered,
      topId: compactStackLayout(ordered, anchorX, anchorY).topId,
    });
  }
  return result;
};

export const stackColumns = (count: number) => {
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 5;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export const expandedStackLayout = (
  group: StackGroup,
  viewport: Viewport,
  viewportSize: { width: number; height: number },
  gap = STACK_GAP,
): StackLayout => {
  const columns = stackColumns(group.members.length);
  const rows = Math.ceil(group.members.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);

  group.members.forEach((member, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], member.width);
    rowHeights[row] = Math.max(rowHeights[row], member.height);
  });

  const width = columnWidths.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, columns - 1);
  const height = rowHeights.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, rows - 1);
  const compactLayout = compactStackLayout(group.members, group.anchorX, group.anchorY);
  const anchorCenterX = group.anchorX + compactLayout.width / 2;
  const anchorCenterY = group.anchorY + compactLayout.height / 2;

  const visible = {
    left: (0 - viewport.x) / viewport.scale,
    top: (0 - viewport.y) / viewport.scale,
    right: (viewportSize.width - viewport.x) / viewport.scale,
    bottom: (viewportSize.height - viewport.y) / viewport.scale,
  };
  const margin = 34 / viewport.scale;
  const left = clamp(anchorCenterX - width / 2, visible.left + margin, visible.right - width - margin);
  const top = clamp(anchorCenterY - height / 2, visible.top + margin + 44, visible.bottom - height - margin);

  const columnStarts: number[] = [];
  const rowStarts: number[] = [];
  let cursor = left;
  for (const columnWidth of columnWidths) {
    columnStarts.push(cursor);
    cursor += columnWidth + gap;
  }
  cursor = top;
  for (const rowHeight of rowHeights) {
    rowStarts.push(cursor);
    cursor += rowHeight + gap;
  }

  const positions = new Map<string, { x: number; y: number; row: number; column: number; index: number }>();
  group.members.forEach((member, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions.set(member.id, {
      x: columnStarts[column] + (columnWidths[column] - member.width) / 2,
      y: rowStarts[row] + (rowHeights[row] - member.height) / 2,
      row,
      column,
      index,
    });
  });

  return {
    positions,
    columns,
    bounds: { left, top, right: left + width, bottom: top + height, width, height },
  };
};

const intersects = (a: Rect, b: Rect, gap = 0) => a.left < b.right + gap
  && a.right > b.left - gap
  && a.top < b.bottom + gap
  && a.bottom > b.top - gap;

const translatedRect = (node: CanvasNode, offset: { x: number; y: number }): Rect => ({
  left: node.x + offset.x,
  top: node.y + offset.y,
  right: node.x + offset.x + node.width,
  bottom: node.y + offset.y + node.height,
});

const shortestExit = (rect: Rect, obstacle: Rect) => {
  const candidates = [
    { x: obstacle.left - rect.right, y: 0 },
    { x: obstacle.right - rect.left, y: 0 },
    { x: 0, y: obstacle.top - rect.bottom },
    { x: 0, y: obstacle.bottom - rect.top },
  ];
  return candidates.reduce((best, candidate) => (
    Math.abs(candidate.x) + Math.abs(candidate.y) < Math.abs(best.x) + Math.abs(best.y) ? candidate : best
  ));
};

const collisionPush = (moving: Rect, blocker: Rect, obstacleCenter: { x: number; y: number }, gap: number) => {
  const movingCenter = { x: (moving.left + moving.right) / 2, y: (moving.top + moving.bottom) / 2 };
  const horizontalDirection = movingCenter.x < obstacleCenter.x ? -1 : 1;
  const verticalDirection = movingCenter.y < obstacleCenter.y ? -1 : 1;
  const horizontal = horizontalDirection < 0
    ? { x: blocker.left - gap - moving.right, y: 0 }
    : { x: blocker.right + gap - moving.left, y: 0 };
  const vertical = verticalDirection < 0
    ? { x: 0, y: blocker.top - gap - moving.bottom }
    : { x: 0, y: blocker.bottom + gap - moving.top };
  return Math.abs(horizontal.x) <= Math.abs(vertical.y) ? horizontal : vertical;
};

export const calculateFocusOffsets = (
  nodes: CanvasNode[],
  bounds: StackBounds,
  excludedIds: ReadonlySet<string>,
  options: FocusOffsetOptions = {},
) => {
  const clearance = options.clearance ?? STACK_FOCUS_CLEARANCE;
  const nodeGap = options.nodeGap ?? STACK_NEIGHBOR_GAP;
  const passes = Math.max(1, options.passes ?? 3);
  const obstacle: Rect = {
    left: bounds.left - clearance,
    top: bounds.top - clearance,
    right: bounds.right + clearance,
    bottom: bounds.bottom + clearance,
  };
  const obstacleCenter = {
    x: (obstacle.left + obstacle.right) / 2,
    y: (obstacle.top + obstacle.bottom) / 2,
  };
  const eligible = nodes.filter((node) => !node.parentId && !excludedIds.has(node.id));
  const offsets = new Map<string, { x: number; y: number }>();

  for (let pass = 0; pass < passes; pass += 1) {
    let changed = false;
    for (const node of eligible) {
      const current = offsets.get(node.id) ?? { x: 0, y: 0 };
      const rect = translatedRect(node, current);
      if (!intersects(rect, obstacle)) continue;
      const push = shortestExit(rect, obstacle);
      offsets.set(node.id, { x: current.x + push.x, y: current.y + push.y });
      changed = true;
    }

    const activeIds = new Set(offsets.keys());
    for (const node of eligible) {
      if (!activeIds.has(node.id)) continue;
      const current = offsets.get(node.id)!;
      let rect = translatedRect(node, current);
      for (const blocker of eligible) {
        if (blocker.id === node.id) continue;
        const blockerRect = translatedRect(blocker, offsets.get(blocker.id) ?? { x: 0, y: 0 });
        if (!intersects(rect, blockerRect, nodeGap)) continue;
        const push = collisionPush(rect, blockerRect, obstacleCenter, nodeGap);
        const next = { x: current.x + push.x, y: current.y + push.y };
        offsets.set(node.id, next);
        current.x = next.x;
        current.y = next.y;
        rect = translatedRect(node, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const [id, offset] of offsets) {
    if (Math.abs(offset.x) < 0.001 && Math.abs(offset.y) < 0.001) offsets.delete(id);
  }
  return offsets;
};

export const pointInStackBounds = (
  point: { x: number; y: number },
  bounds: StackBounds,
  margin = STACK_SAFE_MARGIN,
) => point.x >= bounds.left - margin
  && point.x <= bounds.right + margin
  && point.y >= bounds.top - margin - 44
  && point.y <= bounds.bottom + margin;
