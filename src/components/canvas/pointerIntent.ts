export interface PointerPoint {
  x: number;
  y: number;
}

export const CARD_DRAG_THRESHOLD = 6;

export const exceededPointerDragThreshold = (
  start: PointerPoint,
  current: PointerPoint,
  threshold = CARD_DRAG_THRESHOLD,
) => Math.hypot(current.x - start.x, current.y - start.y) > threshold;
