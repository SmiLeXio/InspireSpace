import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasCreationDialog } from "./CanvasCreationDialog";

describe("CanvasCreationDialog", () => {
  afterEach(cleanup);
  it("提交文件夹名称、预置图标和自定义颜色", () => {
    const onCreateFolder = vi.fn(() => true);

    render(
      <CanvasCreationDialog
        request={{ kind: "folder", childIds: ["first", "second"], point: { x: 120, y: 160 } }}
        onClose={vi.fn()}
        onCreateFolder={onCreateFolder}
        onSaveHotspot={vi.fn()}
        onCreateText={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "设计素材" } });
    fireEvent.click(screen.getByRole("button", { name: "个性设置" }));
    fireEvent.click(screen.getByRole("button", { name: "灵感" }));
    fireEvent.change(screen.getByLabelText("自定义文件夹颜色"), { target: { value: "#7357c8" } });
    fireEvent.click(screen.getByRole("button", { name: "创建文件夹" }));

    expect(onCreateFolder).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "folder", childIds: ["first", "second"] }),
      { title: "设计素材", color: "#7357c8", folderIcon: "sparkles" },
    );
  });

  it("提交输入内容并创建文本卡片", () => {
    const onCreateText = vi.fn(() => true);

    render(
      <CanvasCreationDialog
        request={{ kind: "text", point: { x: 220, y: 180 } }}
        onClose={vi.fn()}
        onCreateFolder={vi.fn()}
        onSaveHotspot={vi.fn()}
        onCreateText={onCreateText}
      />,
    );

    fireEvent.change(screen.getByLabelText("文本内容"), { target: { value: "记录今天的灵感\n下一步整理成方案" } });
    fireEvent.click(screen.getByRole("button", { name: "创建文本" }));

    expect(onCreateText).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "text", point: { x: 220, y: 180 } }),
      { content: "记录今天的灵感\n下一步整理成方案" },
    );
  });

  it("热点保存失败时保留弹窗并显示反馈", () => {
    const onSaveHotspot = vi.fn(() => false);

    render(
      <CanvasCreationDialog
        request={{ kind: "hotspot", nodeId: "image-1", x: 0.4, y: 0.6 }}
        onClose={vi.fn()}
        onCreateFolder={vi.fn()}
        onSaveHotspot={onSaveHotspot}
        onCreateText={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("热点名称"), { target: { value: "材质细节" } });
    fireEvent.click(screen.getByRole("button", { name: "添加说明" }));
    fireEvent.change(screen.getByLabelText(/热点说明/), { target: { value: "磨砂玻璃边缘" } });
    fireEvent.click(screen.getByRole("button", { name: "创建热点" }));

    expect(onSaveHotspot).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "hotspot", nodeId: "image-1", x: 0.4, y: 0.6 }),
      { label: "材质细节", description: "磨砂玻璃边缘" },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("热点未能保存");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "NEW HOTSPOT" })).toBeInTheDocument();
  });
});
