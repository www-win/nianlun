import type { MbtiCode } from '../model/types'

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
