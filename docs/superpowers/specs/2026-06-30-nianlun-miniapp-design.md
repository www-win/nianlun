# 年轮微信小程序版（MVP）设计文档

- 日期：2026-06-30
- 状态：已通过头脑风暴评审，待用户复核
- 主题：把「年轮 Nianlun」移植为微信小程序，数据经「文件传输助手」手动导入

## 1. 背景与目标

年轮当前是一个本地优先、保护隐私的 web 工具：把微信聊天记录导出文件转换成结构化好友表和年度报告海报，全程在浏览器内完成，无后端、不上传。

本次目标：在 **不破坏现有 web 版** 的前提下，新增一个**微信小程序版**，让用户在微信内就能完成「导入 → 出报告」的核心闭环。

### 核心约束（来自微信平台，已与用户确认）

- 微信**不开放**读取聊天记录的 API，小程序**无法主动/静默**读取任何聊天（含文件传输助手）的内容。
- 小程序从聊天获取文件的**唯一合法通道**是 `wx.chooseMessageFile()`——弹出「从聊天选择文件」选择器，由用户**手动点选**后小程序才能读到。
- 因此「从聊天助手获取数据」落地为：用户主动点导入按钮 → 手动从聊天里选中此前发到文件传输助手的导出文件。

### 部署与成本（已与用户确认）

- 小程序代码包托管在**微信官方平台（腾讯）**，不是用户自己的服务器；用户不持有 web 那种站点服务器。
- 个人主体注册 AppID、代码包托管、审核、发布**全部免费**；自己测试用测试号连账号都不必注册。
- 升级迭代：开发者工具「上传 → 提交审核 → 发布」，用户侧自动无感更新；微信后台保留历史版本，可一键回滚、可分阶段灰度。
- **AI 接入与成本**（AI 为所有版本必备，接入层可插拔，详见 §6）：
  - 数据导入/统计/出报告/存储全程本地，**这部分永远不联网、零成本**。
  - AI 后端**两种可切、构建期配置**：A）**云开发云函数**（默认起步，免运维、免备案域名、免费额度超量按量）；B）**公司/自有服务器 HTTPS 反代**（无超额风险、用现成机器，前提是域名已备案）。
  - 先用 A 跑通，超额或想自控时切 B，上层代码不变；两者都不需要为本项目新购服务器、不需要为 gaccode 单独备案。

## 2. 范围

### 做（MVP）

1. **导入**：`wx.chooseMessageFile()` 选文件 → 读取 → 解析 → 本地持久化，支持多次导入累积。
2. **概览**：关键数字卡片（好友数、消息数、活跃天数等）。
3. **好友表**：列表 + 搜索 + 排序 + 行内编辑（编辑经 store，记 `userEdited` 并持久化）。
4. **报告**：canvas 绘制一页式年度海报 + 「保存到相册」。
5. **AI（gaccode，所有版本必备）**：报告文案、好友分析建议。经云开发云函数调用，详见 §6。复用 core 已有的 `buildReportCopyPrompt`/`buildFriendAnalysisPrompt`/`buildFriendSuggestionPrompt`/`extractFriendSamples`/`parseFriendSuggestion`。AI 为用户主动触发，未触发时小程序仍全程本地。

### 不做（YAGNI，留待后续）

关系网络图、多线程 Worker、加密 `.bak` 解析、图片 OCR 导入、云同步、上架审核流程的工程化。

## 3. 总体架构

复用「大脑」、重写「身体」。现有 `web → core` 单向依赖正是为多端复用准备的。小程序版**完全复用 `@nianlun/core`**（纯函数、零依赖），只替换 web 那层「适配器 + UI」。

monorepo 新增一个与 `web` 平级的 workspace 包：

```
packages/
  core/      ← 仅一处可移植性改造（见 §6），其余不动
  web/       ← 完全不动
  miniapp/   ← 新增：uni-app + Vue3 + Pinia，依赖 @nianlun/core
```

技术栈：**uni-app（Vue 3 语法）**。理由：与现有 web 的 Vue3 + Pinia 最接近，页面结构与 store 思路可大量复用，`core` 直接 `import`；一套代码后续还能编译到 H5/其他小程序。

## 4. 数据链路

完整端到端链路从用户手机的原始聊天记录算起，共五大步：

