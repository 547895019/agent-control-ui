请为以下组织创建完整的目录结构和配置文件。

## 组织信息
- **名称**：{{orgName}}{{orgDescriptionLine}}
- **目标根目录**：{{orgDir}}

---

## 需要创建的文件

### 1. `{{orgDir}}/organization.json`
组织结构，格式严格如下（member.agentId 必须与 openclaw.json 中的 agent id 完全一致）：
```json
{
  "company": {
    "id": "{{orgId}}",
    "name": "{{orgName}}",
    "description": "{{orgDescription}}",
    "leadAgentId": "{{orgId}}-lead"
  },
  "teams": [
    {
      "id": "<team-id>",
      "name": "<团队名称>",
      "description": "<职责描述>",
      "color": "#6366f1",
      "members": [
        { "agentId": "{{orgId}}-<team-id>-<role-name>", "name": "<显示名>", "role": "<职位>" }
      ]
    }
  ]
}
```

### 2. `{{orgDir}}/openclaw.json`
OpenClaw 网关配置，**agent 对象字段有严格限制**，只能包含以下字段，不得添加其他字段（特别是 enabled、description 均不合法）：
```json
{
  "agents": {
    "list": [
      {
        "id": "{{orgId}}-lead",
        "name": "<组织负责人名称>",
        "workspace": "{{orgDir}}",
        "model": "kimi-coding/k2p5",
        "subagents": { "allowAgents": ["*"] },
        "tools": { "profile": "full" }
      },
      {
        "id": "{{orgId}}-<team-id>-<role-name>",
        "name": "<Agent 显示名称>",
        "workspace": "{{orgDir}}/<team-id>/<role-name>",
        "model": "kimi-coding/k2p5",
        "subagents": { "allowAgents": ["*"] },
        "tools": { "profile": "full" }
      }
    ]
  }
}
```
**合法字段一览**：id（必填）、name（必填）、workspace（必填）、model（字符串或 {primary, fallbacks[]}）、subagents、tools、runtime。其余字段一律不写。

**⚠️ Agent ID 命名规则（重要）**：所有 agent 的 id 必须以组织前缀 `{{orgId}}-` 开头，格式为 `{{orgId}}-<team-id>-<role-name>`，确保跨组织全局唯一，避免与其他组织的 agent 冲突。

### 3. 每个 Agent 的 workspace 目录
目录规则：`{{orgDir}}/<team-id>/<role-name>/`
在每个 workspace 目录下创建：
- **IDENTITY.md**：Agent 身份、职责、行为准则
- **AGENTS.md**：与其他 Agent 的协作规则

### 4. `{{orgDir}}/knowledge/README.md`
组织知识库首页，简要说明组织信息和目录结构。

### 5. `{{orgDir}}/<team-id>/knowledge/README.md`
团队知识库首页，简要说明团队信息和目录结构。
---

## 执行要求
1. 根据组织描述合理规划团队（teams）和每个团队内的角色（agents）
2. **organization.json 中 member.agentId 必须与 openclaw.json 中对应 agent 的 id 完全一致**
3. **openclaw.json 中 agent.workspace 路径必须与实际创建的目录路径一致**
4. 使用 Write 工具逐一创建所有文件
5. 所有文件创建完成后，输出完整的文件清单和 openclaw.json agent 列表供用户确认
