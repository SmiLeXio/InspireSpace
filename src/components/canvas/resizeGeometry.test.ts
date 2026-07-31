import { describe, expect, it } from "vitest";
import { resizeFromCorner } from "./resizeGeometry";

const origin = { x: 100, y: 80, width: 300, height: 220 };

describe("resizeFromCorner", () => {
  it("右下角缩放时固定左上角", () => {
    expect(resizeFromCorner(origin, "bottom-right", { x: 70, y: 50 })).toEqual({
      x: 100,
      y: 80,
      width: 370,
      height: 270,
    });
  });

  it("右上角缩放时固定左下角", () => {
    const result = resizeFromCorner(origin, "top-right", { x: 70, y: -45 });
    expect(result).toEqual({ x: 100, y: 35, width: 370, height: 265 });
    expect(result.y + result.height).toBe(origin.y + origin.height);
  });

  it("左下角缩放时固定右上角", () => {
    const result = resizeFromCorner(origin, "bottom-left", { x: -55, y: 60 });
    expect(result).toEqual({ x: 45, y: 80, width: 355, height: 280 });
    expect(result.x + result.width).toBe(origin.x + origin.width);
  });

  it("左上角缩放时固定右下角", () => {
    const result = resizeFromCorner(origin, "top-left", { x: -40, y: -30 });
    expect(result).toEqual({ x: 60, y: 50, width: 340, height: 250 });
    expect(result.x + result.width).toBe(origin.x + origin.width);
    expect(result.y + result.height).toBe(origin.y + origin.height);
  });

  it("达到最小尺寸时仍保持相对角锚点", () => {
    const result = resizeFromCorner(origin, "top-left", { x: 999, y: 999 });
    expect(result).toEqual({ x: 220, y: 160, width: 180, height: 140 });
  });

  it("锁定宽高比时不改变固定锚点", () => {
    const result = resizeFromCorner(origin, "top-right", { x: 120, y: -10 }, { lockAspectRatio: true });
    expect(result.x).toBe(origin.x);
    expect(result.y + result.height).toBeCloseTo(origin.y + origin.height);
    expect(result.width / result.height).toBeCloseTo(origin.width / origin.height);
  });
});
