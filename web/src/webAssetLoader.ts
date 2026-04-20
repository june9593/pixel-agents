/**
 * Web Asset Loader — Loads PNG sprite assets from disk for the web server
 *
 * Replicates the functionality of src/assetLoader.ts from the VS Code extension,
 * but without VS Code dependencies. Reads PNG files and converts them to
 * SpriteData (2D arrays of hex color strings) for use in the webview.
 */

import * as fs from 'fs'
import * as path from 'path'
import { PNG } from 'pngjs'

// ── Constants (mirrored from src/constants.ts) ─────────────

const PNG_ALPHA_THRESHOLD = 128
const WALL_PIECE_WIDTH = 16
const WALL_PIECE_HEIGHT = 32
const WALL_GRID_COLS = 4
const WALL_BITMASK_COUNT = 16
const FLOOR_PATTERN_COUNT = 7
const FLOOR_TILE_SIZE = 16
const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const
const CHAR_FRAME_W = 16
const CHAR_FRAME_H = 32
const CHAR_FRAMES_PER_ROW = 7
const CHAR_COUNT = 6

type SpriteData = string[][]

// ── PNG → SpriteData conversion ────────────────────────────

function pngToSpriteData(pngBuffer: Buffer, width: number, height: number): SpriteData {
  try {
    const png = PNG.sync.read(pngBuffer)
    const sprite: SpriteData = []

    for (let y = 0; y < height; y++) {
      const row: string[] = []
      for (let x = 0; x < width; x++) {
        const idx = (y * png.width + x) * 4
        const r = png.data[idx]
        const g = png.data[idx + 1]
        const b = png.data[idx + 2]
        const a = png.data[idx + 3]
        if (a < PNG_ALPHA_THRESHOLD) {
          row.push('')
        } else {
          row.push(
            `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
          )
        }
      }
      sprite.push(row)
    }
    return sprite
  } catch {
    const sprite: SpriteData = []
    for (let y = 0; y < height; y++) {
      sprite.push(new Array(width).fill(''))
    }
    return sprite
  }
}

// ── Character Sprites ──────────────────────────────────────

export interface CharacterDirectionSprites {
  down: SpriteData[]
  up: SpriteData[]
  right: SpriteData[]
}

export function loadCharacterSprites(assetsRoot: string): CharacterDirectionSprites[] | null {
  const charDir = path.join(assetsRoot, 'characters')
  if (!fs.existsSync(charDir)) {
    console.log(`[WebAssetLoader] No characters dir at: ${charDir}`)
    return null
  }

  const characters: CharacterDirectionSprites[] = []

  for (let ci = 0; ci < CHAR_COUNT; ci++) {
    const filePath = path.join(charDir, `char_${ci}.png`)
    if (!fs.existsSync(filePath)) {
      console.log(`[WebAssetLoader] Missing character sprite: ${filePath}`)
      return null
    }

    const pngBuffer = fs.readFileSync(filePath)
    const png = PNG.sync.read(pngBuffer)
    const charData: CharacterDirectionSprites = { down: [], up: [], right: [] }

    for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
      const dir = CHARACTER_DIRECTIONS[dirIdx]
      const rowOffsetY = dirIdx * CHAR_FRAME_H
      const frames: SpriteData[] = []

      for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
        const sprite: SpriteData = []
        const frameOffsetX = f * CHAR_FRAME_W
        for (let y = 0; y < CHAR_FRAME_H; y++) {
          const row: string[] = []
          for (let x = 0; x < CHAR_FRAME_W; x++) {
            const idx = ((rowOffsetY + y) * png.width + (frameOffsetX + x)) * 4
            const r = png.data[idx]
            const g = png.data[idx + 1]
            const b = png.data[idx + 2]
            const a = png.data[idx + 3]
            if (a < PNG_ALPHA_THRESHOLD) {
              row.push('')
            } else {
              row.push(
                `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
              )
            }
          }
          sprite.push(row)
        }
        frames.push(sprite)
      }
      charData[dir] = frames
    }
    characters.push(charData)
  }

  console.log(`[WebAssetLoader] ✅ Loaded ${characters.length} character sprites`)
  return characters
}

// ── Wall Tiles ─────────────────────────────────────────────

