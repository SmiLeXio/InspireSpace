# Stack Focus Expansion Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make compact stacks automatically place the smallest card on top with bottom/center alignment, restore reliable folder opening, and replace hover/shell expansion with click-driven in-place focus expansion that blurs the background and temporarily pushes nearby nodes aside.

**Architecture:** Keep stack membership and stable member order in Zustand/SQLite, but derive compact visual order and geometry from current member dimensions. Keep expanded neighbor displacement as ephemeral canvas UI state computed by pure geometry helpers, so opening or closing a stack creates no persisted positions or undo entries. Separate pointer press, drag threshold, and click activation so card controls—especially folders—remain clickable while compact stacks still drag and open naturally.

**Tech Stack:** React 18, TypeScript, Zustand, GSAP, CSS, Vitest, Tauri v2 / Rust, SQLite.

---

### Task 1: Add compact stack geometry rules

**Files:**
- Modify: `src/components/canvas/stackGeometry.ts`
- Modify: `src/components/canvas/stackGeometry.test.ts`
- Modify: `src/store/useCanvasStore.ts`
- Modify: `src/store/useCanvasStore.test.ts`

**Steps:**
1. Add failing geometry tests proving all compact members share one horizontal center and one bottom edge.
2. Add failing tests proving the smallest member by area is the visual top member, with height and stable stack order as deterministic tie breakers.
3. Add a reusable pure compact layout helper that returns positions and visual order without rewriting `stackOrder`.
4. Replace the store's offset compacting logic with the same bottom-aligned/centered geometry.
5. Run geometry and store tests and confirm stack create/add/remove/undo behavior remains intact.

### Task 2: Add temporary neighbor avoidance geometry

**Files:**
- Modify: `src/components/canvas/stackGeometry.ts`
- Modify: `src/components/canvas/stackGeometry.test.ts`

**Steps:**
1. Add failing tests for nodes overlapping an expanded stack safety region.
2. Test that nearby nodes move along the shortest outward axis and maintain the configured clearance.
3. Test that distant nodes, current stack members, folder children, and excluded nodes receive no offset.
4. Implement a bounded 2–3 pass collision resolver returning `Map<nodeId, { x, y }>` only.
5. Run geometry tests and verify no source node coordinates are mutated.

### Task 3: Separate click from drag and restore folder opening

**Files:**
- Modify: `src/components/canvas/CanvasNode.tsx`
- Add or modify component tests if an existing canvas interaction test harness is available.

**Steps:**
1. Change node pointer handling to begin in a pressed state and only start card dragging after pointer movement exceeds 4px.
2. Ensure buttons, inputs, textareas, links, media controls, and explicit node controls never initiate card dragging.
3. Make an ordinary folder click call `openFolder` reliably.
4. Make a compact stack click request expansion before any member action; after expansion, clicking a folder member opens `FolderFocus`.
5. Preserve Enter/Space expansion and existing selection/editing behavior.

### Task 4: Replace hover/shell expansion with click focus expansion

**Files:**
- Modify: `src/components/canvas/InfiniteCanvas.tsx`
- Modify: `src/components/canvas/CanvasNode.tsx`

**Steps:**
1. Remove the hover expansion timer and pointer-leave auto-collapse path.
2. Open a compact stack on a qualifying click; close it only from canvas background click, Escape, or the lightweight close interaction.
3. Remove the large expanded `stack-shell` box while retaining a compact floating title/count drag handle and unstack action.
4. Apply the temporary avoidance offsets to non-stack root nodes at render time without updating Zustand or persistence.
5. Disable background node interaction while focus expansion is active, while keeping the active stack fully interactive.
6. Preserve whole-stack dragging from the floating handle and member extraction from the expanded layout.

### Task 5: Implement focus visuals and animation

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/canvas/InfiniteCanvas.tsx`
- Modify: `src/components/canvas/CanvasNode.tsx`

**Steps:**
1. Delete the large shell background/border styling and add lightweight floating controls that do not enclose the grid.
2. Add per-node focus classes so non-active nodes transition to blur, reduced opacity, and a tiny scale while the active stack remains crisp.
3. Fade the canvas grid without filtering the entire canvas DOM subtree.
4. Animate expansion, neighbor translation, and collapse with compositor-friendly transform/opacity properties and scoped GSAP cleanup.
5. Add reduced-motion timings and remove stagger/scale-heavy effects under `prefers-reduced-motion`.

### Task 6: Verify regressions and persistence boundaries

**Files:**
- Verify only unless failures require fixes.

**Steps:**
1. Run `npm test`.
2. Run `npm run build`.
3. Run `cargo fmt --all -- --check`.
4. Run `cargo check --manifest-path src-tauri/Cargo.toml`.
5. Run `cargo test --manifest-path src-tauri/Cargo.toml`.
6. Run `git diff --check`.
7. Review the final diff to ensure temporary avoidance offsets never enter Zustand, SQLite, or undo history and that untracked user content remains untouched.
