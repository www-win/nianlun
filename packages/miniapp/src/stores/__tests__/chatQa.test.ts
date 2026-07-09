import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createChatQaStore } from '../chatQa'
import { createDataStore } from '../data'
import type { ChatQaContext } from '@nianlun/core'

// 内存 storage/rawStore，喂给 data store，避免碰 wx
const memStorage = { loadFriends: () => [], loadReport: () => null } as any
const memRaw = {} as any

const emptyCtx: ChatQaContext = { statsSummary: '', samples: [], rawExcerpts: [] }

function setup(opts: {
  answer?: (...a: any[]) => Promise<string>
  retrieve?: (...a: any[]) => { context: ChatQaContext; wantedRaw: boolean; gotNamedMaterial: boolean }
} = {}) {
  const useData = createDataStore(memStorage, memRaw)
  const retrieval = { retrieve: opts.retrieve ?? (() => ({ context: emptyCtx, wantedRaw: false, gotNamedMaterial: false })) }
  const answer = opts.answer ?? (async () => '答案')
  return createChatQaStore({ useData, retrieval, answer })()
}

describe('chatQa store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('ask 追加用户轮和助理轮', async () => {
    const store = setup({ answer: async () => '你和张三聊了火锅。' })
    await store.ask('聊了啥')
    expect(store.messages).toEqual([
      { role: 'user', text: '聊了啥' },
      { role: 'assistant', text: '你和张三聊了火锅。' },
    ])
    expect(store.loading).toBe(false)
  })

  it('空问题不发起', async () => {
    const answer = vi.fn(async () => 'x')
    const store = setup({ answer })
    await store.ask('   ')
    expect(answer).not.toHaveBeenCalled()
    expect(store.messages).toHaveLength(0)
  })

  it('多轮：第二问把前面对话作为 history 传给 answer', async () => {
    const seen: any[] = []
    const answer = async (_q: string, history: any[]) => { seen.push(history); return 'ok' }
    const store = setup({ answer })
    await store.ask('张三是谁')
    await store.ask('那他呢')
    // 第二次调用的 history 含第一轮问答（不含刚追加的本轮问题）
    expect(seen[1].map((t: any) => t.text)).toEqual(['张三是谁', 'ok'])
  })

  it('点名但本机无原文 → 答案追加降级提示', async () => {
    const store = setup({
      answer: async () => '（基于样本）',
      retrieve: () => ({ context: emptyCtx, wantedRaw: true, gotNamedMaterial: false }),
    })
    await store.ask('张三说过啥')
    expect(store.messages[1].text).toContain('聊天素材')
  })

  it('answer 抛错 → 记 error 并追加出错助理轮', async () => {
    const store = setup({ answer: async () => { throw new Error('网络炸了') } })
    await store.ask('在吗')
    expect(store.error).toBe('网络炸了')
    expect(store.messages[1].text).toContain('网络炸了')
    expect(store.loading).toBe(false)
  })
})
