import {
  Archive,
  ChevronRight,
  Clock3,
  ClipboardPaste,
  File as FileIcon,
  FileText,
  FolderPlus,
  Globe2,
  ImagePlus,
  Layers3,
  MousePointer2,
  Pencil,
  Puzzle,
  Redo2,
  StickyNote,
  Trash2,
  Undo2,
  Video,
} from "lucide-react";
import { useState } from "react";
import { useCanvasStore } from "../../store/useCanvasStore";
import { STICKY_COLORS } from "../../types/canvas";
import type { CanvasDialogRequest } from "./CanvasCreationDialog";

export interface ContextMenuPoint {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  nodeId?: string;
  hotspotX?: number;
  hotspotY?: number;
}

interface CanvasContextMenuProps {
  point: ContextMenuPoint;
  onClose: () => void;
  onRequestDialog: (request: CanvasDialogRequest) => void;
}

export function CanvasContextMenu({ point, onClose, onRequestDialog }: CanvasContextMenuProps) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const createNode = useCanvasStore((state) => state.createNode);
  const importMedia = useCanvasStore((state) => state.importMedia);
  const createFromText = useCanvasStore((state) => state.createFromText);
  const stackSelected = useCanvasStore((state) => state.stackSelected);
  const removeImageHotspot = useCanvasStore((state) => state.removeImageHotspot);
  const targetNode = useCanvasStore((state) => point.nodeId ? state.nodes.find((node) => node.id === point.nodeId) : undefined);
  const selectedIds = useCanvasStore((state) => state.selectedIds);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const historyPast = useCanvasStore((state) => state.historyPast);
  const historyFuture = useCanvasStore((state) => state.historyFuture);
  const world = { x: point.worldX, y: point.worldY };

  const run = (action: () => unknown | Promise<unknown>) => {
    onClose();
    void action();
  };

  const openDialog = (request: CanvasDialogRequest) => {
    onRequestDialog(request);
    onClose();
  };

  const requestHotspot = () => {
    if (!targetNode || targetNode.type !== "image") return;
    openDialog({
      kind: "hotspot",
      nodeId: targetNode.id,
      x: point.hotspotX ?? 0.5,
      y: point.hotspotY ?? 0.5,
      anchor: { x: point.screenX, y: point.screenY },
    });
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      createFromText(text, world);
    } catch {
      const text = window.prompt("粘贴网页地址或文字");
      if (text) createFromText(text, world);
    }
  };

  return (
    <div
      className="canvas-context-menu"
      style={{ left: point.screenX, top: point.screenY }}
      role="menu"
      aria-label="新建内容"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {targetNode?.type === "image" ? (
        <>
          <div className="context-menu-heading"><span>图片工具</span><kbd>Hotspot</kbd></div>
          <button type="button" className="hotspot-menu-action" onClick={requestHotspot}><MousePointer2 /><span><b>添加图片热点</b><small>在点击位置添加悬浮标注</small></span></button>
          <div
            className={`context-submenu-wrap ${archiveOpen ? "is-open" : ""}`}
            onPointerEnter={() => setArchiveOpen(true)}
            onPointerLeave={() => setArchiveOpen(false)}
          >
            <button
              type="button"
              className="hotspot-archive-trigger"
              aria-haspopup="menu"
              aria-expanded={archiveOpen}
              onClick={() => setArchiveOpen((open) => !open)}
            >
              <Archive /><span><b>热点存档</b><small>{targetNode.hotspots.length ? `${targetNode.hotspots.length} 个热点` : "暂无热点"}</small></span><ChevronRight className="context-submenu-arrow" />
            </button>
            <div className="context-submenu hotspot-archive-menu" role="menu" aria-label="热点存档">
              <div className="hotspot-archive-heading"><span>热点存档</span><small>{targetNode.hotspots.length} 项</small></div>
              {targetNode.hotspots.length ? targetNode.hotspots.map((hotspot) => {
                const editHotspot = () => openDialog({
                  kind: "hotspot",
                  nodeId: targetNode.id,
                  hotspotId: hotspot.id,
                  x: hotspot.x,
                  y: hotspot.y,
                  label: hotspot.label,
                  description: hotspot.description,
                  anchor: { x: point.screenX, y: point.screenY },
                });
                return (
                  <div className="hotspot-archive-row" key={hotspot.id}>
                    <i aria-hidden="true" />
                    <button type="button" className="hotspot-archive-name" title={hotspot.description || hotspot.label} onClick={editHotspot}>{hotspot.label}</button>
                    <div>
                      <button type="button" title="编辑热点" aria-label={`编辑${hotspot.label}`} onClick={editHotspot}><Pencil size={12} /></button>
                      <button type="button" className="is-danger" title="删除热点" aria-label={`删除${hotspot.label}`} onClick={(event) => {
                        event.stopPropagation();
                        removeImageHotspot(targetNode.id, hotspot.id);
                      }}><Trash2 size={12} /></button>
                    </div>
                  </div>
                );
              }) : <div className="hotspot-archive-empty"><MousePointer2 size={18} /><span>这张图片还没有热点</span></div>}
            </div>
          </div>
          <div className="context-separator" />
        </>
      ) : null}
      <div className="context-menu-heading"><span>添加到画布</span><kbd>右键</kbd></div>
      <button type="button" onClick={() => run(() => createNode("note", world))}><FileText /><span><b>笔记</b><small>Markdown · 点击打开编辑</small></span><kbd>N</kbd></button>
      <div className="context-sticky-row">
        <button type="button" onClick={() => run(() => createNode("sticky", world))}><StickyNote /><span><b>便签</b><small>Markdown · 直接编辑</small></span><kbd>S</kbd></button>
        <div className="sticky-swatches" aria-label="便签颜色">
          {STICKY_COLORS.map((color) => <button key={color.value} type="button" title={color.name} style={{ background: color.value }} onClick={() => run(() => createNode("sticky", world, { color: color.value }))} />)}
        </div>
      </div>
      <button type="button" onClick={() => openDialog({ kind: "folder", childIds: [...selectedIds], point: world, anchor: { x: point.screenX, y: point.screenY } })}><FolderPlus /><span><b>文件夹</b><small>{selectedIds.length ? `收纳已选 ${selectedIds.length} 项` : "聚焦展开 · 背景虚化"}</small></span><kbd>F</kbd></button>
      <button type="button" onClick={() => run(() => createNode("web", world))}><Globe2 /><span><b>网络卡片</b><small>网址、X 帖子与书签</small></span><kbd>W</kbd></button>

      <div className="context-separator" />
      <button type="button" onClick={() => run(() => importMedia("video", world))}><Video /><span><b>视频</b><small>MP4 / MOV / WebM / AVI / GIF</small></span></button>
      <button type="button" onClick={() => run(() => importMedia("image", world))}><ImagePlus /><span><b>图片</b><small>PNG / JPEG / HEIC / RAW 等</small></span></button>
      <button type="button" onClick={() => run(() => importMedia("document", world))}><FileIcon /><span><b>文档</b><small>Markdown / TXT / RTF / PDF</small></span></button>
      <button type="button" onClick={() => run(() => createNode("plugin", world, { pluginKind: "clock", title: "本地时间" }))}><Puzzle /><span><b>插件</b><small><Clock3 size={11} /> 时钟插件</small></span></button>
      <button type="button" onClick={() => run(paste)}><ClipboardPaste /><span><b>从剪贴板粘贴</b><small>网页 URL、X 链接或任意文字</small></span><kbd>⌘V</kbd></button>

      {selectedIds.length > 1 ? <><div className="context-separator" /><button type="button" onClick={() => run(stackSelected)}><Layers3 /><span><b>收纳成堆</b><small>将已选对象整齐堆叠</small></span></button></> : null}

      <div className="context-separator" />
      <div className="context-history-row">
        <button type="button" disabled={!historyPast.length} onClick={() => run(undo)}><Undo2 />撤销</button>
        <button type="button" disabled={!historyFuture.length} onClick={() => run(redo)}><Redo2 />恢复</button>
      </div>
    </div>
  );
}
