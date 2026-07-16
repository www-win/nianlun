import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // cloudfunctions/ 下的 *.test.mjs 用 Node 内置 node:test 运行（node --test），不归 vitest 管；
    // 若被 vitest 扫到，会因不认 node:test 的 test() 报「No test suite found」失败。故显式排除。
    exclude: [...configDefaults.exclude, '**/cloudfunctions/**'],
  },
})
