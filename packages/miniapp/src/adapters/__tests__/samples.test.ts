import { describe, it, expect } from 'vitest'
import { makeSamples } from '../samples'
import { makeStorage } from '../storage'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}

describe('samples 读取', () => {
  it('按 friend id 取样本，缺失返回空数组', () => {
    const s = memStorage()
    s.saveSamples({ f1: ['我：在吗', '对方：在'] })
    const sm = makeSamples(s)
    expect(sm.loadSamplesFor('f1')).toEqual(['我：在吗', '对方：在'])
    expect(sm.loadSamplesFor('nope')).toEqual([])
  })
})
