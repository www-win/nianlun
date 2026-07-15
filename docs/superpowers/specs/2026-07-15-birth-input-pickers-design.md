# 命理生辰输入改为下拉选择 — 设计

## 背景

命理运势功能需要用户录入生辰（好友补录、我的命盘两处）。当前两处表单都是 4 个手动数字输入框（年 / 月 / 日 / 时辰，`type="number"`），录入不便：需逐个手打、易填错、时辰要求填 0-23 不符合命理直觉。

- 好友补录表单：`packages/miniapp/src/pages/friend-detail/friend-detail.vue`（约 642-645 行）
- 我的命盘设置：`packages/miniapp/src/pages/my-bazi/my-bazi.vue`（约 50-53 行）

目标：把手输改为下拉选择，年月日用微信原生日期滚轮，时辰用十二时辰下拉。

## 关键约束：存储与排盘不变

存储层数据结构不动，仍是 `BirthInfo { year, month, day, hour? }`（毫秒时间戳不涉及）。内核用 `lunar-javascript` 排盘，时辰地支索引规律为：

```
branchIndex = floor((hour + 1) / 2) % 12   // hour 0 与 23 都归子时
```

因此十二时辰 ↔ hour 的映射只需在 UI 层完成，**存储、云备份、AI 抽取、内核排盘全部无需改动**。

## 组件方案（两处表单统一）

### 年月日 → `<picker mode="date">`

- `start="1900-01-01"` `end="2100-12-31"`，`value` 为 `"YYYY-MM-DD"` 字符串。
- 点击弹出微信原生滚轮，一次选完年月日；未选时显示占位「请选择出生日期」，已选时显示所选日期。
- 由组件保证每月天数合法（2 月无 30 日等），省去手输范围校验的主要负担。

### 时辰 → `<picker mode="selector">`

选项共 13 项，index → 含义：

| index | 显示 | 存入 hour |
|------|------|----------|
| 0 | 不确定 | 不写入 hour |
| 1 | 子时 (23-1) | 0 |
| 2 | 丑时 (1-3) | 1 |
| 3 | 寅时 (3-5) | 3 |
| 4 | 卯时 (5-7) | 5 |
| 5 | 辰时 (7-9) | 7 |
| 6 | 巳时 (9-11) | 9 |
| 7 | 午时 (11-13) | 11 |
| 8 | 未时 (13-15) | 13 |
| 9 | 申时 (15-17) | 15 |
| 10 | 酉时 (17-19) | 17 |
| 11 | 戌时 (19-21) | 19 |
| 12 | 亥时 (21-23) | 21 |

这些代表 hour 经 `floor((hour+1)/2)%12` 排盘正好落回对应时柱，与旧手输结果一致。

## 共用工具：`packages/miniapp/src/lib/birthPicker.ts`（新建）

两页共用，避免重复。导出：

- `SHICHEN_LABELS: string[]` —— 13 项下拉标签（含首项「不确定」）。
- `shichenIndexToHour(index: number): number | undefined` —— 下拉 index → 存储 hour；index 0（不确定）返回 `undefined`。
- `hourToShichenIndex(hour: number | undefined): number` —— 存储 hour → 下拉 index，用于回显；`undefined` 返回 0。用 `floor((hour+1)/2)%12` 求 12 支索引后 +1 对齐标签数组。
- 日期字符串拆合：`toDateStr(y,m,d): string`（补零成 `YYYY-MM-DD`）、`fromDateStr(s): { year, month, day }`。

纯函数、无副作用，附单元测试（miniapp 用 vitest）。

## 页面改动

### friend-detail.vue（好友补录表单）

