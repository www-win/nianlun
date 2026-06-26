<script setup lang="ts">
import { computed } from 'vue'
import { useDataStore } from '../stores/data'
import { useUiStore } from '../stores/ui'
import TheTopbar from '../components/TheTopbar.vue'
import TheFooter from '../components/TheFooter.vue'
import AiCopyPanel from '../components/AiCopyPanel.vue'

const data = useDataStore()
const ui = useUiStore()
const report = computed(() => data.report)
const nameOf = (id: string) => data.friends.find((f) => f.id === id)?.name ?? id
const maxStreak = computed(() => data.friends.reduce((m, f) => Math.max(m, f.maxStreak), 0))
const themes = [
  { key: 'jade', label: '玉绿' }, { key: 'dusk', label: '暮橙' }, { key: 'ink', label: '夜墨' },
] as const
function fmtWan(n: number) { return n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n) }
function save() { window.print() }
</script>

<template>
  <TheTopbar />

  <!-- Empty state -->
  <main v-if="!report" class="wrap page empty-state">
    <div class="empty-box">
      <p>还没有年度报告数据。</p>
      <router-link to="/import">导入数据</router-link>
    </div>
  </main>

  <!-- Report page -->
  <template v-else>
    <div class="actionbar">
      <div class="wrap actionbar-in">
        <div>
          <h1>{{ report.year }} 年度聊天报告</h1>
          <div class="who">范围：全部好友 · {{ report.friendCount }} 位 · 本地生成于此设备</div>
        </div>
        <div class="ab-end">
          <div class="themes" role="group" aria-label="报告配色">
            <button
              v-for="t in themes"
              :key="t.key"
              class="sw"
              :class="`t-${t.key}`"
              :data-theme-btn="t.key"
              :aria-pressed="ui.reportTheme === t.key"
              :aria-label="t.label"
              @click="ui.setTheme(t.key)"
            ></button>
          </div>
          <button class="btn btn-primary btn-sm" type="button" @click="save">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M8 10 5 7M8 10l3-3M3 11.5V13h10v-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            保存长图
          </button>
        </div>
      </div>
    </div>

    <AiCopyPanel :report="report" :friends="data.friends" />

    <main class="wrap page">
      <div class="stage">
        <article class="poster" :data-theme="ui.reportTheme">

          <!-- cover -->
          <section class="p-cover">
            <div class="rings-bg" aria-hidden="true">
              <svg viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="48" stroke="var(--p-accent)" stroke-width="0.5"/>
                <circle cx="50" cy="50" r="38" stroke="var(--p-accent)" stroke-width="0.5" opacity="0.7"/>
                <circle cx="50" cy="50" r="28" stroke="var(--p-accent)" stroke-width="0.5" opacity="0.5"/>
                <circle cx="50" cy="50" r="18" stroke="var(--p-accent)" stroke-width="0.5" opacity="0.35"/>
              </svg>
            </div>
            <div class="yr">{{ report.year }}</div>
            <div class="ttl">我的聊天年轮</div>
            <div class="sub">这一年，对话留下的痕迹</div>
            <div class="owner"><span class="d"></span>本机用户 · 全部好友</div>
          </section>

          <!-- overview stats -->
          <section class="p-sec">
            <div class="p-kicker">数字总览</div>
            <div class="p-stats" style="margin-top:18px;">
              <div class="p-stat">
                <div class="v p-num">{{ fmtWan(report.totalMessages) }}<small>条</small></div>
                <div class="l">全年发送 + 接收的消息</div>
              </div>
              <div class="p-stat">
                <div class="v p-num">{{ report.friendCount }}<small>位</small></div>
                <div class="l">保持联系的好友</div>
              </div>
              <div class="p-stat">
                <div class="v p-num">{{ report.activeDays }}<small>天</small></div>
                <div class="l">有聊天发生的日子</div>
              </div>
              <div class="p-stat">
                <div class="v p-num">{{ maxStreak }}<small>天</small></div>
                <div class="l">最长连续聊天天数</div>
              </div>
            </div>
          </section>

          <!-- top contacts -->
          <section v-if="report.topContacts.length" class="p-sec">
            <div class="p-kicker">聊得最多的人</div>
            <div
              v-for="(c, i) in report.topContacts"
              :key="c.friendId"
              class="top-row"
            >
              <div class="rk">{{ i + 1 }}</div>
              <div class="av">{{ nameOf(c.friendId).slice(0, 2) }}</div>
              <div class="info">
                <div class="n">{{ nameOf(c.friendId) }}</div>
                <div class="tb">
                  <i :style="{ width: (c.msgCount / report.topContacts[0].msgCount * 100) + '%' }"></i>
                </div>
              </div>
              <div class="mv">{{ fmtWan(c.msgCount) }}</div>
            </div>
          </section>

          <!-- keywords -->
          <section v-if="report.keywords.length" class="p-sec">
            <div class="p-kicker">年度关键词</div>
            <div class="kw">
              <span
                v-for="(kw, i) in report.keywords"
                :key="kw.word"
                :class="i === 0 ? 'big' : i < 3 ? 'mid' : ''"
              >{{ kw.word }}</span>
            </div>
          </section>

          <!-- relationship breakdown -->
          <section v-if="report.relationBreakdown.length" class="p-sec">
            <div class="p-kicker">关系版图</div>
            <div class="rel-bars">
              <div
                v-for="r in report.relationBreakdown"
                :key="r.rel"
                class="rel-bar"
              >
                <span>{{ r.rel }}</span>
                <div class="track"><i :style="{ width: r.percent + '%' }"></i></div>
                <span class="pc">{{ r.percent }}%</span>
              </div>
            </div>
          </section>

          <!-- closing -->
          <section class="p-close">
            <div class="quote">
              这一年，<br/>
              你和 <span class="ac">{{ report.friendCount }}</span> 位好友<br/>
              共写下 <span class="ac">{{ fmtWan(report.totalMessages) }}</span> 条消息。
            </div>
            <div class="sign">
              <svg width="16" height="16" viewBox="0 0 26 26" fill="none">
                <circle cx="13" cy="13" r="11.5" stroke-width="1.4"/>
                <circle cx="13" cy="13" r="7.5" stroke-width="1.4" opacity="0.6"/>
                <circle cx="13" cy="13" r="3.4" fill="var(--p-accent)" stroke="none"/>
              </svg>
              年轮 · 由本机离线生成 · {{ report.year }}
            </div>
          </section>

        </article>
      </div>
      <p class="tip">「保存长图」会把上面的报告导出为图片/PDF——整个过程在本地完成，不会上传任何内容。</p>
    </main>
  </template>

  <TheFooter />
