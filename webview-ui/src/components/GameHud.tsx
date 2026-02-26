import { useState, useEffect } from 'react'
import { vscode, isWebMode } from '../vscodeApi.js'
import { t } from '../i18n.js'

interface GameHudProps {
  coins: number
  /** Function that returns current selectedAgentId from officeState */
  getSelectedAgentId: () => number | null
  /** Function to check if an agent is idle (not active) */
  isAgentIdle: (id: number) => boolean
  agentProfiles: Record<number, AgentProfileData>
}

export interface AgentProfileData {
  name: string
  emoji: string
  rank: string
  rankIndex: number
  mood: number
  todayToolCalls: number
  totalToolCalls: number
  bestCombo: number
  achievements: string[]
}

interface GameNotification {
  id: number
  text: string
  emoji: string
  timestamp: number
}

const ACTIONS = [
  { type: 'tea',     cost: 10, i18nKey: 'tea',     emoji: '☕' },
  { type: 'pizza',   cost: 15, i18nKey: 'pizza',   emoji: '🍕' },
  { type: 'salary',  cost: 20, i18nKey: 'salary',  emoji: '💰' },
  { type: 'promote', cost: 50, i18nKey: 'promote', emoji: '⬆️' },
  { type: 'party',   cost: 30, i18nKey: 'party',   emoji: '🎉' },
  { type: 'party',   cost: 30, i18nKey: 'party',   emoji: '🎉' },
]

const hudStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 10px',
  boxShadow: 'var(--pixel-shadow)',
  fontSize: '22px',
  color: 'var(--pixel-text)',
  pointerEvents: 'auto',
}

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 120,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '6px',
  boxShadow: 'var(--pixel-shadow)',
  minWidth: 180,
  color: 'var(--pixel-text)',
}

const btnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '5px 8px',
  fontSize: '20px',
  color: 'var(--pixel-text)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

