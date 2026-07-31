import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "./useCanvasStore";

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

describe("canvas store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    resetStore();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("创建并选中便签", () => {
    let nodeId = "";
    act(() => {
      nodeId = useCanvasStore.getState().createNode("sticky").id;
    });

    const state = useCanvasStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].type).toBe("sticky");
    expect(state.selectedIds).toEqual([nodeId]);
    expect(state.historyPast).toHaveLength(1);
  });

  it("更新内容不会写入布局历史", () => {
    const node = useCanvasStore.getState().createNode("note");
    const historyCount = useCanvasStore.getState().historyPast.length;
    act(() => {
      useCanvasStore.getState().updateNode(node.id, { title: "田野笔记" }, false);
    });

    const updated = useCanvasStore.getState().nodes[0];
    expect(updated.id).toBe(node.id);
    expect(updated.title).toBe("田野笔记");
    expect(useCanvasStore.getState().historyPast).toHaveLength(historyCount);
  });

  it("支持布局撤销和恢复", () => {
    const node = useCanvasStore.getState().createNode("note", { x: 100, y: 100 });
    act(() => useCanvasStore.getState().updateNodeLayout(node.id, { x: 240, y: 180 }));
    expect(useCanvasStore.getState().nodes[0].x).toBe(240);

    act(() => useCanvasStore.getState().undo());
    expect(useCanvasStore.getState().nodes[0].x).toBe(100 - node.width / 2);

    act(() => useCanvasStore.getState().redo());
    expect(useCanvasStore.getState().nodes[0].x).toBe(240);
  });

  it("拖到普通卡片只更新落点，不再自动组成堆叠", () => {
    const moving = useCanvasStore.getState().createNode("image", { x: 120, y: 120 });
    const target = useCanvasStore.getState().createNode("note", { x: 520, y: 320 });
    const before = structuredClone(useCanvasStore.getState().nodes);

    act(() => {
      useCanvasStore.getState().finishDrag(
        before,
        [{ id: moving.id, patch: { x: 460, y: 280 } }],
        target.id,
      );
    });

    const state = useCanvasStore.getState();
    const movedNode = state.nodes.find((node) => node.id === moving.id);
    const targetNode = state.nodes.find((node) => node.id === target.id);
    expect(movedNode).toMatchObject({ x: 460, y: 280, stackId: null, parentId: null });
    expect(targetNode?.stackId).toBeNull();
    expect(state.historyPast.at(-1)?.before).toEqual(before);
  });

  it("框选后的多个对象可以统一组成堆叠", () => {
    const first = useCanvasStore.getState().createNode("image", { x: 120, y: 120 });
    const second = useCanvasStore.getState().createNode("note", { x: 520, y: 320 });

    act(() => {
      useCanvasStore.getState().selectMany([first.id, second.id]);
      useCanvasStore.getState().stackSelected();
    });

    const [firstNode, secondNode] = [first.id, second.id].map((id) =>
      useCanvasStore.getState().nodes.find((node) => node.id === id),
    );
    expect(firstNode?.stackId).toBeTruthy();
    expect(firstNode?.stackId).toBe(secondNode?.stackId);
    expect(firstNode?.x).not.toBe(secondNode?.x);
  });

  it("解除堆叠后只保留原最上层对象为选中状态", () => {
    const first = useCanvasStore.getState().createNode("image", { x: 120, y: 120 });
    const second = useCanvasStore.getState().createNode("note", { x: 520, y: 320 });

    act(() => {
      useCanvasStore.getState().selectMany([first.id, second.id]);
      useCanvasStore.getState().stackSelected();
    });

    const stacked = useCanvasStore.getState().nodes
      .filter((node) => node.stackId)
      .sort((a, b) => a.zIndex - b.zIndex);
    const stackId = stacked[0].stackId!;
    const topId = stacked.at(-1)!.id;

    act(() => useCanvasStore.getState().unstack(stackId));

    expect(useCanvasStore.getState().nodes.every((node) => node.stackId === null)).toBe(true);
    expect(useCanvasStore.getState().selectedIds).toEqual([topId]);
  });

  it("拖到文件夹会收纳并清除原堆叠", () => {
    const moving = useCanvasStore.getState().createNode(
      "note",
      { x: 120, y: 120 },
      { stackId: "旧堆叠" },
    );
    const folder = useCanvasStore.getState().createNode("folder", { x: 520, y: 320 });
    const before = structuredClone(useCanvasStore.getState().nodes);

    act(() => {
      useCanvasStore.getState().finishDrag(
        before,
        [{ id: moving.id, patch: { x: folder.x, y: folder.y } }],
        folder.id,
      );
    });

    const movedNode = useCanvasStore.getState().nodes.find((node) => node.id === moving.id);
    expect(movedNode?.parentId).toBe(folder.id);
    expect(movedNode?.stackId).toBeNull();
  });

  it("图片热点支持添加和删除", () => {
    const image = useCanvasStore.getState().createNode("image");

    act(() => {
      useCanvasStore.getState().addImageHotspot(image.id, {
        x: 0.4,
        y: 0.5,
        label: "镜头",
        description: "主体细节",
      });
    });

    const hotspot = useCanvasStore.getState().nodes.find((node) => node.id === image.id)?.hotspots[0];
    expect(hotspot).toMatchObject({
      x: 0.4,
      y: 0.5,
      label: "镜头",
      description: "主体细节",
    });
    expect(hotspot?.id).toBeTruthy();

    act(() => {
      useCanvasStore.getState().removeImageHotspot(image.id, hotspot!.id);
    });

    expect(useCanvasStore.getState().nodes.find((node) => node.id === image.id)?.hotspots).toEqual([]);
  });
});
