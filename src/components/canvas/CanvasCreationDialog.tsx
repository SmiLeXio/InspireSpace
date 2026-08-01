import { Check, FolderPlus, MousePointer2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FolderIconKey } from "../../types/canvas";
import { FOLDER_COLORS, FOLDER_ICON_OPTIONS, folderIconFor } from "./folderOptions";

export type CanvasDialogRequest =
  | {
    kind: "folder";
    childIds: string[];
    point?: { x: number; y: number };
  }
  | {
    kind: "hotspot";
    nodeId: string;
    x: number;
    y: number;
    hotspotId?: string;
    label?: string;
    description?: string;
  };

interface CanvasCreationDialogProps {
  request: CanvasDialogRequest;
  onClose: () => void;
  onCreateFolder: (request: Extract<CanvasDialogRequest, { kind: "folder" }>, options: {
    title: string;
    color: string;
    folderIcon: FolderIconKey;
  }) => void;
  onSaveHotspot: (request: Extract<CanvasDialogRequest, { kind: "hotspot" }>, values: {
    label: string;
    description: string;
  }) => void;
}

export function CanvasCreationDialog({ request, onClose, onCreateFolder, onSaveHotspot }: CanvasCreationDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isFolder = request.kind === "folder";
  const [title, setTitle] = useState(isFolder ? "新建文件夹" : request.label || "");
  const [description, setDescription] = useState(request.kind === "hotspot" ? request.description || "" : "");
  const [folderIcon, setFolderIcon] = useState<FolderIconKey>("folder");
  const [color, setColor] = useState<string>(FOLDER_COLORS[0].value);

  useEffect(() => {
    setTitle(request.kind === "folder" ? "新建文件夹" : request.label || "");
    setDescription(request.kind === "hotspot" ? request.description || "" : "");
    setFolderIcon("folder");
    setColor(FOLDER_COLORS[0].value);
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [request]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      inputRef.current?.focus();
      return;
    }
    if (request.kind === "folder") {
      onCreateFolder(request, { title: normalizedTitle, color, folderIcon });
    } else {
      onSaveHotspot(request, { label: normalizedTitle, description: description.trim() });
    }
  };

  const FolderGlyph = folderIconFor(folderIcon);

  return (
    <div className="creation-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className={`creation-dialog ${isFolder ? "is-folder-dialog" : "is-hotspot-dialog"}`} onSubmit={submit} aria-modal="true" role="dialog" aria-labelledby="creation-dialog-title">
        <button className="creation-dialog-close" type="button" onClick={onClose} aria-label="关闭"><X size={15} /></button>
        <div className="creation-dialog-kicker">
          {isFolder ? <FolderPlus size={15} /> : <MousePointer2 size={15} />}
          <span>{isFolder ? "整理画布" : request.hotspotId ? "编辑图片热点" : "添加图片热点"}</span>
        </div>
        <h2 id="creation-dialog-title">{isFolder ? "给文件夹取个名字" : request.hotspotId ? "更新热点内容" : "记录这处细节"}</h2>
        <p>{isFolder ? "选择一个图标和颜色，让它在画布上更容易辨认。" : "热点会保留在图片中的当前位置，可稍后从热点存档统一管理。"}</p>

        {isFolder ? (
          <div className="folder-dialog-preview" style={{ "--folder-color": color } as React.CSSProperties}>
            <div className="folder-dialog-preview-tab" />
            <div className="folder-dialog-preview-front">
              <FolderGlyph size={24} strokeWidth={1.7} />
              <strong>{title.trim() || "新建文件夹"}</strong>
            </div>
          </div>
        ) : null}

        <label className="creation-dialog-field">
          <span>{isFolder ? "文件夹名称" : "热点名称"}</span>
          <input ref={inputRef} value={title} maxLength={48} onChange={(event) => setTitle(event.target.value)} placeholder={isFolder ? "例如：灵感收藏" : "例如：材质细节"} />
        </label>

        {!isFolder ? (
          <label className="creation-dialog-field">
            <span>补充说明 <em>可选</em></span>
            <textarea value={description} maxLength={180} onChange={(event) => setDescription(event.target.value)} placeholder="写一句更具体的说明…" />
          </label>
        ) : null}

        {isFolder ? (
          <>
            <fieldset className="creation-dialog-options folder-icon-options">
              <legend>小图标</legend>
              <div>
                {FOLDER_ICON_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return <button key={option.key} type="button" className={folderIcon === option.key ? "is-active" : ""} onClick={() => setFolderIcon(option.key)} title={option.label}><Icon size={17} /><small>{option.label}</small></button>;
                })}
              </div>
            </fieldset>
            <fieldset className="creation-dialog-options folder-color-options">
              <legend>文件夹颜色</legend>
              <div>
                {FOLDER_COLORS.map((option) => <button key={option.value} type="button" className={color === option.value ? "is-active" : ""} onClick={() => setColor(option.value)} title={option.name} style={{ "--swatch": option.value } as React.CSSProperties}>{color === option.value ? <Check size={12} /> : null}</button>)}
              </div>
            </fieldset>
          </>
        ) : null}

        <div className="creation-dialog-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className="is-primary"><Check size={14} />{isFolder ? "创建文件夹" : request.hotspotId ? "保存修改" : "添加热点"}</button>
        </div>
      </form>
    </div>
  );
}
