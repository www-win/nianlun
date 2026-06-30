// Ensure uni-app always reads source from src/ regardless of CWD or manual env overrides.
// Must be set before importing @dcloudio/vite-plugin-uni so the plugin picks it up.
process.env['UNI_INPUT_DIR'] ??= 'src'

import { defineConfig } from 'vite'
import uniModule from '@dcloudio/vite-plugin-uni'

// @dcloudio/vite-plugin-uni is CJS; its real export lives on .default in ESM context
const uni = (uniModule as any).default ?? uniModule

export default defineConfig({
  plugins: [uni()],
})
