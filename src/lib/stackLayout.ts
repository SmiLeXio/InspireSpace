import type { CanvasNode } from "../types/canvas";

export interface CompactStackLayout {
  positions: Map<string, { x: number; y: number }>;
  frontToBack: CanvasNode[];
  topId: string;
  width: number;
  height: number;
}

const stableStackOrder = (node: CanvasNode) => node.stackOrder ?? node.zIndex;

const compareFrontPriority = (a: CanvasNode, b: CanvasNode) => {
  const areaDifference = a.width * a.height - b.width * b.height;
  if (areaDifference) return areaDifference;
  const heightDifference = a.height - b.height;
  if (heightDifference) return heightDifference;
  return stableStackOrder(b) - stableStackOrder(a);
};

export const compactStackLayout = (
  members: CanvasNode[],
  anchorX: number,
  anchorY: number,
): CompactStackLayout => {
  const width = Math.max(0, ...members.map((member) => member.width));
  const height = Math.max(0, ...members.map((member) => member.height));
  const positions = new Map(members.map((member) => [member.id, {
    x: anchorX + (width - member.width) / 2,
    y: anchorY + height - member.height,
  }]));
  const frontToBack = [...members].sort(compareFrontPriority);

  return {
    positions,
    frontToBack,
    topId: frontToBack[0]?.id ?? "",
    width,
    height,
  };
};
