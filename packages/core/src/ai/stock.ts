import type { Friend } from '../model/types'

/** 一条荐股原子记录 = 一次「谁推了哪支票」。唯一事实源。 */
export interface StockPick {
  stock: string
  stockNorm: string
  recommenderId: string
  recommender: string
  ts: number
  targetMarketCap?: string
  multiple?: string
  targetTime?: string
  currentPrice?: string
  logics: string[]
  companyNotes: string[]
  quote?: string
}

/** 解析/编排层注入给每条 pick 的上下文。 */
export interface ExtractCtx {
  recommenderId: string
  recommender: string
  fallbackTs: number
}

/** 视图A·以票查人：一支票的完整档案。 */
export interface StockCard {
  stockNorm: string
  displayName: string
  recommenderCount: number
  pickCount: number
  latestTargetMarketCap?: string
  latestMultiple?: string
  logics: string[]
  companyNotes: string[]
  picks: StockPick[]
}

/** 视图B·以人查票：某人推过的所有票。 */
export interface RecommenderPicks {
  recommenderId: string
  recommender: string
  stockCount: number
  picks: StockPick[]
}

/** 归并键规范化：去括号及内容、去空白、英文统一大写。 */
export function normalizeStockName(raw: string): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase()
}

function pickStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}
function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
}
/** 把 YYYY / YYYY-MM / YYYY-MM-DD 解析为毫秒 ts；失败返回 fallback。用 Date.UTC 保确定性。 */
function parseDateToTs(date: unknown, fallback: number): number {
  if (typeof date !== 'string') return fallback
  const m = date.trim().match(/^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?/)
  if (!m) return fallback
  const y = Number(m[1]); const mo = m[2] ? Number(m[2]) : 1; const d = m[3] ? Number(m[3]) : 1
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return fallback
  return Date.UTC(y, mo - 1, d)
}

/** 容错解析 AI 荐股抽取结果为 StockPick[]；注入 ctx；永不抛。 */
export function parseStockExtraction(text: string, ctx: ExtractCtx): StockPick[] {
  if (typeof text !== 'string') return []
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []
  let arr: unknown
  try { arr = JSON.parse(text.slice(start, end + 1)) } catch { return [] }
  if (!Array.isArray(arr)) return []
  const out: StockPick[] = []
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const stock = pickStr(r.stock)
    if (!stock) continue
    const pick: StockPick = {
      stock,
      stockNorm: normalizeStockName(stock),
      recommenderId: ctx.recommenderId,
      recommender: ctx.recommender,
      ts: parseDateToTs(r.date, ctx.fallbackTs),
      logics: toStrArray(r.logics),
      companyNotes: toStrArray(r.companyNotes),
    }
    const tmc = pickStr(r.targetMarketCap); if (tmc) pick.targetMarketCap = tmc
    const mul = pickStr(r.multiple); if (mul) pick.multiple = mul
    const tt = pickStr(r.targetTime); if (tt) pick.targetTime = tt
    const q = pickStr(r.quote); if (q) pick.quote = q
    out.push(pick)
  }
  return out
}

const pickKey = (p: StockPick) => `${p.stockNorm}|${p.recommenderId}|${p.ts}|${p.quote ?? ''}`

/** 去重合并两批荐股记录，保持顺序（existing 在前）。 */
export function mergeStockPicks(existing: StockPick[], incoming: StockPick[]): StockPick[] {
  const seen = new Set(existing.map(pickKey))
  const out = [...existing]
  for (const p of incoming) {
    const k = pickKey(p)
    if (!seen.has(k)) { seen.add(k); out.push(p) }
  }
  return out
}

function dedup(a: string[]): string[] { return [...new Set(a)] }

