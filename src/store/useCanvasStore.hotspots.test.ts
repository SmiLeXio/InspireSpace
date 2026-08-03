import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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

describe("image hotspot store results", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it("新增、编辑和删除热点返回明确结果", () => {
    const image = useCanvasStore.getState().createNode("image");
    let added = false;
    act(() => {
      added = useCanvasStore.getState().addImageHotspot(image.id, {
        x: 0.25,
        y: 0.75,
        label: "原名称",
        description: "原说明",
      });
    });
    expect(added).toBe(true);

    const hotspotId = useCanvasStore.getState().nodes.find((node) => node.id === image.id)!.hotspots[0].id;
    expect(useCanvasStore.getState().updateImageHotspot(image.id, hotspotId, { label: "新名称" })).toBe(true);
    expect(useCanvasStore.getState().removeImageHotspot(image.id, hotspotId)).toBe(true);
    expect(useCanvasStore.getState().addImageHotspot("missing", {
      x: 0.5,
      y: 0.5,
      label: "无效",
      description: "",
    })).toBe(false);
  });
});
