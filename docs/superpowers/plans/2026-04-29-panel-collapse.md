# Panel Collapse/Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent collapse/expand toggle buttons to the Portfolio Heartrate section and AI Strategist pane; collapsed state shows a compact amber pill.

**Architecture:** Each section gets a `⊟ HIDE` button injected into its `.pane-hdr`. Clicking it toggles a `.collapsed` CSS class on the parent section/aside, which transitions the content wrapper's `max-height` from full → 0 in 200ms. The header visually transforms into a pill-like strip via CSS. A single shared JS helper wires up both toggles.

**Tech Stack:** Vanilla JS, CSS custom properties (already defined), no build step.

---

## File Map

| File | Change |
|---|---|
| `frontend/public/dashboard.html` | Add `id="aiPane"` to `<aside>`, add toggle buttons to both `.pane-hdr`s |
| `frontend/public/static/style.css` | Add `.panel-toggle-btn`, `.collapsed` content rules, pill-mode header rules |
| `frontend/public/static/app.js` | Add `setupPanelToggle()` helper + two call sites at the bottom of init |

---

### Task 1: Add IDs and toggle buttons to dashboard.html

**Files:**
- Modify: `frontend/public/dashboard.html:125` (AI pane `<aside>`)
- Modify: `frontend/public/dashboard.html:126-129` (AI pane `.pane-hdr`)
- Modify: `frontend/public/dashboard.html:160-173` (heartrate `.heartrate-controls`)

- [ ] **Step 1: Add `id="aiPane"` to the AI aside and a toggle button inside its header**

  Find this block (lines 125–129):
  ```html
  <!-- AI Strategist Pane -->
  <aside class="ai-pane">
    <div class="pane-hdr">
      <span class="pane-title">// AI STRATEGIST</span>
      <span class="ai-tag">◉ LLM</span>
    </div>
  ```

  Replace with:
  ```html
  <!-- AI Strategist Pane -->
  <aside class="ai-pane" id="aiPane">
    <div class="pane-hdr">
      <span class="pane-title">// AI STRATEGIST</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="ai-tag">◉ LLM</span>
        <button class="panel-toggle-btn" id="aiPaneToggle">⊟ HIDE</button>
      </div>
    </div>
  ```

- [ ] **Step 2: Add a toggle button to the heartrate section header**

  Find this block (lines 160–173 — the `.heartrate-controls` div):
  ```html
  <div class="heartrate-controls">
    <div class="period-tabs">
  ```

  Replace with:
  ```html
  <div class="heartrate-controls">
    <button class="panel-toggle-btn" id="heartrateToggle">⊟ HIDE</button>
    <div class="period-tabs">
  ```

- [ ] **Step 3: Open the dashboard in a browser and verify both `⊟ HIDE` buttons appear in the correct headers (styled or unstyled — they just need to be present)**

---

### Task 2: Add CSS for toggle button, collapsed content, and pill header

**Files:**
- Modify: `frontend/public/static/style.css` — append after the `.act-btn--amber:hover` block (line 947) and after the `.heartrate-chart-wrap` block (line 1595)

- [ ] **Step 1: Add `.panel-toggle-btn` style after the `.act-btn--amber:hover` rule (around line 947)**

  Find:
  ```css
  .act-btn--amber:hover { background: rgba(240,180,41,0.18); }
  ```

  Add after it:
  ```css

  .panel-toggle-btn {
    height: 22px;
    padding: 0 8px;
    border-radius: 99px;
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    border: 1px solid var(--rim);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }
  .panel-toggle-btn:hover {
    background: var(--amber-lo);
    border-color: var(--amber);
    color: var(--amber);
  }
  ```

- [ ] **Step 2: Add transition + overflow to `.heartrate-chart-wrap` and `.chat-container`, and add collapsed rules**

  Find:
  ```css
  .heartrate-chart-wrap {
    position: relative;
    height: 200px;
    padding: 12px 20px 16px;
  }
  ```

  Replace with:
  ```css
  .heartrate-chart-wrap {
    position: relative;
    height: 200px;
    padding: 12px 20px 16px;
    overflow: hidden;
    max-height: 240px;
    transition: max-height 0.2s ease-out;
  }
  ```

  Then find:
  ```css
  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  ```

  Replace with:
  ```css
  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    max-height: 800px;
    transition: max-height 0.2s ease-out;
  }
  ```

- [ ] **Step 3: Add collapsed rules and pill-mode header styles. Append this block after the `.heartrate-chart-wrap` section (after the `.chart-empty` and `#portfolioChart` rules, before the responsive breakpoints):**

  Find (somewhere around line 1614):
  ```css
  #portfolioChart {
  ```

  Add before it (keep `#portfolioChart` in place, just prepend this block):
  ```css
  /* ────────────────────────────────────
     PANEL COLLAPSE
  ────────────────────────────────────── */
  .heartrate-section.collapsed .heartrate-chart-wrap {
    max-height: 0;
  }

  .ai-pane.collapsed .chat-container {
    max-height: 0;
  }

  .heartrate-section.collapsed .pane-hdr,
  .ai-pane.collapsed .pane-hdr {
    border-bottom: none;
    border-radius: 99px;
    margin: 6px 12px;
    border: 1px solid var(--rim);
    cursor: pointer;
  }

  .heartrate-section.collapsed,
  .ai-pane.collapsed {
    background: transparent;
  }

  ```

- [ ] **Step 4: Verify in the browser: the `⊟ HIDE` buttons are now styled as small rounded pills in the header. No collapse behavior yet — that's next.**

---

### Task 3: Add JS toggle logic to app.js

**Files:**
- Modify: `frontend/public/static/app.js` — append near the bottom, after existing event listener setup

- [ ] **Step 1: Find the bottom of the event listener / init block in app.js**

  Run:
  ```bash
  grep -n "period-btn\|takeSnapshot\|importHistory\|exportHistory" frontend/public/static/app.js | tail -10
  ```

  Note the last line number of the existing button-wiring code. The new code goes after it, before or at the end of the file's init section.

- [ ] **Step 2: Add the shared toggle helper and wire it to both sections**

  Append after the last existing event listener block (do not replace anything — add at the end of the init section):

  ```javascript
  // Panel collapse/expand
  function setupPanelToggle(btnId, panelId) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = panel.classList.toggle('collapsed');
      btn.textContent = isCollapsed ? '▶ SHOW' : '⊟ HIDE';
    });
    panel.addEventListener('click', (e) => {
      if (!panel.classList.contains('collapsed')) return;
      panel.classList.remove('collapsed');
      btn.textContent = '⊟ HIDE';
    });
  }

  setupPanelToggle('aiPaneToggle', 'aiPane');
  setupPanelToggle('heartrateToggle', 'heartrateSection');
  ```

  The second listener on `panel` allows clicking anywhere on the collapsed pill-header to expand — matching the UX spec.

- [ ] **Step 3: Open the dashboard in a browser and test:**
  - Click `⊟ HIDE` on AI Strategist → chat collapses in ~200ms, button changes to `▶ SHOW`, header becomes pill-shaped
  - Click `▶ SHOW` → chat expands
  - Click anywhere on the collapsed pill header → also expands
  - Click `⊟ HIDE` on Portfolio Heartrate → chart collapses, same behavior
  - Both panels toggle independently (collapse one, the other stays open)
  - Refresh page → both panels start expanded (no persistence)

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/public/dashboard.html frontend/public/static/style.css frontend/public/static/app.js
  git commit -m "feat: add collapse/expand toggle to AI chat and heartrate panels"
  ```
