/** 生辰下拉选择工具：十二时辰 ↔ hour 映射、日期串拆合。纯函数，无副作用。 */

/** 下拉标签，index 0 为「不确定」，1..12 对应子..亥。 */
export const SHICHEN_LABELS: readonly string[] = [
  '不确定',
  '子时 (23-1)', '丑时 (1-3)', '寅时 (3-5)', '卯时 (5-7)',
  '辰时 (7-9)', '巳时 (9-11)', '午时 (11-13)', '未时 (13-15)',
  '申时 (15-17)', '酉时 (17-19)', '戌时 (19-21)', '亥时 (21-23)',
]

/** 子..亥的代表 hour；经内核 floor((hour+1)/2)%12 排盘正好落回对应时辰。 */
const SHICHEN_HOURS = [0, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]

/** 下拉 index → 存储 hour；index 0（不确定）或越界返回 undefined。 */
export function shichenIndexToHour(index: number): number | undefined {
  if (!Number.isInteger(index) || index <= 0 || index > 12) return undefined
  return SHICHEN_HOURS[index - 1]
}

/** 存储 hour → 下拉 index（0..12）；undefined/非有限返回 0（不确定）。 */
export function hourToShichenIndex(hour: number | undefined): number {
  if (hour == null || !Number.isFinite(hour)) return 0
  const h = ((Math.trunc(hour) % 24) + 24) % 24
  const branch = Math.floor((h + 1) / 2) % 12  // 0=子 .. 11=亥
  return branch + 1
}

/** 年月日 → "YYYY-MM-DD"（补零）。 */
export function toDateStr(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/** "YYYY-MM-DD" → 年月日；非法格式返回 null。 */
export function fromDateStr(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

/** 从任意文本（昵称/备注）识别公历生日；识别不到返回 null。只认带分隔符/年月日的日期。 */
export function parseBirthFromText(text: string): { year: number; month: number; day: number } | null {
  const m = /(\d{2,4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?/.exec(text)
  if (!m) return null
  let year = Number(m[1])
  const month = Number(m[2]), day = Number(m[3])
  if (m[1].length === 2) year = year >= 30 ? 1900 + year : 2000 + year
  else if (m[1].length !== 4) return null   // 1 或 3 位年份视为不合法
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}
