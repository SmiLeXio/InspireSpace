import { AlertCircle, Check, FolderPlus, MousePointer2, Palette, X } from "lucide-react";
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
  }) => boolean | void;
  onSaveHotspot: (request: Extract<CanvasDialogRequest, { kind: "hotspot" }>, values: {
    label: string;
    description: string;
  }) => boolean | void;
}

export function CanvasCreationDialog({ request, onClose, onCreateFolder, onSaveHotspot }: CanvasCreationDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isFolder = request.kind === "folder";
  const [title, setTitle] = useState(isFolder ? "新建文件夹" : request.label || "");
  const [description, setDescription] = useState(request.kind === "hotspot" ? request.description || "" : "");
  const [folderIcon, setFolderIcon] = useState<FolderIconKey>("folder");
  const [color, setColor] = useState<string>(FOLDER_COLORS[0].value);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    setTitle(request.kind === "folder" ? "新建文件夹" : request.label || "");
    setDescription(request.kind === "hotspot" ? request.description || "" : "");
    setFolderIcon("folder");
    setColor(FOLDER_COLORS[0].value);
    setSubmitError("");
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

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setSubmitError(isFolder ? "请输入文件夹名称" : "请输入热点名称");
      inputRef.current?.focus();
      return;
    }

    const saved = request.kind === "folder"
      ? onCreateFolder(request, { title: normalizedTitle, color, folderIcon })
      : onSaveHotspot(request, { label: normalizedTitle, description: description.trim() });
    if (saved === false) {
      setSubmitError(request.kind === "folder" ? "文件夹创建失败，请重试" : "热点未能保存，请重新选择图片后重试");
    }
  };

  const FolderGlyph = folderIconFor(folderIcon);
  const titleId = `creation-dialog-title-${request.kind}`;

  return (
    <div className="creation-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form
        className={`creation-dialog ${isFolder ? "is-folder-dialog" : "is-hotspot-dialog"}`}
        onSubmit={submit}
        aria-modal="true"
        role="dialog"
        aria-labelledby={titleId}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="creation-dialog-header">
          <div
            className={`creation-dialog-symbol ${isFolder ? "is-folder" : "is-hotspot"}`}
            style={isFolder ? { "--folder-color": color } as React.CSSProperties : undefined}
          >
            {isFolder ? <FolderGlyph size={19} strokeWidth={1.75} /> : <MousePointer2 size={18} strokeWidth={1.8} />}
          </div>
          <div>
            <h2 id={titleId}>{isFolder ? "新建文件夹" : request.hotspotId ? "编辑热点" : "添加热点"}</h2>
            <p>{isFolder
              ? request.childIds.length ? `将已选的 ${request.childIds.length} 个对象收纳到文件夹` : "创建一个用于整理画布内容的文件夹"
              : request.hotspotId ? "修改热点名称和说明" : "热点会固定在刚才点击的图片位置"}</p>
          </div>
          <button className="creation-dialog-close" type="button" onClick={onClose} aria-label="关闭"><X size={15} /></button>
        </header>

        <div className="creation-dialog-content">
          <label className="creation-dialog-field creation-dialog-name-field">
            <span>{isFolder ? "名称" : "热点名称"}</span>
            <input
              ref={inputRef}
              value={title}
              maxLength={48}
              onChange={(event) => {
                setTitle(event.target.value);
                if (submitError) setSubmitError("");
              }}
              placeholder={isFolder ? "输入文件夹名称" : "输入热点名称"}
              aria-invalid={Boolean(submitError)}
            />
          </label>

          {isFolder ? (
            <>
              <fieldset className="creation-dialog-options folder-icon-options">
                <legend><span>图标</span><small>选择一个便于识别的标记</small></legend>
                <div>
                  {FOLDER_ICON_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={folderIcon === option.key ? "is-active" : ""}
                        onClick={() => setFolderIcon(option.key)}
                        title={option.label}
                        aria-label={option.label}
                        aria-pressed={folderIcon === option.key}
                      >
                        <Icon size={17} />
                        <small>{option.label}</small>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="creation-dialog-options folder-color-options">
                <legend><span>颜色</span><small>预设或自定义</small></legend>
                <div className="folder-color-controls">
                  <div className="folder-color-swatches">
                    {FOLDER_COLORS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={color.toLowerCase() === option.value.toLowerCase() ? "is-active" : ""}
                        onClick={() => setColor(option.value)}
                        title={option.name}
                        aria-label={option.name}
                        aria-pressed={color.toLowerCase() === option.value.toLowerCase()}
                        style={{ "--swatch": option.value } as React.CSSProperties}
                      >
                        {color.toLowerCase() === option.value.toLowerCase() ? <Check size={11} /> : null}
                      </button>
                    ))}
                  </div>
                  <label className="folder-custom-color" title="自定义文件夹颜色">
                    <Palette size={14} />
                    <span>自定义</span>
                    <code>{color.toUpperCase()}</code>
                    <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="自定义文件夹颜色" />
                  </label>
                </div>
              </fieldset>
            </>
          ) : (
            <label className="creation-dialog-field creation-dialog-description-field">
              <span>说明 <em>可选</em></span>
              <textarea
                value={description}
                maxLength={180}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="补充这处细节的说明"
              />
            </label>
          )}

          {submitError ? <div className="creation-dialog-error" role="alert"><AlertCircle size={14} />{submitError}</div> : null}
        </div>

        <footer className="creation-dialog-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className="is-primary" disabled={!title.trim()}>
            {isFolder ? <FolderPlus size={15} /> : <Check size={14} />}
            {isFolder ? "创建文件夹" : request.hotspotId ? "保存修改" : "创建热点"}
          </button>
        </footer>
      </form>
    </div>
  );
}
