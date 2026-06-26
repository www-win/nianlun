import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AiPanel from '../AiPanel.vue'
import { useSettingsStore } from '../../stores/settings'

vi.mock('../../adapters/aiClient', () => ({
  generateText: vi.fn(async () => '生成的文案结果。'),
}))
import { generateText } from '../../adapters/aiClient'

const baseProps = {
  buildPrompt: () => '测试提示词',
  buttonLabel: '✨ 生成',
  busyLabel: '生成中…',
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
})

describe('AiPanel', () => {
  it('未配置时按钮禁用', () => {
    const w = mount(AiPanel, { props: baseProps })
    expect(w.find('[data-test="gen"]').attributes('disabled')).toBeDefined()
  })

  it('显示隐私提示与按钮文案', () => {
    const w = mount(AiPanel, { props: baseProps })
    expect(w.text()).toContain('相关统计数据会发送至 AI 服务进行处理')
    expect(w.find('[data-test="gen"]').text()).toContain('✨ 生成')
  })

  it('配置后点击，调用 buildPrompt 与 generateText 并显示结果', async () => {
    useSettingsStore().update({ baseUrl: 'https://x', apiKey: 'k', model: 'claude-opus-4-8' })
    const buildPrompt = vi.fn(() => '我的提示词')
    const w = mount(AiPanel, { props: { ...baseProps, buildPrompt } })
    await w.find('[data-test="gen"]').trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(buildPrompt).toHaveBeenCalled()
    expect(generateText).toHaveBeenCalledOnce()
    expect(generateText).toHaveBeenCalledWith('我的提示词', expect.anything())
    expect(w.find('[data-test="result"]').text()).toContain('生成的文案结果')
  })
})
