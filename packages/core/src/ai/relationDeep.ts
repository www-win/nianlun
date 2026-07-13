import type { Friend } from '../model/types'

export interface AttachmentSide { style?: string; desc?: string }
export interface Trigger { trigger?: string; reaction?: string }
export interface SecurityTurningPoint { month?: number; event?: string; direction?: '上升' | '下降' }
export interface Suggestion { topic?: string; problem?: string; advice?: string }

export interface RelationDeep {
  overall?: string
  attachment?: { me?: AttachmentSide; other?: AttachmentSide }
  interaction?: { initiative?: string; expression?: string; conflict?: string }
  needs?: { me?: string; other?: string }
  uniqueness?: { sharedMemory?: string; ritual?: string }
  security?: { summary?: string; turningPoints?: SecurityTurningPoint[] }
  power?: { summary?: string; whoLeads?: string; dependency?: string }
  triggers?: { me?: Trigger[]; other?: Trigger[] }
  language?: { appellation?: string; catchphrases?: string; emoji?: string; latency?: string }
  suggestions?: Suggestion[]
}

/**
 * 10 块的 JSON 格式片段（顺序即 RelationDeep 字段顺序，均无尾逗号）。
 * 按 part 选子集后用 ',\n' 拼接，保证任意子集的逗号都正确。
 */
const REL_BLOCKS: string[] = [
  '  "overall": "<整体评估：一段定调，点出关系张力与核心互动模式，120~200 字>"',
  [
    '  "attachment": {',
    '    "me": {"style": "<我方依恋类型>", "desc": "<解读，引原句，60~120 字>"},',
    '    "other": {"style": "<对方依恋类型>", "desc": "<解读，引原句，60~120 字>"}',
    '  }',
  ].join('\n'),
  [
    '  "interaction": {',
    '    "initiative": "<沟通主动性：谁发起、谁推动，60~120 字>",',
    '    "expression": "<情感表达差异：直接/克制、正面/负面各如何，60~120 字>",',
    '    "conflict": "<冲突处理：套用追逐-回避等模型，60~120 字>"',
    '  }',
  ].join('\n'),
  '  "needs": {"me": "<我方核心情感需求，40~80 字>", "other": "<对方核心情感需求，40~80 字>"}',
  '  "uniqueness": {"sharedMemory": "<只属于你们的共同记忆/话题>", "ritual": "<你们独特的互动仪式/角色扮演>"}',
  [
    '  "security": {',
    '    "summary": "<安全感/信任如何随时间消长，结合逐月消息数，80~140 字>",',
    '    "turningPoints": [<关键转折，每项>{"month": <1-12>, "event": "<发生了什么，引原句>", "direction": "上升" 或 "下降"}]',
    '  }',
  ].join('\n'),
  '  "power": {"summary": "<权力/主导权总述，谁更投入、谁掌控节奏>", "whoLeads": "<谁主导：我/对方/均衡>", "dependency": "<依赖与被依赖关系>"}',
  [
    '  "triggers": {',
    '    "me": [<我方情绪雷区，每项>{"trigger": "<什么话题/行为会触发>", "reaction": "<典型反应，引原句>"}],',
    '    "other": [<对方情绪雷区，每项>{"trigger": "<...>", "reaction": "<...>"}]',
    '  }',
  ].join('\n'),
  '  "language": {"appellation": "<称呼习惯>", "catchphrases": "<口头禅/高频语>", "emoji": "<表情包习惯>", "latency": "<回复时延与节奏>"}',
  '  "suggestions": [<优化建议，每项成对>{"topic": "<主题，如 沟通模式/情感表达>", "problem": "<问题诊断>", "advice": "<可执行建议，可用 NVC 四步>"}]',
]

/** 3 段拆分的块区间（REL_BLOCKS 下标 [起,止)）：1=整体/依恋；2=互动/需求/独特性/安全感；3=权力/触发点/语言/建议。 */
const PART_SLICE: Record<1 | 2 | 3, [number, number]> = { 1: [0, 2], 2: [2, 6], 3: [6, 10] }

/**
 * 深度关系分析提示词。part 省略=全部 10 块；否则按 PART_SLICE 出该段的块。
 * 客户端拆三次并行调用以规避云函数 60s 超时（单段更小、生成更快、余量足）。
 * 理论内核：成人依恋理论、追逐-回避(Demand-Withdraw)、非暴力沟通(NVC)；安全感/触发点须引原句佐证。
 */
