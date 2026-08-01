import { create } from "zustand";
import { backend } from "../lib/backend";
import { compactStackLayout } from "../lib/stackLayout";
import type {
  AppScreen,
  CanvasNode,
  CanvasNodeType,
  FolderIconKey,
  ImageHotspot,
  ImportKind,
  RecentProject,
  SaveState,
  Viewport,
  WorkspaceSnapshot,
} from "../types/canvas";
import { DEFAULT_VIEWPORT, STICKY_COLORS } from "../types/canvas";

interface HistoryEntry {
  before: CanvasNode[];
  after: CanvasNode[];
}

interface CanvasStore {
  screen: AppScreen;
  workspaceRoot: string;
  projectName: string;
  recentProjects: RecentProject[];
  nodes: CanvasNode[];
  viewport: Viewport;
  selectedIds: string[];
  editingId: string | null;
  openFolderId: string | null;
  hydrated: boolean;
  loading: boolean;
  saveState: SaveState;
  error: string | null;
  stackNotice: { id: number; message: string } | null;
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
  openProject: (path: string, name?: string) => Promise<void>;
  createProject: (parentPath: string, name: string) => Promise<void>;
  cloneProject: (url: string, parentPath: string, name: string) => Promise<void>;
  openDemo: () => Promise<void>;
  leaveProject: () => void;
  createNode: (type: CanvasNodeType, point?: { x: number; y: number }, extras?: Partial<CanvasNode>) => CanvasNode;
  createFolder: (childIds?: string[], point?: { x: number; y: number }, options?: { title?: string; color?: string; folderIcon?: FolderIconKey }) => CanvasNode;
  importMedia: (kind: ImportKind, point?: { x: number; y: number }) => Promise<CanvasNode | null>;
  importExternalFiles: (sources: Array<string | File>, point: { x: number; y: number }) => Promise<CanvasNode[]>;
  createFromText: (text: string, point?: { x: number; y: number }) => CanvasNode | null;
  updateNode: (id: string, patch: Partial<CanvasNode>, persist?: boolean) => void;
  previewNodes: (patches: Array<{ id: string; patch: Partial<CanvasNode> }>) => void;
  commitLayout: (before: CanvasNode[]) => void;
  finishDrag: (before: CanvasNode[], patches: Array<{ id: string; patch: Partial<CanvasNode> }>, dropTargetId?: string | null) => void;
  extractNodeFromFolder: (id: string, point: { x: number; y: number }) => void;
  updateNodeLayout: (id: string, patch: Partial<CanvasNode>) => void;
  selectOnly: (id: string | null) => void;
  toggleSelection: (id: string) => void;
  selectMany: (ids: string[], additive?: boolean) => void;
  openEditor: (id: string) => void;
  closeEditor: () => void;
  openFolder: (id: string) => void;
  closeFolder: () => void;
  deleteNodes: (ids: string[]) => Promise<void>;
  deleteSelected: () => Promise<void>;
  stackSelected: () => void;
  unstack: (stackId: string) => void;
  addImageHotspot: (nodeId: string, hotspot: Omit<ImageHotspot, "id">) => void;
  updateImageHotspot: (nodeId: string, hotspotId: string, patch: Partial<Pick<ImageHotspot, "label" | "description">>) => void;
  removeImageHotspot: (nodeId: string, hotspotId: string) => void;
  setViewport: (viewport: Viewport, persist?: boolean) => void;
  undo: () => void;
  redo: () => void;
  setError: (error: string | null) => void;
  clearStackNotice: () => void;
}

const RECENTS_KEY = "inspirespace-recent-projects-v2";
const HISTORY_LIMIT = 60;
const nodeSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let viewportSaveTimer: ReturnType<typeof setTimeout> | undefined;
let savedStateTimer: ReturnType<typeof setTimeout> | undefined;

