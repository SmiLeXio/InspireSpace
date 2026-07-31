import { create } from "zustand";
import { backend } from "../lib/backend";
import type {
  AppScreen,
  CanvasNode,
  CanvasNodeType,
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
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
  openProject: (path: string, name?: string) => Promise<void>;
  createProject: (parentPath: string, name: string) => Promise<void>;
  cloneProject: (url: string, parentPath: string, name: string) => Promise<void>;
  openDemo: () => Promise<void>;
  leaveProject: () => void;
  createNode: (type: CanvasNodeType, point?: { x: number; y: number }, extras?: Partial<CanvasNode>) => CanvasNode;
  createFolder: (childIds?: string[], point?: { x: number; y: number }) => CanvasNode;
  importMedia: (kind: ImportKind, point?: { x: number; y: number }) => Promise<CanvasNode | null>;
  createFromText: (text: string, point?: { x: number; y: number }) => CanvasNode | null;
  updateNode: (id: string, patch: Partial<CanvasNode>, persist?: boolean) => void;
  previewNodes: (patches: Array<{ id: string; patch: Partial<CanvasNode> }>) => void;
  commitLayout: (before: CanvasNode[]) => void;
  finishDrag: (before: CanvasNode[], patches: Array<{ id: string; patch: Partial<CanvasNode> }>, dropTargetId?: string | null) => void;
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
  removeImageHotspot: (nodeId: string, hotspotId: string) => void;
  setViewport: (viewport: Viewport, persist?: boolean) => void;
  undo: () => void;
  redo: () => void;
  setError: (error: string | null) => void;
}

const RECENTS_KEY = "inspirespace-recent-projects-v2";
const HISTORY_LIMIT = 60;
const nodeSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let viewportSaveTimer: ReturnType<typeof setTimeout> | undefined;
let savedStateTimer: ReturnType<typeof setTimeout> | undefined;

