# AI 反代（后端 B）

放到公司**已备案** HTTPS 域名后面（如 nginx 反代到本进程），把该域名加入小程序后台
「开发 → 开发设置 → 服务器域名 → request 合法域名」。

## 运行
GACCODE_BASE_URL=... GACCODE_API_KEY=... GACCODE_MODEL=claude-opus-4-8 node proxy.mjs

## 前端切到后端 B
在 miniapp 构建期设 VITE_AI_BACKEND=proxy，并通过 vite define 注入 __AI_PROXY_URL__ 为你的 HTTPS 接口地址。

## 注意
- 必须 HTTPS（小程序只允许 https 的 request 合法域名）。
- 加基本限流（按来源/频率），保护 gaccode Key 与额度。
- 不要记录 prompt 正文日志（含聊天样本）。