```
①【手机微信】聊天记录迁移到电脑微信
   我 → 设置 → 通用 → 聊天记录迁移与备份 → 迁移 → 迁移到电脑微信（手机扫码）
   ↓ 聊天记录进入电脑微信客户端本地数据库
②【电脑】WeFlow / WeLive 读取电脑微信本地库 → 导出 CSV/JSON
③【电脑】把导出文件发到「文件传输助手」
④【手机·小程序】「导入」按钮 → wx.chooseMessageFile()
   → 用户从聊天里手动点选该文件
   → wx.getFileSystemManager().readFile → 读出字符串
   → core.parseFile() → aggregate() → buildReport()
   → 结果写入 wx.storage（本地）
⑤【手机·小程序】概览/好友表/报告页从本地 store 读 → 出年度报告
```

### 范围边界：哪些在本项目代码内

| 步骤 | 由谁完成 | 在本项目范围内 |
|---|---|---|
| ① 手机→电脑迁移聊天记录 | 用户手动（**微信自带功能**） | ❌ 不写代码 |
| ② 电脑读库导出 CSV/JSON | WeFlow / WeLive（**第三方现成工具**） | ❌ 不写代码 |
| ③ 发到文件传输助手 | 用户手动 | ❌ 不写代码 |
| ④⑤ 小程序导入 + 出报告 | **年轮小程序** | ✅ 本次开发对象 |

①②③ 是小程序代码触及不到、也不该管的：①是微信官方迁移功能，②是 WeFlow/WeLive 读取电脑微信本地数据库（小程序在手机沙箱内无法访问电脑微信数据库，技术上不可能由小程序完成）。本次编码只负责 ④⑤。

④⑤ 全程在用户手机本地，不经任何服务器，与 web 版隐私承诺一致。`chooseMessageFile` 选 `.csv/.json/.txt`，对应 core 现有解析器（`pipeline/parseFile.ts` 嗅探分发）。

## 5. 适配层映射（web → miniapp）

每个适配器都做成**可注入的薄封装**（像 web 把 worker 做成可注入那样），以便用 vitest 跑纯逻辑测试。

| 能力 | web 现状 | miniapp 替换 | 备注 |
|---|---|---|---|
| 文件读取 | `adapters/fileReader.ts`（File API `.text()`） | `wx.getFileSystemManager().readFile({ encoding: 'utf8' })` | 输出同样的 `{ name, content }` 形状，保持解析入口不变 |
| 文件入口 | `<input type=file>` | `wx.chooseMessageFile({ type: 'file' })` | 返回的临时文件路径喂给 readFile |
| 解析执行 | Web Worker（`parse.worker.ts` + `parseClient`） | **MVP 主线程同步跑 core** | 导出文件通常数 MB，可接受；加 loading 态。保留把它抽成可注入函数的接口，后续可切 `wx.createWorker` |
| 持久化 | IndexedDB（`idb`） | `wx.setStorage`/`getStorage`，键：`friends` / `report` / `samples` | 接口对齐现有 `saveFriends/loadFriends/saveReport/loadReport/saveSamples/loadSamples/clearAll` |
| 状态管理 | Pinia | **Pinia 照用**（uni-app 支持 Vue3 + Pinia） | `data` / `import` store 逻辑几乎照搬 |
| 报告导出 | `window.print()` 海报 | canvas 绘制 → `wx.canvasToTempFilePath` → `wx.saveImageToPhotosAlbum` | 需 `scope.writePhotosAlbum` 授权 |
| AI 调用 | `adapters/aiClient.ts`（`fetch` → 同源 `/__ai` 代理绕 CORS） | `adapters/aiClient`（可插拔：`wx.cloud.callFunction`→云函数 或 `wx.request`→公司服务器反代） | 后端构建期可切，详见 §6 |

### 存储约束

`wx.storage` 单键约 1MB、总量约 10MB。好友聚合数据很小无压力；**样本（samples）必须保持有界**——core 已是有界样本设计（`extractFriendSamples`），刚好契合。完整原始聊天（`Conversation[]`）**仍绝不落盘**，与 web 版一致。

### 向后兼容

沿用 web 版 `loadFriends` 的做法：读取时对缺失的 `hourly/weekHour/keywords` 补默认值，保证旧存储升级后下游消费端拿到完整形状的 `Friend`。

## 6. AI 接入（gaccode）——可插拔后端

**决策：AI 分析是所有版本（开发 / 体验版 / 公开正式版）都必须具备的核心功能。** 接入层做成**可插拔**，同时支持两种后端、构建期切换，上层代码不变：

- **后端 A：微信云开发云函数**（默认起步）——`wx.cloud.callFunction`，免运维、免备案域名、有免费额度。
- **后端 B：HTTPS 反代（公司/自有服务器）**——`wx.request` 打一个备案 HTTPS 域名 → 转发到 gaccode，无云开发超额风险，用现成服务器。

