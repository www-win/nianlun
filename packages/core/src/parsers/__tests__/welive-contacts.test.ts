import { describe, it, expect } from 'vitest'
import { parseWeliveContacts, isWeliveContacts } from '../welive-contacts'

// 真实 welive contacts.json 的脱敏样本（字段顺序与真实导出一致）
const entry = (o: Record<string, unknown>) => ({
  username: '', user_name: '', encrypt_username: '', encrypt_user_name: '',
  remark: '', nick_name: '', alias: '', local_type: 1, quan_pin: '', extra_buffer: '',
  ...o,
})

describe('isWeliveContacts', () => {
  it('accepts a welive contacts array sample', () => {
    const sample = JSON.stringify([entry({ username: 'wxid_a', nick_name: '昵称' })])
    expect(isWeliveContacts(sample)).toBe(true)
  })
  it('accepts with a leading BOM', () => {
    const sample = '﻿' + JSON.stringify([entry({ username: 'wxid_a', remark: '备注' })])
    expect(isWeliveContacts(sample)).toBe(true)
  })
  it('rejects a welive chat jsonl line (object, not contacts)', () => {
    const line = JSON.stringify({ sort_seq: '1', create_time: '1', local_type: '1', sender_username: 'wxid_a' })
    expect(isWeliveContacts(line)).toBe(false)
  })
  it('rejects a nianlun friend-backup array', () => {
    const backup = JSON.stringify([{ name: '张三', rel: '同事', msgCount: 10 }])
    expect(isWeliveContacts(backup)).toBe(false)
  })
})

describe('parseWeliveContacts', () => {
  it('prefers remark over nick_name for private contacts', () => {
    const content = JSON.stringify([
      entry({ username: 'wxid_a', remark: '张兴国', nick_name: '兴星睡了' }),
      entry({ username: 'wxid_b', remark: '', nick_name: '海成' }),
    ])
    const map = parseWeliveContacts(content)
    expect(map).toContainEqual({ id: 'wxid_a', name: '张兴国' })
    expect(map).toContainEqual({ id: 'wxid_b', name: '海成' })
  })
  it('uses nick_name as group name for chatrooms', () => {
    const content = JSON.stringify([
      entry({ username: '25032865050@chatroom', remark: '', nick_name: '校园集市燕大24站', local_type: 1 }),
    ])
    expect(parseWeliveContacts(content)).toContainEqual({ id: '25032865050@chatroom', name: '校园集市燕大24站' })
  })
  it('skips entries with no usable name', () => {
    const content = JSON.stringify([
      entry({ username: 'wxid_noname', remark: '', nick_name: '' }),
      entry({ username: 'wxid_ok', nick_name: '有名' }),
    ])
    const map = parseWeliveContacts(content)
    expect(map).toHaveLength(1)
    expect(map[0]).toEqual({ id: 'wxid_ok', name: '有名' })
  })
  it('skips entries with no username', () => {
    const content = JSON.stringify([entry({ username: '', nick_name: '没有id' })])
    expect(parseWeliveContacts(content)).toHaveLength(0)
  })
  it('trims whitespace in names', () => {
    const content = JSON.stringify([entry({ username: 'wxid_a', remark: '  小明  ' })])
    expect(parseWeliveContacts(content)[0]).toEqual({ id: 'wxid_a', name: '小明' })
  })
  it('returns [] on invalid JSON, never throws', () => {
    expect(parseWeliveContacts('[ not json')).toEqual([])
  })
  it('strips a leading BOM before parsing', () => {
    const content = '﻿' + JSON.stringify([entry({ username: 'wxid_a', nick_name: '甲' })])
    expect(parseWeliveContacts(content)).toContainEqual({ id: 'wxid_a', name: '甲' })
  })
})
