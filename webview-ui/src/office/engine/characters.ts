import { CharacterState, Direction, TILE_SIZE } from '../types.js'
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js'
import type { CharacterSprites } from '../sprites/spriteData.js'
import { findPath } from '../layout/tileMap.js'
import {
  WALK_SPEED_PX_PER_SEC,
  WALK_FRAME_DURATION_SEC,
  TYPE_FRAME_DURATION_SEC,
  WANDER_PAUSE_MIN_SEC,
  WANDER_PAUSE_MAX_SEC,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_MOVES_BEFORE_REST_MAX,
  SEAT_REST_MIN_SEC,
  SEAT_REST_MAX_SEC,
} from '../../constants.js'

/** Tools that show reading animation instead of typing */
const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])

export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false
  return READING_TOOLS.has(tool)
}

// ── Smart wander targets based on tool type ──────────────────
// These tile zones correspond to areas in the default-layout.json

/** Bookshelf area — characters go here when using Read/Grep/Glob tools */
const BOOKSHELF_TILES = [
  { col: 1, row: 12 }, { col: 2, row: 12 }, { col: 3, row: 12 },
  { col: 5, row: 12 }, { col: 7, row: 12 }, { col: 8, row: 12 },
  { col: 9, row: 12 },
]

/** Kitchen/break area — characters visit during idle breaks */
const KITCHEN_TILES = [
  { col: 12, row: 12 }, { col: 13, row: 12 }, { col: 14, row: 12 },
  { col: 15, row: 12 }, { col: 16, row: 12 }, { col: 17, row: 12 },
  { col: 18, row: 12 },
]

/** Lounge area — characters go here when waiting for user input */
const LOUNGE_TILES = [
  { col: 14, row: 18 }, { col: 15, row: 18 }, { col: 16, row: 18 },
  { col: 17, row: 18 }, { col: 18, row: 18 },
  { col: 15, row: 19 }, { col: 16, row: 19 }, { col: 17, row: 19 },
]

/** Meeting room — characters go here for Task/subtask tools */
const MEETING_TILES = [
  { col: 5, row: 4 }, { col: 5, row: 5 }, { col: 6, row: 5 },
  { col: 6, row: 6 }, { col: 5, row: 6 },
]

/** Pick a random tile from a zone, falling back to any walkable tile */
function pickZoneTile(
  zone: Array<{ col: number; row: number }>,
  walkableTiles: Array<{ col: number; row: number }>,
): { col: number; row: number } {
  // Filter zone tiles to only those that are walkable
  const valid = zone.filter(z => walkableTiles.some(w => w.col === z.col && w.row === z.row))
  if (valid.length > 0) {
    return valid[Math.floor(Math.random() * valid.length)]
  }
  return walkableTiles[Math.floor(Math.random() * walkableTiles.length)]
}

/** Get a themed wander target based on what the character is doing */
export function getThemedWanderTarget(
  ch: Character,
  walkableTiles: Array<{ col: number; row: number }>,
): { col: number; row: number } {
  // When idle and about to wander, pick themed destinations
  if (ch.currentTool) {
    if (READING_TOOLS.has(ch.currentTool)) {
      return pickZoneTile(BOOKSHELF_TILES, walkableTiles)
    }
    if (ch.currentTool === 'Task') {
      return pickZoneTile(MEETING_TILES, walkableTiles)
    }
  }
  // Idle wandering: themed destinations with mini-interactions
  const roll = Math.random()
  if (roll < 0.15) {
    // Go get coffee near the vending machine / water cooler
    const coffeeTiles = [
      { col: 11, row: 12 }, { col: 12, row: 12 }, { col: 13, row: 12 },
    ]
    return pickZoneTile(coffeeTiles, walkableTiles)
  } else if (roll < 0.25) {
    // Visit a plant (near the potted plants)
    const plantTiles = [
      { col: 1, row: 12 }, { col: 10, row: 19 }, { col: 8, row: 1 },
    ]
    return pickZoneTile(plantTiles, walkableTiles)
  } else if (roll < 0.4) {
    return pickZoneTile(KITCHEN_TILES, walkableTiles)
  } else if (roll < 0.55) {
    return pickZoneTile(LOUNGE_TILES, walkableTiles)
  }
  // Default: random walkable tile
  return walkableTiles[Math.floor(Math.random() * walkableTiles.length)]
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  }
}

