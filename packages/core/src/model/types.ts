export type Relation = '家人' | '挚友' | '同事' | '同学' | '客户' | '其他'

export type MbtiCode =
  | 'INTJ' | 'INTP' | 'ENTJ' | 'ENTP'
  | 'INFJ' | 'INFP' | 'ENFJ' | 'ENFP'
  | 'ISTJ' | 'ISFJ' | 'ESTJ' | 'ESFJ'
  | 'ISTP' | 'ISFP' | 'ESTP' | 'ESFP'

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

export interface EmotionDist {
  happy: number      // 开心 条数
  neutral: number    // 平淡 条数
  sad: number        // 难过 条数
  total: number
  avg: number        // 平均情绪值 0..1，0.5=中性
}

export interface MonthMood {
  avg: number        // 该月该侧平均情绪值 0..1
  count: number      // 该月该侧消息条数（>0）
}

export interface FriendEmotion {
  me: EmotionDist
  them: EmotionDist
  monthly: { me: (MonthMood | null)[]; them: (MonthMood | null)[] }  // 长度 12，无消息月 = null
  words: Array<{ word: string; count: number; polarity: number }>    // polarity -1..1，不在词典=0
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
  hourly: number[]       // 长度 24，按小时(0–23)消息数
  weekHour: number[]     // 长度 168，索引 = getDay(0=周日)*24 + 小时
  keywords: Array<{ word: string; count: number }>  // 该好友 Top 20 高频词
  userEdited: { role?: string; rel?: Relation; alias?: string; name?: string; mbti?: MbtiCode }
  emotion?: FriendEmotion
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
