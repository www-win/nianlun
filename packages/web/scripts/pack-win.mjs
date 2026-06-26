import { createWriteStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'

export const PORT = 8723

export const LAUNCHER = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 年轮（运行中 — 用完关闭此窗口即可停止）
echo.
echo   年轮已启动，正在打开浏览器…
echo   地址：http://127.0.0.1:${PORT}
echo.
echo   用完后：关闭浏览器，再关闭此窗口即可停止。
echo ============================================================
start "" /b cmd /c "ping -n 2 127.0.0.1 >nul & start """" http://127.0.0.1:${PORT}"
"%~dp0server\\sws.exe" --host 127.0.0.1 --port ${PORT} --root "%~dp0app" --page-fallback "%~dp0app\\index.html"
`

export const README = `年轮 · 使用说明（Windows）
================================

1. 双击本压缩包，把里面的“年轮”文件夹解压出来（建议放到桌面）。
2. 进入“年轮”文件夹，双击 “启动.bat”。
3. 【首次使用】如果弹出蓝色窗口“Windows 已保护你的电脑”：
   - 点窗口里的 “更多信息”
   - 再点 “仍要运行”
   （这是 Windows 对未签名小程序的统一提示，不是病毒，仅第一次需要这样。）
4. 浏览器会自动打开 http://127.0.0.1:${PORT} ，开始使用。
5. 用完后：关闭浏览器标签页，再关闭那个黑色小窗口即可停止。

说明：本工具完全在你的电脑本地运行，不联网、不上传任何聊天数据。
`

export async function buildWinZip({ distDir, serverDir, outFile, rootName = '年轮' }) {
  const exe = join(serverDir, 'sws.exe')
  if (!existsSync(exe)) {
    throw new Error(`缺少服务器二进制（需 sws.exe）：${serverDir}`)
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error(`dist 未构建（缺 index.html）：${distDir}`)
  }

  const output = createWriteStream(outFile)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
  })
  archive.pipe(output)

  archive.append(LAUNCHER, { name: `${rootName}/启动.bat` })
  archive.append(README, { name: `${rootName}/使用说明.txt` })
  archive.file(exe, { name: `${rootName}/server/sws.exe` })
  archive.directory(distDir, `${rootName}/app`)

  await archive.finalize()
  await done
  return outFile
}

// CLI：node scripts/pack-win.mjs  （从 packages/web 目录运行）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const distDir = join(process.cwd(), 'dist')
  const serverDir = join(process.cwd(), 'scripts', 'server')
  const outFile = join(process.cwd(), '年轮-windows.zip')
  buildWinZip({ distDir, serverDir, outFile })
    .then((p) => console.log(`已生成：${p}`))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
