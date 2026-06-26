import { createWriteStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'

export const PORT = 8723
const EXEC_MODE = 0o755
const FILE_MODE = 0o644

export const LAUNCHER = `#!/bin/bash
# 年轮本地启动器
cd "$(dirname "$0")"
DIR="$(pwd)"

# 清除 Gatekeeper 隔离标记，避免 server 二进制被二次拦截
xattr -dr com.apple.quarantine "$DIR" 2>/dev/null

# 按芯片选二进制
if [ "$(uname -m)" = "arm64" ]; then
  SERVER="$DIR/server/sws-arm64"
else
  SERVER="$DIR/server/sws-amd64"
fi
chmod +x "$SERVER" 2>/dev/null

PORT=${PORT}

# 稍等服务器起来后自动打开浏览器
( sleep 1; open "http://127.0.0.1:$PORT" ) &

echo "年轮已启动，浏览器将自动打开 http://127.0.0.1:$PORT"
echo "使用完毕后，直接关闭此终端窗口即可停止。"
"$SERVER" --host 127.0.0.1 --port "$PORT" --root "$DIR/app" --page-fallback "$DIR/app/index.html"
`

export const README = `年轮 · 使用说明
================

1. 双击本压缩包解压。
2. 【首次使用】右键点击 "启动.command" → 选择 "打开" → 在弹窗中再点一次 "打开"。
   （这是 macOS 对未签名程序的统一提示，仅第一次需要这样；之后正常双击即可。）
3. 浏览器会自动打开 http://127.0.0.1:8723 ，开始使用。
4. 使用完毕：关闭浏览器标签页，并关闭弹出的终端窗口即可。

说明：本工具完全在你的电脑本地运行，不联网、不上传任何聊天数据。
`

export async function buildMacZip({ distDir, serverDir, outFile, rootName = '年轮' }) {
  const arm = join(serverDir, 'sws-arm64')
  const amd = join(serverDir, 'sws-amd64')
  if (!existsSync(arm) || !existsSync(amd)) {
    throw new Error(`缺少服务器二进制（需 sws-arm64 / sws-amd64）：${serverDir}`)
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

  archive.append(LAUNCHER, { name: `${rootName}/启动.command`, mode: EXEC_MODE })
  archive.append(README, { name: `${rootName}/使用说明.txt`, mode: FILE_MODE })
  archive.file(arm, { name: `${rootName}/server/sws-arm64`, mode: EXEC_MODE })
  archive.file(amd, { name: `${rootName}/server/sws-amd64`, mode: EXEC_MODE })
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
  const distDir = join(process.cwd(), 'dist')
  const serverDir = join(process.cwd(), 'scripts', 'server')
  const outFile = join(process.cwd(), '年轮.zip')
  buildMacZip({ distDir, serverDir, outFile })
    .then((p) => console.log(`已生成：${p}`))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
