<script setup lang="ts">
import { useDataStore } from '../stores/data'
import TheTopbar from '../components/TheTopbar.vue'
import TheFooter from '../components/TheFooter.vue'
const data = useDataStore()
</script>

<template>
  <TheTopbar />

  <main class="wrap">

    <!-- HERO -->
    <section class="hero" data-od-id="hero">
      <div class="hero-grid">
        <div>
          <span class="eyebrow">本地优先 · 隐私保护</span>
          <h1>把一年的聊天<br/>整理成一圈<span class="jade">年轮</span>。</h1>
          <p class="lead">导入你导出的微信聊天记录，年轮在你自己的设备上完成解析，自动整理好友名单、首次与最近联系时间、消息往来，并生成一份可分享的年度报告。全程离线，记录不上传。</p>
          <div class="hero-cta">
            <router-link v-if="data.hasData" class="btn btn-primary" to="/report">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 10.5V2.5M8 2.5 5 5.5M8 2.5l3 3M2.5 9.5v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              查看年度报告
            </router-link>
            <router-link v-else class="btn btn-primary" to="/import">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 10.5V2.5M8 2.5 5 5.5M8 2.5l3 3M2.5 9.5v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              导入聊天记录
            </router-link>
            <router-link class="btn" to="/report">看一份示例报告</router-link>
          </div>
          <p class="hero-note">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.4" stroke="var(--faint)" stroke-width="1.2"/><path d="M8 5v3.4l2.2 1.3" stroke="var(--faint)" stroke-width="1.2" stroke-linecap="round"/></svg>
            首次整理约 1–2 分钟，取决于聊天记录大小
          </p>
        </div>

        <!-- stylized ring visual: relationships orbiting a year -->
        <div class="orb" aria-hidden="true">
          <div class="ring" style="inset:0;"></div>
          <div class="ring" style="inset:16%;"></div>
          <div class="ring" style="inset:33%; border-style:dashed;"></div>
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" fill="none" stroke="var(--accent-line)" stroke-width="0.4" stroke-dasharray="2 3"/>
          </svg>
          <div class="core">
            <div class="big">2025</div>
            <div class="cap">Recap</div>
          </div>
          <div class="node" style="left:50%; top:4%;"><i style="background:oklch(60% 0.12 25)"></i>家人</div>
          <div class="node" style="left:92%; top:42%;"><i style="background:oklch(58% 0.1 250)"></i>同事</div>
          <div class="node" style="left:78%; top:88%;"><i style="background:oklch(62% 0.12 145)"></i>挚友</div>
          <div class="node" style="left:16%; top:80%;"><i style="background:oklch(66% 0.13 75)"></i>同学</div>
          <div class="node" style="left:6%; top:32%;"><i style="background:oklch(58% 0.11 320)"></i>客户</div>
        </div>
      </div>
    </section>

    <!-- THREE SCREENS -->
    <section class="section" data-od-id="screens">
      <div class="sec-head">
        <h2>三步走完整流程</h2>
        <router-link class="muted" to="/import" style="font-size:13.5px;">从导入开始 →</router-link>
      </div>
      <div class="screens">

        <router-link class="card screen-card" to="/import" data-od-id="card-import">
          <div class="screen-thumb">
            <div class="th-drop"><div class="dot"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 10.5V2.5M8 2.5 5 5.5M8 2.5l3 3M3 10v2.5h10V10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>
          </div>
          <div class="screen-body">
            <span class="step">STEP 01</span>
            <h3>导入 / 导出</h3>
            <p>拖入导出的聊天记录文件，本地解析进度可视；支持二次导出为 CSV / JSON 备份。</p>
            <span class="go">去导入 <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </div>
        </router-link>

        <router-link class="card screen-card" to="/friends" data-od-id="card-friends">
          <div class="screen-thumb">
            <div class="th-rows"><div class="r a"></div><div class="r"></div><div class="r" style="width:85%"></div><div class="r a" style="width:55%"></div><div class="r" style="width:78%"></div></div>
          </div>
          <div class="screen-body">
            <span class="step">STEP 02</span>
            <h3>好友信息整理</h3>
            <p>自动归集昵称、备注、首次/最近联系时间与消息量；可手动补充职务、关系标签。</p>
            <span class="go">看好友表 <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </div>
        </router-link>

        <router-link class="card screen-card" to="/report" data-od-id="card-report">
          <div class="screen-thumb">
            <div class="th-poster"><div class="big">2025</div><div class="l"></div><div class="l s"></div><div class="l" style="margin-top:14px"></div><div class="l s"></div></div>
          </div>
          <div class="screen-body">
            <span class="step">STEP 03</span>
            <h3>年度报告</h3>
            <p>一页式回顾：联系最多的人、最早入睡的深夜、年度关键词，可保存为长图分享。</p>
            <span class="go">生成报告 <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </div>
        </router-link>

      </div>
    </section>

    <!-- HOW IT WORKS -->
    <section class="section" data-od-id="how">
      <div class="sec-head"><h2>它是怎么运作的</h2></div>
      <div class="steps">
        <div class="step-item"><div class="n">1</div><div><h4>你来导出</h4><p>在微信里把某位好友或群的聊天记录导出，得到 .txt / .html / .bak 文件。</p></div></div>
        <div class="step-item"><div class="n">2</div><div><h4>年轮本地解析</h4><p>文件只在本机读取与分析，不联网、不上传，原始记录始终在你手里。</p></div></div>
        <div class="step-item"><div class="n">3</div><div><h4>整理与回顾</h4><p>得到结构化好友表与年度报告，随时再导出备份，或删除全部本地数据。</p></div></div>
      </div>
    </section>

    <!-- PRIVACY BAND -->
    <section class="section privacy-band" data-od-id="privacy">
      <div class="card card-pad">
        <div class="shield">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 2 4 5.2v5.1c0 4.6 3.4 8.8 8 10 4.6-1.2 8-5.4 8-10V5.2L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m8.6 12 2.4 2.4L16 9.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div>
          <h3 style="font-size:18px;">你的聊天，只属于你</h3>
          <ul>
            <li><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m3 8.5 3 3 7-7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>全程离线解析，无服务器</li>
            <li><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m3 8.5 3 3 7-7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>数据存本机，可一键清除</li>
            <li><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m3 8.5 3 3 7-7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>报告导出由你决定是否分享</li>
            <li><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m3 8.5 3 3 7-7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>不读取通讯录与好友隐私字段</li>
          </ul>
        </div>
      </div>
    </section>

  </main>

  <TheFooter />
