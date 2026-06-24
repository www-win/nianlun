import type { Friend, Relation } from '../model/types'
import { createFriend } from '../model/friend'

const RELATIONS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']
const toRel = (s: string): Relation => (RELATIONS.includes(s as Relation) ? (s as Relation) : '其他')

function applyRecord(rec: Record<string, unknown>): Friend {
  const name = String(rec.name ?? rec['昵称'] ?? '')
  const f = createFriend(name || 'unknown', name)
  f.alias = String(rec.alias ?? rec['备注'] ?? '')
  f.rel = toRel(String(rec.rel ?? rec['关系'] ?? '其他'))
  f.role = String(rec.role ?? rec['职务'] ?? '')
  f.msgCount = Number(rec.msgCount ?? rec['消息数'] ?? 0) || 0
  f.sentRatio = Number(rec.sentRatio ?? rec['我发出%'] ?? 0) || 0
  // 回导的字段视为用户已确认,合并时优先保留
  f.userEdited = { role: f.role || undefined, rel: f.rel, alias: f.alias || undefined }
  return f
}

export function parseJsonBackup(content: string): Friend[] {
  let arr: unknown
  try {
    arr = JSON.parse(content)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  return arr.map((r) => applyRecord(r as Record<string, unknown>))
}

export function parseCsvBackup(content: string): Friend[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  return lines.slice(1).map((line) => {
    // NOTE: split-on-comma assumes the tool's own export format with no embedded commas in fields.
    // Full CSV quoting/escaping is out of scope for v1.
    const cells = line.split(',')
    const rec: Record<string, string> = {}
    headers.forEach((h, i) => { rec[h.trim()] = (cells[i] ?? '').trim() })
    return applyRecord(rec)
  })
}
