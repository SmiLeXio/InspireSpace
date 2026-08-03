import { gsap } from "gsap";
import { ArrowRight, Clock3, FolderOpen, GitBranch, Plus, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { backend } from "../../lib/backend";
import { useCanvasStore } from "../../store/useCanvasStore";
import { ProjectCreationComposer } from "./ProjectCreationComposer";

const defaultCloneName = (url: string) => {
  const name = url.split(/[\\/]/).at(-1)?.replace(/\.git$/i, "").trim();
  return name || "克隆项目";
};

export function WelcomeScreen() {
  const rootRef = useRef<HTMLElement>(null);
  const recentProjects = useCanvasStore((state) => state.recentProjects);
  const openProject = useCanvasStore((state) => state.openProject);
  const createProject = useCanvasStore((state) => state.createProject);
  const cloneProject = useCanvasStore((state) => state.cloneProject);
  const openDemo = useCanvasStore((state) => state.openDemo);
  const setError = useCanvasStore((state) => state.setError);
  const browserMode = !backend.isTauriRuntime();
  const [projectParent, setProjectParent] = useState<string | null>(null);
  const [introAnimating, setIntroAnimating] = useState(true);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: () => setIntroAnimating(false),
      });
      timeline
        .fromTo(".welcome-brand", { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.55 })
        .fromTo(".welcome-copy > *", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.62, stagger: 0.08 }, "-=0.28")
        .fromTo(".welcome-actions button", { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.42, stagger: 0.06 }, "-=0.36")
        .fromTo(".welcome-demo-card", { opacity: 0, scale: 0.94, rotate: 1.5 }, { opacity: 1, scale: 1, rotate: 0, duration: 0.72 }, "-=0.48")
        .fromTo(".recent-project", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.38, stagger: 0.04 }, "-=0.3");
    }, rootRef);
    return () => ctx.revert();
  }, []);

  const handleOpen = async () => {
    setProjectParent(null);
    const path = await backend.chooseDirectory();
    if (path) await openProject(path);
  };

  const handleCreate = async () => {
    if (projectParent) return;
    const parent = browserMode ? "InspireSpace" : await backend.chooseDirectory();
    if (parent) setProjectParent(parent);
  };

  const submitProjectCreation = async (name: string) => {
    if (!projectParent) return false;
    await createProject(projectParent, name);
    return useCanvasStore.getState().screen === "canvas";
  };

  const handleClone = async () => {
    setProjectParent(null);
    const url = window.prompt("Git 仓库地址", "https://github.com/")?.trim();
    if (!url) return;
    const parent = await backend.chooseDirectory();
    if (!parent) return;
    const name = window.prompt("本地项目名称", defaultCloneName(url))?.trim();
    if (name) await cloneProject(url, parent, name);
  };

  return (
    <main ref={rootRef} className={`welcome-screen${introAnimating ? " is-intro-animating" : ""}`}>
      <div className="welcome-aurora one" /><div className="welcome-aurora two" />
      <header className="welcome-brand"><div className="brand-mark"><Sparkles size={18} /></div><strong>InspireSpace</strong><span>灵感空间</span></header>

      <section className="welcome-layout">
        <div className="welcome-left">
          <div className="welcome-copy">
            <span className="welcome-kicker">本地优先 · 无限画布</span>
            <h1>从一个空白空间，<br />开始组织你的灵感。</h1>
            <p>笔记、便签、网页、图片、视频与插件，都能在同一个画布上自然生长。</p>
          </div>

          <div className="welcome-actions">
            <button type="button" className="primary" onClick={handleOpen}><FolderOpen size={18} /><span><b>打开项目</b><small>选择已有本地文件夹</small></span><ArrowRight size={16} /></button>
            <button type="button" className={projectParent ? "is-active" : undefined} onClick={() => void handleCreate()} aria-expanded={Boolean(projectParent)}><Plus size={18} /><span><b>新建项目</b><small>{projectParent ? "输入名称后创建" : "创建一个新的灵感空间"}</small></span><ArrowRight size={16} /></button>
            <button type="button" onClick={handleClone}><GitBranch size={18} /><span><b>克隆 Git 仓库</b><small>从远程仓库开始工作</small></span><ArrowRight size={16} /></button>
          </div>

          {projectParent ? (
            <ProjectCreationComposer
              browserMode={browserMode}
              onClose={() => setProjectParent(null)}
              onCreate={submitProjectCreation}
            />
          ) : null}

          <div className="recent-section">
            <div className="recent-heading"><span>最近打开</span><small>{recentProjects.length ? `${recentProjects.length} 个项目` : "暂无项目"}</small></div>
            <div className="recent-list">
              {recentProjects.map((project) => (
                <button className="recent-project" key={project.path} type="button" onClick={() => void openProject(project.path, project.name)}>
                  <span className="recent-icon">{project.name.slice(0, 1).toUpperCase()}</span>
                  <span><b>{project.name}</b><small>{project.path}</small></span>
                  <ArrowRight size={15} />
                </button>
              ))}
              {!recentProjects.length ? <div className="recent-empty">打开或新建项目后，它会出现在这里。</div> : null}
            </div>
          </div>
        </div>

        <aside className="welcome-demo-card">
          <div className="demo-card-top"><span><Clock3 size={14} /> 默认</span><i>演练空间</i></div>
          <div className="demo-canvas-preview">
            <div className="demo-grid" />
            <div className="demo-note yellow"><b>今天</b><span>收集一个闪念</span></div>
            <div className="demo-note paper"><b>工作笔记</b><span>想法并不会按顺序出现。</span></div>
            <div className="demo-clock"><Clock3 size={34} /><b>10:24</b></div>
          </div>
          <div className="demo-card-copy"><span>不确定从哪里开始？</span><h2>先进入演练空间</h2><p>体验右键创建、框选堆叠、文件夹聚焦和自由缩放。</p></div>
          <button type="button" onClick={() => void openDemo()}>开始演练 <ArrowRight size={16} /></button>
        </aside>
      </section>

      <footer>所有内容默认保存在本地。你始终拥有自己的数据。</footer>
      <button className="welcome-error-reset" type="button" onClick={() => setError(null)} aria-hidden="true" tabIndex={-1} />
    </main>
  );
}


