import {
  Archive,
  BookOpen,
  BriefcaseBusiness,
  Folder,
  Image,
  Music2,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";
import type { FolderIconKey } from "../../types/canvas";

export const FOLDER_ICON_OPTIONS: Array<{ key: FolderIconKey; label: string; icon: LucideIcon }> = [
  { key: "folder", label: "文件", icon: Folder },
  { key: "star", label: "收藏", icon: Star },
  { key: "image", label: "图片", icon: Image },
  { key: "book", label: "阅读", icon: BookOpen },
  { key: "music", label: "音乐", icon: Music2 },
  { key: "briefcase", label: "工作", icon: BriefcaseBusiness },
  { key: "archive", label: "归档", icon: Archive },
  { key: "sparkles", label: "灵感", icon: Sparkles },
];

export const FOLDER_COLORS = [
  { name: "纸米", value: "#d7c7a5" },
  { name: "麦黄", value: "#e4bf72" },
  { name: "暖橙", value: "#d99868" },
  { name: "鼠尾草", value: "#88a58f" },
  { name: "雾蓝", value: "#7f9fb3" },
  { name: "暮紫", value: "#9a8cab" },
  { name: "石墨", value: "#6d7471" },
] as const;

export const folderIconFor = (key: FolderIconKey | null | undefined) =>
  FOLDER_ICON_OPTIONS.find((option) => option.key === key)?.icon ?? Folder;
