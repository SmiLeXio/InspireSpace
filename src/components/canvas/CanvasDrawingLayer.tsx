import { Draw, toSvg, type Stroke } from "drawesome";
import "drawesome/styles.css";
import { Paintbrush } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { Viewport } from "../../types/canvas";

interface CanvasDrawingLayerProps {
  enabled: boolean;
  viewport: Viewport;
  workspaceRoot: string;
}

interface SavedDrawing {
  version: 1;
  strokes: Stroke[];
}

interface StaticDrawing {
  svg: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const STORAGE_PREFIX = "inspirespace:canvas-drawing:";
const SAVE_IDLE_MS = 280;

const DRAWESOME_ZH: Record<string, string> = {
  Pencil: "铅笔",
  Pen: "钢笔",
  Fineliner: "针管笔",
  Marker: "记号笔",
  Highlighter: "荧光笔",
  Brush: "画笔",
  "Fountain Pen": "墨水笔",
  Eraser: "橡皮擦",
  Undo: "撤销",
  Redo: "重做",
  Clear: "清空",
  "Clear all": "清空全部笔迹",
  "Tool settings": "笔触设置",
  Size: "大小",
  Opacity: "不透明度",
  "Size & opacity": "大小与不透明度",
  Colour: "颜色",
  Color: "颜色",
  "Pick any colour": "自定义颜色",
  "Any colour": "自定义颜色",
  "Hex colour": "十六进制颜色",
  "Pick a colour from the screen": "吸取屏幕颜色",
  "Pick from screen": "吸取颜色",
  "Back to tools": "返回工具",
  "Back to swatches": "返回色板",
  Back: "返回",
  "Show drawing tools": "展开绘画工具",
  "Hide tools": "收起绘画工具",
};

const localizeDrawesomeLabel = (label: string) => {
  const localized = DRAWESOME_ZH[label];
  if (localized) return localized;
  if (label.startsWith("Ink colour — ")) return `墨水颜色 — ${label.slice("Ink colour — ".length)}`;
  return undefined;
};

const localizeDrawesome = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>("[aria-label], [title]").forEach((element) => {
    const ariaLabel = element.getAttribute("aria-label");
    const localizedAriaLabel = ariaLabel ? localizeDrawesomeLabel(ariaLabel) : undefined;
    if (localizedAriaLabel) {
      element.setAttribute("aria-label", localizedAriaLabel);
      element.setAttribute("title", localizedAriaLabel);
    }

    const title = element.getAttribute("title");
    const localizedTitle = title ? localizeDrawesomeLabel(title) : undefined;
    if (localizedTitle) element.setAttribute("title", localizedTitle);
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const text = textNode.textContent ?? "";
    const trimmed = text.trim();
    const localized = localizeDrawesomeLabel(trimmed);
    if (localized) textNode.textContent = text.replace(trimmed, localized);
    textNode = walker.nextNode();
  }
};

const mapStroke = (stroke: Stroke, mapPoint: (point: Stroke["points"][number]) => Stroke["points"][number], sizeScale: number): Stroke => ({
  ...stroke,
  size: stroke.size * sizeScale,
  points: stroke.points.map(mapPoint),
});

export const worldToScreenStrokes = (strokes: Stroke[], viewport: Viewport): Stroke[] => strokes.map((stroke) => mapStroke(
  stroke,
  ([x, y, pressure]) => [x * viewport.scale + viewport.x, y * viewport.scale + viewport.y, pressure],
  viewport.scale,
));

export const screenToWorldStrokes = (strokes: Stroke[], viewport: Viewport): Stroke[] => strokes.map((stroke) => mapStroke(
  stroke,
  ([x, y, pressure]) => [(x - viewport.x) / viewport.scale, (y - viewport.y) / viewport.scale, pressure],
  1 / viewport.scale,
));

const storageKey = (workspaceRoot: string) => `${STORAGE_PREFIX}${workspaceRoot}`;

const loadDrawing = (workspaceRoot: string): Stroke[] => {
  try {
    const raw = localStorage.getItem(storageKey(workspaceRoot));
    if (!raw) return [];
    const saved = JSON.parse(raw) as Partial<SavedDrawing>;
    return saved.version === 1 && Array.isArray(saved.strokes) ? saved.strokes : [];
  } catch {
    return [];
  }
};

const saveDrawing = (workspaceRoot: string, strokes: Stroke[]) => {
  try {
    const saved: SavedDrawing = { version: 1, strokes };
    localStorage.setItem(storageKey(workspaceRoot), JSON.stringify(saved));
  } catch {
    // Keep the in-memory drawing usable if local persistence is unavailable.
  }
};

export const createStaticDrawing = (strokes: Stroke[]): StaticDrawing | null => {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (!points.length) return null;

  const maxSize = strokes.reduce((size, stroke) => Math.max(size, stroke.size), 1);
  const padding = Math.max(12, maxSize * 2);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs) - padding;
  const top = Math.min(...ys) - padding;
  const right = Math.max(...xs) + padding;
  const bottom = Math.max(...ys) + padding;
  const width = Math.max(1, Math.ceil(right - left));
  const height = Math.max(1, Math.ceil(bottom - top));
  const shifted = strokes.map((stroke) => mapStroke(
    stroke,
    ([x, y, pressure]) => [x - left, y - top, pressure],
    1,
  ));

  return {
    svg: toSvg(shifted, width, height, null),
    left,
    top,
    width,
    height,
  };
};

