# OpenClaw Agent Control UI

OpenClaw 的 Web 控制面板，用于管理 Agent、组织、定时任务、频道、会议等功能。

## 功能

- Agent 管理（创建、编辑、删除、聊天、文件、技能、历史）
- 多 Agent 会议（发起人协调子代理并汇总结论）
- 组织与团队管理
- 定时任务（Cron）
- 实时日志监控
- 频道配置（WhatsApp、Telegram、Discord 等）
- 自动化流程
- 用量统计

## 前置条件

- Node.js >= 18
- OpenClaw 后端服务已运行（默认端口 `18789`）

## 安装

```bash
npm install
```

## 开发模式

```bash
npm run dev
```

启动后访问 `http://localhost:5173`，在登录页输入后端地址和 Token。

> `npm run dev` 会同时启动 Vite 开发服务器和本地文件辅助服务（端口 `19876`）。

## 构建生产包

```bash
npm run build
```

产物输出到 `dist/` 目录（纯静态文件）。

## 部署

### 静态托管（推荐）

```bash
npm run build
# 将 dist/ 部署到 Nginx / Caddy / 任意静态服务器
```

Nginx 配置示例（需支持前端路由）：

```nginx
server {
    listen 80;
    root /path/to/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 本地预览构建结果

```bash
npm run build && npm run preview
```

访问 `http://localhost:4173`。

## 代理说明

开发模式下 Vite 自动代理：

| 路径 | 目标 |
|------|------|
| `/api/*` | `http://127.0.0.1:18789`（OpenClaw 主服务） |
| `/localfile/*` | `http://127.0.0.1:19876`（本地文件辅助服务） |

生产部署时需在 Web 服务器配置对应反向代理，或在登录页直接填写后端完整地址。

## 技术栈

- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4
- Zustand
- React Router 7
- Monaco Editor
