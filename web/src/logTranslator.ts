/**
 * Log Translator — Kosmos-app JSON format → Pixel Agents message protocol
 *
 * Kosmos-app stores chat sessions as single JSON files with a `chat_history[]` array.
 * Each entry has `role` ("user" | "assistant" | "tool"), `content`, `tool_calls`, etc.
 *
 * Pixel Agents expects a message protocol with types like:
 *   agentCreated, agentToolStart, agentToolDone, agentToolsClear,
 *   agentStatus(active/waiting), subagentToolStart, etc.
 *
 * This module translates between the two formats.
 */

import * as path from 'path'

// ── Tool Name Mapping ──────────────────────────────────────────
// Maps kosmos-app tool names → standardized pixel-agents tool categories

const TOOL_NAME_MAP: Record<string, string> = {
  // File operations
  search_files: 'Glob',
  search_text_in_files: 'Grep',
  read_file: 'Read',
  read_html: 'Read',
  read_office_file: 'Read',
  write_file: 'Write',
  create_file: 'Write',

  // Command execution
  execute_command: 'Bash',

  // Web operations
  google_web_search: 'WebSearch',
  bing_web_search: 'WebSearch',
  bing_image_search: 'WebSearch',
  google_image_search: 'WebSearch',
  fetch_web_content: 'WebFetch',
  download_and_save_as: 'WebFetch',

  // Agent management
  add_agent_by_config: 'Task',
  check_agent_status: 'Read',

  // MCP tools
  check_mcp_status: 'Read',
  toggle_mcp_by_name: 'Bash',

  // Info tools
  get_current_datetime: 'Read',
  get_all_agents: 'Read',
  present_deliverables: 'Write',
}

function mapToolName(kosmosToolName: string): string {
  return TOOL_NAME_MAP[kosmosToolName] || kosmosToolName
}

// ── Tool Status Formatting ─────────────────────────────────────

function getBasename(p: unknown): string {
  if (typeof p !== 'string' || !p) return ''
  return path.basename(p)
}

function parseArgs(argsStr: string): Record<string, unknown> {
  if (!argsStr || argsStr.trim() === '') return {}
  try {
    return JSON.parse(argsStr)
  } catch {
    return {}
  }
}

export function formatToolStatus(kosmosToolName: string, argsStr: string): string {
  const args = parseArgs(argsStr)
  const mapped = mapToolName(kosmosToolName)

  switch (mapped) {
    case 'Read':
      return `Reading ${getBasename(args.filePath || args.file_path || args.path || '')}`
    case 'Write':
      return `Writing ${getBasename(args.filePath || args.file_path || args.path || '')}`
    case 'Bash': {
      const cmd = (args.command as string) || ''
      return `Running: ${cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd}`
    }
    case 'Glob':
      return `Searching files ${args.pattern ? `(${args.pattern})` : ''}`
    case 'Grep':
      return `Searching code ${args.pattern ? `for "${args.pattern}"` : ''}`
    case 'WebFetch': {
      const urls = args.urls as string[] | undefined
      return `Fetching ${urls?.[0] || 'web content'}`
    }
    case 'WebSearch': {
      const queries = args.queries as string[] | undefined
      return `Searching: ${queries?.[0] || 'the web'}`
    }
    case 'Task': {
      const name = (args.name as string) || ''
      return `Subtask: ${name || 'Running subtask'}`
    }
    default:
      return `Using ${kosmosToolName}`
  }
}

// ── Chat History Entry Types ───────────────────────────────────

export interface KosmosToolCall {
  id: string
  type: string // "function"
  function: {
    name: string
    arguments: string
  }
}

export interface KosmosMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: Array<{ type: string; text: string }>
  timestamp: number
  streamingComplete?: boolean
  tool_calls?: KosmosToolCall[]
  tool_call_id?: string
  name?: string // tool name for role=tool
}

export interface KosmosChatSession {
  chatSession_id: string
  title: string
  last_updated: string
  chat_history: KosmosMessage[]
  context_history?: KosmosMessage[]
}

// ── Pixel Agents Message Types ─────────────────────────────────

export interface PixelMessage {
  type: string
  [key: string]: unknown
}

// ── Translation State ──────────────────────────────────────────

export interface TranslationState {
  processedCount: number // number of chat_history entries already processed
  activeToolIds: Set<string> // currently active tool IDs
  activeTaskToolIds: Set<string> // tool IDs that are Task type (create sub-agent characters)
  isWaiting: boolean
  lastRole: string | null
}

