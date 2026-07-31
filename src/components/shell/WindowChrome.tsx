import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const isTauri = () => "__TAURI_INTERNALS__" in window;

export function WindowChrome() {
  const run = async (action: "minimize" | "maximize" | "close") => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    if (action === "maximize") await appWindow.toggleMaximize();
    if (action === "close") await appWindow.close();
  };

  return (
    <div className={`window-chrome ${isTauri() ? "is-tauri" : ""}`} data-tauri-drag-region onDoubleClick={() => void run("maximize")} aria-hidden={!isTauri()}>
      <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => void run("minimize")} aria-label="最小化窗口" title="最小化"><Minus size={12} strokeWidth={1.6} /></button>
        <button type="button" onClick={() => void run("maximize")} aria-label="最大化窗口" title="最大化"><Square size={10} strokeWidth={1.5} /></button>
        <button className="window-close" type="button" onClick={() => void run("close")} aria-label="关闭窗口" title="关闭"><X size={12} strokeWidth={1.6} /></button>
      </div>
    </div>
  );
}