</template>

<style scoped>
.page { padding: 28px 0 0; }

/* action bar */
.actionbar { position: sticky; top: 60px; z-index: 30; background: oklch(98.5% 0.004 165 / 0.86); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
.actionbar-in { display: flex; align-items: center; gap: 14px; padding: 12px 0; flex-wrap: wrap; }
.actionbar h1 { font-size: 17px; }
.actionbar .who { font-size: 12.5px; color: var(--faint); }
.ab-end { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.themes { display: inline-flex; gap: 6px; padding-right: 6px; border-right: 1px solid var(--border); margin-right: 2px; }
.sw { width: 26px; height: 26px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; padding: 0; outline-offset: 2px; }
.sw[aria-pressed="true"] { border-color: var(--fg); }
.sw.t-jade { background: linear-gradient(135deg, oklch(54% 0.105 168), oklch(40% 0.09 175)); }
.sw.t-dusk { background: linear-gradient(135deg, oklch(64% 0.14 45), oklch(48% 0.13 30)); }
.sw.t-ink  { background: linear-gradient(135deg, oklch(40% 0.06 250), oklch(22% 0.03 250)); }

/* poster */
.stage { display: flex; justify-content: center; padding: 32px 0 64px; }
.poster {
  width: 460px; max-width: 100%; border-radius: 26px; overflow: hidden;
  box-shadow: var(--shadow-lg); position: relative; color: var(--p-fg);
  background: var(--p-bg); font-family: var(--font-body);
  /* default jade theme */
  --p-bg: oklch(22% 0.03 175); --p-fg: oklch(96% 0.01 175); --p-dim: oklch(72% 0.02 175);
  --p-accent: oklch(78% 0.13 165); --p-card: oklch(27% 0.035 175); --p-line: oklch(40% 0.04 175);
}
.poster[data-theme="dusk"] { --p-bg: oklch(24% 0.04 35); --p-fg: oklch(97% 0.01 60); --p-dim: oklch(75% 0.03 50); --p-accent: oklch(80% 0.14 55); --p-card: oklch(29% 0.045 35); --p-line: oklch(42% 0.05 40); }
.poster[data-theme="ink"]  { --p-bg: oklch(20% 0.025 250); --p-fg: oklch(96% 0.008 250); --p-dim: oklch(70% 0.02 250); --p-accent: oklch(76% 0.12 230); --p-card: oklch(25% 0.03 250); --p-line: oklch(38% 0.035 250); }

.p-sec { padding: 30px 30px; border-bottom: 1px solid var(--p-line); position: relative; }
.p-sec:last-child { border-bottom: 0; }
.p-kicker { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--p-accent); }
.p-dim { color: var(--p-dim); }
.p-num { font-family: var(--font-serif); font-weight: 600; letter-spacing: -0.01em; line-height: 1; }

/* cover */
.p-cover { padding: 44px 30px 38px; text-align: center; position: relative; overflow: hidden; }
.p-cover .rings-bg { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0.5; pointer-events: none; }
.p-cover .rings-bg svg { width: 360px; height: 360px; }
.p-cover .yr { font-family: var(--font-serif); font-size: 88px; font-weight: 600; line-height: 0.9; letter-spacing: -0.02em; position: relative; }
.p-cover .ttl { font-size: 17px; font-weight: 600; margin-top: 14px; letter-spacing: 0.02em; position: relative; }
.p-cover .sub { font-size: 12.5px; color: var(--p-dim); margin-top: 8px; position: relative; }
.p-cover .owner { display: inline-flex; align-items: center; gap: 7px; margin-top: 18px; padding: 5px 12px; border: 1px solid var(--p-line); border-radius: 999px; font-size: 12px; position: relative; }
.p-cover .owner .d { width: 7px; height: 7px; border-radius: 50%; background: var(--p-accent); }

/* big stat row */
.p-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 22px 14px; }
.p-stat .v { font-size: 38px; }
.p-stat .v small { font-size: 15px; font-family: var(--font-body); color: var(--p-dim); margin-left: 3px; }
.p-stat .l { font-size: 12px; color: var(--p-dim); margin-top: 4px; }
.p-stat.wide { grid-column: 1 / -1; }

