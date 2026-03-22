---
title: 身份与风格
subtitle: Agent 身份档案
updateFrequency: 创建时填写，角色/模型变更时更新
---

## 用途

定义 Agent 的核心身份信息：名字、角色、所属团队、使用模型、职责描述。这是系统加载 Agent 时最先读取的文件，相当于 Agent 的"户口本"。

## 基本信息

记录 Agent 的标识信息：

- **ID**：全局唯一标识符，建议用 `team-role` 格式，如 `software-team-frontend`
- **名称**：可读名称，如 `前端开发工程师`
- **Emoji**：Agent 的专属图标，用于在列表和消息中快速识别
- **角色类型**：如 `frontend`、`backend`、`architect`、`qa`
- **所属团队**：如 `software-team`
- **模型**：该 Agent 使用的 AI 模型，如 `claude-opus-4-6`、`kimi-coding/k2p5`

## 职责描述

用简洁的中文列出该 Agent 负责的核心工作项。每条职责对应一个具体的输出物或工作领域。

例如架构师：
- 系统架构设计
- 技术选型与评审
- 接口规范制定

例如前端工程师：
- 前端开发与 UI 实现
- 与设计稿还原
- 性能优化

## 工作区路径

在文件末尾注明工作区的相对路径，方便其他 Agent 引用和跨工作区协作时定位。

## 使用建议

- ID 一旦确定不建议修改，其他 Agent 可能通过 ID 引用该 Agent
- 模型选型：复杂推理用 claude-opus-4-6，代码生成可用 kimi-coding/k2p5
- Emoji 要唯一，便于在多 Agent 并行工作时快速分辨
