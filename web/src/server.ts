/**
 * Pixel Agents Web Server
 *
 * Standalone web server that:
 * 1. Monitors kosmos-app chat sessions for agent activity
 * 2. Translates kosmos-app logs → pixel-agents protocol messages
 * 3. Serves the pixel-agents webview UI
 * 4. Pushes real-time updates via WebSocket
 *
 * Usage:
 *   npm run dev   — start with hot-reload
 *   npm start     — production start
 */

import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import { KosmosWatcher } from './kosmosWatcher.js'
import { loadAllAssets, type AllAssets } from './webAssetLoader.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ── Configuration ──────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10)
const KOSMOS_APP_DIR = process.env.KOSMOS_APP_DIR ||
  path.join(os.homedir(), 'Library', 'Application Support', 'kosmos-app')
const PROFILE_ALIAS = process.env.KOSMOS_PROFILE || ''

function detectProfile(kosmosDir: string): string {
  if (PROFILE_ALIAS) return PROFILE_ALIAS
  const profilesDir = path.join(kosmosDir, 'profiles')
  if (!fs.existsSync(profilesDir)) {
    console.error(`[Server] Profiles directory not found: ${profilesDir}`)
    process.exit(1)
  }
  const profiles = fs.readdirSync(profilesDir).filter(
    f => !f.startsWith('.') && fs.statSync(path.join(profilesDir, f)).isDirectory()
  )
  if (profiles.length === 0) {
    console.error('[Server] No profiles found in kosmos-app')
    process.exit(1)
  }
  console.log(`[Server] Auto-detected profile: ${profiles[0]}`)
  return profiles[0]
}

// ── Load sprite assets at startup ──────────────────────────────

const assetSearchPaths = [
  path.resolve(__dirname, '../../webview-ui/public/assets'),
  path.resolve(__dirname, '../../dist/webview/assets'),
]

let loadedAssets: AllAssets = { characters: null, wallTiles: null, floorTiles: null, furniture: null }

for (const assetsDir of assetSearchPaths) {
  if (fs.existsSync(assetsDir)) {
    console.log(`[Server] Loading sprite assets from: ${assetsDir}`)
    loadedAssets = loadAllAssets(assetsDir)
    break
  }
}

// ── Express App Setup ──────────────────────────────────────────

const app = express()
const server = createServer(app)

// Serve webview-ui static files
const webviewDistPath = path.resolve(__dirname, '../../dist/webview')
const webviewDevPath = path.resolve(__dirname, '../../webview-ui')

if (fs.existsSync(webviewDistPath)) {
  console.log(`[Server] Serving webview from: ${webviewDistPath}`)
  app.use(express.static(webviewDistPath))
} else {
  console.log(`[Server] ⚠️  Webview dist not found at ${webviewDistPath}`)
  console.log(`[Server] Run 'npm run build:webview' first, or use Vite dev server`)
}

// API endpoint: list agents
app.get('/api/agents', (_req, res) => {
  const info = watcher.getAgentInfo()
  res.json(info)
})

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', agents: watcher.getAgents().length })
})

// Fallback to index.html for SPA
app.get('*', (_req, res) => {
  const indexPath = path.join(webviewDistPath, 'index.html')
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    res.status(404).send(`
      <h2>Pixel Agents Web</h2>
      <p>Webview UI has not been built yet.</p>
      <p>Run: <code>cd web && npm run build:webview</code></p>
      <p>Or connect to the Vite dev server on port 5173</p>
    `)
  }
})

// ── WebSocket Setup ────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set<WebSocket>()

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected')
  clients.add(ws)

  // Handle messages from webview (e.g. webviewReady, saveLayout)
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      handleWebviewMessage(msg, ws)
    } catch {
      // ignore malformed
    }
  })

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected')
    clients.delete(ws)
  })
})

function broadcast(msg: unknown): void {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  }
}

function sendDefaultLayout(ws: WebSocket): void {
  // Try to load the default layout from webview-ui/public/assets/
  const layoutPaths = [
    path.resolve(__dirname, '../../webview-ui/public/assets/default-layout.json'),
    path.resolve(__dirname, '../../dist/webview/assets/default-layout.json'),
  ]

  console.log(`[Server] __dirname = ${__dirname}`)
  for (const layoutPath of layoutPaths) {
    console.log(`[Server] Trying layout: ${layoutPath} (exists: ${fs.existsSync(layoutPath)})`)
    if (fs.existsSync(layoutPath)) {
      try {
        const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'))
        console.log(`[Server] Layout loaded: ${layout.cols}x${layout.rows}, furniture: ${layout.furniture?.length}`)
        ws.send(JSON.stringify({ type: 'layoutLoaded', layout }))
        return
      } catch (err) {
        console.error(`[Server] Error loading layout: ${err}`)
      }
    }
  }

  console.log('[Server] No layout found, sending null')
  // Send null layout — webview will use createDefaultLayout()
  ws.send(JSON.stringify({ type: 'layoutLoaded', layout: null }))
}

