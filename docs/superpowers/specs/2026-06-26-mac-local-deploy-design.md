# 年轮 Mac 本地交付设计稿（双击启动 + 浏览器访问）

日期：2026-06-26
状态：已确认方案，待用户复核

## 目标

把年轮 Web 应用打成一个压缩包发给客户（Mac 用户），客户解压后**双击一个文件即可启动**，浏览器自动打开并像在开发机上一样使用 App。客户电脑**零安装、零开发环境**。

## 约束（决定方案的关键事实）

1. **必须走 HTTP，不能 `file://`**：App 用了 Web Worker + ES Module，浏览器在 `file://`（直接双击 `index.html`）下会禁用它们，页面白屏。所以压缩包必须自带一个迷你 HTTP 静态服务器。
2. **history 路由**：`packages/web/src/router/index.ts` 用 `createWebHistory()`，服务器必须配 **SPA fallback**（未命中的路径回退到 `index.html`），否则客户刷新或访问子路由会 404。
3. **客户是 Mac、芯片不确定**：需同时兼容 Apple Silicon（arm64）与 Intel（x86_64）。
4. **开发机是 Windows、不想装编译工具链**：服务器用**预编译好的现成二进制**，不在本地编译。
5. **隐私优先**：服务器只绑定 `127.0.0.1`，不对局域网暴露。

## 方案 A：自带静态服务器 +「启动.command」

### 选用的服务器

[`static-web-server`](https://github.com/joseluisq/static-web-server)（简称 SWS）：单文件、约 3–4MB、官方提供 macOS arm64 与 x86_64 预编译二进制，自带 `--page-fallback` 选项天然支持 SPA fallback。

> 备选：若 SWS 不可用，可换 [Caddy](https://caddyserver.com)（更稳但单个 ~40MB，需用 Caddyfile 配 `try_files`）。本设计以 SWS 为主。

### 交付压缩包目录结构

```
年轮/
├── 启动.command          # 双击启动器（bash 脚本，权限 0755）
├── 使用说明.txt          # 给客户的简短说明（含首次右键打开提示）
├── server/
│   ├── sws-arm64         # SWS macOS Apple Silicon 二进制（0755）
│   └── sws-amd64         # SWS macOS Intel 二进制（0755）
└── app/                  # packages/web 构建产物 dist/ 的完整拷贝
    ├── index.html
    └── assets/...
```

### 启动脚本 `启动.command`

```bash
#!/bin/bash
# 年轮本地启动器
cd "$(dirname "$0")"
DIR="$(pwd)"

# 1) 清除 Gatekeeper 隔离标记（让 server 二进制能直接运行，避免二次拦截）
xattr -dr com.apple.quarantine "$DIR" 2>/dev/null

# 2) 按芯片选对应二进制
if [ "$(uname -m)" = "arm64" ]; then
  SERVER="$DIR/server/sws-arm64"
else
  SERVER="$DIR/server/sws-amd64"
fi
chmod +x "$SERVER" 2>/dev/null   # 双保险

PORT=8723

# 3) 稍等服务器起来后自动打开浏览器
( sleep 1; open "http://127.0.0.1:$PORT" ) &

# 4) 前台运行服务器（关闭终端窗口即停止）
echo "年轮已启动，浏览器将自动打开 http://127.0.0.1:$PORT"
echo "使用完毕后，直接关闭此窗口即可停止。"
"$SERVER" \
  --host 127.0.0.1 \
  --port "$PORT" \
  --root "$DIR/app" \
  --page-fallback "$DIR/app/index.html"
```

要点：
- `cd "$(dirname "$0")"` 保证无论从哪里双击都能定位到自身目录。
- 脚本开头 `xattr -dr` 把整个目录的隔离标记清掉，使被它调用的 server 二进制不会再触发 Gatekeeper。
- 关闭终端窗口 = 停止服务，符合「用完就关」的直觉。

### 打包脚本 `pack-mac.mjs`（在 Windows 上运行）

**关键坑**：Windows 上用资源管理器/普通 zip 打包会**丢失 Unix 可执行权限位**，客户解压后 `启动.command` 与二进制变成不可执行 → 双击报「没有权限」。解决：用 Node 的 `archiver` 库逐文件显式设置 `mode`（`启动.command` 和两个二进制设 `0755`，其余 `0644`）。macOS 解压时会据此恢复可执行权限。

`pack-mac.mjs` 职责（放在 `packages/web/scripts/`）：
1. 读取已构建的 `packages/web/dist/` → 写入压缩包内 `年轮/app/`。
2. 写入 `年轮/启动.command`、`年轮/使用说明.txt`（脚本内置文本常量）。
3. 读取本地预先放好的 `server/sws-arm64`、`server/sws-amd64`，写入 `年轮/server/`。
4. 用 `archiver` 生成 `年轮.zip`，对 `启动.command`、`sws-arm64`、`sws-amd64` 设 `{ mode: 0o755 }`，其余 `0o644`。

依赖：`archiver`（开发依赖，仅打包用）。

### 完整打包流程（每次发版）

```bash
# 1) 构建（core 先于 web）
pnpm --filter @nianlun/core build
pnpm --filter @nianlun/web build      # 产出 packages/web/dist/

# 2) 首次准备：下载 SWS 两个 mac 二进制，解压后改名放到 scripts/server/
#    sws-arm64  <- aarch64-apple-darwin
#    sws-amd64  <- x86_64-apple-darwin
#    （此步一次性，二进制不入 git，写进 .gitignore）

# 3) 打包
node packages/web/scripts/pack-mac.mjs   # 产出 年轮.zip

# 4) 把 年轮.zip 发给客户
```

### 客户首次使用（`使用说明.txt` 内容要点）

1. 双击 `年轮.zip` 解压。
2. **首次**：右键点 `启动.command` → 选「打开」→ 弹窗再点「打开」。（仅第一次，之后正常双击）
3. 浏览器自动打开，开始使用。
4. 用完关闭浏览器与终端窗口即停止。

## 已知取舍与边界

- **Gatekeeper 首次拦截**：因未购买苹果开发者签名（$99/年）做 notarization，首次须右键打开。这是 macOS 对一切未签名程序的统一行为，与方案无关。彻底消除需付费签名+公证，列为可选升级，不在本期范围。
- **端口占用**：固定 `8723`，极小概率被占用。一对一交付场景下接受此风险；如需健壮化可后续在脚本里做端口探测，本期不做。
- **压缩包体积**：SWS 两个二进制约 6–8MB + 构建产物，体积可接受。
- **范围之外**：自动更新、Windows 版客户、桌面 App（Electron/Tauri）、HTTPS、局域网共享访问。

## 涉及/新增文件

- 新增 `packages/web/scripts/pack-mac.mjs`（打包脚本）
- 新增 `packages/web/scripts/server/`（存放下载的 SWS 二进制，gitignore）
- 新增 `packages/web/package.json` 一个 `pack:mac` script + `archiver` devDependency
- 启动脚本与说明文本作为常量内置在 `pack-mac.mjs` 中，无需单独源文件
- 不改动任何现有 `core`/`web` 业务代码
