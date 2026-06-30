export interface WxFileIO {
  choose(count: number): Promise<{ path: string; name: string }[]>
  read(path: string): Promise<string>
  /** 解压一个 zip，读出其中所有文本条目（CSV/JSON/TXT/HTML）。 */
  unzip(zipPath: string): Promise<{ name: string; content: string }[]>
}

const TEXT_RE = /\.(csv|json|txt|html?)$/i
const ZIP_RE = /\.zip$/i
// 微信只能解压 ZIP；这些压缩格式不支持，给出明确提示而非含糊的「无法识别」。
const OTHER_ARCHIVE_RE = /\.(rar|7z|tar|gz|tgz|bz2|xz)$/i

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
    const target = `${wx.env.USER_DATA_PATH}/nianlun_unzip_${Date.now()}`
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
            reject(new Error(`压缩包里没有可解析的文本文件（需 .csv/.json/.txt）。内含：${list}`))
          } else {
            resolve(out)
          }
        } catch (e) {
          reject(new Error(`读取压缩包内容失败：${(e as Error).message}`))
        }
      },
      fail: (err) => reject(new Error(`解压失败：${err.errMsg}`)),
    })
  }),
}

export const fileReader = makeFileReader(wxIO)