function handleWebviewMessage(msg: Record<string, unknown>, ws: WebSocket): void {
  switch (msg.type) {
    case 'webviewReady':
      console.log('[Server] Webview is ready — sending initial state')
      // Send settings first
      ws.send(JSON.stringify({ type: 'settingsLoaded', soundEnabled: true }))

      // Send sprite assets BEFORE layout (same order as VS Code extension):
      // 1. Character sprites
      if (loadedAssets.characters) {
        ws.send(JSON.stringify({
          type: 'characterSpritesLoaded',
          characters: loadedAssets.characters,
        }))
        console.log(`[Server] Sent ${loadedAssets.characters.length} character sprites`)
      }
      // 2. Floor tiles
      if (loadedAssets.floorTiles) {
        ws.send(JSON.stringify({
          type: 'floorTilesLoaded',
          sprites: loadedAssets.floorTiles,
        }))
        console.log(`[Server] Sent ${loadedAssets.floorTiles.length} floor tile patterns`)
      }
      // 3. Wall tiles
      if (loadedAssets.wallTiles) {
        ws.send(JSON.stringify({
          type: 'wallTilesLoaded',
          sprites: loadedAssets.wallTiles,
        }))
        console.log(`[Server] Sent ${loadedAssets.wallTiles.length} wall tile pieces`)
      }
      // 4. Furniture assets
      if (loadedAssets.furniture) {
        ws.send(JSON.stringify({
          type: 'furnitureAssetsLoaded',
          catalog: loadedAssets.furniture.catalog,
          sprites: loadedAssets.furniture.sprites,
        }))
        console.log(`[Server] Sent ${loadedAssets.furniture.catalog.length} furniture assets`)
      }

      // Send agent info (custom message for web UI — names/emoji)
      ws.send(JSON.stringify({ type: 'kosmosAgentInfo', agents: watcher.getAgentInfo() }))
      // existingAgents MUST be sent BEFORE layoutLoaded.
      ws.send(JSON.stringify(watcher.generateExistingAgentsMessage()))
      // Send layout last — this triggers agent creation from the buffer
      sendDefaultLayout(ws)
      break
    case 'openClaude':
      // In web mode, this could open a new kosmos-app chat
      // TODO: integrate with kosmos-app deep link / CLI once available
      console.log('[Server] Open agent requested (not yet supported in web mode)')
      break
    case 'closeAgent': {
      // Remove agent from watcher and broadcast closure
      const closedId = msg.id as number
      const removed = watcher.removeAgentById(closedId)
      if (removed) {
        console.log(`[Server] Agent ${closedId} removed`)
        broadcast({ type: 'agentClosed', id: closedId })
      }
      break
    }
    case 'openSessionsFolder': {
      // Open kosmos-app chat sessions directory in Finder
      const sessionsDir = path.join(KOSMOS_APP_DIR, 'profiles', profile, 'chat_sessions')
      console.log(`[Server] Opening sessions folder: ${sessionsDir}`)
      import('child_process').then(cp => {
        cp.exec(`open "${sessionsDir}"`)
      })
      break
    }
    case 'saveLayout':
      // Persist layout to file
      try {
        const layoutDir = path.join(os.homedir(), '.pixel-agents')
        if (!fs.existsSync(layoutDir)) fs.mkdirSync(layoutDir, { recursive: true })
        const layoutPath = path.join(layoutDir, 'layout.json')
        fs.writeFileSync(layoutPath, JSON.stringify(msg.layout, null, 2))
        console.log('[Server] Layout saved')
      } catch (err) {
        console.error(`[Server] Error saving layout: ${err}`)
      }
      break
    case 'saveAgentSeats':
      // Persist agent seats
      break
    default:
      break
  }
}

// ── Kosmos Watcher Setup ───────────────────────────────────────

const profile = detectProfile(KOSMOS_APP_DIR)
const watcher = new KosmosWatcher({
  kosmosAppDir: KOSMOS_APP_DIR,
  profileAlias: profile,
  pollInterval: 2000,
})

// Forward watcher messages to all WebSocket clients
watcher.on('message', (msg) => {
  broadcast(msg)
})

// ── Start Server ───────────────────────────────────────────────

watcher.start()

server.listen(PORT, () => {
  console.log('')
  console.log('  ╔══════════════════════════════════════╗')
  console.log('  ║     🎮 Pixel Agents Web Server       ║')
  console.log('  ╠══════════════════════════════════════╣')
  console.log(`  ║  Local:   http://localhost:${PORT}        ║`)
  console.log(`  ║  Profile: ${profile.padEnd(25)}║`)
  console.log(`  ║  Agents:  ${String(watcher.getAgents().length).padEnd(25)}║`)
  console.log('  ╚══════════════════════════════════════╝')
  console.log('')
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...')
  watcher.stop()
  server.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  watcher.stop()
  server.close()
  process.exit(0)
})
