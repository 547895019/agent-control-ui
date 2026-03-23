# Agent Control UI — 开发说明

## 参考资源

- 官网文档：https://docs.openclaw.ai/
- 开源仓库：https://github.com/openclaw/openclaw


## 项目结构

- `src/api/gateway.ts` — 所有 gateway RPC 和本地文件服务器调用
- `src/components/agents/` — Agent 相关组件（AgentFilesEditor、AgentChat 等）
- `src/pages/` — 页面级组件（AgentsPage、MeetingPage 等）
- `src/stores/useAppStore.ts` — Zustand 全局状态（agents、连接状态）
- `src/templates/` — Markdown 模板文件（`?raw` 导入）

## 已知约束

### Gateway RPC 文件操作限制
- `agents.files.get` / `agents.files.set` **只支持顶层文件**（如 `IDENTITY.md`）
- **不支持子目录路径**（如 `memory/2026-03-21.md` 会报 "unsupported file" 错误）
- `agents.files.list` 在当前 gateway 版本**未实现**

### memory/ 每日日志文件的正确读写方式
必须走**本地文件服务器**（`client.readFile` / `client.writeFile` / `client.listDir`），不能用 gateway RPC：

```
列出：client.listDir(`${workspace}/memory`)
读取：client.readFile(`${workspace}/memory/2026-03-21-0929.md`)
写入：client.writeFile(`${workspace}/memory/2026-03-21-0929.md`, content)
```

### Workspace 路径解析（重要）
`main` agent 的 `workspace: null`，不走 resolved config 里的 agent.workspace，需要：

1. 先查 `resolved.agents.list[agentId].workspace`
2. 若为 null，查 `config.agents.defaults.workspace`（值为 `~/.openclaw/workspace`）
3. **`~` 必须展开为绝对路径**，否则 `listDir` 静默返回空数组（路径无效）

展开方法：从其他 agent 的绝对路径推导 home dir：
```typescript
const homeDir = list
  .map((a: any) => a.workspace as string)
  .filter((w: string) => w && w.startsWith('/') && w.includes('/.openclaw/'))
  .map((w: string) => w.split('/.openclaw/')[0])
  .find(Boolean);
if (ws.startsWith('~') && homeDir) ws = homeDir + ws.slice(1);
```

### listDir 行为注意
- `listDir` **不抛异常**，HTTP 错误时静默返回 `[]`
- 传入 `~` 路径时，`dir` 参数可能不被服务器展开（`path` 参数会展开）
- 必须传绝对路径才能保证正确返回文件列表

### 生产环境 localfile-server 端口（重要）
- 生产端口：**19876**，开发端口：**19877**（避免与生产冲突）
- `vite.config.ts` 中 `LOCALFILE_PORT` fallback 必须是 `'19876'`，否则构建产物会硬编码开发端口导致生产环境所有本地文件请求失败
- `server.mjs` 必须在启动时 spawn `localfile-server.mjs`（生产环境不会自动启动）

### memory 文件命名格式
实际文件名为 `YYYY-MM-DD.md` 或 `YYYY-MM-DD-suffix.md`（有后缀变体），不能硬编码纯日期名。
侧边栏应通过 `listDir` 获取真实文件名，再按日期前缀（`startsWith(YYYY-MM-DD)`）筛选今日/昨日。

## 自动提交

修改完成并通过测试后，**自动提交到 GitHub 仓库**，无需等待用户确认。

**提交流程：**

1. 修改代码并验证通过（`npm run build` 成功）
2. 自动执行提交：

```bash
git add <修改的文件>
git commit -m "<简洁描述>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin main
```

**提交信息规范：**
- 简短描述修改内容（如：`fix: OrgPage 刷新时保持生成状态`）
- 包含 `Co-Authored-By` 标记

**例外情况（不自动提交）：**
- 用户明确说"不要提交"或"稍后一起提交"
- 发布版本（走 `release.sh` 流程）
- 修改涉及敏感配置或密钥文件

## 发布流程

使用项目根目录的 `release.sh` 脚本发布，**不要手动构建打包**。

**发布前必须得到用户明确确认**，不能自动执行。流程如下：

1. 告知用户即将发布的版本号（按当天日期生成，格式 `YYYY.M.D`，若已存在则追加 `-1`、`-2`...）
2. **等待用户确认后**，再运行：

```bash
./release.sh
```

脚本自动完成：
1. 按当天日期生成版本号，若 tag 已存在则追加 `-1`、`-2`...
2. 更新 `package.json` 版本号
3. `npm run build` 构建
4. 打包 tgz（含 `bin/`、`dist/`、`server.mjs` 等，`package/` 目录结构）
5. git commit + push
6. 创建 GitHub Release 并上传 tgz

## 记忆规则

发现以下情况时，**无需用户提醒，主动更新本文件的"已知约束"章节**：
- 发现 API / RPC 的限制或未实现的功能
- 踩坑（路径问题、静默失败、行为与预期不符等）
- 解决复杂 bug 后总结的根本原因和正确做法

## 代码规范

- Vite `?raw` 导入用于 Markdown 模板
- 中文名称通过 `FILE_GUIDES[name]?.title` 映射到侧边栏
- 每日日志组件：`AgentFilesEditor.tsx`，核心文件用 gateway，memory 用本地文件服务器