export function createTranslationState(): TranslationState {
  return {
    processedCount: 0,
    activeToolIds: new Set(),
    activeTaskToolIds: new Set(),
    isWaiting: true,
    lastRole: null,
  }
}

// ── Core Translation Logic ─────────────────────────────────────

/**
 * Process new messages from a kosmos-app chat_history array.
 * Returns an array of pixel-agents protocol messages.
 */
export function translateNewMessages(
  agentId: number,
  chatHistory: KosmosMessage[],
  state: TranslationState,
): PixelMessage[] {
  const messages: PixelMessage[] = []
  const startIdx = state.processedCount

  if (startIdx >= chatHistory.length) return messages

  for (let i = startIdx; i < chatHistory.length; i++) {
    const entry = chatHistory[i]
    const entryMessages = translateEntry(agentId, entry, state)
    messages.push(...entryMessages)
    state.processedCount = i + 1
  }

  // Detect turn end: if the last processed message is the final one
  // and it's an assistant text response without tool_calls, mark as waiting
  const lastEntry = chatHistory[chatHistory.length - 1]
  if (lastEntry && state.activeToolIds.size === 0) {
    if (lastEntry.role === 'assistant' && !lastEntry.tool_calls?.length) {
      if (!state.isWaiting) {
        state.isWaiting = true
        messages.push({
          type: 'agentStatus',
          id: agentId,
          status: 'waiting',
        })
      }
    }
  }

  return messages
}

function translateEntry(
  agentId: number,
  entry: KosmosMessage,
  state: TranslationState,
): PixelMessage[] {
  const messages: PixelMessage[] = []

  switch (entry.role) {
    case 'user': {
      // User message → new turn starting, clear all active tools
      if (state.activeToolIds.size > 0) {
        state.activeToolIds.clear()
        messages.push({ type: 'agentToolsClear', id: agentId })
      }
      state.isWaiting = false
      state.lastRole = 'user'
      // Don't mark as active yet — wait for assistant response
      break
    }

    case 'assistant': {
      state.lastRole = 'assistant'

      if (entry.tool_calls && entry.tool_calls.length > 0) {
        // Assistant is calling tools → mark as active
        if (state.isWaiting) {
          state.isWaiting = false
          messages.push({
            type: 'agentStatus',
            id: agentId,
            status: 'active',
          })
        }

        for (const tc of entry.tool_calls) {
          const toolName = tc.function.name
          const mapped = mapToolName(toolName)
          const status = formatToolStatus(toolName, tc.function.arguments)
          state.activeToolIds.add(tc.id)

          // Track Task tools so we can emit subagentClear on completion
          if (mapped === 'Task') {
            state.activeTaskToolIds.add(tc.id)
          }

          messages.push({
            type: 'agentToolStart',
            id: agentId,
            toolId: tc.id,
            status,
          })
        }
      } else {
        // Text-only assistant response
        if (state.isWaiting) {
          // Already waiting — do nothing
        } else {
          messages.push({
            type: 'agentStatus',
            id: agentId,
            status: 'active',
          })
        }
      }
      break
    }

    case 'tool': {
      state.lastRole = 'tool'
      const toolCallId = entry.tool_call_id
      if (toolCallId && state.activeToolIds.has(toolCallId)) {
        // If this was a Task tool, emit subagentClear to remove the sub-agent character
        // Use a slight delay flag so the webview can show the character briefly
        if (state.activeTaskToolIds.has(toolCallId)) {
          state.activeTaskToolIds.delete(toolCallId)
          messages.push({
            type: 'subagentClear',
            id: agentId,
            parentToolId: toolCallId,
            _delay: true, // signal server to delay this message
          })
        }

        state.activeToolIds.delete(toolCallId)
        messages.push({
          type: 'agentToolDone',
          id: agentId,
          toolId: toolCallId,
        })
      }
      break
    }
  }

  return messages
}

/**
 * Generate the full set of initial messages to replay a complete chat session.
 * This is used when the webview first connects to show the current state.
 */
export function generateInitialState(
  agentId: number,
  chatHistory: KosmosMessage[],
): { messages: PixelMessage[]; state: TranslationState } {
  const state = createTranslationState()
  const messages = translateNewMessages(agentId, chatHistory, state)
  return { messages, state }
}
