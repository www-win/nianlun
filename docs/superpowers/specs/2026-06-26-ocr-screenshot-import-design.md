# 截图 OCR 导入 — 设计文档

日期：2026-06-26
状态：已确认，待实现

## 目标

让用户导入微信**聊天截图**（`.png` / `.jpg` / `.jpeg` / `.webp`）。由云端**多模态大模型**读取截图，输出现有 txt 解析器认识的纯文本格式，之后完全走现有的 `parseFiles → aggregate → report` 链路，自动并入好友统计。

识别后**直接自动导入**，不做预览/编辑（已与用户确认）。

## 决策记录

- **OCR 引擎**：云端多模态大模型，复用项目已有的 AI 代理（Anthropic Messages API）。模型能边认字边理解气泡左右位置，直接吐结构化结果。代价：图片会上传到用户配置的 AI 服务——这是项目里**第一个会上传用户内容**的功能，必须在 UI 显著告知。
- **识别后流程**：直接自动导入，不预览。识别失败按项目惯例收集 warning，不中断。
- **引擎选型时被否决的方案**：本地 tesseract.js（模型大、慢、丢气泡结构导致发送者/时间几乎无法还原）。

## 架构

核心思路：**OCR 是 web 层的"另一种文件读取器"**——把图片读成 txt 格式文本，之后与普通文本文件无差别地走现有链路。

这是唯一符合项目单向依赖约束（`web → core`，core 碰不到图片/网络/DOM）的做法。`@nianlun/core` **一行不改**，`txtParser` 已经能解析目标格式。

### 数据流

```
图片(.png/.jpg/.jpeg/.webp)
  → adapters/imageOcr.ts: ocrImage(file, year)
      → 读成 base64 → 调多模态 AI(image 块 + 提示词)
      → 返回 { name, content: "YYYY-MM-DD HH:MM:SS 发送者\n正文..." }   ← 即 ReadFile，与 readTextFile 同形状
  → stores/import.ts run(): 文本文件走 readTextFile，图片走 ocrImage，合流成 ReadFile[]
  → parseFiles(...)  ← 现有链路，零改动
```

`ReadFile` 形状（`adapters/fileReader.ts`）：`{ name: string; content: string }`。OCR 产出与之同形，因此下游 `parseFiles` 无需任何改动。

### 各部件改动

| 部件 | 改动 |
|------|------|
| `packages/core/*` | **不动** |
| `adapters/aiClient.ts` | 新增 `extractFromImage(base64, mediaType, prompt, settings, fetch)`：发 Anthropic image 内容块，`max_tokens` 提到约 4096（现有 `generateText` 是 1024，装不下整段对话）。沿用现有 `x-api-key` / `anthropic-version` 头与错误映射（401/429/其它）。 |
| `adapters/imageOcr.ts`（新） | `ocrImage(file, year)`：判断是否图片（扩展名/MIME）→ 读 base64 + media_type → 拼提示词 → 调 `extractFromImage` → 返回 `ReadFile`。可注入 `FetchLike` 以便测试。 |
| `stores/import.ts` | `run(files, year)` 里按扩展名/MIME 分流：图片走 `ocrImage`，其余走 `readTextFile`；单张图片失败 → 收一条 warning，其余继续。需读取 settings store 拿 AI 配置；未配置且含图片 → 明确报错指向设置页。 |
| `pages/ImportPage.vue` | `accept` 加 `.png,.jpg,.jpeg,.webp`；加对应标签；加一行**隐私提示**：图片识别会上传到你配置的 AI 服务、不再是纯本地，且需先在设置里配置**视觉模型**。 |

### 提示词要点（决定识别质量）

告诉模型：

- 这是一张微信聊天截图，请逐条把对话提取成纯文本。
- 每条消息格式为 `YYYY-MM-DD HH:MM:SS 发送者`，下一行起是正文，消息之间空行分隔。
- **右侧气泡的发送者写「我」**；左侧写对方昵称（取自顶部标题栏）。
- 时间用截图中可见的日期/时间；缺失日期时用导入年份 `{year}` 并沿用最近一次可见时间。
- 只输出文本，不要任何解释。

`{year}` 来自 `run()` 的 `year` 参数；对方昵称由模型从标题栏读取，作为 `peerName`。

## 错误处理

沿用项目"容错 + 收集 warnings、永不抛异常打断整体导入"的风格：

- 每张图独立识别；一张失败（网络 / 401 / 429 / 空返回）只产生一条 warning，其余图片与文本文件继续。
- 没有配置 AI 设置却导入了图片 → 给出明确错误，指向设置页（这是阻断式的，因为没配置就完全无法识别）。

## 测试

复用项目已有的可注入 `FetchLike` 测试模式（见 `aiClient` 现有用法）：

- `imageOcr` 单测：注入假 fetch，成功返回 txt 文本；失败路径产出 warning，不抛异常。
- `import` store 单测：文本 + 图片混合导入都能流通；图片失败不崩、只告警；未配置 AI + 含图片时给阻断错误。
- 断言不持久化原始图片/原文（延续"只存聚合数据"约束）。

## 已知边界与风险

1. **统计精度有限**：截图时间戳稀疏，月度分布、首次/最后联系日多为模型推断，会有偏差。属预期内，文案需让用户有心理预期。
2. **隐私边界变化**：这是项目里第一个上传用户内容的功能，与"本地优先、不上传"的核心承诺冲突。UI 必须显著、诚实告知；仅在用户主动导入图片时触发上传。
3. **格式不合规风险**：模型若输出不符合 `YYYY-MM-DD HH:MM:SS` 的时间头，`txtParser` 会产生 `NaN` 时间戳，污染统计。缓解：提示词严格约束格式；实现阶段评估是否在 `imageOcr` 侧加一个轻量守卫（丢弃/告警不合格行），避免改动 core。

## 范围之外

- 本地离线 OCR。
- 识别结果的预览/编辑界面（已确认不做）。
- 非微信截图的通用 OCR。
