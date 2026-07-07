# 好友 MBTI 设计

日期：2026-07-07
状态：设计已确认，待实施

## 目标

为每个微信好友增加 MBTI（16 型人格）能力：优先从**昵称/备注**里识别出类型码，识别不到时可点按钮用 **AI 分析**聊天样本得出，并允许用户**手动改**为任意类型。深度为「中等」——类型标签 + 四维倾向 + 一段人格解读，**不做**与「我」的相性合盘。

## 非目标（YAGNI）

- 不做「我 × TA」MBTI 相性/合盘。
- 不做「我的 MBTI」独立页。
- 列表徽标**不做**按类型筛选，仅展示。
- 不引入任何新的存储/指纹/样本机制——全程复用现有 AI 结果管线。

## 架构定位（一句话）

MBTI = **又一个「好友级 AI 结果」**（与情绪/画像同构），**外加一个走 `Friend.userEdited` + 备注正则的离线覆盖层**。沿用画像/星座已建好的持久化、时效指纹、样本、行内编辑管线。严格遵守 `web/miniapp → core` 单向依赖：core 为纯函数，miniapp 只搬运/展示/存储。

## 一、core：`packages/core/src/ai/mbti.ts`（新增，与 `ai/profile.ts` 同构）

### 类型

```ts
export type MbtiCode =
  | 'INTJ' | 'INTP' | 'ENTJ' | 'ENTP'
  | 'INFJ' | 'INFP' | 'ENFJ' | 'ENFP'
  | 'ISTJ' | 'ISFJ' | 'ESTJ' | 'ESFJ'
  | 'ISTP' | 'ISFP' | 'ESTP' | 'ESFP'
export type MbtiAxis = 'EI' | 'SN' | 'TF' | 'JP'

export interface MbtiDimension {
  axis: MbtiAxis        // 维度
  pole: string          // 落点字母（E/I、S/N、T/F、J/P 之一）
  strength: number      // 0–100，偏向该极的强度（50=中性附近）
  note?: string         // 一句依据，来自样本；无则省略
}
export interface MbtiResult {
  code: MbtiCode              // 4 字母类型
  title: string              // 中文别名，如「建筑师」
  summary: string            // 一段人格解读
  dimensions: MbtiDimension[] // 定长 4，顺序固定 EI/SN/TF/JP
}
```

### 常量与纯函数（全部不抛异常）

- `MBTI_CODES: readonly MbtiCode[]`（16 个）
- `MBTI_TITLES: Record<MbtiCode, string>`（中文别名静态表）
- `mbtiTitle(code: MbtiCode): string`
- `detectMbtiFromText(text: string): MbtiCode | null`
  - 大小写不敏感、词边界（前后为非字母或串首尾）匹配 16 型之一，返回大写规范码；无匹配返回 null。
  - 用于「备注识别」离线零成本路径。
- `buildMbtiPrompt(friend: Friend, samples: string[]): string`
  - 参照 `buildFriendProfilePrompt`：喂聚合统计 + 有界样本，要求只输出严格 JSON：`{ code, title, summary, dimensions:[{axis,pole,strength,note}×4] }`；线索不足时也要给出保守判断并说明依据薄弱。
- `parseMbti(text: string): MbtiResult | null`
  - 容错：剥代码围栏、定位首尾花括号、`JSON.parse`；校验 `code` ∈ 16 型（否则 null）。
  - `title` 缺失时用 `mbtiTitle(code)` 补。
  - `dimensions` 校验/补齐：按固定顺序 EI/SN/TF/JP，缺项时**由 code 反推 pole**，`strength` 缺省给中性偏移（如 60），`note` 可空。
  - 完全无法解析返回 null。
- `effectiveMbtiCode(friend: Friend, aiCode?: MbtiCode | null): { code: MbtiCode | null; source: MbtiSource }`
  - `type MbtiSource = 'manual' | 'remark' | 'ai' | 'none'`
  - 优先级：`friend.userEdited.mbti`（manual）> `detectMbtiFromText(alias ‖ role ‖ name)`（remark）> `aiCode`（ai）> `null`（none）。
  - `source` 供 UI 直接显示「手动/备注/AI」标识，无需二次判断。

从 `packages/core/src/index.ts` 导出上述类型与函数。

## 二、Friend 模型改动（`packages/core/src/model/types.ts`）

在 `Friend.userEdited` 增加可选槽：

```ts
userEdited: { role?: string; rel?: Relation; alias?: string; name?: string; mbti?: MbtiCode }
```

