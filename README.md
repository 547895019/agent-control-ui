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
# 全局安装（从 GitHub Release 安装预构建包）
sudo npm install -g https://github.com/547895019/agent-control-ui/releases/latest/download/agent-control-ui.tgz

# 注册系统服务并启动（需要 sudo）
openclaw-ui install
```

访问 `http://服务器IP:8080`，自定义端口：`PORT=3000 openclaw-ui install`

**更新版本：**
```bash
# 方式一：页面左下角点 ↑ 按钮一键更新
# 方式二：手动更新
sudo npm install -g https://github.com/547895019/agent-control-ui/releases/latest/download/agent-control-ui.tgz
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

## 发布新版本

### 完整流程

```bash
# 1. 升版本号（patch / minor / major）
npm version patch --no-git-tag-version

# 2. 构建生产包
npm run build

# 3. 提交代码（包含 dist/）
git add src/ dist/ package.json package-lock.json
# 如有改动其他文件一并加入
git commit -m "feat/fix: 描述本次变更 (vX.Y.Z)"

# 4. 打 tag 并推送
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z

# 5. 打包
npm pack
mv agent-control-ui-X.Y.Z.tgz agent-control-ui.tgz

# 6. 创建 GitHub Release 并上传
gh release create vX.Y.Z agent-control-ui.tgz \
  --repo 547895019/agent-control-ui \
  --title "vX.Y.Z" \
  --notes "变更说明"

# 7. 清理
rm agent-control-ui.tgz
```

> **注意**：`npm pack` 会自动执行 `prepublishOnly: npm run build` 再次构建，确保 tarball 里的 dist 始终是最新的。

### 关键约定

- tarball 文件名必须是固定的 `agent-control-ui.tgz`（不带版本号），UI 的一键更新依赖此 URL 不变
- `dist/` 必须随源码一起提交到 git，生产服务直接 serve 已构建的 dist
- 版本号格式 `YYYY.M.D`，同一天多次发布用 patch 递增（如 `2026.3.20` → `2026.3.21`）

### 常见问题

**更新后服务仍显示旧版本**

检查 systemd 服务指向的路径是否与 npm 全局安装路径一致：

```bash
sudo systemctl cat openclaw-ui | grep ExecStart
which openclaw-ui
```

若两者不一致（如 systemd 指向 `/home/user/agent-control-ui/` 而 npm 安装到 `/usr/lib/node_modules/`），重新注册服务：

```bash
sudo systemctl stop openclaw-ui
sudo openclaw-ui install
```

**浏览器显示旧界面**

从旧版本（v2026.3.21 之前）升级时，浏览器可能缓存了旧的 `index.html`。
强制刷新一次：`Ctrl + Shift + R`（Windows/Linux）或 `Cmd + Shift + R`（macOS）。
v2026.3.22 起服务端已对 HTML 设置 `Cache-Control: no-store`，后续更新无需此操作。

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
