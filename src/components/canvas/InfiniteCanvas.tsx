import { getCurrentWebview } from "@tauri-apps/api/webview";
import { gsap } from "gsap";
import { ArrowLeft, FolderPlus, Frame, GripHorizontal, Layers3, Maximize2, Redo2, RotateCcw, Undo2, Ungroup, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useCanvasStore } from "../../store/useCanvasStore";
import type { FolderIconKey, Viewport } from "../../types/canvas";
import { CanvasContextMenu, type ContextMenuPoint } from "./CanvasContextMenu";
import { CanvasCreationDialog, type CanvasDialogRequest } from "./CanvasCreationDialog";
import { CanvasNode } from "./CanvasNode";
import { exceededPointerDragThreshold } from "./pointerIntent";
import { calculateFocusOffsets, collectStackGroups, compactStackLayout, expandedStackLayout } from "./stackGeometry";

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
  const canvasWorldRef = useRef<HTMLDivElement>(null);
  const lassoRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const lassoElementRef = useRef<HTMLDivElement>(null);
  const lassoFrameRef = useRef(0);
  const spacePressRef = useRef<{ startedAt: number; wasLocked: boolean; used: boolean } | null>(null);
  const handModeLockedRef = useRef(false);
  const stackMoveFrameRef = useRef(0);
  const externalDragDepthRef = useRef(0);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [handModeLocked, setHandModeLocked] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuPoint | null>(null);
  const [expandedStackId, setExpandedStackId] = useState<string | null>(null);
  const [stackDragging, setStackDragging] = useState(false);
  const [dialogRequest, setDialogRequest] = useState<CanvasDialogRequest | null>(null);
  const [externalDragActive, setExternalDragActive] = useState(false);

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
  const importExternalFiles = useCanvasStore((state) => state.importExternalFiles);
  const createFromText = useCanvasStore((state) => state.createFromText);
  const stackSelected = useCanvasStore((state) => state.stackSelected);
  const createFolder = useCanvasStore((state) => state.createFolder);
  const addImageHotspot = useCanvasStore((state) => state.addImageHotspot);
  const updateImageHotspot = useCanvasStore((state) => state.updateImageHotspot);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const historyPast = useCanvasStore((state) => state.historyPast);
  const historyFuture = useCanvasStore((state) => state.historyFuture);
  const leaveProject = useCanvasStore((state) => state.leaveProject);
  const finishDrag = useCanvasStore((state) => state.finishDrag);
  const unstack = useCanvasStore((state) => state.unstack);
  const stackNotice = useCanvasStore((state) => state.stackNotice);
  const clearStackNotice = useCanvasStore((state) => state.clearStackNotice);

  const rootNodes = useMemo(() => nodes.filter((node) => !node.parentId), [nodes]);
  const sortedRootNodes = useMemo(() => [...rootNodes].sort((a, b) => a.zIndex - b.zIndex), [rootNodes]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) || 0) + 1);
    return counts;
  }, [nodes]);
  const stackGroups = useMemo(() => collectStackGroups(rootNodes), [rootNodes]);
  const expandedGroup = expandedStackId ? stackGroups.get(expandedStackId) : undefined;
  const expandedLayout = useMemo(() => expandedGroup
    ? expandedStackLayout(expandedGroup, viewport, size)
    : null, [expandedGroup, size, viewport]);
  const expandedBounds = expandedLayout?.bounds;
  const compactLayouts = useMemo(() => {
    const layouts = new Map<string, ReturnType<typeof compactStackLayout>>();
    for (const group of stackGroups.values()) {
      layouts.set(group.id, compactStackLayout(group.members, group.anchorX, group.anchorY));
    }
    return layouts;
  }, [stackGroups]);
  const focusOffsets = useMemo(() => {
    const offsets = new Map<string, { x: number; y: number }>();
    if (!expandedBounds || !expandedStackId) return offsets;

    const representatives = [];
    const representedStackIds = new Set<string>();
    for (const node of rootNodes) {
      if (!node.stackId) {
        if (node.id !== editingId) representatives.push(node);
        continue;
      }
      if (node.stackId === expandedStackId || representedStackIds.has(node.stackId)) continue;

      const group = stackGroups.get(node.stackId);
      if (!group) {
        if (node.id !== editingId) representatives.push(node);
        continue;
      }
      representedStackIds.add(group.id);
      if (editingId && group.members.some((member) => member.id === editingId)) continue;

      const compact = compactLayouts.get(group.id);
      const representative = group.members.find((member) => member.id === group.topId);
      if (!compact || !representative) continue;
      representatives.push({
        ...representative,
        x: group.anchorX,
        y: group.anchorY,
        width: compact.width,
        height: compact.height,
      });
    }

    const representativeOffsets = calculateFocusOffsets(representatives, expandedBounds, new Set());
    for (const representative of representatives) {
      const offset = representativeOffsets.get(representative.id);
      if (!offset) continue;
      const group = representative.stackId ? stackGroups.get(representative.stackId) : undefined;
      if (group) {
        for (const member of group.members) offsets.set(member.id, offset);
      } else {
        offsets.set(representative.id, offset);
      }
    }
    return offsets;
  }, [compactLayouts, editingId, expandedBounds, expandedStackId, rootNodes, stackGroups]);

  const handModeActive = handModeLocked || spacePressed;
  const markDragModeUse = useCallback(() => {
    if (spacePressRef.current) spacePressRef.current.used = true;
  }, []);

  const clearStackDragStyles = useCallback(() => {
    const world = canvasWorldRef.current;
    if (!world) return;
    world.style.removeProperty("--active-stack-drag-x");
    world.style.removeProperty("--active-stack-drag-y");
  }, []);

  const closeExpandedStack = useCallback(() => {
    clearStackDragStyles();
    setStackDragging(false);
    setExpandedStackId(null);
  }, [clearStackDragStyles]);

  const requestStackExpansion = useCallback((stackId: string) => {
    if (!stackGroups.has(stackId)) return;
    clearStackDragStyles();
    setStackDragging(false);
    setExpandedStackId(stackId);
  }, [clearStackDragStyles, stackGroups]);

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

  useEffect(() => {
    if (expandedStackId && !stackGroups.has(expandedStackId)) closeExpandedStack();
  }, [closeExpandedStack, expandedStackId, stackGroups]);

  useEffect(() => {
    if (!stackNotice) return;
    const timer = setTimeout(clearStackNotice, 1200);
    return () => clearTimeout(timer);
  }, [clearStackNotice, stackNotice]);

  useEffect(() => () => {
    if (stackMoveFrameRef.current) cancelAnimationFrame(stackMoveFrameRef.current);
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
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
    };
  }, []);
  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const point = clientToCanvas(clientX, clientY);
    return screenToWorld(point.x, point.y);
  }, [clientToCanvas, screenToWorld]);

  const requestFolderDialog = useCallback((childIds: string[] = [], point?: { x: number; y: number }) => {
    setContextMenu(null);
    let anchor = point ? { x: point.x * viewport.scale + viewport.x, y: point.y * viewport.scale + viewport.y } : undefined;
    if (!anchor && childIds.length) {
      const children = useCanvasStore.getState().nodes.filter((node) => childIds.includes(node.id));
      if (children.length) {
        const minX = Math.min(...children.map((node) => node.x));
        const minY = Math.min(...children.map((node) => node.y));
        const maxX = Math.max(...children.map((node) => node.x + node.width));
        const maxY = Math.max(...children.map((node) => node.y + node.height));
        anchor = {
          x: ((minX + maxX) / 2) * viewport.scale + viewport.x,
          y: minY * viewport.scale + viewport.y,
        };
      }
    }
    setDialogRequest({
      kind: "folder",
      childIds: [...childIds],
      point,
      anchor: anchor ?? { x: size.width / 2, y: 68 },
    });
  }, [size.width, viewport.scale, viewport.x, viewport.y]);

  const handleCreateFolder = useCallback((request: Extract<CanvasDialogRequest, { kind: "folder" }>, options: {
    title: string;
    color: string;
    folderIcon: FolderIconKey;
  }) => {
    createFolder(request.childIds, request.point, options);
    return true;
  }, [createFolder]);

  const handleSaveHotspot = useCallback((request: Extract<CanvasDialogRequest, { kind: "hotspot" }>, values: {
    label: string;
    description: string;
  }) => {
    const saved = request.hotspotId
      ? updateImageHotspot(request.nodeId, request.hotspotId, values)
      : addImageHotspot(request.nodeId, {
        x: request.x,
        y: request.y,
        label: values.label,
        description: values.description,
      });
    return saved;
  }, [addImageHotspot, updateImageHotspot]);

  const handleExternalDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    externalDragDepthRef.current += 1;
    event.dataTransfer.dropEffect = "copy";
    setExternalDragActive(true);
  }, []);

  const handleExternalDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!externalDragActive) setExternalDragActive(true);
  }, [externalDragActive]);

  const handleExternalDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    externalDragDepthRef.current = Math.max(0, externalDragDepthRef.current - 1);
    if (!externalDragDepthRef.current) setExternalDragActive(false);
  }, []);

  const handleExternalDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    externalDragDepthRef.current = 0;
    setExternalDragActive(false);
    const point = clientToWorld(event.clientX, event.clientY);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) {
      void importExternalFiles(files, point);
      return;
    }
    const uri = event.dataTransfer.getData("text/uri-list")
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith("#"));
    const text = uri || event.dataTransfer.getData("text/plain");
    if (text.trim()) createFromText(text, point);
  }, [clientToWorld, createFromText, importExternalFiles]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (disposed) return;
      if (payload.type === "leave") {
        setExternalDragActive(false);
        return;
      }
      setExternalDragActive(true);
      if (payload.type !== "drop") return;
      const position = payload.position.toLogical(window.devicePixelRatio || 1);
      setExternalDragActive(false);
      void importExternalFiles(payload.paths, clientToWorld(position.x, position.y));
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    }).catch(() => setExternalDragActive(false));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [clientToWorld, importExternalFiles]);

  const beginStackFocusDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (handModeActive || event.button !== 0 || !expandedGroup) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    try { handle.setPointerCapture(pointerId); } catch { /* Pointer capture may be unavailable in tests. */ }

    const state = useCanvasStore.getState();
    const memberIds = new Set(expandedGroup.members.map((member) => member.id));
    const before = state.nodes.map((node) => ({ ...node, hotspots: [...node.hotspots] }));
    const start = { x: event.clientX, y: event.clientY };
    const scale = state.viewport.scale;
    let latest = { x: 0, y: 0 };
    let moved = false;
    clearStackDragStyles();
    setStackDragging(true);
    selectMany([...memberIds]);

    const paint = () => {
      stackMoveFrameRef.current = 0;
      const world = canvasWorldRef.current;
      if (!world) return;
      world.style.setProperty("--active-stack-drag-x", `${latest.x}px`);
      world.style.setProperty("--active-stack-drag-y", `${latest.y}px`);
    };
    const update = (pointerEvent: PointerEvent) => {
      const screenOffset = {
        x: pointerEvent.clientX - start.x,
        y: pointerEvent.clientY - start.y,
      };
      latest = {
        x: screenOffset.x / scale,
        y: screenOffset.y / scale,
      };
      if (!moved && exceededPointerDragThreshold({ x: 0, y: 0 }, screenOffset)) moved = true;
      if (moved && !stackMoveFrameRef.current) stackMoveFrameRef.current = requestAnimationFrame(paint);
    };
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      if (pointerEvent.type === "pointerup") update(pointerEvent);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (stackMoveFrameRef.current) {
        cancelAnimationFrame(stackMoveFrameRef.current);
        stackMoveFrameRef.current = 0;
      }
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch { /* The pointer may already have been released. */ }

      if (pointerEvent.type === "pointercancel") {
        clearStackDragStyles();
        setStackDragging(false);
        return;
      }
      if (!moved) {
        closeExpandedStack();
        return;
      }
      const patches = before
        .filter((node) => memberIds.has(node.id))
        .map((node) => ({ id: node.id, patch: { x: node.x + latest.x, y: node.y + latest.y } }));
      flushSync(() => finishDrag(before, patches));
      clearStackDragStyles();
      setStackDragging(false);
    };
    window.addEventListener("pointermove", update, { passive: true });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [clearStackDragStyles, closeExpandedStack, expandedGroup, finishDrag, handModeActive, selectMany]);

  const openMenuAt = useCallback((clientX: number, clientY: number, nodeId?: string) => {
    const screen = clientToCanvas(clientX, clientY);
    const world = screenToWorld(screen.x, screen.y);
    const targetNode = nodeId ? useCanvasStore.getState().nodes.find((node) => node.id === nodeId) : undefined;
    setContextMenu({
      screenX: Math.max(14, Math.min(size.width - (targetNode?.type === "image" ? 526 : 286), screen.x)),
      screenY: Math.max(14, Math.min(size.height - 610, screen.y)),
      worldX: world.x,
      worldY: world.y,
      nodeId,
      hotspotX: targetNode ? Math.max(0.04, Math.min(0.96, (world.x - targetNode.x) / targetNode.width)) : undefined,
      hotspotY: targetNode ? Math.max(0.08, Math.min(0.92, (world.y - targetNode.y) / targetNode.height)) : undefined,
    });
  }, [clientToCanvas, screenToWorld, size.height, size.width]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.matches("input, textarea, [contenteditable='true']"));
      const stackControl = Boolean(target?.closest("[data-stack-control='true']"));
      if (event.code === "Space" && !typing && !stackControl) {
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
        closeExpandedStack();
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
        if (event.key.toLowerCase() === "f") requestFolderDialog([], center);
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
  }, [closeExpandedStack, createFromText, createNode, deleteSelected, fitView, redo, requestFolderDialog, resetView, screenToWorld, selectOnly, size.height, size.width, undo]);

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
    if (target.closest(".canvas-context-menu, .canvas-toolbar, .stack-focus-controls")) return;
    const overNode = Boolean(target.closest(".canvas-node"));
    if (overNode && !handModeActive) return;
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
      closeExpandedStack();
      const point = clientToCanvas(event.clientX, event.clientY);
      dragRef.current = { type: "lasso", startX: point.x, startY: point.y, viewport };
      lassoRef.current = { startX: point.x, startY: point.y, x: point.x, y: point.y };
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
      const point = clientToCanvas(event.clientX, event.clientY);
      lasso.x = point.x;
      lasso.y = point.y;
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
    const point = clientToCanvas(event.clientX, event.clientY);
    lasso.x = point.x;
    lasso.y = point.y;
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
      className={`canvas-surface ${panning ? "is-panning" : ""} ${handModeActive ? "is-hand-mode" : "is-pointer-mode"} ${expandedStackId ? "is-stack-focused" : ""}`}
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
    >
      <div className="canvas-grid" style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${28 * viewport.scale}px ${28 * viewport.scale}px` }} />
      <div ref={canvasWorldRef} className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
        {expandedGroup && expandedLayout && expandedBounds ? (
          <div
            className={`stack-focus-controls ${stackDragging ? "is-dragging" : ""}`}
            style={{
              left: expandedBounds.left,
              top: expandedBounds.top - 48,
            }}
            data-stack-id={expandedGroup.id}
          >
            <button
              type="button"
              className="stack-focus-handle"
              data-stack-control="true"
              onPointerDown={beginStackFocusDrag}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                closeExpandedStack();
              }}
              aria-label={`拖动${expandedGroup.title}的全部项目，单击、Enter 或空格收拢`}
              title="拖动整个堆叠，单击收拢"
            >
              <GripHorizontal size={15} />
              <span><strong>{expandedGroup.title}</strong><small>{expandedGroup.members.length} 个项目</small></span>
            </button>
            <button
              type="button"
              className="stack-focus-unstack"
              data-stack-control="true"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                const stackId = expandedGroup.id;
                closeExpandedStack();
                unstack(stackId);
              }}
              title="解散堆叠"
              aria-label={`解散${expandedGroup.title}`}
            >
              <Ungroup size={14} />
            </button>
          </div>
        ) : null}
        {sortedRootNodes.map((node) => {
          const group = node.stackId ? stackGroups.get(node.stackId) : undefined;
          const stackExpanded = Boolean(group && group.id === expandedStackId && expandedLayout);
          const expandedPosition = stackExpanded ? expandedLayout?.positions.get(node.id) : undefined;
          const compact = group ? compactLayouts.get(group.id) : undefined;
          const compactPosition = !stackExpanded ? compact?.positions.get(node.id) : undefined;
          const stackDepth = compact && !stackExpanded
            ? Math.max(0, compact.frontToBack.findIndex((member) => member.id === node.id))
            : 0;
          const baseStackZ = group ? Math.max(...group.members.map((member) => member.zIndex)) : node.zIndex;
          const displayNode = expandedPosition ? {
            ...node,
            x: expandedPosition.x,
            y: expandedPosition.y,
            zIndex: 90000 + expandedPosition.index,
          } : compactPosition && group ? {
            ...node,
            ...compactPosition,
            zIndex: baseStackZ + group.members.length - stackDepth,
          } : node;
          const focusMuted = Boolean(expandedStackId && node.stackId !== expandedStackId);
          return <CanvasNode
            key={node.id}
            node={displayNode}
            selected={selectedSet.has(node.id) && editingId !== node.id}
            singleSelection={selectedIds.length === 1}
            workspaceRoot={workspaceRoot}
            childCount={childCounts.get(node.id) || 0}
            stackCount={group?.members.length || 0}
            stackTop={group?.topId === node.id}
            stackExpanded={stackExpanded}
            stackDepth={stackDepth}
            focusMuted={focusMuted}
            temporaryOffset={focusOffsets.get(node.id)}
            stackBounds={stackExpanded ? expandedBounds : undefined}
            stackDelay={stackExpanded && expandedPosition ? Math.min(expandedPosition.index * 28, 196) : 0}
            stackColumns={stackExpanded ? expandedLayout?.columns : undefined}
            stackDragActive={stackExpanded && stackDragging}
            dragEnabled={!handModeActive && !stackDragging && !focusMuted}
            onDragModeUse={markDragModeUse}
            onRequestExpand={requestStackExpansion}
            onRequestCollapse={closeExpandedStack}
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
          <button type="button" className="toolbar-text" onClick={() => requestFolderDialog(selectedIds)}><FolderPlus size={14} />放入文件夹</button>
        </> : null}
        <button type="button" onClick={fitView} title="适应全部"><Maximize2 size={15} /></button>
        <button type="button" onClick={resetView} title="重置视图"><RotateCcw size={15} /></button>
        <span className="zoom-readout"><Frame size={13} />{Math.round(viewport.scale * 100)}%</span>
      </div>

      <div ref={lassoElementRef} className="selection-lasso" />

      {contextMenu && !editingId ? <CanvasContextMenu point={contextMenu} onClose={() => setContextMenu(null)} onRequestDialog={setDialogRequest} /> : null}
      {dialogRequest ? <CanvasCreationDialog request={dialogRequest} onClose={() => setDialogRequest(null)} onCreateFolder={handleCreateFolder} onSaveHotspot={handleSaveHotspot} /> : null}
      {externalDragActive ? <div className="external-drop-overlay" role="status" aria-live="polite"><div><UploadCloud size={30} /><strong>松开以载入到画布</strong><span>图片、视频、文档、链接或文字</span></div></div> : null}
      {stackNotice ? <div key={stackNotice.id} className="stack-toast" role="status" aria-live="polite"><Layers3 size={15} />{stackNotice.message}</div> : null}
      {!rootNodes.length && !contextMenu ? <div className="empty-whisper">右键画布，添加第一张卡片</div> : null}
    </div>
  );
}
