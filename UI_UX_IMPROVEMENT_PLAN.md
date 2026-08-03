# QuizBuddy AI — UI/UX Improvement Plan

> **Current State**: 4,400-line content.js + 2,890-line CSS — all in single files, no design system, confusing IA, scattered settings, poor onboarding.

---

## 1. Core Problems Identified

### Information Architecture (IA)
| Problem | Impact |
|---------|--------|
| 4 tabs with unclear purposes: "Capture" = Select & Transform, "Quiz" = Question Analysis, "Chat", "Library" | Users don't know where to start |
| Settings scattered across tabs: Provider/OCR/Subject/Mode in Quiz; Profile/Memories/Custom Skills in Capture; Retention in Library | Cannot find settings |
| No primary/secondary action hierarchy — everything looks equal | Cognitive overload |
| Context switching requires tab changes + scrolling | Slow workflows |

### Visual Design
| Problem | Impact |
|---------|--------|
| 12+ font sizes (10px–20px), no type scale | Inconsistent, unprofessional |
| 6+ button variants, no design tokens | Hard to maintain, confusing |
| Every section in its own bordered card → "card soup" | Visual noise, no focus |
| Primary purple (#4f46e5) overused on primary + secondary + destructive actions | No semantic color meaning |
| 420px sidebar default on laptop screens | Covers too much content |

### Interaction & Usability
| Problem | Impact |
|---------|--------|
| Model setup: 5 states (checking/permission/downloading/cached/error) with unclear copy | Users stuck, don't know what to click |
| OCR flow: Crop → Edit OCR → Click "Analyze Question" → Result (3+ steps) | Friction for core task |
| No onboarding, no empty states with guidance | New users abandon |
| Floating button: click vs drag ambiguity, dock behavior non-obvious | Accidental actions |
| Error messages: red text only, no recovery actions | Dead ends |
| Keyboard shortcuts hidden (only Alt+Shift+Q) | Power users can't discover |

### Architecture
| Problem | Impact |
|---------|--------|
| Single 4,400-line IIFE in content.js | Impossible to maintain/test |
| 2,890-line CSS with no design tokens | Changes break things |
| 100+ mutable variables at top scope | Bug-prone, hard to reason about |

---

## 2. Proposed Information Architecture (New)

### Tab Structure (3 tabs + 1 overflow menu)

```
┌─────────────────────────────────────────────┐
│  [Ask]  [Capture]  [Library]  [⋮]           │  ← Top-level tabs
└─────────────────────────────────────────────┘
```

| Tab | Purpose | Key Content |
|-----|---------|-------------|
| **Ask** | *Primary* — Ask anything about current page/selection/image | Chat input, model/provider picker, attach image, quick actions |
| **Capture** | Transform page content (explain, summarize, extract, quiz, research) | Capture source → Skill picker → Result → Save |
| **Library** | Saved workspaces, artifacts, memories, custom skills | Workspace picker, search, list, import/export |
| **⋮ Menu** | Settings, Model, Theme, Shortcuts, About, Help | All settings consolidated |

### Rationale
- **"Ask"** = conversational interface (chat + vision) — most natural entry point
- **"Capture"** = structured transformation workflows (skills) — for power users
- **"Library"** = persistence layer — separate from active work
- **Settings in menu** — out of the way but discoverable

---

## 3. Design System Foundation

### Design Tokens (define once, use everywhere)

```css
/* tokens.css - single source of truth */
:host {
  /* Color - Semantic */
  --color-bg: #f4f6fb;
  --color-surface: #ffffff;
  --color-surface-hover: #f8fafc;
  --color-border: #dbe2ea;
  --color-border-strong: #cbd5e1;
  --color-border-focus: #818cf8;
  
  --color-text: #172033;
  --color-text-secondary: #667085;
  --color-text-muted: #98a2b3;
  --color-text-inverse: #ffffff;
  
  --color-primary: #4f46e5;
  --color-primary-hover: #4338ca;
  --color-primary-soft: #eef2ff;
  --color-primary-strong: #3730a3;
  
  --color-success: #16a34a;
  --color-success-soft: #dcfce7;
  --color-warning: #f59e0b;
  --color-warning-soft: #fef3c7;
  --color-danger: #ef4444;
  --color-danger-soft: #fee2e2;
  
  /* Typography - Fluid scale */
  --font-sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  
  --text-xs: 10px;    --text-xs-lh: 1.4;
  --text-sm: 12px;    --text-sm-lh: 1.5;
  --text-base: 13px;  --text-base-lh: 1.55;
  --text-lg: 14px;    --text-lg-lh: 1.5;
  --text-xl: 16px;    --text-xl-lh: 1.4;
  --text-2xl: 18px;   --text-2xl-lh: 1.3;
  --text-3xl: 20px;   --text-3xl-lh: 1.25;
  
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
  
  /* Spacing - 4px base */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;
  --space-4: 16px;  --space-5: 20px;  --space-6: 24px;
  --space-8: 32px;  --space-10: 40px; --space-12: 48px;
  
  /* Radius */
  --radius-sm: 6px;  --radius-md: 8px;  --radius-lg: 12px;  --radius-xl: 16px;  --radius-full: 999px;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(15,23,42,0.06);
  --shadow-md: 0 4px 12px rgba(15,23,42,0.1);
  --shadow-lg: 0 8px 24px rgba(15,23,42,0.16);
  --shadow-xl: 0 16px 48px rgba(15,23,42,0.2);
  
  /* Transitions */
  --transition-fast: 120ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;
  
  /* Z-index scale */
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal: 300;
  --z-toast: 400;
  --z-tooltip: 500;
  
  /* Sidebar */
  --sidebar-width: 380px;        /* Reduced from 420px */
  --sidebar-width-max: 92vw;
  --sidebar-width-min: 340px;
}
```

### Component Primitives (build once)

| Component | Variants | States |
|-----------|----------|--------|
| `qb-button` | primary, secondary, ghost, danger, subtle | default, hover, active, disabled, loading |
| `qb-input` | text, textarea, select, search | default, focus, error, disabled |
| `qb-card` | elevated, outlined, filled | - |
| `qb-badge` | neutral, success, warning, danger, info | - |
| `qb-tab` | underline, pill | active, inactive |
| `qb-tooltip` | top, bottom, left, right | - |
| `qb-empty-state` | icon, title, description, action | - |
| `qb-progress` | linear, circular | indeterminate, determinate |

---

## 4. Key Flow Redesigns

### 4.1 First-Time Onboarding (3 steps)

```
┌────────────────────────────────────┐
│  Welcome to QuizBuddy Labs! 👋     │
│  Choose your AI provider to start. │
├────────────────────────────────────┤
│  ┌──────────────────────────────┐  │
│  │  Local WebGPU (No Internet)  │  │  ← Recommended card
│  │  Runs 100% in your browser   │  │
│  │  ~2 GB GPU memory needed     │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  OpenAI Compatible API       │  │
│  │  Use your own API key        │  │
│  │  Vision models supported     │  │
│  └──────────────────────────────┘  │
│        [Continue]                   │
└────────────────────────────────────┘
```

### 4.2 Model Setup — Clear State Machine

```
States:  [Not Downloaded] → [Downloading...] → [Cached] → [Loaded/Ready]
                ↓                                    ↑
             [Error] ←────────────────────────────────┘
```

Each state shows:
- **What's happening** (1 line)
- **What user should do** (1 button, primary action)
- **Time estimate** (for downloading)

### 4.3 Unified "Ask" Flow (New Primary Tab)

```
┌────────────────────────────────────┐
│ Ask                    [Model ▼]   │  ← Model/Provider picker always visible
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ Type a question, or...         │ │  ← Empty state with hints
│ │ • Paste image (Ctrl+V)         │ │
│ │ • Crop screen area             │ │
│ │ • Use page selection           │ │
│ └────────────────────────────────┘ │
│                                    │
│ [Attach Image] [Crop Screen]       │  ← Primary actions
│                                    │
│ ┌────────────────────────────────┐ │
│ │ [Message input with auto-grow] │ │
│ │ [Send]                         │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

**Eliminates**: Separate OCR editing step for API vision mode. For local mode: crop → auto-OCR → auto-analyze → result (with "Edit OCR" as secondary action on result).

### 4.4 Capture Flow (Structured Skills)

```
Step 1: Choose Source          Step 2: Pick Skill           Step 3: Result + Actions
┌────────────────────────┐     ┌────────────────────────┐   ┌────────────────────────┐
│ [Selection] [Page]     │     │ [Explain] [Summarize]  │   │ ┌────────────────────┐ │
│ [Last Crop] [Crop]     │ ──→ │ [Quiz] [Translate]     │ ──→ │ │ Result content     │ │
│                        │     │ [Research] [Extract]   │     │ ├────────────────────┤ │
│ [Continue]             │     │ [Custom Skills...]     │     │ │ [Save] [Copy]      │ │
└────────────────────────┘     └────────────────────────┘     │ │ [Ask Follow-up]    │ │
                                                              │ └────────────────────┘ │
                                                              └────────────────────────┘
```

---

## 5. File Structure Refactor

```
content/
├── index.js                 # Entry — mounts app, registers SW
├── app/
│   ├── App.js              # Root component, state orchestration
│   ├── router.js           # Tab routing (hash-based or state)
│   └── providers.js        # Theme, Settings, Model, Workspace contexts
├── features/
│   ├── ask/                # Ask tab (chat + vision)
│   │   ├── AskPanel.js
│   │   ├── ChatInput.js
│   │   ├── MessageList.js
│   │   ├── ModelPicker.js
│   │   └── CropLauncher.js
│   ├── capture/            # Capture tab (skills)
│   │   ├── CapturePanel.js
│   │   ├── SourcePicker.js
│   │   ├── SkillPicker.js
│   │   ├── SkillResult.js
│   │   └── FollowUp.js
│   ├── library/            # Library tab
│   │   ├── LibraryPanel.js
│   │   ├── WorkspacePicker.js
│   │   ├── ArtifactList.js
│   │   └── MemoryManager.js
│   └── settings/           # Settings modal (from ⋮ menu)
│       ├── SettingsModal.js
│       ├── ModelSettings.js
│       ├── ProviderSettings.js
│       ├── AppearanceSettings.js
│       ├── ShortcutsSettings.js
│       └── DataSettings.js
├── components/             # Shared primitives
│   ├── Button.js
│   ├── Input.js
│   ├── Select.js
│   ├── Card.js
│   ├── Badge.js
│   ├── Tab.js
│   ├── Tooltip.js
│   ├── Progress.js
│   ├── EmptyState.js
│   ├── Modal.js
│   ├── Dropdown.js
│   └── Toast.js
├── ui/
│   ├── Sidebar.js          # Shell: floating btn, sidebar, resize
│   ├── FloatingButton.js
│   ├── CropOverlay.js
│   └── RecropModal.js
├── hooks/                  # Reusable logic
│   ├── useStorage.js
│   ├── useModel.js
│   ├── useWorkspace.js
│   ├── useTheme.js
│   └── useShortcuts.js
├── utils/
│   ├── dom.js              # createElement, renderMarkdown, etc.
│   ├── format.js           # formatMemory, formatDate, etc.
│   └── validation.js
├── styles/
│   ├── tokens.css          # Design tokens (imported first)
│   ├── primitives.css      # Component primitive styles
│   ├── layout.css          # Sidebar, grid, spacing utilities
│   ├── features/           # Feature-specific styles
│   └── themes.css          # Dark mode overrides
└── content.css             # Rollup entry (imports all above)
```

**Build change**: Update `scripts/build.mjs` to use esbuild with multiple entry points and CSS modules (or postcss).

---

## 6. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Extract design tokens → `tokens.css`
- [ ] Create component primitives (Button, Input, Card, Badge, Tab, Tooltip, Progress, EmptyState, Modal)
- [ ] Set up modular CSS structure with build pipeline
- [ ] Add TypeScript (optional) or JSDoc types for component props

### Phase 2: Shell & Navigation (Week 2-3)
- [ ] Refactor `Sidebar.js` / `FloatingButton.js` / `CropOverlay.js` as standalone components
- [ ] Implement tab router (Ask/Capture/Library/Settings)
- [ ] Move all settings to SettingsModal (from ⋮ menu)
- [ ] Reduce sidebar default width to 380px

### Phase 3: "Ask" Tab — Primary Flow (Week 3-4)
- [ ] Build `AskPanel` with unified chat + vision input
- [ ] ModelPicker always visible in header
- [ ] Crop launcher integrated (one-click crop → auto-analyze)
- [ ] Streaming responses with proper UX
- [ ] Empty state with onboarding hints

### Phase 4: "Capture" Tab — Skill Workflows (Week 4-5)
- [ ] Two-step flow: Source → Skill → Result
- [ ] SkillPicker with categories (Transform, Research, Quiz, Custom)
- [ ] Result view with primary actions: Save, Copy, Follow-up, Practice
- [ ] Inline OCR editing (only when needed, not default)

### Phase 5: "Library" Tab (Week 5)
- [ ] Workspace picker + artifact list with search
- [ ] Inline actions: Pin, Rename, Duplicate, Delete, Continue
- [ ] Import/Export/Retention in Settings modal
- [ ] Memories & Custom Skills management

### Phase 6: Settings & Onboarding (Week 5-6)
- [ ] Settings modal with sections: Model, Provider, Appearance, Shortcuts, Data
- [ ] First-run onboarding flow (provider selection → model download)
- [ ] Model setup state machine with clear copy
- [ ] Tooltips for all icon-only buttons

### Phase 7: Polish & Accessibility (Week 6-7)
- [ ] Full keyboard navigation (Tab, Arrow keys, Enter, Escape)
- [ ] Focus management in modals/overlays
- [ ] ARIA labels, roles, live regions
- [ ] Reduced motion support
- [ ] High contrast mode check
- [ ] Performance: lazy-load heavy features (Library, Recrop)

### Phase 8: Cleanup (Week 7)
- [ ] Remove dead code from old content.js
- [ ] Delete unused CSS
- [ ] Update build script
- [ ] Documentation: component usage, token reference

---

## 7. Quick Wins (Can Do This Week)

| Task | Effort | Impact |
|------|--------|--------|
| Reduce sidebar default width to 380px | 5 min | Immediate space savings |
| Add tooltips to all icon-only buttons (theme, close, attach, send) | 30 min | Discoverability |
| Group Quiz tab settings into collapsible sections with headers | 1 hr | Visual hierarchy |
| Add empty states with guidance to Chat, Library, Capture tabs | 2 hr | Onboarding |
| Fix floating button click-vs-drag: require 8px drag threshold | 30 min | Prevent accidental dock |
| Semantic button colors: Primary=purple, Secondary=gray, Danger=red, Ghost=transparent | 1 hr | Clear actions |
| Add "Edit OCR" as inline link on result (not separate step) | 2 hr | Reduce friction |
| Keyboard shortcut hints in tooltips (e.g., "Crop: Alt+Shift+Q") | 30 min | Power user discovery |

---

## 8. Migration Strategy

**Do NOT rewrite all at once.** Use strangler fig pattern:

1. **New files alongside old** — new components in `content/app/`, `content/features/`, etc.
2. **Shared entry point** — `content/index.js` mounts new `App.js` but keeps old IIFE for un-migrated features
3. **Migrate tab by tab** — Ask → Capture → Library → Settings
4. **CSS: tokens first** — define tokens, migrate primitives, then features
5. **Feature flags** — `localStorage.setItem('qb_new_ui', 'true')` to test

---

## 9. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Time to first successful analysis | ~3 min | < 60 sec |
| Settings discovery rate (user finds model settings) | ~20% | > 80% |
| Sidebar width on 13" laptop | 420px (35%) | 380px (30%) |
| CSS bundle size | 55 KB | < 35 KB (with purge) |
| JS bundle size (content) | 157 KB | < 100 KB (code-split) |
| Accessibility score (axe) | Unknown | 0 violations |

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing user workflows | Feature flag, gradual rollout, user feedback |
| Build complexity increase | Keep esbuild config simple, avoid heavy tooling |
| Scope creep | Strict phase gates, timebox each phase |
| Regression in offscreen/background communication | Keep message protocol identical, integration tests |

---

*This plan is a living document. Update as phases complete.*