import { mergeStockPicks } from '@nianlun/core'
import type { Conversation, Friend, StockPick, ExtractCtx } from '@nianlun/core'

/** 金融/投资类启发式筛选器：role/alias/name 命中关键词即金融。
 *  注意：analyzeStocks 默认已不再用它预筛（真机 role 常为空会致 0 候选），
 *  保留供注入 isFinanceFriend 或将来 UI 白名单场景使用。 */
const FINANCE_KW = /首席|投资|私募|券商|基金|研究员|分析师|资管|证券|操盘|游资|经济学家|股票|荐股/
export function isFinanceRole(f: Friend): boolean {
  return FINANCE_KW.test(`${f.role} ${f.alias} ${f.name}`)
}

/** 单块样本字符预算，留 AI 输入余量。 */
const SAMPLE_CHUNK_CHARS = 6000

export interface AnalyzeStocksDeps {
  conversations: Conversation[]
  friends: Friend[]
  targetIds?: string[]
  isFinanceFriend?: (f: Friend) => boolean
  extract: (f: Friend, samples: string[], ctx: ExtractCtx) => Promise<StockPick[]>
  onProgress?: (done: number, total: number) => void
}

export interface AnalyzeStocksResult {
  picks: StockPick[]
  analyzed: number
  withPicks: number
  failed: number
  firstError?: string
}

function pad2(n: number): string { return n < 10 ? '0' + n : String(n) }

/** 会话文本消息 → 带日期前缀的样本行 + 兜底推荐时间(消息时间中值)。 */
function datedSamples(conv: Conversation): { lines: string[]; fallbackTs: number } {
  const msgs = conv.messages
    .filter((m) => m.type === 'text' && typeof m.text === 'string' && m.text.trim() !== '')
    .slice()
    .sort((a, b) => a.ts - b.ts)
  const lines = msgs.map((m) => {
    const d = new Date(m.ts)
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    const who = m.from === 'me' ? '我' : '对方'
    return `${date} ${who}：${(m.text ?? '').trim()}`
  })
  const fallbackTs = msgs.length ? msgs[Math.floor(msgs.length / 2)].ts : 0
  return { lines, fallbackTs }
}

/** 按字符预算把样本行切成多块（单行超预算也自成一块）。 */
function chunkByChars(lines: string[], max: number): string[][] {
  const chunks: string[][] = []
  let cur: string[] = []
  let len = 0
  for (const line of lines) {
    if (cur.length && len + line.length > max) { chunks.push(cur); cur = []; len = 0 }
    cur.push(line)
    len += line.length
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/** 对金融候选好友逐个（会话内再分块）串行抽取荐股，容错、进度、统计。 */
export async function analyzeStocks(deps: AnalyzeStocksDeps): Promise<AnalyzeStocksResult> {
  const { conversations, friends, targetIds, isFinanceFriend, extract, onProgress } = deps
  const convById = new Map(conversations.map((c) => [c.id, c]))
  // 候选优先级：targetIds 白名单 > isFinanceFriend 注入筛选 > 默认全部好友。
  // 默认不再按 role 预筛(isFinanceRole)——真机上 AI 推断的职务常为空、或用词不在
  // 关键词表里，会导致 0 候选、荐股完全抽不出。故对本次会话里的所有好友都试抽，
  // AI 判断无荐股则返回 []、自然跳过（用 token 代价换可用性；将来 UI 可勾选收窄）。
  const selected = targetIds
    ? friends.filter((f) => targetIds.includes(f.id))
    : isFinanceFriend
      ? friends.filter(isFinanceFriend)
      : friends
  const candidates = selected.filter((f) => convById.has(f.id))

  const total = candidates.length
  if (total) onProgress?.(0, total)

  let all: StockPick[] = []
  let analyzed = 0
  let withPicks = 0
  let failed = 0
  let firstError: string | undefined
  let done = 0

  for (const f of candidates) {
    analyzed++
    const conv = convById.get(f.id)
    try {
      if (conv) {
        const { lines, fallbackTs } = datedSamples(conv)
        const ctx: ExtractCtx = { recommenderId: f.id, recommender: f.alias || f.name, fallbackTs }
        let picks: StockPick[] = []
        for (const chunk of chunkByChars(lines, SAMPLE_CHUNK_CHARS)) {
          const got = await extract(f, chunk, ctx)
          picks = mergeStockPicks(picks, got)
        }
        if (picks.length) withPicks++
        all = mergeStockPicks(all, picks)
      }
    } catch (e) {
      failed++
      if (firstError === undefined) firstError = (e as Error)?.message ?? String(e)
    }
    done++
    onProgress?.(done, total)
  }
  return { picks: all, analyzed, withPicks, failed, firstError }
}
