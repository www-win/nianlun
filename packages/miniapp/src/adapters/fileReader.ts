import { unzipSync, strFromU8 } from 'fflate'

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

/** 取路径最后一段作为文件名（目录项以 / 结尾，返回空串）。 */
const basename = (p: string) => p.split('/').pop() || ''

/**
 * 纯内存解压：输入 zip 字节，输出其中所有文本条目（name+content，name 去路径只留文件名）。
 * 只解压 TEXT_RE 匹配的条目、跳过图片等二进制（省内存）；解压全程不落盘，
 * 因此不受小程序沙箱 ~10MB 用户文件配额约束——这正是原生 unzip 大包必失败的根因。
 * 无可解析文本时抛错，错误里带上内含清单帮用户排查。
 */
export function unzipTextEntries(bytes: Uint8Array): { name: string; content: string }[] {
  const seen: string[] = []
  const files = unzipSync(bytes, {
    filter: (f) => {
      const b = basename(f.name)
      if (!b) return false            // 目录项，跳过
      seen.push(b)
      return TEXT_RE.test(f.name)
    },
  })
  const out: { name: string; content: string }[] = []
  for (const path of Object.keys(files)) {
    out.push({ name: basename(path), content: strFromU8(files[path]) })
  }
  if (out.length === 0) {
    const list = seen.length ? seen.slice(0, 20).join('、') : '（空）'
    throw new Error(`压缩包里没有可解析的文本文件（需 .csv/.json/.jsonl/.txt）。内含：${list}`)
  }
  return out
}

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
    // 顺手清掉历史遗留的原生解压副本（旧版本产物），释放沙箱配额；新路径全程不落盘。
    purgeUnzipTemp(fs, wx.env.USER_DATA_PATH)
    // 把 zip 读成二进制（不传 encoding → ArrayBuffer），交给纯 JS 解压库在内存里解，
    // 不再用原生 unzip 解压到磁盘，绕开 ~10MB 用户文件配额（大包必失败的根因）。
    fs.readFile({
      filePath: zipPath,
      success: (res) => {
        try {
          resolve(unzipTextEntries(new Uint8Array(res.data as ArrayBuffer)))
        } catch (e) {
          const msg = (e as Error).message
          // unzipTextEntries 的「没有可解析文本」错误已足够清楚，原样透出；其余归为解压失败。
          reject(new Error(msg.startsWith('压缩包') ? msg : `解压失败：${msg}`))
        }
      },
      fail: (err) => reject(new Error(`无法读取压缩包：${err.errMsg}`)),
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
