# 年轮小程序 · 云备份/恢复 设计文档

- 日期：2026-07-08
- 范围：`@nianlun/miniapp`（不涉及 `@nianlun/web`、`@nianlun/core` 仅可能新增纯函数）
- 状态：待用户评审

## 1. 背景与问题

小程序里导入的好友数据会「莫名消失」：打开小程序一片空白，好友列表为 0。

根因（代码层已确认）：

- 好友等**大数据**存在手机文件系统 `wx.env.USER_DATA_PATH/nianlun_store/*.json`（[storage.ts](../../../packages/miniapp/src/adapters/storage.ts) `saveFriends` → [fsStore.ts](../../../packages/miniapp/src/adapters/fsStore.ts)）。
- 报告等**小数据**存微信 KV `wx.setStorageSync`。
- 好友列表 `hasData` 只看 `friends.length`（[data.ts](../../../packages/miniapp/src/stores/data.ts)），文件被清空即显示空白。
- 当初为突破微信 Storage「单键 1MB / 总量 10MB」限制，把大数据从 KV 迁到文件系统（commit `e2bc0ab`），而 `USER_DATA_PATH` 下的本地用户文件正是微信客户端最容易回收清理的区域（未收藏小程序被回收、部分客户端版本的清理行为等）。这次为了容量做的搬家，让数据落到了不耐久的地方。
- 排除了应用自身误删：启动 [App.vue](../../../packages/miniapp/src/App.vue) `onLaunch` 只清 `nianlun_raw`（原文）和解压临时目录，不碰 `nianlun_store`。是微信平台清的，不是本仓库代码删的。

用户消失规律「说不准/没规律」——可能只清文件（KV 存活），也可能整个小程序数据被回收（连 KV 一起清）。纯本地手段无法对抗后者。

## 2. 目标与非目标

### 目标

- 数据消失后，用户**打开小程序即自动恢复**全部数据，无需重新导入。
- 备份**全部处理后数据**：好友（含词云 keywords、逐时段 weekHour/hourly、月度 monthly）、聊天样本、荐股、报告、MBTI、AI 情绪/画像/报告文案/全年情绪、我的命盘/好友生辰/命理解读、已分析标记。
- 一份不落且面向未来：以「整个 `nianlun:` 命名空间 + `nianlun_store` 文件夹的完整快照」为备份单位，将来新增数据自动被带上，无需改备份代码。
- 备份走微信云开发（云存储），按 openid 隔离，用户之间互不可见。
- 上传/下载做 gzip 压缩，控制体积与耗时。
- **放大每人聊天样本留存**（30→60 条、每条 80→120 字），供后续 AI 分析更准、并为第二期问答 agent 打底；样本随备份一起上云。

### 非目标（本期不做）

- **不备份完整聊天原文**：现小程序本就不留原文（导入解析后即弃、启动还 `rawStore.clear()`）；用户目标是「不重新导入」，完整备份处理后数据即可满足，存原文只增体积与隐私风险，不做。放大的是**有界样本**（每人 60 条），不是全部消息。
- **不做好友问答 agent**：作为第二期独立设计文档，在本期落地后另立 spec。
- **不做多设备合并/冲突消解**：云端采用「最新覆盖旧的」（last-write-wins）。多机同时改的边界在文档「风险」中说明，本期不处理。
- **不做增量备份**：每次整包覆盖上传。

## 3. 用户须知（取舍与前置）

1. **隐私取舍**：本功能会把好友数据（名字/统计/AI 结果等处理后数据，**不含**聊天原文）上传到**用户自己的**腾讯云开发环境 `cloud1-d4gzww8dp909b47cb`。这与项目「本地优先、不上传」的初衷相反，是用户明确选择的取舍。
2. **一次性部署**（用微信开发者工具，与现有 `aiProxy` 云函数同法）：
   - 部署新增云函数 `getOpenId`。
   - 在云开发控制台确认云存储权限为「仅创建者可读写」。
3. **覆盖语义**：云端只保留最新一份；在某设备用较少数据备份会覆盖云端较全的那份（见「风险」）。
4. **样本放大只对将来导入生效**：样本在导入那一刻从原文截取，原文不留存。放大上限后，**新导入**自动留 60 条/人；**已有数据要变多，需现在重新导入一次**（仅此一次）。
5. **样本即真实聊天片段**：备份含每人约 60 条聊天样本（每条 ≤120 字），属真实对话内容上云；用户已知悉并接受（不上传的是「全部原文」而非「所有聊天片段」）。

## 4. 总体架构

沿用现有适配器分层：`core`（纯逻辑）→ `miniapp adapters`（wx 只在函数体内碰，可注入测试）→ `stores`（Pinia 编排）→ `pages`（UI）。

```
[import / edit] --saveXxx--> 本地(storage: 文件系统 + KV)
                                   │
                     backupStore.scheduleBackup()  (防抖)
                                   ▼
        cloudBackup.backup()  = 采集完整快照 → gzip → 上传云存储
                                   ▲
        cloudBackup.restore() = 下载 → gunzip → 写回本地 storage
                                   │
[App onLaunch] hydrate → 若 friends 为空 → 自动 restore → 再 hydrate
[设置/概览页] 手动「立即备份」「从云恢复」按钮
```

### 新增/改动清单

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/miniapp/cloudfunctions/getOpenId/` | 新增 | 返回调用者 openid（`cloud.getWXContext().OPENID`） |
| `packages/miniapp/src/adapters/cloudBackup.ts` | 新增 | `getOpenId()` / `backup()` / `restore()`；wx 仅在函数体内 |
| `packages/miniapp/src/adapters/storage.ts` | 改 | 新增 `exportAll()` / `importAll()`：整命名空间快照的序列化/反序列化 |
| `packages/miniapp/src/stores/backup.ts` | 新增 | 防抖调度、状态（备份中/恢复中/上次备份时间/错误） |
| `packages/miniapp/src/stores/data.ts` | 改 | `setData`/`updateFriend` 保存后触发 `scheduleBackup()` |
| `packages/miniapp/src/App.vue` | 改 | `hydrate` 后若本地空则 `restore()` 再 `hydrate` |
| `packages/miniapp/src/adapters/parseLocal.ts` | 改 | 调 `extractFriendSamples` 时传入放大的样本参数（60 条 / 120 字），全年样本与最近一月样本一致 |
| 概览页或新设置入口 | 改/新增 | 手动备份/恢复按钮 + 状态展示 |

> `extractFriendSamples` 的 core 默认值（30/80）不动，避免影响 `@nianlun/web`；放大仅在 miniapp 的 `parseLocal` 调用点通过 opts 传入，两处样本调用（全年 `samples`、最近一月 `recentSamples`）统一用同一组常量。

## 5. 模块设计

### 5.1 云函数 `getOpenId`

- 结构同现有 `aiProxy`（`index.js` + `package.json`，依赖 `wx-server-sdk`）。
- 逻辑：`exports.main = async () => ({ openid: cloud.getWXContext().OPENID })`。
- 用途：客户端上传/下载前取 openid，拼出隔离路径 `nianlun-backup/{openid}/backup.json.gz`。

### 5.2 `storage.ts` 新增：整命名空间快照

现有 `makeStorage` 已封装两处后端（`backend` = KV，`fs` = 文件系统 JSON）。新增两个方法，遵循「凡是持久化的都进快照」：

```ts
interface Snapshot {
  version: 1
  createdAt: number          // 由调用方传入（core/纯逻辑不取时间；见下）
  kv: Record<string, unknown>    // 所有 nianlun: 前缀键（排除已废弃 legacy 键）
  files: Record<string, unknown> // nianlun_store 下每个数据集：friends/samples/recentInsights/recentSamples/stocks
}

exportAll(): Omit<Snapshot, 'version' | 'createdAt'>   // 采集 kv + files
importAll(snap: Snapshot): void                        // 写回 kv + files（覆盖式）
```

- **KV 采集**：用 `backend.keys?.()` 列出所有键，保留 `nianlun:` 前缀且非 legacy（排除 `LEGACY_BIG_KEYS`、`nianlun:raw:*`、`nianlun:rawIndex`、`nianlun:fsjson:*` 退化键——真机不用退化键）。
- **文件采集**：显式枚举已知数据集名 `['friends','samples','recentInsights','recentSamples','stocks']`，逐个读取；`undefined`/不存在的跳过。
  - 说明：文件后端是「按 name 存 JSON」，无「列出所有 name」能力，故用显式集合。集合即「大数据数据集清单」，新增数据集时在此登记一处即可（文档「维护约定」记录）。
  - **性能取向**：文件采集返回**磁盘上已存的 JSON 原始字符串**（不 `JSON.parse` 成对象、上层也不再 `JSON.stringify`），避免「反序列化→再序列化」的双倍内存与 CPU（上万好友时是主要开销）。为此文件后端 `FsJsonBackend` 增补 `readRaw(name): string | undefined`（读原始文本，不解析）。快照里文件段以「name → 原始 JSON 字符串」承载。
- **写回**：`importAll` 对 `kv` 逐键 `backend.set`、对 `files` 逐个写回（文件段是原始字符串，直接 `writeRaw` 落盘，同样免去再序列化）；只增不删（不清除本地已有其它键），保证幂等且不破坏未覆盖的数据。

> 时间戳：`createdAt` 由 `cloudBackup`（adapter，可访问 `Date.now()`）注入，`storage.exportAll` 不取时间，保持可测。

### 5.3 `cloudBackup.ts`

```ts
export interface CloudBackupDeps {
  callOpenId: () => Promise<string>              // wx.cloud.callFunction('getOpenId')
  upload: (cloudPath: string, bytes: Uint8Array) => Promise<void>   // wx.cloud.uploadFile
  download: (cloudPath: string) => Promise<Uint8Array>              // wx.cloud.downloadFile
  gzip: (data: Uint8Array) => Uint8Array         // fflate gzipSync
  gunzip: (data: Uint8Array) => Uint8Array       // fflate gunzipSync
  storage: Pick<Storage, 'exportAll' | 'importAll'>
  now: () => number
}

backup(): Promise<{ bytes: number }>   // exportAll → JSON → gzip → upload
restore(): Promise<boolean>            // download → gunzip → JSON → importAll；无备份返回 false
```

- 路径：`nianlun-backup/{openid}/backup.json.gz`，覆盖上传（同 cloudPath 即覆盖）。
- openid 取一次后本次会话内缓存。
- 编码：`JSON.stringify(snapshot)` → `TextEncoder`→`Uint8Array` → `gzip`。真机 `wx.cloud.uploadFile` 接受本地临时文件路径，需先把字节写入 `USER_DATA_PATH` 临时文件再上传；下载得到临时文件路径再 `readFile` 成字节（在 adapter 的 wx 实现里处理，接口对上层只暴露字节）。
- **容错**：任何一步失败 `backup()` 抛错但不影响本地数据；`restore()` 下载 404/无文件 → 返回 `false`（视作「云端还没有备份」，非错误）。

### 5.4 `stores/backup.ts`

- 状态：`status: 'idle'|'backing'|'restoring'|'error'`、`lastBackupAt: number|null`、`error: string`。
- `scheduleBackup()`：防抖（如 5s）合并连续改动，到点调用 `cloudBackup.backup()`；成功更新 `lastBackupAt`（也持久化到 KV，供 UI 显示「上次备份时间」）。
- `backupNow()` / `restoreNow()`：手动按钮直接调用，带 UI 状态与 toast。
- 重入保护：备份/恢复进行中忽略新触发（同 import store 既有模式）。

### 5.5 启动自动恢复（`App.vue`）

```
onLaunch:
  ...(现有清理/cloud.init)...
  await useDataStore().hydrate()
  if (useDataStore().friends.length === 0):
      const ok = await backupStore.restoreNow({ silent: true })
      if (ok) await useDataStore().hydrate()
