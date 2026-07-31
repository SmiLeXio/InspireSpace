import { gsap } from "gsap";
import {
  Clock3,
  ExternalLink,
  File as FileIcon,
  FileText,
  Folder,
  Globe2,
  Image as ImageIcon,
  Layers3,
  Play,
  StickyNote,
  Video,
  X,
} from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { resolveMediaUrl } from "../../lib/backend";
import { useCanvasStore } from "../../store/useCanvasStore";
import type { CanvasNode as CanvasNodeModel } from "../../types/canvas";
import { ClockPlugin } from "./ClockPlugin";
import { resizeFromCorner, type ResizeCorner } from "./resizeGeometry";

interface CanvasNodeProps {
  node: CanvasNodeModel;
  selected: boolean;
  singleSelection: boolean;
  workspaceRoot: string;
  childCount: number;
  stackCount: number;
  stackTop: boolean;
  dragEnabled: boolean;
  onDragModeUse: () => void;
}

type Corner = ResizeCorner;

const plainMarkdown = (markdown: string) => markdown
  .replace(/^#{1,6}\s+/gm, "")
  .replace(/\*\*(.*?)\*\*/g, "$1")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/^[-*>]\s+/gm, "• ")
  .replace(/\[(.*?)\]\(.*?\)/g, "$1")
  .trim();

const noteParts = (content: string) => {
  const lines = content.split("\n");
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return { heading: "空白便签", body: "" };
  return { heading: lines[first].trim(), body: lines.slice(first + 1).join("\n").trim() };
};

const typeMeta = {
  note: { label: "笔记", icon: FileText },
  sheet: { label: "笔记", icon: FileText },
  sticky: { label: "便签", icon: StickyNote },
  folder: { label: "文件夹", icon: Folder },
  web: { label: "网络卡片", icon: Globe2 },
  video: { label: "视频", icon: Video },
  image: { label: "图片", icon: ImageIcon },
  document: { label: "文档", icon: FileIcon },
  plugin: { label: "插件", icon: Clock3 },
} as const;

const blocksCardDrag = (node: CanvasNodeModel, target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  if (target.closest(".resize-handle, .image-hotspot, .stack-count, a")) return true;
  if (target.closest("input, textarea, iframe, video")) return true;
  return Boolean(target.closest("button")) && !["note", "sheet", "folder", "document"].includes(node.type);
};

const isAnimatedImage = (path: string) => /\.(gif|webp)(?:$|\?)/i.test(path);
const isPdf = (node: CanvasNodeModel) => /\.pdf$/i.test(node.mediaName || node.mediaPath || "") || node.content === "application/pdf";
const overlapRatio = (a: CanvasNodeModel, b: CanvasNodeModel) => {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (width * height) / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
};

