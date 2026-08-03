import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../../store/useCanvasStore";
import { CanvasContextMenu, type ContextMenuPoint } from "./CanvasContextMenu";

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

describe("CanvasContextMenu image hotspots", () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  const setup = () => {
    let imageId = "";
    act(() => {
      imageId = useCanvasStore.getState().createNode("image", { x: 220, y: 180 }).id;
      useCanvasStore.getState().addImageHotspot(imageId, {
        x: 0.32,
        y: 0.58,
        label: "玻璃细节",
        description: "半透明边缘",
      });
    });
    const point: ContextMenuPoint = {
      screenX: 320,
      screenY: 200,
      worldX: 220,
      worldY: 180,
      nodeId: imageId,
      hotspotX: 0.46,
      hotspotY: 0.62,
    };
    const onClose = vi.fn();
    const onRequestDialog = vi.fn();
    render(<CanvasContextMenu point={point} onClose={onClose} onRequestDialog={onRequestDialog} />);
    return { imageId, onClose, onRequestDialog };
  };

  it("从图片工具打开新增热点弹窗", () => {
    const { imageId, onClose, onRequestDialog } = setup();

    fireEvent.click(screen.getByRole("button", { name: /添加图片热点/ }));

    expect(onRequestDialog).toHaveBeenCalledWith({
      kind: "hotspot",
      nodeId: imageId,
      x: 0.46,
      y: 0.62,
      anchor: { x: 320, y: 200 },
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("热点存档可以展开并打开编辑弹窗", () => {
    const { imageId, onClose, onRequestDialog } = setup();
    const trigger = screen.getByRole("button", { name: /热点存档/ });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "玻璃细节" }));

    expect(onRequestDialog).toHaveBeenCalledWith(expect.objectContaining({
      kind: "hotspot",
      nodeId: imageId,
      label: "玻璃细节",
      description: "半透明边缘",
    }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("热点存档可以删除热点", () => {
    const { imageId } = setup();
    fireEvent.click(screen.getByRole("button", { name: /热点存档/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除玻璃细节" }));

    const image = useCanvasStore.getState().nodes.find((node) => node.id === imageId);
    expect(image?.hotspots).toEqual([]);
    expect(screen.getByText("这张图片还没有热点")).toBeInTheDocument();
  });
});


