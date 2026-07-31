import { gsap } from "gsap";
import { ArrowLeft, FolderPlus, Frame, Layers3, Maximize2, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCanvasStore } from "../../store/useCanvasStore";
import type { CanvasNode as CanvasNodeModel, Viewport } from "../../types/canvas";
import { CanvasContextMenu, type ContextMenuPoint } from "./CanvasContextMenu";
import { CanvasNode } from "./CanvasNode";

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

interface DragState {
  type: "pan" | "lasso";
  startX: number;
  startY: number;
  viewport: Viewport;
}

export function InfiniteCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const lassoRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const lassoElementRef = useRef<HTMLDivElement>(null);
  const lassoFrameRef = useRef(0);
  const spacePressRef = useRef<{ startedAt: number; wasLocked: boolean; used: boolean } | null>(null);
  const handModeLockedRef = useRef(false);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [handModeLocked, setHandModeLocked] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuPoint | null>(null);

  const nodes = useCanvasStore((state) => state.nodes);
  const workspaceRoot = useCanvasStore((state) => state.workspaceRoot);
  const projectName = useCanvasStore((state) => state.projectName);
  const viewport = useCanvasStore((state) => state.viewport);
  const selectedIds = useCanvasStore((state) => state.selectedIds);
  const editingId = useCanvasStore((state) => state.editingId);
  const setViewport = useCanvasStore((state) => state.setViewport);
  const selectOnly = useCanvasStore((state) => state.selectOnly);
  const selectMany = useCanvasStore((state) => state.selectMany);
  const deleteSelected = useCanvasStore((state) => state.deleteSelected);
  const createNode = useCanvasStore((state) => state.createNode);
  const importMedia = useCanvasStore((state) => state.importMedia);
  const createFromText = useCanvasStore((state) => state.createFromText);
  const stackSelected = useCanvasStore((state) => state.stackSelected);
  const createFolder = useCanvasStore((state) => state.createFolder);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const historyPast = useCanvasStore((state) => state.historyPast);
  const historyFuture = useCanvasStore((state) => state.historyFuture);
  const leaveProject = useCanvasStore((state) => state.leaveProject);

  const rootNodes = useMemo(() => nodes.filter((node) => !node.parentId), [nodes]);
  const sortedRootNodes = useMemo(() => [...rootNodes].sort((a, b) => a.zIndex - b.zIndex), [rootNodes]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) || 0) + 1);
    return counts;
  }, [nodes]);
  const stackInfo = useMemo(() => {
    const groups = new Map<string, CanvasNodeModel[]>();
    for (const node of rootNodes) if (node.stackId) groups.set(node.stackId, [...(groups.get(node.stackId) || []), node]);
    const info = new Map<string, { count: number; topId: string }>();
    for (const [id, group] of groups) {
      const sorted = group.sort((a, b) => a.zIndex - b.zIndex);
      info.set(id, { count: sorted.length, topId: sorted.at(-1)!.id });
    }
    return info;
  }, [rootNodes]);


  const handModeActive = handModeLocked || spacePressed;
  const markDragModeUse = useCallback(() => {
    if (spacePressRef.current) spacePressRef.current.used = true;
  }, []);
  const paintLasso = useCallback(() => {
    lassoFrameRef.current = 0;
    const lasso = lassoRef.current;
    const element = lassoElementRef.current;
    if (!lasso || !element) return;
    const left = Math.min(lasso.startX, lasso.x);
    const top = Math.min(lasso.startY, lasso.y);
    element.style.width = `${Math.abs(lasso.x - lasso.startX)}px`;
    element.style.height = `${Math.abs(lasso.y - lasso.startY)}px`;
    element.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }, []);
  const scheduleLassoPaint = useCallback(() => {
    if (!lassoFrameRef.current) lassoFrameRef.current = requestAnimationFrame(paintLasso);
  }, [paintLasso]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const animateViewport = useCallback((target: Viewport) => {
    const proxy = { ...useCanvasStore.getState().viewport };
    gsap.to(proxy, {
      ...target,
      duration: 0.58,
      ease: "power3.inOut",
      onUpdate: () => setViewport({ ...proxy }, false),
      onComplete: () => setViewport({ ...target }, true),
    });
  }, [setViewport]);

  const resetView = useCallback(() => animateViewport({ x: size.width / 2, y: size.height / 2, scale: 1 }), [animateViewport, size.height, size.width]);

  const fitView = useCallback(() => {
    if (!rootNodes.length) return resetView();
    const minX = Math.min(...rootNodes.map((node) => node.x));
    const minY = Math.min(...rootNodes.map((node) => node.y));
    const maxX = Math.max(...rootNodes.map((node) => node.x + node.width));
    const maxY = Math.max(...rootNodes.map((node) => node.y + node.height));
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const padding = 150;
    const scale = clampScale(Math.min((size.width - padding * 2) / contentWidth, (size.height - padding * 2) / contentHeight));
    animateViewport({
      scale,
      x: size.width / 2 - (minX + contentWidth / 2) * scale,
      y: size.height / 2 - (minY + contentHeight / 2) * scale,
    });
  }, [animateViewport, resetView, rootNodes, size.height, size.width]);

  const screenToWorld = useCallback((x: number, y: number) => ({
    x: (x - viewport.x) / viewport.scale,
    y: (y - viewport.y) / viewport.scale,
  }), [viewport]);

  const openMenuAt = useCallback((screenX: number, screenY: number, nodeId?: string) => {
    const world = screenToWorld(screenX, screenY);
    const targetNode = nodeId ? useCanvasStore.getState().nodes.find((node) => node.id === nodeId) : undefined;
    setContextMenu({
      screenX: Math.max(14, Math.min(size.width - 286, screenX)),
      screenY: Math.max(14, Math.min(size.height - 610, screenY)),
      worldX: world.x,
      worldY: world.y,
      nodeId,
      hotspotX: targetNode ? Math.max(0.04, Math.min(0.96, (world.x - targetNode.x) / targetNode.width)) : undefined,
      hotspotY: targetNode ? Math.max(0.08, Math.min(0.92, (world.y - targetNode.y) / targetNode.height)) : undefined,
    });
  }, [screenToWorld, size.height, size.width]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.matches("input, textarea, [contenteditable='true']"));
      if (event.code === "Space" && !typing) {
        event.preventDefault();
        if (!event.repeat && !spacePressRef.current) {
          spacePressRef.current = {
            startedAt: performance.now(),
            wasLocked: handModeLockedRef.current,
            used: false,
          };
          setSpacePressed(true);
        }
      }
      if (typing) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "Escape") {
        setContextMenu(null);
        selectOnly(null);
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void deleteSelected();
      }
      if (event.key === "Home") { event.preventDefault(); fitView(); }
      if (event.key === "0") { event.preventDefault(); resetView(); }
      if (!command && !event.altKey) {
        const center = screenToWorld(size.width / 2, size.height / 2);
        if (event.key.toLowerCase() === "n") createNode("note", center);
        if (event.key.toLowerCase() === "s") createNode("sticky", center);
        if (event.key.toLowerCase() === "f") createFolder([], center);
        if (event.key.toLowerCase() === "w") createNode("web", center);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const press = spacePressRef.current;
      if (!press) return;
      event.preventDefault();
      const momentary = press.used || performance.now() - press.startedAt >= 260;
      const nextLocked = momentary ? false : !press.wasLocked;
      handModeLockedRef.current = nextLocked;
      setHandModeLocked(nextLocked);
      setSpacePressed(false);
      spacePressRef.current = null;
    };
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      const text = event.clipboardData?.getData("text/plain");
      if (text) {
        event.preventDefault();
        createFromText(text, screenToWorld(size.width / 2, size.height / 2));
      }
    };
    const onBlur = () => {
      spacePressRef.current = null;
      handModeLockedRef.current = false;
      setSpacePressed(false);
      setHandModeLocked(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("paste", onPaste);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("blur", onBlur);
    };
  }, [createFolder, createFromText, createNode, deleteSelected, fitView, redo, resetView, screenToWorld, selectOnly, size.height, size.width, undo]);

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    setContextMenu(null);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = screenToWorld(pointer.x, pointer.y);
    const nextScale = clampScale(viewport.scale * Math.exp(-event.deltaY * 0.00145));
    setViewport({ scale: nextScale, x: pointer.x - world.x * nextScale, y: pointer.y - world.y * nextScale });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target.closest(".canvas-node, .canvas-context-menu, .canvas-toolbar")) return;
    setContextMenu(null);
    const pan = event.button === 1 || (handModeActive && event.button === 0);
    if (pan) {
      event.preventDefault();
      markDragModeUse();
      dragRef.current = { type: "pan", startX: event.clientX, startY: event.clientY, viewport };
      setPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 0) {
      dragRef.current = { type: "lasso", startX: event.clientX, startY: event.clientY, viewport };
      lassoRef.current = { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY };
      lassoElementRef.current?.classList.add("is-active");
      scheduleLassoPaint();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === "pan") {
      setViewport({
        ...drag.viewport,
        x: drag.viewport.x + event.clientX - drag.startX,
        y: drag.viewport.y + event.clientY - drag.startY,
      }, false);
    } else {
      const lasso = lassoRef.current;
      if (!lasso) return;
      lasso.x = event.clientX;
      lasso.y = event.clientY;
      scheduleLassoPaint();
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.type === "pan") {
      setPanning(false);
      setViewport(useCanvasStore.getState().viewport, true);
      return;
    }
    const lasso = lassoRef.current;
    if (!lasso) return;
    lasso.x = event.clientX;
    lasso.y = event.clientY;
    if (lassoFrameRef.current) {
      cancelAnimationFrame(lassoFrameRef.current);
      lassoFrameRef.current = 0;
    }
    lassoElementRef.current?.classList.remove("is-active");
    lassoRef.current = null;
    if (event.type === "pointercancel") return;
    const left = Math.min(lasso.startX, lasso.x);
    const top = Math.min(lasso.startY, lasso.y);
    const right = Math.max(lasso.startX, lasso.x);
    const bottom = Math.max(lasso.startY, lasso.y);
    if (right - left < 4 && bottom - top < 4) {
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) selectOnly(null);
      return;
    }
    const a = screenToWorld(left, top);
    const b = screenToWorld(right, bottom);
    const ids = rootNodes.filter((node) => node.x < b.x && node.x + node.width > a.x && node.y < b.y && node.y + node.height > a.y).map((node) => node.id);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    selectMany(ids, additive);
    if (!additive && ids.length > 1) useCanvasStore.getState().stackSelected();
  };

  const selectionLabel = selectedIds.length > 1 ? `已选 ${selectedIds.length} 项` : "";

  return (
    <div
      ref={containerRef}
      className={`canvas-surface ${panning ? "is-panning" : ""} ${handModeActive ? "is-hand-mode" : "is-pointer-mode"}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onContextMenu={(event) => {
        event.preventDefault();
        const targetNode = (event.target as Element).closest<HTMLElement>("[data-node-id]");
        const nodeId = targetNode?.dataset.nodeId;
        if (nodeId && !selectedSet.has(nodeId)) selectOnly(nodeId);
        openMenuAt(event.clientX, event.clientY, nodeId);
      }}
      onDoubleClick={(event) => {
        if ((event.target as Element).closest(".canvas-node")) return;
        openMenuAt(event.clientX, event.clientY);
      }}
    >
      <div className="canvas-grid" style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${28 * viewport.scale}px ${28 * viewport.scale}px` }} />
      <div className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
        {sortedRootNodes.map((node) => {
          const info = node.stackId ? stackInfo.get(node.stackId) : undefined;
          return <CanvasNode
            key={node.id}
            node={node}
            selected={selectedSet.has(node.id) && editingId !== node.id}
            singleSelection={selectedIds.length === 1}
            workspaceRoot={workspaceRoot}
            childCount={childCounts.get(node.id) || 0}
            stackCount={info?.count || 0}
            stackTop={info?.topId === node.id}
            dragEnabled={handModeActive}
            onDragModeUse={markDragModeUse}
          />;
        })}
      </div>

      <div className="canvas-toolbar">
        <button type="button" className="project-back" onClick={leaveProject} title="返回欢迎页"><ArrowLeft size={15} /></button>
        <div className="project-identity"><strong>{projectName}</strong><span>{selectionLabel || "本地项目"}</span></div>
        <i />
        <button type="button" onClick={undo} disabled={!historyPast.length} title="撤销 Ctrl+Z"><Undo2 size={15} /></button>
        <button type="button" onClick={redo} disabled={!historyFuture.length} title="恢复 Ctrl+Y"><Redo2 size={15} /></button>
        {selectedIds.length > 1 ? <>
          <button type="button" className="toolbar-text" onClick={stackSelected}><Layers3 size={14} />收纳成堆</button>
          <button type="button" className="toolbar-text" onClick={() => createFolder(selectedIds)}><FolderPlus size={14} />放入文件夹</button>
        </> : null}
        <button type="button" onClick={fitView} title="适应全部"><Maximize2 size={15} /></button>
        <button type="button" onClick={resetView} title="重置视图"><RotateCcw size={15} /></button>
        <span className="zoom-readout"><Frame size={13} />{Math.round(viewport.scale * 100)}%</span>
      </div>

      <div ref={lassoElementRef} className="selection-lasso" />

      {contextMenu && !editingId ? <CanvasContextMenu point={contextMenu} onClose={() => setContextMenu(null)} /> : null}
      {!rootNodes.length && !contextMenu ? <div className="empty-whisper">右键画布，添加第一张卡片</div> : null}
    </div>
  );
}
