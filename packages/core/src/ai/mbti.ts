import type { Friend, MbtiCode } from '../model/types'

export const MBTI_CODES: readonly MbtiCode[] = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
]

export const MBTI_TITLES: Record<MbtiCode, string> = {
  INTJ: '建筑师', INTP: '逻辑学家', ENTJ: '指挥官', ENTP: '辩论家',
  INFJ: '提倡者', INFP: '调停者', ENFJ: '主人公', ENFP: '竞选者',
  ISTJ: '物流师', ISFJ: '守卫者', ESTJ: '总经理', ESFJ: '执政官',
  ISTP: '鉴赏家', ISFP: '探险家', ESTP: '企业家', ESFP: '表演者',
}

export function mbtiTitle(code: MbtiCode): string {
  return MBTI_TITLES[code] ?? ''
}

// 边界不用 lookbehind（miniapp 旧机兼容）：前后须为串首尾或非字母。
// i 标志下 [^a-z] 已折叠大小写，等价「非字母」。
const CODE_RE = new RegExp(`(^|[^a-z])(${MBTI_CODES.join('|')})([^a-z]|$)`, 'i')

/** 从任意文本（昵称/备注/职务）识别首个 16 型码，返回大写规范码；无则 null。永不抛异常。 */
export function detectMbtiFromText(text: string): MbtiCode | null {
  if (typeof text !== 'string' || text === '') return null
  const m = CODE_RE.exec(text)
  if (!m) return null
  const code = m[2].toUpperCase() as MbtiCode
  return MBTI_CODES.includes(code) ? code : null
}

export type MbtiAxis = 'EI' | 'SN' | 'TF' | 'JP'
export interface MbtiDimension {
  axis: MbtiAxis
  pole: string
  strength: number
  note?: string
}
export interface MbtiResult {
  code: MbtiCode
  title: string
  summary: string
  dimensions: MbtiDimension[]
}
export type MbtiSource = 'manual' | 'remark' | 'ai' | 'none'

const AXES: MbtiAxis[] = ['EI', 'SN', 'TF', 'JP']

