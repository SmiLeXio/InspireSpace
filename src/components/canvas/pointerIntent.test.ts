import { describe, expect, it } from "vitest";
import { CARD_DRAG_THRESHOLD, exceededPointerDragThreshold } from "./pointerIntent";

describe("pointer intent", () => {
  it("keeps a click inside the drag threshold", () => {
    expect(exceededPointerDragThreshold({ x: 10, y: 20 }, { x: 14, y: 23 })).toBe(false);
    expect(exceededPointerDragThreshold(
      { x: 0, y: 0 },
      { x: CARD_DRAG_THRESHOLD, y: 0 },
    )).toBe(false);
  });

  it("activates drag only after crossing the threshold", () => {
    expect(exceededPointerDragThreshold(
      { x: 0, y: 0 },
      { x: CARD_DRAG_THRESHOLD + 0.01, y: 0 },
    )).toBe(true);
    expect(exceededPointerDragThreshold({ x: 4, y: 8 }, { x: 9, y: 13 })).toBe(true);
  });

  it("supports an explicit threshold", () => {
    expect(exceededPointerDragThreshold({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(false);
    expect(exceededPointerDragThreshold({ x: 0, y: 0 }, { x: 3, y: 4.1 }, 5)).toBe(true);
  });
});