const uniqueId = () =>
  globalThis.crypto?.randomUUID?.() ?? `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => Date.now();
const cloneNodes = (nodes: CanvasNode[]) => nodes.map((node) => ({ ...node, hotspots: node.hotspots.map((hotspot) => ({ ...hotspot })) }));

const projectNameFromPath = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).at(-1) || "未命名项目";

const loadRecents = (): RecentProject[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]") as RecentProject[];
  } catch {
    return [];
  }
};

const rememberProject = (project: RecentProject) => {
  const next = [project, ...loadRecents().filter((item) => item.path !== project.path)]
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, 8);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  return next;
};

const canvasSizeEstimate = () => ({
  width: Math.max(760, window.innerWidth),
  height: Math.max(520, window.innerHeight),
});

const visibleCenter = (viewport: Viewport) => {
  const canvas = canvasSizeEstimate();
  return {
    x: (canvas.width * 0.5 - viewport.x) / viewport.scale,
    y: (canvas.height * 0.5 - viewport.y) / viewport.scale,
  };
};

const nextZIndex = (nodes: CanvasNode[]) =>
  nodes.reduce((highest, node) => Math.max(highest, node.zIndex), 0) + 1;

const normalizeNode = (node: CanvasNode): CanvasNode => ({
  ...node,
  type: node.type === "sheet" ? "note" : node.type,
  parentId: node.parentId ?? null,
  stackId: node.stackId ?? null,
  stackOrder: node.stackOrder ?? null,
  stackAnchorX: node.stackAnchorX ?? null,
  stackAnchorY: node.stackAnchorY ?? null,
  stackTitle: node.stackTitle ?? null,
  url: node.url ?? null,
  pluginKind: node.pluginKind ?? null,
  folderIcon: node.folderIcon ?? (node.type === "folder" ? "folder" : null),
  hotspots: node.hotspots ?? [],
});

const starterNodes = (): CanvasNode[] => {
  const timestamp = now();
  return [
    {
      id: uniqueId(), type: "sticky", x: -430, y: -180, width: 300, height: 220, zIndex: 1,
      color: STICKY_COLORS[1].value, title: "", content: "今天\n\n收集一个闪念，拖动它，看看它会和什么产生连接。",
      filePath: null, mediaPath: null, mediaName: null, parentId: null, stackId: null, stackOrder: null, stackAnchorX: null, stackAnchorY: null, stackTitle: null, url: null, pluginKind: null, folderIcon: null, hotspots: [],
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: uniqueId(), type: "note", x: -70, y: -245, width: 390, height: 430, zIndex: 2,
      color: "#fbfbfa", title: "工作笔记", content: "想法并不会按顺序出现。\n\n把有用的片段留在画布上，移动、组合，然后让结构自然浮现。",
      filePath: null, mediaPath: null, mediaName: null, parentId: null, stackId: null, stackOrder: null, stackAnchorX: null, stackAnchorY: null, stackTitle: null, url: null, pluginKind: null, folderIcon: null, hotspots: [],
      createdAt: timestamp + 1, updatedAt: timestamp + 1,
    },
    {
      id: uniqueId(), type: "plugin", x: 390, y: -70, width: 300, height: 250, zIndex: 3,
      color: "#252726", title: "本地时间", content: "", filePath: null, mediaPath: null, mediaName: null,
      parentId: null, stackId: null, stackOrder: null, stackAnchorX: null, stackAnchorY: null, stackTitle: null, url: null, pluginKind: "clock", folderIcon: null, hotspots: [], createdAt: timestamp + 2, updatedAt: timestamp + 2,
    },
  ];
};

const nodeDefaults: Record<CanvasNodeType, { width: number; height: number; title: string; color: string | null }> = {
  note: { width: 390, height: 430, title: "未命名笔记", color: "#fbfbfa" },
  sheet: { width: 390, height: 430, title: "未命名笔记", color: "#fbfbfa" },
  sticky: { width: 300, height: 220, title: "", color: STICKY_COLORS[0].value },
  folder: { width: 330, height: 230, title: "新建文件夹", color: "#d7c7a5" },
  web: { width: 440, height: 320, title: "网络卡片", color: "#f7f8f7" },
  video: { width: 440, height: 300, title: "视频", color: "#171918" },
  image: { width: 380, height: 280, title: "图片", color: "#fbfbfa" },
  document: { width: 360, height: 400, title: "文档", color: "#fbfbfa" },
  plugin: { width: 300, height: 250, title: "时钟", color: "#252726" },
};

const historySignature = (nodes: CanvasNode[]) =>
  JSON.stringify(nodes.map(({ id, type, x, y, width, height, zIndex, color, title, parentId, stackId, stackOrder, stackAnchorX, stackAnchorY, stackTitle, folderIcon, hotspots }) => ({
    id, type, x, y, width, height, zIndex, color, title, parentId, stackId, stackOrder, stackAnchorX, stackAnchorY, stackTitle, folderIcon, hotspots,
  })));

const clearStackFields = (node: CanvasNode): CanvasNode => ({
  ...node,
  stackId: null,
  stackOrder: null,
  stackAnchorX: null,
  stackAnchorY: null,
  stackTitle: null,
  updatedAt: now(),
});


const compactStackMembers = (nodes: CanvasNode[], stackId: string): CanvasNode[] => {
  const members = nodes
    .filter((node) => !node.parentId && node.stackId === stackId)
    .sort((a, b) => (a.stackOrder ?? a.zIndex) - (b.stackOrder ?? b.zIndex));
  if (!members.length) return nodes;
  const reference = members.find((node) => node.stackAnchorX != null && node.stackAnchorY != null) ?? members.at(-1)!;
  const anchorX = reference.stackAnchorX ?? reference.x;
  const anchorY = reference.stackAnchorY ?? reference.y;
  const title = reference.stackTitle || "未命名堆叠";
  if (members.length === 1) {
    return nodes.map((node) => node.id === members[0].id
      ? clearStackFields({ ...node, x: anchorX, y: anchorY })
      : node);
  }
  const orderById = new Map(members.map((node, order) => [node.id, order]));
  const compactLayout = compactStackLayout(members, anchorX, anchorY);
  return nodes.map((node) => {
    const order = orderById.get(node.id);
    if (order == null) return node;
    const position = compactLayout.positions.get(node.id)!;
    return {
      ...node,
      ...position,
      stackId,
      stackOrder: order,
      stackAnchorX: anchorX,
      stackAnchorY: anchorY,
      stackTitle: title,
      updatedAt: now(),
    };
  });
};

const repairStacks = (nodes: CanvasNode[]) => {
  let repaired = nodes;
  const stackIds = Array.from(new Set(nodes.flatMap((node) => node.stackId ? [node.stackId] : [])));
  for (const stackId of stackIds) repaired = compactStackMembers(repaired, stackId);
  return repaired;
};

const normalizeWorkspaceNodes = (nodes: CanvasNode[]) => repairStacks(nodes.map(normalizeNode));

const markSaved = (set: (patch: Partial<CanvasStore>) => void) => {
  set({ saveState: "saved" });
  if (savedStateTimer) clearTimeout(savedStateTimer);
  savedStateTimer = setTimeout(() => set({ saveState: "idle" }), 1600);
};

const needsMarkdownFile = (node: CanvasNode) =>
  node.type === "note" || node.type === "sticky" || node.type === "sheet"
  || (node.type === "document" && Boolean(node.content));

const persistNode = async (node: CanvasNode, set: (patch: Partial<CanvasStore>) => void) => {
  try {
    let nodeToPersist = node;
    if (needsMarkdownFile(node)) {
      const filePath = await backend.saveTextContent(node.id, node.content);
      nodeToPersist = { ...node, filePath };
      useCanvasStore.setState((state) => ({
        nodes: state.nodes.map((item) => item.id === node.id ? { ...item, filePath } : item),
      }));
    }
    await backend.upsertNode(nodeToPersist);
    markSaved(set);
  } catch (error) {
    set({ saveState: "error", error: error instanceof Error ? error.message : String(error) });
  }
};

const scheduleNodeSave = (node: CanvasNode, set: (patch: Partial<CanvasStore>) => void) => {
  set({ saveState: "saving" });
  const existing = nodeSaveTimers.get(node.id);
  if (existing) clearTimeout(existing);
  nodeSaveTimers.set(node.id, setTimeout(() => {
    nodeSaveTimers.delete(node.id);
    void persistNode(useCanvasStore.getState().nodes.find((item) => item.id === node.id) ?? node, set);
  }, 360));
};

const syncHistoryChange = (
  before: CanvasNode[],
  after: CanvasNode[],
  set: (patch: Partial<CanvasStore>) => void,
) => {
  const afterIds = new Set(after.map((node) => node.id));
  const removed = before.filter((node) => !afterIds.has(node.id));
  for (const node of removed) {
    const timer = nodeSaveTimers.get(node.id);
    if (timer) clearTimeout(timer);
    nodeSaveTimers.delete(node.id);
    void backend.deleteNode(node.id).catch((error) =>
      set({ saveState: "error", error: error instanceof Error ? error.message : String(error) }));
  }
  for (const node of after) scheduleNodeSave(node, set);
};

const mergeHistoryTarget = (target: CanvasNode[], current: CanvasNode[]) => {
  const currentMap = new Map(current.map((node) => [node.id, node]));
  return target.map((targetNode) => {
    const live = currentMap.get(targetNode.id);
    if (!live) return { ...targetNode };
    return {
      ...targetNode,
      ...live,
      x: targetNode.x,
      y: targetNode.y,
      width: targetNode.width,
      height: targetNode.height,
      zIndex: targetNode.zIndex,
      parentId: targetNode.parentId,
      stackId: targetNode.stackId,
      stackOrder: targetNode.stackOrder,
      stackAnchorX: targetNode.stackAnchorX,
      stackAnchorY: targetNode.stackAnchorY,
      stackTitle: targetNode.stackTitle,
      hotspots: targetNode.hotspots.map((hotspot) => ({ ...hotspot })),
      updatedAt: now(),
    };
  });
};

const addHistory = (
  before: CanvasNode[],
  after: CanvasNode[],
  set: (patch: Partial<CanvasStore>) => void,
  get: () => CanvasStore,
) => {
  if (historySignature(before) === historySignature(after)) return false;
  set({
    historyPast: [...get().historyPast, { before: cloneNodes(before), after: cloneNodes(after) }].slice(-HISTORY_LIMIT),
    historyFuture: [],
  });
  return true;
};

const createBaseNode = (
  type: CanvasNodeType,
  nodes: CanvasNode[],
  viewport: Viewport,
  point?: { x: number; y: number },
  extras: Partial<CanvasNode> = {},
): CanvasNode => {
  const defaults = nodeDefaults[type];
  const center = point ?? visibleCenter(viewport);
  const timestamp = now();
  const width = extras.width ?? defaults.width;
  const height = extras.height ?? defaults.height;
  return {
    id: extras.id ?? uniqueId(),
    type,
    x: extras.x ?? center.x - width / 2,
    y: extras.y ?? center.y - height / 2,
    width,
    height,
    zIndex: extras.zIndex ?? nextZIndex(nodes),
    color: extras.color ?? defaults.color,
    title: extras.title ?? defaults.title,
    content: extras.content ?? "",
    filePath: extras.filePath ?? null,
    mediaPath: extras.mediaPath ?? null,
    mediaName: extras.mediaName ?? null,
    parentId: extras.parentId ?? null,
    stackId: extras.stackId ?? null,
    stackOrder: extras.stackOrder ?? null,
    stackAnchorX: extras.stackAnchorX ?? null,
    stackAnchorY: extras.stackAnchorY ?? null,
    stackTitle: extras.stackTitle ?? null,
    url: extras.url ?? null,
    pluginKind: extras.pluginKind ?? null,
    folderIcon: extras.folderIcon ?? (type === "folder" ? "folder" : null),
    hotspots: extras.hotspots ?? [],
    createdAt: extras.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
};

const mediaNodeType = (kind: ImportKind): CanvasNodeType => kind;

const externalImportKind = (source: string | File): ImportKind | null => {
  const name = typeof source === "string" ? source : source.name;
  const mime = typeof source === "string" ? "" : source.type.toLowerCase();
  const extension = name.split(/[\\/]/).at(-1)?.split(".").at(-1)?.toLowerCase() || "";
  if (mime.startsWith("video/") || ["mp4", "mov", "webm", "avi", "m4v"].includes(extension)) return "video";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "tiff", "tif", "bmp", "ico", "icns", "heic", "raw", "exr", "hdr"].includes(extension)) return "image";
  if (["md", "txt", "rtf", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "json"].includes(extension)
    || mime.startsWith("text/") || mime === "application/pdf" || mime.includes("officedocument")) return "document";
  return null;
};

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  screen: "welcome",
  workspaceRoot: "",
  projectName: "",
  recentProjects: loadRecents(),
  nodes: [],
  viewport: DEFAULT_VIEWPORT,
  selectedIds: [],
  editingId: null,
  openFolderId: null,
  hydrated: false,
  loading: false,
  saveState: "idle",
  error: null,
  stackNotice: null,
  historyPast: [],
  historyFuture: [],

  openProject: async (path, name) => {
    set({ loading: true, error: null });
    try {
      const snapshot = await backend.openWorkspace(path);
      const projectName = name || projectNameFromPath(snapshot.rootPath);
      set({
        screen: "canvas", workspaceRoot: snapshot.rootPath, projectName,
        nodes: normalizeWorkspaceNodes(snapshot.nodes), viewport: snapshot.viewport ?? DEFAULT_VIEWPORT,
        selectedIds: [], editingId: null, openFolderId: null, hydrated: true, loading: false,
        historyPast: [], historyFuture: [], recentProjects: rememberProject({ name: projectName, path: snapshot.rootPath, openedAt: now() }),
      });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  createProject: async (parentPath, name) => {
    set({ loading: true, error: null });
    try {
      const snapshot = await backend.createWorkspace(parentPath, name);
      set({
        screen: "canvas", workspaceRoot: snapshot.rootPath, projectName: name,
        nodes: normalizeWorkspaceNodes(snapshot.nodes), viewport: snapshot.viewport ?? DEFAULT_VIEWPORT,
        selectedIds: [], editingId: null, openFolderId: null, hydrated: true, loading: false,
        historyPast: [], historyFuture: [], recentProjects: rememberProject({ name, path: snapshot.rootPath, openedAt: now() }),
      });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  cloneProject: async (url, parentPath, name) => {
    set({ loading: true, error: null });
    try {
      const snapshot = await backend.cloneRepository(url, parentPath, name);
      const projectName = name || projectNameFromPath(snapshot.rootPath);
      set({
        screen: "canvas", workspaceRoot: snapshot.rootPath, projectName,
        nodes: normalizeWorkspaceNodes(snapshot.nodes), viewport: snapshot.viewport ?? DEFAULT_VIEWPORT,
        selectedIds: [], editingId: null, openFolderId: null, hydrated: true, loading: false,
        historyPast: [], historyFuture: [], recentProjects: rememberProject({ name: projectName, path: snapshot.rootPath, openedAt: now() }),
      });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  openDemo: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await backend.openDemoWorkspace();
      const nodes = snapshot.nodes.length ? normalizeWorkspaceNodes(snapshot.nodes) : starterNodes();
      set({
        screen: "canvas", workspaceRoot: snapshot.rootPath, projectName: "演练",
        nodes, viewport: snapshot.nodes.length ? snapshot.viewport : { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 0.92 },
        selectedIds: [], editingId: null, openFolderId: null, hydrated: true, loading: false,
        historyPast: [], historyFuture: [],
      });
      if (!snapshot.nodes.length) for (const node of nodes) scheduleNodeSave(node, set);
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  leaveProject: () => set({
    screen: "welcome", nodes: [], workspaceRoot: "", projectName: "", selectedIds: [],
    editingId: null, openFolderId: null, hydrated: false, historyPast: [], historyFuture: [], saveState: "idle",
  }),

  createNode: (type, point, extras = {}) => {
    const state = get();
    const before = cloneNodes(state.nodes);
    const node = createBaseNode(type, state.nodes, state.viewport, point, extras);
    const after = [...state.nodes, node];
    set({ nodes: after, selectedIds: [node.id] });
    addHistory(before, after, set, get);
    scheduleNodeSave(node, set);
    return node;
  },

  createFolder: (childIds = get().selectedIds, point, options = {}) => {
    const state = get();
    const validChildren = state.nodes.filter((node) => childIds.includes(node.id) && !node.parentId);
    const before = cloneNodes(state.nodes);
    let folderPoint = point;
    if (!folderPoint && validChildren.length) {
      const minX = Math.min(...validChildren.map((node) => node.x));
      const minY = Math.min(...validChildren.map((node) => node.y));
      const maxX = Math.max(...validChildren.map((node) => node.x + node.width));
      const maxY = Math.max(...validChildren.map((node) => node.y + node.height));
      folderPoint = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    const folder = createBaseNode("folder", state.nodes, state.viewport, folderPoint, {
      title: options.title?.trim() || "新建文件夹",
      color: options.color || "#d7c7a5",
      folderIcon: options.folderIcon || "folder",
      content: validChildren.length ? `${validChildren.length} 个项目` : "空文件夹",
    });
    const nextNodes = state.nodes.map((node) => validChildren.some((child) => child.id === node.id)
      ? clearStackFields({ ...node, parentId: folder.id })
      : node);
    const after = [...nextNodes, folder];
    set({ nodes: after, selectedIds: [folder.id] });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
    return folder;
  },

  importMedia: async (kind, point) => {
    try {
      const asset = await backend.chooseAndImportMedia(kind);
      if (!asset) return null;
      const node = get().createNode(mediaNodeType(kind), point, {
        title: asset.fileName,
        content: asset.content ?? asset.mimeType,
        mediaPath: asset.relativePath,
        mediaName: asset.fileName,
      });
      return node;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  importExternalFiles: async (sources, point) => {
    const imported: CanvasNode[] = [];
    const unsupported: string[] = [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const kind = externalImportKind(source);
      const name = typeof source === "string" ? source.split(/[\\/]/).at(-1) || source : source.name;
      if (!kind) {
        unsupported.push(name);
        continue;
      }
      try {
        const asset = await backend.importExternalMedia(source, kind);
        const column = index % 4;
        const row = Math.floor(index / 4);
        imported.push(get().createNode(mediaNodeType(kind), {
          x: point.x + column * 42,
          y: point.y + row * 34,
        }, {
          title: asset.fileName,
          content: asset.content ?? asset.mimeType,
          mediaPath: asset.relativePath,
          mediaName: asset.fileName,
        }));
      } catch (error) {
        unsupported.push(`${name}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (unsupported.length) set({ error: `以下内容未能载入：${unsupported.join("、")}` });
    return imported;
  },

  createFromText: (rawText, point) => {
    const text = rawText.trim();
    if (!text) return null;
    const isUrl = /^(https?:\/\/|www\.)/i.test(text);
    if (!isUrl) return get().createNode("document", point, { title: "粘贴的文本", content: text });
    const url = /^www\./i.test(text) ? `https://${text}` : text;
    let pathname = "";
    try { pathname = new URL(url).pathname.toLowerCase(); } catch { /* 保留网络卡片 */ }
    const title = (() => { try { return new URL(url).hostname; } catch { return "网络卡片"; } })();
    if (/\.(png|jpe?g|gif|webp|tiff?|bmp|ico|icns|heic|raw|exr|hdr)$/i.test(pathname)) {
      return get().createNode("image", point, { title, url, mediaPath: url, mediaName: title });
    }
    if (/\.(mp4|mov|webm|avi)$/i.test(pathname)) {
      return get().createNode("video", point, { title, url, mediaPath: url, mediaName: title });
    }
    return get().createNode("web", point, { title, url });
  },

  updateNode: (id, patch, persist = true) => {
    const current = get().nodes.find((node) => node.id === id);
    if (!current) return;
    const updated = { ...current, ...patch, updatedAt: now() };
    set((state) => ({ nodes: state.nodes.map((node) => node.id === id ? updated : node) }));
    if (persist) scheduleNodeSave(updated, set);
  },

  previewNodes: (patches) => {
    const patchMap = new Map(patches.map(({ id, patch }) => [id, patch]));
    set((state) => ({
      nodes: state.nodes.map((node) => patchMap.has(node.id)
        ? { ...node, ...patchMap.get(node.id), updatedAt: now() }
        : node),
    }));
  },

  commitLayout: (before) => {
    const after = cloneNodes(get().nodes);
    if (addHistory(before, after, set, get)) syncHistoryChange(before, after, set);
  },

  finishDrag: (before, patches, dropTargetId = null) => {
    const state = get();
    const patchMap = new Map(patches.map(({ id, patch }) => [id, patch]));
    const movingIds = new Set(patches.map(({ id }) => id));
    let after = state.nodes.map((item) => patchMap.has(item.id)
      ? { ...item, ...patchMap.get(item.id), updatedAt: now() }
      : item);
    let notice: string | null = null;

    if (movingIds.size > 1) {
      const movingBefore = before.filter((node) => movingIds.has(node.id));
      const stackIds = new Set(movingBefore.map((node) => node.stackId).filter(Boolean));
      if (stackIds.size === 1 && movingBefore.every((node) => node.stackId)) {
        const firstBefore = movingBefore[0];
        const firstAfter = after.find((node) => node.id === firstBefore.id)!;
        const dx = firstAfter.x - firstBefore.x;
        const dy = firstAfter.y - firstBefore.y;
        const stackId = firstBefore.stackId!;
        after = after.map((node) => node.stackId === stackId ? {
          ...node,
          stackAnchorX: (node.stackAnchorX ?? firstBefore.x) + dx,
          stackAnchorY: (node.stackAnchorY ?? firstBefore.y) + dy,
          updatedAt: now(),
        } : node);
      }
    } else if (movingIds.size === 1) {
      const movingId = [...movingIds][0];
      const movingBefore = before.find((item) => item.id === movingId);
      const moving = after.find((item) => item.id === movingId);
      const target = dropTargetId ? after.find((item) => item.id === dropTargetId && !item.parentId) : undefined;
      const previousStackId = movingBefore?.stackId ?? null;

      if (moving && target?.type === "folder") {
        after = after.map((item) => item.id === movingId
          ? clearStackFields({ ...item, parentId: target.id })
          : item);
      } else if (moving && previousStackId) {
        after = after.map((item) => item.id === movingId ? clearStackFields({ ...item, parentId: null }) : item);
      } else if (moving && target?.stackId) {
        const members = after
          .filter((item) => item.stackId === target.stackId && !item.parentId)
          .sort((a, b) => (a.stackOrder ?? a.zIndex) - (b.stackOrder ?? b.zIndex));
        const reference = members[0] ?? target;
        const stackId = target.stackId;
        const order = members.length;
        after = after.map((item) => item.id === movingId ? {
          ...item,
          parentId: null,
          stackId,
          stackOrder: order,
          stackAnchorX: reference.stackAnchorX ?? target.x,
          stackAnchorY: reference.stackAnchorY ?? target.y,
          stackTitle: reference.stackTitle || "未命名堆叠",
          zIndex: nextZIndex(after),
          updatedAt: now(),
        } : item);
        notice = "已加入堆叠";
      } else if (moving && target && target.id !== moving.id && !target.stackId) {
        const stackId = uniqueId();
        const anchorX = target.x;
        const anchorY = target.y;
        const firstZ = nextZIndex(after);
        after = after.map((item) => {
          if (item.id === target.id) return {
            ...item,
            stackId,
            stackOrder: 0,
            stackAnchorX: anchorX,
            stackAnchorY: anchorY,
            stackTitle: "未命名堆叠",
            zIndex: firstZ,
            updatedAt: now(),
          };
          if (item.id === movingId) return {
            ...item,
            parentId: null,
            stackId,
            stackOrder: 1,
            stackAnchorX: anchorX,
            stackAnchorY: anchorY,
            stackTitle: "未命名堆叠",
            zIndex: firstZ + 1,
            updatedAt: now(),
          };
          return item;
        });
        notice = "已创建堆叠";
      }

      if (previousStackId) after = compactStackMembers(after, previousStackId);
      const currentStackId = after.find((item) => item.id === movingId)?.stackId;
      if (currentStackId) after = compactStackMembers(after, currentStackId);
    }

    after = repairStacks(after);
    set({
      nodes: after,
      selectedIds: [...movingIds],
      stackNotice: notice ? { id: now(), message: notice } : state.stackNotice,
    });
    if (addHistory(before, after, set, get)) syncHistoryChange(before, after, set);
  },

  extractNodeFromFolder: (id, point) => {
    const state = get();
    const child = state.nodes.find((node) => node.id === id);
    if (!child?.parentId) return;
    const before = cloneNodes(state.nodes);
    const after = repairStacks(state.nodes.map((node) => node.id === id
      ? clearStackFields({
        ...node,
        parentId: null,
        x: point.x,
        y: point.y,
        zIndex: nextZIndex(state.nodes),
      })
      : node));
    set({ nodes: after, selectedIds: [id], openFolderId: null });
    if (addHistory(before, after, set, get)) syncHistoryChange(before, after, set);
  },

  updateNodeLayout: (id, patch) => {
    const before = cloneNodes(get().nodes);
    get().previewNodes([{ id, patch }]);
    const after = cloneNodes(get().nodes);
    if (addHistory(before, after, set, get)) syncHistoryChange(before, after, set);
  },

  selectOnly: (id) => set({ selectedIds: id ? [id] : [] }),
  toggleSelection: (id) => set((state) => ({
    selectedIds: state.selectedIds.includes(id)
      ? state.selectedIds.filter((item) => item !== id)
      : [...state.selectedIds, id],
  })),
  selectMany: (ids, additive = false) => set((state) => ({
    selectedIds: additive ? Array.from(new Set([...state.selectedIds, ...ids])) : ids,
  })),
  openEditor: (editingId) => set({ editingId, selectedIds: [editingId] }),
  closeEditor: () => set({ editingId: null }),
  openFolder: (openFolderId) => set({ openFolderId, selectedIds: [openFolderId] }),
  closeFolder: () => set({ openFolderId: null }),

  deleteNodes: async (ids) => {
    if (!ids.length) return;
    const before = cloneNodes(get().nodes);
    const remove = new Set(ids);
    for (const node of before) if (node.parentId && remove.has(node.parentId)) remove.add(node.id);
    const after = repairStacks(before.filter((node) => !remove.has(node.id)));
    set({ nodes: after, selectedIds: [], editingId: null, openFolderId: null });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
  },

  deleteSelected: async () => get().deleteNodes(get().selectedIds),

  stackSelected: () => {
    const state = get();
    const selected = state.nodes
      .filter((node) => state.selectedIds.includes(node.id) && !node.parentId && !node.stackId)
      .sort((a, b) => a.zIndex - b.zIndex);
    if (selected.length < 2) return;
    const before = cloneNodes(state.nodes);
    const stackId = uniqueId();
    const anchorX = Math.min(...selected.map((node) => node.x));
    const anchorY = Math.min(...selected.map((node) => node.y));
    const firstZ = nextZIndex(state.nodes);
    const selectedSet = new Set(selected.map((node) => node.id));
    let after = state.nodes.map((node) => {
      const order = selected.findIndex((item) => item.id === node.id);
      if (!selectedSet.has(node.id)) return node;
      return {
        ...node,
        stackId,
        stackOrder: order,
        stackAnchorX: anchorX,
        stackAnchorY: anchorY,
        stackTitle: "未命名堆叠",
        zIndex: firstZ + order,
        updatedAt: now(),
      };
    });
    after = compactStackMembers(after, stackId);
    set({
      nodes: after,
      selectedIds: selected.map((node) => node.id),
      stackNotice: { id: now(), message: "已创建堆叠" },
    });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
  },

  unstack: (stackId) => {
    const state = get();
    const stacked = state.nodes
      .filter((node) => node.stackId === stackId)
      .sort((a, b) => (a.stackOrder ?? a.zIndex) - (b.stackOrder ?? b.zIndex));
    if (stacked.length < 2) return;
    const before = cloneNodes(state.nodes);
    const anchorX = stacked[0].stackAnchorX ?? stacked.at(-1)!.x;
    const anchorY = stacked[0].stackAnchorY ?? stacked.at(-1)!.y;
    const after = state.nodes.map((node) => {
      const index = stacked.findIndex((item) => item.id === node.id);
      if (index === -1) return node;
      return clearStackFields({ ...node, x: anchorX + index * 46, y: anchorY + index * 26 });
    });
    set({ nodes: after, selectedIds: [stacked.at(-1)!.id] });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
  },

  addImageHotspot: (nodeId, hotspot) => {
    const state = get();
    const node = state.nodes.find((item) => item.id === nodeId && item.type === "image");
    if (!node) return;
    const before = cloneNodes(state.nodes);
    const after = state.nodes.map((item) => item.id === nodeId
      ? { ...item, hotspots: [...item.hotspots, { ...hotspot, id: uniqueId() }], updatedAt: now() }
      : item);
    set({ nodes: after });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
  },

  updateImageHotspot: (nodeId, hotspotId, patch) => {
    const state = get();
    const node = state.nodes.find((item) => item.id === nodeId && item.type === "image");
    if (!node || !node.hotspots.some((hotspot) => hotspot.id === hotspotId)) return;
    const before = cloneNodes(state.nodes);
    const after = state.nodes.map((item) => item.id === nodeId
      ? { ...item, hotspots: item.hotspots.map((hotspot) => hotspot.id === hotspotId ? { ...hotspot, ...patch } : hotspot), updatedAt: now() }
      : item);
    set({ nodes: after });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
  },

  removeImageHotspot: (nodeId, hotspotId) => {
    const state = get();
    const node = state.nodes.find((item) => item.id === nodeId);
    if (!node || !node.hotspots.some((hotspot) => hotspot.id === hotspotId)) return;
    const before = cloneNodes(state.nodes);
    const after = state.nodes.map((item) => item.id === nodeId
      ? { ...item, hotspots: item.hotspots.filter((hotspot) => hotspot.id !== hotspotId), updatedAt: now() }
      : item);
    set({ nodes: after });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
  },

  setViewport: (viewport, persist = true) => {
    set({ viewport });
    if (!persist) return;
    if (viewportSaveTimer) clearTimeout(viewportSaveTimer);
    viewportSaveTimer = setTimeout(() => {
      void backend.saveViewport(viewport).catch((error) =>
        set({ error: error instanceof Error ? error.message : String(error) }));
    }, 420);
  },

  undo: () => {
    const state = get();
    const entry = state.historyPast.at(-1);
    if (!entry) return;
    const beforeApply = cloneNodes(state.nodes);
    const nodes = mergeHistoryTarget(entry.before, state.nodes);
    set({
      nodes,
      selectedIds: [], editingId: null, openFolderId: null,
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: [entry, ...state.historyFuture].slice(0, HISTORY_LIMIT),
    });
    syncHistoryChange(beforeApply, nodes, set);
  },

  redo: () => {
    const state = get();
    const entry = state.historyFuture[0];
    if (!entry) return;
    const beforeApply = cloneNodes(state.nodes);
    const nodes = mergeHistoryTarget(entry.after, state.nodes);
    set({
      nodes,
      selectedIds: [], editingId: null, openFolderId: null,
      historyPast: [...state.historyPast, entry].slice(-HISTORY_LIMIT),
      historyFuture: state.historyFuture.slice(1),
    });
    syncHistoryChange(beforeApply, nodes, set);
  },

  setError: (error) => set({ error }),
  clearStackNotice: () => set({ stackNotice: null }),
}));