function CanvasNodeComponent({
  node,
  selected,
  singleSelection,
  workspaceRoot,
  childCount,
  stackCount,
  stackTop,
  dragEnabled,
  onDragModeUse,
}: CanvasNodeProps) {
  const rootRef = useRef<HTMLElement>(null);
  const suppressClickRef = useRef(false);
  const interactionRef = useRef<"drag" | "resize" | null>(null);
  const [hoverCorner, setHoverCorner] = useState<Corner | null>(null);
  const [activeCorner, setActiveCorner] = useState<Corner | null>(null);
  const selectOnly = useCanvasStore((state) => state.selectOnly);
  const toggleSelection = useCanvasStore((state) => state.toggleSelection);
  const openEditor = useCanvasStore((state) => state.openEditor);
  const openFolder = useCanvasStore((state) => state.openFolder);
  const updateNode = useCanvasStore((state) => state.updateNode);
  const finishDrag = useCanvasStore((state) => state.finishDrag);
  const previewNodes = useCanvasStore((state) => state.previewNodes);
  const commitLayout = useCanvasStore((state) => state.commitLayout);
  const unstack = useCanvasStore((state) => state.unstack);
  const removeImageHotspot = useCanvasStore((state) => state.removeImageHotspot);
  const mediaUrl = useMemo(() => resolveMediaUrl(workspaceRoot, node.mediaPath), [node.mediaPath, workspaceRoot]);
  const sticky = useMemo(() => noteParts(node.content), [node.content]);
  const meta = typeMeta[node.type];
  const Icon = meta.icon;

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(rootRef.current, { opacity: 0, y: 14, scale: 0.975 }, {
        opacity: 1, y: 0, scale: 1, duration: 0.38, ease: "power3.out", clearProps: "transform",
      });
    }, rootRef);
    return () => ctx.revert();
  }, [node.id]);

  const handleSelection = (event: React.PointerEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) toggleSelection(node.id);
    else if (!selected) selectOnly(node.id);
  };

  const beginDrag = (event: React.PointerEvent) => {
    if (!dragEnabled || event.button !== 0 || interactionRef.current || blocksCardDrag(node, event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = "drag";
    onDragModeUse();
    handleSelection(event);

    const sourceElement = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;
    try { sourceElement.setPointerCapture(pointerId); } catch { /* Pointer capture may be unavailable in tests. */ }

    const state = useCanvasStore.getState();
    let movingIds = state.selectedIds.includes(node.id) ? state.selectedIds : [node.id];
    if (node.stackId && stackTop && movingIds.length === 1) {
      movingIds = state.nodes.filter((item) => item.stackId === node.stackId).map((item) => item.id);
      state.selectMany(movingIds);
    }
    const movingSet = new Set(movingIds);
    const before = state.nodes.map((item) => ({ ...item, hotspots: [...item.hotspots] }));
    const origins = new Map(state.nodes.filter((item) => movingSet.has(item.id)).map((item) => [item.id, { x: item.x, y: item.y }]));
    const elements = movingIds.map((id) => document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)).filter(Boolean) as HTMLElement[];
    const scale = state.viewport.scale;
    const start = { x: event.clientX, y: event.clientY };
    let last = { dx: 0, dy: 0 };
    let moved = false;
    let frame = 0;
    let dropTarget: CanvasNodeModel | undefined;
    let highlighted: HTMLElement | null = null;

    elements.forEach((element) => element.classList.add("is-dragging"));

    const paint = () => {
      frame = 0;
      // 不再使用 transform 合成层拖动。WebView 在快速松手时可能短暂恢复旧合成层，
      // 因此直接更新绝对定位，让拖动预览和最终落点始终使用同一组 left/top。
      elements.forEach((element) => {
        const origin = origins.get(element.dataset.nodeId || "");
        if (!origin) return;
        element.style.left = `${origin.x + last.dx / scale}px`;
        element.style.top = `${origin.y + last.dy / scale}px`;
      });
    };
    const setDropTarget = (target?: CanvasNodeModel) => {
      if (dropTarget?.id === target?.id) return;
      highlighted?.classList.remove("is-drop-target", "is-folder-target");
      dropTarget = target;
      highlighted = target ? document.querySelector<HTMLElement>(`[data-node-id="${target.id}"]`) : null;
      highlighted?.classList.add("is-drop-target", "is-folder-target");
    };
    const updateDropTarget = () => {
      if (!moved || movingIds.length !== 1) return;
      const origin = state.nodes.find((item) => item.id === node.id)!;
      const candidateNode = { ...origin, x: origin.x + last.dx / scale, y: origin.y + last.dy / scale };
      const candidates = state.nodes
        .filter((item) => item.type === "folder" && !movingSet.has(item.id) && !item.parentId)
        .filter((item) => overlapRatio(candidateNode, item) > 0.18)
        .sort((a, b) => a.zIndex - b.zIndex);
      setDropTarget(candidates.at(-1));
    };
    const updatePointer = (pointerEvent: PointerEvent) => {
      last = { dx: pointerEvent.clientX - start.x, dy: pointerEvent.clientY - start.y };
      if (Math.abs(last.dx) + Math.abs(last.dy) > 4) moved = true;
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      updatePointer(moveEvent);
      if (moved && !frame) frame = requestAnimationFrame(paint);
      updateDropTarget();
    };
    const finish = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      if (endEvent.type === "pointerup") {
        // pointerup 往往比最后一个 pointermove 更接近真实落点，快速甩动时必须采用它。
        updatePointer(endEvent);
        updateDropTarget();
      }

      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      try {
        if (sourceElement.hasPointerCapture(pointerId)) sourceElement.releasePointerCapture(pointerId);
      } catch { /* The pointer may already have been released. */ }
      interactionRef.current = null;
      highlighted?.classList.remove("is-drop-target", "is-folder-target");

      if (moved) {
        const patches = movingIds.map((id) => {
          const origin = origins.get(id)!;
          return { id, patch: { x: origin.x + last.dx / scale, y: origin.y + last.dy / scale } };
        });

        suppressClickRef.current = true;
        // pointerup 直接补绘最终 left/top；随后 React 只会写入完全相同的坐标。
        // 整个生命周期不存在 transform 清除，也不存在可回到原位的中间状态。
        paint();
        elements.forEach((element) => { void element.getBoundingClientRect(); });
        flushSync(() => finishDrag(before, patches, dropTarget?.id));
        // React 提交完成后再覆盖一次相同的最终坐标，防止任何同步重渲染把手工预览写回旧值。
        paint();
        elements.forEach((element) => { void element.getBoundingClientRect(); });

        // 保留拖动态两帧，让 WebView 完成最终位置的栅格化后再降层，避免旧图层短暂重现。
        requestAnimationFrame(() => requestAnimationFrame(() => {
          elements.forEach((element) => element.classList.remove("is-dragging"));
          suppressClickRef.current = false;
        }));
      } else {
        elements.forEach((element) => element.classList.remove("is-dragging"));
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const beginResize = (corner: Corner, event: React.PointerEvent) => {
    if (event.button !== 0 || interactionRef.current || !rootRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    interactionRef.current = "resize";
    const handle = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;
    try { handle.setPointerCapture(pointerId); } catch { /* Pointer capture may be unavailable in tests. */ }
    selectOnly(node.id);
    setActiveCorner(corner);
    const element = rootRef.current;
    const state = useCanvasStore.getState();
    const before = state.nodes.map((item) => ({ ...item, hotspots: [...item.hotspots] }));
    const scale = state.viewport.scale;
    const start = { x: event.clientX, y: event.clientY };
    const origin = { x: node.x, y: node.y, width: node.width, height: node.height };
    let latest = origin;
    let frame = 0;
    element.classList.add("is-resizing");

    const calculate = (pointerEvent: PointerEvent) => resizeFromCorner(
      origin,
      corner,
      {
        x: (pointerEvent.clientX - start.x) / scale,
        y: (pointerEvent.clientY - start.y) / scale,
      },
      { lockAspectRatio: pointerEvent.ctrlKey || pointerEvent.metaKey },
    );
    const paint = () => {
      frame = 0;
      element.style.left = `${latest.x}px`;
      element.style.top = `${latest.y}px`;
      element.style.width = `${latest.width}px`;
      element.style.height = `${latest.height}px`;
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      latest = calculate(moveEvent);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const finish = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      if (endEvent.type === "pointerup") latest = calculate(endEvent);

      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch { /* The pointer may already have been released. */ }
      interactionRef.current = null;

      // 先把最终几何写进 DOM，再同步提交 Store。四角始终由固定对角点反推 x/y，
      // 且不清空 React 管理的 left/top/width/height，避免右下角回到旧中心点。
      element.style.left = `${latest.x}px`;
      element.style.top = `${latest.y}px`;
      element.style.width = `${latest.width}px`;
      element.style.height = `${latest.height}px`;
      void element.getBoundingClientRect();
      flushSync(() => previewNodes([{ id: node.id, patch: latest }]));
      commitLayout(before);
      element.classList.remove("is-resizing");
      setActiveCorner(null);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  const detectCorner = (event: React.PointerEvent) => {
    if (!selected || !singleSelection || activeCorner || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const threshold = 42;
    const left = event.clientX - rect.left < threshold;
    const right = rect.right - event.clientX < threshold;
    const top = event.clientY - rect.top < threshold;
    const bottom = rect.bottom - event.clientY < threshold;
    const corner = top && left ? "top-left" : top && right ? "top-right" : bottom && left ? "bottom-left" : bottom && right ? "bottom-right" : null;
    setHoverCorner(corner);
  };

  const openPrimary = () => {
    if (node.type === "folder") openFolder(node.id);
    else if (["note", "sheet", "document"].includes(node.type)) openEditor(node.id);
  };

  const cardStyle = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    zIndex: node.zIndex,
    "--node-paper": node.color || "#fbfbfa",
    "--stack-rotation": node.stackId ? `${((node.zIndex % 5) - 2) * 0.7}deg` : "0deg",
  } as React.CSSProperties;

  const visibleCorner = activeCorner || hoverCorner;

  return (
    <article
      ref={rootRef}
      className={`canvas-node node-${node.type} ${selected ? "is-selected" : ""} ${node.stackId ? "is-stacked" : ""} ${dragEnabled ? "is-drag-enabled" : ""}`}
      style={cardStyle}
      data-node-id={node.id}
      onPointerDown={(event) => {
        if ((event.target as Element).closest(".resize-handle")) return;
        if (!dragEnabled) {
          if (event.button === 0) handleSelection(event);
          return;
        }
        beginDrag(event);
      }}
      onPointerMove={detectCorner}
      onPointerLeave={() => { if (!activeCorner) setHoverCorner(null); }}
      onClickCapture={(event) => { if (suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); } }}
      onContextMenu={() => { if (!selected) selectOnly(node.id); }}
    >
      <div className="node-card-tilt">
        <header className="node-drag-area">
          <span><Icon size={13} strokeWidth={1.8} />{meta.label}</span>
          {node.stackId && stackTop && stackCount > 1 ? (
            <button className="stack-count" type="button" onClick={() => unstack(node.stackId!)} title="展开这一堆">
              <Layers3 size={12} /> {stackCount}
            </button>
          ) : null}
        </header>

        <div className="node-content">
          {node.type === "sticky" ? <textarea className="sticky-direct-editor" value={node.content} onChange={(event) => updateNode(node.id, { content: event.target.value })} placeholder="直接输入便签内容…" spellCheck style={{ color: node.color === "#252726" ? "#f7f7f4" : "#1d201f" }} /> : null}
          {node.type === "note" || node.type === "sheet" ? <button className="note-preview" type="button" onClick={openPrimary}><strong>{node.title || "未命名笔记"}</strong><span>{plainMarkdown(node.content) || "点击打开并开始编辑"}</span><em>点击打开</em></button> : null}
          {node.type === "folder" ? <button className="folder-preview" type="button" onClick={openPrimary}><div className="folder-tab" /><div className="folder-sheet one" /><div className="folder-sheet two" /><div className="folder-front"><strong>{node.title || "新建文件夹"}</strong><span>{childCount ? `${childCount} 个项目` : "空文件夹"}</span></div></button> : null}
          {node.type === "web" ? <div className="web-card"><div className="web-url-row"><Globe2 size={15} /><input value={node.url || ""} onChange={(event) => updateNode(node.id, { url: event.target.value })} placeholder="输入网址，例如 https://example.com" autoFocus={!node.url} />{node.url ? <button type="button" onClick={() => window.open(node.url!, "_blank")} title="在浏览器打开"><ExternalLink size={14} /></button> : null}</div>{node.url ? <div className="web-embed-wrap"><iframe src={node.url} title={node.title || "网页预览"} sandbox="allow-forms allow-scripts allow-same-origin allow-popups" /><div className="web-embed-fallback"><Globe2 size={28} /><span>{node.url}</span></div></div> : <div className="web-empty"><Globe2 size={30} /><span>输入地址后自动渲染网页</span></div>}</div> : null}
          {node.type === "image" ? <div className="media-card image-card"><div className="image-visual">{mediaUrl ? <img src={mediaUrl} alt={node.title || "图片"} draggable={false} /> : <div className="media-empty"><ImageIcon size={30} /><span>等待图片</span></div>}{node.hotspots.map((hotspot, index) => <div key={hotspot.id} className="image-hotspot" style={{ left: `${hotspot.x * 100}%`, top: `${hotspot.y * 100}%` }} tabIndex={0} onPointerDown={(event) => event.stopPropagation()}><i><b>{index + 1}</b></i><span><strong>{hotspot.label}</strong>{hotspot.description ? <small>{hotspot.description}</small> : null}<button type="button" title="删除热点" onClick={() => removeImageHotspot(node.id, hotspot.id)}><X size={11} /></button></span></div>)}</div><span>{node.mediaName || node.title}</span></div> : null}
          {node.type === "video" ? <div className="media-card video-card">{mediaUrl ? (isAnimatedImage(mediaUrl) ? <img src={mediaUrl} alt={node.title || "动态图片"} draggable={false} /> : <video src={mediaUrl} controls preload="metadata" playsInline />) : <div className="media-empty"><Play size={30} /><span>等待视频</span></div>}<span>{node.mediaName || node.title}</span></div> : null}
          {node.type === "document" ? <button className="document-preview" type="button" onClick={openPrimary}>{isPdf(node) && mediaUrl ? <object data={mediaUrl} type="application/pdf"><FileText size={34} /></object> : <><FileText size={34} /><strong>{node.title || "文档"}</strong><p>{plainMarkdown(node.content).slice(0, 260) || node.mediaName || "点击查看文档"}</p></>}<em>点击打开</em></button> : null}
          {node.type === "plugin" && node.pluginKind === "clock" ? <ClockPlugin /> : null}
        </div>
      </div>

      {selected && singleSelection && visibleCorner ? (
        <button
          className={`resize-handle ${visibleCorner} is-visible`}
          type="button"
          aria-label={`从${visibleCorner}缩放`}
          onPointerDownCapture={(event) => beginResize(visibleCorner, event)}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4 Q11.5 7.6 16 12 Q11.5 16.4 7 20" />
          </svg>
        </button>
      ) : null}
    </article>
  );
}

export const CanvasNode = memo(CanvasNodeComponent);






