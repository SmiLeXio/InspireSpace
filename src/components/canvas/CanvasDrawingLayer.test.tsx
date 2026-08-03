import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stroke } from "drawesome";
import type { Viewport } from "../../types/canvas";
import {
  CanvasDrawingLayer,
  createStaticDrawing,
  screenToWorldStrokes,
  worldToScreenStrokes,
} from "./CanvasDrawingLayer";

const viewport: Viewport = { x: 120, y: -50, scale: 1.5 };
const strokes: Stroke[] = [{
  id: 1,
  pen: "pen",
  color: "#24342d",
  size: 4,
  opacity: 0.9,
  points: [
    [10, 20, 0.4],
    [22, 31, 0.7],
    [30, 40, 0.6],
  ],
}];

const saveDrawing = (workspaceRoot: string, drawing: Stroke[]) => {
  localStorage.setItem(`inspirespace:canvas-drawing:${workspaceRoot}`, JSON.stringify({
    version: 1,
    strokes: drawing,
  }));
};

describe("CanvasDrawingLayer", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("在世界坐标与屏幕坐标之间无损往返", () => {
    const restored = screenToWorldStrokes(worldToScreenStrokes(strokes, viewport), viewport);

    expect(restored).toHaveLength(1);
    expect(restored[0].size).toBeCloseTo(strokes[0].size);
    restored[0].points.forEach((point, index) => {
      expect(point[0]).toBeCloseTo(strokes[0].points[index][0]);
      expect(point[1]).toBeCloseTo(strokes[0].points[index][1]);
      expect(point[2]).toBe(strokes[0].points[index][2]);
    });
  });

  it("关闭绘画时生成可随视口同步变换的静态 SVG", () => {
    saveDrawing("static-test", strokes);
    const { container } = render(
      <CanvasDrawingLayer enabled={false} viewport={viewport} workspaceRoot="static-test" />,
    );

    const staticLayer = container.querySelector<HTMLElement>(".canvas-drawing-static");
    const drawing = createStaticDrawing(strokes);
    expect(drawing).not.toBeNull();
    expect(staticLayer).toBeInTheDocument();
    expect(staticLayer?.querySelector("svg")).toBeInTheDocument();
    expect(staticLayer?.style.transform).toBe(
      `matrix(${viewport.scale}, 0, 0, ${viewport.scale}, ${viewport.x + drawing!.left * viewport.scale}, ${viewport.y + drawing!.top * viewport.scale})`,
    );
    expect(container.querySelector(".canvas-drawing-layer")).not.toBeInTheDocument();
  });

  it("展开后收起仍保留左下角入口，并且可以再次展开", () => {
    const { container, rerender } = render(
      <CanvasDrawingLayer enabled={false} viewport={viewport} workspaceRoot="reopen-test" />,
    );

    expect(screen.queryByRole("button", { name: "展开绘画工具" })).not.toBeInTheDocument();

    rerender(<CanvasDrawingLayer enabled viewport={viewport} workspaceRoot="reopen-test" />);
    const launcher = screen.getByRole("button", { name: "展开绘画工具" });
    expect(launcher).toHaveClass("canvas-drawing-launcher");
    expect(container.querySelector(".canvas-drawing-layer.is-collapsed")).toBeInTheDocument();

    fireEvent.click(launcher);
    expect(screen.getByRole("button", { name: "收起绘画工具" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "钢笔" })).toHaveAttribute("title", "钢笔");
    expect(screen.getByRole("button", { name: /墨水颜色/ })).toBeInTheDocument();
    expect(container.querySelector('[data-placement="bottom"][data-align="start"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "收起绘画工具" }));
    expect(screen.queryByRole("button", { name: "收起绘画工具" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开绘画工具" })).toHaveClass("canvas-drawing-launcher");
    expect(container.querySelector(".canvas-drawing-layer.is-collapsed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开绘画工具" }));
    expect(screen.getByRole("button", { name: "收起绘画工具" })).toBeInTheDocument();

    rerender(<CanvasDrawingLayer enabled={false} viewport={viewport} workspaceRoot="reopen-test" />);
    expect(screen.queryByRole("button", { name: "展开绘画工具" })).not.toBeInTheDocument();

    rerender(<CanvasDrawingLayer enabled viewport={viewport} workspaceRoot="reopen-test" />);
    expect(screen.getByRole("button", { name: "展开绘画工具" })).toHaveClass("canvas-drawing-launcher");
  });
  it("展开绘画时阻止右键菜单冒泡", () => {
    const onContextMenu = vi.fn();
    const { container } = render(
      <div onContextMenu={onContextMenu}>
        <CanvasDrawingLayer enabled viewport={viewport} workspaceRoot="context-menu-test" />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开绘画工具" }));
    const layer = container.querySelector<HTMLElement>(".canvas-drawing-layer.is-enabled");
    expect(layer).toBeInTheDocument();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    layer!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it("展开绘画时保留静态快照直到绘画表面准备完成", () => {
    saveDrawing("handoff-test", strokes);
    const { container } = render(
      <CanvasDrawingLayer enabled viewport={viewport} workspaceRoot="handoff-test" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开绘画工具" }));

    expect(container.querySelector(".canvas-drawing-static")).toBeInTheDocument();
    expect(container.querySelector(".canvas-drawing-layer.is-preparing")).toBeInTheDocument();
  });
});

