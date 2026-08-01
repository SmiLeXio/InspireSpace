# Card and Stack Drag Polish Implementation Plan

**Goal:** Let openable cards distinguish click from drag, allow compact stacks to move without opening, keep every compact member rendered, improve focused-stack drag responsiveness, and make image cards borderless.

**Architecture:** Centralize the pointer movement threshold in a small pure helper. Keep click behavior native until the pointer crosses the threshold, then activate drag and suppress the trailing click. During focused-stack drag, write a shared CSS translation directly to the canvas world and commit positions only on pointer release.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, CSS, Tauri.

---

## Task 1: Pointer intent helper
- Create `src/components/canvas/pointerIntent.ts`.
- Create `src/components/canvas/pointerIntent.test.ts`.
- Define and test a shared 6px drag activation threshold.

## Task 2: Openable-card click/drag split
- Modify `src/components/canvas/CanvasNode.tsx`.
- Do not capture the pointer until the threshold is crossed.
- Stop excluding every button from drag; exclude only real controls and explicitly marked `data-no-card-drag` elements.
- Preserve native click for note, folder, and document previews.
- Suppress the click generated after a real drag.

## Task 3: Stack drag responsiveness
- Modify `src/components/canvas/InfiniteCanvas.tsx`.
- Remove per-frame `stackOffset` React state updates.
- Update shared CSS variables in `requestAnimationFrame` during focused-stack drag.
- Commit all member positions once on release.
- Keep neighbor avoidance frozen during the gesture and recalculate after commit.

## Task 4: Stack and image presentation
- Modify `src/components/canvas/CanvasNode.tsx` and `src/styles.css`.
- Render all compact stack members normally while keeping underlays non-interactive.
- Remove hidden white-card placeholder behavior.
- Make image cards full-bleed and borderless, with selection represented by an external shadow/ring.

## Task 5: Verification
- Run `npm test` with Node 24.
- Run `npm run build` with Node 24.
- Run Cargo format, check, and tests.
- Run `git diff --check` and inspect status.