```

- 仅当本地为空才自动恢复，避免覆盖本地正常数据。
- 静默模式：失败不打断启动（吞错、留日志），因为可能只是没网或云端尚无备份。

### 5.6 手动入口（UI）

- 位置：概览页底部「数据与备份」区块（或新增设置页；实现期定，优先复用概览页，避免新增 tab）。
- 元素：「立即备份到云」「从云端恢复」两个按钮 + 「上次备份：yyyy-mm-dd hh:mm」+ 备份/恢复中 loading。
- 「从云端恢复」会覆盖本地，点击弹 `wx.showModal` 确认。

## 6. 数据流

**备份**：改动 → `scheduleBackup`（防抖）→ `exportAll` 采集 KV+文件 → 加 `version/createdAt` → JSON → gzip → 写临时文件 → `uploadFile` 覆盖。

**恢复**：`restore` → `downloadFile` → 读字节 → gunzip → JSON.parse → 校验 `version` → `importAll` 写回 KV+文件 → `hydrate` 刷新界面。

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 无网络 | backup/restore 抛错；自动恢复静默吞错，手动按钮 toast 提示 |
| 云端无备份（首次/新用户） | `restore()` 返回 `false`，不视为错误 |
| openid 云函数未部署/失败 | 抛「云备份未就绪，请先部署 getOpenId 云函数」 |
| gzip/JSON 解析失败（备份损坏） | `restore` 抛错，保留本地现状，提示重试或重新导入 |
| 上传超配额 | 抛错；提示体积过大/升配额（本期不自动分片） |
| version 不匹配（未来升级） | 保守：能读则读，不能读则拒绝并提示 |

## 8. 测试策略

Vitest；wx/云 API 全部通过 `CloudBackupDeps` 注入内存实现，无需真机。

- `storage.exportAll/importAll`：往返（export→import 后数据等价）；只增不删；忽略 legacy 键；空存储。
- `cloudBackup`：backup 调用链（export→gzip→upload 收到的字节 gunzip 回来等于原快照）；restore 往返；云端无文件返回 false；download 损坏字节抛错。
- `stores/backup`：防抖合并（多次 schedule 只上传一次）；重入保护；lastBackupAt 更新。
- 自动恢复：本地空→触发 restore→hydrate 后有数据；本地非空→不触发。
- 真机验证（人工）：部署 getOpenId 后，导入→删本地→重开自动恢复；两个手动按钮。

## 9. 性能与闪退防护（上万好友）

背景：目标用户可能有**上万好友**，属小程序内存的极端量级。导入本身不受本功能影响（解析/聚合是既有开销，样本 30→60 仅小幅增加），**主要风险在备份**：把「全部数据」拼成一个大 JSON 再纯 JS gzip，吃内存吃 CPU，低端机可能卡顿甚至 OOM 闪退。防护措施：

1. **备份不在导入关键路径**：导入完成、`status='done'`、列表已可用之后，才由防抖调度触发备份；备份全程后台，不阻塞界面与用户操作。
2. **免双重序列化**：文件段用磁盘原始 JSON 字符串直传（见 5.2 `readRaw`/`writeRaw`），不 parse 成对象再 stringify，砍掉内存峰值大头。
3. **gzip 较快档位**：fflate `gzipSync(data, { level: 4 })`（速度/压缩比折中），降低 CPU 峰值。
4. **体积阈值 + 优雅降级**：估算快照字节数，超过阈值 `BIG_THRESHOLD`（如 8MB）时，从「单包整体压缩上传」切到**按数据集分块**：每个数据集（friends/samples/... 及 KV 分组）各自 gzip 成独立文件（`nianlun-backup/{openid}/parts/{name}.json.gz`）逐个上传，把内存峰值从「全部之和」降到「最大的单个数据集」。恢复时按清单逐个下载合并。
   - 分块与单包共用同一 `exportAll`/`importAll`；差别只在打包/上传粒度。清单文件 `manifest.json` 记录本次是单包还是分块、含哪些 part、版本。
5. **失败即止、不拖垮**：任一分块上传失败即中止本次备份并保留状态，本地数据与已有云端备份不受影响；下次防抖或手动重试。
6. **真机压测（实现阶段必做）**：构造上万好友数据，在中低端真机上跑「导入→备份→删本地→恢复」，观测内存峰值与耗时，据此校准 `BIG_THRESHOLD`、gzip level、是否默认走分块。

> 诚实边界：不经真机实测无法保证零闪退；分块上传是**已设计好的后备路径**，真机压力大时即启用。

## 10. 风险与权衡

- **隐私**：处理后数据上云；已在「用户须知」明示，且为用户自有云环境、不含原文。
- **last-write-wins 覆盖**：多设备/重复导入较少数据可能覆盖云端较全备份。缓解：备份前可选比较 `friends.length` 明显变小则二次确认（本期可只加日志，UI 确认列为后续增强）。
- **云开发免费配额**：云存储容量与每日下载配额有限；处理后数据（gzip 后几 MB）通常无压力，若未来含更多数据需关注。
- **体积上限**：极端超大快照单包上传可能失败；本期已设计「按数据集分块上传」后备路径（见第 9 节），超阈值即切换。

## 11. 维护约定

- 新增「大数据数据集」（存 `nianlun_store` 的文件）时，须在 `storage.exportAll` 的文件集合里登记该 name，否则不会进备份。
- 新增 KV 键统一用 `nianlun:` 前缀即自动进备份；废弃键要加入 legacy 排除表。

## 12. 样本放大（本期一并做）

- 在 miniapp `parseLocal` 调 `extractFriendSamples` 时传 `{ maxPerFriend: 60, maxChars: 120 }`（全年 `samples` 与最近一月 `recentSamples` 两处一致）。
- core 默认值不变（30/80），web 不受影响。
- 仅对新导入生效；已有数据需重新导入一次才会变多（已在「用户须知」说明）。
- 测试：`parseLocal` 传入构造会话，断言每人样本条数上限为 60、单条 ≤120 字。

## 13. 第二期预告（不在本 spec 范围）

好友问答 agent（关系/性格/话题/统计档），在已备份 + 放大后的样本数据上做问答页，另立 spec。
