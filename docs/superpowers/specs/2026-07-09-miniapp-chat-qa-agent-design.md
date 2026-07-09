# 微信聊天记录问答 Agent（小程序端）— 设计

日期：2026-07-09
分支：feature/miniapp-cloud-backup
范围：仅 `@nianlun/miniapp`（微信小程序），共享逻辑落在 `@nianlun/core`。

## 目标

给小程序加一个可以**自由问答**的 agent：用户用大白话问关于自己微信聊天记录的任何事，
不限内容、不限类型。它翻用户**本机**的聊天记录 + 统计来回答，答不出就承认，绝不编造。

两类问题都要覆盖：

- **具体事实回忆**（走全量原文）：「我和张三上次聊什么了」「谁约我吃饭」。
- **规律/关系洞察**（走样本 + 聚合统计）：「我今年跟谁聊得最多」「我的聊天风格」。

对话形态：**多轮聊天**（记住上下文，可追问「那他呢」）。

## 关键约束与既有事实

- 单向依赖链 `miniapp → core` 不变。core 保持纯函数、不碰 wx/DOM。
- 全量原始聊天存在本机文件系统 `nianlun_raw`（`rawStore`，上限 100MB），每个会话一个文件，
  文件名形如 `<sessionId>_<8hex>.jsonl`。`sessionIdFromFileName()` 可还原 `sessionId`，
  而 `Friend.id` 即该 `sessionId`——这条映射让「点名好友 → 找到 ta 的原文文件」可行。
- 每人 60 条 / 120 字的**有界样本**（`samples`，按 friend id 存），本就是为问答 agent 准备的。
- 现有 AI 调用走 `aiClient` 的 `transport`（云函数 `aiProxy` 或公司代理 HTTPS）；
  core 建 prompt + 解析，miniapp 负责接线。新功能复用这套，不引入新后端。
- **云备份只含加工后数据**（`BACKUP_FILE_DATASETS = ['friends','samples','recentInsights','recentSamples','stocks']`），
  **不含全量原文**。换机后从云恢复的设备 `rawStore` 为空 → 具体事实回忆会降级。

## 方案选择

选定 **方案 A：本机检索 + 单次应答**。

- 每轮：本机检索步骤组装上下文 → core 拼 prompt → `aiClient` 一次调用出答案。
- 备选 B（两段式 AI 检索）每轮两次调用、成本翻倍，留待 A 跑通后按需再加。
- 备选 C（云端 RAG）需原文上云 + 向量索引，改动最大、且原文离机违背本项目隐私优先设计，弃用。

## 数据流

```
用户提问
  → [chatQaRetrieval] 组装 ChatQaContext
        点名好友 → 从 rawStore 读原文，按关键词/时间就近裁剪（每人限字符）
        泛问     → samples.gatherTopSamples + 好友聚合统计
  → [core.buildChatQaPrompt] 系统指令 + 上下文 + 近 N 轮对话 + 本轮问题
  → [aiClient.answerChatQa] 走现有 aiProxy，单次调用
  → 追加到 messages，渲染
```

多轮 = 每轮把最近 N 轮对话历史一并塞进 prompt；仍是单次 AI 调用。

## 组件

### 1. core：`packages/core/src/ai/chatQa.ts`（纯函数）

- `selectRelevantFriends(question, friends): string[]`
  匹配问题里出现的好友姓名 / 别名 / 备注（role），返回命中的 friend id 列表。纯字符串逻辑。
- `buildChatQaPrompt(question, history, context): string`
  拼 prompt。系统指令要求：**只依据给定材料作答；找不到就直说「样本/记录里没找到」；
  绝不编造；中文、口语化**。
- `parseChatQaAnswer(text): string`
  答案是自由文本，仅做 trim（保留占位以便日后加结构）。
- 类型：
  - `ChatQaTurn { role: 'user' | 'assistant'; text: string }`
  - `ChatQaContext { statsSummary: string; samples: string[]; rawExcerpts: { friend: string; lines: string[] }[] }`
- 经 `packages/core/src/index.ts` 导出。

### 2. miniapp 检索适配器：`packages/miniapp/src/adapters/chatQaRetrieval.ts`

`makeChatQaRetrieval(deps)`，`deps` 注入 `rawStore` / `samples` / 好友列表来源，可单测。

- **点名路径**：对 `selectRelevantFriends` 命中的每个 friend，
  从 `rawStore.list()` 里按 `sessionIdFromFileName(name) === id` 找原文文件，
  读出后按问题关键词命中优先、否则取近期，逐行裁剪，每人限总字符数。
- **泛问路径**（无命中好友）：`samples.gatherTopSamples(...)` + 好友聚合统计文本。
- 输出 `ChatQaContext`，总字符数设硬上限（防爆 token）。
- rawStore 为空（换机后从云恢复）→ 仅返回样本 + 统计，并置标志供上层提示降级。

### 3. aiClient 扩展：`packages/miniapp/src/adapters/aiClient.ts`

`makeAiClient` 增加：

```
async answerChatQa(question: string, history: ChatQaTurn[], context: ChatQaContext): Promise<string> {
  const text = await transport(buildChatQaPrompt(question, history, context), 2048)
  return parseChatQaAnswer(text)
}
```

复用现有 cloud/proxy transport，无新后端。

### 4. store：`packages/miniapp/src/stores/chatQa.ts`（Pinia）

- 状态：`messages: ChatQaTurn[]`、`loading`、`error`。
- `ask(question)`：追加用户轮 → 调 `chatQaRetrieval` 组装上下文 →
  `aiClient.answerChatQa(question, 最近N轮, context)` → 追加助手轮。
- 多轮：传最近 N 轮作为 history。
- **v1 对话仅存内存**，不持久化（不额外落盘聊天衍生数据）。
- 检索到 rawStore 为空时，在答案区提示「具体聊天内容需在原设备或重新导入原文后才能查」。

### 5. 页面：`packages/miniapp/src/pages/chat-qa/chat-qa.vue`

- 聊天式 UI：消息列表 + 底部输入框 + 发送；loading/error 态；沿用现有可爱主题。
- 从 store 读写，绝不直接调 core。
- 在 `pages.json` 注册路由；概览页加入口按钮（如「问问我的聊天」）。

## 隐私与降级

- 只有**裁剪后的片段**发给 aiProxy，与现有画像 / 情绪功能同一信任边界；原文始终在本机。
- 总上下文字符设硬上限。
- rawStore 为空（换机恢复）→ 具体事实回忆降级为样本 + 统计，并明确提示用户。

## 已知取舍（v1）

- 检索为启发式（点名好友 + 关键词），非全语料精确检索。某人消息量极大时优先翻近期 / 关键词相关部分，
  不逐条通读。要「全语料精确」需升级方案 B / C。
- 对话不持久化，退出页面即清空。

## 测试

- core：`selectRelevantFriends`（命中/未命中/别名/备注）、`buildChatQaPrompt`（含/不含原文、历史拼接）、
  `parseChatQaAnswer`。
- miniapp：
  - `chatQaRetrieval`：点名路径、泛问路径、字符上限裁剪、rawStore 空降级（注入后端）。
  - `stores/chatQa`：`ask` 编排、多轮 history、错误处理（注入 aiClient / 检索）。
  - `aiClient.answerChatQa`：transport 调用与 maxTokens（注入 transport）。
- 沿用现有测试范式（vitest；miniapp 用注入后端，不依赖真实 wx）。

## 非目标

- 全语料向量检索 / 云端 RAG（方案 C）。
- 对话历史持久化 / 跨设备同步。
- 把全量原文上传云端。
