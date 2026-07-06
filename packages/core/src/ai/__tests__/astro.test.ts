import { describe, it, expect } from 'vitest'
import type { Friend } from '../../model/types'
import type { BaziChart, DayFortune, Compatibility } from '../../astrology/types'
import {
  buildAstroPrompt, parseAstroReading, buildBirthExtractPrompt, parseBirthInfo,
} from '../astro'

const friend: Friend = {
  id: 'f1', name: '小美', alias: '', rel: '客户', role: '支行长',
  firstContact: 0, lastContact: 0, msgCount: 300, sentRatio: 55,
  peakPeriod: '晚上', maxStreak: 9, monthly: new Array(12).fill(0), userEdited: {},
  hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0), keywords: [],
}
const chart: BaziChart = {
  pillars: { year: '庚午', month: '甲申', day: '丙子', hour: '乙未' },
  dayMaster: '丙', fiveElements: { 木: 2, 火: 2, 土: 1, 金: 2, 水: 1 },
  zodiac: '马', constellation: '狮子',
}
const fortune: DayFortune = { ganzhi: '戊寅', relation: '泄' }
const compat: Compatibility = { harmonies: ['生肖六合（鼠 ↔ 牛）'], clashes: [] }

describe('buildAstroPrompt', () => {
  it('含好友名、盘数据、四段字段、免责/软化约束、"盘已算好"', () => {
    const p = buildAstroPrompt(friend, chart, fortune, compat)
    expect(p).toContain('小美')
    expect(p).toContain('丙子')
    expect(p).toContain('戊寅')
    expect(p).toContain('personality')
    expect(p).toContain('fortune')
    expect(p).toContain('affinity')
    expect(p).toContain('advice')
    expect(p).toContain('暂无足够线索')
    expect(p).toContain('已算好')
    expect(p).toContain('娱乐')
  })
  it('compat 为 null 也不抛', () => {
    expect(() => buildAstroPrompt(friend, chart, fortune, null)).not.toThrow()
  })
})

describe('parseAstroReading', () => {
  it('解析完整对象', () => {
    const r = parseAstroReading(JSON.stringify({
      personality: '性子急', fortune: '近期平稳', affinity: '与你相合', advice: '可正常往来',
    }))
    expect(r.personality).toBe('性子急')
    expect(r.advice).toBe('可正常往来')
  })
  it('剥围栏、缺字段省略、空串过滤', () => {
    expect(parseAstroReading('```json\n{"fortune":"顺"}\n```').fortune).toBe('顺')
    expect(parseAstroReading('{"personality":"  "}').personality).toBeUndefined()
  })
  it('垃圾输入返回 {}，不抛', () => {
    expect(parseAstroReading('不是 JSON')).toEqual({})
    expect(parseAstroReading('')).toEqual({})
  })
})

describe('buildBirthExtractPrompt / parseBirthInfo', () => {
  it('prompt 含好友名与样本、要求 JSON 生辰、无线索留空', () => {
    const p = buildBirthExtractPrompt(friend, ['我：你几号生日', '对方：我1990年8月15号的'])
    expect(p).toContain('小美')
    expect(p).toContain('1990年8月15号')
    expect(p).toContain('year')
    expect(p).toContain('未找到')
  })
  it('解析有效生辰', () => {
    const b = parseBirthInfo(JSON.stringify({ year: 1990, month: 8, day: 15, hour: 14, gender: 'female' }))
    expect(b).toEqual({ year: 1990, month: 8, day: 15, hour: 14, gender: 'female' })
  })
  it('缺年月日/超范围/垃圾输入返回 null', () => {
    expect(parseBirthInfo(JSON.stringify({ year: 1990, month: 8 }))).toBeNull()
    expect(parseBirthInfo(JSON.stringify({ year: 1990, month: 13, day: 1 }))).toBeNull()
    expect(parseBirthInfo('不是 JSON')).toBeNull()
  })
})
