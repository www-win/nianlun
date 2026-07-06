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