/* top contacts */
.top-row { display: flex; align-items: center; gap: 13px; margin-top: 16px; }
.top-row .rk { font-family: var(--font-serif); font-size: 22px; color: var(--p-accent); width: 26px; flex: none; }
.top-row .av { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; font-weight: 600; color: var(--p-bg); flex: none; font-family: var(--font-display); background: var(--p-accent); }
.top-row .info { flex: 1; min-width: 0; }
.top-row .info .n { font-weight: 600; font-size: 14.5px; }
.top-row .info .t { font-size: 11.5px; color: var(--p-dim); }
.top-row .info .tb { height: 5px; border-radius: 999px; background: var(--p-line); margin-top: 6px; overflow: hidden; }
.top-row .info .tb > i { display: block; height: 100%; background: var(--p-accent); border-radius: 999px; }
.top-row .mv { font-family: var(--font-mono); font-size: 13px; color: var(--p-fg); white-space: nowrap; }

/* keywords */
.kw { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.kw span { padding: 6px 13px; border-radius: 999px; border: 1px solid var(--p-line); font-size: 13px; }
.kw span.big { font-size: 16px; font-weight: 600; color: var(--p-bg); background: var(--p-accent); border-color: var(--p-accent); }
.kw span.mid { color: var(--p-fg); }

/* relationship breakdown */
.rel-bars { margin-top: 14px; display: grid; gap: 10px; }
.rel-bar { display: grid; grid-template-columns: 52px 1fr 38px; align-items: center; gap: 10px; font-size: 12.5px; }
.rel-bar .track { height: 8px; border-radius: 999px; background: var(--p-line); overflow: hidden; }
.rel-bar .track > i { display: block; height: 100%; border-radius: 999px; background: var(--p-accent); }
.rel-bar .pc { font-family: var(--font-mono); color: var(--p-dim); text-align: right; }

/* closing */
.p-close { text-align: center; padding: 36px 30px 40px; }
.p-close .quote { font-family: var(--font-serif); font-size: 21px; line-height: 1.45; font-weight: 600; }
.p-close .quote .ac { color: var(--p-accent); }
.p-close .sign { margin-top: 20px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11.5px; color: var(--p-dim); letter-spacing: 0.04em; }
.p-close .sign svg circle { stroke: var(--p-accent); }

/* tip under poster */
.tip { text-align: center; color: var(--faint); font-size: 12.5px; margin-top: 14px; }

/* empty state */
.empty-state { display: flex; justify-content: center; align-items: center; min-height: 60vh; }
.empty-box { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px; }

@media (max-width: 540px) {
  .actionbar { top: 56px; }
  .poster { border-radius: 20px; }
  .p-cover .yr { font-size: 68px; }
}

/* print = save long image / PDF of poster only */
@media print {
  .topbar, .actionbar, .tip, .footer { display: none !important; }
  body { background: #fff; }
  .stage { padding: 0; }
  .poster { box-shadow: none; width: 460px; }
  @page { margin: 0; }
}
</style>
