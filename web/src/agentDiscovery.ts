/**
 * Agent Discovery — Discovers agents from kosmos-app profile.json
 *
 * Reads the profile configuration to find all defined agents/chats,
 * and discovers the latest chat session files for monitoring.
 */

import * as fs from 'fs'
import * as path from 'path'

export interface KosmosAgent {
  chatId: string
  name: string
  emoji: string
  role: string
  model: string
  avatar?: string
}

export interface KosmosSessionInfo {
  chatId: string
  sessionId: string
  filePath: string
  title: string
  lastUpdated: string
}

/**
 * Discover all agents from the kosmos-app profile
 */
export function discoverAgents(profilePath: string): KosmosAgent[] {
  try {
    const content = fs.readFileSync(profilePath, 'utf-8')
    const profile = JSON.parse(content)
    const agents: KosmosAgent[] = []

    if (Array.isArray(profile.chats)) {
      for (const chat of profile.chats) {
        const agent = chat.agent
        if (agent) {
          agents.push({
            chatId: chat.chat_id,
            name: agent.name || 'Unknown',
            emoji: agent.emoji || '🤖',
            role: agent.role || 'Assistant',
            model: agent.model || 'unknown',
            avatar: agent.avatar || undefined,
          })
        }
      }
    }

    return agents
  } catch (err) {
    console.error(`[AgentDiscovery] Error reading profile: ${err}`)
    return []
  }
}

/**
 * Find the latest chat session file for a given chat_id
 */
export function findLatestSession(
  chatSessionsDir: string,
  chatId: string,
): KosmosSessionInfo | null {
  const chatDir = path.join(chatSessionsDir, chatId)
  if (!fs.existsSync(chatDir)) return null

  // Find the latest month directory
  const months = fs.readdirSync(chatDir)
    .filter(f => /^\d{6}$/.test(f))
    .sort()
    .reverse()

  for (const month of months) {
    const monthDir = path.join(chatDir, month)
    const indexPath = path.join(monthDir, 'index.json')

    if (fs.existsSync(indexPath)) {
      try {
        const indexContent = fs.readFileSync(indexPath, 'utf-8')
        const index = JSON.parse(indexContent)

        if (Array.isArray(index.sessions) && index.sessions.length > 0) {
          // Sort by last_updated descending and pick the latest
          const sorted = [...index.sessions].sort(
            (a: { last_updated: string }, b: { last_updated: string }) =>
              new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
          )
          const latest = sorted[0]
          const sessionFile = path.join(monthDir, `${latest.chatSession_id}.json`)

          if (fs.existsSync(sessionFile)) {
            return {
              chatId,
              sessionId: latest.chatSession_id,
              filePath: sessionFile,
              title: latest.title || 'Untitled',
              lastUpdated: latest.last_updated,
            }
          }
        }
      } catch (err) {
        console.error(`[AgentDiscovery] Error reading index for ${chatId}/${month}: ${err}`)
      }
    }

    // Fallback: scan for session files directly
    const sessionFiles = fs.readdirSync(monthDir)
      .filter(f => f.startsWith('chatSession_') && f.endsWith('.json'))
      .sort()
      .reverse()

    if (sessionFiles.length > 0) {
      const filePath = path.join(monthDir, sessionFiles[0])
      return {
        chatId,
        sessionId: sessionFiles[0].replace('.json', ''),
        filePath,
        title: 'Unknown',
        lastUpdated: new Date().toISOString(),
      }
    }
  }

  return null
}

/**
 * Find all session files for a given chat_id (for watching)
 */
export function findAllSessionDirs(
  chatSessionsDir: string,
  chatId: string,
): string[] {
  const chatDir = path.join(chatSessionsDir, chatId)
  if (!fs.existsSync(chatDir)) return []

  const dirs: string[] = [chatDir]
  const months = fs.readdirSync(chatDir).filter(f => /^\d{6}$/.test(f))
  for (const month of months) {
    dirs.push(path.join(chatDir, month))
  }
  return dirs
}
