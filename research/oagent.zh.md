# OAgent 研究笔记

[English](oagent.md) | 中文

## 来源

- 官方仓库：[OPPO-PersonalAI/OAgents](https://github.com/OPPO-PersonalAI/OAgents)，revision `027f2c4579ee7e7767bfe54c66df48a902d43e98`，Apache-2.0。
- 检查文件：`OAgents/src/oagents/agents.py`、GAIA TTS runner 和根 README。
- 论文：[OAgents](https://arxiv.org/abs/2506.15741)和[相关 test-time scaling 工作](https://arxiv.org/abs/2506.12928)。

## 定义行为

官方 BON 路径会使用相同配置的 Agent 重复独立执行。每条 rollout 从相同任务状态开始，先创建自己的初始规划步骤，再执行到返回答案或达到步数上限。各 rollout 顺序运行。List-wise result merger 接收每条完整轨迹，只选择一个候选编号，并原样返回该 rollout 的答案，不综合替代答案。官方 GAIA 命令使用四条 rollout。

## DSH 实现

一个模型可见 composite tool 运行完整 BON 路径并结束 coordinator turn。它通过 `spawn` provider 顺序启动四个同配置 DSH 子 Agent。每条 rollout 获得相同任务和工具，使用规划优先的 rollout persona，拥有独立 Session，并禁止递归调用 ensemble tool。子任务继承 coordinator 的 provider 和 model。

共享 trajectory projection 提供每条完整 rollout 及其 final assistant content。List-wise judge 通过共享 auxiliary-LLM helper 使用 coordinator 当前模型路由，并且只能返回 rollout 编号。最终答案从选中 rollout 原样复制。Tool result 持久化完整 judge 输入记录、子 Session id、stop reason、provider/model、raw output、parse failure、选中 rollout 和 final answer。Coordinator 未调用工具而输出 prose 时，有界 reminder 会再次提示，不会形成无限 loop。

## 共享组件

`runtime/subagent-ensemble.ts` 管理 coordinator Harness 的新子任务创建、工具拒绝、结果结算、Session capture 和释放。`runtime/trajectory.ts` 提供持久轨迹，`runtime/auxiliary-llm.ts` 提供 critic call。

## 有意差异

- DSH 隔离子 Session 的会话状态，但不会覆盖或回滚用户共享 working tree，避免破坏无关或并发修改。Filesystem side effect 因此仍然共享并显式公开。
- Rollout 使用原生 DSH tool call 和标准 Agent loop，不使用 marker JSON action 和嵌套 Python loop。
- 官方运行时会在每条 rollout 前创建专用 planning message；DSH 通过子 Agent 的规划优先 persona 表达相同策略，并保留原生 Agent loop。
