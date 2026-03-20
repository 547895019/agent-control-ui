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

## 快速安装（推荐）

```bash
# 全局安装（直接从 GitHub 仓库安装，无需 npm registry）
sudo npm install -g github:547895019/agent-control-ui

# 注册系统服务并启动（需要 sudo）
openclaw-ui install
```

访问 `http://服务器IP:8080`，自定义端口：`PORT=3000 openclaw-ui install`

**更新版本：**
```bash
sudo npm install -g github:547895019/agent-control-ui
sudo systemctl restart openclaw-ui
```

---

## 从源码安装

适合需要二次开发的场景。

```bash
# 1. 克隆仓库
git clone https://github.com/547895019/agent-control-ui.git
cd agent-control-ui

# 2. 安装依赖
npm install

# 3. 构建生产包
npm run build

# 4. 注册系统服务并启动（需要 sudo）
node bin/cli.mjs install
```

访问 `http://服务器IP:8080`，在登录页输入后端地址和 Token。

**自定义端口：**
```bash
PORT=3000 node bin/cli.mjs install
```

**从源码更新版本：**
```bash
git pull
npm install
npm run build
sudo systemctl restart openclaw-ui
```

**常用管理命令：**
```bash
sudo systemctl status  openclaw-ui
sudo systemctl stop    openclaw-ui
sudo systemctl restart openclaw-ui
sudo journalctl -u openclaw-ui -f   # 查看日志
```

---

## 开发模式

```bash
npm install
npm run dev
```

启动后访问 `http://localhost:5173`，在登录页输入后端地址和 Token。

> `npm run dev` 会同时启动 Vite 开发服务器和本地文件辅助服务（端口 `19876`）。

---

## 部署

### Docker（一行启动）

```bash
git clone https://github.com/547895019/agent-control-ui.git
cd agent-control-ui
docker compose up -d
```

访问 `http://localhost:8080`，修改 `docker-compose.yml` 中的端口映射可自定义端口。

```bash
docker compose down      # 停止
docker compose logs -f   # 查看日志
```

**更新：**
```bash
git pull
docker compose up -d --build
```

---

### 静态托管（Nginx / Caddy）

```bash
npm install && npm run build
# 将 dist/ 目录部署到 Web 服务器
```

Nginx 配置示例：

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

---

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
