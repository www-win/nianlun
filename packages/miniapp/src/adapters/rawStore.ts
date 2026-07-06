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
