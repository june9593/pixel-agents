import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'events'

import { WatcherRegistry, type SourcedMessage } from './registry.js'
import type { AgentInfo, AgentSource, AgentWatcher } from './types.js'
import type { PixelMessage } from '../logTranslator.js'

class FakeWatcher extends EventEmitter implements AgentWatcher {
  readonly source: AgentSource
  startCalls = 0
  stopCalls = 0
  startError: Error | null = null
  private agents: AgentInfo[]

  constructor(source: AgentSource, agents: AgentInfo[] = []) {
    super()
    this.source = source
    this.agents = agents
  }

  async start() {
    this.startCalls++
    if (this.startError) throw this.startError
  }
  async stop() {
    this.stopCalls++
  }
  agentCount() {
    return this.agents.length
  }
  getAgentInfo() {
    return this.agents
  }
  generateExistingAgentsMessage(): PixelMessage {
    return { type: 'existingAgents', agents: this.agents.map((a) => a.id), agentMeta: {} }
  }
  removeAgentById(id: number) {
    const before = this.agents.length
    this.agents = this.agents.filter((a) => a.id !== id)
    return this.agents.length !== before
  }
  setAgents(agents: AgentInfo[]) {
    this.agents = agents
  }
  pushMessage(msg: PixelMessage) {
    this.emit('message', msg)
  }
}

test('add() + watchers() + sources() reflect insertion order', () => {
  const reg = new WatcherRegistry()
  const a = new FakeWatcher('kosmos')
  const b = new FakeWatcher('openclaw')
  reg.add(a)
  reg.add(b)
  assert.deepEqual(reg.sources(), ['kosmos', 'openclaw'])
  assert.equal(reg.watchers().length, 2)
})

test('onMessage() tags each forwarded message with its source', () => {
  const reg = new WatcherRegistry()
  const claude = new FakeWatcher('kosmos')
  const openclaw = new FakeWatcher('openclaw')
  reg.add(claude)
  reg.add(openclaw)

  const received: SourcedMessage[] = []
  reg.onMessage((m) => received.push(m))

  claude.pushMessage({ type: 'agentStatus', id: 1, status: 'active' })
  openclaw.pushMessage({ type: 'agentStatus', id: 10000, status: 'waiting' })

  assert.equal(received.length, 2)
  assert.equal(received[0].source, 'kosmos')
  assert.equal(received[1].source, 'openclaw')
  // Original fields preserved
  assert.equal((received[0] as any).type, 'agentStatus')
  assert.equal((received[0] as any).id, 1)
})

test('messages emitted before onMessage subscriber is set are dropped (no buffering)', () => {
  const reg = new WatcherRegistry()
  const w = new FakeWatcher('kosmos')
  reg.add(w)
  // Emit before subscribing — must not throw.
  w.pushMessage({ type: 'agentCreated', id: 1 })
  const received: SourcedMessage[] = []
  reg.onMessage((m) => received.push(m))
  assert.equal(received.length, 0)
})

test('findById() searches across all watchers and returns the owning watcher + info', () => {
  const reg = new WatcherRegistry()
  const a = new FakeWatcher('kosmos', [{ id: 1, name: 'C', emoji: '🤖', externalId: 'c1', sessionTitle: 'C' }])
  const b = new FakeWatcher('openclaw', [{ id: 10001, name: 'O', emoji: '🦾', externalId: 'o1', sessionTitle: 'O' }])
  reg.add(a)
  reg.add(b)

  const f1 = reg.findById(1)
  const f2 = reg.findById(10001)
  const f3 = reg.findById(999)

  assert.equal(f1?.watcher.source, 'kosmos')
  assert.equal(f1?.info.name, 'C')
  assert.equal(f2?.watcher.source, 'openclaw')
  assert.equal(f2?.info.name, 'O')
  assert.equal(f3, undefined)
})

test('allAgentInfo() merges across watchers and tags with source', () => {
  const reg = new WatcherRegistry()
  reg.add(new FakeWatcher('kosmos', [{ id: 1, name: 'A', emoji: '🤖', externalId: 'x', sessionTitle: 'A' }]))
  reg.add(new FakeWatcher('openclaw', [{ id: 10001, name: 'B', emoji: '🦾', externalId: 'y', sessionTitle: 'B' }]))
  const all = reg.allAgentInfo()
  assert.equal(all.length, 2)
  assert.equal(all.find((a) => a.id === 1)?.source, 'kosmos')
  assert.equal(all.find((a) => a.id === 10001)?.source, 'openclaw')
})

test('agentCount() sums across watchers', () => {
  const reg = new WatcherRegistry()
  reg.add(new FakeWatcher('kosmos', [
    { id: 1, name: 'A', emoji: '🤖', externalId: 'x', sessionTitle: 'A' },
    { id: 2, name: 'B', emoji: '🤖', externalId: 'y', sessionTitle: 'B' },
  ]))
  reg.add(new FakeWatcher('openclaw', [
    { id: 10001, name: 'O', emoji: '🦾', externalId: 'z', sessionTitle: 'O' },
  ]))
  assert.equal(reg.agentCount(), 3)
})

test('startAll() starts every watcher; one failure does not block the others', async () => {
  const reg = new WatcherRegistry()
  const ok = new FakeWatcher('kosmos')
  const fail = new FakeWatcher('openclaw')
  fail.startError = new Error('gateway unreachable')
  reg.add(ok)
  reg.add(fail)
  const warnings: string[] = []
  await reg.startAll({ warn: (...a) => warnings.push(a.join(' ')) })
  assert.equal(ok.startCalls, 1)
  assert.equal(fail.startCalls, 1)
  assert.ok(warnings.some((w) => w.includes('openclaw') && w.includes('failed to start')))
})

test('stopAll() stops every watcher even if one rejects', async () => {
  const reg = new WatcherRegistry()
  const a = new FakeWatcher('kosmos')
  const b = new FakeWatcher('openclaw')
  ;(b as any).stop = async () => {
    b.stopCalls++
    throw new Error('socket already closed')
  }
  reg.add(a)
  reg.add(b)
  const warnings: string[] = []
  await reg.stopAll({ warn: (...x) => warnings.push(x.join(' ')) })
  assert.equal(a.stopCalls, 1)
  assert.equal(b.stopCalls, 1)
  assert.ok(warnings.some((w) => w.includes('openclaw')))
})
