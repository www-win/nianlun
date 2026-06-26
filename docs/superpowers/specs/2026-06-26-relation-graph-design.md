# 关系网（Ego Relationship Graph）设计

日期：2026-06-26
状态：已批准设计，待写实施计划

## 目标

在「年轮」中新增一个**关系网**页面：以用户本人为圆心，把所有好友作为节点环绕展示，让用户一眼看到自己和所有人的关系全貌。配色按关系分类，节点大小/距离反映联系密切程度，并支持按关系筛选、搜索高亮、点节点看详情。

## 关键约束（来自数据现状）

- 存储的数据是**以"我"为中心**的星状拓扑：每个 `Friend` 记录"我 ↔ TA"的关系类型、消息量、首末联系时间等。
- **没有好友与好友之间的关系数据**：原始聊天记录出于隐私不持久化，也无群成员共现信息。
- 因此本功能实现的是 **ego network（自我中心网络）**，不是人人互连的社交网。该限制是设计前提，不在本次范围内突破。

## 选定方案：手写 SVG + 确定性布局（方案 A）

权衡结论（详见 brainstorming 过程）：

- **A 手写 SVG + 确定性布局（选定）**：零新依赖、离线友好、契合首页"年轮"环形美学；SVG 在 jsdom 下可测，符合本项目 vitest 习惯；几百节点以内流畅。
- B 力导向图（d3-force 等）：需新依赖，画布版难测，对"以我为圆心"的可控美学不如 A。
- C Canvas：性能最好但 jsdom 下交互几乎无法单测，代码量最大；当前数据量用不上。

## 架构

遵守仓库铁律 `@nianlun/web → @nianlun/core` 单向依赖，且 **core 算、web 显示**。

### core：`buildEgoGraph`（纯函数）

- 位置：`packages/core/src/stats/`（与 `aggregate.ts`/`report.ts` 同层），并在 core 的 `index.ts` 导出。
- 签名：`buildEgoGraph(friends: Friend[]): EgoGraph`
- 输出**归一化坐标**，不碰任何颜色 / 像素 / DOM：

```ts
export interface EgoNode {
  id: string
  name: string
  rel: Relation
  angle: number           // 弧度，节点在圆周上的角度
  radiusFraction: number  // 0–1，0=最靠近圆心，1=最外圈
  sizeFraction: number    // 0–1，节点相对大小（按消息量）
  msgCount: number        // 透传，便于排序/兜底
}

export interface EgoGraph {
  nodes: EgoNode[]
}
```

- **布局规则**：
  - 按 6 类关系 `'家人' | '挚友' | '同事' | '同学' | '客户' | '其他'`（即 `Relation`，从 `model/types` import，绝不重定义）把整圈 `2π` 分成扇区。
  - 扇区角度的分配方式：**按该类好友数量**占比分配角度（人多的关系占更宽扇区），同时给每个非空类一个最小角度下限，避免单人扇区退化成一条线。空类不占角度。
  - 扇区内：好友按 `msgCount` 降序，沿扇区角度均匀铺开。
  - `radiusFraction`：消息量越大越靠近圆心（`radiusFraction` 越小）。用排名或归一化映射，保证联系最密的人最靠近"我"。
  - `sizeFraction`：按 `msgCount` 归一化到 `[minSize, 1]`，最小值留底避免消失。
  - 确定性：相同输入产生相同输出（不使用随机、不使用 `Date.now`）。
- **边界**：空 `friends` → `{ nodes: [] }`；单个好友、单一关系类别均不报错。
- 纯函数、无副作用、可在 core 直接单测。

### web：`pages/RelationGraphPage.vue`

- 从 `useDataStore()` 读取 `friends`，调用 core 的 `buildEgoGraph` 得到归一化布局，再做"归一化 → SVG 像素 + 套 `REL_COLORS`"。
- **颜色**：复用好友页的 `REL_COLORS` 映射。为避免在两个页面重复定义，把 `REL_COLORS`、`relColor`、`RELATIONS`、`initials` 这几个共享展示工具抽到 `packages/web/src/lib/relations.ts`，好友页与关系网页同时引用。**这是本次顺带的小重构，限定在颜色/关系展示工具，不动好友页其他逻辑。**
- 页面不直接调用 core 之外的计算，编辑仍走好友页 `updateFriend` 铁律（本页详情只读）。

### 路由与导航

- `router/index.ts` 增加 `{ path: '/graph', name: 'graph', component: RelationGraphPage }`。
- `components/TheTopbar.vue` 导航在「好友信息」与「年度报告」之间插入 `<router-link to="/graph">关系网</router-link>`。

## 渲染（SVG 结构）

- 单个带 `viewBox` 的 `<svg>`，正方形画布，居中。
- 背景：若干同心环（沿用 Overview `.orb` 的环形刻度风格）。
- 圆心："我"节点，沿用品牌年轮图标（`TheTopbar` 里的同心圆 svg）。
- 每个好友：一条从圆心到节点的淡色连线 + 一个圆点。
  - 圆点颜色 = `REL_COLORS[node.rel]`。
  - 圆点半径 = `node.sizeFraction` 映射到像素区间。
  - 节点坐标 = 极坐标 `(angle, radiusFraction)` → 笛卡尔像素。
- 名字标签：默认显示；好友数超过阈值时只给 Top N 显示名字（见规模兜底）。
- 图例：复用关系配色，标注 6 类颜色。

## 交互

复用好友页现成模式与样式：

- **关系筛选**：复用 chip（`全部` + 6 类）。选中某类后，非该类节点与连线降透明度（淡出），不从 DOM 删除。
- **搜索高亮**：搜索框，输入对 `Friend.name` 与 `Friend.alias` 做大小写无关子串匹配；命中节点放大 + 描边高亮，其余淡出。
- **点节点看详情**：复用好友页右侧抽屉（scrim + drawer）展示只读详情：首次/最近联系、消息总数、收发比、活跃时段、最长连续聊天、全年消息分布 spark。抽屉提供「在好友表中编辑」入口，跳转 `/friends`。**详情只读，编辑仍归好友页的 `updateFriend` 路径。**

## 规模兜底

- 默认渲染全部节点。
- 好友数超过阈值（初定 150）时：只给 Top N（按消息量）标名字，其余只画点；角落提示"显示全部 N 位好友"。
- 纯展示降级，不丢任何数据、不静默截断节点。

## 错误 / 空状态

- 无数据（`!data.hasData`）：复用好友页空状态文案，提示去 `/import` 导入。
- `buildEgoGraph` 对空/异常输入返回空图，页面显示空状态而非报错。

## 测试

- **core**（vitest）：
  - 扇区按关系数量分配角度、空类不占角度、最小角度下限生效。
  - `radiusFraction`：消息量最大者最靠近圆心。
  - `sizeFraction`：归一化范围、最小值底限。
  - 边界：空数组、单好友、单一关系。
  - 确定性：同输入同输出。
- **web**（vitest + jsdom + @vue/test-utils）：
  - 渲染的节点数 == 好友数（或兜底阈值内）。
  - 关系 chip 筛选改变节点淡出态。
  - 搜索改变匹配节点高亮态。
  - 点击节点打开抽屉并显示该好友数据。
  - 无数据时显示空状态。

## 明确不做（YAGNI / 范围外）

- 好友间互连线（无数据来源）。
- 力导向 / 物理动画。
- Canvas 渲染。
- 在本页编辑好友（编辑仍回好友页）。
- 持久化任何新数据（布局每次从 `friends` 现算）。
