/**
 * AgentWatcher — generic interface for agent sources.
 *
 * Multiple agent sources (kosmos-app, OpenClaw, future) plug into the web server
 * through this interface. Each watcher emits `message` events containing
 * `PixelMessage` payloads that the server forwards to WebSocket clients and
 * uses to drive game-state updates.
 *
 * Concrete implementations:
 *   - KosmosWatcher  (web/src/kosmosWatcher.ts) — file-poll + chokidar
 *   - OpenClawWatcher (web/src/watchers/openclawWatcher.ts) — WebSocket client (Epic B)
 */

import type { EventEmitter } from 'events'
import type { PixelMessage } from '../logTranslator.js'

/** Source identifier for routing/UI badges. Must be unique per concrete watcher class. */
export type AgentSource = 'kosmos' | 'openclaw'

/** Display-level info one agent contributes to the UI sidebar. */
export interface AgentInfo {
  id: number
  name: string
  emoji: string
  /** Stable upstream identifier (kosmos chatId, openclaw sessionId, etc.) */
  externalId: string
  /** Human-friendly title for the current session/conversation. */
  sessionTitle: string
}

/**
 * AgentWatcher — minimal contract every agent source must satisfy.
 *
 * Note: extends EventEmitter for the `on('message', ...)` channel. A future
 * refactor could swap to a typed event bus, but EventEmitter is what server.ts
 * already consumes from KosmosWatcher and is good enough for now.
 *
 * The single emitted event of interest is `'message'` carrying a PixelMessage.
 */
export interface AgentWatcher extends EventEmitter {
  /** Stable, human-readable identifier for logs and the source-badge UI. */
  readonly source: AgentSource

  /** Begin watching. Idempotent: calling twice is a no-op. */
  start(): void | Promise<void>

  /** Stop watching, release file handles / sockets / timers. */
  stop(): void | Promise<void>

  /** Number of agents currently tracked by this watcher. */
  agentCount(): number

  /** UI sidebar info for every agent this watcher tracks. */
  getAgentInfo(): AgentInfo[]

  /**
   * Emit an `existingAgents` PixelMessage covering every currently-tracked agent.
   * Called when a new WebSocket client connects so it can replay state.
   */
  generateExistingAgentsMessage(): PixelMessage

  /** Drop an agent by its numeric pixel-agents id. Returns true if found. */
  removeAgentById(agentId: number): boolean
}
