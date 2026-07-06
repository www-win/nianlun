import { describe, it, expect } from 'vitest'
import * as core from '../index'

describe('core 入口导出会话判定函数', () => {
  it('导出 isServiceSession 且逻辑正确', () => {
    expect(typeof core.isServiceSession).toBe('function')
    expect(core.isServiceSession('gh_abc')).toBe(true)
    expect(core.isServiceSession('wxid_x')).toBe(false)
  })
  it('导出 sessionIdFromFileName 且逻辑正确', () => {
    expect(typeof core.sessionIdFromFileName).toBe('function')
    expect(core.sessionIdFromFileName('17657663110@chatroom_00000001.jsonl'))
      .toBe('17657663110@chatroom')
  })
})
