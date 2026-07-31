# InspireSpace MVP Implementation Plan

> **For Codex:** Implement this plan task-by-task in the current repository and verify every deliverable.

**Goal:** Build a Windows-first, local-only infinite-canvas Markdown inspiration app MVP from the WinSpatial delivery document.

**Architecture:** A React 18 + TypeScript + Konva frontend owns transient canvas interaction through Zustand. A Tauri v2 Rust backend owns the workspace, standard Markdown files, imported media files, and SQLite metadata. A browser-only persistence adapter mirrors the command contract with localStorage so UI work remains previewable without a desktop shell.

**Tech Stack:** Tauri v2, Rust, rusqlite, React 18, Vite, TypeScript, Zustand, react-konva, react-markdown, Tailwind CSS, Vitest.

---

### Task 1: Project foundation

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig*.json`, `tailwind.config.ts`, `postcss.config.cjs`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`

**Steps:**
1. Add reproducible frontend and Tauri scripts.
2. Configure the Windows desktop window, bundle metadata, CSP, and local asset protocol.
3. Install dependencies and generate app icons.
4. Run TypeScript and Rust dependency resolution.

### Task 2: Local workspace and persistence backend

**Files:**
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/workspace.rs`
- Create: `src-tauri/src/database.rs`
- Create: `src-tauri/src/commands.rs`

**Steps:**
1. Initialize `Documents/InspireSpace Vault/{notes,media,cache,.inspirespace}`.
2. Create the SQLite node and settings schema.
3. Implement load, upsert, delete, Markdown save, viewport save, and image import commands.
4. Add the Windows tray with show and quit actions.
5. Run `cargo fmt` and `cargo check`.

### Task 3: Canvas domain and frontend state

**Files:**
- Create: `src/types/canvas.ts`
- Create: `src/lib/backend.ts`
- Create: `src/store/useCanvasStore.ts`
- Create: `src/hooks/useAutoSave.ts`

**Steps:**
1. Define serializable Sticky, Sheet, and Image node models.
2. Implement the Tauri command adapter plus browser localStorage fallback.
3. Implement node CRUD, selection, viewport updates, editor state, and persistence status.
4. Add debounced metadata and Markdown autosave.
5. Add store tests for creation and persistence-safe updates.

### Task 4: Infinite canvas interactions

**Files:**
- Create: `src/components/canvas/InfiniteCanvas.tsx`
- Create: `src/components/canvas/CanvasNode.tsx`
- Create: `src/components/canvas/GridBackground.tsx`
- Create: `src/components/canvas/useImageElement.ts`

**Steps:**
1. Render a large Konva stage with a Windows-friendly artboard atmosphere.
2. Add cursor-centered wheel zoom, right-button/space pan, Home fit, and `0` reset.
3. Add draggable/selectable/resizable cards through a Konva Transformer.
4. Implement Sticky, Sheet, and local Image renderers.
5. Add keyboard deletion and double-click editing.

### Task 5: Product shell and editors

**Files:**
- Create: `src/App.tsx`
- Create: `src/components/shell/AppShell.tsx`
- Create: `src/components/shell/Toolbar.tsx`
- Create: `src/components/shell/StatusBar.tsx`
- Create: `src/components/editor/CardEditor.tsx`
- Create: `src/styles.css`

**Steps:**
1. Build a polished editorial/desktop shell around the canvas.
2. Add Sticky, Sheet, and Image actions.
3. Add a split Markdown editor and rendered preview.
4. Add Sticky color controls, title editing, autosave feedback, and workspace status.
5. Add empty-state guidance and drag/drop feedback.

### Task 6: Verification and delivery

**Files:**
- Create: `README.md`
- Create: `.gitignore`

**Steps:**
1. Run `npm test`.
2. Run `npm run build`.
3. Run `cargo fmt --all -- --check`.
4. Run `cargo check --manifest-path src-tauri/Cargo.toml`.
5. Fix all failures and document MVP scope, commands, storage layout, and deferred features.
