import type { Friend } from './types'

export function createFriend(id: string, name: string): Friend {
  return {
    id,
    name,
    alias: '',
    rel: '其他',
    role: '',
    firstContact: 0,
    lastContact: 0,
    msgCount: 0,
    sentRatio: 0,
    peakPeriod: '',
    maxStreak: 0,
    monthly: new Array(12).fill(0),
    userEdited: {},
  }
}
