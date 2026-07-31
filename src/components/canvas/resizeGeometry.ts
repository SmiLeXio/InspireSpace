export type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResizeOptions {
  minWidth?: number;
  minHeight?: number;
  lockAspectRatio?: boolean;
}

const DEFAULT_MIN_WIDTH = 180;
const DEFAULT_MIN_HEIGHT = 140;

export const resizeFromCorner = (
  origin: CanvasRect,
  corner: ResizeCorner,
  delta: { x: number; y: number },
  options: ResizeOptions = {},
): CanvasRect => {
  const fromLeft = corner.endsWith("left");
  const fromTop = corner.startsWith("top");
  const minWidth = options.minWidth ?? DEFAULT_MIN_WIDTH;
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;

  let width = fromLeft ? origin.width - delta.x : origin.width + delta.x;
  let height = fromTop ? origin.height - delta.y : origin.height + delta.y;

  if (options.lockAspectRatio) {
    const ratio = origin.width / Math.max(1, origin.height);
    const widthChange = Math.abs(width / Math.max(1, origin.width) - 1);
    const heightChange = Math.abs(height / Math.max(1, origin.height) - 1);

    if (widthChange >= heightChange) {
      width = Math.max(width, minWidth, minHeight * ratio);
      height = width / ratio;
    } else {
      height = Math.max(height, minHeight, minWidth / ratio);
      width = height * ratio;
    }
  } else {
    width = Math.max(minWidth, width);
    height = Math.max(minHeight, height);
  }

  return {
    x: fromLeft ? right - width : origin.x,
    y: fromTop ? bottom - height : origin.y,
    width,
    height,
  };
};
