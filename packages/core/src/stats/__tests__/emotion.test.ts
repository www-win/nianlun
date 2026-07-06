import { describe, it, expect } from 'vitest'
import { scoreMessage, classify, toValue, wordPolarity } from '../emotion'
import {
  emptyAcc, addToAcc, finalizeAcc, accToMood, mergeDist, mergeMood, mergeEmotion,
} from '../emotion'
import type { EmotionDist, FriendEmotion } from '../../model/types'

describe('scoreMessage', () => {
  it('正面词得正分', () => {
    expect(scoreMessage('今天好开心谢谢你')).toBeGreaterThan(0)
  })
  it('负面词得负分', () => {
    expect(scoreMessage('好难受心情烦')).toBeLessThan(0)
  })
  it('正面 emoji 加正分', () => {
    expect(scoreMessage('😄')).toBeGreaterThan(0)
    expect(scoreMessage('😭')).toBeLessThan(0)
  })
  it('哈哈哈算正、呜呜呜算负', () => {
    expect(scoreMessage('哈哈哈哈')).toBeGreaterThan(0)
    expect(scoreMessage('呜呜呜')).toBeLessThan(0)
  })
  it('否定词翻转极性：不开心 → 负', () => {
    expect(scoreMessage('我不开心')).toBeLessThan(0)
  })
  it('「别烦」作为整词命中，不被内部「烦」的否定翻转抵消 → 负', () => {
    expect(scoreMessage('别烦你')).toBeLessThan(0)
    expect(scoreMessage('你别烦我')).toBeLessThan(0)
  })
  it('子串不重复计分：太棒了(+2) 不叠加内部「棒」(+1)', () => {
    // 最长优先、不重叠扫描后「太棒了」仅计强烈正词单次权重(+2)，
    // 上界 2 验证子串「棒」不再重复叠加（旧实现会得 +3）。
    expect(scoreMessage('太棒了')).toBeLessThanOrEqual(2)
    expect(scoreMessage('太棒了')).toBeGreaterThan(0)
  })
  it('感叹号放大同号强度', () => {
    expect(Math.abs(scoreMessage('太棒了！！！'))).toBeGreaterThan(Math.abs(scoreMessage('太棒了')))
  })
  it('空串/纯符号得 0，永不抛异常', () => {
    expect(scoreMessage('')).toBe(0)
    expect(scoreMessage('。。。')).toBe(0)
  })
})

describe('classify', () => {
  it('按 ±0.5 阈值分三档', () => {
    expect(classify(1)).toBe('开心')
    expect(classify(-1)).toBe('难过')
    expect(classify(0)).toBe('平淡')
    expect(classify(0.5)).toBe('平淡')   // 边界不含
  })
})

describe('toValue', () => {
  it('中性 raw=0 → 0.5', () => {
    expect(toValue(0)).toBeCloseTo(0.5)
  })
  it('强正 → 趋近 1，强负 → 趋近 0，且落在 [0,1]', () => {
    expect(toValue(10)).toBeCloseTo(1)
    expect(toValue(-10)).toBeCloseTo(0)
    expect(toValue(3)).toBeGreaterThan(0.5)
    expect(toValue(-3)).toBeLessThan(0.5)
  })
})

describe('wordPolarity', () => {
  it('正词>0、负词<0、未收录=0', () => {
    expect(wordPolarity('开心')).toBeGreaterThan(0)
    expect(wordPolarity('难受')).toBeLessThan(0)
    expect(wordPolarity('桌子')).toBe(0)
  })
})

describe('DistAcc 聚合', () => {
  it('累加后 finalize：计数分档 + avg 为各条 value 均值', () => {
    const acc = emptyAcc()
    addToAcc(acc, 2)    // 开心
    addToAcc(acc, 0)    // 平淡
    addToAcc(acc, -2)   // 难过
    const d = finalizeAcc(acc)
    expect(d).toMatchObject({ happy: 1, neutral: 1, sad: 1, total: 3 })
    expect(d.avg).toBeCloseTo(0.5)   // 对称 → 0.5
  })
  it('空 acc → total 0、avg 0.5', () => {
    expect(finalizeAcc(emptyAcc())).toMatchObject({ total: 0, avg: 0.5 })
  })
  it('accToMood：空返回 null，非空返回 {avg,count}', () => {
    expect(accToMood(emptyAcc())).toBeNull()
    const acc = emptyAcc(); addToAcc(acc, 2)
    expect(accToMood(acc)).toMatchObject({ count: 1 })
  })
})

describe('mergeDist / mergeMood', () => {
  it('mergeDist：计数相加、avg 按 total 加权', () => {
    const a: EmotionDist = { happy: 2, neutral: 0, sad: 0, total: 2, avg: 1 }
    const b: EmotionDist = { happy: 0, neutral: 0, sad: 2, total: 2, avg: 0 }
    const m = mergeDist(a, b)
    expect(m).toMatchObject({ happy: 2, sad: 2, total: 4 })
    expect(m.avg).toBeCloseTo(0.5)
  })
  it('mergeMood：一侧 null 取另一侧；都在则条数加权', () => {
    expect(mergeMood(null, { avg: 0.8, count: 3 })).toMatchObject({ avg: 0.8, count: 3 })
    expect(mergeMood({ avg: 1, count: 1 }, { avg: 0, count: 3 })!.avg).toBeCloseTo(0.25)
    expect(mergeMood(null, null)).toBeNull()
  })
})

describe('mergeEmotion', () => {
  it('me/them 合并、monthly 逐月合并、words 用新 keywords 重算极性', () => {
    const mk = (avg: number): FriendEmotion => ({
      me: { happy: 1, neutral: 0, sad: 0, total: 1, avg },
      them: { happy: 0, neutral: 1, sad: 0, total: 1, avg: 0.5 },
      monthly: { me: [{ avg, count: 1 }, ...Array(11).fill(null)], them: Array(12).fill(null) },
      words: [],
    })
    const merged = mergeEmotion(mk(1), mk(0), [{ word: '开心', count: 5 }, { word: '桌子', count: 2 }])
    expect(merged.me.total).toBe(2)
    expect(merged.me.avg).toBeCloseTo(0.5)
    expect(merged.monthly.me[0]).toMatchObject({ count: 2 })
    expect(merged.words.find((w) => w.word === '开心')!.polarity).toBeGreaterThan(0)
    expect(merged.words.find((w) => w.word === '桌子')!.polarity).toBe(0)
  })
})
