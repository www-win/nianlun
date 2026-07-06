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
