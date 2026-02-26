/**
 * Game State — Economy, agent profiles, achievements
 *
 * Persisted to ~/.pixel-agents/game-state.json
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ── Constants ──────────────────────────────────────────────

export const DAILY_BUDGET = 100
export const TOOL_CALL_REWARD = 5
export const COMBO_THRESHOLD = 3
export const COMBO_BONUS = 10

export const ACTIONS = {
  tea:     { cost: 10, label: '☕ 请喝奶茶', emoji: '☕' },
  pizza:   { cost: 15, label: '🍕 请吃披萨', emoji: '🍕' },
  salary:  { cost: 20, label: '💰 发工资',   emoji: '💰' },
  promote: { cost: 50, label: '⬆️ 升职加薪', emoji: '⬆️', requireToolCalls: 50 },
  party:   { cost: 30, label: '🎉 团建',     emoji: '🎉' },
} as const

export type ActionType = keyof typeof ACTIONS

export const RANKS = ['🌱 实习生', '💼 初级', '⭐ 高级', '🔥 专家', '👑 传说'] as const
export const RANK_THRESHOLDS = [0, 50, 150, 400, 1000] // cumulative tool calls to reach each rank

// ── Types ──────────────────────────────────────────────────

export interface AgentProfile {
  agentId: number
  name: string
  emoji: string
  totalToolCalls: number
  todayToolCalls: number
  todayWorkSeconds: number
  comboCount: number       // consecutive tool calls without break
  bestCombo: number
  mood: number             // 0-100, starts at 50
  rankIndex: number        // index into RANKS
  promoted: boolean        // has been promoted at current rank
  achievements: string[]   // achievement IDs
  lastToolTime: number     // timestamp of last tool call
  lastActiveDate: string   // YYYY-MM-DD to track daily resets
}

export interface GameState {
  version: 1
  coins: number
  totalCoinsEarned: number
  lastResetDate: string    // YYYY-MM-DD for daily budget reset
  agents: Record<number, AgentProfile>
}

// ── Achievements ───────────────────────────────────────────

export interface Achievement {
  id: string
  name: string
  emoji: string
  description: string
  check: (profile: AgentProfile) => boolean
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_task',   name: '新手上路',   emoji: '🌱', description: '完成第一个任务', check: p => p.totalToolCalls >= 1 },
  { id: 'lightning',    name: '闪电侠',     emoji: '⚡', description: '连续完成5个tool call', check: p => p.bestCombo >= 5 },
  { id: 'night_owl',    name: '夜猫子',     emoji: '🦉', description: '22:00-6:00期间工作', check: _ => { const h = new Date().getHours(); return h >= 22 || h < 6 } },
  { id: 'scholar',      name: '学霸',       emoji: '📚', description: '累计50次查资料', check: p => p.totalToolCalls >= 50 },
  { id: 'surfer',       name: '冲浪达人',   emoji: '🌐', description: '累计完成20个任务', check: p => p.totalToolCalls >= 20 },
  { id: 'grinder',      name: '卷王',       emoji: '🏅', description: '单日tool calls超100', check: p => p.todayToolCalls >= 100 },
  { id: 'legend',       name: '传说级员工', emoji: '👑', description: '升职到最高级', check: p => p.rankIndex >= RANKS.length - 1 },
  { id: 'happy',        name: '快乐打工人', emoji: '😊', description: '心情值达到90', check: p => p.mood >= 90 },
  { id: 'combo10',      name: '十连胜',     emoji: '🔥', description: '连续完成10个tool call', check: p => p.bestCombo >= 10 },
]

// ── State Management ───────────────────────────────────────

const SAVE_PATH = path.join(os.homedir(), '.pixel-agents', 'game-state.json')

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function createDefaultState(): GameState {
  return {
    version: 1,
    coins: DAILY_BUDGET,
    totalCoinsEarned: DAILY_BUDGET,
    lastResetDate: today(),
    agents: {},
  }
}

export function createAgentProfile(agentId: number, name: string, emoji: string): AgentProfile {
  return {
    agentId,
    name,
    emoji,
    totalToolCalls: 0,
    todayToolCalls: 0,
    todayWorkSeconds: 0,
    comboCount: 0,
    bestCombo: 0,
    mood: 50,
    rankIndex: 0,
    promoted: false,
    achievements: [],
    lastToolTime: 0,
    lastActiveDate: today(),
  }
}

export function loadGameState(): GameState {
  try {
    if (fs.existsSync(SAVE_PATH)) {
      const content = fs.readFileSync(SAVE_PATH, 'utf-8')
      const state = JSON.parse(content) as GameState

      // Daily reset check
      if (state.lastResetDate !== today()) {
        state.coins += DAILY_BUDGET
        state.totalCoinsEarned += DAILY_BUDGET
        state.lastResetDate = today()
        // Reset daily counters for all agents
        for (const profile of Object.values(state.agents)) {
          profile.todayToolCalls = 0
          profile.todayWorkSeconds = 0
          profile.lastActiveDate = today()
          // Mood decays slightly overnight
          profile.mood = Math.max(20, profile.mood - 5)
        }
        saveGameState(state)
      }

      return state
    }
  } catch (err) {
    console.error('[GameState] Error loading:', err)
  }
  const state = createDefaultState()
  saveGameState(state)
  return state
}

export function saveGameState(state: GameState): void {
  try {
    const dir = path.dirname(SAVE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(SAVE_PATH, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[GameState] Error saving:', err)
  }
}

// ── Game Logic ─────────────────────────────────────────────

export function ensureAgentProfile(state: GameState, agentId: number, name: string, emoji: string): AgentProfile {
  if (!state.agents[agentId]) {
    state.agents[agentId] = createAgentProfile(agentId, name, emoji)
  }
  return state.agents[agentId]
}

/** Called when an agent completes a tool call */
export function recordToolCall(state: GameState, agentId: number): {
  coinsEarned: number
  comboBonus: boolean
  newAchievements: Achievement[]
} {
  const profile = state.agents[agentId]
  if (!profile) return { coinsEarned: 0, comboBonus: false, newAchievements: [] }

  // Daily reset if needed
  if (profile.lastActiveDate !== today()) {
    profile.todayToolCalls = 0
    profile.todayWorkSeconds = 0
    profile.lastActiveDate = today()
  }

  profile.totalToolCalls++
  profile.todayToolCalls++
  profile.lastToolTime = Date.now()

  // Mood: slight tiredness from continuous work (-1 per tool call)
  // But combo gives mood boost (+2 on combo)
  profile.mood = Math.max(10, profile.mood - 1)

  // Combo tracking
  profile.comboCount++
  if (profile.comboCount > profile.bestCombo) {
    profile.bestCombo = profile.comboCount
  }

  // Earn coins
  let coinsEarned = TOOL_CALL_REWARD
  let comboBonus = false
  if (profile.comboCount >= COMBO_THRESHOLD && profile.comboCount % COMBO_THRESHOLD === 0) {
    coinsEarned += COMBO_BONUS
    comboBonus = true
    profile.mood = Math.min(100, profile.mood + 3) // combo boosts mood
  }
  state.coins += coinsEarned
  state.totalCoinsEarned += coinsEarned

  // Auto rank-up
  for (let r = RANK_THRESHOLDS.length - 1; r >= 0; r--) {
    if (profile.totalToolCalls >= RANK_THRESHOLDS[r] && profile.rankIndex < r) {
      profile.rankIndex = r
      break
    }
  }

  // Check achievements
  const newAchievements: Achievement[] = []
  for (const ach of ACHIEVEMENTS) {
    if (!profile.achievements.includes(ach.id) && ach.check(profile)) {
      profile.achievements.push(ach.id)
      newAchievements.push(ach)
    }
  }

  saveGameState(state)
  return { coinsEarned, comboBonus, newAchievements }
}

