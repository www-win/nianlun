# CLAUDE.md

本文件用于指导 Claude Code（claude.ai/code）在本仓库中处理代码时的行为。

## 语言

- **所有回答都必须使用中文。**

## 这是什么

**年轮 Nianlun** —— 一个本地优先、保护隐私的工具，它把一年的微信聊天记录导出文件转换成结构化的好友表格和一页式的年度报告海报。所有处理都在浏览器中完成：解析、统计、存储都发生在用户设备上；不上传任何数据，也没有后端。

## 命令

这是一个 **pnpm workspace monorepo**（`packages/core`、`packages/web`）。请使用 pnpm，不要用 npm/yarn。

```bash
pnpm install                          # 安装所有 workspace 依赖

# 整个仓库
pnpm -r test                          # 运行每个包的测试
pnpm -r build                         # 构建每个包

# Core（纯 TS 逻辑库）
pnpm --filter @nianlun/core test      # vitest run
pnpm --filter @nianlun/core test:watch
pnpm --filter @nianlun/core build     # tsup → dist/（web 依赖它可被构建）

# Web（Vue 3 应用）
pnpm --filter @nianlun/web dev         # Vite 开发服务器（运行中的站点）
pnpm --filter @nianlun/web build       # vue-tsc --noEmit && vite build
pnpm --filter @nianlun/web preview      # 预览生产构建产物
pnpm --filter @nianlun/web test         # vitest run（jsdom）

# 本地交付打包（先 build 再打包；产物为 zip，对方解压双击即用）
pnpm --filter @nianlun/web pack:mac     # → 年轮.zip（双击 启动.command）
pnpm --filter @nianlun/web pack:win     # → 年轮-windows.zip（双击 启动.bat）

# 运行单个测试文件 / 单个测试
pnpm --filter @nianlun/web exec vitest run src/stores/__tests__/data.test.ts
pnpm --filter @nianlun/core exec vitest run -t "mergeFriends"
```

### 本地交付打包细节

