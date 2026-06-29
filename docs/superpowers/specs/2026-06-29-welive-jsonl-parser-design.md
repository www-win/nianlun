# WeLive JSONL 导入解析器 — 设计文档

- 日期：2026-06-29
- 状态：已批准设计，待写实现计划
- 关联记忆：[[weflow-import]]、[[nianlun-project]]

## 背景与问题

用户用 **WeLive**（WeFlow 的后继工具）导出了一年的微信聊天记录，导出物位于
`C:\Users\MagicBooK\Desktop\welive_export\`。导出结构：

```
welive_export/
├─ exports/            每个会话一对文件
│   ├─ <sessionid>_<hash>.jsonl   每行一条消息的 JSON，UTF-8 —— 本体
│   └─ <sessionid>_<hash>.json    整体数组，UTF-16 LE，大量为 0 字节 —— 不用
├─ media/              空（本次未导出媒体）
├─ logs/              每会话 stdout/stderr
├─ final_summary.csv   各会话处理结果（列只有 session_id，无昵称）
├─ session_counts.csv  各会话消息数（同样无昵称）
├─ progress.json       含 "parse_content": false
└─ DONE
```

共 140 个会话，约 113 个非空。`progress.json` 的 `parse_content: false` 表示
WeLive 未解析富文本/媒体内容，因此非文本消息的 `message_content` 是不可读的
hex；纯文本（`local_type:"1"`）的 `message_content` 是明文。

**问题**：年轮当前无法导入这些 `.jsonl`。
1. `pipeline/parseFile.ts` 注册的 `weliveParser` 不存在；现有 `weflowParser` 是按
   *假想*格式写的（顶层 `{messages:[...]}`、字段 `createTime`/`isSender`/`nickName`），
   与真实 WeLive 数据完全不匹配，`canParse` 返回 false → 报「无法识别的文件格式」。
2. `ImportPage.vue` 的文件 `accept` 列表只有 `.json`，没有 `.jsonl`，用户在文件
   选择器里选不中 `.jsonl`。

## WeLive JSONL 实际格式

每行一个 JSON 对象，关键字段：

```json
{
  "create_time": "1782207175",        // Unix 秒
  "local_type": "1",                  // 消息类型；可能是复合 64 位值
  "sender_username": "wxid_xxx",      // 发送者；为空 ≈ 自己（me）
  "message_content": "文本正文",       // type=1 为明文；其他类型为不可读 hex
  "source": "28b52ffd...",            // zstd 压缩二进制（hex），不使用
  "table_name": "Msg_xxx", "_db_path": "..."  // 不使用
}
```

要点：
- **会话 id 不在内容里**，只在文件名 `<sessionid>_<8位hex>.jsonl` 中。
  - `sessionid` 例：`wxid_9n9z014h9axh22`、`25032865050@chatroom`、`gh_xxx`、`xxx@openim`。
- **群聊**：`message_content` 形如 `<sender_username>:\n<真正正文>`（带发送者前缀）；
  单聊无前缀。
- **发送者判定**：`sender_username` 为空字符串 ≈ 自己发送。
- **复合 local_type**：如 `266287972401` = `49 | (62<<32)`，低 32 位 `49` 才是基础类型。
- **无昵称**：整个导出（含两个 CSV）只有 wxid/群号，没有 wxid→昵称 的对照。

## 决策（已与用户确认）

1. **名字**：直接用 `sessionid`（wxid/群号）当好友名。导入后用户在好友页行内
   编辑（写入 `userEdited.alias`，再导入会保留）。不做联系人对照导入。
2. **范围**：解析时自动过滤公众号/服务号/文件助手等非好友会话，保留真人与群聊。
3. **群聊**：保留，每个群作为一个「好友」条目（`isGroup: true`），群内非我成员
   统一算 `them`。

## 方案

采纳**方案 A**：新增独立 `welive.ts` 解析器，最小化接线改动。
（已否决：B 改造 weflowParser 兼容 jsonl —— 两格式揉一起且 weflow 字段未验证；
C 在 web 侧预转换 —— 重逻辑越界进 web。）

### 1. 新解析器 `packages/core/src/parsers/welive.ts`

实现 `Parser` 接口。容错：坏行收进 `warnings`，绝不抛异常。

**canParse(fileName, sample)**
- 取 `sample` 第一个非空行，去 BOM 后必须以 `{` 开头且能体现 WeLive 签名：
  同时包含 `"sort_seq"`、`"create_time"`、`"local_type"` 三个键
  （这三个键都在行首附近 —— `message_content` 可能极长，2000 字符样本扫不到行尾的
  `sender_username`；并借此与 weflow 的 `createTime`/`isSender` 区分）。
- 不依赖 `.jsonl` 后缀。

**parse(content, onProgress, fileName)**
1. 从 `fileName` 求 `sessionid`：去掉尾部 `_<8位hex>.(jsonl|json)`；取不到时退化为去扩展名。
2. **服务号过滤**：若 `isServiceSession(sessionid)` → 返回 `{ conversations: [], warnings: [] }`
   （静默跳过，不产警告，避免 80+ 条噪音）。
   - `isServiceSession`：`sessionid` 以 `gh_` 开头，或属于集合
     `{ filehelper, weixin, notifymessage, brandsessionholder, brandservicesessionholder,
       fmessage, floatbottle, qmessage, medianote, newsapp }`。
3. `isGroup = sessionid.endsWith('@chatroom')`。
4. 逐行 `JSON.parse`：空行跳过；解析失败 → `warnings.push({ line, reason })` 后继续。
   - `ts = toMs(create_time)`（秒 → 毫秒）；`ts` 无效 → 跳过并记 warning。
   - `baseType = Number(local_type) % 0x1_0000_0000`（取低 32 位处理复合值）。
   - `type = mapType(baseType)`：`1→text, 3→image, 34→voice, 43→video,
     49→other, 10000/10002→system, 其余→other`。
   - `from`：`baseType >= 10000`（系统）→ `them`；否则 `sender_username` 为空 → `me`，
     非空 → `them`。
   - `text`：`type==='text'` 时取 `message_content`，并在群聊中剥离开头
     `<sender_username>:\n` 前缀（按该行的 `sender_username` 精确剥离；为空则不剥）；
     其他类型 `text` 留空字符串。
5. `id = peerName = sessionid`（满足 merge.ts 的 `id === peerName` 约定）。
6. 返回 `{ conversations: messages.length ? [conv] : [], warnings }`。

### 2. 接线

- **`packages/core/src/model/types.ts`**：`Parser.parse` 签名加可选第三参
  `fileName?: string`（其他解析器忽略，向后兼容）。
- **`packages/core/src/pipeline/parseFile.ts`**：把 `fileName` 透传给
  `parser.parse(content, onProgress, fileName)`；`PARSERS` 数组注册 `weliveParser`
  （放在 `weflowParser` 之后即可，靠内容签名互不冲突）。
- **导出**：无需在 `index.ts` 导出 —— `weflowParser` 同样只在 pipeline 内部注册、
  未对外导出；`weliveParser` 比照处理即可。
- **`packages/web/src/pages/ImportPage.vue`**：`accept` 加 `.jsonl`；格式标签数组
  增加一个 `.jsonl`。

> worker (`parse.worker.ts`) 已用 `parseFile(f.name, f.content)` 传入文件名，
> `parseClient.parseFiles` 已支持多文件数组，输入 `multiple` 已开启 —— 无需改动。

### 3. 测试（Vitest，core 包）

`packages/core/src/parsers/__tests__/welive.test.ts`，用真实文件的脱敏片段做
`fixtures/welive-*.jsonl`：
- 单聊：me/them 判定、type=1 取明文、ts 秒转毫秒。
- 群聊：`<sender>:\n` 前缀剥离正确；id/peerName=群号；isGroup=true。
- 复合 `local_type`（如 `266287972401`）映射为 `other`（base 49）。
- 系统消息（10000）归 `them`。
- 坏行/空行容错：不抛异常、收进 warnings、其余行正常解析。
- 服务号过滤：`gh_*` 与服务号集合返回空且无 warning。
- `canParse`：命中 WeLive jsonl，拒绝 weflow 对象与年轮备份数组。
- 文件名取 id：`wxid_x_aabbccdd.jsonl` → `wxid_x`；`25032865050@chatroom_bb6fc02f.jsonl`
  → `25032865050@chatroom`。

## 已知取舍 / 范围之外

- 图片/语音/卡片等非文本仍不可读（`parse_content:false`）；仅计入消息数，`text` 为空。
  若需可读，需在 WeLive 开启内容解析后重新导出（本设计不处理）。
- 好友名为 wxid，需用户手动改名；不实现联系人（wxid→昵称）对照导入。
- 不改动 `weflowParser`（保留其假想格式实现，互不影响）。
- 消息去重沿用现有 `ts|from|text` 键；同秒同文同向的极少数消息会被并为一条，可接受。
- `@openim` 一律保留为联系人（其中可能混有企业微信广告/服务，由用户在好友页自行删除）。
