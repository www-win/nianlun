<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useChatQaStore } from '../../stores/chatQa'
import ProgressBar from '../../components/ProgressBar.vue'

const store = useChatQaStore()
const draft = ref('')
const scrollTop = ref(0)

const EXAMPLES = ['我今年跟谁聊得最多？', '我的聊天风格是什么样的？', '谁最近约我吃饭？']

async function send() {
  const q = draft.value.trim()
  if (!q || store.loading) return
  draft.value = ''
  await store.ask(q)
  await nextTick()
  scrollTop.value += 100000      // 触发滚到底
}
function useExample(q: string) { draft.value = q }
</script>

<template>
  <view class="page">
    <scroll-view class="feed" scroll-y :scroll-top="scrollTop" scroll-with-animation>
      <view v-if="store.messages.length === 0" class="intro">
        <view class="intro-icon">💬</view>
        <text class="intro-t">问问你的微信聊天记录</text>
        <text class="intro-s">具体的事、聊天规律、关系，都能问。答不出会直说，不瞎编。</text>
        <view class="examples">
          <text v-for="q in EXAMPLES" :key="q" class="ex" @click="useExample(q)">{{ q }}</text>
        </view>
      </view>

      <view
        v-for="(m, i) in store.messages" :key="i"
        :class="['bubble-row', m.role === 'user' ? 'me' : 'ai']"
      >
        <text class="bubble">{{ m.text }}</text>
      </view>

      <view v-if="store.loading" class="bubble-row ai">
        <view class="bubble typing">
          <text>思考中…</text>
          <ProgressBar indeterminate />
        </view>
      </view>
    </scroll-view>

    <view class="composer">
      <input
        class="input" v-model="draft" placeholder="问点什么…"
        confirm-type="send" @confirm="send"
      />
      <view :class="['send', (!draft.trim() || store.loading) && 'disabled']" @click="send">发送</view>
    </view>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; background: var(--bg); }
.feed { flex: 1; padding: 24rpx 24rpx 12rpx; box-sizing: border-box; }
.intro { padding: 80rpx 40rpx; text-align: center; }
.intro-icon { font-size: 72rpx; }
.intro-t { display: block; margin-top: 16rpx; font-size: 32rpx; font-weight: 700; color: var(--fg); }
.intro-s { display: block; margin-top: 12rpx; font-size: 24rpx; color: var(--muted); line-height: 1.6; }
.examples { margin-top: 32rpx; display: flex; flex-direction: column; gap: 16rpx; }
.ex { padding: 18rpx 24rpx; font-size: 26rpx; color: var(--accent); background: var(--surface); border: 1rpx solid var(--border); border-radius: 16rpx; }
.bubble-row { display: flex; margin: 14rpx 0; }
.bubble-row.me { justify-content: flex-end; }
.bubble-row.ai { justify-content: flex-start; }
.bubble { max-width: 78%; padding: 18rpx 24rpx; font-size: 27rpx; line-height: 1.6; border-radius: 20rpx; white-space: pre-wrap; word-break: break-word; }
.me .bubble { background: var(--accent); color: #fff; border-bottom-right-radius: 6rpx; }
.ai .bubble { background: var(--surface); color: var(--fg); border: 1rpx solid var(--border); border-bottom-left-radius: 6rpx; }
.typing { color: var(--muted); }
.typing :deep(.pbar-wrap) { margin-top: 12rpx; width: 120rpx; }
.composer { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1rpx solid var(--border); }
.input { flex: 1; height: 72rpx; padding: 0 24rpx; font-size: 27rpx; color: var(--fg); background: var(--bg); border: 1rpx solid var(--border-2); border-radius: 999rpx; }
.send { padding: 0 32rpx; height: 72rpx; display: flex; align-items: center; border-radius: 999rpx; background: var(--accent); color: #fff; font-size: 27rpx; font-weight: 600; }
.send.disabled { opacity: 0.45; }
</style>
