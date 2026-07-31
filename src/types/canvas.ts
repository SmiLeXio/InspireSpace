export type CanvasNodeType =
  | "note"
  | "sticky"
  | "folder"
  | "web"
  | "video"
  | "image"
  | "document"
  | "plugin"
  | "sheet";

export interface ImageHotspot {
  id: string;
  x: number;
  y: number;
  label: string;
  description: string;
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  color: string | null;
  title: string;
  content: string;
  filePath: string | null;
  mediaPath: string | null;
  mediaName: string | null;
  parentId: string | null;
  stackId: string | null;
  url: string | null;
  pluginKind: string | null;
  hotspots: ImageHotspot[];
  createdAt: number;
  updatedAt: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface WorkspaceSnapshot {
  rootPath: string;
  nodes: CanvasNode[];
  viewport: Viewport;
}

export interface MediaAsset {
  relativePath: string;
  fileName: string;
  mimeType: string;
  content?: string | null;
}

export interface RecentProject {
  name: string;
  path: string;
  openedAt: number;
}

export type SaveState = "idle" | "saving" | "saved" | "error";
export type AppScreen = "welcome" | "canvas";
export type ImportKind = "image" | "video" | "document";

export const STICKY_COLORS = [
  { name: "纸白", value: "#fbfbfa", ink: "#171918" },
  { name: "奶油黄", value: "#fff1b8", ink: "#2b2617" },
  { name: "珊瑚粉", value: "#ffe0d6", ink: "#2b1d19" },
  { name: "薄荷雾", value: "#e4efec", ink: "#182320" },
  { name: "深墨", value: "#252726", ink: "#f7f7f4" },
] as const;

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };
