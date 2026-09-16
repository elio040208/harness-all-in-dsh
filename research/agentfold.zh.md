# AgentFold 研究笔记

[English](agentfold.md) | 中文

## 来源

- 官方 DeepResearch 仓库：[Alibaba-NLP/DeepResearch](https://github.com/Alibaba-NLP/DeepResearch)，revision `f72f75d8c3eb842f2bbbab096a12206ff66e270f`，Apache-2.0。
- 检查文件：`WebAgent/AgentFold/infer.py`、`serve.sh`、根 README 和许可证。
- 论文：[AgentFold](https://arxiv.org/abs/2510.24699)，重点为 3.1–3.3 节。

## 定义行为

AgentFold 把模型上下文分成不变问题、工具目录、多尺度状态 summary，以及一个保留完整内容的最新 interaction。每个非初始中间步骤，模型选择一个以最新 interaction 结尾的连续 folding range，写 replacement summary，并选择下一外部 action。只折叠最新 interaction 是 granular condensation；从较早 active summary boundary 开始，则深度合并该 summary suffix 和最新 interaction。Summary block 始终完整划分下一条最新 interaction 之前的全部历史。

官方 runtime 把旧 block 格式化为 `[Compressed Step N]` 或 `[Compressed Step N to M]`，最新 interaction 为 `[Step N]`。固定 revision 的 inference code 每轮执行一个 search 或 visit，并在追加新 interaction 前应用 fold。

## DSH 实现

原生 Agent loop 继续负责模型请求和外部工具。`agentfold_fold` 把 folding directive 表示为持久 DSH tool call。第一次 interaction 后，prompt 要求模型在同一回复中发出 fold call 和一个外部 task call。Headless profile 允许两个并行 call；fold transition 只读取之前完成的 workspace，因此 result 到达顺序不会改变语义。

Session projection 把每个完整非管理工具步骤组合为不可变 interaction。成功 fold 必须以最新 interaction 结尾，并从 active summary boundary 开始。下一次模型请求前，插件 checkpoint 用原始问题、有序 summary 和最新完整 interaction 替换非 system surface。Session event log 仍保留所有原始消息、call、result、fold directive 和被替换事件序列。

## 共享组件

AgentFold 复用 prompt registry 和 content extraction helper。连续 partition validator 和两层 workspace 仍由 AgentFold 单独拥有；HiAgent 和 DeepAgent 只复用通用 tool-episode 投影。

## 有意差异

- JIT 固定适配把 AgentFold 与 Flash-Searcher DAG planning 和八步 replanning 组合；论文和官方 AgentFold runtime 没有该层，因此本实现省略。
- 官方模型在一次 completion 中生成 `<compress>`、`<motivation>` 和 `<tool_call>` 文本；DSH 用两个原生 tool call 表示相同 fold/action 决策。
- 官方 runtime 只支持 `search` 和 `visit`；DSH 向模型开放当前 profile 的任务工具，同时保留每次 interaction 一个外部 action 的指令。
- 原代码没有验证 fold 必须结束于最新 interaction；本实现执行论文不变量，并拒绝拆分 active summary block 的 range。
- Final answer 后没有后续请求消费 workspace，因此不强制最后一次 fold；官方 inference 同样会在检测到答案后直接返回。
