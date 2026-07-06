import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  // lunar-javascript 是 core 唯一运行时依赖；打进 dist，让 miniapp 只依赖 @nianlun/core，
  // 无需单独安装 lunar（小程序端依赖解析更简单）。
  noExternal: ['lunar-javascript'],
})
