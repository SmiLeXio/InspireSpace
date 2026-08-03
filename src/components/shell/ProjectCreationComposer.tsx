import { gsap } from "gsap";
import { Check, FolderPlus, LoaderCircle, Sparkles, X } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

interface ProjectCreationComposerProps {
  browserMode: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<boolean>;
}

const prefersReducedMotion = () => typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ProjectCreationComposer({ browserMode, onClose, onCreate }: ProjectCreationComposerProps) {
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closingRef = useRef(false);
  const composingRef = useRef(false);
  const [name, setName] = useState("我的灵感空间");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    closingRef.current = false;
    const reduceMotion = prefersReducedMotion();
    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set(root, { height: "auto", marginTop: 12, opacity: 1, y: 0 });
      } else {
        gsap.fromTo(root,
          { height: 0, marginTop: 0, opacity: 0, y: -10 },
          { height: "auto", marginTop: 12, opacity: 1, y: 0, duration: 0.46, ease: "power4.out" },
        );
        gsap.fromTo(".project-name-composer-main > *",
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.32, stagger: 0.04, delay: 0.08, ease: "power3.out" },
        );
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
  }, []);

  const closeWithAnimation = useCallback(() => {
    if (closingRef.current || submitting) return;
    closingRef.current = true;
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) {
      onClose();
      return;
    }
    gsap.killTweensOf(root);
    gsap.to(root, {
      height: 0,
      marginTop: 0,
      opacity: 0,
      y: -8,
      duration: 0.24,
      ease: "power2.inOut",
      overwrite: true,
      onComplete: onClose,
    });
  }, [onClose, submitting]);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeWithAnimation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeWithAnimation]);

  const showError = (message: string) => {
    setError(message);
    inputRef.current?.focus();
    if (rootRef.current && !prefersReducedMotion()) {
      gsap.fromTo(rootRef.current,
        { x: 0 },
        { keyframes: { x: [0, -5, 4, -3, 2, 0] }, duration: 0.36, ease: "power2.out", overwrite: true },
      );
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || composingRef.current) return;
    const normalizedName = name.trim();
    if (!normalizedName) {
      showError("请输入项目名称");
      return;
    }

    setSubmitting(true);
    setError("");
    const created = await onCreate(normalizedName);
    if (!created) {
      setSubmitting(false);
      showError("项目未能创建，请检查提示后重试");
    }
  };

  return (
    <form
      ref={rootRef}
      className={`project-name-composer ${error ? "has-error" : ""}`}
      onSubmit={(event) => void submit(event)}
      aria-labelledby="project-name-composer-heading"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="project-name-composer-heading">
        <span id="project-name-composer-heading"><Sparkles size={11} /> NEW PROJECT</span>
        <small>{browserMode ? "LOCAL BROWSER SPACE" : "LOCAL WORKSPACE"}</small>
      </div>

      <div className="project-name-composer-main">
        <div className="project-name-composer-symbol" aria-hidden="true"><FolderPlus size={19} /></div>
        <label className="project-name-composer-field">
          <span>项目名称</span>
          <input
            ref={inputRef}
            value={name}
            maxLength={48}
            aria-label="项目名称"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "project-name-composer-error" : "project-name-composer-helper"}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError("");
            }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (composingRef.current || event.nativeEvent.isComposing)) event.preventDefault();
            }}
            placeholder="输入项目名称"
          />
          <small>{name.length}/48</small>
        </label>
        <button className="project-name-composer-action is-cancel" type="button" onClick={closeWithAnimation} disabled={submitting} aria-label="取消新建项目">
          <X size={15} />
        </button>
        <button className="project-name-composer-action is-confirm" type="submit" disabled={!name.trim() || submitting} aria-label="创建项目">
          {submitting ? <LoaderCircle className="project-name-composer-spinner" size={16} /> : <Check size={16} />}
        </button>
      </div>

      <div className="project-name-composer-footer">
        <span id="project-name-composer-helper">
          {browserMode ? "项目将保存在此浏览器的本地空间 · Enter 创建" : "使用刚才选择的位置创建项目文件夹 · Enter 创建"}
        </span>
        {error ? <span id="project-name-composer-error" role="alert">{error}</span> : null}
      </div>
    </form>
  );
}
