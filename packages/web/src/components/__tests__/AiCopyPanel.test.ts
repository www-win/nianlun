import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ReportData, Friend } from '@nianlun/core'
import AiCopyPanel from '../AiCopyPanel.vue'
import { useSettingsStore } from '../../stores/settings'

vi.mock('../../adapters/aiClient', () => ({
  generateText: vi.fn(async () => '这是一段 AI 生成的年度文案。'),
}))
import { generateText } from '../../adapters/aiClient'

const report: ReportData = {
  year: 2024, totalMessages: 1200, friendCount: 30, activeDays: 200,
  topContacts: [{ friendId: 'a', msgCount: 500 }],
  latestMessage: null, keywords: [], relationBreakdown: [{ rel: '挚友', percent: 60 }],
}
const friends: Friend[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
})

describe('AiCopyPanel', () => {
  it('未配置时生成按钮禁用', () => {
    const w = mount(AiCopyPanel, { props: { report, friends } })
    expect(w.find('[data-test="gen"]').attributes('disabled')).toBeDefined()
  })

  it('显示隐私提示', () => {
    const w = mount(AiCopyPanel, { props: { report, friends } })
    expect(w.text()).toContain('相关统计数据会发送至 AI 服务进行处理')
  })

  it('配置后点击生成，显示结果并调用 generateText', async () => {
    useSettingsStore().update({ baseUrl: 'https://x', apiKey: 'k', model: 'claude-opus-4-8' })
    const w = mount(AiCopyPanel, { props: { report, friends } })
    await w.find('[data-test="gen"]').trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(generateText).toHaveBeenCalledOnce()
    expect(w.find('[data-test="result"]').text()).toContain('AI 生成的年度文案')
  })
})
