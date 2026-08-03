import { gsap } from "gsap";
import {
  AlertCircle,
  Check,
  ChevronDown,
  FolderPlus,
  MessageSquareText,
  MousePointer2,
  Palette,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FolderIconKey } from "../../types/canvas";
import { FOLDER_COLORS, FOLDER_ICON_OPTIONS, folderIconFor } from "./folderOptions";

interface CanvasComposerAnchor {
  x: number;
  y: number;
}

export type CanvasDialogRequest =
  | {
    kind: "folder";
    childIds: string[];
    point?: { x: number; y: number };
    anchor?: CanvasComposerAnchor;
  }
  | {
    kind: "hotspot";
    nodeId: string;
    x: number;
    y: number;
    hotspotId?: string;
    label?: string;
    description?: string;
    anchor?: CanvasComposerAnchor;
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

const prefersReducedMotion = () => typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function CanvasCreationDialog({ request, onClose, onCreateFolder, onSaveHotspot }: CanvasCreationDialogProps) {
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const closingRef = useRef(false);
  const firstDetailsRunRef = useRef(true);
  const isFolder = request.kind === "folder";
  const [title, setTitle] = useState(isFolder ? "新建文件夹" : request.label || "");
  const [description, setDescription] = useState(request.kind === "hotspot" ? request.description || "" : "");
  const [folderIcon, setFolderIcon] = useState<FolderIconKey>("folder");
  const [color, setColor] = useState<string>(FOLDER_COLORS[0].value);
  const [detailsOpen, setDetailsOpen] = useState(request.kind === "hotspot" && Boolean(request.description));
  const [submitError, setSubmitError] = useState("");

  const placeComposer = useCallback((expandedHeight = 0) => {
    const root = rootRef.current;
    if (!root) return;
    const parent = root.offsetParent as HTMLElement | null;
    const parentWidth = parent?.clientWidth || window.innerWidth;
    const parentHeight = parent?.clientHeight || window.innerHeight;
    const width = root.offsetWidth || (request.kind === "folder" ? 440 : 420);
    const height = Math.max(root.offsetHeight + expandedHeight, 64);
    const edge = 16;
    const gap = 14;
    const anchor = request.anchor;

    let left = anchor ? anchor.x + gap : (parentWidth - width) / 2;
    let top = anchor ? anchor.y + gap : 78;
    let placement: "below" | "above" = "below";

    if (anchor && left + width > parentWidth - edge) left = anchor.x - width - gap;
    if (anchor && top + height > parentHeight - edge) {
      top = anchor.y - height - gap;
      placement = "above";
    }

    left = Math.max(edge, Math.min(parentWidth - width - edge, left));
    top = Math.max(edge, Math.min(parentHeight - height - edge, top));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.dataset.placement = placement;
  }, [request]);

  useLayoutEffect(() => {
    closingRef.current = false;
    firstDetailsRunRef.current = true;
    setTitle(request.kind === "folder" ? "新建文件夹" : request.label || "");
    setDescription(request.kind === "hotspot" ? request.description || "" : "");
    setFolderIcon("folder");
    setColor(FOLDER_COLORS[0].value);
    setDetailsOpen(request.kind === "hotspot" && Boolean(request.description));
    setSubmitError("");

    const root = rootRef.current;
    if (!root) return;
    placeComposer();
    const reduceMotion = prefersReducedMotion();
    const context = gsap.context(() => {
      gsap.set(root, { transformOrigin: root.dataset.placement === "above" ? "50% 100%" : "50% 0%" });
      if (reduceMotion) {
        gsap.set(root, { opacity: 1, scale: 1, y: 0 });
      } else {
        gsap.timeline({ defaults: { overwrite: "auto" } })
          .fromTo(root,
            { opacity: 0, scale: 0.92, y: root.dataset.placement === "above" ? 12 : -8 },
            { opacity: 1, scale: 1, y: 0, duration: 0.42, ease: "power4.out" },
          )
          .from(".creation-composer-primary > *", {
            opacity: 0,
            y: 7,
            duration: 0.3,
            ease: "power3.out",
            stagger: 0.035,
          }, "-=0.27")
          .from(".creation-composer-hint", {
            opacity: 0,
            y: 4,
            duration: 0.24,
            ease: "power2.out",
          }, "-=0.2");
      }
    }, root);

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      cancelAnimationFrame(frame);
      context.revert();
    };
  }, [placeComposer, request]);

  useLayoutEffect(() => {
    const panel = detailsRef.current;
    if (!panel) return;
    const reduceMotion = prefersReducedMotion();
    const contentHeight = panel.scrollHeight;
    placeComposer(detailsOpen ? contentHeight : 0);

    if (firstDetailsRunRef.current) {
      firstDetailsRunRef.current = false;
      gsap.set(panel, {
        height: detailsOpen ? "auto" : 0,
        opacity: detailsOpen ? 1 : 0,
      });
      return;
    }

    gsap.killTweensOf(panel);
    if (reduceMotion) {
      gsap.set(panel, { height: detailsOpen ? "auto" : 0, opacity: detailsOpen ? 1 : 0 });
      return;
    }

    if (detailsOpen) {
      gsap.fromTo(panel,
        { height: 0, opacity: 0, y: -6 },
        { height: "auto", opacity: 1, y: 0, duration: 0.36, ease: "power3.out", overwrite: true },
      );
      gsap.fromTo(panel.querySelectorAll(".creation-composer-detail-item"),
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.3, stagger: 0.035, ease: "power3.out", delay: 0.08 },
      );
    } else {
      gsap.to(panel, { height: 0, opacity: 0, y: -4, duration: 0.24, ease: "power2.inOut", overwrite: true });
    }
  }, [detailsOpen, placeComposer]);

  const closeWithAnimation = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) {
      onClose();
      return;
    }
    gsap.killTweensOf(root);
    gsap.to(root, {
      opacity: 0,
      scale: 0.95,
      y: root.dataset.placement === "above" ? 8 : -6,
      duration: 0.2,
      ease: "power2.in",
      overwrite: true,
      onComplete: onClose,
    });
  }, [onClose]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeWithAnimation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeWithAnimation();
    };
    const onResize = () => placeComposer();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [closeWithAnimation, placeComposer]);

  const showError = (message: string) => {
    setSubmitError(message);
    inputRef.current?.focus();
    const root = rootRef.current;
    if (root && !prefersReducedMotion()) {
      gsap.fromTo(root,
        { x: 0 },
        { keyframes: { x: [0, -5, 4, -3, 2, 0] }, duration: 0.36, ease: "power2.out", overwrite: true },
      );
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (composingRef.current) return;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      showError(isFolder ? "请输入文件夹名称" : "请输入热点名称");
      return;
    }

    const saved = request.kind === "folder"
      ? onCreateFolder(request, { title: normalizedTitle, color, folderIcon })
      : onSaveHotspot(request, { label: normalizedTitle, description: description.trim() });
    if (saved === false) {
      showError(request.kind === "folder" ? "文件夹创建失败，请重试" : "热点未能保存，请重新选择图片后重试");
      return;
    }
    closeWithAnimation();
  };

  const FolderGlyph = folderIconFor(folderIcon);
  const titleId = `creation-composer-title-${request.kind}`;
  const detailsId = `creation-composer-details-${request.kind}`;
  const helperText = isFolder
    ? request.childIds.length ? `将已选 ${request.childIds.length} 个对象收纳到这个文件夹` : "Enter 创建 · Esc 取消"
    : request.hotspotId ? "Enter 保存修改 · Esc 取消" : "热点会固定在刚才点击的图片位置";

  return (
    <form
      ref={rootRef}
      className={`creation-composer ${isFolder ? "is-folder-composer" : "is-hotspot-composer"} ${submitError ? "has-error" : ""}`}
      onSubmit={submit}
      aria-labelledby={titleId}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <span className="creation-composer-eyebrow" id={titleId}>
        {isFolder ? "NEW FOLDER" : request.hotspotId ? "EDIT HOTSPOT" : "NEW HOTSPOT"}
      </span>

      <div className="creation-composer-primary">
        <div
          className={`creation-composer-symbol ${isFolder ? "is-folder" : "is-hotspot"}`}
          style={isFolder ? { "--folder-color": color } as React.CSSProperties : undefined}
          aria-hidden="true"
        >
          {isFolder ? <FolderGlyph size={18} strokeWidth={1.75} /> : <MousePointer2 size={17} strokeWidth={1.9} />}
        </div>

        <label className="creation-composer-field">
          <span className="sr-only">{isFolder ? "名称" : "热点名称"}</span>
          <input
            ref={inputRef}
            value={title}
            maxLength={48}
            onChange={(event) => {
              setTitle(event.target.value);
              if (submitError) setSubmitError("");
            }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (composingRef.current || event.nativeEvent.isComposing)) event.preventDefault();
            }}
            placeholder={isFolder ? "输入文件夹名称" : "输入热点名称"}
            aria-label={isFolder ? "名称" : "热点名称"}
            aria-invalid={Boolean(submitError)}
            aria-describedby={submitError ? `${titleId}-error` : undefined}
          />
          <small>{title.length}/48</small>
        </label>

        <button
          className={`creation-composer-tool ${detailsOpen ? "is-active" : ""}`}
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-label={isFolder ? "个性设置" : "添加说明"}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          title={isFolder ? "图标与颜色" : "补充热点说明"}
        >
          {isFolder ? <SlidersHorizontal size={15} /> : <MessageSquareText size={15} />}
          <ChevronDown className="creation-composer-chevron" size={11} />
        </button>

        <button className="creation-composer-action is-cancel" type="button" onClick={closeWithAnimation} aria-label="取消">
          <X size={15} />
        </button>
        <button className="creation-composer-action is-confirm" type="submit" disabled={!title.trim()} aria-label={isFolder ? "创建文件夹" : request.hotspotId ? "保存修改" : "创建热点"}>
          {isFolder ? <FolderPlus size={15} /> : <Check size={15} />}
        </button>
      </div>

      <div
        ref={detailsRef}
        id={detailsId}
        className={`creation-composer-details ${detailsOpen ? "is-open" : ""}`}
        aria-hidden={!detailsOpen}
      >
        <div className="creation-composer-details-inner">
          {isFolder ? (
            <>
              <fieldset className="composer-folder-icons creation-composer-detail-item">
                <legend>图标</legend>
                <div>
                  {FOLDER_ICON_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={folderIcon === option.key ? "is-active" : ""}
                        onClick={() => setFolderIcon(option.key)}
                        aria-label={option.label}
                        aria-pressed={folderIcon === option.key}
                        tabIndex={detailsOpen ? 0 : -1}
                      >
                        <Icon size={15} />
                        <small>{option.label}</small>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="composer-folder-colors creation-composer-detail-item">
                <legend>颜色</legend>
                <div className="composer-color-row">
                  {FOLDER_COLORS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={color.toLowerCase() === option.value.toLowerCase() ? "is-active" : ""}
                      onClick={() => setColor(option.value)}
                      aria-label={option.name}
                      aria-pressed={color.toLowerCase() === option.value.toLowerCase()}
                      style={{ "--swatch": option.value } as React.CSSProperties}
                      tabIndex={detailsOpen ? 0 : -1}
                    >
                      {color.toLowerCase() === option.value.toLowerCase() ? <Check size={10} /> : null}
                    </button>
                  ))}
                  <label className="composer-custom-color" title="自定义文件夹颜色">
                    <Palette size={13} />
                    <span>自定义</span>
                    <code>{color.toUpperCase()}</code>
                    <input
                      type="color"
                      value={color}
                      onChange={(event) => setColor(event.target.value)}
                      aria-label="自定义文件夹颜色"
                      tabIndex={detailsOpen ? 0 : -1}
                    />
                  </label>
                </div>
              </fieldset>
            </>
          ) : (
            <label className="composer-hotspot-description creation-composer-detail-item">
              <span>热点说明 <em>可选</em></span>
              <textarea
                value={description}
                maxLength={180}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="补充这处细节、灵感来源或后续动作"
                tabIndex={detailsOpen ? 0 : -1}
              />
              <small>{description.length}/180</small>
            </label>
          )}
        </div>
      </div>

      <div className="creation-composer-footer">
        <span className="creation-composer-hint">{helperText}</span>
        {submitError ? <span className="creation-composer-error" id={`${titleId}-error`} role="alert"><AlertCircle size={12} />{submitError}</span> : null}
      </div>
    </form>
  );
}
