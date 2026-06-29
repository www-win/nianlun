export type Relation = '家人' | '挚友' | '同事' | '同学' | '客户' | '其他'

export interface Message {
  ts: number
  from: 'me' | 'them'
  type: 'text' | 'image' | 'voice' | 'video' | 'system' | 'other'
  text?: string
}

export interface Conversation {
  id: string
  peerName: string
  isGroup: boolean
  messages: Message[]
}

export interface Friend {
  id: string
  name: string
  alias: string
  rel: Relation
  role: string
  firstContact: number
  lastContact: number
  msgCount: number
  sentRatio: number      // 0–100,我方发送占比
  peakPeriod: string
  maxStreak: number      // 最长连续聊天天数
  monthly: number[]      // 长度 12
  userEdited: { role?: string; rel?: Relation; alias?: string; name?: string }
}

export interface ReportData {
  year: number
  totalMessages: number
  friendCount: number
  activeDays: number
  topContacts: Array<{ friendId: string; msgCount: number }>
  latestMessage: { ts: number; friendId: string } | null
  keywords: Array<{ word: string; count: number }>
  relationBreakdown: Array<{ rel: Relation; percent: number }>
}

export interface ParseWarning { line?: number; reason: string }
export interface ParseResult { conversations: Conversation[]; warnings: ParseWarning[] }

export interface Parser {
  name: string
  canParse(fileName: string, sample: string): boolean
  parse(content: string, onProgress?: (p: number) => void, fileName?: string): ParseResult
}
