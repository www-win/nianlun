// lunar-javascript 无官方 TS 类型，这里只声明本项目用到的最小子集。
declare module 'lunar-javascript' {
  export interface Lunar {
    getEightChar(): EightChar
    getYearShengXiao(): string
    getDayInGanZhi(): string
  }
  export interface EightChar {
    getYear(): string
    getMonth(): string
    getDay(): string
    getTime(): string
  }
  export interface Solar {
    getLunar(): Lunar
    getXingZuo(): string
  }
  export const Solar: {
    fromYmd(year: number, month: number, day: number): Solar
    fromYmdHms(year: number, month: number, day: number, hour: number, minute: number, second: number): Solar
  }
  export const Lunar: {
    fromDate(date: Date): Lunar
  }
}
