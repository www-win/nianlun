export interface WxFileIO {
  choose(count: number): Promise<{ path: string; name: string }[]>
  read(path: string): Promise<string>
  /** 解压一个 zip，读出其中所有文本条目（CSV/JSON/TXT/HTML）。 */
  unzip(zipPath: string): Promise<{ name: string; content: string }[]>
}

const TEXT_RE = /\.(csv|json|jsonl|ndjson|txt|html?)$/i
const ZIP_RE = /\.zip$/i
// 微信只能解压 ZIP；这些压缩格式不支持，给出明确提示而非含糊的「无法识别」。
const OTHER_ARCHIVE_RE = /\.(rar|7z|tar|gz|tgz|bz2|xz)$/i

/** 递归删除所用的最小文件系统接口。 */
export interface DirFs {
  readdirSync(dir: string): string[]
  statSync(path: string): { isDirectory(): boolean }
  unlinkSync(path: string): void
  rmdirSync(dir: string, recursive?: boolean): void
}

/**
 * 可靠递归删除目录：先删文件、再自底向上删空目录，不依赖 rmdirSync 的 recursive
 * （真机/旧基础库对非空目录的递归删除不一定生效，会静默留下副本、累积撑满文件系统）。
 */
export function removeDirDeep(fs: DirFs, dir: string): void {
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return } // 目录不存在
  for (const name of names) {
    const p = `${dir}/${name}`
    try {
      if (fs.statSync(p).isDirectory()) removeDirDeep(fs, p)
      else fs.unlinkSync(p)
    } catch { /* 忽略单个失败，继续删其它 */ }
  }
  try { fs.rmdirSync(dir) } catch { /* 已空/已删，忽略 */ }
}

export function makeFileReader(io: WxFileIO) {
  return {
    async pickAndRead(count = 10): Promise<{ name: string; content: string }[]> {
      const files = await io.choose(count)
      const out: { name: string; content: string }[] = []
      for (const f of files) {
        if (ZIP_RE.test(f.name)) {
          out.push(...(await io.unzip(f.path)))
        } else if (OTHER_ARCHIVE_RE.test(f.name)) {
          const ext = (f.name.split('.').pop() || '').toLowerCase()
          throw new Error(`暂不支持 .${ext} 压缩包，微信小程序只能解压 ZIP。请改用 .zip 格式重新打包后再导入。`)
        } else {
          out.push({ name: f.name, content: await io.read(f.path) })
        }
      }
      return out
    },
  }
}

const wxIO: WxFileIO = {
  choose: (count) => new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count, type: 'file',
      success: (res) => resolve(res.tempFiles.map((t) => ({ path: t.path, name: t.name }))),
      fail: (err) => (/cancel/.test(err.errMsg) ? resolve([]) : reject(new Error(err.errMsg))),
    })
  }),
  read: (path) => new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path, encoding: 'utf8',
      success: (res) => resolve(res.data as string),
      fail: (err) => reject(new Error(`无法读取文件: ${err.errMsg}`)),
    })
  }),
  unzip: (zipPath) => new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager()
    // 解压前先清掉所有历史残留的解压副本：即便上次 cleanup 万一没删净，这次也从零开始，
    // 保证文件系统里最多只有本次一份解压内容，绝不累积撑满。
    purgeUnzipTemp(fs, wx.env.USER_DATA_PATH)
    const target = `${wx.env.USER_DATA_PATH}/nianlun_unzip_${Date.now()}`
    // 读完/失败都要删掉解压副本，否则每次导入都留一份几十 MB，累积撑爆文件系统。
    // 用逐层删除，不赌 rmdirSync 的 recursive（真机对非空目录不一定生效）。
    const cleanup = () => removeDirDeep(fs, target)
    fs.unzip({
      zipFilePath: zipPath, targetPath: target,
      success: () => {
        try {
          const out: { name: string; content: string }[] = []
          const seen: string[] = []
          const walk = (dir: string) => {
            for (const name of fs.readdirSync(dir)) {
              const p = `${dir}/${name}`
              if (fs.statSync(p).isDirectory()) walk(p)
              else {
                seen.push(name)
                if (TEXT_RE.test(name)) out.push({ name, content: fs.readFileSync(p, 'utf8') })
              }
            }
          }
          walk(target)
          if (out.length === 0) {
            const list = seen.length ? seen.slice(0, 20).join('、') : '（空）'
            cleanup()
            reject(new Error(`压缩包里没有可解析的文本文件（需 .csv/.json/.jsonl/.txt）。内含：${list}`))
          } else {
            cleanup() // 内容已读进内存，解压副本即可删除
            resolve(out)
          }
        } catch (e) {
          cleanup()
          reject(new Error(`读取压缩包内容失败：${(e as Error).message}`))
        }
      },
      fail: (err) => { cleanup(); reject(new Error(`解压失败：${err.errMsg}`)) },
    })
  }),
}

/**
 * 清掉 baseDir 下所有历史遗留的 `nianlun_unzip_*` 解压临时目录，返回清理个数。
 * 用可靠的逐层删除（不赌 rmdirSync 的 recursive）。容错：任何异常都吞掉。
 */
export function purgeUnzipTemp(fs: DirFs, baseDir: string): number {
  let n = 0
  let names: string[]
  try { names = fs.readdirSync(baseDir) } catch { return 0 } // baseDir 读不到
  for (const name of names) {
    if (name.startsWith('nianlun_unzip_')) { removeDirDeep(fs, `${baseDir}/${name}`); n++ }
  }
  return n
}

export const fileReader = makeFileReader(wxIO)
