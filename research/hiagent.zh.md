# HiAgent 研究笔记

[English](hiagent.md) | 中文

## 来源

- 官方仓库：[HiAgent2024/HiAgent](https://github.com/HiAgent2024/HiAgent)，revision `cebdd8e4eacec1a532ce2c0041db8902217b90ba`。该 revision 的根目录没有许可证声明。
- 检查文件：`agentboard/agents/ours_agent.py`、`evaluate_model.sh` 和根 README。
- 论文：[arXiv](https://arxiv.org/abs/2408.09559)和 [ACL 2025](https://aclanthology.org/2025.acl-long.1575/)。

## 定义行为

官方实现会在 trial 内部保留完整 trajectory，但只向模型发送固定大小的 sample。它始终保留第一条和最新 interaction。中间 interaction 的分数由 inverted-Gaussian boundary score 和 observation 相对下一条 observation 的 novelty 构成，novelty 为一减 TF-IDF cosine similarity。最高价值的中间项占据剩余槽位，未选择位置仍以 `Omitted: Action-Observation pair` 占位符呈现。

论文还描述基于 subgoal chunk、observation summary 和详细 trajectory retrieval 的更广义层次设计。这些机制没有出现在官方仓库注册的 `OurAgent` 中，其可执行 memory policy 只有 value-based trajectory sampling。

## DSH 实现

HiAgent 运行原生 DSH ReAct loop，每步只执行一个外部 action，不使用显式 planner。共享 `runtime/tool-episodes.ts` 把 assistant、tool-call 和 tool-result Session event 组合为不可变 interaction。HiAgent 在 Session projection 中保存全部 interaction，复现官方 TF-IDF 和 boundary scoring，并把下一次模型 surface 替换为原始 goal、选中条目和有序 omission placeholder。默认 memory size 为 15，可在 `cordis.yml` 配置。

## 共享组件

`runtime/tool-episodes.ts` 统一管理 event grouping、explanation extraction、multi-tool aggregation、result capture 和来源序列。AgentFold 也使用该组件，但两个 Harness 仍拥有不同的选择和 replacement 策略。

## 有意差异

- 实现复现官方仓库可执行的 value sampler，不实现仓库中不存在的论文级 subgoal summary 和 retrieval。
- 官方 agent 把 action 序列化为文本并解析一个 action；DSH 使用原生 tool call 和 Session event。
- 官方代码依赖 scikit-learn；本实现直接计算相同的双文档 smooth-IDF cosine weight，避免 Python runtime 依赖。
- 官方 reward-delta term 因所有 reward 都为零而恒为零，本实现省略该项。
- 官方 prompt 在超过模型窗口时只缩小一次 sample；DSH 保持固定配置 memory size，并交由 profile context policy 处理窗口限制。
