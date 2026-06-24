import { describe, it, expect } from 'vitest'
import { parseJsonBackup, parseCsvBackup } from '../backup'

describe('backup parsers', () => {
  it('parses json backup into Friend[]', () => {
    const json = JSON.stringify([
      { name: '周彤', alias: '老周', rel: '挚友', role: '大学室友', msgCount: 9670, sentRatio: 49 },
    ])
    const friends = parseJsonBackup(json)
    expect(friends).toHaveLength(1)
    expect(friends[0].name).toBe('周彤')
    expect(friends[0].rel).toBe('挚友')
    expect(friends[0].msgCount).toBe(9670)
    expect(friends[0].userEdited.rel).toBe('挚友') // 回导值视为用户已确认
  })

  it('parses csv backup into Friend[]', () => {
    const csv = '昵称,备注,关系,职务,首次联系,最近联系,消息数,我发出%\n周彤,老周,挚友,大学室友,2014-09,3 天前,9670,49'
    const friends = parseCsvBackup(csv)
    expect(friends).toHaveLength(1)
    expect(friends[0].alias).toBe('老周')
    expect(friends[0].role).toBe('大学室友')
    expect(friends[0].msgCount).toBe(9670)
  })
})
