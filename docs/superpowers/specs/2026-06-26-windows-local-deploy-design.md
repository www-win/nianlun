# 年轮 Windows 本地交付包 — 设计文档

日期：2026-06-26
状态：已批准，待实现

## 背景

年轮已有一套 **Mac 本地交付方案**（见 `packages/web/scripts/pack-mac.mjs`）：把 vite 构建产物 + 一个静态服务器二进制 + 双击启动脚本 + 使用说明打进一个 zip，对方解压后双击即可在本地 `127.0.0.1:8723` 运行，全程不联网、不上传聊天数据。

本设计为其 **Windows 等价方案**。因为应用用到 Web Worker / IndexedDB / ES module，必须经由本地 HTTP server 提供（不能让对方直接 `file://` 打开 `index.html`），所以 Windows 也走"内置静态服务器"的同一思路。

## 约束与已确认前提

- **接收方完全不懂电脑**：启动方式要"傻瓜"，停止方式要直观。
- **交付方式**：作者把项目打成 zip 发给对方（微信/网盘等，大概率被打上"来自互联网"MOTW 标记），对方在自己电脑上解压运行。
- **SmartScreen 蓝框躲不掉**：未签名 exe + 来自互联网 → "Windows 已保护你的电脑"必然出现。无法用脚本规避，只能在说明书里用图文教对方点"更多信息 → 仍要运行"。
- Windows 接收机基本都是 x86_64，**只需一个 `sws.exe`**（不像 Mac 要 arm64 + amd64 两个）。

## 选定方案：方案 A —— `.bat` 友好窗口，关窗即停

对一个完全不懂电脑的人，"有个能关的窗口"比"看不见也关不掉的后台进程"更安全、更好教。黑窗问题用一句友好中文提示化解。（备选的全隐藏 `.vbs` 方案被否决：停止困难 + 杀软更易误报。）

## 架构

新增 `packages/web/scripts/pack-win.mjs`，与 `pack-mac.mjs` 平行：

- 导出 `buildWinZip({ distDir, serverDir, outFile, rootName = '年轮' })`。
- 同款 CLI：从 `packages/web` 目录 `node scripts/pack-win.mjs` 运行，默认输出 `年轮-windows.zip`（避免与 Mac 的 `年轮.zip` 撞名）。
- 在 `packages/web/package.json` 的 scripts 加 `"pack:win": "node scripts/pack-win.mjs"`。
- **不改动** `pack-mac.mjs`。
- **不抽公共逻辑**（YAGNI）：两个小文件平行，可读性优先。复用现有依赖 `archiver`。

## 压缩包内容

```
年轮/
  启动.bat          ← 双击它
  使用说明.txt
  server/sws.exe    ← static-web-server 的 Windows 版（x86_64-pc-windows-msvc）
  app/...           ← vite 构建产物 dist/
```

`sws.exe` 与 Mac 二进制一样**不入库**，由作者手动放入 `scripts/server/`。需把 `.gitignore` 中的
`scripts/server/sws-*` 放宽为 `scripts/server/sws*`，以同时忽略 `sws.exe`（无连字符，旧规则匹配不到）。

## 启动器 `启动.bat`

要点：
- `chcp 65001` 让控制台以 UTF-8 显示中文（文件本身按 UTF-8 写出，**不加 BOM**——BOM 会破坏首行）。
- 延迟约 1 秒再开浏览器（用 `ping -n 2 127.0.0.1` 作延时），避免服务器还没起来浏览器就打开报错。
- 浏览器在 `start "" /b cmd /c ...` 的分离子进程里打开，主窗口随即把 `sws.exe` 跑在**前台**——窗口即"运行中"指示器，**关闭窗口 = 终止子进程 = 停止服务**。
- 窗口只显示友好中文提示，不刷服务器日志。
- 服务器参数与 Mac 完全一致：`--host 127.0.0.1 --port 8723 --root <app> --page-fallback <app/index.html>`。

```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 年轮（运行中 — 用完关闭此窗口即可停止）
echo   年轮已启动，正在打开浏览器…
echo   地址：http://127.0.0.1:8723
echo   用完后：关闭浏览器，再关闭此窗口即可停止。
start "" /b cmd /c "ping -n 2 127.0.0.1 >nul & start """" http://127.0.0.1:8723"
"%~dp0server\sws.exe" --host 127.0.0.1 --port 8723 --root "%~dp0app" --page-fallback "%~dp0app\index.html"
```

端口固定 `8723`（与 Mac 一致）。

## 使用说明.txt

中文，覆盖：
1. 双击压缩包解压。
2. 进入"年轮"文件夹，双击 `启动.bat`。
3. **若出现"Windows 已保护你的电脑"蓝框**：点"更多信息" → "仍要运行"（图文步骤，说明这是未签名程序的统一提示，仅本工具如此、并非病毒）。
4. 浏览器自动打开 http://127.0.0.1:8723 开始使用。
5. 用完：关闭浏览器标签页，再关闭弹出的窗口即可停止。
6. 隐私说明：完全本地运行，不联网、不上传任何聊天数据。

## 错误处理

`buildWinZip` 在以下情况抛清晰中文错误（照搬 Mac 风格）：
- 缺 `server/sws.exe` → `缺少服务器二进制（需 sws.exe）：<serverDir>`
- 缺 `dist/index.html` → `dist 未构建（缺 index.html）：<distDir>`

## 测试

新增 `packages/web/scripts/__tests__/pack-win.test.mjs`，复用 Mac 测试里的 yauzl 读 zip 思路：

- **包含全部预期条目**：`年轮/启动.bat`、`年轮/使用说明.txt`、`年轮/server/sws.exe`、`年轮/app/index.html`、`年轮/app/assets/app.js`。
- **启动脚本内容正确**：含 `127.0.0.1`、`8723`、`page-fallback`。
- **缺二进制**（无 `sws.exe`）时 `buildWinZip` 抛错。
- **缺 dist**（无 `index.html`）时 `buildWinZip` 抛错。
- Windows zip 不需要可执行位，**不测 mode**（这是与 Mac 测试的唯一差异）。

测试用临时目录构造假的 `dist/` 与 `server/sws.exe`（dummy 内容即可），调用 `buildWinZip` 后读回 zip 断言。

## 范围之外

- 不做单文件 `.exe` 自包含打包（Node SEA / pkg 等）。
- 不做代码签名（消除 SmartScreen 需购买证书，超范围）。
- 不支持 ARM Windows。
- 不改动现有 Mac 打包逻辑。
