# 年轮 Mac 本地交付 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供一个 Node 打包脚本，把已构建的年轮 Web 应用 + 预编译静态服务器打成 `年轮.zip`，Mac 客户解压后双击 `启动.command` 即可在浏览器使用。

**Architecture:** 新增 `packages/web/scripts/pack-mac.mjs`，导出可测的 `buildMacZip()` 纯打包函数 + 一个 CLI 入口。函数用 `archiver` 生成 zip，对 `启动.command` 与两个服务器二进制显式设 Unix 权限 `0755`（解决 Windows 打包丢可执行位的坑），启动脚本与说明文本作为常量内置在脚本里。不改动任何 core/web 业务代码。

**Tech Stack:** Node ESM、`archiver`（打包）、`yauzl`（测试读回 zip 校验权限位）、Vitest。

## Global Constraints

- pnpm workspace monorepo，只用 pnpm；改动仅限 `packages/web`，**不碰 `core`/`web` 业务代码**。
- 服务器固定绑定 `127.0.0.1`、端口 `8723`，配 SPA fallback 回退到 `app/index.html`。
- 压缩包根目录名 `年轮`；目录结构 `年轮/{启动.command, 使用说明.txt, server/{sws-arm64,sws-amd64}, app/...}`。
- 权限位：`启动.command`、`sws-arm64`、`sws-amd64` = `0o755`；`app/` 内文件 = `0o644`，目录 = `0o755`。
- 服务器二进制为预下载的 [static-web-server](https://github.com/joseluisq/static-web-server)（arm64 = aarch64-apple-darwin，amd64 = x86_64-apple-darwin），放在 `packages/web/scripts/server/`，**不入 git**。

---

## File Structure

- `packages/web/scripts/pack-mac.mjs` — 打包逻辑：`buildMacZip()` 导出 + CLI main + `LAUNCHER`/`README` 常量。
- `packages/web/scripts/__tests__/pack-mac.test.mjs` — 用临时夹具 + yauzl 校验 zip 条目与权限位。
- `packages/web/scripts/server/.gitkeep` — 占位，保证空目录存在。
- `packages/web/package.json` — 加 `pack:mac` script + `archiver`/`yauzl` devDependency。
- `packages/web/.gitignore`（或仓库根 `.gitignore`）— 忽略 `scripts/server/sws-*`。

---

### Task 1: `buildMacZip()` 核心 + 权限位测试（TDD）

**Files:**
- Create: `packages/web/scripts/pack-mac.mjs`
- Test: `packages/web/scripts/__tests__/pack-mac.test.mjs`
- Modify: `packages/web/package.json`（加 `archiver`、`yauzl` 到 devDependencies）

**Interfaces:**
- Produces:
  - `buildMacZip({ distDir, serverDir, outFile, rootName? }): Promise<string>` — 生成 zip 到 `outFile` 并返回该路径；缺少二进制或 `dist/index.html` 时 throw。
  - `PORT: number`（= 8723）、`LAUNCHER: string`、`README: string` 常量（Task 2 用）。

- [ ] **Step 1: 安装测试/打包依赖**

```bash
pnpm --filter @nianlun/web add -D archiver yauzl
```

- [ ] **Step 2: 写失败测试**

创建 `packages/web/scripts/__tests__/pack-mac.test.mjs`：

```js
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
})
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run scripts/__tests__/pack-mac.test.mjs`
Expected: FAIL（`buildMacZip` 无法从 `../pack-mac.mjs` 导入 / 模块不存在）

- [ ] **Step 4: 写最小实现**

创建 `packages/web/scripts/pack-mac.mjs`：

```js
import { createWriteStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import archiver from 'archiver'

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
  const archive = archiver('zip', { zlib: { level: 9 } })
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
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run scripts/__tests__/pack-mac.test.mjs`
Expected: PASS（4 个测试全过）

- [ ] **Step 6: 确认未影响既有测试**

Run: `pnpm --filter @nianlun/web test`
Expected: PASS（全部既有测试 + 新增测试通过）

- [ ] **Step 7: 提交**

```bash
git add packages/web/scripts/pack-mac.mjs packages/web/scripts/__tests__/pack-mac.test.mjs packages/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add buildMacZip packer with exec-bit preservation"
```

---

### Task 2: 启动脚本/说明常量 + CLI 入口 + 配置

**Files:**
- Modify: `packages/web/scripts/pack-mac.mjs`（填充 `LAUNCHER`/`README`，加 CLI main）
- Modify: `packages/web/scripts/__tests__/pack-mac.test.mjs`（加内容断言）
- Modify: `packages/web/package.json`（加 `pack:mac` script）
- Create: `packages/web/scripts/server/.gitkeep`
- Modify: `packages/web/.gitignore`

**Interfaces:**
- Consumes: Task 1 的 `buildMacZip`、`PORT`、`LAUNCHER`、`README`。
- Produces: `pnpm --filter @nianlun/web pack:mac` 命令；zip 内含可用的 `启动.command` 与 `使用说明.txt`。

- [ ] **Step 1: 加内容断言（失败测试）**

在 `pack-mac.test.mjs` 里追加一个读条目内容的辅助 + 测试。先在文件顶部 import 处下方加辅助函数：

```js
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
```

在 `describe` 内追加测试：

```js
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
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run scripts/__tests__/pack-mac.test.mjs`
Expected: FAIL（`PORT=8723`/`--page-fallback`/`右键` 等断言不通过——当前 LAUNCHER/README 为占位）

- [ ] **Step 3: 填充常量与 CLI（最小实现）**

把 `pack-mac.mjs` 顶部的占位常量替换为真实内容，并在文件末尾加 CLI 入口。

替换 `LAUNCHER`/`README`：

```js
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
```

> 注：JS 模板字符串里 `${PORT}` 会被替换为 8723；`$DIR`/`$PORT`/`$(...)` 不带花括号，保持为字面 bash 语法。

在文件末尾追加 CLI 入口：

```js
// CLI：node scripts/pack-mac.mjs  （从 packages/web 目录运行）
import { fileURLToPath } from 'node:url'
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
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run scripts/__tests__/pack-mac.test.mjs`
Expected: PASS（全部测试通过）

- [ ] **Step 5: 加 npm script、gitignore、占位目录**

在 `packages/web/package.json` 的 `scripts` 中加一行（放在 `build` 之后）：

```json
    "pack:mac": "node scripts/pack-mac.mjs",
```

向 `packages/web/.gitignore` 追加（文件不存在则创建）：

```
# Mac 交付：预下载的静态服务器二进制不入库
scripts/server/sws-*
年轮.zip
```

创建空文件 `packages/web/scripts/server/.gitkeep`（内容留空），确保目录存在。

- [ ] **Step 6: 提交**

```bash
git add packages/web/scripts/pack-mac.mjs packages/web/scripts/__tests__/pack-mac.test.mjs packages/web/package.json packages/web/.gitignore packages/web/scripts/server/.gitkeep
git commit -m "feat(web): launcher/readme content + pack:mac CLI"
```

---

### Task 3: 一次性获取二进制 + 真实打包与 Mac 冒烟验证（手动）

> 本任务无自动化测试：服务器二进制的真实运行只能在 Mac 上验证，开发机为 Windows。这是文档化的手动步骤。

**Files:** 无代码改动（仅放置二进制、产出 zip）。

- [ ] **Step 1: 下载 static-web-server 的两个 mac 二进制**

到 https://github.com/joseluisq/static-web-server/releases 下载最新 v2：
- `*-aarch64-apple-darwin.tar.gz`
- `*-x86_64-apple-darwin.tar.gz`

各自解压出其中的 `static-web-server` 可执行文件，重命名并放置：
- `packages/web/scripts/server/sws-arm64`（来自 aarch64）
- `packages/web/scripts/server/sws-amd64`（来自 x86_64）

- [ ] **Step 2: 构建并打包**

```bash
pnpm --filter @nianlun/core build
pnpm --filter @nianlun/web build
pnpm --filter @nianlun/web pack:mac
```

Expected: `packages/web/年轮.zip` 生成，控制台打印 `已生成：...年轮.zip`。

- [ ] **Step 3: Mac 冒烟测试（在一台 Mac 上，或请客户按说明做）**

1. 拷贝 `年轮.zip` 到 Mac，双击解压。
2. 右键 `启动.command` → 打开 → 打开。
3. 确认浏览器自动打开 `http://127.0.0.1:8723`，年轮首页正常加载（无白屏、无 Worker 报错）。
4. 在 App 内导入一个样例聊天文件，确认解析/统计/报告页均工作；刷新某个子路由页面不出现 404（验证 SPA fallback）。
5. 关闭终端窗口，确认服务停止（浏览器再刷新打不开）。

Expected: 全部通过。如出现「无法打开」→ 确认是用「右键→打开」而非双击；如白屏 → 确认走的是 `http://127.0.0.1:8723` 而非 `file://`。

- [ ] **Step 4: 交付**

把 `年轮.zip` 连同（可选）一句话提示发给客户：「解压后，第一次请右键点启动.command选打开」。

---

## Self-Review

**Spec coverage:**
- 自带服务器 + 双击启动 + 浏览器 → Task 1/2（buildMacZip + LAUNCHER）、Task 3（真实打包）。✅
- SPA fallback（history 路由）→ LAUNCHER 的 `--page-fallback`，Task 2 测试断言 + Task 3 step3.4 验证。✅
- arm64/amd64 双兼容 → LAUNCHER 按 `uname -m` 选二进制；打包含两个二进制。✅
- Windows 打包不丢可执行位 → Task 1 用 archiver `mode: 0o755` + yauzl 测试断言。✅
- 仅绑 127.0.0.1 / 端口 8723 → LAUNCHER + Task 2 断言。✅
- Gatekeeper 首次右键打开 → LAUNCHER 的 `xattr` + README，Task 2 断言 + Task 3 验证。✅
- 二进制不入 git → Task 2 .gitignore + .gitkeep。✅
- 不碰 core/web 业务代码 → 仅新增 scripts/ 与 package.json。✅

**Placeholder scan:** Task 1 的 `LAUNCHER='#!/bin/bash\n'`/`README=''` 是**有意的占位**，Task 2 Step 3 明确替换为完整内容，非计划缺陷。其余步骤均含完整代码/命令。✅

**Type consistency:** `buildMacZip({distDir, serverDir, outFile, rootName})`、`PORT`、`LAUNCHER`、`README` 在 Task 1 定义，Task 2 一致复用；测试辅助 `readZipModes`/`readZipText` 命名一致。✅