const uniqueId = () =>
  globalThis.crypto?.randomUUID?.() ?? `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => Date.now();
const cloneNodes = (nodes: CanvasNode[]) => nodes.map((node) => ({ ...node }));

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
  url: node.url ?? null,
  pluginKind: node.pluginKind ?? null,
  hotspots: node.hotspots ?? [],
});

const starterNodes = (): CanvasNode[] => {
  const timestamp = now();
  return [
    {
      id: uniqueId(), type: "sticky", x: -430, y: -180, width: 300, height: 220, zIndex: 1,
      color: STICKY_COLORS[1].value, title: "", content: "今天\n\n收集一个闪念，拖动它，看看它会和什么产生连接。",
      filePath: null, mediaPath: null, mediaName: null, parentId: null, stackId: null, url: null, pluginKind: null, hotspots: [],
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: uniqueId(), type: "note", x: -70, y: -245, width: 390, height: 430, zIndex: 2,
      color: "#fbfbfa", title: "工作笔记", content: "想法并不会按顺序出现。\n\n把有用的片段留在画布上，移动、组合，然后让结构自然浮现。",
      filePath: null, mediaPath: null, mediaName: null, parentId: null, stackId: null, url: null, pluginKind: null, hotspots: [],
      createdAt: timestamp + 1, updatedAt: timestamp + 1,
    },
    {
      id: uniqueId(), type: "plugin", x: 390, y: -70, width: 300, height: 250, zIndex: 3,
      color: "#252726", title: "本地时间", content: "", filePath: null, mediaPath: null, mediaName: null,
      parentId: null, stackId: null, url: null, pluginKind: "clock", hotspots: [], createdAt: timestamp + 2, updatedAt: timestamp + 2,
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
  JSON.stringify(nodes.map(({ id, type, x, y, width, height, zIndex, parentId, stackId }) => ({
    id, type, x, y, width, height, zIndex, parentId, stackId,
  })));

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
    url: extras.url ?? null,
    pluginKind: extras.pluginKind ?? null,
    hotspots: extras.hotspots ?? [],
    createdAt: extras.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
};

const mediaNodeType = (kind: ImportKind): CanvasNodeType => kind;

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
  historyPast: [],
  historyFuture: [],

  openProject: async (path, name) => {
    set({ loading: true, error: null });
    try {
      const snapshot = await backend.openWorkspace(path);
      const projectName = name || projectNameFromPath(snapshot.rootPath);
      set({
        screen: "canvas", workspaceRoot: snapshot.rootPath, projectName,
        nodes: snapshot.nodes.map(normalizeNode), viewport: snapshot.viewport ?? DEFAULT_VIEWPORT,
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
        nodes: snapshot.nodes.map(normalizeNode), viewport: snapshot.viewport ?? DEFAULT_VIEWPORT,
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
        nodes: snapshot.nodes.map(normalizeNode), viewport: snapshot.viewport ?? DEFAULT_VIEWPORT,
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
      const nodes = snapshot.nodes.length ? snapshot.nodes.map(normalizeNode) : starterNodes();
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

  createFolder: (childIds = get().selectedIds, point) => {
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
      content: validChildren.length ? `${validChildren.length} 个项目` : "空文件夹",
    });
    const nextNodes = state.nodes.map((node) => validChildren.some((child) => child.id === node.id)
      ? { ...node, parentId: folder.id, stackId: null, updatedAt: now() }
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
    const patchMap = new Map(patches.map(({ id, patch }) => [id, patch]));
    const movingIds = new Set(patches.map(({ id }) => id));
    let after = get().nodes.map((item) => patchMap.has(item.id)
      ? { ...item, ...patchMap.get(item.id), updatedAt: now() }
      : item);

    if (movingIds.size === 1) {
      const movingId = [...movingIds][0];
      const moving = after.find((item) => item.id === movingId);
      const previousStackId = moving?.stackId;
      const target = dropTargetId ? after.find((item) => item.id === dropTargetId && item.type === "folder") : undefined;

      if (moving && target) {
        after = after.map((item) => item.id === movingId
          ? { ...item, parentId: target.id, stackId: null, updatedAt: now() }
          : item);
      } else if (moving?.stackId) {
        // 普通卡片不再作为堆叠投放目标；单张卡片拖到空白处即从原堆叠取出。
        after = after.map((item) => item.id === movingId ? { ...item, stackId: null, updatedAt: now() } : item);
      }

      if (previousStackId) {
        const remaining = after.filter((item) => item.stackId === previousStackId);
        if (remaining.length < 2) {
          after = after.map((item) => item.stackId === previousStackId ? { ...item, stackId: null, updatedAt: now() } : item);
        }
      }
    }

    set({ nodes: after, selectedIds: [...movingIds] });
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
    const after = before.filter((node) => !remove.has(node.id));
    set({ nodes: after, selectedIds: [], editingId: null, openFolderId: null });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
  },

  deleteSelected: async () => get().deleteNodes(get().selectedIds),

  stackSelected: () => {
    const state = get();
    const selected = state.nodes.filter((node) => state.selectedIds.includes(node.id));
    if (selected.length < 2) return;
    const before = cloneNodes(state.nodes);
    const stackId = uniqueId();
    const anchorX = Math.min(...selected.map((node) => node.x));
    const anchorY = Math.min(...selected.map((node) => node.y));
    const firstZ = nextZIndex(state.nodes);
    const selectedSet = new Set(selected.map((node) => node.id));
    const after = state.nodes.map((node) => {
      const index = selected.findIndex((item) => item.id === node.id);
      if (!selectedSet.has(node.id)) return node;
      return { ...node, x: anchorX + index * 7, y: anchorY + index * 6, zIndex: firstZ + index, stackId, updatedAt: now() };
    });
    set({ nodes: after, selectedIds: selected.map((node) => node.id) });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
  },

  unstack: (stackId) => {
    const state = get();
    const stacked = state.nodes.filter((node) => node.stackId === stackId).sort((a, b) => a.zIndex - b.zIndex);
    if (stacked.length < 2) return;
    const before = cloneNodes(state.nodes);
    const startX = Math.min(...stacked.map((node) => node.x));
    const startY = Math.min(...stacked.map((node) => node.y));
    const after = state.nodes.map((node) => {
      const index = stacked.findIndex((item) => item.id === node.id);
      if (index === -1) return node;
      return { ...node, x: startX + index * 46, y: startY + index * 26, stackId: null, updatedAt: now() };
    });
    set({ nodes: after, selectedIds: [stacked.at(-1)!.id] });
    addHistory(before, after, set, get);
    syncHistoryChange(before, after, set);
  },

  addImageHotspot: (nodeId, hotspot) => {
    const node = get().nodes.find((item) => item.id === nodeId && item.type === "image");
    if (!node) return;
    get().updateNode(nodeId, { hotspots: [...node.hotspots, { ...hotspot, id: uniqueId() }] });
  },

  removeImageHotspot: (nodeId, hotspotId) => {
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node) return;
    get().updateNode(nodeId, { hotspots: node.hotspots.filter((hotspot) => hotspot.id !== hotspotId) });
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
}));
