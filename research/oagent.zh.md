# OAgent 研究笔记

[English](oagent.md) | 中文

## 来源

- 官方仓库：[OPPO-PersonalAI/OAgents](https://github.com/OPPO-PersonalAI/OAgents)，revision `027f2c4579ee7e7767bfe54c66df48a902d43e98`，Apache-2.0。
- 检查文件：`OAgents/src/oagents/agents.py`、GAIA TTS runner 和根 README。
- 论文：[OAgents](https://arxiv.org/abs/2506.15741)和[相关 test-time scaling 工作](https://arxiv.org/abs/2506.12928)。

## 定义行为

固定 OAgent 使用异构冗余和 LLM critic。默认 ensemble 包含一个 Plan-and-Execute worker 和两个 ReAct worker。每个专家使用全新 full history 和完整任务工具目录。Final critic 接收每个答案和最多五条有界工具 observation，评估任务符合度、证据、逻辑和具体性，选择一个命名专家，并可综合更强答案。Critic 输出无效时回退到第一个专家。

## DSH 实现

一个模型可见 composite tool 运行完整 ensemble 并结束 coordinator turn。它通过 `spawn` provider 顺序启动三个新 DSH 子 Agent，为每个子任务分配独立 persona 和 Session，并禁止递归调用 ensemble tool。子任务继承 coordinator 的 provider 和 model。

共享 trajectory projection 提供 final assistant content 和前五个完整 tool observation。Critic 通过共享 auxiliary-LLM helper 使用 coordinator 当前模型路由。Tool result 持久化 bounded critic input、子 Session id、stop reason、provider/model、raw output、parse failure、选中专家和 final answer。Coordinator 未调用工具而输出 prose 时，有界 reminder 会再次提示，不会形成无限 loop。

## 共享组件

`runtime/subagent-ensemble.ts` 管理 coordinator Harness 的新子任务创建、工具拒绝、结果结算、Session capture 和释放。`runtime/trajectory.ts` 提供持久轨迹，`runtime/auxiliary-llm.ts` 提供 critic call。

## 有意差异

- 官方 OAgents 支持通用 best-of-N 和 list-wise test-time scaling；本实现采用一个 PE 专家、两个 ReAct 专家和 evidence-aware JSON critic 的固定组合。
- DSH 隔离子 Session 的会话状态，但不会覆盖或回滚用户共享 working tree，避免破坏无关或并发修改。Filesystem side effect 因此仍然共享并显式公开。
- 专家使用原生 DSH tool call 和标准 Agent loop，不使用 marker JSON action 和嵌套 Python loop。
- 参考实现按字符截断 evidence；共享 DSH trajectory 按单词限制，避免在 Unicode codepoint 中间截断。
