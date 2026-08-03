import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../../store/useCanvasStore";
import { CanvasNode } from "./CanvasNode";

const resetStore = () => {
  useCanvasStore.setState({
    screen: "canvas",
    workspaceRoot: "测试项目",
    projectName: "测试项目",
    nodes: [],
    viewport: { x: 0, y: 0, scale: 1 },
    selectedIds: [],
    editingId: null,
    openFolderId: null,
    hydrated: true,
    loading: false,
    saveState: "idle",
    error: null,
    historyPast: [],
    historyFuture: [],
  });
};

describe("CanvasNode text object", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("只渲染透明文字内容，并可双击原位编辑", () => {
    const node = useCanvasStore.getState().createNode("text", { x: 220, y: 180 }, {
      content: "透明文字\n没有卡片背景",
      width: 280,
      height: 110,
    });

    const { container } = render(
      <CanvasNode
        node={node}
        selected
        singleSelection
        workspaceRoot="测试项目"
        childCount={0}
        stackCount={0}
        stackTop={false}
        stackExpanded={false}
        dragEnabled
        onDragModeUse={vi.fn()}
      />,
    );

    expect(container.querySelector(".node-text")).toBeInTheDocument();
    expect(container.querySelector(".node-drag-area")).not.toBeInTheDocument();
    expect(screen.getByTitle("双击编辑文字")).toHaveTextContent("透明文字 没有卡片背景");

    fireEvent.doubleClick(screen.getByTitle("双击编辑文字"));
    const editor = screen.getByRole("textbox", { name: "文本内容" });
    fireEvent.change(editor, { target: { value: "修改后的纯文字" } });

    expect(useCanvasStore.getState().nodes[0].content).toBe("修改后的纯文字");
  });
});
