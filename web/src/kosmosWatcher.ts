/**
 * Kosmos Watcher — Watches kosmos-app chat session files for changes
 *
 * Uses chokidar to watch for file modifications in chat_sessions directories.
 * When a session file changes, reads the new data, translates it, and emits
 * pixel-agents protocol messages.
 */

import * as fs from 'fs'
import * as path from 'path'
import chokidar from 'chokidar'
import { EventEmitter } from 'events'
import {
  type KosmosAgent,
  type KosmosSessionInfo,
  discoverAgents,
  findLatestSession,
} from './agentDiscovery.js'
import {
  type TranslationState,
  type PixelMessage,
  type KosmosChatSession,
  createTranslationState,
  translateNewMessages,
} from './logTranslator.js'

export interface WatchedAgent {
  agentId: number // pixel-agents numeric ID
  agent: KosmosAgent
  session: KosmosSessionInfo | null
  translationState: TranslationState
  lastSessionCheck: number
}

export interface KosmosWatcherOptions {
  kosmosAppDir: string
  profileAlias: string // e.g. "yueliu1_microsoft"
  pollInterval?: number // ms, default 2000
}

export class KosmosWatcher extends EventEmitter {
  private options: KosmosWatcherOptions
  private profileDir: string
  private chatSessionsDir: string
  private watchedAgents: Map<string, WatchedAgent> = new Map() // chatId → WatchedAgent
  private watcher: ReturnType<typeof chokidar.watch> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private nextAgentId = 1
  private profileWatcher: ReturnType<typeof chokidar.watch> | null = null

  constructor(options: KosmosWatcherOptions) {
    super()
    this.options = options
    this.profileDir = path.join(options.kosmosAppDir, 'profiles', options.profileAlias)
    this.chatSessionsDir = path.join(this.profileDir, 'chat_sessions')
  }

