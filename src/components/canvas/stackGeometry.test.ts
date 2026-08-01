import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../../types/canvas";
import {
  calculateFocusOffsets,
  collectStackGroups,
  compactStackLayout,
  expandedStackLayout,
  pointInStackBounds,
  stackColumns,
  type StackGroup,
} from "./stackGeometry";

const makeNode = (id: string, patch: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  type: "note",
  x: 100,
  y: 100,
  width: 200,
  height: 140,
  zIndex: Number(id.replace(/\D/g, "")) || 1,
  color: "#fff",
  title: id,
  content: "",
  filePath: null,
  mediaPath: null,
  mediaName: null,
  parentId: null,
  stackId: "stack-a",
  stackOrder: null,
  stackAnchorX: 100,
  stackAnchorY: 100,
  stackTitle: "测试堆叠",
  url: null,
  pluginKind: null,
  folderIcon: null,
  hotspots: [],
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const makeGroup = (members: CanvasNode[], patch: Partial<StackGroup> = {}): StackGroup => ({
  id: "stack-a",
  title: "测试堆叠",
  anchorX: 100,
  anchorY: 100,
  members,
  topId: members.at(-1)!.id,
  ...patch,
});

describe("stackGeometry", () => {
  it("紧凑堆叠让所有成员水平居中并且底边对齐", () => {
    const members = [
      makeNode("large", { width: 320, height: 240, stackOrder: 0 }),
      makeNode("small", { width: 160, height: 100, stackOrder: 1 }),
      makeNode("medium", { width: 240, height: 180, stackOrder: 2 }),
    ];
    const layout = compactStackLayout(members, 100, 200);

    expect(layout.positions.get("large")).toEqual({ x: 100, y: 200 });
    expect(layout.positions.get("small")).toEqual({ x: 180, y: 340 });
    expect(layout.positions.get("medium")).toEqual({ x: 140, y: 260 });
    expect(members.map((member) => layout.positions.get(member.id)!.x + member.width / 2)).toEqual([260, 260, 260]);
    expect(members.map((member) => layout.positions.get(member.id)!.y + member.height)).toEqual([440, 440, 440]);
  });

  it("紧凑堆叠按面积、再按高度选择最小成员作为最前层，同尺寸保留原顶部", () => {
    const members = [
      makeNode("wide", { width: 200, height: 100, stackOrder: 1 }),
      makeNode("tall", { width: 100, height: 200, stackOrder: 2 }),
      makeNode("older-wide", { width: 200, height: 100, stackOrder: 0 }),
      makeNode("large", { width: 300, height: 200, stackOrder: 3 }),
    ];
    const layout = compactStackLayout(members, 0, 0);

    expect(layout.frontToBack.map((member) => member.id)).toEqual(["wide", "older-wide", "tall", "large"]);
    expect(layout.topId).toBe("wide");
  });

  it("展开聚焦只临时推开碰撞的根节点并跳过当前堆叠与文件夹子节点", () => {
    const bounds = { left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 };
    const nodes = [
      makeNode("left", { stackId: null, stackAnchorX: null, stackAnchorY: null, x: 40, y: 180, width: 100, height: 80 }),
      makeNode("right", { stackId: null, stackAnchorX: null, stackAnchorY: null, x: 480, y: 180, width: 120, height: 80 }),
      makeNode("top", { stackId: null, stackAnchorX: null, stackAnchorY: null, x: 250, y: 40, width: 100, height: 100 }),
      makeNode("far", { stackId: null, stackAnchorX: null, stackAnchorY: null, x: 900, y: 800, width: 100, height: 100 }),
      makeNode("active", { x: 260, y: 180 }),
      makeNode("child", { stackId: null, parentId: "folder", x: 260, y: 180 }),
    ];
    const snapshot = structuredClone(nodes);
    const offsets = calculateFocusOffsets(nodes, bounds, new Set(["active"]), { clearance: 20, nodeGap: 0, passes: 2 });

    expect(offsets.get("left")).toEqual({ x: -60, y: 0 });
    expect(offsets.get("right")).toEqual({ x: 40, y: 0 });
    expect(offsets.get("top")).toEqual({ x: 0, y: -60 });
    expect(offsets.has("far")).toBe(false);
    expect(offsets.has("active")).toBe(false);
    expect(offsets.has("child")).toBe(false);
    expect(nodes).toEqual(snapshot);
  });
  it("按成员数量选择 2 至 5 列", () => {
    expect([2, 4, 5, 9, 10, 16, 17, 24].map(stackColumns)).toEqual([2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("9 个成员展开为 3×3 网格", () => {
    const members = Array.from({ length: 9 }, (_, index) => makeNode(`node-${index}`, { stackOrder: index }));
    const layout = expandedStackLayout(makeGroup(members), { x: 0, y: 0, scale: 1 }, { width: 1400, height: 1000 });

    expect(layout.columns).toBe(3);
    expect(layout.positions).toHaveLength(9);
    expect(layout.positions.get("node-0")).toMatchObject({ row: 0, column: 0, index: 0 });
    expect(layout.positions.get("node-4")).toMatchObject({ row: 1, column: 1, index: 4 });
    expect(layout.positions.get("node-8")).toMatchObject({ row: 2, column: 2, index: 8 });
  });

  it("不同尺寸成员使用每列最大宽度和每行最大高度", () => {
    const members = [
      makeNode("node-0", { width: 100, height: 80, stackOrder: 0 }),
      makeNode("node-1", { width: 180, height: 120, stackOrder: 1 }),
      makeNode("node-2", { width: 140, height: 200, stackOrder: 2 }),
      makeNode("node-3", { width: 160, height: 90, stackOrder: 3 }),
    ];
    const layout = expandedStackLayout(makeGroup(members), { x: 0, y: 0, scale: 1 }, { width: 1200, height: 900 });

    expect(layout.bounds.width).toBe(140 + 24 + 180);
    expect(layout.bounds.height).toBe(120 + 24 + 200);
    expect(layout.positions.get("node-0")!.x).toBe(layout.bounds.left + 20);
    expect(layout.positions.get("node-1")!.x).toBe(layout.bounds.left + 140 + 24);
    expect(layout.positions.get("node-3")!.y).toBe(layout.bounds.top + 120 + 24 + 55);
  });

  it("联合热区包含安全边距和顶部标题区", () => {
    const bounds = { left: 100, top: 120, right: 500, bottom: 420, width: 400, height: 300 };
    expect(pointInStackBounds({ x: 76, y: 52 }, bounds)).toBe(true);
    expect(pointInStackBounds({ x: 524, y: 444 }, bounds)).toBe(true);
    expect(pointInStackBounds({ x: 75, y: 52 }, bounds)).toBe(false);
    expect(pointInStackBounds({ x: 100, y: 51 }, bounds)).toBe(false);
  });

  it("靠近视口边缘展开时会把网格修正到安全区域", () => {
    const members = [makeNode("node-0", { stackOrder: 0 }), makeNode("node-1", { stackOrder: 1 })];
    const layout = expandedStackLayout(
      makeGroup(members, { anchorX: 960, anchorY: 680 }),
      { x: 0, y: 0, scale: 1 },
      { width: 1000, height: 700 },
    );

    expect(layout.bounds.left).toBeGreaterThanOrEqual(34);
    expect(layout.bounds.top).toBeGreaterThanOrEqual(78);
    expect(layout.bounds.right).toBeLessThanOrEqual(966);
    expect(layout.bounds.bottom).toBeLessThanOrEqual(666);
  });

  it("收集堆叠时按稳定顺序排序，并忽略子节点和单成员组", () => {
    const nodes = [
      makeNode("third", { stackOrder: 2, zIndex: 30 }),
      makeNode("first", { stackOrder: 0, zIndex: 10 }),
      makeNode("second", { stackOrder: 1, zIndex: 20 }),
      makeNode("child", { parentId: "folder", stackOrder: 3 }),
      makeNode("single", { stackId: "stack-b", stackOrder: 0 }),
    ];
    const groups = collectStackGroups(nodes);

    expect([...groups.keys()]).toEqual(["stack-a"]);
    expect(groups.get("stack-a")?.members.map((member) => member.id)).toEqual(["first", "second", "third"]);
    expect(groups.get("stack-a")?.topId).toBe("third");
  });
});
