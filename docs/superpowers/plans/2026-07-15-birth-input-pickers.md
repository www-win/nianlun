# 命理生辰输入改为下拉选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把命理生辰的两处手输表单（好友补录、我的命盘）改成微信原生日期滚轮 + 十二时辰下拉，存储与排盘不变。

**Architecture:** 新增纯函数工具 `birthPicker.ts`（十二时辰 ↔ hour 映射、日期串拆合），两个 `.vue` 页面用它把 4 个数字 `input` 换成 1 个 `<picker mode="date">` + 1 个 `<picker mode="selector">`。存储层仍是 `BirthInfo { year, month, day, hour? }`，映射全在 UI 层完成，内核排盘、云备份、AI 抽取均不改。

**Tech Stack:** uni-app (Vue 3 `<script setup lang="ts">`) + 微信小程序 `<picker>`；Vitest（node 环境）测纯函数；`@nianlun/core` 的 `BirthInfo` 类型。

## Global Constraints

- 存储结构不变：仍是 `BirthInfo { year, month, day, hour?, isLunar?, gender? }`，来自 `@nianlun/core`，不新增字段。
- 时辰 ↔ hour 映射必须与内核 `lunar-javascript` 一致：时辰地支索引 = `floor((hour+1)/2) % 12`（hour 0 与 23 都归子时）。
- `core` 边界不动：不在 core 里加任何东西；映射工具放 `packages/miniapp/src/lib/`。
- 十二时辰代表 hour（子..亥）：`[0, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]`。
- miniapp 测试用 Vitest node 环境（`packages/miniapp/vitest.config.ts`），测试放 `src/lib/__tests__/`，`import { describe, it, expect } from 'vitest'`。
- 所有面向用户文案用中文。

---

### Task 1: birthPicker 映射工具（纯函数 + TDD）

**Files:**
- Create: `packages/miniapp/src/lib/birthPicker.ts`
- Test: `packages/miniapp/src/lib/__tests__/birthPicker.test.ts`

**Interfaces:**
- Consumes: 无（纯 TS，标准库）。
- Produces（Task 2、3 依赖这些确切签名）:
  - `SHICHEN_LABELS: readonly string[]` —— 13 项下拉标签，index 0 为「不确定」。
  - `shichenIndexToHour(index: number): number | undefined` —— 下拉 index → 存储 hour；index 0 或越界 → `undefined`。
  - `hourToShichenIndex(hour: number | undefined): number` —— 存储 hour → 下拉 index（0..12）；`undefined`/非有限 → 0。
  - `toDateStr(year: number, month: number, day: number): string` —— 补零成 `"YYYY-MM-DD"`。
  - `fromDateStr(s: string): { year: number; month: number; day: number } | null` —— 解析 `"YYYY-MM-DD"`，非法 → `null`。
  - `parseBirthFromText(text: string): { year: number; month: number; day: number } | null` —— 从任意文本（昵称/备注）里识别公历生日，识别不到 → `null`。

- [ ] **Step 1: 写失败测试**