</template>

<style scoped>
/* ---- index-only styles ---- */
.hero { padding: 72px 0 40px; }
.hero-grid { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 56px; align-items: center; }
.hero h1 { font-size: clamp(34px, 5.2vw, 56px); letter-spacing: -0.028em; }
.hero h1 .jade { color: var(--accent-strong); }
.hero p.lead { font-size: 17px; color: var(--muted); margin-top: 20px; max-width: 30em; line-height: 1.65; }
.hero-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.hero-note { margin-top: 18px; font-size: 12.5px; color: var(--faint); display: flex; align-items: center; gap: 8px; }

/* device preview — a stylized "ring" data visual, not a stock image */
.orb { position: relative; aspect-ratio: 1; max-width: 380px; margin-left: auto; }
.orb .ring { position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid var(--border-2); }
.orb svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.orb .core {
  position: absolute; inset: 33%; border-radius: 50%;
  background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow-lg); display: grid; place-content: center; text-align: center;
}
.orb .core .big { font-family: var(--font-serif); font-size: 40px; font-weight: 600; letter-spacing: -0.01em; }
.orb .core .cap { font-size: 11px; color: var(--faint); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px; font-family: var(--font-mono); }
.orb .node {
  position: absolute; transform: translate(-50%, -50%);
  background: var(--surface); border: 1px solid var(--border-2); border-radius: 999px;
  padding: 5px 11px 5px 7px; font-size: 12px; font-weight: 550; box-shadow: var(--shadow-sm);
  display: flex; align-items: center; gap: 6px; white-space: nowrap;
}
.orb .node i { width: 18px; height: 18px; border-radius: 6px; display: inline-block; }

