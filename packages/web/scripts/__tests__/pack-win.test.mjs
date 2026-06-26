import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yauzl from 'yauzl'
import { buildWinZip } from '../pack-win.mjs'

// 读回 zip：返回条目名集合
function readZipEntries(zipPath) {
  return new Promise((resolve, reject) => {
    const names = new Set()
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      zip.on('entry', (e) => {
        names.add(e.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolve(names))
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
      zip.on('end', () => reject(new Error('entry not found: ' + wanted)))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

async function makeDist(dir) {
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>年轮</title>')
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)')
}

async function makeServer(dir) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'proxy-server.mjs'), '// dummy server')
}

async function makeNode(dir) {
  await mkdir(dir, { recursive: true })
  const p = join(dir, 'node.exe')
  await writeFile(p, 'dummy-node-binary')
  return p
}

const AI_BASE = 'https://gaccode.com/claudecode'

describe('buildWinZip', () => {
  let tmp, distDir, serverDir, nodeExe, outFile

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'nianlun-pack-win-'))
    distDir = join(tmp, 'dist')
    serverDir = join(tmp, 'server')
    outFile = join(tmp, '年轮-windows.zip')
    await makeDist(distDir)
    await makeServer(serverDir)
    nodeExe = await makeNode(join(tmp, 'rt'))
    await buildWinZip({ distDir, serverDir, nodeExe, outFile, aiBaseUrl: AI_BASE })
  })

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('包含全部预期条目', async () => {
    const names = await readZipEntries(outFile)
    expect(names.has('年轮/启动.bat')).toBe(true)
    expect(names.has('年轮/使用说明.txt')).toBe(true)
    expect(names.has('年轮/node.exe')).toBe(true)
    expect(names.has('年轮/server/proxy-server.mjs')).toBe(true)
    expect(names.has('年轮/app/index.html')).toBe(true)
    expect(names.has('年轮/app/assets/app.js')).toBe(true)
  })

  it('启动脚本用 node 跑本地服务器并注入 AI 地址', async () => {
    const bat = await readZipText(outFile, '年轮/启动.bat')
    expect(bat).toContain('127.0.0.1')
    expect(bat).toContain('8723')
    expect(bat).toContain('node.exe')
    expect(bat).toContain('proxy-server.mjs')
    expect(bat).toContain('AI_TARGET=https://gaccode.com/claudecode')
    expect(bat).toContain('APP_ROOT')
  })

  it('缺服务器脚本时抛错', async () => {
    const t = await mkdtemp(join(tmpdir(), 'nianlun-pack-win-'))
    const d = join(t, 'dist'); const s = join(t, 'server')
    await makeDist(d); await mkdir(s, { recursive: true })
    const n = await makeNode(join(t, 'rt'))
    await expect(
      buildWinZip({ distDir: d, serverDir: s, nodeExe: n, outFile: join(t, 'o.zip'), aiBaseUrl: AI_BASE })
    ).rejects.toThrow(/proxy-server\.mjs/)
    await rm(t, { recursive: true, force: true })
  })

  it('缺 node.exe 时抛错', async () => {
    const t = await mkdtemp(join(tmpdir(), 'nianlun-pack-win-'))
    const d = join(t, 'dist'); const s = join(t, 'server')
    await makeDist(d); await makeServer(s)
    await expect(
      buildWinZip({ distDir: d, serverDir: s, nodeExe: join(t, 'nope.exe'), outFile: join(t, 'o.zip'), aiBaseUrl: AI_BASE })
    ).rejects.toThrow(/node\.exe/)
    await rm(t, { recursive: true, force: true })
  })

  it('缺 dist 时抛错', async () => {
    const t = await mkdtemp(join(tmpdir(), 'nianlun-pack-win-'))
    const d = join(t, 'dist'); const s = join(t, 'server')
    await mkdir(d, { recursive: true }); await makeServer(s)
    const n = await makeNode(join(t, 'rt'))
    await expect(
      buildWinZip({ distDir: d, serverDir: s, nodeExe: n, outFile: join(t, 'o.zip'), aiBaseUrl: AI_BASE })
    ).rejects.toThrow(/index\.html/)
    await rm(t, { recursive: true, force: true })
  })

  it('缺接入地址时抛错', async () => {
    const t = await mkdtemp(join(tmpdir(), 'nianlun-pack-win-'))
    const d = join(t, 'dist'); const s = join(t, 'server')
    await makeDist(d); await makeServer(s)
    const n = await makeNode(join(t, 'rt'))
    await expect(
      buildWinZip({ distDir: d, serverDir: s, nodeExe: n, outFile: join(t, 'o.zip'), aiBaseUrl: '' })
    ).rejects.toThrow(/接入地址|VITE_AI_BASE_URL/)
    await rm(t, { recursive: true, force: true })
  })
})