- 模板：把 4 个 `input` 换成 1 个日期 `picker` + 1 个时辰 `picker`。
- 状态：`bYear/bMonth/bDay/bHour` 四个字符串 ref 收敛为 `birthDate`（`YYYY-MM-DD` 字符串或空）与 `shichenIdx`（number，默认 0）。
- `openBirthForm()`：从 `friendBirth` 预填 → `birthDate = toDateStr(...)`，`shichenIdx = hourToShichenIndex(b.hour)`。
- `saveBirth()`：从 `birthDate` 解析 year/month/day；`hour = shichenIndexToHour(shichenIdx)`；保留范围兜底校验（未选日期时提示）。
- `extractBirthFromChat()`：AI 回填时改为设置 `birthDate` 与 `shichenIdx`（由 `hourToShichenIndex` 定位）。

### my-bazi.vue（我的命盘设置）

同样把 4 个 `input` 换成日期 picker + 时辰 picker，`year/month/day/hour` ref 收敛为 `birthDate` + `shichenIdx`，保存与回显逻辑同上。

样式：复用现有 `.row2/.lbl2/.inp2`（friend-detail）与 `.row/.lbl/.inp`（my-bazi）的排版，picker 触发区沿用输入框视觉，保持两页观感一致。

## 从昵称/备注自动识别生日（仅好友补录）

好友昵称/备注常带出生日期，如【月恒 95.1.8己亥】里的 `95.1.8`。打开好友补录表单时自动识别并预填，省去手输；识别不到则回落到现状（空表单 + AI 从聊天抽取 + 手选）。仅用于好友补录，「我的命盘」是用户自己、无好友昵称，不涉及。

### 解析函数（加入 `birthPicker.ts`，纯函数）

- `parseBirthFromText(text: string): { year, month, day } | null`
- 正则搜整串中的日期片段：`(\d{2,4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?`，命中【月恒 95.1.8己亥】的 `95.1.8`，忽略前后无关文字。
- 年份位数：4 位直接用；2 位以 30 为界（`YY >= 30` → 19YY，`< 30` → 20YY）；1 或 3 位视为不合法。
- 校验 `month 1-12`、`day 1-31`、`year 1900-2100`，任一不过返回 `null`。
- **只认带分隔符/年月日的**日期，不解析纯数字串（如 `19950108`），避免把 QQ 号、版本号误判为生日。
- 时辰不从文本推断（"己亥"等干支是网名，不可靠），仍由用户选。

### 交互（friend-detail）

- `openBirthForm()` 里，若好友尚无生辰：依次 `parseBirthFromText(name)` → `parseBirthFromText(alias)`，命中即预填日期 picker，`shichenIdx` 保持 0（不确定）。
- 表单顶部显示一行可核对提示：`已根据昵称识别生日 1995-01-08，请确认`（识别不到则不显示）。
- 预填只是便利，用户可直接改日期/时辰下拉再保存；命理结果页「修改生辰」入口随时可重开修改。最终以用户确认/修改值为准。

## 验证

- 选日期 + 某时辰保存 → 命盘时柱与旧手输同值一致。
- `parseBirthFromText('月恒 95.1.8己亥')` → `{1995,1,8}`；`'1995.1.8'`/`'1995-1-8'`/`'1995年1月8日'`/`'08.3.5'`(→2008) 均正确；`'19950108'`、`'2.0.1'`、`'13.14'`(月 13 非法) → `null`。
- 打开带生日昵称的好友补录 → 日期已预填 + 提示条显示；用户改日期后保存以改后值为准。
- 重开表单 → 日期与时辰下拉正确回显。
- AI 从聊天抽取生辰 → 回填后下拉正确选中。
- 时辰选「不确定」→ `BirthInfo` 不含 hour，排盘走无时柱分支（结果偏粗提示照旧）。
- birthPicker.ts 单测覆盖 12 时辰往返（index→hour→index 幂等）与日期拆合。

## 范围之外

- 不改存储结构、云备份、AI 抽取协议、内核排盘。
- 不支持农历日期选择（现状即公历，保持不变）。
- 昵称/备注识别不解析无分隔纯数字串（如 `19950108`），避免误判；此类由用户手选。
- 不做子时早/晚分（23:00 与 00:00 统一按子时代表 hour=0 处理，属娱乐功能可接受精度）。
