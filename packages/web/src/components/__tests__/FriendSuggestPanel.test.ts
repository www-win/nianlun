import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FriendSuggestPanel from '../FriendSuggestPanel.vue'
import { useSettingsStore } from '../../stores/settings'
import type { Friend } from '@nianlun/core'

vi.mock('../../adapters/aiClient', () => ({
  generateText: vi.fn(async () => '{"rel":"同事","role":"产品经理","reason":"经常聊需求排期"}'),
}))
import { generateText } from '../../adapters/aiClient'

const friend: Friend = {
  id: 'f1', name: '阿强', alias: '', rel: '其他', role: '',
  firstContact: 0, lastContact: 0, msgCount: 100, sentRatio: 50,
  peakPeriod: '', maxStreak: 0, monthly: new Array(12).fill(0),
  hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0), keywords: [],
  userEdited: {},
}

function configure() {
  useSettingsStore().update({ baseUrl: 'https://x', apiKey: 'k', model: 'claude-opus-4-8' })
}

const samples = ['对方：这个需求什么时候上线', '我：下周吧']

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
})

describe('FriendSuggestPanel', () => {
  it('无样本时按钮禁用并提示重新导入', () => {
    configure()
    const w = mount(FriendSuggestPanel, { props: { friend, samples: [] } })
    expect(w.find('[data-test="suggest"]').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('请重新导入聊天记录')
  })

  it('显示强隐私提示（会发送聊天内容）', () => {
    configure()
    const w = mount(FriendSuggestPanel, { props: { friend, samples } })
    expect(w.text()).toContain('部分聊天内容发送至 AI 服务')
  })

  it('点击后调用 generateText 并展示建议关系/职务/理由', async () => {
    configure()
    const w = mount(FriendSuggestPanel, { props: { friend, samples } })
    await w.find('[data-test="suggest"]').trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(generateText).toHaveBeenCalledOnce()
    const text = w.text()
    expect(text).toContain('同事')
    expect(text).toContain('产品经理')
    expect(text).toContain('经常聊需求排期')
  })

  it('点采纳 emit apply，仅含可识别字段', async () => {
    configure()
    const w = mount(FriendSuggestPanel, { props: { friend, samples } })
    await w.find('[data-test="suggest"]').trigger('click')
    await new Promise((r) => setTimeout(r))
    await w.find('[data-test="apply"]').trigger('click')
    const emitted = w.emitted('apply')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual({ rel: '同事', role: '产品经理' })
  })

  it('AI 返回无法识别时显示错误提示', async () => {
    configure()
    ;(generateText as any).mockResolvedValueOnce('这不是 JSON')
    const w = mount(FriendSuggestPanel, { props: { friend, samples } })
    await w.find('[data-test="suggest"]').trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(w.text()).toContain('AI 返回格式无法识别')
  })
})
