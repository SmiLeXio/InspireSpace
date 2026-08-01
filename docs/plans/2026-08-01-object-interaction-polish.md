# Object Interaction Polish Implementation Plan

**Goal:** Remove image hover shading, simplify and auto-expand image hotspots, make interactive cards reliably draggable, restore extracting folder children to the canvas, and scale the clock plugin with its card.

**Architecture:** Reuse the shared 6px pointer-intent threshold for card interactions. Keep native controls protected while providing explicit drag surfaces and a web interaction shield. Add a history-aware store action for extracting folder children, and use container-relative CSS units for clock scaling.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, CSS, GSAP, Tauri.

---

## Task 1: Image and hotspot presentation
- Modify `src/components/canvas/CanvasNode.tsx` and `src/styles.css`.
- Remove the image filename gradient overlay and image hover darkening.
- Remove hotspot sequence numbers.
- Render a translucent dark marker with a white center dot.
- Show every hotspot label while the image is hovered and keep keyboard focus behavior.
- Compact the label spacing and increase background transparency.

## Task 2: Interactive-card dragging
- Modify `src/components/canvas/CanvasNode.tsx` and `src/styles.css`.
- Make the top drag rail a real pointer target.
- Allow an unfocused sticky body to distinguish click-to-edit from drag.
- Allow video picture-area dragging while reserving the native control strip.
- Add a web interaction shield: click enters iframe interaction, drag moves the card, Escape or deselection exits.

## Task 3: Folder child extraction
- Modify `src/components/canvas/FolderFocus.tsx`, `src/store/useCanvasStore.ts`, and `src/store/useCanvasStore.test.ts`.
- Add a visible drag handle to every folder child.
- Render a fixed drag ghost and convert the release point into canvas world coordinates.
- Add a history-aware `extractNodeFromFolder` store action.
- Cancel when released inside the folder panel or on pointer cancellation.

## Task 4: Responsive clock
- Modify `src/styles.css` and, only if needed, `src/components/canvas/ClockPlugin.tsx`.
- Remove the 104px face cap and fixed internal typography.
- Scale the face, hands, center, time, date, and spacing using container-relative units with safe clamps.

## Task 5: Verification
- Run `npm test` and `npm run build` using Node 24.
- Run Cargo format, check, and tests.
- Run `git diff --check` and inspect status.
