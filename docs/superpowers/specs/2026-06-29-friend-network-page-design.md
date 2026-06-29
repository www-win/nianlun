# 好友关系亲疏图（关系图页）设计

日期：2026-06-29
状态：已批准，待制定实施计划

## 背景与目标

「年轮 Nianlun」目前只有以「我」为中心的一对一好友统计，没有任何关系网/图谱可视化。本设计新增一个**以「我」为中心的星形「关系亲疏图」**：把全体好友以同心环 + 关系扇区的方式画在一张图上，越靠中心代表与我联系越多（越亲密），颜色代表关系类型。

注意：这**不是**真正的社交网络图（好友之间没有连线）。微信单聊导出不含好友彼此的互动数据，本项目的数据模型也是以「我」为中心的一对一统计，因此节点之间无边。这是一张「关系亲疏图」，不是「社交网络图」。

## 范围

### 做
- 新增独立页面 `/network`（「关系图」），顶部导航加入口。
- 全体好友每人一个节点，确定性「同心环 + 关系扇区」布局。
- 轻交互：hover tooltip、click 跳好友表、关系类型图例过滤。
- 纯 SVG 渲染，零新增依赖。
- 布局算法为纯函数，放 `packages/web/src/lib/`，含单测。

### 不做（YAGNI）
- 缩放 / 平移 / 拖拽节点。
- 力导向（force-directed）布局、防碰撞物理迭代。
- 好友之间的连线（无群聊/互动数据）。
- 导出图片。
- Canvas/d3/echarts 等重型渲染或依赖。

## 关键决策（已与用户确认）

1. **节点粒度**：全体好友，每人一个节点（密集星空感），不是 Top N，也不是按关系类型聚合。
2. **布局形态**：同心环 + 关系扇区（确定性），不是力导向、不是螺旋。
3. **位置**：独立新页面 `/network`，不塞进报告海报、不替换 Overview 装饰环。
4. **交互**：轻交互（hover tooltip + click 跳转 + 图例过滤），不是纯展示、也不做完整缩放/拖拽。
5. **渲染**：纯 SVG，零依赖。Canvas 仅在上千节点时才需要，本期不需要。
6. **布局计算归属**：放 `packages/web/src/lib/`（「身体」），**不放 core**。core 是「大脑」，只管统计语义，不应知道关系图长什么样。布局是视觉决策（半径映射、扇区角度、配色）。
7. **半径映射**：按 `msgCount` 在全体中的**排名分位**，不是绝对值——避免单个话痨把其他人全挤到边缘。
8. **click 行为**：本期只做 `router.push` 跳到好友表（带 `?focus=<id>` 查询参数）；FriendsPage 据此高亮/滚动到对应行作为**可选增强**，非本期必须。

## 架构与数据流

```
data store (friends: Friend[])   ← 唯一数据源，已响应式、已持久化
        │  纯展示，不修改数据
        ▼
lib/networkLayout.ts  (纯函数)
   输入: Friend[] + 画布尺寸 + 关系过滤集合
   输出: NodeLayout[]
        │
        ▼
pages/NetworkPage.vue  (SVG 渲染 + 轻交互)
   · <circle> per friend，hover→tooltip，click→router.push
   · 顶部 6 个关系图例，点击切换显隐
   · 复用 TheTopbar / TheFooter，空数据引导去导入
        │
        ▼
router: 新增 { path:'/network', name:'network', component: NetworkPage }
TheTopbar: 新增「关系图」导航入口
```

页面遵循项目既有约束：**只从 store 读取数据，绝不修改 store、绝不直接调用 core。**

## `lib/networkLayout.ts`（纯函数 + 单测）

```ts
import type { Friend, Relation } from '@nianlun/core'

export interface NodeLayout {
  id: string
  name: string
  rel: Relation
  x: number          // 画布坐标
  y: number
  r: number          // 节点半径
  color: string      // 关系类型配色
  msgCount: number
}

export interface LayoutInput {
  friends: Friend[]
  size: number              // 正方形画布边长
  activeRels: Set<Relation>  // 图例过滤；空集 = 全部显示
}

export function computeLayout(input: LayoutInput): NodeLayout[]

export const REL_ORDER: Relation[]                  // 扇区顺序，复用 core 的 Relation 顺序
export const REL_COLOR: Record<Relation, string>    // oklch 配色，复用 Overview orb
```

