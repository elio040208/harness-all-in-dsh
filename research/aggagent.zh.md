# AggAgent 研究笔记

[English](aggagent.md) | 中文

## 来源

- 官方仓库：[princeton-pli/AggAgent](https://github.com/princeton-pli/AggAgent)，revision `9638f7d88aee01eb636c02841e13a05bb2e3c449`，MIT。
- 检查文件：`aggagent/agent.py`、`tools.py`、`prompts.py`、aggregation strategy、rollout 入口和 README 用法。
- 论文：[AggAgent](https://arxiv.org/abs/2604.11753)。
- JIT HarnessFactory revision `ababa06c2f54d799fd9fbc356e5368f61a452260`；检查 AggAgent memory、action、planning、tool policy、prompt 和 description。

## 定义行为

AggAgent 先生成互相独立、可以使用工具的完整 rollout，再向独立 aggregation Agent 提供紧凑目录，而不是把所有 transcript 拼接进 prompt。Aggregator 可以获取 final solution、使用 ROUGE-L recall 搜索单条轨迹、打开最多五步的连续 segment，并通过 validated finish tool 提交独立 solution。原始环境 observation 的优先级高于 rollout reasoning；多个 rollout 一致本身不算证据。

## DSH 实现

协调器通过 `spawn` provider 并发启动四个全新 DSH 子 Agent。每个 rollout 使用隔离 Session，继承父模型路由，接收独立任务 prompt，并保留普通任务工具；四个 aggregator tool 被拒绝。父 Session 记录子 Session id，插件消息记录 terminal status、step count 和紧凑 metadata。

Aggregator 保持在标准 DSH Agent loop 内。四个工具对应官方 `get_solution`、`search_trajectory`、`get_segment` 和 `finish`。共享 trajectory 组件从子 Session event 投影结构化 assistant call 和 tool result，提供 ROUGE-L 搜索、字数限制和步数限制。Final solution 不同时，aggregator 必须先检查 raw trajectory evidence，`finish` 才会接受结果。

## 共享组件

`runtime/trajectory.ts` 是 coordinator Harness 共用的 child-Session 投影和检查层。它提供持久 trajectory、metadata、final result 获取、排序搜索和有界 segment 阅读。

## 有意差异

- 官方评测流程会预先生成 rollout 文件；DSH 在父 Agent 第一个 pre-step 自动完成生成和聚合，使两阶段处于同一次 Session run。
- 官方 aggregator 最多可进行 100 次私有 LLM iteration；DSH 使用部署配置的标准 Agent-loop 限制。
- 官方代码支持 long-form 和 Qwen 特殊 finish format；本实现使用通用聚合路径的默认 XML solution format。
- JIT 固定适配顺序运行 rollout；本实现遵循论文和官方并行扩展设计，并发运行隔离子任务。
