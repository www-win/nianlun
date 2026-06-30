import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { makeStorage } from '../../adapters/storage'
import { createDataStore } from '../data'
import { createImportStore } from '../import'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}
const TXT = `2025-03-01 09:00:00 李四\n早\n\n2025-03-01 09:01:00 我\n早呀`

describe('import store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('run 解析并写入 data store，status 变 done', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    expect(imp.status).toBe('done')
    expect(useData().friends.length).toBe(1)
    const saved = s.loadSamples()
    expect(Object.keys(saved).length).toBe(1)
    const only = Object.values(saved)[0]
    expect(Array.isArray(only)).toBe(true)
    expect(only.length).toBeGreaterThan(0)
  })

  it('无法识别文件时 warnings 非空但不抛、status 仍 done', async () => {
    const s = memStorage()
    const useImport = createImportStore({ useData: createDataStore(s), storage: s })
    const imp = useImport()
    await imp.run([{ name: 'x.bin', content: '###' }], 2025)
    expect(imp.status).toBe('done')
    expect(imp.warnings.length).toBeGreaterThan(0)
  })

  it('导入 contacts.json 给已有好友套用真实名字', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    const fid = useData().friends[0].id
    // welive contacts.json：username → nick_name（群名）/ remark
    const contacts = `[{"username":"${fid}","nick_name":"真名群","local_type":2}]`
    await imp.run([{ name: 'contacts.json', content: contacts }], 2025)
    expect(useData().friends[0].name).toBe('真名群')
    expect(useData().report?.totalMessages).toBeGreaterThan(0) // 报告不被联系人导入清零
    expect(imp.warnings.some((w) => w.includes('已套用'))).toBe(true)
  })

  it('第二次导入空/不可识别文件不会清零已有报告，且报告与好友列表一致', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s })
    const imp = useImport()
    // 先导入有效聊天 → 报告应有消息数
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    const friendMsgs = useData().friends[0].msgCount
    expect(useData().report?.totalMessages).toBe(friendMsgs)
    expect(useData().report?.friendCount).toBe(1)
    // 再导入一个解析不出聊天的文件 → 好友与报告数字都应保住，不被清零
    await imp.run([{ name: 'x.bin', content: '###' }], 2025)
    expect(useData().friends.length).toBe(1)
    expect(useData().report?.totalMessages).toBe(friendMsgs)
    expect(useData().report?.friendCount).toBe(1)
  })
})