放 `userEdited` 内 → `merge/merge.ts` 的 `mergeFriends` 已「userEdited 优先」，重新导入时手动 MBTI 自动保留，**无需改 merge 逻辑**（需加测试确认覆盖到新字段）。

## 三、miniapp 适配层

### `adapters/aiClient.ts`

新增：
```ts
async analyzeFriendMbti(friend: Friend, samples: string[]): Promise<MbtiResult | null> {
  const text = await transport(buildMbtiPrompt(friend, samples), 768)
  return parseMbti(text)
}
```
并在顶部 import 补 `buildMbtiPrompt, parseMbti` 与类型 `MbtiResult, MbtiCode`。

### `adapters/storage.ts`

复用现有好友级 AI 结果通道（与情绪/画像完全一致）：
- 新增键 `const K_FRIEND_MBTI = 'nianlun:friendMbti'`
- 新增 `saveFriendMbti(id, friend, data: MbtiResult)` → `saveFriendEntry(K_FRIEND_MBTI, id, friend, data)`
- 新增 `loadFriendMbti(id, friend)` → `loadFriendEntry<MbtiResult>(K_FRIEND_MBTI, id, friend)`（返回 `{data, stale}`）
- 指纹自动复用 `friendFp = msgCount:lastContact`（数据变→stale→软提示）
- `clearAll()` 内加 `backend.remove(K_FRIEND_MBTI)`

零新机制。

## 四、UI

### 好友详情页 `pages/friend-detail/friend-detail.vue` —— 新增 MBTI 卡片

放画像卡附近，内容：
- 大号**类型码** + 中文别名 + **来源标识**（手动 / 备注 / AI）
- 四条维度条：`E—I`、`S—N`、`T—F`、`J—P`，标出落点字母与 strength（简单进度条/滑块，非图表库）
- 一段人格解读 `summary`
- **「AI 分析 MBTI」按钮**：当既无手改也无备注可识别，且 AI 结果缺失或 `stale` 时可点；复用现有该好友 samples（与画像同一取样路径）；`stale` 时显示「数据已更新，可重新分析」软提示（与其它 AI 卡一致）
- **手动改**：16 型 picker + 「清除」项；确认经现有 `updateFriend` 写 `friend.userEdited.mbti`；「清除」置空后回落到 备注识别/AI

来源与展示码经 `effectiveMbtiCode(friend, aiResult?.code)` 计算：手改/备注命中时直接展示，无需也不触发 AI；仅当来源会落到 AI 且无缓存时，按钮才是主操作。

### 好友列表页 `pages/friends/*` —— 每行 MBTI 小徽标

- 每行显示有效码（如 `INTJ`）的小徽标；有效码为 null 则不显示。
- 列表挂载时批量取 friendId→code 映射：对每个好友算 `effectiveMbtiCode(friend, loadFriendMbti(id, friend)?.data.code)`。离线部分（手改/备注）零成本；AI 部分只读已持久化缓存，不触发新分析。
- 不做筛选，仅展示（YAGNI）。

## 五、测试

### core `packages/core/src/ai/__tests__/mbti.test.ts`
- `detectMbtiFromText`：正例（含混在文本/备注中）、大小写、词边界（`INTJINTJ`/`aINTJ` 不误匹配）、负例、非 16 型串（如 `INTX`）返回 null。
- `parseMbti`：带代码围栏、字段缺失补齐（缺 title/缺某维度→反推 pole）、非法 code→null、脏文本→null、四维定长与顺序。
- `effectiveMbtiCode` / 来源：手改优先、备注次之、AI 再次、全无→null。
- `buildMbtiPrompt`：包含好友名/关系/样本关键片段与 JSON 契约要点（快照式断言）。

### core merge
- `mergeFriends` 保留 `userEdited.mbti`（重新导入不被覆盖）。

### miniapp
- `aiClient.analyzeFriendMbti`：transport 返回 JSON → MbtiResult；脏输出 → null。
- `storage`：save/load 往返、指纹失效判 `stale`、`clearAll` 清 `K_FRIEND_MBTI`。
- 详情页卡片：三种来源标识渲染、stale 软提示、手改与清除路径。
- 列表：徽标按有效码渲染，无码不显示。

## 落地位置

在当前 `we_chat` 仓库（master）直接实施，不另开 worktree（用户确认「当前」）。

## 复用与边界确认

- 严格 `miniapp → core` 单向依赖：core `mbti.ts` 不碰 DOM/wx/vue。
- 不新增存储机制：好友级 AI 结果通道 + `userEdited` 覆盖层，两者都已存在。
- 页面从 store/adapters 读，编辑经 `updateFriend`，绝不直接调用 core 或改 store 数据。
