/**
 * Internationalization — simple key-value string system
 * Supports English and Chinese
 */

export type Locale = 'en' | 'zh'

const strings: Record<Locale, Record<string, string>> = {
  en: {
    // Settings
    'settings': 'Settings',
    'open_sessions': 'Open Sessions Folder',
    'export_layout': 'Export Layout',
    'import_layout': 'Import Layout',
    'sound_notifications': 'Sound Notifications',
    'agent_names': 'Agent Names',
    'debug_view': 'Debug View',
    'language': 'Language',

    // Bottom toolbar
    'add_agent': '+ Agent',
    'layout': 'Layout',

    // Game HUD
    'interact': '🎁 Interact',
    'profile': '📊 Profile',
    'working': '(working...)',
    'mood': 'Mood',
    'today': 'Today',
    'total': 'Total',
    'best_combo': 'Best Combo',
    'achievements': 'Achievements',
    'tasks': 'tasks',

    // Actions
    'tea': '☕ Milk Tea',
    'pizza': '🍕 Pizza',
    'salary': '💰 Salary',
    'promote': '⬆️ Promote',
    'party': '🎉 Party',

    // Status
    'idle': 'Idle',
  },
  zh: {
    // Settings
    'settings': '设置',
    'open_sessions': '打开会话目录',
    'export_layout': '导出布局',
    'import_layout': '导入布局',
    'sound_notifications': '声音通知',
    'agent_names': 'Agent 名称',
    'debug_view': '调试视图',
    'language': '语言',

    // Bottom toolbar
    'add_agent': '+ Agent',
    'layout': '布局',

    // Game HUD
    'interact': '🎁 互动',
    'profile': '📊 档案',
    'working': '(工作中...)',
    'mood': '心情',
    'today': '今日',
    'total': '总计',
    'best_combo': '最佳连击',
    'achievements': '成就',
    'tasks': '任务',

    // Actions
    'tea': '☕ 请喝奶茶',
    'pizza': '🍕 请吃披萨',
    'salary': '💰 发工资',
    'promote': '⬆️ 升职加薪',
    'party': '🎉 团建',

    // Status
    'idle': '空闲',
  },
}

let currentLocale: Locale = 'zh' // default Chinese
const listeners: Array<() => void> = []

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  currentLocale = locale
  localStorage.setItem('pixel-agents-locale', locale)
  for (const fn of listeners) fn()
}

export function initLocale(): void {
  const saved = localStorage.getItem('pixel-agents-locale') as Locale | null
  if (saved && (saved === 'en' || saved === 'zh')) {
    currentLocale = saved
  }
}

export function t(key: string): string {
  return strings[currentLocale][key] || strings['en'][key] || key
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    const idx = listeners.indexOf(fn)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}
