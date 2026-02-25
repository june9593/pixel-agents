declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

interface VsCodeApi {
  postMessage(msg: unknown): void
}

function createWebSocketBridge(): VsCodeApi {
  let ws: WebSocket | null = null
  let messageQueue: unknown[] = []

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${protocol}//${location.host}/ws`)

    ws.onopen = () => {
      console.log('[PixelAgents Web] WebSocket connected')
      // Flush queued messages
      for (const msg of messageQueue) {
        ws!.send(JSON.stringify(msg))
      }
      messageQueue = []
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        // Dispatch as window message — picked up by useExtensionMessages
        window.postMessage(msg, '*')
      } catch {
        // ignore malformed
      }
    }

    ws.onclose = () => {
      console.log('[PixelAgents Web] WebSocket disconnected, reconnecting...')
      ws = null
      setTimeout(connect, 1000)
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()

  return {
    postMessage(msg: unknown) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg))
      } else {
        messageQueue.push(msg)
      }
    }
  }
}

let vscodeInstance: VsCodeApi
let webMode = false
try {
  // VS Code extension environment
  vscodeInstance = acquireVsCodeApi()
} catch {
  // Standalone web mode — use WebSocket bridge
  console.log('[PixelAgents] Running in standalone web mode')
  vscodeInstance = createWebSocketBridge()
  webMode = true
}

export const vscode = vscodeInstance
export const isWebMode = webMode
