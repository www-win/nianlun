import type { StockPick, StockCard, RecommenderPicks } from '@nianlun/core'

/** 视图A 票列表排序：推的人越多越靠前（核心标的），并列时荐股条数多的在前。 */
export function sortStockCards(cards: StockCard[]): StockCard[] {
  return [...cards].sort((a, b) => b.recommenderCount - a.recommenderCount || b.pickCount - a.pickCount)
}

/** 视图B 人列表排序：推过的票越多越靠前，并列时荐股条数多的在前。 */
export function sortRecommenders(rs: RecommenderPicks[]): RecommenderPicks[] {
  return [...rs].sort((a, b) => b.stockCount - a.stockCount || b.picks.length - a.picks.length)
}

/** 顶部统计：荐股条数、不同票数、不同推荐人数。 */
export function stockStats(picks: StockPick[]): { pickCount: number; stockCount: number; personCount: number } {
  return {
    pickCount: picks.length,
    stockCount: new Set(picks.map((p) => p.stockNorm)).size,
    personCount: new Set(picks.map((p) => p.recommenderId)).size,
  }
}