  /**
   * Start watching kosmos-app for agent activity
   */
  start(): void {
    console.log(`[KosmosWatcher] Starting — profile: ${this.options.profileAlias}`)
    console.log(`[KosmosWatcher] Chat sessions dir: ${this.chatSessionsDir}`)

    // Initial agent discovery
    this.discoverAndRegisterAgents()

    // Watch profile.json for new agents
    const profilePath = path.join(this.profileDir, 'profile.json')
    if (fs.existsSync(profilePath)) {
      this.profileWatcher = chokidar.watch(profilePath, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500 },
      })
      this.profileWatcher.on('change', () => {
        console.log('[KosmosWatcher] Profile changed, re-discovering agents...')
        this.discoverAndRegisterAgents()
      })
    }

    // Watch chat_sessions directory for changes
    if (fs.existsSync(this.chatSessionsDir)) {
      this.watcher = chokidar.watch(this.chatSessionsDir, {
        ignoreInitial: true,
        depth: 3,
        awaitWriteFinish: { stabilityThreshold: 300 },
      })
      this.watcher.on('change', (filePath: string) => {
        if (filePath.endsWith('.json') && path.basename(filePath).startsWith('chatSession_')) {
          this.onSessionFileChanged(filePath)
        }
        // Also watch index.json for new sessions
        if (path.basename(filePath) === 'index.json') {
          this.checkForNewSessions()
        }
      })
      this.watcher.on('add', (filePath: string) => {
        if (filePath.endsWith('.json') && path.basename(filePath).startsWith('chatSession_')) {
          this.onSessionFileChanged(filePath)
        }
      })
    }

    // Backup polling
    this.pollTimer = setInterval(() => {
      this.pollAllSessions()
    }, this.options.pollInterval || 2000)

    console.log(`[KosmosWatcher] Watching ${this.watchedAgents.size} agents`)
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.watcher?.close()
    this.profileWatcher?.close()
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.watchedAgents.clear()
  }

  /**
   * Get all currently watched agents
   */
  getAgents(): WatchedAgent[] {
    return Array.from(this.watchedAgents.values())
  }

  /**
   * Remove an agent by its pixel-agents numeric ID
   */
  removeAgentById(agentId: number): boolean {
    for (const [chatId, watched] of this.watchedAgents) {
      if (watched.agentId === agentId) {
        this.watchedAgents.delete(chatId)
        console.log(`[KosmosWatcher] Removed agent: ${watched.agent.emoji} ${watched.agent.name} (id=${agentId})`)
        return true
      }
    }
    return false
  }

  /**
   * Discover agents from profile.json and register any new ones.
   * Also detect removed agents and emit agentClosed.
   */
  private discoverAndRegisterAgents(): void {
    const profilePath = path.join(this.profileDir, 'profile.json')
    const agents = discoverAgents(profilePath)
    const currentChatIds = new Set(agents.map(a => a.chatId))

    // Detect removed agents
    for (const [chatId, watched] of this.watchedAgents) {
      if (!currentChatIds.has(chatId)) {
        console.log(`[KosmosWatcher] Agent removed from profile: ${watched.agent.emoji} ${watched.agent.name}`)
        this.watchedAgents.delete(chatId)
        this.emit('message', { type: 'agentClosed', id: watched.agentId })
      }
    }

    // Register new agents
    for (const agent of agents) {
      if (!this.watchedAgents.has(agent.chatId)) {
        const agentId = this.nextAgentId++
        const session = findLatestSession(this.chatSessionsDir, agent.chatId)

        const watched: WatchedAgent = {
          agentId,
          agent,
          session,
          translationState: createTranslationState(),
          lastSessionCheck: Date.now(),
        }

        this.watchedAgents.set(agent.chatId, watched)
        console.log(`[KosmosWatcher] Registered agent: ${agent.emoji} ${agent.name} (id=${agentId}, chat=${agent.chatId})`)

        // Emit agent creation
        this.emit('message', { type: 'agentCreated', id: agentId })

        // If there's an existing session, process it for initial state
        if (session) {
          this.processSessionFile(watched)
        }
      }
    }
  }

  /**
   * Check if any agent has a new session
   */
  private checkForNewSessions(): void {
    for (const [chatId, watched] of this.watchedAgents) {
      const session = findLatestSession(this.chatSessionsDir, chatId)
      if (session && (!watched.session || session.sessionId !== watched.session.sessionId)) {
        console.log(`[KosmosWatcher] New session for ${watched.agent.name}: ${session.sessionId}`)
        watched.session = session
        watched.translationState = createTranslationState()
        // Clear old tools and reprocess
        this.emit('message', { type: 'agentToolsClear', id: watched.agentId })
        this.processSessionFile(watched)
      }
    }
  }

  /**
   * Handle session file change event
   */
  private onSessionFileChanged(filePath: string): void {
    // Find which agent this session belongs to
    for (const watched of this.watchedAgents.values()) {
      if (watched.session?.filePath === filePath) {
        this.processSessionFile(watched)
        return
      }
    }

    // Could be a new session file — check if it belongs to any known agent
    const parts = filePath.split(path.sep)
    const chatSessionsIdx = parts.findIndex(p => p === 'chat_sessions')
    if (chatSessionsIdx >= 0 && chatSessionsIdx + 1 < parts.length) {
      const chatId = parts[chatSessionsIdx + 1]
      const watched = this.watchedAgents.get(chatId)
      if (watched) {
        // Update session reference
        const session = findLatestSession(this.chatSessionsDir, chatId)
        if (session) {
          watched.session = session
          watched.translationState = createTranslationState()
          this.emit('message', { type: 'agentToolsClear', id: watched.agentId })
          this.processSessionFile(watched)
        }
      }
    }
  }

  /**
   * Read and process a session file, emitting new messages
   */
  private processSessionFile(watched: WatchedAgent): void {
    if (!watched.session) return

    try {
      const content = fs.readFileSync(watched.session.filePath, 'utf-8')
      const session: KosmosChatSession = JSON.parse(content)

      if (!Array.isArray(session.chat_history)) return

      const newMessages = translateNewMessages(
        watched.agentId,
        session.chat_history,
        watched.translationState,
      )

      // Update session title if changed
      if (session.title && watched.session.title !== session.title) {
        watched.session.title = session.title
      }

      for (const msg of newMessages) {
        if (msg._delay) {
          // Delay subagentClear so the character is visible briefly
          const delayedMsg = { ...msg }
          delete delayedMsg._delay
          setTimeout(() => this.emit('message', delayedMsg), 2000)
        } else {
          this.emit('message', msg)
        }
      }
    } catch (err) {
      // File might be in the middle of being written
      console.error(`[KosmosWatcher] Read error for ${watched.agent.name}: ${err}`)
    }
  }

  /**
   * Poll all session files (backup for when fs.watch misses events)
   */
  private pollAllSessions(): void {
    for (const watched of this.watchedAgents.values()) {
      // Periodically check for new sessions
      if (Date.now() - watched.lastSessionCheck > 10000) {
        watched.lastSessionCheck = Date.now()
        const session = findLatestSession(this.chatSessionsDir, watched.agent.chatId)
        if (session && (!watched.session || session.sessionId !== watched.session.sessionId)) {
          console.log(`[KosmosWatcher] Poll: new session for ${watched.agent.name}: ${session.sessionId}`)
          watched.session = session
          watched.translationState = createTranslationState()
          this.emit('message', { type: 'agentToolsClear', id: watched.agentId })
        }
      }

      // Process current session for new data
      if (watched.session) {
        this.processSessionFile(watched)
      }
    }
  }

  /**
   * Generate the initial state messages for all agents (used when webview connects)
   */
  generateExistingAgentsMessage(): PixelMessage {
    const agentIds: number[] = []
    for (const watched of this.watchedAgents.values()) {
      agentIds.push(watched.agentId)
    }
    return {
      type: 'existingAgents',
      agents: agentIds,
      agentMeta: {},
    }
  }

  /**
   * Get agent info for display (name + emoji)
   */
  getAgentInfo(): Array<{ id: number; name: string; emoji: string; chatId: string; sessionTitle: string }> {
    const info: Array<{ id: number; name: string; emoji: string; chatId: string; sessionTitle: string }> = []
    for (const watched of this.watchedAgents.values()) {
      info.push({
        id: watched.agentId,
        name: watched.agent.name,
        emoji: watched.agent.emoji,
        chatId: watched.agent.chatId,
        sessionTitle: watched.session?.title || 'No active session',
      })
    }
    return info
  }
}
