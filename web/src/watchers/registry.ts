/**
 * WatcherRegistry — owns a set of AgentWatchers, fans their messages out to
 * a single subscriber, and provides agent-id lookup across all sources.
 *
 * Agent ids are GLOBAL across watchers (each watcher allocates from a different
 * `idBase` so they never collide). The registry tags each forwarded message
 * with the originating `source`, and resolves "which watcher owns id N" so the
 * server can call back into a watcher (for game economy, profile sync, etc).
 */

import type { AgentInfo, AgentSource, AgentWatcher } from './types.js'
import type { PixelMessage } from '../logTranslator.js'

/** A PixelMessage augmented with its originating watcher source. */
export type SourcedMessage = PixelMessage & { source: AgentSource }

export interface RegistryEntry {
  watcher: AgentWatcher
}

export class WatcherRegistry {
  private readonly entries: RegistryEntry[] = []
  private subscriber: ((msg: SourcedMessage) => void) | null = null

  add(watcher: AgentWatcher): void {
    this.entries.push({ watcher })
    watcher.on('message', (msg: PixelMessage) => {
      if (!this.subscriber) return
      // Tag with source. Use a shallow clone so we don't mutate the watcher's
      // internal object (which it may share across listeners).
      this.subscriber({ ...(msg as object), source: watcher.source } as SourcedMessage)
    })
  }

  /** Subscribe to every message from every watcher. Replaces any prior subscriber. */
  onMessage(fn: (msg: SourcedMessage) => void): void {
    this.subscriber = fn
  }

  watchers(): AgentWatcher[] {
    return this.entries.map((e) => e.watcher)
  }

  sources(): AgentSource[] {
    return this.entries.map((e) => e.watcher.source)
  }

  /** Returns all known agents across every watcher, tagged with source. */
  allAgentInfo(): Array<AgentInfo & { source: AgentSource }> {
    const out: Array<AgentInfo & { source: AgentSource }> = []
    for (const { watcher } of this.entries) {
      for (const info of watcher.getAgentInfo()) {
        out.push({ ...info, source: watcher.source })
      }
    }
    return out
  }

  /** Find which watcher (and AgentInfo) owns a given numeric agent id. */
  findById(id: number): { watcher: AgentWatcher; info: AgentInfo } | undefined {
    for (const { watcher } of this.entries) {
      const info = watcher.getAgentInfo().find((a) => a.id === id)
      if (info) return { watcher, info }
    }
    return undefined
  }

  agentCount(): number {
    return this.entries.reduce((sum, e) => sum + e.watcher.agentCount(), 0)
  }

  /**
   * Start every watcher. If one fails, log and continue with the rest —
   * partial degradation is preferred over total failure (e.g. OpenClaw down
   * shouldn't take Claude offline).
   */
  async startAll(logger: { warn: (...a: unknown[]) => void } = console): Promise<void> {
    await Promise.all(
      this.entries.map(async ({ watcher }) => {
        try {
          await watcher.start()
        } catch (err) {
          logger.warn(`[registry] watcher '${watcher.source}' failed to start:`, err)
        }
      }),
    )
  }

  async stopAll(logger: { warn: (...a: unknown[]) => void } = console): Promise<void> {
    await Promise.all(
      this.entries.map(async ({ watcher }) => {
        try {
          await watcher.stop()
        } catch (err) {
          logger.warn(`[registry] watcher '${watcher.source}' failed to stop:`, err)
        }
      }),
    )
  }
}