.section { padding: 18px 0; }
.sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
.sec-head h2 { font-size: 22px; }

.screens { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.screen-card {
  display: flex; flex-direction: column; padding: 0; overflow: hidden;
  transition: transform .14s, box-shadow .14s, border-color .14s; cursor: pointer;
}
.screen-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: var(--border-2); }
.screen-thumb { height: 152px; border-bottom: 1px solid var(--border); position: relative; overflow: hidden; background: var(--surface-2); }
.screen-body { padding: 18px 20px 20px; }
.screen-body .step { font-family: var(--font-mono); font-size: 11px; color: var(--accent-strong); letter-spacing: 0.12em; }
.screen-body h3 { font-size: 17px; margin: 6px 0 6px; }
.screen-body p { font-size: 13.5px; color: var(--muted); line-height: 1.55; }
.screen-body .go { margin-top: 14px; font-size: 13px; font-weight: 600; color: var(--accent-strong); display: inline-flex; align-items: center; gap: 5px; }

/* mini thumbs drawn in CSS — honest stylized previews */
.th-rows { position: absolute; inset: 18px; display: flex; flex-direction: column; gap: 7px; }
.th-rows .r { height: 12px; border-radius: 4px; background: var(--border); }
.th-rows .r.a { width: 70%; background: var(--accent-line); }
.th-drop { position: absolute; inset: 22px; border: 1.5px dashed var(--border-2); border-radius: 12px; display: grid; place-items: center; }
.th-drop .dot { width: 40px; height: 40px; border-radius: 12px; background: var(--accent-wash); border: 1px solid var(--accent-line); display: grid; place-items: center; color: var(--accent-strong); }
.th-poster { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); width: 96px; height: 150px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px 10px 0 0; box-shadow: var(--shadow-sm); padding: 12px 10px; }
.th-poster .big { font-family: var(--font-serif); font-size: 22px; color: var(--accent-strong); font-weight: 600; }
.th-poster .l { height: 6px; border-radius: 3px; background: var(--border); margin-top: 7px; }
.th-poster .l.s { width: 60%; }

.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.step-item { display: flex; gap: 13px; }
.step-item .n { flex: none; width: 28px; height: 28px; border-radius: 8px; background: var(--accent-wash); color: var(--accent-strong); display: grid; place-items: center; font-family: var(--font-mono); font-size: 13px; font-weight: 600; border: 1px solid var(--accent-line); }
.step-item h4 { font-size: 15px; }
.step-item p { font-size: 13px; color: var(--muted); margin-top: 3px; line-height: 1.5; }

.privacy-band { margin-top: 8px; }
.privacy-band .card-pad { display: grid; grid-template-columns: auto 1fr; gap: 22px; align-items: center; }
.privacy-band .shield { width: 56px; height: 56px; border-radius: 16px; background: var(--accent-wash); border: 1px solid var(--accent-line); display: grid; place-items: center; color: var(--accent-strong); }
.privacy-band ul { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 10px; list-style: none; }
.privacy-band li { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 7px; }
.privacy-band li svg { color: var(--accent-strong); flex: none; }

@media (max-width: 900px) {
  .hero-grid { grid-template-columns: 1fr; gap: 36px; }
  .orb { display: none; }
  .screens, .steps { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .hero { padding: 44px 0 28px; }
  .privacy-band .card-pad { grid-template-columns: 1fr; gap: 14px; }
}
</style>
