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
# 全局安装
sudo npm install -g agent-control-ui

# 注册系统服务并启动（需要 sudo）
openclaw-ui install
```

访问 `http://服务器IP:8080`，自定义端口：`PORT=3000 openclaw-ui install`

**更新版本：**
```bash
openclaw-ui update
# 或在页面左下角点 ↑ 按钮
```

---

## 从源码安装

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

### 方式一：一键安装（Linux，自动注册 systemd 服务）

```bash
git clone https://github.com/547895019/agent-control-ui.git
cd agent-control-ui
chmod +x install.sh
./install.sh
```

安装完成后服务自动启动，开机自动运行。

```bash
# 默认端口 8080，可自定义：
PORT=3000 ./install.sh

# 常用管理命令：
sudo systemctl status  openclaw-ui
sudo systemctl stop    openclaw-ui
sudo systemctl restart openclaw-ui
sudo journalctl -u openclaw-ui -f   # 查看日志
```

> 非 systemd 环境（macOS / Docker 内）会自动生成 `start.sh` / `stop.sh` 替代。

---

### 方式二：Docker（一行启动）

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

---

### 方式三：手动构建 + 静态托管

```bash
npm install && npm run build
# 将 dist/ 目录部署到 Nginx / Caddy 等
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

### 本地预览

```bash
npm run build && npm run preview
```

访问 `http://localhost:4173`。

## 版本更新

### systemd 方式

```bash
chmod +x update.sh
./update.sh
```

拉取最新代码 → 重新构建 → 自动重启服务，一步完成。

### Docker 方式

```bash
git pull
docker compose up -d --build
```

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
