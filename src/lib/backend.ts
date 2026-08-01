import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { CanvasNode, ImportKind, MediaAsset, Viewport, WorkspaceSnapshot } from "../types/canvas";
import { DEFAULT_VIEWPORT } from "../types/canvas";

const BROWSER_ACTIVE_KEY = "inspirespace-browser-active-project";
const BROWSER_PREFIX = "inspirespace-browser-project:";
let activeBrowserProject = localStorage.getItem(BROWSER_ACTIVE_KEY) || "演练项目";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

const emptySnapshot = (rootPath: string): WorkspaceSnapshot => ({
  rootPath,
  nodes: [],
  viewport: DEFAULT_VIEWPORT,
});

const browserKey = (path = activeBrowserProject) => `${BROWSER_PREFIX}${path}`;

const loadBrowserSnapshot = (path = activeBrowserProject): WorkspaceSnapshot => {
  const raw = localStorage.getItem(browserKey(path));
  if (!raw) return emptySnapshot(path);
  try {
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    return {
      ...parsed,
      rootPath: path,
      viewport: parsed.viewport ?? DEFAULT_VIEWPORT,
      nodes: parsed.nodes ?? [],
    };
  } catch {
    return emptySnapshot(path);
  }
};

const saveBrowserSnapshot = (snapshot: WorkspaceSnapshot) => {
  localStorage.setItem(browserKey(snapshot.rootPath), JSON.stringify(snapshot));
};

const activateBrowserProject = (path: string) => {
  activeBrowserProject = path;
  localStorage.setItem(BROWSER_ACTIVE_KEY, path);
};

const mediaFilters: Record<ImportKind, { name: string; extensions: string[]; accept: string }> = {
  image: {
    name: "图片",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "tiff", "tif", "bmp", "ico", "icns", "heic", "raw", "exr", "hdr"],
    accept: ".png,.jpg,.jpeg,.gif,.webp,.tiff,.tif,.bmp,.ico,.icns,.heic,.raw,.exr,.hdr,image/*",
  },
  video: {
    name: "视频",
    extensions: ["mp4", "mov", "gif", "webp", "webm", "avi"],
    accept: ".mp4,.mov,.gif,.webp,.webm,.avi,video/*",
  },
  document: {
    name: "文档",
    extensions: ["md", "txt", "rtf", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "json"],
    accept: ".md,.txt,.rtf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,text/plain,text/markdown,application/pdf",
  },
};

const browserFileAsset = async (file: File): Promise<MediaAsset> => {
  const isText = ["text/plain", "text/markdown", "text/rtf", "application/rtf", "application/json", "text/csv"].includes(file.type)
    || /\.(md|txt|rtf|json|csv)$/i.test(file.name);
  return {
    relativePath: URL.createObjectURL(file),
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    content: isText ? await file.text() : null,
  };
};

const chooseBrowserMedia = (kind: ImportKind) =>
  new Promise<MediaAsset | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = mediaFilters[kind].accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve(await browserFileAsset(file));
    };
    input.oncancel = () => resolve(null);
    input.click();
  });

export const backend = {
  isTauriRuntime,

  async chooseDirectory(): Promise<string | null> {
    if (!isTauriRuntime()) return window.prompt("请输入项目路径或名称", "我的灵感空间");
    const selected = await open({ multiple: false, directory: true, title: "选择项目文件夹" });
    return typeof selected === "string" ? selected : null;
  },

  async openWorkspace(path: string): Promise<WorkspaceSnapshot> {
    if (isTauriRuntime()) return invoke<WorkspaceSnapshot>("open_workspace", { path });
    activateBrowserProject(path);
    return loadBrowserSnapshot(path);
  },

  async createWorkspace(parentPath: string, name: string): Promise<WorkspaceSnapshot> {
    if (isTauriRuntime()) return invoke<WorkspaceSnapshot>("create_workspace", { parentPath, name });
    const path = `${parentPath.replace(/[\\/]+$/, "")}/${name}`;
    activateBrowserProject(path);
    const snapshot = emptySnapshot(path);
    saveBrowserSnapshot(snapshot);
    return snapshot;
  },

  async openDemoWorkspace(): Promise<WorkspaceSnapshot> {
    if (isTauriRuntime()) return invoke<WorkspaceSnapshot>("open_default_workspace");
    activateBrowserProject("演练项目");
    return loadBrowserSnapshot("演练项目");
  },

  async cloneRepository(url: string, parentPath: string, name: string): Promise<WorkspaceSnapshot> {
    if (!isTauriRuntime()) throw new Error("浏览器演示模式不支持克隆 Git 仓库");
    return invoke<WorkspaceSnapshot>("clone_repository", { url, parentPath, name });
  },

  async upsertNode(node: CanvasNode): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("upsert_node", { node });
      return;
    }
    const snapshot = loadBrowserSnapshot();
    const index = snapshot.nodes.findIndex((item) => item.id === node.id);
    if (index === -1) snapshot.nodes.push(node);
    else snapshot.nodes[index] = node;
    saveBrowserSnapshot(snapshot);
  },

  async deleteNode(id: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_node", { id });
      return;
    }
    const snapshot = loadBrowserSnapshot();
    snapshot.nodes = snapshot.nodes.filter((node) => node.id !== id);
    saveBrowserSnapshot(snapshot);
  },

  async saveTextContent(id: string, content: string): Promise<string> {
    if (isTauriRuntime()) return invoke<string>("save_text_content", { id, content });
    const snapshot = loadBrowserSnapshot();
    const node = snapshot.nodes.find((item) => item.id === id);
    if (node) node.content = content;
    saveBrowserSnapshot(snapshot);
    return `notes/${id}.md`;
  },

  async saveViewport(viewport: Viewport): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("save_viewport", { viewport });
      return;
    }
    const snapshot = loadBrowserSnapshot();
    snapshot.viewport = viewport;
    saveBrowserSnapshot(snapshot);
  },

  async importExternalMedia(source: string | File, kind: ImportKind): Promise<MediaAsset> {
    if (source instanceof File) return browserFileAsset(source);
    if (!isTauriRuntime()) throw new Error("浏览器模式无法读取本地文件路径");
    return invoke<MediaAsset>("import_media", { sourcePath: source, kind });
  },

  async chooseAndImportMedia(kind: ImportKind): Promise<MediaAsset | null> {
    if (!isTauriRuntime()) return chooseBrowserMedia(kind);
    const config = mediaFilters[kind];
    const sourcePath = await open({
      multiple: false,
      directory: false,
      title: `导入${config.name}`,
      filters: [{ name: config.name, extensions: config.extensions }],
    });
    if (!sourcePath || Array.isArray(sourcePath)) return null;
    return invoke<MediaAsset>("import_media", { sourcePath, kind });
  },
};

export const resolveMediaUrl = (rootPath: string, mediaPath: string | null) => {
  if (!mediaPath) return "";
  if (/^(blob:|data:|https?:)/i.test(mediaPath)) return mediaPath;
  if (!isTauriRuntime()) return mediaPath;

  const separator = rootPath.includes("\\") ? "\\" : "/";
  const absolute = `${rootPath.replace(/[\\/]+$/, "")}${separator}${mediaPath.replace(/[\\/]+/g, separator)}`;
  return convertFileSrc(absolute);
};
