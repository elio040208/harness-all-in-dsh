# 研究来源

[English](SOURCES.md) | 中文

本项目在进行干净的 DSH 原生重实现时参考上游仓库，不把上游代码 vendoring 到项目中。每份笔记都会记录准确的检查 revision、相关文件、定义行为、DSH 映射和有意差异。

| Harness | 主要来源 | 研究笔记 |
|---|---|---|
| ReAct | [论文](https://arxiv.org/abs/2210.03629) | [笔记](react.zh.md) |
| Plan-and-Execute | [官方仓库](https://github.com/SqueezeAILab/plan-and-act) | [笔记](plan-and-execute.zh.md) |
| ReSum | [官方仓库](https://github.com/Alibaba-NLP/DeepResearch/tree/main/WebAgent/WebResummer) | [笔记](resum.zh.md) |
| Flash-Searcher | [官方仓库](https://github.com/OPPO-PersonalAI/Flash-Searcher) | [笔记](flash-searcher.zh.md) |
| GAM | [官方仓库](https://github.com/VectorSpaceLab/general-agentic-memory) | [笔记](gam.zh.md) |
| MemoBrain | [官方仓库](https://github.com/qhjqhj00/MemoBrain) | [笔记](memobrain.zh.md) |
| AggAgent | [官方仓库](https://github.com/princeton-pli/AggAgent) | [笔记](aggagent.zh.md) |
| OAgent | [官方仓库](https://github.com/OPPO-PersonalAI/OAgents) | [笔记](oagent.zh.md) |
| AgentFold | [官方仓库](https://github.com/Alibaba-NLP/DeepResearch/tree/main/WebAgent/AgentFold) | [笔记](agentfold.zh.md) |
| HiAgent | [官方仓库](https://github.com/HiAgent2024/HiAgent) | [笔记](hiagent.zh.md) |
| DeepAgent | [官方仓库](https://github.com/RUC-NLPIR/DeepAgent) | [笔记](deepagent.zh.md) |
| ROMA | [官方仓库](https://github.com/sentient-agi/ROMA) | [笔记](roma.zh.md) |
| AOrchestra | [官方仓库](https://github.com/FoundationAgents/AOrchestra) | [笔记](aorchestra.zh.md) |

[JIT-Agent 论文](https://arxiv.org/abs/2608.25593)和 [HarnessFactory 源码](https://github.com/bingreeky/JIT/tree/main/harness_factory)提供额外的公共接口和固定 Harness 解释。每个 Harness 的官方代码和论文仍是主要行为依据。

修改 Harness 机制前，应在对应笔记中更新上游 revision、检查文件、许可证状态、行为证据和有意的 DSH 差异。
