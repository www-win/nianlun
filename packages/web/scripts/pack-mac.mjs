import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'

export const PORT = 8723
const EXEC_MODE = 0o755
const FILE_MODE = 0o644

export function buildLauncher(aiBaseUrl, port = PORT) {
  return `#!/bin/bash
# 年轮本地启动器
cd "$(dirname "$0")"
DIR="$(pwd)"

# 清除 Gatekeeper 隔离标记，避免二进制被二次拦截
xattr -dr com.apple.quarantine "$DIR" 2>/dev/null

# 按芯片选 node 运行时
if [ "$(uname -m)" = "arm64" ]; then
  NODE="$DIR/node-arm64"
else
  NODE="$DIR/node-amd64"
fi
chmod +x "$NODE" 2>/dev/null

export PORT=${port}
export HOST=127.0.0.1
export APP_ROOT="$DIR/app"
export AI_TARGET="${aiBaseUrl}"

# 稍等服务器起来后自动打开浏览器
( sleep 1; open "http://127.0.0.1:${port}" ) &

echo "年轮已启动，浏览器将自动打开 http://127.0.0.1:${port}"
echo "使用完毕后，直接关闭此终端窗口即可停止。"
"$NODE" "$DIR/server/proxy-server.mjs"
`
}

export const README = `年轮 · 使用说明
================

1. 双击本压缩包解压。
2. 【首次使用】右键点击 "启动.command" → 选择 "打开" → 在弹窗中再点一次 "打开"。
   （这是 macOS 对未签名程序的统一提示，仅第一次需要这样；之后正常双击即可。）
3. 浏览器会自动打开 http://127.0.0.1:8723 ，开始使用。
4. 使用完毕：关闭浏览器标签页，并关闭弹出的终端窗口即可。

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

export async function buildMacZip({ distDir, serverDir, outFile, aiBaseUrl, rootName = '年轮' }) {
  const arm = join(serverDir, 'node-arm64')
  const amd = join(serverDir, 'node-amd64')
  const proxyScript = join(serverDir, 'proxy-server.mjs')
  if (!existsSync(arm) || !existsSync(amd)) {
    throw new Error(`缺少 node 运行时（需 node-arm64 / node-amd64）：${serverDir}`)
  }
  if (!existsSync(proxyScript)) {
    throw new Error(`缺少本地服务器脚本（需 proxy-server.mjs）：${serverDir}`)
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

  archive.append(buildLauncher(aiBaseUrl), { name: `${rootName}/启动.command`, mode: EXEC_MODE })
  archive.append(README, { name: `${rootName}/使用说明.txt`, mode: FILE_MODE })
  archive.file(proxyScript, { name: `${rootName}/server/proxy-server.mjs`, mode: FILE_MODE })
  archive.file(arm, { name: `${rootName}/node-arm64`, mode: EXEC_MODE })
  archive.file(amd, { name: `${rootName}/node-amd64`, mode: EXEC_MODE })
  archive.directory(distDir, `${rootName}/app`, (entry) => {
    const isDir = entry.stats && entry.stats.isDirectory()
    entry.mode = isDir ? 0o755 : FILE_MODE
    return entry
  })

  await archive.finalize()
  await done
  return outFile
}

// CLI：node scripts/pack-mac.mjs  （从 packages/web 目录运行）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const webDir = process.cwd()
  const distDir = join(webDir, 'dist')
  const serverDir = join(webDir, 'scripts', 'server')
  const outFile = join(webDir, '年轮.zip')
  const aiBaseUrl = readEnvBaseUrl(webDir)
  buildMacZip({ distDir, serverDir, outFile, aiBaseUrl })
    .then((p) => console.log(`已生成：${p}`))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