`pack:mac` / `pack:win`（`packages/web/scripts/pack-{mac,win}.mjs`）把 `dist/` + 一个
预下载的 [static-web-server](https://github.com/joseluisq/static-web-server)（简称 sws）二进制
+ 双击启动器 + 中文《使用说明》打成一个 zip。对方解压后双击启动器，sws 在本地
`127.0.0.1:8723` 提供静态站点（应用用到 Worker/IndexedDB/ESM，**必须**经 HTTP server，不能
`file://` 直开）。全程本地、不联网、不上传。

- **二进制不入库**：`scripts/server/` 下的 `sws-arm64`/`sws-amd64`（Mac）与 `sws.exe`（Windows）
  被 `.gitignore`（`scripts/server/sws*`），换机/重新 clone 后需重新放入，否则打包报"缺少服务器二进制"。
  到 sws releases 下载 **v2.43.0**（与现有 Mac 包一致）：Mac 用 `aarch64-apple-darwin` /
  `x86_64-apple-darwin`，Windows 用 `x86_64-pc-windows-msvc` 里的 `static-web-server.exe`（重命名为 `sws.exe`）。
- **Windows 首启会触发 SmartScreen**（未签名 exe）：《使用说明》已教对方点"更多信息 → 仍要运行"。
- 测试见 `scripts/__tests__/pack-{mac,win}.test.mjs`（用 yauzl 读回 zip 断言条目）。

测试使用 **Vitest**；web 测试在 **jsdom** 下运行，配合 **@vue/test-utils**，IndexedDB 测试使用 **fake-indexeddb**（通过 `import 'fake-indexeddb/auto'` 引入）。

## 架构：理解一切的唯一规则

存在一条严格的**单向依赖链**：`@nianlun/web → @nianlun/core`。**`core` 永远不会 import `web`，永远不会触碰 `window`/`document`/`IndexedDB`/`vue`。** 这一点在编译期被强制约束 —— `packages/core/tsconfig.json` 设置了 `"lib": ["ES2020"]` 和 `"types": []`，因此任何 DOM API 的使用都会编译失败。这一边界的存在是为了让同一份 `core` 日后可以被桌面应用（Electron/Tauri）和小程序（uni-app/Taro）复用。在 `core` 中工作时，要把它保持为一个纯粹、无副作用的 TypeScript 库：输入是字符串/普通数据，输出是普通数据。

### `@nianlun/core` —— “大脑”（纯函数）

数据流为 `parse → aggregate → report`，全部是纯函数：

- `parsers/` —— 每种输入格式一个文件，实现 `Parser` 接口（`canParse` 嗅探 + `parse`）。`txt.ts` 和 `html.ts` 解析导出的聊天记录；`backup.ts`（`parseJsonBackup`/`parseCsvBackup`）把本工具*自己*导出的 CSV/JSON 重新导入回 `Friend[]`。**解析器是容错的 —— 它们把坏行收集到 `warnings` 中，永不抛异常。** HTML 解析器是**基于正则的，而非 DOMParser**（core 没有 DOM）。
- `pipeline/parseFile.ts` —— 嗅探内容并分发给第一个匹配的解析器；HTML 在 txt 之前尝试。
- `stats/aggregate.ts` —— `Conversation[]` → `Friend[]`（消息计数、发送占比、月度分布、首次/最后联系）。
- `stats/report.ts` —— 构建 `ReportData`（top 联系人、活跃天数、关系分布、最新消息）。
- `merge/merge.ts` —— 多次导入支持：`mergeConversations` 对消息去重，`mergeFriends` 按 id 合并，同时**保留用户编辑**（`Friend.userEdited` 始终优先于重新导入的统计数据）。这正是让多个文件导入（微信按会话逐个导出）能正确累积的原因。
- `model/types.ts` —— 共享类型。`Relation` 恰好是 `'家人' | '挚友' | '同事' | '同学' | '客户' | '其他'`；要 import 它，绝不重新定义。时间戳是毫秒级 `number`。

### `@nianlun/web` —— “身体”（适配器 + UI）

web 层只负责搬运、展示和存储数据 —— 它从不计算。所有重逻辑都委托给 `core`，并且 **`core` 只会在 Web Worker 内部被调用**，从不在主线程上调用。

- `worker/parse.worker.ts` + `adapters/parseClient.ts` —— `core` 的 parse/aggregate/report 在 Worker 中运行；`parseClient.parseFiles()` 是对消息往返的 promise 封装。`parseClient` 接受一个可注入的 `createWorker`，因此无需真实 Worker 即可测试。**`ParseOutcome` 故意不把 `Conversation[]` 携带到主线程**（原始聊天记录绝不能被持久化）。
- `adapters/storage.ts` —— 通过 `idb` 使用 IndexedDB。持久化聚合后的 `Friend[]` + `ReportData`，**以及每个好友少量有界的聊天样本**（`saveSamples`/`loadSamples`，存于 `meta` 库的 `samples` 键，供刷新后的 AI 建议使用）。**完整的原始聊天（`Conversation[]`）仍绝不落盘**，只持久化有界样本。Pinia 的响应式代理无法被结构化克隆，因此入库前需 `toRaw()`（样本用 JSON 深拷贝去代理）。
- `stores/`（Pinia）—— `data`（好友 + 报告，页面的唯一数据源；编辑经由 `updateFriend`，它会记录 `userEdited` 并持久化）、`import`（`run(files, year)` 编排 读取 → worker → 合并进已有数据 → 存储）、`ui`（报告主题）。
- `pages/` —— `Overview`、`ImportPage`（驱动 `importStore.run`）、`FriendsPage`（表格/搜索/排序/行内编辑/CSV 导出）、`ReportPage`（海报 + 主题 + `window.print`）。页面必须从 stores 读取，编辑要经由 `updateFriend` —— 绝不直接修改 store 数据或直接调用 `core`。
- 应用启动时（`main.ts`）会在挂载前调用 `useDataStore().hydrate()`，以便重新加载之前导入的数据。

### 页面 ↔ 原型出处

这四个页面是从静态 HTML 原型移植而来的，原型位于**本仓库之外**（在相邻的 `open-design` 项目目录中，与设计文档 `技术方案.md` / `功能方案.md` / `实施计划-0*.md` 放在一起）。原型的标记/CSS 是视觉的真理来源；Vue 页面用 store 绑定替换了原型中硬编码的示例数据。

## 重要约束与已知缺口

- **输入格式**：`TxtParser` 期望的消息块为 `YYYY-MM-DD HH:MM:SS <sender>` 头行，后跟若干正文行直到空行；发送者 `我` ⇒ `from: 'me'`。这是一个*假定*的格式 —— 真实的微信/第三方导出各不相同，很可能需要新的解析器/适配器。新增格式的方式是往 `parsers/` 里放一个新的 `Parser` 并在 `pipeline/parseFile.ts` 中注册它；不要改动现有解析器。
- **设计上为空**：`buildReport` 返回 `keywords: []`（core 中没有中文分词器）。报告页的“最晚的一次”（`latestMessage`）部分已计算但尚未渲染。
- **范围之外**：加密 `.bak` 解析、账户、云同步。用户聊天数据只存在于浏览器的 IndexedDB 中 —— 不会跨设备同步，也不在 git 里。

## Git / 网络注意事项（本机）

从本机推送到 GitHub 需要代理和一个非默认的 TLS 设置，已在 `.git/config` 中配置：

```
http.proxy = http://127.0.0.1:10809    # 本地代理必须处于运行状态
http.sslVersion = tlsv1.2              # 默认的 TLS 1.3 会让代理握手失败（"unexpected eof"）
```

如果 push 失败并提示 `schannel: failed to receive handshake` 或 `unexpected eof while reading`，请确认代理已启动且已设置 `http.sslVersion=tlsv1.2`。认证需要一个带 `repo` scope 的经典 PAT（细粒度令牌必须授予该仓库的 Contents: Read and write 权限）。
