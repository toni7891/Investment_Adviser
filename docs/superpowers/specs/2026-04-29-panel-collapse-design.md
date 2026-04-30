# Panel Collapse/Expand — Design Spec

## Overview

Add independent collapse/expand toggle buttons to two dashboard sections: **Portfolio Heartrate** and **AI Strategist**. When collapsed, each section shrinks to a compact amber pill button. Clicking the pill restores the section. No state persistence — always starts expanded on page load.

## Sections Affected

| Section | HTML element | Content wrapper |
|---|---|---|
| Portfolio Heartrate | `<section class="heartrate-section" id="heartrateSection">` | `.heartrate-chart-wrap` |
| AI Strategist | `<aside class="ai-pane">` | `.chat-container` |

## Interaction Design

### Toggle button
- A small `⊟ HIDE` button added to the right side of each section's `.pane-hdr`
- Styled consistently with existing `.act-btn` pattern: small, monospace, dark background

### Collapse behavior (CSS max-height animation, 200ms ease-out)
1. User clicks `⊟ HIDE`
2. Content wrapper (`max-height` → `0`, `overflow: hidden`) animates in 200ms ease-out
3. The toggle button hides
4. A rounded amber pill button (`▶ HEARTRATE` or `▶ AI STRATEGIST`) fades in, replacing the section

### Expand behavior (200ms ease-in)
1. User clicks the pill
2. Pill fades out
3. Content wrapper animates from `max-height: 0` → full height in 200ms ease-in
4. `⊟ HIDE` button reappears

### Independence
Both sections toggle independently. Either, both, or neither can be collapsed simultaneously.

## CSS Changes (`style.css`)

- Add `.collapsed` modifier to `.heartrate-section` and `.ai-pane`
- `.heartrate-section .heartrate-chart-wrap` and `.ai-pane .chat-container`: add `max-height` with transition
- `.heartrate-section.collapsed .heartrate-chart-wrap` / `.ai-pane.collapsed .chat-container`: `max-height: 0`
- `.panel-pill` — new class for the amber pill button (rounded, amber border/text, monospace, `▶` prefix)
- `.panel-pill.hidden` — `display: none`
- `.panel-toggle-btn` — the `⊟ HIDE` button in the header

## JS Changes (`app.js`)

Two small toggle functions (or one shared helper), wired to:
- `⊟ HIDE` buttons in each `.pane-hdr`
- The pill buttons that appear when collapsed

No localStorage. No height measurement. Pure class toggle.

## No-persistence contract

State always resets to expanded on every page load. No localStorage read or write.