`packages/miniapp/src/lib/__tests__/birthPicker.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  SHICHEN_LABELS,
  shichenIndexToHour,
  hourToShichenIndex,
  toDateStr,
  fromDateStr,
  parseBirthFromText,
} from '../birthPicker'

describe('SHICHEN_LABELS', () => {
  it('共 13 项，首项为不确定', () => {
    expect(SHICHEN_LABELS).toHaveLength(13)
    expect(SHICHEN_LABELS[0]).toBe('不确定')
    expect(SHICHEN_LABELS[1]).toContain('子时')
    expect(SHICHEN_LABELS[12]).toContain('亥时')
  })
})

describe('shichenIndexToHour', () => {
  it('index 0（不确定）返回 undefined', () => {
    expect(shichenIndexToHour(0)).toBeUndefined()
  })
  it('越界返回 undefined', () => {
    expect(shichenIndexToHour(-1)).toBeUndefined()
    expect(shichenIndexToHour(13)).toBeUndefined()
  })
  it('12 时辰映射到代表 hour', () => {
    const hours = [0, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]
    hours.forEach((h, i) => expect(shichenIndexToHour(i + 1)).toBe(h))
  })
})

describe('hourToShichenIndex', () => {
  it('undefined / 非有限返回 0', () => {
    expect(hourToShichenIndex(undefined)).toBe(0)
    expect(hourToShichenIndex(NaN)).toBe(0)
  })
  it('与内核 floor((hour+1)/2)%12 一致：hour 0 与 23 都归子时(index 1)', () => {
    expect(hourToShichenIndex(0)).toBe(1)
    expect(hourToShichenIndex(23)).toBe(1)
    expect(hourToShichenIndex(14)).toBe(8)  // 未时
  })
  it('12 时辰往返幂等：index -> hour -> index', () => {
    for (let idx = 1; idx <= 12; idx++) {
      const h = shichenIndexToHour(idx)!
      expect(hourToShichenIndex(h)).toBe(idx)
    }
  })
})

describe('toDateStr / fromDateStr', () => {
  it('补零成 YYYY-MM-DD', () => {
    expect(toDateStr(1990, 8, 5)).toBe('1990-08-05')
    expect(toDateStr(2000, 12, 31)).toBe('2000-12-31')
  })
  it('解析合法日期串，非法返回 null', () => {
    expect(fromDateStr('1990-08-05')).toEqual({ year: 1990, month: 8, day: 5 })
    expect(fromDateStr('')).toBeNull()
    expect(fromDateStr('1990/08/05')).toBeNull()
  })
  it('拆合往返一致', () => {
    const s = toDateStr(1988, 2, 29)
    expect(fromDateStr(s)).toEqual({ year: 1988, month: 2, day: 29 })
  })
})

describe('parseBirthFromText', () => {
  it('从昵称中挑出生日，忽略无关文字', () => {
    expect(parseBirthFromText('月恒 95.1.8己亥')).toEqual({ year: 1995, month: 1, day: 8 })
  })
  it('支持多种分隔符与年月日写法', () => {
    expect(parseBirthFromText('1995.1.8')).toEqual({ year: 1995, month: 1, day: 8 })
    expect(parseBirthFromText('1995-1-8')).toEqual({ year: 1995, month: 1, day: 8 })
    expect(parseBirthFromText('1995/1/8')).toEqual({ year: 1995, month: 1, day: 8 })
    expect(parseBirthFromText('1995年1月8日')).toEqual({ year: 1995, month: 1, day: 8 })
  })
  it('两位数年份以 30 为界推断世纪', () => {
    expect(parseBirthFromText('95.1.8')).toEqual({ year: 1995, month: 1, day: 8 })
    expect(parseBirthFromText('08.3.5')).toEqual({ year: 2008, month: 3, day: 5 })
    expect(parseBirthFromText('29.12.31')).toEqual({ year: 2029, month: 12, day: 31 })
    expect(parseBirthFromText('30.1.1')).toEqual({ year: 1930, month: 1, day: 1 })
  })
  it('非法与纯数字串返回 null', () => {
    expect(parseBirthFromText('19950108')).toBeNull()   // 无分隔纯数字不解析
    expect(parseBirthFromText('2.0.1')).toBeNull()       // year 仅 1 位
    expect(parseBirthFromText('95.13.8')).toBeNull()     // 月非法
    expect(parseBirthFromText('95.1.40')).toBeNull()     // 日非法
    expect(parseBirthFromText('无生日的昵称')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/birthPicker.test.ts`
Expected: FAIL —— `Cannot find module '../birthPicker'`。

- [ ] **Step 3: 写实现**

`packages/miniapp/src/lib/birthPicker.ts`：

