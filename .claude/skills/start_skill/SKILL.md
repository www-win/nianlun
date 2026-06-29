---
name: start_skill
description: 启动并运行「年轮 Nianlun」本项目（Vue3 + pnpm monorepo）。当用户说"启动项目/启动年轮/跑起来/运行项目/start the app/run the project/开发服务器/dev server/打开网站看看"等任何想在本机把这个项目跑起来、在浏览器里看效果的意图时，都要用这个 skill —— 即使用户没明确说"dev server"也要触发。它会以正确方式拉起 Vite 开发服务器、处理端口被占用、并做冒烟检查给出可点击的本地地址。
---

# 启动「年轮 Nianlun」项目

「年轮」是一个 **pnpm workspace monorepo**（`packages/core` 纯 TS 库 + `packages/web` Vue3 应用）。
运行的"项目"就是 web 应用，本机开发用 **Vite 开发服务器**拉起。务必用 **pnpm**（不要 npm/yarn）。

## 默认做法：拉起开发服务器（用户说"启动项目"基本都是这个）

按顺序执行，不要只发命令就完事 —— 要拉起来 + 拿到地址 + 冒烟确认，这样用户能直接点开看到东西。

1. **后台启动 dev 服务器**（必须后台运行，否则会一直占用前台）：

   ```bash
   pnpm --filter @nianlun/web dev
   ```

   用后台方式运行（Bash 工具的 `run_in_background: true`）。它是常驻进程，不会自己退出。

2. **等它打印出本地地址再继续**。Vite 就绪后会输出形如：

   ```
   ➜  Local:   http://localhost:5173/
   ```

   **端口会变**：5173 被占用时会自动顺延到 5174、5175…… 一定要从实际输出里读到真正的端口，别想当然写 5173。轮询启动日志直到出现 `Local:` 行。

3. **冒烟检查**，确认真的起来了（把 `<PORT>` 换成上一步读到的端口）：

   ```bash
   curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:<PORT>/
   ```

   期望 `HTTP 200`。想再确认是对的页面，可看标题应为 `年轮 Nianlun`：

   ```bash
   curl -s http://localhost:<PORT>/ | grep -o "<title>[^<]*</title>"
   ```

4. **把可点击的地址给用户**：`http://localhost:<PORT>/`（用实际端口）。

### 如果 web 启动时报找不到 `@nianlun/core`

web 依赖 core 的构建产物（`packages/core/dist`）。首次克隆或改过 core 后，先构建 core 再启动：

```bash
pnpm --filter @nianlun/core build
```

然后回到第 1 步。

## 停止 / 重启

- **停止**：结束那个后台 dev 任务即可（关掉对应的后台进程）。
- **重启的常见原因**：改动了 `packages/core`（dev 服务器对 core 的 dist 改动不一定热更新）。这时先 `pnpm --filter @nianlun/core build`，停掉旧 dev 任务，再重新执行"默认做法"。注意重启后端口可能换号（如 5173→5175），且 **IndexedDB 按 origin(含端口) 隔离**，换端口意味着之前导入的数据看不到，需重新导入。

## 注意事项

- **只用 pnpm**。命令统一加 `--filter @nianlun/web` / `--filter @nianlun/core`。
- **AI 功能需要 `.env`**：`packages/web/.env` 里的 `VITE_AI_BASE_URL` / `VITE_AI_API_KEY` 决定 AI 文案/分析/建议是否可用（dev 下 Vite 自动加载）。缺这些不影响导入与报告（纯本地），只影响 AI 相关按钮。
- **数据在浏览器本地**：导入的好友/报告存在 IndexedDB，仅在本机、按 origin 隔离。

## 其他运行方式（按需，不是"启动项目"的默认）

- **预览生产构建**（更接近线上、但无热更新）：
  ```bash
  pnpm --filter @nianlun/core build && pnpm --filter @nianlun/web build && pnpm --filter @nianlun/web preview
  ```
- **打成可双击的交付包**（发给别人、对方双击即用，不是本机调试）：
  `pnpm --filter @nianlun/web pack:win`（Windows）或 `pack:mac`（Mac）。详见根 `CLAUDE.md` 的"本地交付打包"。
