import type { Friend } from '../model/types'
import type { BaziChart, DayFortune, Compatibility, BirthInfo } from '../astrology/types'

export interface AstroReading {
  personality?: string   // 性格解读(并入 MBTI 味道)
  fortune?: string       // 近期流月流日运势解读
  affinity?: string      // 与我的相性("运势是否对称")
  advice?: string        // 社交结论(措辞软化)
}

/** 取非空 trim 字符串，否则 undefined。 */
function pickText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/**
 * 命理解读提示词：把「已算好的」结构化盘 + 流日 + 合盘交给 AI，只做自然语言解读。
 * 明确禁止 AI 自己推算干支；无线索填「暂无足够线索」；社交建议软化、娱乐向。
 */
export function buildAstroPrompt(
  friend: Friend, chart: BaziChart, dayFortune: DayFortune, compat: Compatibility | null,
  dayClash?: { friend: string[]; my: string[] },
): string {
  const displayName = friend.alias || friend.name
  const pillars = [chart.pillars.year, chart.pillars.month, chart.pillars.day, chart.pillars.hour]
    .filter(Boolean).join(' ')
  const wuxing = Object.entries(chart.fiveElements).map(([k, v]) => `${k}${v}`).join(' ')
  const compatLine = compat
    ? `与我合盘：相合[${compat.harmonies.join('、') || '无'}]，相冲[${compat.clashes.join('、') || '无'}]`
    : '与我合盘：我的命盘未设置，暂不评相性'
  const clashLine = dayClash && (dayClash.friend.length || dayClash.my.length)
    ? `今日流日相冲：好友本命[${dayClash.friend.join('、') || '无'}]，我本命[${dayClash.my.join('、') || '无'}]`
    : '今日流日相冲：无明显相冲'

  return [
    '你是一位擅长把命盘转成通俗解读的观察者。以下命盘、流日、合盘均「已算好」，',
    '你只需据此做自然语言解读，切勿自行推算干支或改动盘面数据。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    '  "personality": "<性格解读：结合日主与五行，一小段>",',
    '  "fortune": "<近期运势：结合流月流日干支与生克，一小段>",',
    '  "affinity": "<与我的相性：结合合盘相合/相冲，一小段>",',
    '  "advice": "<社交提示：近期宜亲近或宜保持距离，附一句依据>"',
    '}',
    '',
    '要求：每段约 30~60 字。任一字段无可靠依据填「暂无足够线索」，禁止臆测。',
    '这是仅供娱乐参考的命理解读；advice 措辞要温和，是「提个醒」而非结论，避免劝人绝交。',
    '',
    '盘面数据：',
    `- 好友：${displayName}（关系：${friend.rel}${friend.role ? '，' + friend.role : ''}）`,
    `- 四柱：${pillars}`,
    `- 日主：${chart.dayMaster}；五行分布：${wuxing}`,
    `- 生肖：${chart.zodiac}；星座：${chart.constellation}`,
    `- 当前流日：${dayFortune.ganzhi}（对其本命日主为「${dayFortune.relation}」）`,
    `- ${compatLine}`,
    `- ${clashLine}`,
  ].join('\n')
}

/** 容错解析命理解读 JSON：剥围栏、定位花括号、逐字段取非空串；垃圾输入返回 {}，永不抛异常。 */
export function parseAstroReading(text: string): AstroReading {
  if (typeof text !== 'string') return {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  let obj: unknown
  try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return {} }
  if (typeof obj !== 'object' || obj === null) return {}
  const r = obj as Record<string, unknown>
  const out: AstroReading = {}
  const personality = pickText(r.personality); if (personality) out.personality = personality
  const fortune = pickText(r.fortune); if (fortune) out.fortune = fortune
  const affinity = pickText(r.affinity); if (affinity) out.affinity = affinity
  const advice = pickText(r.advice); if (advice) out.advice = advice
  return out
}

/** 抽生辰提示词：从有界样本里找好友透露的出生信息；找不到留空，禁止编造。 */
export function buildBirthExtractPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  return [
    `请从下面与「${displayName}」的聊天样本里，找出 TA 明确透露的出生信息（阳历优先）。`,
    '只输出一个严格 JSON 对象，不要围栏外文字：',
    '{ "year": <年>, "month": <月1-12>, "day": <日1-31>, "hour": <时0-23，可省>, "isLunar": <是否农历，可省>, "gender": <"male"|"female"，可省> }',
    '若样本中没有可靠的出生信息，输出 {"found": false}（表示「未找到」），禁止编造生辰。',
    '',
    '聊天样本（「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}

function pickInt(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

/** 容错解析生辰：年月日必须有效，否则 null；hour/gender/isLunar 可选。永不抛异常。 */
export function parseBirthInfo(text: string): BirthInfo | null {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  let obj: unknown
  try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (typeof obj !== 'object' || obj === null) return null
  const r = obj as Record<string, unknown>
  const year = pickInt(r.year, 1900, 2100)
  const month = pickInt(r.month, 1, 12)
  const day = pickInt(r.day, 1, 31)
  if (year === undefined || month === undefined || day === undefined) return null
  const out: BirthInfo = { year, month, day }
  const hour = pickInt(r.hour, 0, 23); if (hour !== undefined) out.hour = hour
  if (r.isLunar === true) out.isLunar = true
  if (r.gender === 'male' || r.gender === 'female') out.gender = r.gender
  return out
}