export function loadWallTiles(assetsRoot: string): SpriteData[] | null {
  const wallPath = path.join(assetsRoot, 'walls.png')
  if (!fs.existsSync(wallPath)) {
    console.log(`[WebAssetLoader] No walls.png at: ${wallPath}`)
    return null
  }

  const pngBuffer = fs.readFileSync(wallPath)
  const png = PNG.sync.read(pngBuffer)
  const sprites: SpriteData[] = []

  for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
    const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH
    const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT
    const sprite: SpriteData = []
    for (let r = 0; r < WALL_PIECE_HEIGHT; r++) {
      const row: string[] = []
      for (let c = 0; c < WALL_PIECE_WIDTH; c++) {
        const idx = ((oy + r) * png.width + (ox + c)) * 4
        const rv = png.data[idx]
        const gv = png.data[idx + 1]
        const bv = png.data[idx + 2]
        const av = png.data[idx + 3]
        if (av < PNG_ALPHA_THRESHOLD) {
          row.push('')
        } else {
          row.push(
            `#${rv.toString(16).padStart(2, '0')}${gv.toString(16).padStart(2, '0')}${bv.toString(16).padStart(2, '0')}`.toUpperCase()
          )
        }
      }
      sprite.push(row)
    }
    sprites.push(sprite)
  }

  console.log(`[WebAssetLoader] ✅ Loaded ${sprites.length} wall tile pieces`)
  return sprites
}

// ── Floor Tiles ────────────────────────────────────────────

export function loadFloorTiles(assetsRoot: string): SpriteData[] | null {
  const floorPath = path.join(assetsRoot, 'floors.png')
  if (!fs.existsSync(floorPath)) {
    console.log(`[WebAssetLoader] No floors.png at: ${floorPath}`)
    return null
  }

  const pngBuffer = fs.readFileSync(floorPath)
  const png = PNG.sync.read(pngBuffer)
  const sprites: SpriteData[] = []

  for (let t = 0; t < FLOOR_PATTERN_COUNT; t++) {
    const sprite: SpriteData = []
    for (let y = 0; y < FLOOR_TILE_SIZE; y++) {
      const row: string[] = []
      for (let x = 0; x < FLOOR_TILE_SIZE; x++) {
        const px = t * FLOOR_TILE_SIZE + x
        const idx = (y * png.width + px) * 4
        const r = png.data[idx]
        const g = png.data[idx + 1]
        const b = png.data[idx + 2]
        const a = png.data[idx + 3]
        if (a < PNG_ALPHA_THRESHOLD) {
          row.push('')
        } else {
          row.push(
            `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
          )
        }
      }
      sprite.push(row)
    }
    sprites.push(sprite)
  }

  console.log(`[WebAssetLoader] ✅ Loaded ${sprites.length} floor tile patterns`)
  return sprites
}

// ── Furniture Assets ───────────────────────────────────────

export interface FurnitureAsset {
  id: string
  name: string
  label: string
  category: string
  file: string
  width: number
  height: number
  footprintW: number
  footprintH: number
  isDesk: boolean
  canPlaceOnWalls: boolean
  partOfGroup?: boolean
  groupId?: string
  canPlaceOnSurfaces?: boolean
  backgroundTiles?: number
}

export function loadFurnitureAssets(
  assetsRoot: string
): { catalog: FurnitureAsset[]; sprites: Record<string, SpriteData> } | null {
  const catalogPath = path.join(assetsRoot, 'furniture', 'furniture-catalog.json')
  if (!fs.existsSync(catalogPath)) {
    console.log(`[WebAssetLoader] No furniture catalog at: ${catalogPath}`)
    return null
  }

  const catalogContent = fs.readFileSync(catalogPath, 'utf-8')
  const catalogData = JSON.parse(catalogContent)
  const catalog: FurnitureAsset[] = catalogData.assets || []
  const sprites: Record<string, SpriteData> = {}

  for (const asset of catalog) {
    try {
      // asset.file is like "furniture/decor/PAPER_SIDE.png"
      // assetsRoot is like ".../webview-ui/public/assets"
      const assetPath = path.join(assetsRoot, asset.file)

      if (!fs.existsSync(assetPath)) {
        continue
      }

      const pngBuffer = fs.readFileSync(assetPath)
      sprites[asset.id] = pngToSpriteData(pngBuffer, asset.width, asset.height)
    } catch {
      // skip failed assets
    }
  }

  console.log(`[WebAssetLoader] ✅ Loaded ${Object.keys(sprites).length}/${catalog.length} furniture sprites`)
  return { catalog, sprites }
}

// ── Load All Assets ────────────────────────────────────────

export interface AllAssets {
  characters: CharacterDirectionSprites[] | null
  wallTiles: SpriteData[] | null
  floorTiles: SpriteData[] | null
  furniture: { catalog: FurnitureAsset[]; sprites: Record<string, SpriteData> } | null
}

/**
 * Load all available assets from the given assets directory.
 * The assetsRoot should point to the directory containing characters/, walls.png, etc.
 */
export function loadAllAssets(assetsRoot: string): AllAssets {
  console.log(`[WebAssetLoader] Loading assets from: ${assetsRoot}`)

  return {
    characters: loadCharacterSprites(assetsRoot),
    wallTiles: loadWallTiles(assetsRoot),
    floorTiles: loadFloorTiles(assetsRoot),
    furniture: loadFurnitureAssets(assetsRoot),
  }
}