/** MBTI 提示词：喂聚合统计 + 有界样本，要求 AI 输出严格 JSON。参照 buildFriendProfilePrompt。 */
export function buildMbtiPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  return [
    '你是一位擅长从聊天记录推断人格类型（MBTI）的观察者。请根据这位微信好友的往来统计与部分聊天样本，',
    '推断 TA 的 MBTI 16 型人格。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    '  "code": "<四字母类型码，如 INTJ>",',
    '  "title": "<该类型中文别名，如 建筑师>",',
    '  "summary": "<一段人格解读，约 60~100 字，点出聊天里的依据>",',
    '  "dimensions": [',
    '    {"axis":"EI","pole":"<E 或 I>","strength":<0-100 偏向该极强度>,"note":"<一句依据>"},',
    '    {"axis":"SN","pole":"<S 或 N>","strength":<0-100>,"note":"<一句依据>"},',
    '    {"axis":"TF","pole":"<T 或 F>","strength":<0-100>,"note":"<一句依据>"},',
    '    {"axis":"JP","pole":"<J 或 P>","strength":<0-100>,"note":"<一句依据>"}',
    '  ]',
    '}',
    '',
    '要求：code 必须是 16 个合法类型之一，四个维度落点须与 code 一致。线索不足时给保守判断并在 note 里说明依据薄弱，禁止编造具体事件。',
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

function normalizeDimensions(raw: unknown, code: MbtiCode): MbtiDimension[] {
  const provided = Array.isArray(raw) ? raw : []
  return AXES.map((axis, i) => {
    const pole = code[i] // code 为真相来源，忽略 AI 给的 pole，避免矛盾
    const found = provided.find(
      (d) => typeof d === 'object' && d !== null && (d as { axis?: unknown }).axis === axis,
    ) as { strength?: unknown; note?: unknown } | undefined
    let strength = 60
    if (found && typeof found.strength === 'number' && found.strength >= 0 && found.strength <= 100) {
      strength = Math.round(found.strength)
    }
    const dim: MbtiDimension = { axis, pole, strength }
    if (found && typeof found.note === 'string' && found.note.trim()) dim.note = found.note.trim()
    return dim
  })
}

/** 从对象逐字段构造 MbtiResult；code 非法则 null。 */
function fromMbtiObject(r: Record<string, unknown>): MbtiResult | null {
  // code 兜底：模型常返回带装饰的码（INTJ-A / INTJ型 / INTJ（建筑师）），
  // 用 detectMbtiFromText 从中抽出合法码，而非要求严格等值，避免变体整条作废。
  const code = typeof r.code === 'string' ? detectMbtiFromText(r.code) : null
  if (!code) return null
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : mbtiTitle(code)
  const summary = typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim() : ''
  return { code, title, summary, dimensions: normalizeDimensions(r.dimensions, code) }
}

/**
 * 从（可能被截断/不闭合的）文本正则抓取 "key": "value"。
 * 闭合引号认「其后紧跟结构分隔符 `,`/`}`（或段末）的那个」，而非值内出现的第一个引号——
 * 模型常在解读/维度 note 里用未转义半角双引号引用原话，停在第一个内嵌引号会把字段抓成半截。
 * 参照 profile.ts 的 grabField；真被截断的尾字段无「闭合引号+分隔符」，仍抓不到（保留截断兜底行为）。
 */
function grabStr(text: string, key: string): string | undefined {
  const m = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=[,}]|$)`).exec(text)
  if (!m) return undefined
  const raw = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  return raw.trim() || undefined
}

/** 抓取某轴维度对象里已写出的 strength/note（对象可能未闭合）。界定到下一个 "axis" 前，避免串到别轴。 */
function grabDimension(text: string, axis: MbtiAxis): { axis: MbtiAxis; strength?: number; note?: string } | null {
  const at = text.search(new RegExp(`"axis"\\s*:\\s*"${axis}"`))
  if (at < 0) return null
  const next = text.slice(at + 1).search(/"axis"\s*:/)
  const seg = next < 0 ? text.slice(at) : text.slice(at, at + 1 + next)
  const out: { axis: MbtiAxis; strength?: number; note?: string } = { axis }
  const sm = /"strength"\s*:\s*(\d+)/.exec(seg)
  if (sm) out.strength = Number(sm[1])
  const note = grabStr(seg, 'note')
  if (note) out.note = note
  return out
}

/**
 * JSON 被 maxTokens 截断（尾部不闭合、无法 parse）时的兜底：正则抢救 code/title/summary 与已写出的维度强度，
 * 至少产出一个合法 MbtiResult；code 尚未写出（无从确定类型）则返回 null。参照 parseFriendProfile 的 salvage。
 */
function salvageMbti(text: string): MbtiResult | null {
  const codeStr = grabStr(text, 'code')
  const code = codeStr ? detectMbtiFromText(codeStr) : null
  if (!code) return null
  const title = grabStr(text, 'title') || mbtiTitle(code)
  const summary = grabStr(text, 'summary') || ''
  const dims = AXES.map((a) => grabDimension(text, a)).filter((d): d is NonNullable<typeof d> => d !== null)
  return { code, title, summary, dimensions: normalizeDimensions(dims, code) }
}

/**
 * 容错解析 MBTI JSON：剥围栏、定花括号、校验 code；缺字段补齐。
 * JSON 完整则直接解析；被截断/不闭合时退回逐字段正则抢救。无法确定 code 返回 null，永不抛异常。
 */
export function parseMbti(text: string): MbtiResult | null {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  if (start === -1) return null
  const end = text.lastIndexOf('}')
  if (end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1))
      if (typeof obj === 'object' && obj !== null) {
        const parsed = fromMbtiObject(obj as Record<string, unknown>)
        if (parsed) return parsed
      }
    } catch { /* 截断的 JSON 无法 parse，落到 salvage 抢救 */ }
  }
  return salvageMbti(text)
}

/** 计算好友的有效 MBTI 码与来源：手改 > 备注识别(alias>role>name) > AI 码 > 无。 */
export function effectiveMbtiCode(
  friend: Friend,
  aiCode?: MbtiCode | null,
): { code: MbtiCode | null; source: MbtiSource } {
  const manual = friend.userEdited?.mbti
  if (manual && MBTI_CODES.includes(manual)) return { code: manual, source: 'manual' }
  const fromText =
    detectMbtiFromText(friend.alias || '') ||
    detectMbtiFromText(friend.role || '') ||
    detectMbtiFromText(friend.name || '')
  if (fromText) return { code: fromText, source: 'remark' }
  if (aiCode && MBTI_CODES.includes(aiCode)) return { code: aiCode, source: 'ai' }
  return { code: null, source: 'none' }
}
