import { InfiniteCanvas } from "../canvas/InfiniteCanvas";
import { FolderFocus } from "../canvas/FolderFocus";
import { CardEditor } from "../editor/CardEditor";
import { useCanvasStore } from "../../store/useCanvasStore";
import { WelcomeScreen } from "./WelcomeScreen";
import { WindowChrome } from "./WindowChrome";

const saveLabel = { idle: "已在本地保存", saving: "正在保存", saved: "已保存", error: "保存失败" } as const;

export function AppShell() {
  const screen = useCanvasStore((state) => state.screen);
  const loading = useCanvasStore((state) => state.loading);
  const error = useCanvasStore((state) => state.error);
  const saveState = useCanvasStore((state) => state.saveState);
  const setError = useCanvasStore((state) => state.setError);

  return (
    <main className="app-shell">
      {screen === "welcome" ? <WelcomeScreen /> : (
        <section className="canvas-frame" aria-label="InspireSpace 无限画布">
          <InfiniteCanvas />
          <FolderFocus />
          <CardEditor />
          <div className={`ambient-save is-${saveState}`} title={saveLabel[saveState]} aria-label={saveLabel[saveState]}><span /></div>
        </section>
      )}

      <WindowChrome />

      {loading ? (
        <div className="loading-screen" role="status" aria-live="polite">
          <div className="loading-mark"><span /><span /></div>
          <p>正在准备你的灵感空间…</p>
        </div>
      ) : null}

      {error ? (
        <button className="error-toast" type="button" onClick={() => setError(null)}>
          <strong>操作没有完成</strong><span>{error}</span><small>点击关闭</small>
        </button>
      ) : null}
    </main>
  );
}
