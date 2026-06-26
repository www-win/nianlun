# 年轮 AI 功能集成 — 设计文档（第一期：AI 生成年度报告文案）

日期：2026-06-26
状态：待评审

## 1. 背景与目标

「年轮」是一个本地优先、纯前端（Vue 3 + Vite，无后端）的微信年度报告工具。
用户希望把 AI 能力集成进产品，打包给客户后，客户使用软件时能用上 AI 功能。

经需求澄清，最终约束如下：

- **要做的功能（共四项，分两期）**：① 生成年度报告文案、② 提取聊天关键词、③ 智能判断好友关系、④ 聊天内容问答。
- **AI 供货方**：通过 gaccode 中转调用 Claude（gaccode 兼容 Anthropic Messages API）。
- **客户规模**：**只有一个客户，且信得过**。
- **由此确定的架构方向**：**不搭服务器**。AI 的 key 存在客户浏览器的本地存储里，由开发者通过向日葵远程帮客户填一次（使用一个可随时停用的专用 key）。

> 本文档只覆盖**第一期**：功能 ①（生成年度报告文案）。目标是把"设置 key → 调用 AI → 显示结果"整条链路彻底跑通，作为后续功能的地基。

## 2. 关键约束与已知事实

### 2.1 为什么不搭服务器（"不可能三角"）

纯前端应用无法隐藏打包进代码里的 key。要同时满足"用开发者的 key + 不搭服务器 + 卖给陌生客户 + 安全"是不可能的。因为客户只有一个且信得过，故选择：**不搭服务器 + key 存本地设置 + 开发者代填**。

### 2.2 数据可用性（影响功能范围，已核对代码）

年轮在 Worker 中解析聊天记录、算完统计后**丢弃原始聊天文字**，只把聚合结果带回主线程并持久化：

- `ParseOutcome` 只含 `friends: Friend[]`、`report: ReportData`、`warnings`（见 `packages/web/src/adapters/parseClient.ts`）。
- `storage.ts` 只持久化 `Friend[]` + `ReportData`，原始 `Conversation[]` 绝不落盘。

对照四个功能的数据需求：

| 功能 | 需要数据 | 现状 |
|------|---------|------|
| ① 报告文案 | 聚合数据（`ReportData` + `Friend[]`） | ✅ 现成可用 → **本期实现** |
| ② 关键词 | 原始聊天文字 | ❌ 已丢弃 → 第二期，需改数据流 |
| ③ 关系判断 | 聚合数据可凑合（有原文更准） | ⚠️ 第二期 |
| ④ 内容问答 | 原始聊天文字 | ❌ 已丢弃 → 第二期，需改数据流 |

功能 ①只用现成聚合数据，**不触碰隐私设计**，故作为第一期。

### 2.3 浏览器直连的技术风险（必须先实测）

浏览器直接调用 gaccode 的 `POST /v1/messages` 可能被 **CORS（跨域）** 拦截。这是无服务器方案唯一的拦路虎。
**实施第一步是一个最小连通性验证**：用真实 key 从浏览器发一次请求，确认 gaccode 是否允许浏览器直连。

- 允许 → 方案成立，继续。
- 不允许 → 暂停，回头评估"加一个极小中转"的退路（本期不实现，只记录）。

## 3. 架构设计

遵循项目铁律：`web → core` 单向依赖；`core` 纯函数、不碰网络/DOM；`web` 只搬运/展示/存储，重逻辑在 core。新增一个 `web` 适配器负责网络 IO（与现有 `parseClient` 模式一致）。

### 3.1 core 新增：提示词构建（纯函数，可测试）

- 新增 `packages/core/src/ai/prompts.ts`
  - `buildReportCopyPrompt(report: ReportData, friends: Friend[]): string`
    输入聚合统计数据，输出"要发给 AI 的那段中文提示词"。纯函数、无副作用、可单元测试。
  - 提示词包含：年份、总消息数、活跃天数、好友数、Top 联系人（名字 + 消息数）、关系分布等，并指示 AI 产出一段有温度的中文年度总结文案。
- 在 `packages/core/src/index.ts` 导出。
- **不在 core 里发网络请求**，core 只负责"把数据变成提示词字符串"。

### 3.2 web 新增：AI 适配器（网络 IO）

