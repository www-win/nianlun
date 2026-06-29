# WeLive 联系人对照导入（好友显示真名）— 设计文档

- 日期：2026-06-29
- 状态：已批准设计
- 关联：[[2026-06-29-welive-jsonl-parser-design]]、记忆 [[weflow-import]]

## 背景与问题

上一步已能导入 WeLive `.jsonl`，但导出物里**完全没有昵称**（jsonl 仅 20 个字段、两个 csv 仅 `session_id`、logs 空），好友名只能是 wxid/群号。已确认（`welive --help`）welive CLI 有联系人命令：`contacts`、`sessions`、`display-names`。用户运行 `welive contacts` 得到 `contacts.json`（716KB / 2134 条），`welive sessions` 得到 `sessions.json`（140 条）。

实测结构：
- **contacts.json**：数组，元素 `{username, user_name, remark, nick_name, alias, local_type, quan_pin, ...}`。
  - `username` = wxid 或 `xxx@chatroom`
  - `remark` = 备注名（用户自定义，可能空）
  - `nick_name` = 微信昵称（群聊时即群名）
  - `local_type`：0/2/5/6=服务等、1=好友(376)、3=群成员(1692，非好友)
  - 群聊在内（16 条 @chatroom，`nick_name` 即群名，`remark` 空）
- **sessions.json**：无干净群名字段（`last_sender_display_name` 是最后发言人，非群名）→ **不使用**。

## 决策（已与用户确认）

1. 名字来源：`contacts.json`，名字 = `remark` 优先，否则 `nick_name`；两者皆空则跳过。群聊用 `nick_name`。
2. 触发：用户把 `contacts.json` 和 `.jsonl` 一起选入同一个导入框，自动识别。
3. 显示：好友列表只显真名（设到 `friend.name`），wxid 不显示（仍是内部 id）。没对上名字的仍显 wxid。
4. 不被覆盖：真名记进 `userEdited.name`，扩展现有"用户编辑优先"，再导 jsonl 不会重置；用户手动 `alias` 备注不受影响。

## 架构选择

`parseWeliveContacts` 与 `applyContactNames` 都很轻量（JSON.parse 716KB ≈ 1ms）。**项目现状已在主线程调用 core 的 `mergeFriends`**（`stores/import.ts`），因此联系人解析与套名也走主线程、与 `mergeFriends` 同处调用，**不改 worker/protocol/parseClient**，改动最小。

## 方案

### 1. core 新增（纯函数）

**`packages/core/src/parsers/welive-contacts.ts`**
- `isWeliveContacts(sample: string): boolean` —— 去 BOM 后 trim 以 `[` 开头，且包含 `"username"` 且包含 `"nick_name"` 或 `"remark"`，且包含 `"local_type"`（区别于年轮好友备份数组：那是 `{name, rel, msgCount}`，无 username/nick_name）。
- `parseWeliveContacts(content: string): Array<{ id: string; name: string }>` —— `JSON.parse`；对每个元素取 `id = username`，`name = (remark || nick_name).trim()`；name 为空或 id 为空则跳过。解析失败返回 `[]`（容错不抛）。

### 2. core 套用名字 + 保留

**`packages/core/src/merge/merge.ts`** 新增：
- `applyContactNames(friends: Friend[], names: Array<{ id: string; name: string }>): Friend[]` —— 返回新数组；对 id 命中的好友设 `name` 与 `userEdited.name`；未命中保持不变。
- 修改 `mergeFriends`：保留 `userEdited.name`（同 alias）：`merged.name = old.userEdited.name ?? inc.name`；`merged.userEdited = { ...inc.userEdited, ...old.userEdited }`（已含 name）。

**`packages/core/src/model/types.ts`**：`userEdited: { role?; rel?; alias?; name? }`。

**`packages/core/src/index.ts`**：导出 `parseWeliveContacts`、`isWeliveContacts`、`applyContactNames`。

### 3. web 接线

**`packages/web/src/stores/import.ts`** `run()`：
- 文本文件读出后，按 `isWeliveContacts(content)` 拆成 `contactFiles` 与 `chatFiles`。
- `chatFiles` 走原 `parseFiles`(worker) 得 `outcome`。
- `contactFiles` 用 `parseWeliveContacts` 合并成 `names: {id,name}[]`。
- `merged = mergeFriends(data.friends, outcome.friends)`；`named = applyContactNames(merged.friends, names)`；`setData(named, outcome.report)`。
- 若本次只选了 contacts（无聊天文件）：对**现有好友**套名（`applyContactNames(data.friends, names)` 后 setData，report 用现有 `data.report`）。
- warnings 增加一条："已套用联系人名字 N 个"（可选，便于反馈）。

> 显示无需改 FriendsPage（已渲染 `f.name`）。

### 4. 测试（Vitest）

- core `parsers/__tests__/welive-contacts.test.ts`：remark>nick_name、群取 nick_name、空名/空 id 跳过、坏 JSON 返回 []、`isWeliveContacts` 命中 contacts、拒绝聊天 jsonl 与好友备份数组。
- core merge 测试：`applyContactNames` 命中设 name+userEdited.name、未命中不变；`mergeFriends` 保留 userEdited.name（再导 jsonl 不重置）。
- web `stores/__tests__/import.test.ts`：选入 contacts + jsonl，好友 name 变真名；只选 contacts 对现有好友套名。

## 已知取舍 / 范围之外

- 群成员（local_type 3）名字也进映射，但只有 id 命中会话好友才生效，多余条目忽略。
- 服务号/公众号本就被 jsonl 解析器过滤，不会成为好友，故其名字不影响。
- 不读取 `sessions.json`、不做 `display-names`/头像/群成员昵称。
- 不解决压缩正文（`WCDB_CT_message_content:"4"` 的 zstd 文本）—— 另案。
