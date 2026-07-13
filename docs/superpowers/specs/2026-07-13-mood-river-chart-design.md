# 情绪波动 → 情绪河流（Mood River）设计

- 日期：2026-07-13
- 范围：好友详情页 friend-detail.vue「情绪波动」模块，把当前的简单双折线升级为「情绪河流」双向面积图。
- 目标：更有信息量、更好看、换图表形态、在现有存储数据内榨出更多维度——且**不改 core、不需重新导入**，老数据直接生效。

## 背景：现状与不足

当前实现（`friend-detail.vue` 的 `drawMood()` + `insights.ts` 的 `moodDualLinePoints`）：
用 uni canvas 画一张双折线，我=橙 `#e8a04b`、TA=蓝 `#5a8fd0`，各 12 个月的点，
y = 该月平均情绪值 `avg`（0..1，0.5=中性），一条 0.5 灰中线，相邻月连线、点半径 3。

不足：
1. 没有坐标语境——只有一条中线，看不出哪算开心/难过、每点是几月。
2. 所有点一样大——2 条消息的月份和 200 条消息的月份画得一样「确定」。
3. 视觉单薄——两条细线飘在白底。
4. 不讲故事——不标注最暖/最冷月。

可用数据（`emotion.monthly`，`MonthMood { avg, count } | null`，长度 12）：
每月每侧有 `avg`（0..1）与 `count`（当月消息条数）。**`count` 当前完全没用到**——
它正是「这个月情绪判断有多可信/聊得多不多」的关键维度。逐月的开心/难过占比**没有**落盘
（全年占比有，拆不到月），因此不引入需要逐月分布的方案。

## 编码规则（B1 共享情绪轴）

| 视觉通道 | 含义 |
|---|---|
| 垂直位置（河的中心线） | 当月平均情绪值 `avg`：上=开心、下=难过、中=中性(0.5) |
| 河带宽度 | 当月消息量 `count`：聊得越多越宽，越安静越细 |
| 暖橙河 | 我 |
| 冷蓝河 | TA（半透明填充，与暖河交叠处自然加深） |
| 背景三区（极淡） | 顶=开心区、中=平淡带、底=难过区，给「上下」一个参照 |

两条河共用同一条情绪纵轴——真实反映各自的情绪起伏，这是最贴「情绪波动」本意的读法；
两河可能上下交叠，用半透明填充叠色处理。

## 架构（守住纯函数边界）

单向：绘制层（.vue，碰 canvas/DOM）← 纯几何层（insights.ts，无副作用、可单测）。
core 不动。

- **纯几何**：`insights.ts` 新增 `moodRiverBands(monthly, opts)`。
  - 输入：`emotion.monthly`（`FriendEmotion['monthly']`）+ `{ width, height, pad }`。
  - 输出：见「数据结构」。把逐月 `avg/count` 换算成河带多边形顶点（上沿/下沿点序列，
    按「相邻连续月」分段）+ 归一化后的半宽 + 峰谷月。
  - `moodDualLinePoints` **保留不动**，先与新函数并存；新绘制验收通过后再在后续清理中移除旧函数。
- **绘制**：`friend-detail.vue` 的 `drawMood()` 改写为：
  画极淡三区背景 → 填充河带多边形（平滑）+ 描中心线 → 画中性基线 → 左侧情绪档标注 →
  底部月份刻度。仍用 `uni.createSelectorQuery().select('.mood-canvas').boundingClientRect`
  量真实渲染宽度（沿用现有做法，绘制坐标系与画布严格一致）。

## 数据结构

```ts
export interface RiverPt { x: number; centerY: number; halfW: number; m: number }

// 一段「相邻连续月」的河带；单月段也用它（points.length === 1 → 画水滴椭圆）
export interface RiverSegment { points: RiverPt[] }

export interface RiverSide {
  segments: RiverSegment[]
  warmest: number | null   // 峰：avg 最高的「可信月」月索引 0..11，无则 null
  coldest: number | null   // 谷：avg 最低的「可信月」
}

export interface MoodRiver {
  me: RiverSide
  them: RiverSide
  hasData: boolean
  midY: number             // 中性基线像素 y（供绘制基线/背景分区）
}

export function moodRiverBands(
  monthly: FriendEmotion['monthly'],
  opts: { width: number; height: number; pad: number },
): MoodRiver
```

## 几何与归一化

