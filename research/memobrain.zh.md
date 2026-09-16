# MemoBrain 研究笔记

[English](memobrain.md) | 中文

## 来源

- 官方仓库：[qhjqhj00/MemoBrain](https://github.com/qhjqhj00/MemoBrain)，revision `82f16e17c28313a57bf95d83340142b96507f3d1`，Apache-2.0。
- 检查文件：`src/memobrain.py`、`problem_tree.py`、`prompts.py`、`schema.py`，以及 `examples/react_with_memory.py` 和 `memory_snapshot.json`。
- 论文：[MemoBrain](https://arxiv.org/abs/2601.08079)。

## 定义行为

MemoBrain 运行没有显式计划的直接 ReAct loop。独立 memory model 被动消费每个完整 assistant/tool-response episode，并把 task、subtask 或 evidence node 以及带 rationale 的依赖 edge 写入 reasoning graph。当工作历史超过 memory budget，另一次 memory-model call 会选择无效或被替代的 node 进行 flush，并把完成 path fold 为 summary node。重建上下文时保护最早三条和最新四条消息。

## DSH 实现

DSH Agent loop 是唯一任务 executor。Session projection 把每个 assistant response、tool call 和 tool result 组合为完整 episode。下一任务步骤前，辅助调用通过当前会话模型路由生成经过验证的 graph patch。Provider、model、raw output、解析后的 patch 和失败状态都写入插件 Session message，因此 replay 不会重新调用 memory model。

当 token meter 达到模型 context window 的 25% 时，第二次辅助调用选择 flush 和 fold。Flush 标记冗余 node 为 inactive；fold 创建 summary node、转移覆盖事件引用、删除内部 edge，并重连输入和输出依赖。DSH 随后用原始任务、优化 graph，以及最早三条和最新四条事件的文本投影替换非 system surface。不可变原始 Session 日志仍然保留。

## 共享组件

`runtime/auxiliary-llm.ts` 统一管理 Harness 自有模型调用的路由继承、stream assembly、取消、finish 验证和文本提取。`runtime/content.ts` 提供与 GAM 共用的回放安全内容投影。

## 有意差异

- 原实现使用绝对 32K token 阈值；DSH 默认使用模型 context window 的 25%，便于跨 provider。
- 原实现重建 OpenAI message list 并逐字保留首三尾四；DSH 写入包含原任务、优化 graph 和首三尾四文本投影的显式 checkpoint，同时保留结构化 raw event。
- 原示例使用 marker 分隔工具调用；DSH 使用原生结构化 tool call 和标准 Agent loop，只复现 executive-memory 行为。
