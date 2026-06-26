import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yauzl from 'yauzl'
import { buildMacZip } from '../pack-mac.mjs'

// 读回 zip：返回 { 条目名 -> unix 权限 } 映射
function readZipModes(zipPath) {
  return new Promise((resolve, reject) => {
    const modes = {}
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      zip.on('entry', (e) => {
        modes[e.fileName] = (e.externalFileAttributes >>> 16) & 0o7777
        zip.readEntry()
      })
      zip.on('end', () => resolve(modes))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

// 读回 zip：返回 { 条目名 -> 文本内容 }
function readZipText(zipPath, wanted) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      zip.on('entry', (e) => {
        if (e.fileName !== wanted) return zip.readEntry()
        zip.openReadStream(e, (err2, rs) => {
          if (err2) return reject(err2)
          let buf = ''
          rs.on('data', (d) => (buf += d.toString('utf8')))
          rs.on('end', () => resolve(buf))
        })
      })
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

describe('buildMacZip', () => {
  let tmp, distDir, serverDir, outFile

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'nianlun-pack-'))
    distDir = join(tmp, 'dist')
    serverDir = join(tmp, 'server')
    outFile = join(tmp, '年轮.zip')
    await mkdir(join(distDir, 'assets'), { recursive: true })
    await writeFile(join(distDir, 'index.html'), '<!doctype html><title>年轮</title>')
    await writeFile(join(distDir, 'assets', 'app.js'), 'console.log(1)')
    await mkdir(serverDir, { recursive: true })
    await writeFile(join(serverDir, 'sws-arm64'), 'dummy-arm64-binary')
    await writeFile(join(serverDir, 'sws-amd64'), 'dummy-amd64-binary')
    await buildMacZip({ distDir, serverDir, outFile })
  })

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('包含全部预期条目', async () => {
    const modes = await readZipModes(outFile)
    expect(modes).toHaveProperty('年轮/启动.command')
    expect(modes).toHaveProperty('年轮/使用说明.txt')
    expect(modes).toHaveProperty('年轮/server/sws-arm64')
    expect(modes).toHaveProperty('年轮/server/sws-amd64')
    expect(modes).toHaveProperty('年轮/app/index.html')
    expect(modes).toHaveProperty('年轮/app/assets/app.js')
  })

  it('启动脚本与二进制为可执行 0755', async () => {
    const modes = await readZipModes(outFile)
    expect(modes['年轮/启动.command']).toBe(0o755)
    expect(modes['年轮/server/sws-arm64']).toBe(0o755)
    expect(modes['年轮/server/sws-amd64']).toBe(0o755)
  })

  it('app 内文件为 0644', async () => {
    const modes = await readZipModes(outFile)
    expect(modes['年轮/app/index.html']).toBe(0o644)
    expect(modes['年轮/app/assets/app.js']).toBe(0o644)
  })

  it('缺少二进制时抛错', async () => {
    await expect(
      buildMacZip({ distDir, serverDir: join(tmp, 'nope'), outFile: join(tmp, 'x.zip') })
    ).rejects.toThrow(/服务器二进制/)
  })

  it('缺少 dist/index.html 时抛错', async () => {
    const emptyDist = join(tmp, 'empty-dist')
    await mkdir(emptyDist, { recursive: true })
    await expect(
      buildMacZip({ distDir: emptyDist, serverDir, outFile: join(tmp, 'y.zip') })
    ).rejects.toThrow(/index\.html|dist 未构建/)
  })

  it('启动脚本含 shebang、端口与 SPA fallback', async () => {
    const txt = await readZipText(outFile, '年轮/启动.command')
    expect(txt.startsWith('#!/bin/bash')).toBe(true)
    expect(txt).toContain('PORT=8723')
    expect(txt).toContain('127.0.0.1')
    expect(txt).toContain('--page-fallback')
    expect(txt).toContain('com.apple.quarantine')
  })

  it('说明文件含首次右键打开提示', async () => {
    const txt = await readZipText(outFile, '年轮/使用说明.txt')
    expect(txt).toContain('右键')
    expect(txt).toContain('打开')
  })
})