- `moodY(avg) = height - pad - avg * (height - 2*pad)`（与现有一致；`midY = moodY(0.5)`）。
- `x(m) = pad + (m / 11) * (width - 2*pad)`。
- `maxCount` = 两侧所有非空月 `count` 的最大值（全 0 或无月时视作 1，避免除零）。
- `halfW(count) = minHalf + (count / maxCount) * (maxHalf - minHalf)`，其中
  - `minHalf = 2`（px；1 条消息也留一缕可见细流），
  - `maxHalf = (height - 2*pad) * 0.16`（封顶，防止巨月吞图、压过情绪读数）。
- 河带 = 沿中心点序列，上沿 `centerY - halfW`、下沿 `centerY + halfW` 构成闭合多边形。
- **平滑**：中心点/上下沿之间用 `quadraticCurveTo` 平滑过渡，做出「河」的流动感
  （相邻两点中点作锚、点本身作控制点的经典单调平滑；纯几何只需给出有序顶点，
  绘制层负责下笔曲线）。

## 边界情况

- **null 月**（当月无消息）→ 河断流：只在「相邻连续月」段内成带，断口不连
  （沿用现有 `m 差 1` 的分段逻辑）。
- **孤立单月**（前后皆 null，段内仅 1 点）→ 绘制层画一枚小「水滴」椭圆
  （宽=halfW、竖直半高≈halfW、圆心=centerY），不然单点会丢。
- **无任何数据**（两侧皆空）→ `hasData=false`，沿用现有 `hasMood=false` 的
  「样本不足，暂无法生成情绪走势」占位文案。
- **某侧全空**（如只有我说话）→ 该侧 `segments=[]`，只画另一条河。

## 信息增强

- 左侧纵向标注 `开心 / 中性 / 难过` 三档（绘制层，靠 pad 内侧）。
- 底部月份刻度 `1 3 5 7 9 11`。
- canvas 下方一行淡色 caption（**纯文本、不挤画布**，由 `moodRiverBands` 的 warmest/coldest 算出）：
  例 `你 最暖 8月 · 最冷 5月　|　TA 最暖 3月 · 最冷 9月`。
  峰谷只在 `count` 达阈值的「可信月」里挑，避开 1~2 条消息的噪声月。
  - **可信月阈值**：`count >= max(3, maxCount * 0.2)`（既排除极低噪声，又对整体量少的好友放宽）。
    若某侧无任何可信月，则该侧 warmest/coldest 皆 null，caption 相应侧省略。
- 保留现有图例（我/TA 圆点）+ 补一句 `宽度=当月消息量`。
- 保留 `本地词典估算，仅供参考` 免责。

## 颜色与样式

- 我：填充 `rgba(232,160,75,0.5)`，中心线描边 `#e8a04b`。
- TA：填充 `rgba(90,143,208,0.45)`，中心线描边 `#5a8fd0`。
- 背景三区：开心区/难过区极淡同色系 wash（透明度 ~0.05），平淡带留白或更淡。
- 中性基线：`#e5e7eb` 细线（沿用现值）。
- 轴标注/刻度：`var(--faint)` 同页风格；canvas 内文字用与页面一致的浅灰。

## 测试（insights.test.ts 补用例）

`moodRiverBands` 覆盖：
- 正常 12 月两侧齐全 → 两侧各若干段、顶点数正确、halfW 落在 [minHalf, maxHalf]。
- 含 null 断流 → 段的切分正确（断口两侧分属不同 segment）。
- 孤立单月 → 该段 `points.length === 1`。
- 全空 → `hasData === false`。
- 单侧空 → 空侧 `segments === []`，另一侧正常。
- count 归一化边界 → 最大 count 月 halfW≈maxHalf、最小非零 count 月≥minHalf。
- 峰谷筛选 → 噪声月（count 低于阈值）不被选为 warmest/coldest；无可信月时为 null。
- `midY` = `moodY(0.5)`。

绘制层（`drawMood`）不纳入单测（依赖 canvas/selectorQuery），靠真机/开发工具目测验收。

## 取舍与约束

- 全程只用已存的 `avg + count`，不改 core、不需重新导入，老数据直接生效。
- 带宽与情绪位置共用垂直像素空间是 B1 的固有代价——用 `maxHalf` 封顶控制，保证情绪高低仍可读。
- 旧 `moodDualLinePoints` 先并存后清理，避免一步到位引入回归。

## 验收标准

1. 有数据的好友：情绪河流正常渲染，暖/冷两河按月起伏、宽窄随消息量变化，交叠处叠色。
2. 断月不连、孤立月出水滴、单侧数据只画一条河、无数据出占位文案——四类边界均正确。
3. 左侧三档标注、底部月份刻度、下方峰谷 caption、图例与免责齐全。
4. `pnpm --filter @nianlun/miniapp test` 全绿（含新增 `moodRiverBands` 用例）。
5. 真机/微信开发者工具目测：河流形态自然、平滑、无坐标错位。
