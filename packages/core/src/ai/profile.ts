import type { Friend } from '../model/types'

export interface InvestmentProfile {
  summary?: string   // 一小段总述
  risk?: string      // 风险偏好：保守/稳健/平衡/进取
  categories?: string // 关注品类：股票/基金/房产/保险/黄金/存款/加密
  wealth?: string    // 财富与可投线索
  style?: string     // 决策风格与周期：自主/听建议、长线/短线/投机
}

export interface FriendProfile {
  identity?: string  // 身份/职业
  family?: string    // 家庭状况
  romance?: string   // 感情状态
  lifestyle?: string // 生活方式
  investment?: InvestmentProfile
}

/**
 * 好友画像提示词：依据聚合统计 + 有界样本，要求 AI 输出严格 JSON。
 * 5 个侧面（身份/家庭/感情/生活/投资），每字段一小段简述；无线索填「暂无足够线索」。
 */
export function buildFriendProfilePrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'

  return [
    '你是一位擅长从聊天记录推断人物背景的观察者。请根据下面这位微信好友的往来统计与部分聊天样本，',
    '推断 TA 的多方面画像，供金融从业者了解客户之用。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    '  "identity": "<身份/职业：行业+头衔+单位类型，一小段简述>",',
    '  "family": "<家庭状况：婚否、子女、与家人互动，一小段简述>",',
    '  "romance": "<感情状态：单身/恋爱/已婚等，一小段简述>",',
    '  "lifestyle": "<生活方式：兴趣爱好、作息、常聊话题，一小段简述>",',
    '  "investment": {',
    '    "summary": "<投资偏好总述，一小段>",',
    '    "risk": "<风险偏好：保守/稳健/平衡/进取，附依据>",',
    '    "categories": "<关注品类：股票/基金/房产/保险/黄金/存款/加密等>",',
    '    "wealth": "<财富与可投线索：大致财富水平、是否有闲置资金>",',
    '    "style": "<决策风格与周期：自主/听建议、长线/短线/投机、当下是否有理财需求>"',
    '  }',
    '}',
    '',
    '要求：每个字段给一小段简述（约 30~60 字，可点出聊天里的依据），不要只给一个标签词。',
    '任一字段若样本中无可靠线索，值填「暂无足够线索」，禁止臆测（尤其感情、家庭、财富）。',
    '',
    '聚合统计：',
    `- 好友：${displayName}`,
    `- 关系标签：${friend.rel}`,
    `- 职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    '',
    '部分聊天样本（「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}

/** 取非空 trim 字符串，否则 undefined。 */
function pickText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/** 从任意值里挑出投资子对象；内部全无有效字段则返回 undefined。 */
function pickInvestment(v: unknown): InvestmentProfile | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const r = v as Record<string, unknown>
  const out: InvestmentProfile = {}
  const summary = pickText(r.summary); if (summary) out.summary = summary
  const risk = pickText(r.risk); if (risk) out.risk = risk
  const categories = pickText(r.categories); if (categories) out.categories = categories
  const wealth = pickText(r.wealth); if (wealth) out.wealth = wealth
  const style = pickText(r.style); if (style) out.style = style
  return Object.keys(out).length ? out : undefined
}

/**
 * 容错解析好友画像 JSON：剥围栏、定位首尾花括号、逐字段取非空字符串；
 * investment 内部全空则省略整块。无法解析返回 {}，永不抛异常。
 */
export function parseFriendProfile(text: string): FriendProfile {
  if (typeof text !== 'string') return {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  let obj: unknown
  try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return {} }
  if (typeof obj !== 'object' || obj === null) return {}
  const r = obj as Record<string, unknown>
  const out: FriendProfile = {}
  const identity = pickText(r.identity); if (identity) out.identity = identity
  const family = pickText(r.family); if (family) out.family = family
  const romance = pickText(r.romance); if (romance) out.romance = romance
  const lifestyle = pickText(r.lifestyle); if (lifestyle) out.lifestyle = lifestyle
  const investment = pickInvestment(r.investment); if (investment) out.investment = investment
  return out
}
