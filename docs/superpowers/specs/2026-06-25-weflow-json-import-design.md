# WeFlow JSON 导入 —— 设计文档

- 日期：2026-06-25
- 状态：已与用户确认，待写实现计划
- 范围：在 `@nianlun/core` 新增一个解析器，导入 WeFlow 导出的消息级 JSON

## 背景与目标

年轮（Nianlun）的输入是**用户已经导出好的**微信聊天记录文件；把数据从微信里取出（读取本地加密数据库 + 解密）明确在范围之外，且浏览器沙箱物理上做不到。

[WeFlow](https://github.com/hicccc77/WeFlow) 是一个**闭源、仅发布二进制**的本地桌面应用（Electron），它已经实现了最难的部分：实时读取并解密微信 4.0+ 的聊天数据。它对外提供两个复用接口：

1. **文件导出**：JSON / HTML / TXT / CSV / Excel / PGSQL / ChatLab 格式；
2. **本地 HTTP API**：`http://127.0.0.1:5031`，返回 JSON（README 标注"早期阶段、接口可能变动"）。

**目标**：让年轮"接住"WeFlow 的导出，使用户能用 WeFlow 取出记录、用年轮生成好友表与年度报告。

经讨论选定路线：**先 A 后 B**。
- **A（本次）**：文件导入——WeFlow 导出 **JSON** → 用户拖入年轮 → core 新增解析器产出 `Conversation[]` → 复用既有 `aggregate → report` 管线。
- **B（下一步，不在本设计实现）**：年轮网页直连 `127.0.0.1:5031` 拉数据。本设计通过抽出纯映射函数，确保 B 阶段零返工。

格式选 **JSON** 而非 CSV/TXT：JSON 结构化、字段清晰；聊天正文几乎必含逗号与换行，朴素 CSV 解析会崩，完整 CSV 转义不值得。

### 重要约束：字段名待真实样本确认

WeFlow 闭源，其 JSON 导出的**具体字段名无公开文档**。本设计给出的字段映射是**按微信经典字段做的假设**，必须用一份**真实导出样本**校正。"捕获样本"是实现的第一步、阻塞项。

## 架构

保持单向依赖链 `@nianlun/web → @nianlun/core` 不变。本次**只动 core**，web 端零改动（拖文件 → `parse.worker` → `core.parseFile` 自动分发的链路已存在）。

```
WeFlow.exe ──导出 JSON──> 用户拖入年轮 ──> parse.worker ──> core.parseFile
                                                              └─(嗅探)─> weflowParser ──> Conversation[]
                                                                            └─> 既有 aggregate → buildReport → Friend[] + ReportData
```

### 新增 / 改动文件

- 新增 `packages/core/src/parsers/weflow.ts` —— 实现 `Parser` 接口，把 WeFlow 消息级 JSON 解析成 `Conversation[]`；内部映射逻辑抽成纯函数 `mapWeflowMessages(raw): Conversation[]` 供 B 阶段复用。
- 新增 `packages/core/src/parsers/__tests__/weflow.test.ts` —— 基于真实导出脱敏 fixture 的测试。
- 新增 `packages/core/src/parsers/__tests__/fixtures/weflow-sample.json` —— 脱敏样本（真字段名 + 假正文）。
- 改 `packages/core/src/pipeline/parseFile.ts` —— 把 `weflowParser` 注册进 `PARSERS`。

遵守 CLAUDE.md：**不改动现有 txt/html 解析器**；解析器**容错**，坏数据进 `warnings` 永不抛异常；core 不碰 DOM，仅用 ES2020 内置的 `JSON.parse`。

## 解析器契约（`weflowParser`）

实现 `Parser` 接口（见 `model/types.ts`）：`name`、`canParse(fileName, sample)`、`parse(content, onProgress) → ParseResult`。

### `canParse` —— 靠内容签名消歧

不能只看 `.json` 后缀：年轮**自己**的 JSON 备份（`backup.ts` 的 `parseJsonBackup`，好友汇总，字段为 `name/rel/msgCount`）也是 `.json`。WeFlow 导出是**消息数组**，每条含时间戳/发送者/正文字段。

`canParse` 判定：内容 `JSON.parse` 后是数组（或含消息数组的对象），且元素带消息级签名字段（时间戳 + 发送者 + 正文），而**非**好友汇总字段。具体签名字段在样本确认后定稿。必须保证：WeFlow 消息 JSON 命中、年轮自家好友备份 JSON **不**命中。

### `parse` —— 字段映射（待样本确认）

下表右列为**假设**，第一步用真实导出校正：

| 年轮 `Message` | WeFlow JSON（假设，待样本确认） | 处理 |
|---|---|---|
| `ts`（毫秒 number） | `CreateTime` / `createTime`（多半是秒） | 若为秒 ×1000 |
| `from`（`me`/`them`） | `IsSender` / `isSelf`（1=我） | `=== 1 ? 'me' : 'them'` |
| `type` | 微信消息类型码（1=text、3=image、34=voice、43=video、1xxxx=system） | 映射表，未知归 `other` |
| `text` | `content` / `StrContent` / `msg` | 直接取；非文本类可空 |
| 会话 `peerName` | `nickname` / `talkerName` | |
| 会话 `isGroup` | 会话 id 以 `@chatroom` 结尾，或显式 `isGroup` 字段 | |
| 会话 `id` | `talker` / `wxid` | 稳定主键，供多文件合并去重 |

类型映射目标为 `model/types.ts` 的 `Message['type']`：`'text' | 'image' | 'voice' | 'video' | 'system' | 'other'`。

### 容错策略

- `JSON.parse` 失败 → 返回 `{ conversations: [], warnings: [一条原因] }`，不抛异常。
- 单条消息字段缺失/损坏 → 跳过该条并记一条 `warning`，不影响其余消息。
- 空文件 / 无可用消息 → 返回空 `conversations`。

### 多文件导入

WeFlow 可能一个会话导出一个文件。年轮已支持多文件合并（`merge/merge.ts`：`mergeConversations` 按消息去重、`mergeFriends` 按 id 合并并保留 `userEdited`），天然兼容，本设计无需额外处理。

## 数据流（端到端）

1. 用户在 WeFlow 导出会话 JSON；
2. 拖入年轮 ImportPage，`importStore.run(files, year)` 读文件 → `parseClient.parseFiles` → Worker；
3. Worker 调 `core.parseFile`，`canParse` 命中 `weflowParser`，`parse` 产出 `Conversation[]`；
4. 既有 `aggregate` → `Friend[]`，`buildReport` → `ReportData`；
5. 合并进已有数据并持久化（只存聚合结果，绝不存原始聊天文本）；
6. 好友表与年度报告页照常渲染。

## 测试策略（TDD + Vitest）

1. **样本捕获（第一步、阻塞项）**：用户导出真实 WeFlow JSON → 落脱敏 fixture（真字段名 + 假正文）→ 校正字段映射表。
2. **基于 fixture 的测试**：
   - 私聊：正确产出 `Conversation`，`from` 正确区分我/对方，`ts` 转为毫秒；
   - 群聊：`isGroup=true`，`@chatroom` 识别；
   - 类型映射：text/image/voice/video/system，未知 → `other`；
   - 容错：坏 JSON → 空结果 + warning 不抛异常；单条坏消息 → 跳过 + warning；
   - `canParse` 消歧：WeFlow 消息 JSON 命中、年轮自家好友备份 JSON **不**命中（关键回归）；
   - 端到端：fixture 过 `parseFile → aggregate → buildReport`，断言好友表与报告字段（复用 `__tests__/integration.test.ts` 模式）。

## 范围 / 非目标（YAGNI）

**做**：消息级 WeFlow JSON → `Conversation[]` 的解析器 + 注册 + 测试。

**不做**：
- 不做提取 / 解密（WeFlow 的职责）；
- 不解析图片 / 语音 / 视频的媒体内容，只用其**类型**计数；
- 不支持 WeFlow 的其它格式（CSV / TXT / Excel / PGSQL / ChatLab）；
- 不动 web、不动现有解析器、不引新依赖；
- 不实现 B 阶段（API 直连）——仅通过抽出纯映射函数为其预留。

## B 阶段衔接（不在本次实现）

把"WeFlow 消息形状 → `Conversation[]`"的映射抽成纯函数 `mapWeflowMessages(raw)`，`weflowParser.parse` 仅为"`JSON.parse` 后调它"。将来做 B（web 适配器 fetch `127.0.0.1:5031`）时，API 返回的是同一套 JSON，复用同一纯函数，core 侧零改动。

## 风险

- **字段假设错误**：靠"样本先行"消解——不基于假设写实现，先拿真实导出对齐。
- **WeFlow 格式随版本变化**：本次只锁定文件导出；若结构变动，仅需更新映射函数与 fixture。
- **`.json` 与自家备份冲突**：靠 `canParse` 内容签名消歧，并以专门回归测试守护。
