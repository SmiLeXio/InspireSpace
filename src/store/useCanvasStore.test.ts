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

  it("拖到普通卡片会创建可撤销的堆叠", () => {
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

    let state = useCanvasStore.getState();
    const movedNode = state.nodes.find((node) => node.id === moving.id)!;
    const targetNode = state.nodes.find((node) => node.id === target.id)!;
    expect(movedNode.stackId).toBeTruthy();
    expect(movedNode).toMatchObject({
      parentId: null,
      stackId: targetNode.stackId,
      stackOrder: 1,
      stackAnchorX: target.x,
      stackAnchorY: target.y,
      x: target.x + 5,
      y: target.y + 150,
    });
    expect(targetNode).toMatchObject({
      stackOrder: 0,
      stackAnchorX: target.x,
      stackAnchorY: target.y,
      x: target.x,
      y: target.y,
    });
    expect(state.stackNotice?.message).toBe("已创建堆叠");
    expect(state.historyPast.at(-1)?.before).toEqual(before);

    act(() => useCanvasStore.getState().undo());
    state = useCanvasStore.getState();
    expect(state.nodes.find((node) => node.id === moving.id)).toEqual(before.find((node) => node.id === moving.id));
    expect(state.nodes.find((node) => node.id === target.id)).toEqual(before.find((node) => node.id === target.id));
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

  it("追加第三个成员时保留稳定顺序并按最大外框底边居中", () => {
    const first = useCanvasStore.getState().createNode("note", { x: 160, y: 160 });
    const second = useCanvasStore.getState().createNode("image", { x: 520, y: 320 });
    const third = useCanvasStore.getState().createNode("sticky", { x: 860, y: 420 });

    let before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: first.id, patch: { x: second.x, y: second.y } }], second.id));
    const originalMembers = useCanvasStore.getState().nodes
      .filter((node) => node.stackId)
      .sort((a, b) => a.stackOrder! - b.stackOrder!);
    const stackId = originalMembers[0].stackId!;

    before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: third.id, patch: { x: second.x, y: second.y } }], originalMembers.at(-1)!.id));

    const members = useCanvasStore.getState().nodes
      .filter((node) => node.stackId === stackId)
      .sort((a, b) => a.stackOrder! - b.stackOrder!);
    expect(members.map((node) => node.id)).toEqual([...originalMembers.map((node) => node.id), third.id]);
    expect(members.map((node) => node.stackOrder)).toEqual([0, 1, 2]);
    expect(members.find((node) => node.id === first.id)).toMatchObject({ x: second.x, y: second.y });
    expect(members.find((node) => node.id === second.id)).toMatchObject({ x: second.x + 5, y: second.y + 150 });
    expect(members.find((node) => node.id === third.id)).toMatchObject({ x: second.x + 45, y: second.y + 210 });
    expect(members.map((node) => node.x + node.width / 2)).toEqual([second.x + 195, second.x + 195, second.x + 195]);
    expect(members.map((node) => node.y + node.height)).toEqual([second.y + 430, second.y + 430, second.y + 430]);
    expect(useCanvasStore.getState().stackNotice?.message).toBe("已加入堆叠");
  });

  it("从三成员堆叠提取一个成员后其余成员连续补位", () => {
    const first = useCanvasStore.getState().createNode("note", { x: 160, y: 160 });
    const second = useCanvasStore.getState().createNode("image", { x: 520, y: 320 });
    const third = useCanvasStore.getState().createNode("sticky", { x: 860, y: 420 });
    let before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: first.id, patch: { x: second.x, y: second.y } }], second.id));
    const stackTarget = useCanvasStore.getState().nodes.find((node) => node.id === first.id)!;
    before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: third.id, patch: { x: second.x, y: second.y } }], stackTarget.id));

    before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: third.id, patch: { x: 980, y: 720 } }]));

    const state = useCanvasStore.getState();
    const extracted = state.nodes.find((node) => node.id === third.id)!;
    const remaining = state.nodes.filter((node) => node.stackId).sort((a, b) => a.stackOrder! - b.stackOrder!);
    expect(extracted).toMatchObject({ x: 980, y: 720, parentId: null, stackId: null, stackOrder: null });
    expect(remaining).toHaveLength(2);
    expect(remaining.map((node) => node.stackOrder)).toEqual([0, 1]);
    expect(remaining[0]).toMatchObject({ x: second.x + 5, y: second.y + 150 });
    expect(remaining[1]).toMatchObject({ x: second.x, y: second.y });
  });

  it("二成员堆叠提取后自动解散，撤销和恢复保留完整元数据", () => {
    const first = useCanvasStore.getState().createNode("note", { x: 160, y: 160 });
    const second = useCanvasStore.getState().createNode("image", { x: 520, y: 320 });
    let before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: first.id, patch: { x: second.x, y: second.y } }], second.id));
    before = structuredClone(useCanvasStore.getState().nodes);

    act(() => useCanvasStore.getState().finishDrag(before, [{ id: first.id, patch: { x: 920, y: 680 } }]));
    expect(useCanvasStore.getState().nodes.every((node) => node.stackId === null)).toBe(true);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === second.id)).toMatchObject({
      x: second.x,
      y: second.y,
      stackOrder: null,
      stackAnchorX: null,
      stackAnchorY: null,
      stackTitle: null,
    });

    act(() => useCanvasStore.getState().undo());
    expect(useCanvasStore.getState().nodes).toEqual(before);
    act(() => useCanvasStore.getState().redo());
    expect(useCanvasStore.getState().nodes.every((node) => node.stackId === null)).toBe(true);
  });

  it("展开成员可以从堆叠提取并投放到文件夹", () => {
    const first = useCanvasStore.getState().createNode("note", { x: 160, y: 160 });
    const second = useCanvasStore.getState().createNode("image", { x: 520, y: 320 });
    const third = useCanvasStore.getState().createNode("sticky", { x: 860, y: 420 });
    const folder = useCanvasStore.getState().createNode("folder", { x: 980, y: 640 });
    let before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: first.id, patch: { x: second.x, y: second.y } }], second.id));
    before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: third.id, patch: { x: second.x, y: second.y } }], first.id));

    before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: third.id, patch: { x: folder.x, y: folder.y } }], folder.id));

    const moved = useCanvasStore.getState().nodes.find((node) => node.id === third.id)!;
    expect(moved).toMatchObject({ parentId: folder.id, stackId: null, stackOrder: null, stackAnchorX: null, stackAnchorY: null });
    expect(useCanvasStore.getState().nodes.filter((node) => node.stackId)).toHaveLength(2);
  });

  it("整体移动堆叠会同步锚点且只增加一条历史", () => {
    const first = useCanvasStore.getState().createNode("note", { x: 160, y: 160 });
    const second = useCanvasStore.getState().createNode("image", { x: 520, y: 320 });
    const beforeCreate = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(beforeCreate, [{ id: first.id, patch: { x: second.x, y: second.y } }], second.id));
    const beforeMove = structuredClone(useCanvasStore.getState().nodes);
    const historyCount = useCanvasStore.getState().historyPast.length;
    const members = beforeMove.filter((node) => node.stackId);
    const originalZIndexes = new Map(members.map((node) => [node.id, node.zIndex]));

    act(() => useCanvasStore.getState().finishDrag(
      beforeMove,
      members.map((node) => ({ id: node.id, patch: { x: node.x + 120, y: node.y - 70 } })),
    ));

    const moved = useCanvasStore.getState().nodes.filter((node) => node.stackId);
    expect(moved.every((node) => node.stackAnchorX === second.x + 120 && node.stackAnchorY === second.y - 70)).toBe(true);
    expect(moved.every((node) => node.zIndex === originalZIndexes.get(node.id))).toBe(true);
    expect(useCanvasStore.getState().historyPast).toHaveLength(historyCount + 1);
    act(() => useCanvasStore.getState().undo());
    expect(useCanvasStore.getState().nodes).toEqual(beforeMove);
  });

  it("删除堆叠成员后会修复顺序，并在只剩一项时自动解散", async () => {
    const first = useCanvasStore.getState().createNode("note", { x: 160, y: 160 });
    const second = useCanvasStore.getState().createNode("image", { x: 520, y: 320 });
    const third = useCanvasStore.getState().createNode("sticky", { x: 860, y: 420 });
    let before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: first.id, patch: { x: second.x, y: second.y } }], second.id));
    before = structuredClone(useCanvasStore.getState().nodes);
    act(() => useCanvasStore.getState().finishDrag(before, [{ id: third.id, patch: { x: second.x, y: second.y } }], first.id));

    await act(async () => useCanvasStore.getState().deleteNodes([first.id]));
    let remaining = useCanvasStore.getState().nodes.filter((node) => node.stackId).sort((a, b) => a.stackOrder! - b.stackOrder!);
    expect(remaining.map((node) => node.stackOrder)).toEqual([0, 1]);

    await act(async () => useCanvasStore.getState().deleteNodes([remaining[1].id]));
    remaining = useCanvasStore.getState().nodes;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ stackId: null, stackOrder: null, stackAnchorX: null, stackAnchorY: null });
  });
  it("创建文件夹会保存名称、颜色和预置图标", () => {
    const folder = useCanvasStore.getState().createFolder([], { x: 420, y: 320 }, {
      title: "灵感收藏",
      color: "#88a58f",
      folderIcon: "sparkles",
    });

    expect(folder).toMatchObject({
      title: "灵感收藏",
      color: "#88a58f",
      folderIcon: "sparkles",
      content: "空文件夹",
    });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === folder.id)).toMatchObject({
      title: "灵感收藏",
      color: "#88a58f",
      folderIcon: "sparkles",
    });
  });
  it("文件夹子项可以移回画布并支持撤销", () => {
    const child = useCanvasStore.getState().createNode("sticky", { x: 180, y: 160 });
    const original = { x: child.x, y: child.y };
    const folder = useCanvasStore.getState().createFolder([child.id], { x: 620, y: 420 });
    act(() => useCanvasStore.getState().openFolder(folder.id));

    act(() => useCanvasStore.getState().extractNodeFromFolder(child.id, { x: 760, y: 540 }));

    let state = useCanvasStore.getState();
    expect(state.nodes.find((node) => node.id === child.id)).toMatchObject({
      parentId: null,
      x: 760,
      y: 540,
      stackId: null,
      stackOrder: null,
      stackAnchorX: null,
      stackAnchorY: null,
    });
    expect(state.selectedIds).toEqual([child.id]);
    expect(state.openFolderId).toBeNull();

    act(() => useCanvasStore.getState().undo());
    state = useCanvasStore.getState();
    expect(state.nodes.find((node) => node.id === child.id)).toMatchObject({
      parentId: folder.id,
      x: original.x,
      y: original.y,
    });
  });

  it("图片热点编辑支持撤销", () => {
    const image = useCanvasStore.getState().createNode("image");
    act(() => {
      useCanvasStore.getState().addImageHotspot(image.id, {
        x: 0.25,
        y: 0.35,
        label: "原始标题",
        description: "原始说明",
      });
    });
    const hotspotId = useCanvasStore.getState().nodes.find((node) => node.id === image.id)!.hotspots[0].id;

    act(() => {
      useCanvasStore.getState().updateImageHotspot(image.id, hotspotId, {
        label: "编辑后的标题",
        description: "编辑后的说明",
      });
    });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === image.id)!.hotspots[0]).toMatchObject({
      label: "编辑后的标题",
      description: "编辑后的说明",
    });

    act(() => useCanvasStore.getState().undo());
    expect(useCanvasStore.getState().nodes.find((node) => node.id === image.id)!.hotspots[0]).toMatchObject({
      label: "原始标题",
      description: "原始说明",
    });
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