```ts
/** 生辰下拉选择工具：十二时辰 ↔ hour 映射、日期串拆合。纯函数，无副作用。 */

/** 下拉标签，index 0 为「不确定」，1..12 对应子..亥。 */
export const SHICHEN_LABELS: readonly string[] = [
  '不确定',
  '子时 (23-1)', '丑时 (1-3)', '寅时 (3-5)', '卯时 (5-7)',
  '辰时 (7-9)', '巳时 (9-11)', '午时 (11-13)', '未时 (13-15)',
  '申时 (15-17)', '酉时 (17-19)', '戌时 (19-21)', '亥时 (21-23)',
]

/** 子..亥的代表 hour；经内核 floor((hour+1)/2)%12 排盘正好落回对应时辰。 */
const SHICHEN_HOURS = [0, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]

/** 下拉 index → 存储 hour；index 0（不确定）或越界返回 undefined。 */
export function shichenIndexToHour(index: number): number | undefined {
  if (!Number.isInteger(index) || index <= 0 || index > 12) return undefined
  return SHICHEN_HOURS[index - 1]
}

/** 存储 hour → 下拉 index（0..12）；undefined/非有限返回 0（不确定）。 */
export function hourToShichenIndex(hour: number | undefined): number {
  if (hour == null || !Number.isFinite(hour)) return 0
  const h = ((Math.trunc(hour) % 24) + 24) % 24
  const branch = Math.floor((h + 1) / 2) % 12  // 0=子 .. 11=亥
  return branch + 1
}

/** 年月日 → "YYYY-MM-DD"（补零）。 */
export function toDateStr(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/** "YYYY-MM-DD" → 年月日；非法格式返回 null。 */
export function fromDateStr(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

/** 从任意文本（昵称/备注）识别公历生日；识别不到返回 null。只认带分隔符/年月日的日期。 */
export function parseBirthFromText(text: string): { year: number; month: number; day: number } | null {
  const m = /(\d{2,4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?/.exec(text)
  if (!m) return null
  let year = Number(m[1])
  const month = Number(m[2]), day = Number(m[3])
  if (m[1].length === 2) year = year >= 30 ? 1900 + year : 2000 + year
  else if (m[1].length !== 4) return null   // 1 或 3 位年份视为不合法
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/birthPicker.test.ts`
Expected: PASS（全部用例绿）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/lib/birthPicker.ts packages/miniapp/src/lib/__tests__/birthPicker.test.ts
git commit -m "feat(miniapp): 新增 birthPicker 生辰下拉映射工具"
```

---

### Task 2: 好友补录表单改下拉（friend-detail.vue）

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`
  - 脚本：约 350-395 行（`showBirthForm` / `bYear..bHour` / `openBirthForm` / `saveBirth` / `extractBirthFromChat`）
  - 模板：约 642-645 行（4 个 `input`）
  - 顶部 import 区（约 16 行处，`astroView` 同目录旁）
- Test: 无单测（uni-app 页面，node 环境下不跑组件）；靠回归测试套件 + 手动冒烟。

**Interfaces:**
- Consumes（来自 Task 1）: `SHICHEN_LABELS`、`shichenIndexToHour`、`hourToShichenIndex`、`toDateStr`、`fromDateStr`。
- Produces: 无（页面终点）。

- [ ] **Step 1: 引入工具**

在 friend-detail.vue 顶部 import 区（`astroView` 那行之后）加：

```ts
import { SHICHEN_LABELS, shichenIndexToHour, hourToShichenIndex, toDateStr, fromDateStr, parseBirthFromText } from '../../lib/birthPicker'
```

- [ ] **Step 2: 替换表单状态**

把这一行（约 352 行）：

```ts
const bYear = ref(''); const bMonth = ref(''); const bDay = ref(''); const bHour = ref('')
```

改为：

```ts
const birthDate = ref('')      // "YYYY-MM-DD"，空表示未选
const shichenIdx = ref(0)      // 0=不确定，1..12=子..亥
const birthHint = ref('')      // 从昵称/备注识别到生日时的核对提示，空表示无
```

- [ ] **Step 3: 改 openBirthForm（预填）**

把 `openBirthForm`（约 353-360 行）整体替换为：

```ts
function openBirthForm() {
  const f = friend.value
  const b = friendBirth.value
  birthHint.value = ''
  if (b) {
    // 已有生辰：按存储值回显，不做昵称识别
    birthDate.value = toDateStr(b.year, b.month, b.day)
    shichenIdx.value = hourToShichenIndex(b.hour)
  } else {
    // 尚无生辰：尝试从昵称、再从备注识别生日并预填
    shichenIdx.value = 0
    const guess = f ? (parseBirthFromText(f.name) ?? parseBirthFromText(f.alias)) : null
    if (guess) {
      birthDate.value = toDateStr(guess.year, guess.month, guess.day)
      birthHint.value = `已根据昵称识别生日 ${birthDate.value}，请确认`
    } else {
      birthDate.value = ''
    }
  }
  showBirthForm.value = true
}
```

