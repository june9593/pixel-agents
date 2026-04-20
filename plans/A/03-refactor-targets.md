# Refactor Targets

## High-LOC files

| File | LOC | Refactor suggestion |
|------|-----|---------------------|
| `webview-ui/src/office/sprites/spriteData.ts` | 1122 | Split fallback sprite definitions into per-category files (furniture, characters, bubbles); the file is pure data and splitting reduces merge conflicts |
| `webview-ui/src/office/components/OfficeCanvas.tsx` | 690 | Extract mouse/keyboard event handlers into `useCanvasInteractions` hook; separate edit-mode drag logic from camera/zoom logic |
| `webview-ui/src/office/engine/officeState.ts` | 677 | Extract `pickDiversePalette` + hue-shift character logic into `characterPalette.ts`; extract sub-agent seat assignment into `subagentSeating.ts` |
| `webview-ui/src/office/engine/renderer.ts` | 608 | Already well-structured with good constant extraction; consider splitting `renderScene` entity drawing from overlay/UI drawing |
| `webview-ui/src/hooks/useEditorActions.ts` | 527 | Split into domain hooks: `useFloorActions`, `useWallActions`, `useFurnitureActions` — each ~150 LOC |
| `webview-ui/src/office/editor/EditorToolbar.tsx` | 482 | Extract color slider panel (`HsbcSliders`) and furniture palette grid (`FurniturePalette`) as standalone components |
| `src/assetLoader.ts` | 441 | Extract PNG→SpriteData conversion to `pngToSprite.ts`; extract character sprite assembly to `characterSpriteLoader.ts` |

## Duplication candidates

### HSL→Hex conversion (high priority)
`colorize.ts:87–113` defines `hslToHex(h, s, l)` as a module-private function.  
`wallTiles.ts:145–163` reimplements the identical algorithm, even annotated with the comment `// HSL to hex (same as colorize.ts hslToHex)`.  
**Fix**: Export `hslToHex` from `colorize.ts` and import it in `wallTiles.ts`.

### Contrast/brightness normalization (medium priority)
Identical formula `const factor = (100 + c) / 100` + `lightness + b / 200` appears three times:
- `colorize.ts:63–69` (Colorize mode)
- `colorize.ts:161–169` (Adjust mode)
- `wallTiles.ts:128–141` (wall colorization)

**Fix**: Extract a `applyContrastBrightness(lightness, c, b)` helper in `colorize.ts` and call it from all three sites.

### Wall bitmask calculation (low priority)
`wallTiles.ts:43–48` (`getWallSprite`) and `wallTiles.ts:73–78` (`getColorizedWallSprite`) contain identical 4-bit neighbor mask construction:
```
let mask = 0
if (row > 0 && tileMap[row-1][col] === WALL) mask |= 1  // N
...
```
**Fix**: Extract `buildWallBitmask(row, col, tileMap)` and call from both functions.

## Dead code candidates

No unused exports found in `src/` or `webview-ui/src/`. All surveyed symbols have at least one consumer.

Notable: `spriteData.ts` exports 10+ fallback sprite constants (DESK_SQUARE_SPRITE, PLANT_SPRITE, etc.) that are only used as fallbacks when PNG loading fails. These are intentional, not dead code.

## Constants extraction

### `transcriptParser.ts:280` — inline `300` should reference existing constant
```ts
// transcriptParser.ts:280
}, 300);
```
`TOOL_DONE_DELAY_MS = 300` already exists in `src/constants.ts:5`. This is the only known case of a defined constant being duplicated inline.

### `colorize.ts:59` — luminance weights
```ts
let lightness = (0.299 * r + 0.587 * g + 0.114 * bv) / 255
```
Perceived luminance weights (ITU-R BT.601). Could add to `webview-ui/src/constants.ts` as:
```ts
export const LUMA_R = 0.299
export const LUMA_G = 0.587
export const LUMA_B = 0.114
```

### `webview-ui/src/office/components/OfficeCanvas.tsx:116–117` — sentinel value `-999`
```ts
ghostBorderHoverCol: showGhostBorder ? editorState.ghostCol : -999,
ghostBorderHoverRow: showGhostBorder ? editorState.ghostRow : -999,
```
Sentinel for "off-screen / disabled" is used but unnamed. Should be `GHOST_BORDER_DISABLED = -999` in `webview-ui/src/constants.ts`.

### `webview-ui/src/office/layout/layoutSerializer.ts:208–211` — default floor colors
```ts
const DEFAULT_LEFT_ROOM_COLOR: FloorColor = { h: 35, s: 30, b: 15, c: 0 }
const DEFAULT_RIGHT_ROOM_COLOR: FloorColor = { h: 25, s: 45, b: 5, c: 10 }
const DEFAULT_CARPET_COLOR: FloorColor = { h: 280, s: 40, b: -5, c: 0 }
const DEFAULT_DOORWAY_COLOR: FloorColor = { h: 35, s: 25, b: 10, c: 0 }
```
These are already named local consts — acceptable as-is, but could move to constants if reused elsewhere.
