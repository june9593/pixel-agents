#!/usr/bin/env node

/**
 * pixel-kosmos CLI — Launch the pixel agents web viewer for kosmos-app
 *
 * Usage:
 *   npx pixel-kosmos                    # auto-detect profile, port 3210
 *   npx pixel-kosmos --port 8080        # custom port
 *   npx pixel-kosmos --profile myuser   # specify kosmos profile
 *   npx pixel-kosmos --open             # auto-open browser
 */

import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse CLI args
const args = process.argv.slice(2)
function getArg(name) {
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return null
}
const hasFlag = (name) => args.includes(`--${name}`)

const port = getArg('port') || '3210'
const profile = getArg('profile') || ''
const autoOpen = hasFlag('open')

// Detect kosmos-app directory
// Detect kosmos-app directory based on OS
function getDefaultKosmosDir() {
  const platform = process.platform
  if (platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'kosmos-app')
  } else if (platform === 'linux') {
    return path.join(os.homedir(), '.config', 'kosmos-app')
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'kosmos-app')
}

const defaultKosmosDir = getDefaultKosmosDir()
const kosmosDir = getArg('kosmos-dir') || defaultKosmosDir

if (!fs.existsSync(kosmosDir)) {
  console.error(`❌ kosmos-app directory not found: ${kosmosDir}`)
  console.error(`   Make sure kosmos-app is installed.`)
  process.exit(1)
}

// Set environment variables for the server
process.env.PORT = port
process.env.KOSMOS_APP_DIR = kosmosDir
if (profile) process.env.KOSMOS_PROFILE = profile

// Auto-open browser after a short delay
if (autoOpen) {
  setTimeout(() => {
    import('child_process').then(cp => {
      const url = `http://localhost:${port}`
      const cmd = process.platform === 'win32' ? `start ${url}`
        : process.platform === 'linux' ? `xdg-open ${url}`
        : `open ${url}`
      cp.exec(cmd)
    })
  }, 2000)
}

// Import and start the server
const serverPath = path.resolve(__dirname, '../dist/server.js')
if (fs.existsSync(serverPath)) {
  // Production: use compiled JS
  await import(serverPath)
} else {
  // Development: use tsx to run TypeScript directly
  const srcPath = path.resolve(__dirname, '../src/server.ts')
  if (fs.existsSync(srcPath)) {
    await import(srcPath)
  } else {
    console.error('❌ Server not found. Run `npm run build` first.')
    process.exit(1)
  }
}
