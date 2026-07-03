# 设计：小程序「导入时持久化原始聊天文本」

- 日期：2026-07-03
- 范围：`packages/miniapp`
- 目标读者：本仓库开发者
- 状态：待实现

## 一、背景与目标

客户（投资圈用户）将于今日下午现场导入全年微信聊天。未来要开发「二级市场荐股分析」，需要**通读全年原文**抽取「谁推了什么票 / 逻辑 / 目标价」。但当前小程序导入后**只持久化统计 + 每人 ≤30 条抽样样本，原文用完即丢**，将来做荐股分析时只能让客户**重新导入**。

**目标**：导入时把**原始聊天文本**存进小程序本地，将来二级分析开发时可**直接读回、无需客户重导**。

**关键事实**：客户全年数据约 4MB（见需求文档），可容纳进小程序本地存储（整体 10MB 上限）。

## 二、非目标（本次不做）

- 不实现 AI 荐股抽取（那是后续独立开发）。
- 不改 `@nianlun/core` 纯函数边界、不改 `parseLocal` 返回值。
- 不改 UI、不改导入交互流程。
- 不做加密、不做跨设备同步（数据仅存本机、不上传）。

## 三、隐私说明

本变更**对该客户放开「原文不落盘」**：原始聊天将存入客户手机本地存储。**数据仍仅存本机、绝不上传**。此为客户自有私密工具、且客户明确要求复用数据，已确认接受。

## 四、设计

### 4.1 存什么

存**原始文件文本**：`RawChatFile[] = { name: string; content: string }[]`。
- 不存解析后的 `Conversation[]`（避免改 `parseLocal` 返回值、体积更小）。
- 将来读回后用现有 `parseFile` 重解析即可。

### 4.2 存哪里 + 分块

复用现有 `makeStorage(backend)` 的 `StorageBackend`（`get/set/remove`，默认 `wxBackend` 走 `wx.*StorageSync`）。

小程序单键上限 1MB，故对序列化后的 blob 做**通用分块**：

- 索引键 `nianlun:rawIndex` 存 `{ count: number; chunkSize: number }`。
- 数据键 `nianlun:raw:0`、`nianlun:raw:1` …，每块为 JSON 字符串的一段，长度 < 分块阈值（默认 512KB，留安全余量）。
- 读回时按 `count` 顺序拼接所有块 → `JSON.parse` → `RawChatFile[]`。

### 4.3 API（加在 `makeStorage` 返回对象上）

- `saveRawFiles(files: RawChatFile[]): void` —— 覆盖式写入（分块 + 写索引；先清旧块再写）。
- `loadRawFiles(): RawChatFile[]` —— 按索引读回并拼接；无数据 / 解析失败返回 `[]`（容错，绝不抛）。
- `appendRawFiles(files: RawChatFile[]): void` —— 读回既有 → 追加去重（按 `content` 精确相等去重）→ `saveRawFiles`。
- `clearRaw(): void` —— 删除索引与全部数据块。
- `clearAll()` 追加调用 `clearRaw()`，保证清库时原文也一并清除。

### 4.4 接入点

仅改 [packages/miniapp/src/stores/import.ts](../../../packages/miniapp/src/stores/import.ts) 的 `run()`：在 `chatFiles` 解析成功、已 `saveSamples` 之后，追加一行：

```ts
storage.appendRawFiles(chatFiles)   // chatFiles: LocalFile[] = { name, content }[]
```

`LocalFile` 结构与 `RawChatFile` 一致，直接透传。其余流程不变。

### 4.5 将来消费（本次不实现，仅约定接口）

未来二级分析：`storage.loadRawFiles()` → 对每个 file `parseFile(name, content)` → `mergeConversations` → 抽荐股。

## 五、测试（Vitest，复用现有内存 backend）

在 `packages/miniapp/src/adapters/__tests__/storage.test.ts` 增补：

1. `saveRawFiles` + `loadRawFiles` 往返一致（小数据，单块）。
2. **超过单块阈值的大数据**（构造 >1MB 文本）正确分块并完整读回（验证分块逻辑）。
3. `appendRawFiles` 累加多次导入、且**内容相同去重**。
4. 无数据时 `loadRawFiles()` 返回 `[]`；损坏索引时容错返回 `[]`。
5. `clearAll()` 后 `loadRawFiles()` 为 `[]`。

在 `packages/miniapp/src/stores/__tests__/import.test.ts` 增补：

6. `run()` 成功导入后，`storage.appendRawFiles` 被调用且原文可经 `loadRawFiles()` 读回。

## 六、风险与回滚

- **存储配额超限**：4MB + 现有数据仍 < 10MB；分块阈值留余量。写入包 try/catch，超限只告警、不阻断导入（导入主流程绝不因原文存储失败而失败）。
- **回滚**：变更集中在 `storage.ts`（新增方法）+ `import.ts`（一行）。回滚只需移除该行与新增方法；已存原文由 `clearRaw`/`clearAll` 清理。

## 七、交付顺序

TDD：先写 storage 分块往返测试 → 实现 → 写 import 接入测试 → 接入 → 全量 `pnpm --filter @nianlun/miniapp test` 绿。