- 新增 `packages/web/src/adapters/aiClient.ts`
  - `generateText(prompt: string, settings: AiSettings): Promise<string>`
  - 用 `fetch` 调用 `${settings.baseUrl}/v1/messages`，方法 `POST`。
  - 请求头：
    - `x-api-key: <settings.apiKey>`
    - `anthropic-version: 2023-06-01`
    - `anthropic-dangerous-direct-browser-access: true`
    - `content-type: application/json`
  - 请求体：
    ```json
    {
      "model": "claude-opus-4-8",
      "max_tokens": 1024,
      "messages": [{ "role": "user", "content": "<prompt>" }]
    }
    ```
    （`model` 取自设置，默认 `claude-opus-4-8`，以 gaccode 实际开放为准；本期为简单文案任务，不开启 thinking。）
  - 解析响应：取 `response.content` 中第一个 `type === 'text'` 块的 `text`。
  - **容错**：网络失败、401（key 错）、429（限流）、CORS 失败都要给出清晰的中文错误提示，不抛裸异常给页面。
  - 类型 `AiSettings = { baseUrl: string; apiKey: string; model: string }`。

### 3.3 web 新增：设置存储

- 新增 `packages/web/src/stores/settings.ts`（Pinia）或扩展现有 `ui` store：
  - 持有 `baseUrl`、`apiKey`、`model`。
  - 持久化到 **localStorage**（不进 git、不打包进代码）。
  - 提供 `hydrate()`（启动时从 localStorage 读回）和 `update()`。

### 3.4 web 新增：界面

- **设置页/面板**：三个输入框（接入地址、API Key、模型，模型可给默认值），保存即写入 localStorage。Key 输入框用密码样式。
- **报告页**：新增「✨ AI 生成文案」按钮。
  - 点击流程：从 `data` store 取 `report` + `friends` → 调 `core` 的 `buildReportCopyPrompt` → 调 `aiClient.generateText` → 把结果显示在报告页。
  - 按钮旁固定显示**隐私提示**：「使用 AI 功能时，相关统计数据会发送至 AI 服务进行处理」。
  - 处理 loading / 错误 / 成功三态。
  - 若未配置 key，按钮禁用或引导去设置页。

### 3.5 数据流

```
报告页 ──取── data store(report, friends)
   │
   └─→ core.buildReportCopyPrompt() ──prompt──→ web.aiClient.generateText(prompt, settings)
                                                      │ fetch (x-api-key + 浏览器直连头)
                                                      ▼
                                          gaccode /v1/messages ──→ Claude
                                                      │
   报告页显示文案 ◀──── 提取 content[].text ◀─────────┘
```

## 4. 隐私处理

- 第一期：AI 按钮旁明确写出"相关**统计数据**会发送至 AI 服务进行处理"。
- 第二期（涉及原始聊天文字）上线时升级为"**聊天内容**会发送至 AI 服务处理"，并应做成显式开关 + 知情确认。

## 5. 测试

- **core**：`buildReportCopyPrompt` 的单元测试（给定 `ReportData`/`Friend[]`，断言提示词包含关键字段）。
- **web**：`aiClient.generateText` 用可注入的 `fetch`（mock）测试请求头、请求体、成功解析、各类错误分支——无需真实网络。
- 遵循现有 Vitest（core）/ Vitest + jsdom（web）约定。

## 6. 实施顺序（第一期）

1. **CORS 连通性验证**（最小 demo：硬编码一次请求，浏览器实测 gaccode 是否放行浏览器直连）。
2. core：`buildReportCopyPrompt` + 测试。
3. web：`aiClient.generateText` + 测试。
4. web：`settings` store（localStorage）+ 设置界面。
5. web：报告页「AI 生成文案」按钮 + 隐私提示 + 三态。
6. 端到端联调（开发者本机用真实 key 跑通）。
7. 交付：向日葵远程进客户机，在设置里填入专用 key。

## 7. 明确的范围之外（第一期不做）

- 功能 ②③④（关键词 / 关系判断 / 问答）——第二期，③④ 需单独设计"保留原始聊天文字"的数据流改动。
- 搭建中转服务器、激活码、限量——客户只有一个且信得过，不需要。
- 流式输出（streaming）——本期文案短，一次性返回即可。

## 8. 风险与回退

- **CORS 被拦**：第一期第 1 步即可暴露。若被拦，本方案需回退到"加一个极小中转服务"（本期不实现，仅作为已知退路记录）。
- **key 泄露**：使用专用、可在 gaccode 控制台随时停用的 key，出事即停，不影响开发者主 key。
- **gaccode 模型 ID 差异**：`model` 做成可配置，以控制台实际开放为准。
