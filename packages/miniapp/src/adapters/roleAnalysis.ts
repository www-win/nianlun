import type { Friend, FriendSuggestion, Relation } from '@nianlun/core'

export interface AnalyzeRolesDeps {
  friends: Friend[]
  analyzedIds: string[]
  loadSamples: (id: string) => string[]
  suggest: (f: Friend, samples: string[]) => Promise<FriendSuggestion>
  applyRole: (id: string, patch: { rel?: Relation; role?: string }) => void | Promise<void>
  onProgress?: (done: number, total: number) => void
}

/**
 * 对「不在 analyzedIds 里」的好友逐个 AI 推断关系/职务并写入。
 * 成功（rel/role 有值）→ applyRole 且 id 计入已分析；空结果/抛异常 → 跳过、不计入（下次可重试）。
 * 串行执行，避免并发打爆云函数。返回更新后的 analyzedIds（旧 ∪ 成功分析的）。
 */
export async function analyzeRolesForNew(deps: AnalyzeRolesDeps): Promise<string[]> {
  const { friends, analyzedIds, loadSamples, suggest, applyRole, onProgress } = deps
  const done = new Set(analyzedIds)
  const pending = friends.filter((f) => !done.has(f.id))
  const total = pending.length
  if (total) onProgress?.(0, total)
  let count = 0
  for (const f of pending) {
    try {
      const sug = await suggest(f, loadSamples(f.id))
      if (sug.rel || sug.role) {
        await applyRole(f.id, { rel: sug.rel, role: sug.role })
        done.add(f.id)
      }
    } catch {
      // 单个失败：跳过、不计入，下次导入重试
    }
    count++
    onProgress?.(count, total)
  }
  return [...done]
}
