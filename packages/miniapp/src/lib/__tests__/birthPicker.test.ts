import { describe, it, expect } from 'vitest'
import {
  SHICHEN_LABELS,
  shichenIndexToHour,
  hourToShichenIndex,
  toDateStr,
  fromDateStr,
  parseBirthFromText,
} from '../birthPicker'

describe('SHICHEN_LABELS', () => {
  it('共 13 项，首项为不确定', () => {
    expect(SHICHEN_LABELS).toHaveLength(13)
    expect(SHICHEN_LABELS[0]).toBe('请手动输入')
    expect(SHICHEN_LABELS[1]).toContain('子时')
    expect(SHICHEN_LABELS[12]).toContain('亥时')
  })
})

describe('shichenIndexToHour', () => {
  it('index 0（不确定）返回 undefined', () => {
    expect(shichenIndexToHour(0)).toBeUndefined()
  })
  it('越界返回 undefined', () => {
    expect(shichenIndexToHour(-1)).toBeUndefined()
    expect(shichenIndexToHour(13)).toBeUndefined()
  })
  it('12 时辰映射到代表 hour', () => {
    const hours = [0, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]
    hours.forEach((h, i) => expect(shichenIndexToHour(i + 1)).toBe(h))
  })
})

describe('hourToShichenIndex', () => {
  it('undefined / 非有限返回 0', () => {
    expect(hourToShichenIndex(undefined)).toBe(0)
    expect(hourToShichenIndex(NaN)).toBe(0)
  })
  it('与内核 floor((hour+1)/2)%12 一致：hour 0 与 23 都归子时(index 1)', () => {
    expect(hourToShichenIndex(0)).toBe(1)
    expect(hourToShichenIndex(23)).toBe(1)
    expect(hourToShichenIndex(14)).toBe(8)  // 未时
  })
  it('12 时辰往返幂等：index -> hour -> index', () => {
    for (let idx = 1; idx <= 12; idx++) {
      const h = shichenIndexToHour(idx)!
      expect(hourToShichenIndex(h)).toBe(idx)
    }
  })
})

describe('toDateStr / fromDateStr', () => {
  it('补零成 YYYY-MM-DD', () => {
    expect(toDateStr(1990, 8, 5)).toBe('1990-08-05')
    expect(toDateStr(2000, 12, 31)).toBe('2000-12-31')
  })
  it('解析合法日期串，非法返回 null', () => {
    expect(fromDateStr('1990-08-05')).toEqual({ year: 1990, month: 8, day: 5 })
    expect(fromDateStr('')).toBeNull()
    expect(fromDateStr('1990/08/05')).toBeNull()
  })
  it('拆合往返一致', () => {
    const s = toDateStr(1988, 2, 29)
    expect(fromDateStr(s)).toEqual({ year: 1988, month: 2, day: 29 })
  })
})

describe('parseBirthFromText', () => {
  it('从昵称中挑出生日，忽略无关文字', () => {
    expect(parseBirthFromText('月恒 95.1.8己亥')).toEqual({ year: 1995, month: 1, day: 8 })
  })
  it('支持多种分隔符与年月日写法', () => {
    expect(parseBirthFromText('1995.1.8')).toEqual({ year: 1995, month: 1, day: 8 })
    expect(parseBirthFromText('1995-1-8')).toEqual({ year: 1995, month: 1, day: 8 })
    expect(parseBirthFromText('1995/1/8')).toEqual({ year: 1995, month: 1, day: 8 })
    expect(parseBirthFromText('1995年1月8日')).toEqual({ year: 1995, month: 1, day: 8 })
  })
  it('两位数年份以 30 为界推断世纪', () => {
    expect(parseBirthFromText('95.1.8')).toEqual({ year: 1995, month: 1, day: 8 })
    expect(parseBirthFromText('08.3.5')).toEqual({ year: 2008, month: 3, day: 5 })
    expect(parseBirthFromText('29.12.31')).toEqual({ year: 2029, month: 12, day: 31 })
    expect(parseBirthFromText('30.1.1')).toEqual({ year: 1930, month: 1, day: 1 })
  })
  it('非法与纯数字串返回 null', () => {
    expect(parseBirthFromText('19950108')).toBeNull()   // 无分隔纯数字不解析
    expect(parseBirthFromText('2.0.1')).toBeNull()       // year 仅 1 位
    expect(parseBirthFromText('95.13.8')).toBeNull()     // 月非法
    expect(parseBirthFromText('95.1.40')).toBeNull()     // 日非法
    expect(parseBirthFromText('无生日的昵称')).toBeNull()
  })
})