export function CanvasDrawingLayer({ enabled, viewport, workspaceRoot }: CanvasDrawingLayerProps) {
  const [worldStrokes, setWorldStrokes] = useState<Stroke[]>(() => loadDrawing(workspaceRoot));
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [drawReady, setDrawReady] = useState(false);
  const layerRootRef = useRef<HTMLDivElement | null>(null);
  const activeScreenStrokesRef = useRef<Stroke[] | null>(null);
  const sessionViewportRef = useRef(viewport);
  const saveTimerRef = useRef<number | null>(null);
  const surfaceActive = enabled && toolsExpanded;

  const initialScreenStrokes = useMemo(
    () => surfaceActive ? worldToScreenStrokes(worldStrokes, viewport) : [],
    // An expanded drawing session locks the viewport, so its screen coordinates stay stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surfaceActive],
  );

  useLayoutEffect(() => {
    if (!surfaceActive) return;
    sessionViewportRef.current = viewport;
    activeScreenStrokesRef.current = initialScreenStrokes;
  }, [initialScreenStrokes, surfaceActive]);

  const staticWorldStrokes = !surfaceActive && activeScreenStrokesRef.current
    ? screenToWorldStrokes(activeScreenStrokesRef.current, sessionViewportRef.current)
    : worldStrokes;
  const staticDrawing = useMemo(
    () => createStaticDrawing(staticWorldStrokes),
    [staticWorldStrokes],
  );
  const showStaticDrawing = Boolean(staticDrawing && (!surfaceActive || !drawReady));

  useLayoutEffect(() => {
    if (!surfaceActive) {
      setDrawReady(false);
      return;
    }

    setDrawReady(false);
    let readyFrame = 0;
    const measureFrame = window.requestAnimationFrame(() => {
      readyFrame = window.requestAnimationFrame(() => setDrawReady(true));
    });
    return () => {
      window.cancelAnimationFrame(measureFrame);
      if (readyFrame) window.cancelAnimationFrame(readyFrame);
    };
  }, [surfaceActive]);

  useLayoutEffect(() => {
    if (!surfaceActive || !layerRootRef.current) return;
    const root = layerRootRef.current;
    localizeDrawesome(root);
    if (typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver(() => localizeDrawesome(root));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [surfaceActive]);

  const persistScreenStrokes = useCallback((screenStrokes: Stroke[]) => {
    const next = screenToWorldStrokes(screenStrokes, sessionViewportRef.current);
    saveDrawing(workspaceRoot, next);
    return next;
  }, [workspaceRoot]);

  const handleChange = useCallback((screenStrokes: Stroke[]) => {
    // Drawesome emits the complete stroke list for every pointer sample. Keep that
    // hot path to a ref assignment and defer coordinate conversion + JSON storage
    // until the pointer has been idle, so handwriting stays responsive.
    activeScreenStrokesRef.current = screenStrokes;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const latest = activeScreenStrokesRef.current;
      if (latest) persistScreenStrokes(latest);
    }, SAVE_IDLE_MS);
  }, [persistScreenStrokes]);

  useEffect(() => {
    if (surfaceActive) return;
    const latest = activeScreenStrokesRef.current;
    if (!latest) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const next = persistScreenStrokes(latest);
    activeScreenStrokesRef.current = null;
    setWorldStrokes(next);
  }, [persistScreenStrokes, surfaceActive]);

  useEffect(() => {
    if (!enabled) setToolsExpanded(false);
  }, [enabled]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    const latest = activeScreenStrokesRef.current;
    if (latest) persistScreenStrokes(latest);
  }, [persistScreenStrokes]);

  const stopSecondaryDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const stopDrawingContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!surfaceActive) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const stopCanvasWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!surfaceActive) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const interceptDrawesomeCollapse = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (!target.closest('button[aria-label="Hide tools"], button[aria-label="收起绘画工具"]')) return;
    event.preventDefault();
    event.stopPropagation();
    setToolsExpanded(false);
  };

  return (
    <>
      {showStaticDrawing && staticDrawing ? (
        <div
          className="canvas-drawing-static"
          aria-hidden="true"
          style={{
            width: staticDrawing.width,
            height: staticDrawing.height,
            transform: `matrix(${viewport.scale}, 0, 0, ${viewport.scale}, ${viewport.x + staticDrawing.left * viewport.scale}, ${viewport.y + staticDrawing.top * viewport.scale})`,
          }}
          dangerouslySetInnerHTML={{ __html: staticDrawing.svg }}
        />
      ) : null}

      {enabled ? (
        <div
          ref={layerRootRef}
          className={`canvas-drawing-layer ${surfaceActive ? `is-enabled ${drawReady ? "is-ready" : "is-preparing"}` : "is-collapsed"}`}
          aria-label="自由绘画层"
          onClickCapture={interceptDrawesomeCollapse}
          onContextMenu={stopDrawingContextMenu}
          onPointerDownCapture={stopSecondaryDrawing}
          onWheel={stopCanvasWheel}
        >
          {surfaceActive ? (
            <Draw
              background="transparent"
              initialStrokes={initialScreenStrokes}
              onChange={handleChange}
              placement="bottom"
              align="start"
              inset={22}
              theme="light"
              drawWhenMinimized={false}
              shortcuts
              tooltips={false}
              settings="bar"
              look="classic"
              depth="flat"
              controls={{
                color: true,
                size: true,
                opacity: true,
                undo: true,
                clear: true,
                custom: true,
                minimize: true,
              }}
            />
          ) : (
            <button
              type="button"
              className="canvas-drawing-launcher"
              aria-label="展开绘画工具"
              title="展开自由绘画工具"
              onClick={() => setToolsExpanded(true)}
            >
              <Paintbrush size={22} strokeWidth={1.8} />
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}


