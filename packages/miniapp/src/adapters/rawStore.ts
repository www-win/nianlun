import { isServiceSession, sessionIdFromFileName } from '@nianlun/core'

/** 导入的原始聊天文件（名字 + 原文），供将来二级分析重解析。 */
export interface RawChatFile { name: string; content: string }

/** 文件系统后端抽象：真机用 wx.getFileSystemManager()，测试注入内存实现。 */
export interface RawFsBackend {
  ensureDir(dir: string): void
  writeFile(path: string, data: string): void
  readFile(path: string): string
  readdir(dir: string): string[]
  size(path: string): number
  unlink(path: string): void
  exists(path: string): boolean
}

// 文件名清洗：去掉路径分隔符与上跳，避免写到目录外
function safeName(name: string): string {
  return name.replace(/[\\/]/g, '_').replace(/\.\./g, '_')
}

export function makeRawStore(fs: RawFsBackend, baseDir: string) {
  const path = (name: string) => `${baseDir}/${safeName(name)}`

  return {
    /** 直写（覆盖式，不过滤）——基础存取，供测试与内部复用。 */
    write(files: RawChatFile[]): void {
      fs.ensureDir(baseDir)
      for (const f of files) fs.writeFile(path(f.name), f.content)
    },
    /**
     * 留存原文：跳过公众号/系统会话；逐个写入，写满(异常)即停并计入 skipped，绝不抛。
     * 供导入流程在核心数据存好后调用。
     */
    appendFiles(files: RawChatFile[]): { saved: number; skipped: number } {
      fs.ensureDir(baseDir)
      let saved = 0
      let skipped = 0
      const keep = files.filter((f) => !isServiceSession(sessionIdFromFileName(f.name)))
      for (let i = 0; i < keep.length; i++) {
        try {
          fs.writeFile(path(keep[i].name), keep[i].content)
          saved++
        } catch {
          skipped = keep.length - i // 剩余全部算跳过
          break
        }
      }
      return { saved, skipped }
    },
    count(): number {
      return fs.readdir(baseDir).length
    },
    list(): { name: string; size: number }[] {
      return fs.readdir(baseDir).map((name) => ({ name, size: fs.size(`${baseDir}/${name}`) }))
    },
    read(name: string): string {
      try { return fs.readFile(path(name)) } catch { return '' }
    },
    readAll(): RawChatFile[] {
      return fs.readdir(baseDir).map((name) => {
        try { return { name, content: fs.readFile(`${baseDir}/${name}`) } } catch { return { name, content: '' } }
      })
    },
    clear(): void {
      for (const name of fs.readdir(baseDir)) fs.unlink(`${baseDir}/${name}`)
    },
  }
}

// 懒加载真机实现：不能在模块顶层求值 wx.env.USER_DATA_PATH ——
// data.ts/import.ts 会无条件 import 本模块，若在此处立即访问 wx 全局对象，
// 单元测试(node 环境、无 wx 全局)在收集用例阶段就会抛 ReferenceError，
// 波及所有引入 data/import store 的测试文件。与 storage.ts/aiClient.ts/
// fileReader.ts 中"wx 只在函数体内被引用"的既有约定保持一致。
let cachedRawStore: ReturnType<typeof makeRawStore> | undefined
function realRawStore(): ReturnType<typeof makeRawStore> {
  if (!cachedRawStore) {
    const dir = `${wx.env.USER_DATA_PATH}/nianlun_raw`
    const fsm = () => wx.getFileSystemManager()
    const wxRawFs: RawFsBackend = {
      ensureDir: (d) => { try { fsm().accessSync(d) } catch { fsm().mkdirSync(d, true) } },
      writeFile: (p, data) => fsm().writeFileSync(p, data, 'utf8'),
      readFile: (p) => fsm().readFileSync(p, 'utf8'),
      readdir: (d) => { try { return fsm().readdirSync(d) } catch { return [] } },
      size: (p) => { try { return fsm().statSync(p).size } catch { return 0 } },
      unlink: (p) => { try { fsm().unlinkSync(p) } catch { /* 已不存在 */ } },
      exists: (p) => { try { fsm().accessSync(p); return true } catch { return false } },
    }
    cachedRawStore = makeRawStore(wxRawFs, dir)
  }
  return cachedRawStore
}

/** 真机单例：方法调用时才懒加载真实 wx 文件系统实现，模块加载本身不触碰 wx。 */
export const rawStore: ReturnType<typeof makeRawStore> = {
  write: (files) => realRawStore().write(files),
  appendFiles: (files) => realRawStore().appendFiles(files),
  count: () => realRawStore().count(),
  list: () => realRawStore().list(),
  read: (name) => realRawStore().read(name),
  readAll: () => realRawStore().readAll(),
  clear: () => realRawStore().clear(),
}
