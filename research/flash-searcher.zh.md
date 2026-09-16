# Flash-Searcher 研究笔记

[English](flash-searcher.md) | 中文

## 来源

- 官方仓库：[OPPO-PersonalAI/Flash-Searcher](https://github.com/OPPO-PersonalAI/Flash-Searcher)，revision `844f51f70dd641647760d90dbb027d0d45c111f0`，Apache-2.0。
- 检查文件：`FlashOAgents/agents.py`、`memory.py`、`agent_types.py`、默认 tool-calling prompt、`base_agent.py`、`run_flash_searcher.py` 和 README。
- 论文：[Flash-Searcher](https://arxiv.org/abs/2509.25301)。

## 定义行为

Flash-Searcher 先通过专用 planning call 把任务拆成 1–5 个 goal，并为每个 goal 生成 1–5 条候选 path。Goal 可以并行推进，同一 goal 内的 path 是带成功条件的顺序 fallback。ReAct loop 一次 action 最多可为独立 goal 发出五个工具调用。默认每八步，独立模型调用会分析各 goal 和 path、更新进度、调整受阻 path，并给出后续并行 sub-path。Full history 保留计划、action、observation 和周期 review。

论文描述依赖 DAG 和积极并行调度。公开仓库当前入口会顺序运行多个 call；`ThreadPoolExecutor` 代码存在但被注释，README 要求在工具容量允许时启用。本实现使用 DSH 有界并行 scheduler。

## DSH 实现

模型必须先调用 `submit_dag_plan`。结构化图包含稳定 goal id、显式依赖和有序 fallback path。验证会拒绝重复 id、缺失依赖、重复依赖、自依赖和环。Session projection 只在工具成功后提交图，并在回放时重建。动态 system prompt 根据依赖完成情况计算 ready goal，并显示每条 path 的成功条件。

Headless profile 把 `agent-loop.maxParallelToolCalls` 设为 5。模型可在一次回复中为不同 ready goal 发出独立 call，DSH 并发调度并保持持久 call/result 配对。`record_dag_review` 记录 goal 状态和 active path 转换；达到配置间隔时，guard 要求完整图 review。

## 共享组件

`src/runtime/dag.ts` 提供不依赖 Flash-Searcher prompt 或状态的依赖验证与 ready-node 选择。Harness 也复用公共 prompt registry、管理工具 guard、Session projection 和 DSH tool scheduler。

## 有意差异

- 结构化 DSH 参数取代自由格式 Markdown plan，使依赖和回放状态可由程序验证。
- 周期 review 通过模型可见、持久化的工具调用完成，而不是私有模型请求。
- DSH 并发执行独立 call；固定 revision 的公开 Python 入口默认顺序执行。
- 全局步数和 forced-answer 策略由部署管理。