export function GameHud({ coins, getSelectedAgentId, isAgentIdle, agentProfiles }: GameHudProps) {
  const [notifications, setNotifications] = useState<GameNotification[]>([])
  const [showMenu, setShowMenu] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [hoveredAction, setHoveredAction] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)

  // Poll officeState.selectedAgentId since it's imperative (not React state)
  useEffect(() => {
    const timer = setInterval(() => {
      const current = getSelectedAgentId()
      setSelectedAgentId(prev => prev !== current ? current : prev)
    }, 100)
    return () => clearInterval(timer)
  }, [getSelectedAgentId])

  // Close menus when selection changes
  useEffect(() => {
    setShowMenu(false)
    setShowProfile(false)
  }, [selectedAgentId])

  if (!isWebMode) return null

  const profile = selectedAgentId !== null ? agentProfiles[selectedAgentId] : null

  // Listen for game events
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'gameCoinEarned') {
        const text = msg.combo
          ? `+${msg.coins} 🪙 COMBO!`
          : `+${msg.coins} 🪙`
        addNotification(text, '🪙')
      } else if (msg.type === 'gameAchievement') {
        addNotification(
          `${msg.achievement.emoji} ${msg.achievement.name}`,
          '🏆'
        )
      } else if (msg.type === 'gameActionResult') {
        if (msg.success) {
          setLastResult(null)
        } else {
          setLastResult(msg.reason || 'Failed')
          setTimeout(() => setLastResult(null), 3000)
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  let nextNotifId = 0
  function addNotification(text: string, emoji: string) {
    const id = nextNotifId++
    setNotifications(prev => [...prev, { id, text, emoji, timestamp: Date.now() }])
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }, 3000)
  }

  function handleAction(actionType: string) {
    if (selectedAgentId === null) return
    vscode.postMessage({
      type: 'gameAction',
      agentId: selectedAgentId,
      action: actionType,
    })
    setShowMenu(false)
  }

  // Mood bar color
  function moodColor(mood: number): string {
    if (mood >= 80) return '#5ac88c'
    if (mood >= 50) return '#cca700'
    if (mood >= 30) return '#e09050'
    return '#e06060'
  }

  return (
    <>
      {/* Coin display */}
      <div style={hudStyle}>
        <span style={{ fontSize: '24px' }}>🪙</span>
        <span style={{ fontWeight: 'bold', fontSize: '24px', color: '#FFD700' }}>{coins}</span>
        {selectedAgentId !== null && profile && (
          <>
            <span style={{ margin: '0 4px', opacity: 0.3 }}>|</span>
            <button
              onClick={() => { setShowMenu(!showMenu); setShowProfile(false) }}
              style={{
                ...btnStyle,
                width: 'auto',
                padding: '2px 6px',
                background: showMenu ? 'rgba(255,255,255,0.1)' : 'transparent',
                fontSize: '20px',
              }}
            >
              🎁 {t('interact')}
            </button>
            <button
              onClick={() => { setShowProfile(!showProfile); setShowMenu(false) }}
              style={{
                ...btnStyle,
                width: 'auto',
                padding: '2px 6px',
                background: showProfile ? 'rgba(255,255,255,0.1)' : 'transparent',
                fontSize: '20px',
              }}
            >
              📊 {t('profile')}
            </button>
          </>
        )}
      </div>

      {/* Interaction menu */}
      {showMenu && selectedAgentId !== null && profile && (() => {
        const agentIdle = isAgentIdle(selectedAgentId)
        return (
        <div style={{ ...menuStyle, top: 48, right: 8 }}>
          <div style={{ padding: '4px 8px', fontSize: '18px', opacity: 0.6, borderBottom: '1px solid var(--pixel-border)', marginBottom: 4 }}>
            {profile.emoji} {profile.name} - {profile.rank}
            {!agentIdle && <span style={{ color: '#e09050', marginLeft: 6 }}>{t('working')}</span>}
          </div>
          {ACTIONS.map(a => {
            const canAfford = coins >= a.cost
            const isPromote = a.type === 'promote'
            const needMore = isPromote && profile.totalToolCalls < 50
            const isParty = a.type === 'party' // party works even when busy
            const needsIdle = !isParty && !agentIdle
            const disabled = !canAfford || needMore || needsIdle
            return (
              <button
                key={a.type}
                onClick={() => !disabled && handleAction(a.type)}
                onMouseEnter={() => setHoveredAction(a.type)}
                onMouseLeave={() => setHoveredAction(null)}
                style={{
                  ...btnStyle,
                  opacity: disabled ? 0.4 : 1,
                  cursor: disabled ? 'default' : 'pointer',
                  background: hoveredAction === a.type && !disabled ? 'rgba(255,255,255,0.08)' : 'transparent',
                }}
              >
                <span>{t(a.i18nKey)}{needsIdle ? ' 🔒' : ''}</span>
                <span style={{ color: canAfford ? '#FFD700' : '#e06060', fontSize: '18px' }}>{a.cost}🪙</span>
              </button>
            )
          })}
          {lastResult && (
            <div style={{ padding: '4px 8px', fontSize: '16px', color: '#e06060' }}>
              {lastResult}
            </div>
          )}
        </div>
        )
      })()}

      {/* Agent profile panel */}
      {showProfile && selectedAgentId !== null && profile && (
        <div style={{ ...menuStyle, top: 48, right: 8, minWidth: 220 }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--pixel-border)', marginBottom: 6 }}>
            <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{profile.emoji} {profile.name}</div>
            <div style={{ fontSize: '18px', opacity: 0.7 }}>{profile.rank}</div>
          </div>

          {/* Mood bar */}
          <div style={{ padding: '4px 8px' }}>
            <div style={{ fontSize: '16px', opacity: 0.6, marginBottom: 2 }}>❤️ {t('mood')} {profile.mood}/100</div>
            <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 0 }}>
              <div style={{ width: `${profile.mood}%`, height: '100%', background: moodColor(profile.mood), transition: 'width 0.3s' }} />
            </div>
          </div>

          {/* Stats */}
          <div style={{ padding: '4px 8px', fontSize: '18px' }}>
            <div>📋 {t('today')}: {profile.todayToolCalls} {t('tasks')}</div>
            <div>📈 {t('total')}: {profile.totalToolCalls} {t('tasks')}</div>
            <div>🔥 {t('best_combo')}: {profile.bestCombo}</div>
          </div>

          {/* Achievements */}
          {profile.achievements.length > 0 && (
            <div style={{ padding: '4px 8px', fontSize: '16px', borderTop: '1px solid var(--pixel-border)', marginTop: 4 }}>
              <div style={{ opacity: 0.6, marginBottom: 2 }}>🏆 {t('achievements')}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {profile.achievements.map(achId => (
                  <span key={achId} title={achId} style={{ fontSize: '20px' }}>
                    {achId === 'first_task' ? '🌱' :
                     achId === 'lightning' ? '⚡' :
                     achId === 'night_owl' ? '🦉' :
                     achId === 'scholar' ? '📚' :
                     achId === 'surfer' ? '🌐' :
                     achId === 'grinder' ? '🏅' :
                     achId === 'legend' ? '👑' :
                     achId === 'happy' ? '😊' :
                     achId === 'combo10' ? '🔥' : '🏅'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating notifications */}
      <div style={{ position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, pointerEvents: 'none' }}>
        {notifications.map(n => (
          <div
            key={n.id}
            style={{
              background: 'rgba(10,10,20,0.85)',
              border: '2px solid var(--pixel-border)',
              padding: '4px 12px',
              fontSize: '22px',
              color: '#FFD700',
              borderRadius: 0,
              boxShadow: 'var(--pixel-shadow)',
              animation: 'pixel-agents-notif 3s ease-out forwards',
            }}
          >
            {n.emoji} {n.text}
          </div>
        ))}
      </div>
    </>
  )
}