布局算法（确定性）：

- **角度**：6 大关系类型各占一个扇区（360° ÷ 6 = 60°/段），扇区顺序复用 `Relation` 类型定义顺序（`家人 | 挚友 | 同事 | 同学 | 客户 | 其他`）。同一扇区内的好友按 `hash(id) % 60° + sectorBase` 在该扇区内错开，避免重叠。
- **半径**：按该好友 `msgCount` 在全体中的排名分位映射。中心留一圈空白给「我」核心，最外圈留边距。越亲密越靠中心。
- **节点大小 `r`**：按 msgCount 分档（半径 + 大小双编码，强化「亲密」直觉）。
- **颜色**：6 关系类型沿用 Overview orb 的 `oklch` 配色（`REL_COLOR`）。
- **过滤**：`activeRels` 非空时，只返回属于这些关系类型的节点。
- **空输入**：`friends` 为空返回 `[]`。
- 同一输入恒定产出同一结果（确定性，无随机、无时间依赖）。

## `pages/NetworkPage.vue`（SVG + 轻交互）

- 单个 `<svg viewBox="0 0 size size">`，包含：
  - 同心环底纹 + 6 条扇区分隔虚线（复用 orb 风格）。
  - 中心「我」核心节点（复用 orb `.core` 样式）。
  - `v-for` 渲染每个好友 `<circle>`。
- **Hover**：节点放大 + 浮出 tooltip（好友名 / 关系 / 消息量 / 我方发送占比）。tooltip 绝对定位跟随节点，纯 CSS。
- **Click**：`router.push({ name: 'friends', query: { focus: id } })`。
- **图例**：顶部 6 个关系类型彩色 chip，点击切换该类型在 `activeRels` 中的显隐，节点带 CSS 过渡淡入淡出。某关系 0 人时该 chip 置灰不可点。
- **画布尺寸响应式**：容器内取 `min(可用宽, 视口高)` 的正方形，移动端缩小。
- **空状态**：`!data.hasData` 时显示引导卡片「还没有数据，先去导入」+ 跳转按钮（与其他页一致）。

## 边界 / 错误处理

- 无数据：引导卡片，不渲染空 SVG。
- 某关系类型 0 人：扇区留空，图例 chip 置灰不可点。
- 节点重叠：靠半径分位 + 角度哈希错开缓解；本期不做防碰撞迭代，若实测过挤再加。

## 测试

- `lib/__tests__/networkLayout.test.ts`（vitest，纯函数）：
  - 相同输入确定性输出。
  - 半径随 msgCount 排名单调（亲密的更靠中心）。
  - 扇区角度落在对应关系类型区间内。
  - `activeRels` 过滤生效。
  - 空 `friends` 返回 `[]`。
- `pages/__tests__/NetworkPage.test.ts`（jsdom + @vue/test-utils）：
  - 有数据时渲染 N 个 `<circle>`。
  - 点击节点触发路由跳转（带 `focus` query）。
  - 点击图例切换节点显隐。
  - 空数据显示引导卡片。
- 同步更新 `router` 与 `TheTopbar` 的现有测试：断言 `/network` 路由存在、导航含「关系图」入口。

## 文件清单

新增：
- `packages/web/src/lib/networkLayout.ts`
- `packages/web/src/lib/__tests__/networkLayout.test.ts`
- `packages/web/src/pages/NetworkPage.vue`
- `packages/web/src/pages/__tests__/NetworkPage.test.ts`

修改：
- `packages/web/src/router/index.ts`（注册 `/network` 路由）
- `packages/web/src/components/TheTopbar.vue`（新增「关系图」导航入口）
- 相关现有测试（TheTopbar、app/路由测试）同步加断言

不改动：core 包、data store 的数据形状、解析/统计逻辑。
