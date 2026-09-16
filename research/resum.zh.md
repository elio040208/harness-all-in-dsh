# ReSum 研究笔记

[English](resum.md) | 中文

## 来源

- 原始 WebResummer：[Alibaba-NLP/DeepResearch/WebAgent/WebResummer](https://github.com/Alibaba-NLP/DeepResearch/tree/main/WebAgent/WebResummer)，revision `f72f75d8c3eb842f2bbbab096a12206ff66e270f`，Apache-2.0。
- 检查文件：`src/react_agent.py`、`src/summary_utils.py`、`src/prompt.py`、`src/main.py` 和 `src/run_resum.sh`。
- JIT HarnessFactory：[bingreeky/JIT](https://github.com/bingreeky/JIT)，revision `ababa06c2f54d799fd9fbc356e5368f61a452260`，Apache-2.0；同时检查 ReSum memory、planning、action、tool policy、prompt 和 description。

## 定义行为

WebResummer 运行直接的 ReAct loop，同时为评测保留独立完整轨迹。每次 action 后，它都会测量活跃模型上下文。启用 ReSum 后，当上下文达到预算的 90%，summarizer 会总结自上次 reset 以来的对话。第一次 summary 使用原始问题和近期历史；后续 summary 还会接收上一次 summary。成功后，活跃上下文被替换为 system prompt 和包含原问题、合并摘要的合成用户 observation；失败或空摘要不会改变历史。

固定 Harness 解释把 ReSum 定义为无 planner、ReAct execution、完整工具目录和 summary memory。JIT seed 另外加入初始线性 roadmap 和八步进度 review；本实现遵循 WebResummer 原始执行 loop，不引入这层额外 planner。

## DSH 实现

Harness 保留标准 DSH ReAct loop 和完整工具目录。Profile 在压力比例 `0.9` 时触发持久 surface compaction，不保留原始历史 token，并只尝试一次 summary。DSH transaction 保留 system prompt，总结完整且 call/result 配对平衡的非 system surface，把 summary 和来源事件序列写入 Session，再用一个 checkpoint observation 替换所选历史。后续 compaction 自然会包含旧 checkpoint 和新事件，因此可以确定性回放迭代 summary。

## 共享组件

ReSum 复用公共 prompt helper，以及 DSH token meter、模型路由、Session surface replacement、compaction event、取消和 resume 行为。其他 folding Harness 可以复用相同持久 replacement 机制，并提供不同选择策略。

## 有意差异

- 除非 host 指定其他路由，DSH 使用当前模型生成 summary；原实现会启动专用 ReSumTool server。
- DSH 只选择平衡的 surface unit，避免 tool call 丢失对应 result，因此可能延后到安全步骤边界再 checkpoint。
- DSH checkpoint framing 取代字面 `<summary>` wrapper，但保留相同重启作用和回放后的模型可见性。
- 原实现的 interval fallback 默认为 1000 轮；本 profile 只使用 token 压力触发，因为部署步数限制与上下文预算相互独立。