export function buildRelationDeepPrompt(friend: Friend, samples: string[], part?: 1 | 2 | 3): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  const monthly = (friend.monthly ?? []).map((c, i) => `${i + 1}月:${c}`).join(' ')
  const blocks = part ? REL_BLOCKS.slice(PART_SLICE[part][0], PART_SLICE[part][1]) : REL_BLOCKS

  return [
    '你是一位受过训练、擅长成人依恋与亲密关系分析的心理咨询师。请依据下面这位微信好友',
    '与用户的往来统计和部分聊天样本，产出一份深入、克制、有依据的「深度关系分析」。',
    '理论框架：成人依恋理论（焦虑型/回避型/安全型/混乱型）、追逐-回避（Demand-Withdraw）',
    '冲突模型、非暴力沟通（NVC）。分析要具体、引用聊天里的原句作佐证，不空泛、不套话。',
    '这是用户对自己聊天记录的正当自我复盘。请始终以专业、临床、中立的口吻分析：即使聊天',
    '涉及负面、敏感或令人不适的内容（如激烈冲突、健康状况、情绪低谷等），也只客观解读其',
    '关系与心理含义，不做道德评判、不说教、不回避、不中断，完整输出所要求字段的 JSON。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    blocks.join(',\n'),
    '}',
    '',
    '要求：任一字段若样本中无可靠线索，值填「暂无足够线索」，禁止臆测（尤其感情、家庭、财富）。',
    '数组类字段（turningPoints / triggers / suggestions）若无内容给空数组 []。',
    '',
    '聚合统计：',
    `- 好友：${displayName}`,
    `- 关系标签：${friend.rel}`,
    `- 职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    `- 逐月消息数：${monthly}`,
    '',
    '部分聊天样本（「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}

// ── 容错取值助手 ──────────────────────────────
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
/** 保留至少有一个非空字段的对象，全空则返回 undefined。 */
function compact<T extends object>(o: T): T | undefined {
  return Object.keys(o).length ? o : undefined
}

function pickSide(v: unknown): AttachmentSide | undefined {
  const o = obj(v); if (!o) return undefined
  const out: AttachmentSide = {}
  const style = str(o.style); if (style) out.style = style
  const desc = str(o.desc); if (desc) out.desc = desc
  return compact(out)
}
function pickTriggers(v: unknown): Trigger[] {
  return arr(v).map((e) => {
    const o = obj(e); if (!o) return {}
    const out: Trigger = {}
    const t = str(o.trigger); if (t) out.trigger = t
    const rx = str(o.reaction); if (rx) out.reaction = rx
    return out
  }).filter((t) => Object.keys(t).length > 0)
}

/**
 * 容错解析深度关系分析 JSON：剥围栏、定位首尾花括号、逐块取值；
 * 空块/空数组一律省略；坏 JSON / 非字符串入参返回 {}，永不抛异常。
 */
export function parseRelationDeep(text: string): RelationDeep {
  if (typeof text !== 'string') return {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  let raw: unknown
  try { raw = JSON.parse(text.slice(start, end + 1)) } catch { return {} }
  const r = obj(raw); if (!r) return {}
  const out: RelationDeep = {}

  const overall = str(r.overall); if (overall) out.overall = overall

  const att = obj(r.attachment)
  if (att) {
    const me = pickSide(att.me); const other = pickSide(att.other)
    const block = compact({ ...(me ? { me } : {}), ...(other ? { other } : {}) })
    if (block) out.attachment = block
  }

  const inter = obj(r.interaction)
  if (inter) {
    const block: NonNullable<RelationDeep['interaction']> = {}
    const a = str(inter.initiative); if (a) block.initiative = a
    const b = str(inter.expression); if (b) block.expression = b
    const c = str(inter.conflict); if (c) block.conflict = c
    if (compact(block)) out.interaction = block
  }

  const needs = obj(r.needs)
  if (needs) {
    const block: NonNullable<RelationDeep['needs']> = {}
    const me = str(needs.me); if (me) block.me = me
    const other = str(needs.other); if (other) block.other = other
    if (compact(block)) out.needs = block
  }

  const uniq = obj(r.uniqueness)
  if (uniq) {
    const block: NonNullable<RelationDeep['uniqueness']> = {}
    const sm = str(uniq.sharedMemory); if (sm) block.sharedMemory = sm
    const ri = str(uniq.ritual); if (ri) block.ritual = ri
    if (compact(block)) out.uniqueness = block
  }

  const sec = obj(r.security)
  if (sec) {
    const block: NonNullable<RelationDeep['security']> = {}
    const sm = str(sec.summary); if (sm) block.summary = sm
    const tps = arr(sec.turningPoints).map((e) => {
      const o = obj(e); if (!o) return {}
      const tp: SecurityTurningPoint = {}
      if (typeof o.month === 'number') tp.month = o.month
      const ev = str(o.event); if (ev) tp.event = ev
      if (o.direction === '上升' || o.direction === '下降') tp.direction = o.direction
      return tp
    }).filter((t) => Object.keys(t).length > 0)
    if (tps.length) block.turningPoints = tps
    if (compact(block)) out.security = block
  }

  const pow = obj(r.power)
  if (pow) {
    const block: NonNullable<RelationDeep['power']> = {}
    const s = str(pow.summary); if (s) block.summary = s
    const w = str(pow.whoLeads); if (w) block.whoLeads = w
    const d = str(pow.dependency); if (d) block.dependency = d
    if (compact(block)) out.power = block
  }

  const trig = obj(r.triggers)
  if (trig) {
    const me = pickTriggers(trig.me); const other = pickTriggers(trig.other)
    const block: NonNullable<RelationDeep['triggers']> = {}
    if (me.length) block.me = me
    if (other.length) block.other = other
    if (compact(block)) out.triggers = block
  }

  const lang = obj(r.language)
  if (lang) {
    const block: NonNullable<RelationDeep['language']> = {}
    const ap = str(lang.appellation); if (ap) block.appellation = ap
    const cp = str(lang.catchphrases); if (cp) block.catchphrases = cp
    const em = str(lang.emoji); if (em) block.emoji = em
    const la = str(lang.latency); if (la) block.latency = la
    if (compact(block)) out.language = block
  }

  const sugs = arr(r.suggestions).map((e) => {
    const o = obj(e); if (!o) return {}
    const s: Suggestion = {}
    const t = str(o.topic); if (t) s.topic = t
    const p = str(o.problem); if (p) s.problem = p
    const a = str(o.advice); if (a) s.advice = a
    return s
  }).filter((s) => Object.keys(s).length > 0)
  if (sugs.length) out.suggestions = sugs

  return out
}
