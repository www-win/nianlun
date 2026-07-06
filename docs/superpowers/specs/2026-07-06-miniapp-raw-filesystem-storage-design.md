# 小程序原文留存改用文件系统 — 设计 spec

- 日期：2026-07-06
- 范围：`packages/miniapp`（core 仅在入口补一处纯导出，不改逻辑）
- 状态：已与用户确认，待生成实施计划

## 一、背景与问题

小程序最近新增「导入时留存原始聊天文本」功能（提交 `eb84929`），把原始聊天全文分块写入微信 **Storage**。真机联调时导入 `batch_01.zip` 报错：

```
导入失败:APP-SERVICE-SDK:setStorageSync:fail exceed storage max size 10Mb
```

根因已定位：

- `batch_01.zip` 解压后 6 个 jsonl 共 **27.2 MB**，其中三个大群各约 **9.5 MB**（一年消息量）。
- 微信 **Storage 总上限仅 10 MB**，原文（几十 MB/批、全年几百 MB）差了一两个数量级。
- 现有 `appendRawFilesImpl` 先 `clearRawImpl()` 清旧块、再逐块 `set`，写到一半撑爆后异常虽被内层 `try/catch` 吞掉，但**残留的半截 raw 块已占满 Storage**，连累随后 `saveRecentInsights/saveRecentSamples` 再次失败 → 最外层 catch → **整个导入失败**。

**结论：在 10 MB Storage 里留存原始全文这条路走不通，必须换存储介质。**

同时确认：这也是「一打开小程序就卡 26 秒 + `Error: timeout`」的疑似同源问题——启动时加载接近撑满的 Storage 导致缓慢；清空 Storage 后应一并缓解（留待验证）。

## 二、目标与非目标

### 目标

1. 原文留存改用**文件系统**（`wx.env.USER_DATA_PATH`，真机约 200 MB，远大于 Storage 10 MB）。
2. **导入永远成功**：好友/报告/样本等分析结果一定先存好；原文留存优雅降级，绝不再拖垮导入。
3. 只留存**有用的**原文（真人会话），跳过公众号（`gh_`）与系统会话。
4. 一次导入数据过量时给**软保护提示**，引导分批导入，但不强制拦截。

### 非目标

- 不实现「二级分析」的分析逻辑本身（只预留读取接口）。
- 不改变解析、套名（contacts.json）、报告海报、AI 关系分析等任何用户可见功能。
- 不解决「全年几百 MB 原文全部留存」——真机文件系统 ~200 MB 也装不下全部，靠优雅降级"能存多少存多少"。

## 三、架构总览

新建独立模块 `adapters/rawStore.ts`，把原文相关逻辑从 `adapters/storage.ts` **整体搬出**：

- `storage.ts` 回归本职：只管好友/报告/样本/最近数据等**小的聚合数据**（Storage）。
- `rawStore.ts` 专管**大的原文文件**（文件系统）。

`rawStore` 仿照现有 `fileReader.ts` 的做法，**注入一个文件系统接口**，真机用 `wx.getFileSystemManager()`，测试用内存 mock：

```ts
export interface RawFsBackend {
  ensureDir(dir: string): void          // 目录不存在则创建
  writeFile(path: string, data: string): void
  readFile(path: string): string
  readdir(dir: string): string[]
  stat(path: string): { size: number }
  unlink(path: string): void
  exists(path: string): boolean
}
export function makeRawStore(fs: RawFsBackend, baseDir: string) { /* ... */ }
```

原文根目录：`${USER_DATA_PATH}/nianlun_raw/`。

## 四、rawStore 模块设计

### 4.1 存储组织：一文件一份，按原名存

每个待留存的 jsonl 存成目录下**同名的一个文件**：`nianlun_raw/<原文件名>`。

- 分片文件（`17657663110@chatroom_00000000.jsonl` / `_00000001.jsonl`）名字不同 → 各存各的，不互相覆盖。
- 同一文件重复导入 → 同名覆盖，天然去重/更新。

文件名安全：写入前对文件名做基础清洗（去掉路径分隔符等），避免越权写到目录外。

### 4.2 留存范围：只存有用的

留存前过滤，跳过非好友会话，复用 core 已导出的判定：

```ts
import { isServiceSession, sessionIdFromFileName } from '@nianlun/core'
// 跳过 gh_ 公众号与系统会话（filehelper/weixin/... ）
const keep = (name: string) => !isServiceSession(sessionIdFromFileName(name))
```

> `isServiceSession` 与 `sessionIdFromFileName` 定义于 `parsers/welive.ts`，但 core 入口 `index.ts` **尚未导出**（已核实）。实施时在 `packages/core/src/index.ts` 补出口即可——纯新增导出，不改任何逻辑。

### 4.3 铁律：核心先存，原文优雅降级

`import.ts` 的 `run()` 调整存储顺序：