注：`parseBirthFromText` 对 `name` 与 `alias` 依次尝试，两者都可能为空串（返回 `null`），`??` 保证昵称优先。

- [ ] **Step 4: 改 saveBirth（保存）**

把 `saveBirth`（约 361-375 行）整体替换为：

```ts
function saveBirth() {
  const f = friend.value; if (!f) return
  const parsed = fromDateStr(birthDate.value)
  if (!parsed) { uni.showToast({ title: '请选择出生日期', icon: 'none' }); return }
  const { year: y, month: m, day: d } = parsed
  if (y < 1900 || y > 2100 || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
    uni.showToast({ title: '请选择有效的出生日期', icon: 'none' }); return
  }
  const b: BirthInfo = { year: y, month: m, day: d }
  const h = shichenIndexToHour(shichenIdx.value)
  if (h !== undefined) b.hour = h
  const all = storage.loadBirths(); all[f.id] = b; storage.saveBirths(all)
  friendBirth.value = b
  showBirthForm.value = false
  // 触发云备份：好友生辰同样只存本地会随微信清空/换机丢失，须同步到云端
  useBackupStore().scheduleBackup()
  uni.showToast({ title: '已保存生辰', icon: 'success' })
}
```

- [ ] **Step 5: 改 extractBirthFromChat（AI 回填）**

把 `extractBirthFromChat` 里成功分支的回填（约 383-386 行）：

```ts
    if (b) {
      bYear.value = String(b.year); bMonth.value = String(b.month); bDay.value = String(b.day)
      bHour.value = b.hour != null ? String(b.hour) : ''
      uni.showToast({ title: '已从聊天预填，请确认', icon: 'none' })
    } else {
```

替换为：

```ts
    if (b) {
      birthDate.value = toDateStr(b.year, b.month, b.day)
      shichenIdx.value = hourToShichenIndex(b.hour)
      birthHint.value = ''   // 来源改为 AI 抽取，清掉昵称识别提示
      uni.showToast({ title: '已从聊天预填，请确认', icon: 'none' })
    } else {
```

- [ ] **Step 6: 替换模板输入框**

把 4 行 `input`（约 642-645 行）：

```html
          <view class="row2"><text class="lbl2">年</text><input class="inp2" type="number" v-model="bYear" placeholder="如 1990" /></view>
          <view class="row2"><text class="lbl2">月</text><input class="inp2" type="number" v-model="bMonth" placeholder="1-12" /></view>
          <view class="row2"><text class="lbl2">日</text><input class="inp2" type="number" v-model="bDay" placeholder="1-31" /></view>
          <view class="row2"><text class="lbl2">时辰</text><input class="inp2" type="number" v-model="bHour" placeholder="0-23，选填" /></view>
```

替换为：

```html
          <text v-if="birthHint" class="birth-hint">{{ birthHint }}</text>
          <view class="row2"><text class="lbl2">出生日期</text>
            <picker class="inp2 pk" mode="date" :value="birthDate" start="1900-01-01" end="2100-12-31" @change="(e: any) => birthDate = e.detail.value">
              <text :class="['pk-v', !birthDate && 'ph']">{{ birthDate || '请选择出生日期' }}</text>
            </picker>
          </view>
          <view class="row2"><text class="lbl2">时辰</text>
            <picker class="inp2 pk" mode="selector" :range="SHICHEN_LABELS" :value="shichenIdx" @change="(e: any) => shichenIdx = Number(e.detail.value)">
              <text class="pk-v">{{ SHICHEN_LABELS[shichenIdx] }}</text>
            </picker>
          </view>
```

- [ ] **Step 7: 加 picker 样式**

在 `<style scoped>` 里 `.inp2` 规则（约 799 行）之后加：

```css
.pk { display: flex; align-items: center; justify-content: flex-end; }
.pk-v { font-size: 25rpx; color: var(--fg); }
.pk-v.ph { color: var(--muted); }
.birth-hint { display: block; margin: 12rpx 0; padding: 12rpx 18rpx; font-size: 23rpx; color: var(--accent-strong); background: var(--accent-wash); border-radius: 10rpx; }
```

