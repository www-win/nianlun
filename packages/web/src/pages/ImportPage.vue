<script setup lang="ts">
import { ref, computed } from 'vue'
import { useImportStore } from '../stores/import'
import { useDataStore } from '../stores/data'
import TheTopbar from '../components/TheTopbar.vue'
import TheFooter from '../components/TheFooter.vue'

const imp = useImportStore()
const data = useDataStore()
const dragOver = ref(false)
const YEAR = new Date().getFullYear()

const pct = computed(() => Math.round(imp.progress * 100))

async function onFiles(files: FileList | null) {
  if (!files || !files.length) return
  await imp.run(Array.from(files), YEAR)
}
function onDrop(e: DragEvent) { dragOver.value = false; onFiles(e.dataTransfer?.files ?? null) }
function clearAll() {
  if (confirm('确定清除本机已解析的全部数据？此操作不可撤销。')) data.clear()
}

function stageClass(index: number) {
  const thresholds = [25, 50, 75, 100]
  if (pct.value >= thresholds[index]) return 'pstage done'
  if (index === 0 && pct.value > 0 && pct.value < 25) return 'pstage active'
  if (pct.value >= thresholds[index - 1] && pct.value < thresholds[index]) return 'pstage active'
  return 'pstage'
}
</script>

<template>
  <TheTopbar />

  <main class="wrap page">
    <div class="page-head">
      <span class="eyebrow">STEP 01 · 导入 / 导出</span>
      <h1>导入聊天记录，在本机解析</h1>
      <p>把从微信导出的聊天文件拖到这里。文件不会离开你的设备——解析完全在本地完成，你随时可以清除或重新导出备份。</p>
    </div>

    <div class="cols">
      <!-- LEFT: import + parsing + result -->
      <div>
        <section class="card card-pad">
          <!-- dropzone -->
          <div
            v-if="imp.status === 'idle' || imp.status === 'error'"
            class="drop"
            :class="{ drag: dragOver }"
            tabindex="0"
            role="button"
            aria-label="选择或拖入聊天记录文件"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="onDrop"
            @click="($refs.fileInput as HTMLInputElement).click()"
            @keydown.enter.prevent="($refs.fileInput as HTMLInputElement).click()"
            @keydown.space.prevent="($refs.fileInput as HTMLInputElement).click()"
          >
            <div class="ico">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M12 15.5V4M12 4 7.5 8.5M12 4l4.5 4.5M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <h3>拖入文件，或点击选择</h3>
            <div class="sub">支持微信导出的聊天记录</div>
            <div class="fmts">
              <span class="tag">.txt</span><span class="tag">.html</span><span class="tag">.csv</span><span class="tag">.bak</span>
            </div>
            <div class="or">最大约 500 MB · 多个文件可一次拖入</div>
          </div>
          <input
            ref="fileInput"
            type="file"
            class="sr-only"
            multiple
            accept=".txt,.html,.csv,.json"
            @change="onFiles(($event.target as HTMLInputElement).files)"
          />

          <!-- parsing -->
          <div v-if="imp.status === 'parsing'" class="parsing">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;">
              <strong style="font-size:14px;">正在解析…</strong>
              <span class="num muted" style="font-size:13px;">{{ pct }}%</span>
            </div>
            <div class="pbar"><i :style="{ width: pct + '%' }"></i></div>
            <div style="margin-top:14px;">
              <div :class="stageClass(0)"><span class="b"><svg v-if="pct >= 25" width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="m3 8.5 3 3 7-7.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>读取文件并校验格式</div>
              <div :class="stageClass(1)"><span class="b"><svg v-if="pct >= 50" width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="m3 8.5 3 3 7-7.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>识别联系人与备注</div>
              <div :class="stageClass(2)"><span class="b"><svg v-if="pct >= 75" width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="m3 8.5 3 3 7-7.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>统计消息量与时间线</div>
              <div :class="stageClass(3)"><span class="b"><svg v-if="pct >= 100" width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="m3 8.5 3 3 7-7.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>归类关系标签</div>
            </div>
          </div>

          <!-- result -->
          <div v-if="imp.status === 'done'">
            <div style="display:flex; align-items:center; gap:10px;">
              <span class="privacy-badge" style="background:transparent; border-color:var(--accent-line);">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="m3 8.5 3 3 7-7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                解析完成
              </span>
              <span class="muted" style="font-size:13px;">已在本地生成结构化数据</span>
            </div>
            <div class="result-stats">
              <div class="stat"><div class="k">好友 / 群</div><div class="v">{{ data.friends.length }}</div></div>
              <div class="stat"><div class="k">消息总数</div><div class="v">{{ data.report?.totalMessages }}<small>条</small></div></div>
              <div class="stat"><div class="k">时间跨度</div><div class="v">{{ data.report?.year }}<small>全年</small></div></div>
            </div>
            <div class="result-cta">
              <router-link class="btn btn-primary" to="/friends">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                查看好友信息表
              </router-link>
              <router-link class="btn" to="/report">生成年度报告</router-link>
              <button class="btn btn-ghost" type="button" @click="imp.reset()">重新导入</button>
            </div>
          </div>

          <!-- error -->
          <div v-if="imp.status === 'error'" class="error-msg" style="color:var(--danger); margin-top:12px;">
            <strong>解析失败：</strong>{{ imp.error }}
          </div>

          <!-- warnings -->
          <div v-if="imp.warnings.length" class="warnings" style="margin-top:14px;">
            <p style="font-size:13px; color:var(--muted); font-weight:600; margin-bottom:6px;">警告：</p>
            <ul style="font-size:13px; color:var(--muted); padding-left:18px;">
              <li v-for="(w, i) in imp.warnings" :key="i">{{ w }}</li>
            </ul>
          </div>
        </section>

        <!-- EXPORT panel -->
        <section class="card card-pad export" :class="{ locked: imp.status !== 'done' }" style="margin-top:24px;" :aria-disabled="imp.status !== 'done'">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div>
              <h3 style="font-size:17px;">导出备份</h3>
              <p class="muted" style="font-size:13px; margin-top:3px;">把整理后的结构化数据保存到本地，留存或迁移。</p>
            </div>
          </div>

          <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">
            <button class="btn btn-ghost" type="button" style="color:var(--danger);" @click="clearAll">清除全部本地数据</button>
          </div>
        </section>
      </div>

      <!-- RIGHT: aside guidance -->
      <aside>
        <section class="card card-pad aside-card">
          <h4>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.2v3.4M8 5.1v.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            怎么从微信导出
          </h4>
          <ol class="howto">
            <li>打开聊天，点右上角 <b>···</b> 进入聊天详情。</li>
            <li>选择 <b>「聊天记录迁移与备份」→ 迁移到电脑</b>，或在电脑端微信里<b>导出为文件</b>。</li>
            <li>把导出的 <b>.txt / .html / .bak</b> 文件拖到左边即可。</li>
          </ol>
        </section>

        <section class="card card-pad aside-card" style="background:var(--accent-wash); border-color:var(--accent-line);">
          <h4 style="color:var(--accent-strong);">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 1.5 2.5 3.8v3.4c0 3 2.3 5.8 5.5 6.8 3.2-1 5.5-3.8 5.5-6.8V3.8L8 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            本地化承诺
          </h4>
          <p style="font-size:12.5px; color:var(--accent-strong); margin-top:8px; line-height:1.6;">
            导入的文件只在你的设备内存中解析，不上传任何服务器。关闭页面后，未保存的解析结果即清除。
          </p>
        </section>
      </aside>
    </div>
  </main>

  <TheFooter />