/** Direction from one tile to an adjacent tile */
function directionBetween(fromCol: number, fromRow: number, toCol: number, toRow: number): Direction {
  const dc = toCol - fromCol
  const dr = toRow - fromRow
  if (dc > 0) return Direction.RIGHT
  if (dc < 0) return Direction.LEFT
  if (dr > 0) return Direction.DOWN
  return Direction.UP
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1
  const row = seat ? seat.seatRow : 1
  const center = tileCenter(col, row)
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    isActive: true,
    seatId,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
  }
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  ch.frameTimer += dt

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC
        ch.frame = (ch.frame + 1) % 2
      }
      // Track idle time when not active (for sleepy/nap behavior)
      if (!ch.isActive) {
        ch.idleElapsed = (ch.idleElapsed || 0) + dt
      } else {
        ch.idleElapsed = 0
      }
      // If no longer active, stand up and start wandering (after seatTimer expires)
      if (!ch.isActive) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt
          break
        }
        ch.seatTimer = 0 // clear sentinel
        ch.state = CharacterState.IDLE
        ch.frame = 0
        ch.frameTimer = 0
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC)
        ch.wanderCount = 0
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX)
      }
      break
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0
      if (ch.seatTimer < 0) ch.seatTimer = 0 // clear turn-end sentinel
      // Track idle time for sleepy animation
      if (!ch.isActive) {
        ch.idleElapsed = (ch.idleElapsed || 0) + dt
      }
      // If became active, pathfind to seat
      if (ch.isActive) {
        if (!ch.seatId) {
          // No seat assigned — type in place
          ch.state = CharacterState.TYPE
          ch.frame = 0
          ch.frameTimer = 0
          break
        }
        const seat = seats.get(ch.seatId)
        if (seat) {
          const path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles)
          if (path.length > 0) {
            ch.path = path
            ch.moveProgress = 0
            ch.state = CharacterState.WALK
            ch.frame = 0
            ch.frameTimer = 0
          } else {
            // Already at seat or no path — sit down
            ch.state = CharacterState.TYPE
            ch.dir = seat.facingDir
            ch.frame = 0
            ch.frameTimer = 0
          }
        }
        break
      }
      // Countdown wander timer
      ch.wanderTimer -= dt
      if (ch.wanderTimer <= 0) {
        // Check if we've wandered enough — return to seat for a rest
        if (ch.wanderCount >= ch.wanderLimit && ch.seatId) {
          const seat = seats.get(ch.seatId)
          if (seat) {
            const path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles)
            if (path.length > 0) {
              ch.path = path
              ch.moveProgress = 0
              ch.state = CharacterState.WALK
              ch.frame = 0
              ch.frameTimer = 0
              break
            }
          }
        }
        if (walkableTiles.length > 0) {
          const target = getThemedWanderTarget(ch, walkableTiles)
          const path = findPath(ch.tileCol, ch.tileRow, target.col, target.row, tileMap, blockedTiles)
          if (path.length > 0) {
            ch.path = path
            ch.moveProgress = 0
            ch.state = CharacterState.WALK
            ch.frame = 0
            ch.frameTimer = 0
            ch.wanderCount++
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC)
      }
      break
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC
        ch.frame = (ch.frame + 1) % 4
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow)
        ch.x = center.x
        ch.y = center.y

        if (ch.isActive) {
          if (ch.zoneVisitActive) {
            // Arrived at zone destination — clear flag and return to desk
            ch.zoneVisitActive = false
            ch.state = CharacterState.IDLE
            ch.wanderTimer = 0.5 // brief pause before returning
          } else if (!ch.seatId) {
            // No seat assigned — type in place
            ch.state = CharacterState.TYPE
          } else {
            const seat = seats.get(ch.seatId)
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE
              ch.dir = seat.facingDir
            } else {
              ch.state = CharacterState.IDLE
            }
          }
        } else {
          // If on a zone visit (e.g. tea/pizza), linger at destination
          if (ch.zoneVisitActive) {
            ch.zoneVisitActive = false
            ch.state = CharacterState.IDLE
            ch.wanderTimer = randomRange(8, 15) // stay 8-15 seconds at the spot
            ch.frame = 0
            ch.frameTimer = 0
            break
          }
          // Check if arrived at assigned seat — sit down for a rest before wandering again
          if (ch.seatId) {
            const seat = seats.get(ch.seatId)
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE
              ch.dir = seat.facingDir
              // seatTimer < 0 is a sentinel from setAgentActive(false) meaning
              // "turn just ended" — skip the long rest so idle transition is immediate
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0
              } else {
                ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC)
              }
              ch.wanderCount = 0
              ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX)
              ch.frame = 0
              ch.frameTimer = 0
              break
            }
          }
          ch.state = CharacterState.IDLE
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC)
        }
        ch.frame = 0
        ch.frameTimer = 0
        break
      }

      // Move toward next tile in path
      const nextTile = ch.path[0]
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row)

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow)
      const toCenter = tileCenter(nextTile.col, nextTile.row)
      const t = Math.min(ch.moveProgress, 1)
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col
        ch.tileRow = nextTile.row
        ch.x = toCenter.x
        ch.y = toCenter.y
        ch.path.shift()
        ch.moveProgress = 0
      }

      // If became active while wandering, repath to seat
      // BUT skip if character is on a zone visit (let them finish the walk)
      if (ch.isActive && ch.seatId && !ch.zoneVisitActive) {
        const seat = seats.get(ch.seatId)
        if (seat) {
          const lastStep = ch.path[ch.path.length - 1]
          if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
            const newPath = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles)
            if (newPath.length > 0) {
              ch.path = newPath
              ch.moveProgress = 0
            }
          }
        }
      }
      break
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2]
      }
      return sprites.typing[ch.dir][ch.frame % 2]
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4]
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1]
    default:
      return sprites.walk[ch.dir][1]
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}