- [ ] **Step 8: 回归测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（不引入回归；birthPicker 用例也在内）。

- [ ] **Step 9: 手动冒烟（微信开发者工具）**

`pnpm --filter @nianlun/miniapp dev:mp-weixin`，在开发者工具打开：
- 进一个无生辰好友 → 补录表单出现日期滚轮 + 时辰下拉。
- 昵称含生日的好友（如「月恒 95.1.8己亥」）→ 打开补录时日期已预填 1995-01-08 + 顶部提示条「已根据昵称识别生日…请确认」；改日期后保存以改后值为准。
- 昵称无生日的好友 → 无提示条、日期空，可手选或用「AI 从聊天抽取」。
- 选日期 + 某时辰 → 保存 → 命盘正常排出、时柱与预期时辰一致。
- 点「修改生辰」重开 → 日期与时辰下拉正确回显（已有生辰不再触发昵称识别、无提示条）。
- 时辰选「不确定」保存 → 排盘走无时柱分支（glance 显示「未含时柱，结果偏粗」）。

- [ ] **Step 10: 提交**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 好友生辰补录表单改日期滚轮+时辰下拉"
```

---

### Task 3: 我的命盘设置改下拉（my-bazi.vue）

**Files:**
- Modify: `packages/miniapp/src/pages/my-bazi/my-bazi.vue`
  - 脚本：8-11 行（ref）、15-23 行（onLoad）、25-42 行（save）、import 区
  - 模板：50-53 行（4 个 `input`）
- Test: 无单测（同 Task 2）；靠回归测试套件 + 手动冒烟。

**Interfaces:**
- Consumes（来自 Task 1）: `SHICHEN_LABELS`、`shichenIndexToHour`、`hourToShichenIndex`、`toDateStr`、`fromDateStr`。
- Produces: 无（页面终点）。

- [ ] **Step 1: 引入工具**

在 my-bazi.vue import 区（`useBackupStore` 那行之后，约 6 行处）加：

```ts
import { SHICHEN_LABELS, shichenIndexToHour, hourToShichenIndex, toDateStr, fromDateStr } from '../../lib/birthPicker'
```

- [ ] **Step 2: 替换日期/时辰状态**

把 8-11 行：

```ts
const year = ref('')
const month = ref('')
const day = ref('')
const hour = ref('')          // 空表示不填时辰
```

替换为：

```ts
const birthDate = ref('')     // "YYYY-MM-DD"，空表示未选
const shichenIdx = ref(0)     // 0=不确定，1..12=子..亥
```

（`isLunar`、`gender` 两个 ref 保留不动。）

- [ ] **Step 3: 改 onLoad（预填）**

把 onLoad（15-23 行）替换为：

```ts
onLoad(() => {
  const b = storage.loadMyBazi()
  if (b) {
    birthDate.value = toDateStr(b.year, b.month, b.day)
    shichenIdx.value = hourToShichenIndex(b.hour)
    isLunar.value = !!b.isLunar
    gender.value = b.gender ?? ''
  }
})
```

- [ ] **Step 4: 改 save（保存）**

把 save（25-42 行）替换为：

```ts
function save() {
  const parsed = fromDateStr(birthDate.value)
  if (!parsed) { uni.showToast({ title: '请选择出生日期', icon: 'none' }); return }
  const { year: y, month: m, day: d } = parsed
  if (y < 1900 || y > 2100 || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
    uni.showToast({ title: '请选择有效的出生日期', icon: 'none' }); return
  }
  const b: BirthInfo = { year: y, month: m, day: d }
  const h = shichenIndexToHour(shichenIdx.value)
  if (h !== undefined) b.hour = h
  if (isLunar.value) b.isLunar = true
  if (gender.value) b.gender = gender.value
  storage.saveMyBazi(b)
  // 触发云备份：生辰只存本地会被微信清空/换机丢失，须同步到云端才能"设一次就好"
  useBackupStore().scheduleBackup()
  uni.showToast({ title: '已保存', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 500)
}
```

- [ ] **Step 5: 替换模板输入框**

把 50-53 行：

```html
      <view class="row"><text class="lbl">出生年</text><input class="inp" type="number" v-model="year" placeholder="如 1990" /></view>
      <view class="row"><text class="lbl">月</text><input class="inp" type="number" v-model="month" placeholder="1-12" /></view>
      <view class="row"><text class="lbl">日</text><input class="inp" type="number" v-model="day" placeholder="1-31" /></view>
      <view class="row"><text class="lbl">时辰(选填)</text><input class="inp" type="number" v-model="hour" placeholder="0-23，不确定可留空" /></view>
```

替换为：

```html
      <view class="row"><text class="lbl">出生日期</text>
        <picker class="inp pk" mode="date" :value="birthDate" start="1900-01-01" end="2100-12-31" @change="(e: any) => birthDate = e.detail.value">
          <text :class="['pk-v', !birthDate && 'ph']">{{ birthDate || '请选择出生日期' }}</text>
        </picker>
      </view>
      <view class="row"><text class="lbl">时辰(选填)</text>
        <picker class="inp pk" mode="selector" :range="SHICHEN_LABELS" :value="shichenIdx" @change="(e: any) => shichenIdx = Number(e.detail.value)">
          <text class="pk-v">{{ SHICHEN_LABELS[shichenIdx] }}</text>
        </picker>
      </view>
```

- [ ] **Step 6: 加 picker 样式**

在 `<style scoped>` 里 `.inp` 规则（约 74 行）之后加：

```css
.pk { display: flex; align-items: center; justify-content: flex-end; }
.pk-v { font-size: 26rpx; color: var(--fg); }
.pk-v.ph { color: var(--muted); }
```

- [ ] **Step 7: 回归测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS。

- [ ] **Step 8: 手动冒烟（微信开发者工具）**

- 进「设置我的生辰」页 → 日期滚轮 + 时辰下拉显示。
- 已有命盘时进入 → 日期与时辰正确回显。
- 选日期 + 时辰 + 农历/性别 → 保存 → 返回；重进回显一致；好友合盘正常。

- [ ] **Step 9: 提交**

```bash
git add packages/miniapp/src/pages/my-bazi/my-bazi.vue
git commit -m "feat(miniapp): 我的命盘设置改日期滚轮+时辰下拉"
```

---

## Self-Review

**Spec 覆盖：**
- 年月日日期滚轮 → Task 2 Step 6、Task 3 Step 5（`<picker mode="date">`）✓
- 十二时辰下拉（13 项含不确定）→ Task 1 `SHICHEN_LABELS` + Task 2/3 selector ✓
- 时辰 ↔ hour 映射与内核一致、往返幂等 → Task 1 Step 1 幂等测试 ✓
- 存储不变、AI 抽取回填、云备份不动 → Task 2 Step 5 保留 AI 逻辑、Task 2/3 保留 `scheduleBackup` ✓
- 「不确定」不写 hour → `shichenIndexToHour(0) === undefined` + save 里 `if (h !== undefined)` ✓
- 共用工具放 miniapp lib、core 不动 → Task 1 建于 `packages/miniapp/src/lib/` ✓
- 手输范围校验保留兜底 → Task 2 Step 4、Task 3 Step 4 的 1900-2100/月/日 校验 ✓
- 从昵称/备注识别生日（仅好友补录）→ Task 1 `parseBirthFromText` + 测试、Task 2 Step 3 openBirthForm 预填 + Step 6 提示条 ✓
- 识别只预填、用户可改 → Task 2 日期/时辰 picker 可改、saveBirth 以表单值为准；「修改生辰」重开走已有生辰分支不再识别 ✓
- 不解析纯数字串、时辰不猜 → `parseBirthFromText` 需分隔符、openBirthForm 里 `shichenIdx=0` ✓

**占位符扫描：** 无 TBD/TODO；每个改代码步骤都给出完整代码块。

**类型一致性：** `birthDate: string`、`shichenIdx: number` 在两页一致；`shichenIndexToHour` 返回 `number | undefined` 与 save 里 `if (h !== undefined)` 一致；`hourToShichenIndex(b?.hour)` 接受 `number | undefined` 与签名一致。
