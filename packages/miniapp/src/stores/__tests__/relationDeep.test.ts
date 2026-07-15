import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createRelationDeepStore } from '../relationDeep'
import type { Friend, RelationDeep } from '@nianlun/core'

const friend = (id: string) => ({ id, name: id } as unknown as Friend)

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function setup(ai: (f: Friend, s: string[]) => Promise<RelationDeep>) {
  const saveRelationDeep = vi.fn()
  const store = createRelationDeepStore({ ai, storage: { saveRelationDeep }, tick: 10 })()
  return { store, saveRelationDeep }
}

describe('relationDeep store', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('start 设 activeId、runningFor 命中、busy', () => {
    const { store } = setup(() => deferred<RelationDeep>().promise)
    const r = store.start(friend('a'), [])
    expect(r).toBe('started')
    expect(store.activeId).toBe('a')
    expect(store.runningFor('a')).toBe(true)
    expect(store.runningFor('b')).toBe(false)
    expect(store.busy).toBe(true)
  })

  it('正在跑时再 start 另一好友 → busy、不调 ai 第二次', () => {
    const ai = vi.fn(() => deferred<RelationDeep>().promise)
    const { store } = setup(ai)
    store.start(friend('a'), [])
    const r = store.start(friend('b'), [])
    expect(r).toBe('busy')
    expect(store.activeId).toBe('a')
    expect(ai).toHaveBeenCalledTimes(1)
  })

  it('成功：落盘、completion=ok、清 activeId', async () => {
    const d = deferred<RelationDeep>()
    const { store, saveRelationDeep } = setup(() => d.promise)
    const f = friend('a')
    store.start(f, ['s1'])
    d.resolve({ overall: '整体不错' })
    await vi.waitFor(() => expect(store.completion?.status).toBe('ok'))
    expect(saveRelationDeep).toHaveBeenCalledWith('a', f, { overall: '整体不错' })
    expect(store.completion).toEqual({ id: 'a', status: 'ok' })
    expect(store.activeId).toBe(null)
    expect(store.progress).toBe(100)
  })

  it('空结果：不落盘、completion=empty', async () => {
    const d = deferred<RelationDeep>()
    const { store, saveRelationDeep } = setup(() => d.promise)
    store.start(friend('a'), [])
    d.resolve({})
    await vi.waitFor(() => expect(store.completion?.status).toBe('empty'))
    expect(saveRelationDeep).not.toHaveBeenCalled()
    expect(store.completion).toEqual({ id: 'a', status: 'empty' })
    expect(store.activeId).toBe(null)
  })

  it('异常：completion=error 带 message、不落盘', async () => {
    const d = deferred<RelationDeep>()
    const { store, saveRelationDeep } = setup(() => d.promise)
    store.start(friend('a'), [])
    d.reject(new Error('上游挂了'))
    await vi.waitFor(() => expect(store.completion?.status).toBe('error'))
    expect(store.completion).toEqual({ id: 'a', status: 'error', message: '上游挂了' })
    expect(saveRelationDeep).not.toHaveBeenCalled()
    expect(store.activeId).toBe(null)
  })
})
