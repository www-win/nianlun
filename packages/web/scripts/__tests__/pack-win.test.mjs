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
  await writeFile(join(dir, 'sws.exe'), 'dummy-windows-binary')
}

describe('buildWinZip', () => {
  let tmp, distDir, serverDir, outFile

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'nianlun-pack-win-'))
    distDir = join(tmp, 'dist')
    serverDir = join(tmp, 'server')
    outFile = join(tmp, '年轮-windows.zip')
    await makeDist(distDir)
    await makeServer(serverDir)
    await buildWinZip({ distDir, serverDir, outFile })
  })

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('包含全部预期条目', async () => {
    const names = await readZipEntries(outFile)
    expect(names.has('年轮/启动.bat')).toBe(true)
    expect(names.has('年轮/使用说明.txt')).toBe(true)
    expect(names.has('年轮/server/sws.exe')).toBe(true)
    expect(names.has('年轮/app/index.html')).toBe(true)
    expect(names.has('年轮/app/assets/app.js')).toBe(true)
  })

  it('启动脚本指向本地服务器与回退页', async () => {
    const bat = await readZipText(outFile, '年轮/启动.bat')
    expect(bat).toContain('127.0.0.1')
    expect(bat).toContain('8723')
    expect(bat).toContain('page-fallback')
  })

  it('缺二进制时抛错', async () => {
    const t = await mkdtemp(join(tmpdir(), 'nianlun-pack-win-'))
    const d = join(t, 'dist')
    const s = join(t, 'server')
    await makeDist(d)
    await mkdir(s, { recursive: true })
    await expect(
      buildWinZip({ distDir: d, serverDir: s, outFile: join(t, 'o.zip') })
    ).rejects.toThrow(/sws\.exe/)
    await rm(t, { recursive: true, force: true })
  })

  it('缺 dist 时抛错', async () => {
    const t = await mkdtemp(join(tmpdir(), 'nianlun-pack-win-'))
    const d = join(t, 'dist')
    const s = join(t, 'server')
    await mkdir(d, { recursive: true })
    await makeServer(s)
    await expect(
      buildWinZip({ distDir: d, serverDir: s, outFile: join(t, 'o.zip') })
    ).rejects.toThrow(/index\.html/)
    await rm(t, { recursive: true, force: true })
  })
})