两者都满足「服务端持有 Key + 转发 gaccode」，差别只在传输通道与运维/计费方式。先用 A 跑通，**量大或想规避云开发超额时切到 B，代码不改**。

### 切换成本

- **代码层面切换极简**：改一行构建期 env（`AI_BACKEND=cloud ⇄ proxy`）→ 重新 build → 上传发版。页面 / store / core 全不动。
- **真正成本只在「首次启用某后端」的一次性准备**：A＝开通云开发 + 部署 `aiProxy`；B＝跑起公司反代接口 + 域名入「request 合法域名」白名单。两边都备好后，来回切几乎无成本。
- **可选增强（后续，不在 MVP）**：把后端选择改为启动时拉取的云端开关，实现「线上随时切、连上传都免」。MVP 用构建期 env 即可。

AI 复用 core 已有的 prompt 构建与解析函数（`buildReportCopyPrompt`、`buildFriendAnalysisPrompt`、`buildFriendSuggestionPrompt`、`extractFriendSamples`、`parseFriendSuggestion`）。请求格式与 web 一致（Anthropic `/v1/messages`，`x-api-key` 头），区别只在「谁发出这个请求」。

### 抽象与架构

```
页面 → aiClient（统一接口：generateReportCopy / suggestFriend …）
        │  接口稳定，实现可切（构建期 env 选 A 或 B）
        ├─[后端 A] wx.cloud.callFunction('aiProxy', {prompt}) → 云函数 → gaccode
        └─[后端 B] wx.request(COMPANY_PROXY_URL, {prompt})    → 公司服务器 → gaccode
              → 返回文本 → core 解析 → 展示/写回 store
```

- **`aiClient`（前端适配器）**：对页面暴露稳定方法；内部按构建期配置选后端 A/B。做成可注入，测试传 mock。
- **转发层（云函数 `aiProxy` 或 公司服务器接口）**：薄转发——持有 Key、调 gaccode、基本限流、错误归一化、不落库不记聊天日志。prompt 由前端用 core 拼好后传入（MVP 选前端拼，最简单）。

### 两种后端对比

| | 后端 A：云函数 | 后端 B：公司服务器反代 |
|---|---|---|
| 客户端 API | `wx.cloud.callFunction` | `wx.request` |
| 合法域名白名单 | **不需要**（服务端外呼不受限） | **需要**：域名 ICP 备案 + HTTPS + 入白名单 |
| 运维 | 免运维（腾讯托管） | 你维护反代进程 |
| 成本 | 免费额度，超量按量计费 | 用现成服务器，基本零增量 |
| 前提 | 开通云开发（需正式 AppID） | 公司域名已备案、公网可达、允许出境外网 |
| 适用 | 起步、免运维 | 规避超额、长期自控 |

### 部署与成本

- **后端 A**：注册个人主体 AppID 并**开通云开发**（免费基础版），部署云函数 `aiProxy`（环境变量存 gaccode 地址与 Key）。免费额度内零成本，超量按量。
- **后端 B**：在公司备案域名下挂一个 HTTPS 接口跑反代，env 存 Key；把该域名加入小程序「request 合法域名」白名单。无云开发超额风险。
- 两者均**无需自建新服务器年费**（A 免运维 / B 用现成机器），**正式版均不需要为 gaccode 单独备案境外域名**。

### 隐私

- AI 为**用户主动触发**的功能，未触发时小程序全程本地、不上传。
- 触发时离开手机的内容（详见各功能）：报告文案 / 关系画像**仅聚合统计 + 好友名字，无聊天原文**；好友 rel/role 智能建议会发**有界聊天样本**（最多约 30 条 × 80 字，绝不发完整会话）。
- **发送前确认**：对会发送聊天样本的「智能建议」功能，首次触发时弹确认（「将发送约 30 条聊天片段到 AI 服务用于推断关系，是否继续？」），用户同意才发。这是小程序相对 web 版新增的隐私加固。
- 数据经云函数（你自己的云开发环境）转发到 gaccode；云函数不落库、不记录聊天内容日志。

## 7. core 的唯一改造：分词降级

问题：`packages/core/src/stats/segment.ts:5` 在**模块加载时**就 `new Intl.Segmenter('zh')`。小程序 JS 引擎（iOS 上为 JavaScriptCore）对 `Intl.Segmenter` 支持不稳定，一旦缺失会导致整个 core 模块加载失败、词频/关键词统计崩溃。

改造：把 `Intl.Segmenter` 从模块级实例化改为**懒加载 + 降级**：

