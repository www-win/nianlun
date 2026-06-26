import { createWriteStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ZipArchive } from 'archiver'

export const PORT = 8723
const EXEC_MODE = 0o755
const FILE_MODE = 0o644

// 占位常量，Task 2 填充真实内容
export const LAUNCHER = '#!/bin/bash\n'
export const README = ''

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