</template>

<style scoped>
.page { padding: 36px 0 0; }
.page-head { margin-bottom: 26px; }
.page-head h1 { font-size: 28px; }
.page-head p { color: var(--muted); margin-top: 8px; max-width: 46em; }

.cols { display: grid; grid-template-columns: 1.35fr 0.85fr; gap: 24px; align-items: start; }

/* dropzone */
.drop {
  border: 1.6px dashed var(--border-2); border-radius: var(--r-lg);
  background: var(--surface); padding: 44px 28px; text-align: center;
  transition: border-color .15s, background .15s; cursor: pointer;
}
.drop:hover { border-color: var(--accent-line); background: var(--accent-wash); }
.drop.drag { border-color: var(--accent); background: var(--accent-wash); }
.drop .ico { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 16px; background: var(--accent-wash); border: 1px solid var(--accent-line); color: var(--accent-strong); display: grid; place-items: center; }
.drop h3 { font-size: 18px; }
.drop .sub { color: var(--muted); font-size: 13.5px; margin-top: 6px; }
.drop .fmts { display: inline-flex; gap: 6px; margin-top: 16px; flex-wrap: wrap; justify-content: center; }
.drop .or { margin-top: 16px; font-size: 12.5px; color: var(--faint); }

/* parsing */
.parsing { margin-top: 4px; }
.pbar { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; border: 1px solid var(--border); }
.pbar > i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 999px; transition: width .5s ease; }
.pstage { display: flex; align-items: center; gap: 10px; padding: 9px 2px; font-size: 13.5px; color: var(--faint); }
.pstage .b { width: 18px; height: 18px; border-radius: 50%; border: 1.6px solid var(--border-2); flex: none; display: grid; place-items: center; }
.pstage.active { color: var(--fg); }
.pstage.done { color: var(--accent-strong); }
.pstage.done .b { border-color: var(--accent); background: var(--accent); color: #fff; }
.pstage.active .b { border-color: var(--accent); }

/* result */
.result-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 18px 0; }
.stat { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r); padding: 14px 16px; }
.stat .k { font-size: 12px; color: var(--muted); letter-spacing: 0.01em; }
.stat .v { font-family: var(--font-mono); font-size: 26px; font-weight: 600; letter-spacing: -0.02em; margin-top: 4px; }
.stat .v small { font-size: 13px; color: var(--faint); font-family: var(--font-body); margin-left: 3px; }
.result-cta { display: flex; flex-wrap: wrap; gap: 10px; }

/* aside */
.aside-card + .aside-card { margin-top: 18px; }
.aside-card h4 { font-size: 14px; display: flex; align-items: center; gap: 8px; }
.aside-card h4 svg { color: var(--accent-strong); }
.howto { list-style: none; counter-reset: s; margin-top: 12px; }
.howto li { counter-increment: s; position: relative; padding: 0 0 13px 30px; font-size: 13px; color: var(--muted); line-height: 1.5; }
.howto li::before { content: counter(s); position: absolute; left: 0; top: 0; width: 20px; height: 20px; border-radius: 6px; background: var(--accent-wash); color: var(--accent-strong); font-family: var(--font-mono); font-size: 11px; font-weight: 600; display: grid; place-items: center; border: 1px solid var(--accent-line); }
.howto li:last-child { padding-bottom: 0; }
.howto b { color: var(--fg); font-weight: 600; }

/* export panel */
.export.locked { opacity: .55; pointer-events: none; }

@media (max-width: 880px) { .cols { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .result-stats { grid-template-columns: 1fr; } }
</style>
