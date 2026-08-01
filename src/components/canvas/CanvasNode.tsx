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
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { resolveMediaUrl } from "../../lib/backend";
import { useCanvasStore } from "../../store/useCanvasStore";
import type { CanvasNode as CanvasNodeModel } from "../../types/canvas";
import { ClockPlugin } from "./ClockPlugin";
import { folderIconFor } from "./folderOptions";
import { resizeFromCorner, type ResizeCorner } from "./resizeGeometry";
import { exceededPointerDragThreshold } from "./pointerIntent";
import { pointInStackBounds, type StackBounds } from "./stackGeometry";

interface CanvasNodeProps {
  node: CanvasNodeModel;
  selected: boolean;
  singleSelection: boolean;
  workspaceRoot: string;
  childCount: number;
  stackCount: number;
  stackTop: boolean;
  stackExpanded: boolean;
  stackDepth?: number;
  focusMuted?: boolean;
  temporaryOffset?: { x: number; y: number };
  stackBounds?: StackBounds;
  stackDelay?: number;
  stackColumns?: number;
  stackDragActive?: boolean;
  dragEnabled: boolean;
  onDragModeUse: () => void;
  onRequestExpand?: (stackId: string) => void;
  onRequestCollapse?: (stackId: string) => void;
  onStackDragActivity?: (active: boolean, nodeId: string) => void;
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

const blocksCardDrag = (node: CanvasNodeModel, event: React.PointerEvent) => {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  const stickyEditor = target.closest<HTMLTextAreaElement>(".sticky-direct-editor");
  if (node.type === "sticky" && stickyEditor) {
    return document.activeElement === stickyEditor;
  }

  const video = target.closest<HTMLVideoElement>("video");
  if (node.type === "video" && video) {
    const rect = video.getBoundingClientRect();
    const controlStripHeight = Math.min(48, Math.max(40, rect.height * 0.18));
    return event.clientY >= rect.bottom - controlStripHeight;
  }

  return Boolean(target.closest(
    "input, textarea, select, option, a, iframe, audio, [contenteditable='true'], [data-no-card-drag='true'], .resize-handle, .image-hotspot, .stack-count",
  ));
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
  stackExpanded,
  stackDepth: stackVisualDepth = 0,
  focusMuted = false,
  temporaryOffset = { x: 0, y: 0 },
  stackBounds,
  stackDelay = 0,
  stackColumns = 1,
  stackDragActive = false,
  dragEnabled,
  onDragModeUse,
  onRequestExpand,
  onRequestCollapse,
  onStackDragActivity,
}: CanvasNodeProps) {
  const rootRef = useRef<HTMLElement>(null);
  const suppressClickRef = useRef(false);
  const interactionRef = useRef<"pressed" | "drag" | "resize" | null>(null);
  const [hoverCorner, setHoverCorner] = useState<Corner | null>(null);
  const [activeCorner, setActiveCorner] = useState<Corner | null>(null);
  const [webInteractionActive, setWebInteractionActive] = useState(false);
  const selectOnly = useCanvasStore((state) => state.selectOnly);
  const selectMany = useCanvasStore((state) => state.selectMany);
  const toggleSelection = useCanvasStore((state) => state.toggleSelection);
  const openEditor = useCanvasStore((state) => state.openEditor);
  const openFolder = useCanvasStore((state) => state.openFolder);
  const updateNode = useCanvasStore((state) => state.updateNode);
  const finishDrag = useCanvasStore((state) => state.finishDrag);
  const previewNodes = useCanvasStore((state) => state.previewNodes);
  const commitLayout = useCanvasStore((state) => state.commitLayout);

  const removeImageHotspot = useCanvasStore((state) => state.removeImageHotspot);
  const mediaUrl = useMemo(() => resolveMediaUrl(workspaceRoot, node.mediaPath), [node.mediaPath, workspaceRoot]);
  const sticky = useMemo(() => noteParts(node.content), [node.content]);
  const meta = typeMeta[node.type];
  const Icon = meta.icon;
  const FolderGlyph = folderIconFor(node.folderIcon);

  useEffect(() => {
    if (!selected) setWebInteractionActive(false);
  }, [selected]);

  useEffect(() => {
    if (!webInteractionActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWebInteractionActive(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [webInteractionActive]);

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
    if (node.stackId && stackTop && !stackExpanded) {
      const stackIds = useCanvasStore.getState().nodes
        .filter((item) => item.stackId === node.stackId)
        .map((item) => item.id);
      selectMany(stackIds, event.ctrlKey || event.metaKey || event.shiftKey);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) toggleSelection(node.id);
    else if (!selected) selectOnly(node.id);
  };

  const beginDrag = (event: React.PointerEvent) => {
    if (!dragEnabled || event.button !== 0 || interactionRef.current || blocksCardDrag(node, event)) return;
    event.stopPropagation();
    interactionRef.current = "pressed";
    handleSelection(event);

    const sourceElement = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;

    const state = useCanvasStore.getState();
    let movingIds = state.selectedIds.includes(node.id) ? state.selectedIds : [node.id];
    if (node.stackId && stackTop && !stackExpanded) {
      movingIds = state.nodes.filter((item) => item.stackId === node.stackId).map((item) => item.id);
      state.selectMany(movingIds);
    } else if (stackExpanded) {
      movingIds = [node.id];
    }
    const extracting = Boolean(stackExpanded && node.stackId);
    const movingSet = new Set(movingIds);
    const before = state.nodes.map((item) => ({ ...item, hotspots: [...item.hotspots] }));
    const storedOrigins = new Map(state.nodes.filter((item) => movingSet.has(item.id)).map((item) => [item.id, { x: item.x, y: item.y }]));
    const elements = movingIds.map((id) => document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)).filter(Boolean) as HTMLElement[];
    const visualOrigins = new Map(elements.map((element) => {
      const id = element.dataset.nodeId || "";
      const stored = storedOrigins.get(id) ?? { x: 0, y: 0 };
      return [id, {
        x: Number.isFinite(Number.parseFloat(element.style.left)) ? Number.parseFloat(element.style.left) : stored.x,
        y: Number.isFinite(Number.parseFloat(element.style.top)) ? Number.parseFloat(element.style.top) : stored.y,
      }];
    }));
    const scale = state.viewport.scale;
    const start = { x: event.clientX, y: event.clientY };
    let last = { dx: 0, dy: 0 };
    let moved = false;
    let dragStarted = false;
    let frame = 0;
    let dropTarget: CanvasNodeModel | undefined;
    let candidateTarget: CanvasNodeModel | undefined;
    let highlighted: HTMLElement | null = null;
    let activateTimer: ReturnType<typeof setTimeout> | undefined;
    let deactivateTimer: ReturnType<typeof setTimeout> | undefined;

    const activateDrag = () => {
      if (dragStarted) return;
      dragStarted = true;
      interactionRef.current = "drag";
      try { sourceElement.setPointerCapture(pointerId); } catch { /* Pointer capture may be unavailable in tests. */ }
      onDragModeUse();
      onStackDragActivity?.(true, node.id);
      elements.forEach((element) => element.classList.add("is-dragging"));
    };

    const paint = () => {
      frame = 0;
      elements.forEach((element) => {
        const origin = visualOrigins.get(element.dataset.nodeId || "");
        if (!origin) return;
        element.style.left = `${origin.x + last.dx / scale}px`;
        element.style.top = `${origin.y + last.dy / scale}px`;
      });
    };
    const setDropTarget = (target?: CanvasNodeModel) => {
      if (dropTarget?.id === target?.id) return;
      highlighted?.classList.remove("is-drop-target", "is-folder-target", "is-stack-target");
      dropTarget = target;
      highlighted = target ? document.querySelector<HTMLElement>(`[data-node-id="${target.id}"]`) : null;
      if (highlighted && target) {
        highlighted.classList.add("is-drop-target", target.type === "folder" ? "is-folder-target" : "is-stack-target");
      }
    };
    const pointerWorld = (pointerEvent: PointerEvent) => {
      const rect = document.querySelector<HTMLElement>(".canvas-surface")?.getBoundingClientRect();
      return {
        x: (pointerEvent.clientX - (rect?.left ?? 0) - state.viewport.x) / scale,
        y: (pointerEvent.clientY - (rect?.top ?? 0) - state.viewport.y) / scale,
      };
    };
    const updateDropTarget = (pointerEvent: PointerEvent) => {
      if (!moved || movingIds.length !== 1) return;
      const origin = visualOrigins.get(node.id) ?? { x: node.x, y: node.y };
      const candidateNode = { ...node, x: origin.x + last.dx / scale, y: origin.y + last.dy / scale };
      const pointer = pointerWorld(pointerEvent);
      const candidates = state.nodes
        .filter((item) => !movingSet.has(item.id) && !item.parentId && item.id !== state.editingId)
        .filter((item) => {
          if (extracting && item.type !== "folder") return false;
          if (item.stackId) {
            const top = state.nodes
              .filter((member) => member.stackId === item.stackId)
              .sort((a, b) => (a.stackOrder ?? a.zIndex) - (b.stackOrder ?? b.zIndex))
              .at(-1);
            if (top?.id !== item.id) return false;
          }
          const overlap = overlapRatio(candidateNode, item);
          const central = pointer.x >= item.x + item.width * 0.2
            && pointer.x <= item.x + item.width * 0.8
            && pointer.y >= item.y + item.height * 0.2
            && pointer.y <= item.y + item.height * 0.8;
          return overlap >= 0.2 || central;
        })
        .sort((a, b) => {
          const folderPriority = Number(b.type === "folder") - Number(a.type === "folder");
          if (folderPriority) return folderPriority;
          const pointerInA = Number(pointer.x >= a.x && pointer.x <= a.x + a.width && pointer.y >= a.y && pointer.y <= a.y + a.height);
          const pointerInB = Number(pointer.x >= b.x && pointer.x <= b.x + b.width && pointer.y >= b.y && pointer.y <= b.y + b.height);
          if (pointerInA !== pointerInB) return pointerInB - pointerInA;
          const overlapDifference = overlapRatio(candidateNode, b) - overlapRatio(candidateNode, a);
          return Math.abs(overlapDifference) > 0.001 ? overlapDifference : b.zIndex - a.zIndex;
        });
      const next = candidates[0];
      if (next?.id === dropTarget?.id) {
        if (deactivateTimer) clearTimeout(deactivateTimer);
        deactivateTimer = undefined;
        return;
      }
      if (next?.id === candidateTarget?.id) return;
      candidateTarget = next;
      if (activateTimer) clearTimeout(activateTimer);
      if (deactivateTimer) clearTimeout(deactivateTimer);
      if (next) {
        activateTimer = setTimeout(() => {
          if (candidateTarget?.id === next.id) setDropTarget(next);
        }, 100);
      } else if (dropTarget) {
        deactivateTimer = setTimeout(() => setDropTarget(undefined), 80);
      } else {
        setDropTarget(undefined);
      }
    };
    const updatePointer = (pointerEvent: PointerEvent) => {
      last = { dx: pointerEvent.clientX - start.x, dy: pointerEvent.clientY - start.y };
      if (exceededPointerDragThreshold({ x: 0, y: 0 }, { x: last.dx, y: last.dy })) moved = true;
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      updatePointer(moveEvent);
      if (!moved) return;
      activateDrag();
      moveEvent.preventDefault();
      if (!frame) frame = requestAnimationFrame(paint);
      updateDropTarget(moveEvent);
    };
    const finish = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      if (endEvent.type === "pointerup") {
        updatePointer(endEvent);
        updateDropTarget(endEvent);
      }

      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", onKeyDown, true);
      if (activateTimer) clearTimeout(activateTimer);
      if (deactivateTimer) clearTimeout(deactivateTimer);
      if (frame) cancelAnimationFrame(frame);
      try {
        if (sourceElement.hasPointerCapture(pointerId)) sourceElement.releasePointerCapture(pointerId);
      } catch { /* The pointer may already have been released. */ }
      interactionRef.current = null;
      highlighted?.classList.remove("is-drop-target", "is-folder-target", "is-stack-target");
      if (!dragStarted) return;
      const cancelled = endEvent.type === "pointercancel";
      const cancelExtraction = !cancelled && extracting && stackBounds && pointInStackBounds(pointerWorld(endEvent), stackBounds);
      if (cancelled || cancelExtraction) {
        elements.forEach((element) => {
          const origin = visualOrigins.get(element.dataset.nodeId || "");
          if (!origin) return;
          gsap.to(element, {
            left: origin.x,
            top: origin.y,
            duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.08 : 0.22,
            ease: "power3.out",
            onComplete: () => element.classList.remove("is-dragging"),
          });
        });
        onStackDragActivity?.(false, node.id);
        return;
      }

      if (moved) {
        paint();
        const releaseRects = new Map(elements.map((element) => [element.dataset.nodeId || "", element.getBoundingClientRect()]));
        const patches = movingIds.map((id) => {
          const origin = visualOrigins.get(id)!;
          return { id, patch: { x: origin.x + last.dx / scale, y: origin.y + last.dy / scale } };
        });
        suppressClickRef.current = true;
        flushSync(() => finishDrag(before, patches, dropTarget?.id));

        elements.forEach((element) => {
          const previous = releaseRects.get(element.dataset.nodeId || "");
          if (!document.body.contains(element) || !previous) return;
          const current = element.getBoundingClientRect();
          const dx = previous.left - current.left;
          const dy = previous.top - current.top;
          if (Math.abs(dx) + Math.abs(dy) > 1) {
            gsap.fromTo(element, { x: dx, y: dy }, {
              x: 0,
              y: 0,
              duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.09 : 0.28,
              ease: "power3.inOut",
              clearProps: "transform",
            });
          }
        });

        requestAnimationFrame(() => requestAnimationFrame(() => {
          elements.forEach((element) => element.classList.remove("is-dragging"));
          suppressClickRef.current = false;
        }));
      } else {
        elements.forEach((element) => element.classList.remove("is-dragging"));
      }
      onStackDragActivity?.(false, node.id);
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopImmediatePropagation();
      finish({ pointerId, type: "pointercancel" } as PointerEvent);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", onKeyDown, true);
  };

  const beginResize = (corner: Corner, event: React.PointerEvent) => {
    if (stackExpanded || event.button !== 0 || interactionRef.current || !rootRef.current) return;
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
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  const detectCorner = (event: React.PointerEvent) => {
    if (stackExpanded || !selected || !singleSelection || activeCorner || !rootRef.current) return;
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
    if (stackExpanded && node.stackId) onRequestCollapse?.(node.stackId);
    if (node.type === "folder") openFolder(node.id);
    else if (["note", "sheet", "document"].includes(node.type)) openEditor(node.id);
  };

  const compactStackTop = Boolean(node.stackId && stackTop && !stackExpanded);
  const compactUnderlay = Boolean(node.stackId && !stackTop && !stackExpanded);
  const stackLabel = compactStackTop
    ? `${node.stackTitle || "未命名堆叠"}，${stackCount} 个项目，已收拢`
    : undefined;

  const requestExpansion = () => {
    if (node.stackId && compactStackTop) onRequestExpand?.(node.stackId);
  };

  const handleStackKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (compactStackTop && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      requestExpansion();
      return;
    }
    if (!stackExpanded || !node.stackId || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const order = node.stackOrder ?? 0;
    const delta = event.key === "ArrowLeft" ? -1
      : event.key === "ArrowRight" ? 1
        : event.key === "ArrowUp" ? -stackColumns
          : stackColumns;
    const nextOrder = Math.max(0, Math.min(stackCount - 1, order + delta));
    document.querySelector<HTMLElement>(`[data-stack-id="${node.stackId}"][data-stack-index="${nextOrder}"]`)?.focus();
  };

  const cardStyle = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    zIndex: node.zIndex,
    transform: `translate3d(calc(${temporaryOffset.x}px + ${stackDragActive ? "var(--active-stack-drag-x, 0px)" : "0px"}), calc(${temporaryOffset.y}px + ${stackDragActive ? "var(--active-stack-drag-y, 0px)" : "0px"}), 0)`,
    "--node-paper": node.color || "#fbfbfa",
    "--folder-color": node.color || "#d7c7a5",
    "--stack-rotation": node.stackId && !stackExpanded ? `${((node.zIndex % 5) - 2) * 0.7}deg` : "0deg",
    "--stack-delay": `${stackDelay}ms`,
    "--stack-depth": stackVisualDepth,
  } as React.CSSProperties;

  const visibleCorner = activeCorner || hoverCorner;

  return (
    <article
      ref={rootRef}
      className={`canvas-node node-${node.type} ${selected ? "is-selected" : ""} ${node.stackId ? "is-stacked" : ""} ${compactStackTop ? "is-stack-top" : ""} ${compactUnderlay ? "is-stack-underlay" : ""} ${stackExpanded ? "is-stack-expanded" : ""} ${focusMuted ? "is-focus-muted" : ""} ${temporaryOffset.x || temporaryOffset.y ? "is-focus-shifted" : ""} ${stackDragActive ? "is-stack-drag-active" : ""} ${dragEnabled ? "is-drag-enabled" : ""}`}
      style={cardStyle}
      data-node-id={node.id}
      data-stack-id={node.stackId || undefined}
      data-stack-index={node.stackOrder ?? undefined}
      data-stack-control={compactStackTop ? "true" : undefined}
      tabIndex={compactStackTop || stackExpanded ? 0 : undefined}
      role={compactStackTop ? "group" : undefined}
      aria-label={stackLabel}
      aria-hidden={compactUnderlay ? true : undefined}
      onPointerDown={(event) => {
        if ((event.target as Element).closest(".resize-handle")) return;
        if (!dragEnabled) return;
        beginDrag(event);
      }}
      onPointerMove={detectCorner}
      onPointerLeave={() => {
        if (!activeCorner) setHoverCorner(null);
      }}
      onKeyDown={handleStackKeyDown}
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (compactStackTop) {
          event.preventDefault();
          event.stopPropagation();
          requestExpansion();
        }
      }}
      onContextMenu={() => { if (!selected) selectOnly(node.id); }}
    >
      <div className="node-card-tilt">
        <header className="node-drag-area">
          <span><Icon size={13} strokeWidth={1.8} />{meta.label}</span>
          {compactStackTop && stackCount > 1 ? (
            <button
              className="stack-count"
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                requestExpansion();
              }}
              title="展开这一堆"
              aria-label={`展开${node.stackTitle || "未命名堆叠"}，共 ${stackCount} 个项目`}
            >
              <Layers3 size={12} /> {stackCount}
            </button>
          ) : null}
        </header>

        <div className="node-content">
          {node.type === "sticky" ? <textarea className="sticky-direct-editor" value={node.content} onChange={(event) => updateNode(node.id, { content: event.target.value })} placeholder="直接输入便签内容…" spellCheck style={{ color: node.color === "#252726" ? "#f7f7f4" : "#1d201f" }} /> : null}
          {node.type === "note" || node.type === "sheet" ? <button className="note-preview" type="button" data-card-primary="true" onClick={openPrimary}><strong>{node.title || "未命名笔记"}</strong><span>{plainMarkdown(node.content) || "点击打开并开始编辑"}</span><em>点击打开</em></button> : null}
          {node.type === "folder" ? <button className={`folder-preview ${childCount ? "has-children" : "is-empty"}`} type="button" data-card-primary="true" onClick={openPrimary}><div className="folder-tab" />{childCount ? <><div className="folder-sheet one" /><div className="folder-sheet two" /></> : null}<div className="folder-front"><FolderGlyph className="folder-glyph" size={26} strokeWidth={1.65} /><strong>{node.title || "新建文件夹"}</strong><span>{childCount ? `${childCount} 个项目` : "空文件夹"}</span></div></button> : null}
          {node.type === "web" ? (
            <div className={`web-card ${webInteractionActive ? "is-interacting" : ""}`}>
              <div className="web-url-row">
                <Globe2 size={15} />
                <input value={node.url || ""} onChange={(event) => updateNode(node.id, { url: event.target.value })} placeholder="输入网址，例如 https://example.com" autoFocus={!node.url} />
                {node.url ? <button type="button" data-no-card-drag="true" onClick={() => window.open(node.url!, "_blank")} title="在浏览器打开"><ExternalLink size={14} /></button> : null}
              </div>
              {node.url ? (
                <div className="web-embed-wrap">
                  <iframe src={node.url} title={node.title || "网页预览"} sandbox="allow-forms allow-scripts allow-same-origin allow-popups" />
                  <div className="web-embed-fallback"><Globe2 size={28} /><span>{node.url}</span></div>
                  <button
                    type="button"
                    className="web-interaction-shield"
                    aria-label="单击与网页交互，拖动可移动卡片"
                    onClick={(event) => {
                      event.stopPropagation();
                      setWebInteractionActive(true);
                    }}
                  >
                    <span>单击交互 · 拖动卡片</span>
                  </button>
                </div>
              ) : <div className="web-empty"><Globe2 size={30} /><span>输入地址后自动渲染网页</span></div>}
            </div>
          ) : null}
          {node.type === "image" ? (
            <div className={`media-card image-card ${node.hotspots.length ? "has-hotspots" : ""}`}>
              <div className="image-visual">
                {mediaUrl ? <img src={mediaUrl} alt={node.title || "图片"} draggable={false} /> : <div className="media-empty"><ImageIcon size={30} /><span>等待图片</span></div>}
                {node.hotspots.map((hotspot) => {
                  const positionClass = [
                    hotspot.y < 0.24 ? "is-tooltip-below" : "",
                    hotspot.x < 0.28 ? "is-tooltip-left" : hotspot.x > 0.72 ? "is-tooltip-right" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <div key={hotspot.id} className={`image-hotspot ${positionClass}`} style={{ left: `${hotspot.x * 100}%`, top: `${hotspot.y * 100}%` }} tabIndex={0} onPointerDown={(event) => event.stopPropagation()}>
                      <i aria-hidden="true" />
                      <span><strong>{hotspot.label}</strong>{hotspot.description ? <small>{hotspot.description}</small> : null}</span>
                    </div>
                  );
                })}
              </div>
              <span>{node.mediaName || node.title}</span>
            </div>
          ) : null}
          {node.type === "video" ? <div className="media-card video-card">{mediaUrl ? (isAnimatedImage(mediaUrl) ? <img src={mediaUrl} alt={node.title || "动态图片"} draggable={false} /> : <video src={mediaUrl} controls preload="metadata" playsInline />) : <div className="media-empty"><Play size={30} /><span>等待视频</span></div>}<span>{node.mediaName || node.title}</span></div> : null}
          {node.type === "document" ? <button className="document-preview" type="button" data-card-primary="true" onClick={openPrimary}>{isPdf(node) && mediaUrl ? <object data={mediaUrl} type="application/pdf"><FileText size={34} /></object> : <><FileText size={34} /><strong>{node.title || "文档"}</strong><p>{plainMarkdown(node.content).slice(0, 260) || node.mediaName || "点击查看文档"}</p></>}<em>点击打开</em></button> : null}
          {node.type === "plugin" && node.pluginKind === "clock" ? <ClockPlugin /> : null}
        </div>
      </div>

      {selected && singleSelection && !stackExpanded && visibleCorner ? (
        <button
          className={`resize-handle ${visibleCorner} is-visible`}
          type="button"
          aria-label={`从${visibleCorner}缩放`}
          onPointerDownCapture={(event) => beginResize(visibleCorner, event)}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
        >
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path d="M36 12 A24 24 0 0 0 12 36" />
          </svg>
        </button>
      ) : null}
    </article>
  );
}

export const CanvasNode = memo(CanvasNodeComponent);

