import { describe, it, expect } from 'vitest'
import { tokenize, countWords } from '../segment'

describe('tokenize', () => {
  it('切出中文词，过滤单字、标点、数字与停用词', () => {
    const words = tokenize('我今天去公司开会了，123 哈哈')
    expect(words).toContain('今天')
    expect(words).toContain('公司')
    expect(words).toContain('开会')
    expect(words).not.toContain('我')   // 停用词
    expect(words).not.toContain('了')   // 单字 + 停用词
    expect(words).not.toContain('，')   // 标点
    expect(words).not.toContain('123')  // 纯数字
  })

  it('保留长度≥2的英文词', () => {
    expect(tokenize('ok deadline')).toContain('deadline')
  })
})

describe('countWords', () => {
  it('累计计数并按降序取 topN', () => {
    const top = countWords(['开会 开会 吃饭', '开会 吃饭'], 1)
    expect(top).toEqual([{ word: '开会', count: 3 }])
  })
})