/** Called when agent turn ends (resets combo) */
export function recordTurnEnd(state: GameState, agentId: number): void {
  const profile = state.agents[agentId]
  if (profile) {
    profile.comboCount = 0
    // If agent has done many tasks today without any interaction, mood drops more
    if (profile.todayToolCalls > 20 && profile.mood > 30) {
      profile.mood = Math.max(20, profile.mood - 3) // overwork fatigue
    }
    saveGameState(state)
  }
}

/** Perform an action (spend coins) */
export function performAction(
  state: GameState,
  agentId: number,
  action: ActionType,
): { success: boolean; reason?: string } {
  const config = ACTIONS[action]
  const profile = state.agents[agentId]
  if (!profile) return { success: false, reason: 'Agent not found' }

  if (state.coins < config.cost) {
    return { success: false, reason: `Need ${config.cost} coins, have ${state.coins}` }
  }

  if (action === 'promote') {
    if (profile.totalToolCalls < config.requireToolCalls) {
      return { success: false, reason: `Need ${config.requireToolCalls} tool calls for promotion` }
    }
    if (profile.rankIndex >= RANKS.length - 1) {
      return { success: false, reason: 'Already at max rank' }
    }
    profile.rankIndex++
    profile.promoted = true
  }

  state.coins -= config.cost

  // Mood boost
  const moodBoost = action === 'tea' ? 10 : action === 'pizza' ? 15 : action === 'salary' ? 20 : action === 'promote' ? 30 : 10
  profile.mood = Math.min(100, profile.mood + moodBoost)

  // Check achievements after mood change
  for (const ach of ACHIEVEMENTS) {
    if (!profile.achievements.includes(ach.id) && ach.check(profile)) {
      profile.achievements.push(ach.id)
    }
  }

  saveGameState(state)
  return { success: true }
}

/** Get summary for webview */
export function getGameSummary(state: GameState): {
  coins: number
  totalCoinsEarned: number
  agents: Record<number, {
    name: string
    emoji: string
    rank: string
    rankIndex: number
    mood: number
    todayToolCalls: number
    totalToolCalls: number
    bestCombo: number
    achievements: string[]
  }>
} {
  const agents: Record<number, any> = {}
  for (const [id, p] of Object.entries(state.agents)) {
    agents[Number(id)] = {
      name: p.name,
      emoji: p.emoji,
      rank: RANKS[p.rankIndex],
      rankIndex: p.rankIndex,
      mood: p.mood,
      todayToolCalls: p.todayToolCalls,
      totalToolCalls: p.totalToolCalls,
      bestCombo: p.bestCombo,
      achievements: p.achievements,
    }
  }
  return { coins: state.coins, totalCoinsEarned: state.totalCoinsEarned, agents }
}
