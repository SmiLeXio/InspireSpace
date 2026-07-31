import { Check, ExternalLink, Trash2, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { resolveMediaUrl } from "../../lib/backend";
import { useCanvasStore } from "../../store/useCanvasStore";
import { STICKY_COLORS } from "../../types/canvas";

export function CardEditor() {
  const editingId = useCanvasStore((state) => state.editingId);
  const nodes = useCanvasStore((state) => state.nodes);
  const workspaceRoot = useCanvasStore((state) => state.workspaceRoot);
  const saveState = useCanvasStore((state) => state.saveState);
  const updateNode = useCanvasStore((state) => state.updateNode);
  const closeEditor = useCanvasStore((state) => state.closeEditor);
  const deleteNodes = useCanvasStore((state) => state.deleteNodes);
  const node = nodes.find((item) => item.id === editingId) ?? null;
  const mediaUrl = useMemo(() => node ? resolveMediaUrl(workspaceRoot, node.mediaPath) : "", [node, workspaceRoot]);

  useEffect(() => {
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeEditor(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeEditor, node]);

  if (!node) return null;
  const editableText = ["note", "sheet", "document"].includes(node.type);
  const isPdf = /\.pdf$/i.test(node.mediaName || node.mediaPath || "");

  return (
    <div className="editor-layer" role="dialog" aria-modal="true" aria-label={`编辑${node.title}`}>
      <button className="editor-dismiss" type="button" onClick={closeEditor} aria-label="关闭编辑器" />
      <section className={`inline-editor inline-editor-${node.type}`}>
        <header className="inline-editor-header">
          <div><span>{node.type === "document" ? "文档" : "笔记"}</span><small>{saveState === "saving" ? "正在保存…" : "保存在本地"}</small></div>
          <div className="inline-editor-actions">
            <span className={`inline-save is-${saveState}`}>{saveState === "saved" ? <Check size={11} /> : null}</span>
            {node.url ? <button type="button" onClick={() => window.open(node.url!, "_blank")} title="打开链接"><ExternalLink size={15} /></button> : null}
            <button type="button" onClick={() => void deleteNodes([node.id])} title="删除"><Trash2 size={15} /></button>
            <button type="button" onClick={closeEditor} title="关闭 (Esc)"><X size={16} /></button>
          </div>
        </header>

        {editableText && !isPdf ? (
          <div className="inline-sheet-fields">
            <input autoFocus value={node.title} onChange={(event) => updateNode(node.id, { title: event.target.value })} placeholder="标题" />
            <textarea value={node.content} onChange={(event) => updateNode(node.id, { content: event.target.value })} placeholder="从这里开始写作…" spellCheck />
          </div>
        ) : null}

        {isPdf && mediaUrl ? <object className="editor-pdf" data={mediaUrl} type="application/pdf"><p>当前环境无法预览 PDF。</p></object> : null}

        {node.type === "image" && mediaUrl ? <div className="inline-media-fields"><img src={mediaUrl} alt={node.title} /><input value={node.title} onChange={(event) => updateNode(node.id, { title: event.target.value })} /></div> : null}
        {node.type === "video" && mediaUrl ? <div className="inline-media-fields"><video src={mediaUrl} controls /><input value={node.title} onChange={(event) => updateNode(node.id, { title: event.target.value })} /></div> : null}

        {node.type === "sticky" ? <div className="inline-color-row">{STICKY_COLORS.map((color) => <button key={color.value} type="button" className={node.color === color.value ? "is-selected" : ""} style={{ background: color.value }} onClick={() => updateNode(node.id, { color: color.value })} title={color.name} />)}</div> : null}
      </section>
    </div>
  );
}
