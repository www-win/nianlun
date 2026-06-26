import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { ZipArchive } from 'archiver'

export const PORT = 8723

// 启动脚本：注入端口/AI 地址/app 路径，用捆绑的 node.exe 运行本地服务器。
export function buildLauncher(aiBaseUrl, port = PORT) {
  // 批处理内容必须为纯 ASCII：中文版 Windows 的 cmd 按 GBK 解析 .bat，
  // 文件里若含 UTF-8 中文会乱码并打乱行结构（导致 set/URL 行被拆坏）。
  // 中文说明放在「使用说明.txt」里（不执行，不受影响）。
  return `@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Nianlun (running - close this window to stop)
set "PORT=${port}"
set "HOST=127.0.0.1"
set "APP_ROOT=%~dp0app"
set "AI_TARGET=${aiBaseUrl}"
echo.
echo   Nianlun is starting... your browser will open:
echo   http://127.0.0.1:${port}
echo   (if it does not open, type that address in your browser)
echo   To stop: close the browser, then close this window.
echo ============================================================
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start """" http://127.0.0.1:${port}"
"%~dp0node.exe" "%~dp0server\\proxy-server.mjs"
echo.
echo ============================================================
echo  Server stopped, or failed to start. If you see red/English errors above, screenshot them.
echo ============================================================
pause
`
}

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

说明：聊天记录的解析与统计全部在你电脑本地完成，不上传。仅“AI 文案/分析”
功能会把相应内容经本机转发到 AI 服务处理（需本机能联网访问该服务）。
`

function readEnvBaseUrl(webDir) {
  if (process.env.VITE_AI_BASE_URL) return process.env.VITE_AI_BASE_URL
  const envFile = join(webDir, '.env')
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*VITE_AI_BASE_URL\s*=\s*(.+)\s*$/m)
    if (m) return m[1].trim()
  }
  return ''
}

function findNodeExe() {
  if (process.env.NODE_EXE && existsSync(process.env.NODE_EXE)) return process.env.NODE_EXE
  // 当前运行的 node 即可（打包机为 Windows 时直接复用）
  if (process.platform === 'win32') return process.execPath
  // 跨平台兜底：尝试 where/which
  try {
    const p = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['node'])
      .toString().split(/\r?\n/)[0].trim()
    if (p && existsSync(p)) return p
  } catch { /* ignore */ }
  return ''
}

export async function buildWinZip({ distDir, serverDir, nodeExe, outFile, aiBaseUrl, rootName = '年轮' }) {
  const proxyScript = join(serverDir, 'proxy-server.mjs')
  if (!existsSync(proxyScript)) {
    throw new Error(`缺少本地服务器脚本（需 proxy-server.mjs）：${serverDir}`)
  }
  if (!nodeExe || !existsSync(nodeExe)) {
    throw new Error(`缺少 node.exe（用于打包内置运行时）：${nodeExe || '(未提供)'}`)
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error(`dist 未构建（缺 index.html）：${distDir}`)
  }
  if (!aiBaseUrl) {
    throw new Error('缺少 AI 接入地址（VITE_AI_BASE_URL），无法生成转发配置')
  }

  const output = createWriteStream(outFile)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
  })
  archive.pipe(output)

  archive.append(buildLauncher(aiBaseUrl), { name: `${rootName}/启动.bat` })
  archive.append(README, { name: `${rootName}/使用说明.txt` })
  archive.file(nodeExe, { name: `${rootName}/node.exe` })
  archive.file(proxyScript, { name: `${rootName}/server/proxy-server.mjs` })
  archive.directory(distDir, `${rootName}/app`)

  await archive.finalize()
  await done
  return outFile
}

// CLI：node scripts/pack-win.mjs  （从 packages/web 目录运行）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const webDir = process.cwd()
  const distDir = join(webDir, 'dist')
  const serverDir = join(webDir, 'scripts', 'server')
  const outFile = join(webDir, '年轮-windows.zip')
  const aiBaseUrl = readEnvBaseUrl(webDir)
  const nodeExe = findNodeExe()
  buildWinZip({ distDir, serverDir, nodeExe, outFile, aiBaseUrl })
    .then((p) => console.log(`已生成：${p}`))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
