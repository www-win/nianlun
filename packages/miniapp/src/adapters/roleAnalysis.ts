import type { Friend, FriendSuggestion, Relation } from '@nianlun/core'

export interface AnalyzeRolesDeps {
  friends: Friend[]
  analyzedIds: string[]
  loadSamples: (id: string) => string[]
  suggest: (f: Friend, samples: string[]) => Promise<FriendSuggestion>
  applyRole: (id: string, patch: { rel?: Relation; role?: string }) => void | Promise<void>
  onProgress?: (done: number, total: number) => void
}

/** 批量分析结果统计（供导入页显示，让失败/无结果现形，不再静默吞错）。 */
export interface AnalyzeRolesResult {
  /** 更新后的已分析 id 集合（旧 ∪ 成功分析的）。 */
  analyzedIds: string[]
  /** 成功写入关系/职务的好友数。 */
  succeeded: number
  /** 调用抛异常的好友数（失败，未计入集合、下次重试）。 */
  failed: number
  /** 调用成功但 AI 无有效结果的好友数（未计入集合、下次重试）。 */
  empty: number
  /** 第一条失败的错误信息，便于定位后端/调用层问题。 */
  firstError?: string
}

/**
 * 对「不在 analyzedIds 里」的好友逐个 AI 推断关系/职务并写入。
 * 成功（rel/role 有值）→ applyRole 且 id 计入已分析；无结果/抛异常 → 跳过、不计入（下次可重试）。
 * 串行执行，避免并发打爆云函数。返回更新后的集合与成功/失败/无结果统计（含首条错误）。
 */
export async function analyzeRolesForNew(deps: AnalyzeRolesDeps): Promise<AnalyzeRolesResult> {
  const { friends, analyzedIds, loadSamples, suggest, applyRole, onProgress } = deps
  const done = new Set(analyzedIds)
  const pending = friends.filter((f) => !done.has(f.id))
  const total = pending.length
  if (total) onProgress?.(0, total)
  let count = 0
  let succeeded = 0
  let failed = 0
  let empty = 0
  let firstError: string | undefined
  for (const f of pending) {
    try {
      const sug = await suggest(f, loadSamples(f.id))
      if (sug.rel || sug.role) {
        await applyRole(f.id, { rel: sug.rel, role: sug.role })
        done.add(f.id)
        succeeded++
      } else {
        empty++
      }
    } catch (e) {
      failed++
      if (firstError === undefined) firstError = (e as Error)?.message ?? String(e)
    }
    count++
    onProgress?.(count, total)
  }
  return { analyzedIds: [...done], succeeded, failed, empty, firstError }
}