1. **先**存全部聚合结果：`data.setData(friends, report)` → `saveSamples` → `saveRecentInsights` → `saveRecentSamples`。这些都在 Storage、体积小、必成功。
2. **最后**才 `rawStore.appendFiles(keptChatFiles)` 留存原文。

`rawStore.appendFiles` 内部**逐个文件写入**，每个 `writeFile` 包裹 `try/catch`：

- 写成功 → 计数 +1。
- 写失败（文件系统满/配额超限等）→ **停止后续写入**，返回"已存 N 个 / 因空间不足跳过 M 个"，**绝不向上抛异常**。

`run()` 中对 `rawStore.appendFiles` 整体再包一层 `try/catch`，失败仅追加 warning（如"原文留存已达存储上限，已保留 N 个"），导入状态照常 `done`。

### 4.4 软保护：数据过量时提示分批

在 `import.vue` 的 `onImport` 里、读入文件后、调用 `imp.run` 前评估：

- 触发条件（初值，可调）：待留存有效原文**总字节 > 50 MB** 或 **有效文件数 > 50**。
- 触发时 `uni.showModal`：标题"数据较大"，内容"本次约 X MB / Y 个文件，建议分批导入以免卡顿，仍要继续吗？"，`confirm` 才继续，`cancel` 则中止本次导入（不改动任何已存数据）。
- 不触发则照常导入。

### 4.5 读取与清理接口（供将来二级分析）

```ts
listRawFiles(): { name: string; size: number }[]   // 列已存原文
readRawFile(name: string): string                   // 读单个
readAllRawFiles(): { name: string; content: string }[] // 读全部（将来二级分析）
count(): number                                     // = 目录文件数，供「已留存原文 X 个」
clear(): void                                        // 删整个 nianlun_raw 目录
```

所有读取对"目录不存在/文件缺失"容错返回空，绝不抛。

## 五、配套改动

- **`types/wx.d.ts`**：`FileSystemManager` 补写入/管理类同步 API 声明——`writeFileSync`、`mkdirSync`、`accessSync`（判存在）、`unlinkSync`、`rmdirSync`，`statSync` 返回值补 `size`。
- **`adapters/storage.ts`**：删除 `saveRawFiles/loadRawFiles/appendRawFiles/clearRaw` 与 `K_RAW_INDEX/K_RAW/RAW_CHUNK_CHARS/RawChatFile` 及相关内部函数；`clearAll` 不再处理 raw。`RawChatFile` 类型迁移到 `rawStore.ts`。
- **`stores/import.ts`**：改调 `rawStore`；`rawSavedCount` 改为 `rawStore.count()`；调整存储顺序（4.3）。
- **`stores/data.ts`**：`clear()` 除 `storage.clearAll()` 外，一并 `rawStore.clear()`。
- **`pages/import/import.vue`**：`pickAndRead(500)`（已改）；新增软保护（4.4）；"已留存原文 X 个"数据源改为 `rawStore.count()`。

## 六、测试策略

- **`rawStore` 新测**（注入内存 `RawFsBackend`）：一文件一份往返、分片不覆盖、同名覆盖去重、跳过 `gh_`/系统会话、逐个写入遇失败即停且不抛、`count/list/read/clear` 正确。
- **`storage.test.ts`**：删除原 raw 相关 7 个测试（功能已迁走）。
- **`import.test.ts`**：更新 `rawSavedCount` 相关断言指向 `rawStore`；补"核心数据先存、原文留存失败不影响导入 `done`"。
- **软保护**：`onImport` 逻辑较薄，优先把阈值判断抽成可单测的纯函数（输入文件列表 → 是否提示 + 文案数据）。
- 全量 `pnpm --filter @nianlun/miniapp test` 通过。

## 七、数据迁移与兼容

- 旧的 Storage raw 块（`nianlun:raw:*`、`nianlun:rawIndex`）不再读写。用户当前 Storage 已撑爆，需先 `wx.clearStorageSync()` 清空（已提供）。无需写迁移代码：原文本就是"可从源文件重导"的派生数据。
- **向后兼容**：contacts.json 套名（`isContacts` 分流）、解析、报告、AI 分析全部不变。`contacts.json` 因 `isContacts=true` 不进 `chatFiles`，天然不会被当原文留存。

## 八、本次已一并修复（非本 spec 主体，记录在案）

- `pickAndRead(10) → pickAndRead(500)`：修「多文件导出一次只能选 10 个、好友大量丢失」根因（已验证 48 文件 → 11 好友）。
- `onImport` 补 `try/catch` + `uni.showToast`：修「读文件/解压出错被静默吞掉、表现为选完文件没反应」。
- 启动诊断插桩（`App.vue`/`import.vue` 的 `[boot]` 日志）：为排查启动 26 秒卡顿临时加入，**实施阶段结束前删除**。
