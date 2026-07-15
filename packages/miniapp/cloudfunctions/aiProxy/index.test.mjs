// 用 Node 内置 node:test 运行，无需任何依赖/框架：
//   node --test packages/miniapp/cloudfunctions/aiProxy/index.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isTransientError, isTransientStatus, backoffMs, _budget, parseSseText, attemptTimeout } = require('./index.js')

// 构造一段 event: X\ndata: {json} 的 SSE 事件块
const sse = (events) =>
  events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}`).join('\n\n') + '\n\n'

test('ECONNRESET 等瞬时网络错误判为可重试', () => {
  assert.equal(isTransientError({ code: 'ECONNRESET' }), true)
  assert.equal(isTransientError({ code: 'ETIMEDOUT' }), true)
  assert.equal(isTransientError({ code: 'ECONNREFUSED' }), true)
  assert.equal(isTransientError({ code: 'EPIPE' }), true)
  assert.equal(isTransientError({ code: 'EAI_AGAIN' }), true)
  assert.equal(isTransientError(new Error('socket hang up')), true)
  assert.equal(isTransientError(new Error('AI 请求 58000ms 内无响应')), true)
})

test('确定性错误不重试', () => {
  assert.equal(isTransientError({ code: 'ERR_INVALID_ARG' }), false)
  assert.equal(isTransientError(new Error('AI 返回非 JSON')), false)
})

test('限流与 5xx 判为瞬时状态，4xx（除 429）不是', () => {
  for (const s of [429, 500, 502, 503, 504]) assert.equal(isTransientStatus(s), true)
  for (const s of [200, 400, 401, 403, 404, 505]) assert.equal(isTransientStatus(s), false)
})

test('退避指数增长且封顶 4s', () => {
  assert.equal(backoffMs(1), 500)
  assert.equal(backoffMs(2), 1000)
  assert.equal(backoffMs(3), 2000)
  assert.equal(backoffMs(4), 4000)
  assert.equal(backoffMs(5), 4000)
  assert.equal(backoffMs(10), 4000)
})

test('快速 ECONNRESET 场景：一次失败后仍在预算内，应继续重试', () => {
  // 复现日志：首次 ~1.5s 就 ECONNRESET，剩余预算 ~56.5s。
  const { TOTAL_BUDGET, MIN_RETRY_BUDGET } = _budget
  const spent = 1500
  const attempt = 1
  const remainingNow = TOTAL_BUDGET - spent
  const wait = backoffMs(attempt)
  // 旧版部署在这里放弃了（剩 55s 却停手）；新逻辑必须判定为「可继续重试」。
  assert.ok(remainingNow - wait >= MIN_RETRY_BUDGET, '快速失败后应继续重试而非放弃')
})

test('预算将尽场景：剩余不足以再跑一次真实请求，应停止重试', () => {
  const { TOTAL_BUDGET, MIN_RETRY_BUDGET } = _budget
  const spent = TOTAL_BUDGET - 3000 // 只剩 3s
  const remainingNow = TOTAL_BUDGET - spent
  const wait = backoffMs(3)
  assert.ok(remainingNow - wait < MIN_RETRY_BUDGET, '预算将尽时应停止重试')
})

test('attemptTimeout 把单次空闲超时压到 PER_ATTEMPT 上限，避免一根挂死连接独吞整个预算', () => {
  const { PER_ATTEMPT } = _budget
  // 预算充足时（如首次剩 58s），单次超时被压到 PER_ATTEMPT，而不是等满 58s
  assert.equal(attemptTimeout(58000), PER_ATTEMPT)
  assert.equal(attemptTimeout(45000), PER_ATTEMPT)
  // 预算将尽时（剩余 < 上限），用剩余，别设一个比预算还大的超时
  assert.equal(attemptTimeout(12000), 12000)
  assert.equal(attemptTimeout(PER_ATTEMPT), PER_ATTEMPT)
})

test('挂死连接被 PER_ATTEMPT 掐断后，剩余预算仍够再重试', () => {
  const { TOTAL_BUDGET, MIN_RETRY_BUDGET, PER_ATTEMPT } = _budget
  // 复现本次日志：前段 ~10s 花在 4 次秒断+退避，第 5 次挂住。
  // 若单次超时被压到 PER_ATTEMPT，挂死请求 PER_ATTEMPT 后就失败，此时仍应剩得下一次重试。
  const spentBeforeHang = 10000
  const remaining = TOTAL_BUDGET - spentBeforeHang
  const afterHang = remaining - attemptTimeout(remaining) // 掐断后剩余
  const wait = backoffMs(5)
  assert.ok(afterHang - wait >= MIN_RETRY_BUDGET, '挂死被掐断后应还够再试一次，而非白白吃光预算')
  assert.ok(PER_ATTEMPT < remaining, '本场景单次超时确实被上限压低了')
})

test('parseSseText 拼接 text_delta 并忽略非文本事件', () => {
  const body = sse([
    { type: 'message_start', message: { id: 'm1' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'ping' },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '世界' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ])
  const { text, error } = parseSseText(body)
  assert.equal(text, '你好世界')
  assert.equal(error, null)
})

test('parseSseText 捕获流内 error 事件（如 overloaded）', () => {
  const body = sse([
    { type: 'message_start', message: { id: 'm1' } },
    { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
  ])
  const { text, error } = parseSseText(body)
  assert.equal(text, '')
  assert.match(error, /overloaded/i)
})

test('parseSseText 无文本增量时返回空串', () => {
  const body = sse([
    { type: 'message_start', message: { id: 'm1' } },
    { type: 'message_stop' },
  ])
  const { text, error } = parseSseText(body)
  assert.equal(text, '')
  assert.equal(error, null)
})

test('parseSseText 忽略 [DONE] 哨兵行（部分代理会补发）', () => {
  const body =
    sse([{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }]) +
    'data: [DONE]\n\n'
  const { text, error } = parseSseText(body)
  assert.equal(text, 'ok')
  assert.equal(error, null)
})