/** 视图A：按 stockNorm 聚合成票卡片（三层信息在此归纳）。 */
export function aggregateByStock(picks: StockPick[]): StockCard[] {
  const groups = new Map<string, StockPick[]>()
  for (const p of picks) {
    const g = groups.get(p.stockNorm)
    if (g) g.push(p); else groups.set(p.stockNorm, [p])
  }
  const cards: StockCard[] = []
  for (const [stockNorm, gp] of groups) {
    const nameCount = new Map<string, number>()
    for (const p of gp) nameCount.set(p.stock, (nameCount.get(p.stock) ?? 0) + 1)
    let displayName = gp[0].stock; let best = 0
    for (const [n, c] of nameCount) if (c > best) { best = c; displayName = n }
    const byTsDesc = [...gp].sort((a, b) => b.ts - a.ts)
    const card: StockCard = {
      stockNorm,
      displayName,
      recommenderCount: new Set(gp.map((p) => p.recommenderId)).size,
      pickCount: gp.length,
      logics: dedup(gp.flatMap((p) => p.logics)),
      companyNotes: dedup(gp.flatMap((p) => p.companyNotes)),
      picks: gp,
    }
    const tmc = byTsDesc.find((p) => p.targetMarketCap)?.targetMarketCap
    const mul = byTsDesc.find((p) => p.multiple)?.multiple
    if (tmc) card.latestTargetMarketCap = tmc
    if (mul) card.latestMultiple = mul
    cards.push(card)
  }
  return cards
}

/** 视图B：按推荐人聚合。 */
export function aggregateByRecommender(picks: StockPick[]): RecommenderPicks[] {
  const groups = new Map<string, StockPick[]>()
  for (const p of picks) {
    const g = groups.get(p.recommenderId)
    if (g) g.push(p); else groups.set(p.recommenderId, [p])
  }
  const out: RecommenderPicks[] = []
  for (const [recommenderId, gp] of groups) {
    out.push({
      recommenderId,
      recommender: gp[0].recommender,
      stockCount: new Set(gp.map((p) => p.stockNorm)).size,
      picks: gp,
    })
  }
  return out
}

/** 用好友最新显示名刷新每条 pick 的 recommender 快照。
 *  pick.recommender 是「抽取当时」的名字快照；好友改名或导入通讯录(contacts.json)后，
 *  按 recommenderId 命中 nameById 即覆盖为最新名。空名/未命中/同名时保持原对象（返回新数组）。 */
export function withRecommenderNames(picks: StockPick[], nameById: Map<string, string>): StockPick[] {
  return picks.map((p) => {
    const name = nameById.get(p.recommenderId)
    return name && name !== p.recommender ? { ...p, recommender: name } : p
  })
}

/** 单个好友 + 带日期样本 → 荐股抽取提示词，要求 AI 只输出严格 JSON 数组。 */
export function buildStockExtractionPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  return [
    '你是一位擅长从聊天记录中抽取「荐股信息」的金融助理。',
    `下面是与「${displayName}」的部分聊天样本，请找出其中所有「推荐 / 看好某支股票」的记录。`,
    '',
    '只输出一个严格的 JSON 数组，不要任何解释、不要代码围栏外的文字。',
    '若样本中没有任何荐股信息，输出空数组 []。',
    '每个数组元素格式：',
    '{',
    '  "stock": "<股票名称，必填>",',
    '  "date": "<推荐时间，取样本行首日期，如 2026-03-05；无法确定留空>",',
    '  "targetMarketCap": "<目标市值，如 500亿；无则省略>",',
    '  "multiple": "<涨幅倍数，如 2倍；无则省略>",',
    '  "targetTime": "<预计到达时间，如 1年内；无则省略>",',
    '  "logics": ["<推荐逻辑，分条>"],',
    '  "companyNotes": ["<公司信息或「谁说了什么」的评价，分条>"],',
    '  "quote": "<最能代表该荐股的原话摘录>"',
    '}',
    '',
    '要求：只抽确有荐股含义的内容；目标价 / 倍数等无明确依据时宁可省略，禁止臆造。',
    '',
    '聊天样本（每行以日期开头，「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}
