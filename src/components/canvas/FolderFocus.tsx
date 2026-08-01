import { gsap } from "gsap";
import { Clock3, FileText, Folder, Globe2, GripHorizontal, Image as ImageIcon, StickyNote, Video, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { resolveMediaUrl } from "../../lib/backend";
import { useCanvasStore } from "../../store/useCanvasStore";
import type { CanvasNode } from "../../types/canvas";
import { exceededPointerDragThreshold } from "./pointerIntent";

const iconFor = (node: CanvasNode) => {
  if (node.type === "sticky") return StickyNote;
  if (node.type === "image") return ImageIcon;
  if (node.type === "video") return Video;
  if (node.type === "web") return Globe2;
  if (node.type === "plugin") return Clock3;
  return FileText;
};

interface FolderDragGhost {
  child: CanvasNode;
  width: number;
  height: number;
}

export function FolderFocus() {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const [dragGhost, setDragGhost] = useState<FolderDragGhost | null>(null);
  const folderId = useCanvasStore((state) => state.openFolderId);
  const nodes = useCanvasStore((state) => state.nodes);
  const workspaceRoot = useCanvasStore((state) => state.workspaceRoot);
  const closeFolder = useCanvasStore((state) => state.closeFolder);
  const openEditor = useCanvasStore((state) => state.openEditor);
  const updateNode = useCanvasStore((state) => state.updateNode);
  const extractNodeFromFolder = useCanvasStore((state) => state.extractNodeFromFolder);
  const folder = nodes.find((node) => node.id === folderId) ?? null;
  const children = useMemo(() => nodes.filter((node) => node.parentId === folderId).sort((a, b) => a.zIndex - b.zIndex), [folderId, nodes]);

  useEffect(() => {
    if (!folder) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeFolder(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeFolder, folder]);

  useLayoutEffect(() => {
    if (!panelRef.current || !folder) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(".folder-focus-backdrop", { opacity: 0 }, { opacity: 1, duration: 0.28 });
      gsap.fromTo(panelRef.current, { opacity: 0, scale: 0.92, y: 30 }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: "power3.out" });
      gsap.fromTo(".folder-focus-item", { opacity: 0, y: 22, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, stagger: 0.045, duration: 0.38, ease: "power2.out", delay: 0.08 });
    }, panelRef);
    return () => ctx.revert();
  }, [folder]);

  if (!folder) return null;

  const openChild = (child: CanvasNode) => {
    if (["note", "sheet", "document"].includes(child.type)) {
      closeFolder();
      openEditor(child.id);
    }
  };

  const beginExtract = (child: CanvasNode, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    const width = Math.min(270, Math.max(180, child.width * 0.62));
    const height = Math.min(190, Math.max(112, width * child.height / Math.max(1, child.width)));
    let active = false;

    flushSync(() => setDragGhost({ child, width, height }));

    const paint = (clientX: number, clientY: number) => {
      const ghost = dragGhostRef.current;
      if (!ghost) return;
      ghost.style.transform = `translate3d(${clientX - width / 2}px, ${clientY - 24}px, 0)`;
      ghost.classList.toggle("is-active", active);
    };
    paint(start.x, start.y);

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", onKeyDown, true);
      setDragGhost(null);
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!active && exceededPointerDragThreshold(start, { x: moveEvent.clientX, y: moveEvent.clientY })) active = true;
      if (!active) return;
      moveEvent.preventDefault();
      paint(moveEvent.clientX, moveEvent.clientY);
    };
    const finish = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      const shouldExtract = active
        && endEvent.type === "pointerup"
        && !panelRef.current?.contains(document.elementFromPoint(endEvent.clientX, endEvent.clientY));
      cleanup();
      if (!shouldExtract) return;

      const surfaceRect = document.querySelector<HTMLElement>(".canvas-surface")?.getBoundingClientRect();
      if (!surfaceRect) return;
      const viewport = useCanvasStore.getState().viewport;
      const worldX = (endEvent.clientX - surfaceRect.left - viewport.x) / viewport.scale;
      const worldY = (endEvent.clientY - surfaceRect.top - viewport.y) / viewport.scale;
      extractNodeFromFolder(child.id, {
        x: worldX - child.width / 2,
        y: worldY - child.height / 2,
      });
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopImmediatePropagation();
      cleanup();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", onKeyDown, true);
  };

  const GhostIcon = dragGhost ? iconFor(dragGhost.child) : null;

  return (
    <div className="folder-focus-layer" role="dialog" aria-modal="true" aria-label={`${folder.title} 文件夹`}>
      <button type="button" className="folder-focus-backdrop" onClick={closeFolder} aria-label="关闭文件夹" />
      <section ref={panelRef} className="folder-focus-panel">
        <header>
          <div className="folder-focus-title"><span><Folder size={22} /></span><div><strong>{folder.title || "新建文件夹"}</strong><small>{children.length} 个项目</small></div></div>
          <button type="button" onClick={closeFolder} aria-label="关闭"><X size={18} /></button>
        </header>
        <div className="folder-focus-grid">
          {children.map((child) => {
            const Icon = iconFor(child);
            const media = resolveMediaUrl(workspaceRoot, child.mediaPath);
            return (
              <article key={child.id} className={`folder-focus-item folder-child-${child.type}`} style={{ background: child.color || "#fbfbfa" }}>
                <div className="folder-child-label">
                  <Icon size={13} />
                  <span>{child.title || (child.type === "sticky" ? "便签" : "未命名")}</span>
                  <button type="button" className="folder-child-extract" title="拖出到画布" aria-label={`将${child.title || "此项目"}拖出到画布`} onPointerDown={(event) => beginExtract(child, event)}>
                    <GripHorizontal size={13} />
                  </button>
                </div>
                {child.type === "sticky" ? <textarea value={child.content} onChange={(event) => updateNode(child.id, { content: event.target.value })} placeholder="直接编辑便签…" /> : null}
                {child.type === "image" && media ? <img src={media} alt={child.title} /> : null}
                {child.type === "video" && media ? <video src={media} controls /> : null}
                {child.type === "web" ? <div className="folder-web-link">{child.url || "尚未输入网址"}</div> : null}
                {["note", "sheet", "document"].includes(child.type) ? <button type="button" className="folder-child-open" onClick={() => openChild(child)}><strong>{child.title}</strong><p>{child.content || "点击打开编辑"}</p><span>打开</span></button> : null}
                {child.type === "plugin" ? <div className="folder-plugin-label"><Clock3 size={28} /><span>时钟插件</span></div> : null}
              </article>
            );
          })}
          {!children.length ? <div className="folder-focus-empty"><Folder size={38} /><strong>文件夹还是空的</strong><span>回到画布框选对象，再使用“放入文件夹”。</span></div> : null}
        </div>
      </section>
      {dragGhost && GhostIcon ? (
        <div
          ref={dragGhostRef}
          className={`folder-drag-ghost folder-child-${dragGhost.child.type}`}
          style={{ width: dragGhost.width, height: dragGhost.height, background: dragGhost.child.color || "#fbfbfa" }}
          aria-hidden="true"
        >
          <GhostIcon size={15} />
          <strong>{dragGhost.child.title || (dragGhost.child.type === "sticky" ? "便签" : "未命名")}</strong>
          <small>松开移到画布</small>
        </div>
      ) : null}
    </div>
  );
}