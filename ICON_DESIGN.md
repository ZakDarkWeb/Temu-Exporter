# Temu Order Exporter v2.8 Icon Design

## Concept

The v2.8 icon uses a simple **TO monogram** for Temu Order Exporter. The mark is rendered in high-contrast white with a cyan neon edge on a deep navy rounded-square field. The `O` contains an upward export arrow so the symbol communicates both the product identity and its main job: extracting order data into a local Excel workbook.

The icon is intentionally simple rather than text-heavy. At Chrome toolbar size, a compact symbol remains recognizable more reliably than a full product name or small descriptive label. The glass-grid background and cyan rim glow match the extension’s existing ZHunter PRO-inspired dark navy/cyan interface.

## Registered assets

| Chrome use | File | Dimensions |
|---|---|---:|
| Toolbar small action icon | `icons/icon16.png` | 16 × 16 px |
| Toolbar and extension UI | `icons/icon32.png` | 32 × 32 px |
| Extension management surfaces | `icons/icon48.png` | 48 × 48 px |
| Extension card and high-density surfaces | `icons/icon128.png` | 128 × 128 px |

The same assets are registered under both Manifest V3 `icons` and `action.default_icon`. No new permissions or host access are required. The icon source is kept in `icon_source.png`, and `make_icons.py` provides a reproducible Pillow resize path for regenerating the four PNG outputs.

## Visual constraints

The icon set keeps the background opaque and dark so it remains visible against Chrome’s light and dark extension-management surfaces. The monogram uses a large silhouette and minimal internal detail for small-size legibility. The cyan glow is restrained at the 16px output so the mark remains crisp instead of becoming a blurred light spot.

## Visual QA

The 128px output preserves the bold TO silhouette, cyan rim glow, dark navy grid, and integrated export arrow. The 16px output remains legible as a compact TO mark with a visible upward arrow and does not collapse into an indistinct glow. Chrome-size PNGs were generated as RGBA files at exactly 16, 32, 48, and 128 pixels.
