# Temu Order Exporter v3.0.0

## Overview

Temu Order Exporter v3.0 is a focused UI/UX and interaction-quality release on top of the resilient v2.9 extraction engine. The dark cyan/neon identity is preserved, but the interface now has a clearer hierarchy, more readable density, safer motion, stronger keyboard behavior, and better bounded scrolling across the in-page panel and popup command center.

## UI and UX improvements

| Area | v3.0 improvement | User benefit |
|---|---|---|
| Visual hierarchy | Refined spacing, type scale, card radius, status emphasis, and muted-text contrast. | Important batch state and next actions are easier to scan. |
| Responsive layout | Added viewport-aware widths, bounded panel height, scroll-safe body/log/history regions, and narrow-screen breakpoints. | The panel is less likely to clip or overflow at small widths, browser zoom, or short windows. |
| Actions | Standardized button heights, hover/active surfaces, disabled-state contrast, icon alignment, and focus rings. | Controls are more predictable and easier to understand before clicking. |
| Status feedback | Progress and status surfaces now expose live/ARIA updates and warning-aware copy. | Screen readers and visual users receive clearer progress and completion feedback. |
| Drawers | Added focus cycling inside open drawers, Escape-to-close behavior, focus restoration, and minimized-state drawer cleanup. | Keyboard users cannot accidentally lose focus behind the panel. |
| History | Popup history is built with DOM nodes instead of interpolating stored values into HTML. | History display is safer and handles unusual stored text more robustly. |
| Motion | Added a consistent reduced-motion override for all new transitions and animations. | Motion preferences are respected without leaving partial or distracting animation states. |
| Diagnostics | History summaries include warning-note counts alongside errors. | Recoverable parser notes are not confused with hard failures. |
| Release hygiene | Version bumped to 3.0.0, preview labels updated, and synthetic preview data used. | Documentation and previews represent the shipped release without private Temu data. |

## Validation

The v3.0 source passes JavaScript syntax checks, manifest validation, worker concurrency/retry/recovery tests, popup and UI-state tests, multi-product extraction tests, XLSX generation and structure tests, and privacy/artifact scans. Browser previews were inspected for popup and right-anchored in-page panel hierarchy, action density, recovery card wrapping, history/log bounds, and responsive styling.

## Operational scope

The extension remains local-only and continues to read the rendered Temu Seller Center page, coordinate background detail tabs, and generate the workbook locally. It does not upload seller data or automate label purchase, payment, shipment confirmation, or final fulfillment submission.