- 首次 `tokenize` 时才尝试 `new Intl.Segmenter`，结果缓存。
- 捕获失败 → 回退到简单的中文二元（bigram）分词，保证关键词统计在任何引擎上都能出结果、不崩。
- 纯函数内部改动，不破坏 core 边界（仍无 DOM/无副作用），且让 web 版更健壮。
- 配套补降级路径单测。

## 8. 页面（4 个，对齐 web 数据契约，UI 用小程序原生组件重画）

1. **导入页**：大按钮调 `chooseMessageFile`；显示解析进度、warnings 数、累计好友数；多次导入复用 core 的 `mergeFriends`/`mergeConversations` 累积。**附「如何导出？」引导**：用一个可展开说明 / 引导区，把 §4 的前置步骤 ①②③（手机迁移到电脑 → WeFlow/WeLive 导出 → 发到文件传输助手）讲清楚，避免用户拿到小程序却不知道文件从哪来。引导文案为纯静态说明，不联网、不跳转外部。
2. **概览页**：关键数字卡片，从 `report` 读。
3. **好友表页**：列表 + 搜索 + 排序 + 行内编辑；编辑经 store 的 `updateFriend`，记 `userEdited` 并持久化（与 web 规则一致）。**好友详情可触发 AI 分析建议**（§6）。
4. **报告页**：canvas 绘制一页式年度海报 + 保存到相册；**可触发 AI 生成报告文案**（§6）。

页面必须从 store 读取，编辑经 `updateFriend`，绝不直接改 store 数据或直接调 core——沿用 web 版纪律。AI 调用经适配器，不在页面里直接 `wx.request`。

## 9. 测试

- **core**：仍 vitest，新增分词降级用例（模拟 `Intl.Segmenter` 缺失走 bigram）。
- **miniapp 逻辑层**：适配器（storage/fileReader 封装）与 store 用 vitest 跑；`wx.*` 做成可注入封装，测试时传入 mock（与 web 把 worker 做成可注入同理）。
- **UI 交互**：靠微信开发者工具真机预览验证（小程序 UI 难以纯单测覆盖）。
- **aiClient**：上层接口与两种后端实现均做成可注入，用 mock 跑请求构建/错误处理的纯逻辑测试（与 web `aiClient` 的 `FetchLike` 注入同理）。

## 10. 交付与运行

- **前置（按所选后端）**：
  - 注册个人主体小程序拿 AppID。
  - 后端 A（云函数）：**开通云开发**（免费基础版），部署云函数 `aiProxy`（环境变量填 gaccode 地址与 Key）。
  - 后端 B（公司服务器）：在公司备案 HTTPS 域名下部署反代接口（env 存 Key），把域名加入「request 合法域名」白名单。
  - AI 是必备功能，所选后端需在体验版前就绪。纯本地功能（导入/统计/报告）更早期可先用**测试号**跑通；云开发/正式白名单需正式 AppID，AI 联调时切到正式 AppID。
- **开发/自测**：微信开发者工具导入 `packages/miniapp` 产物，真机扫码预览；AI 走所选后端，与线上同一路径。
- **体验版**：上传 → 设体验版 + 加体验成员。本地 + AI 均可用。
- **公开正式版**：上传 → 提交审核 → 发布。AI 走 A 或 B，**均无需为 gaccode 单独备案、无需为本项目新购服务器**。

## 11. 风险与未决

- **`chooseMessageFile` 文件类型**：需真机验证 `.csv/.json` 能否被「聊天选择文件」识别；若个别后缀不被识别，引导用户改用 `.txt` 或在《使用说明》里说明。
- **大文件主线程解析卡顿**：MVP 接受，加 loading；若实测明显卡顿，后续切 `wx.createWorker`（接口已预留为可注入）。
- **uni-app 对 Pinia / 同步 import core 的兼容细节**：实施第一步先搭最小骨架（导入一个文件跑通 parse→存储→读出）验证工具链，再铺页面。
- **AI 后端成本/防刷**：后端 A 免费额度放量后可能超额按量计费 → 可切后端 B 规避；两种后端的转发层都要加基本限流（按用户/频率）、妥善保管 gaccode Key、不记聊天日志，防被刷。
- **后端 B 前提核对**：公司域名须已 ICP 备案、公网可达、服务器允许出境外网访问 gaccode；任一不满足则该后端不可用，回落后端 A。
- **依赖正式 AppID**：测试号不支持云开发，正式版白名单也需正式 AppID；纯本地功能不受此约束，可先行开发。
