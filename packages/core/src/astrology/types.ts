/** 生辰(用户填 / AI 抽取后确认)。公历默认；isLunar 时按农历输入。 */
export interface BirthInfo {
  year: number
  month: number
  day: number
  hour?: number          // 时辰 0–23，可选；缺则八字无时柱，只出三柱
  isLunar?: boolean
  gender?: 'male' | 'female'
}

/** 确定性排盘结果。 */
export interface BaziChart {
  pillars: { year: string; month: string; day: string; hour?: string }  // 四柱干支(两字)
  dayMaster: string                       // 日主天干(日柱第一个字)
  fiveElements: Record<string, number>    // 五行分布：木火土金水计数
  zodiac: string                          // 生肖
  constellation: string                   // 西洋星座
}

/** 流月/流日：某日期的干支与它对本命日主的生克。 */
export interface DayFortune {
  ganzhi: string                          // 当日干支
  relation: string                        // 生/克/比/泄/耗/平
}

/** 合盘(我 × 好友)：机械判定的刑冲合害。 */
export interface Compatibility {
  harmonies: string[]                     // 六合/三合等相合
  clashes: string[]                       // 相冲/相刑/相害 —— "冲课"落在这里
}
