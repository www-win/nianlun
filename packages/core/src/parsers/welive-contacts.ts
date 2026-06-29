// 解析 welive `contacts` 命令导出的 contacts.json，得到 wxid/群号 → 显示名 的对照。
// 纯函数、容错：解析失败返回 []，绝不抛异常。

export interface ContactName {
  id: string
  name: string
}

// 嗅探：welive 联系人导出是一个数组，元素含 username + (nick_name|remark) + local_type。
// 借此与年轮自家好友备份数组（{name, rel, msgCount}）区分。
export function isWeliveContacts(sample: string): boolean {
  const s = sample.replace(/^﻿/, '').trimStart()
  if (!s.startsWith('[')) return false
  if (!s.includes('"username"')) return false
  if (!s.includes('"nick_name"') && !s.includes('"remark"')) return false
  return s.includes('"local_type"')
}

export function parseWeliveContacts(content: string): ContactName[] {
  let raw: unknown
  try {
    raw = JSON.parse(content.replace(/^﻿/, ''))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const out: ContactName[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = String(r.username ?? '').trim()
    if (!id) continue
    // 备注名优先，其次微信昵称（群聊的 nick_name 即群名）
    const name = (String(r.remark ?? '').trim() || String(r.nick_name ?? '').trim())
    if (!name) continue
    out.push({ id, name })
  }
  return out
}
