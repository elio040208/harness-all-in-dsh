# Research sources

Reference repositories are consulted during clean DSH-native reimplementation. They are not vendored into this project.

| Harness | Primary source |
|---|---|
| ReAct | https://arxiv.org/abs/2210.03629 |
| Plan-and-Execute | https://github.com/SqueezeAILab/plan-and-act |
| ReSum | https://github.com/Alibaba-NLP/DeepResearch/tree/main/WebAgent/WebResummer |
| Flash-Searcher | https://github.com/OPPO-PersonalAI/Flash-Searcher |
| GAM | https://github.com/VectorSpaceLab/general-agentic-memory |
| MemoBrain | https://github.com/qhjqhj00/MemoBrain |
| AggAgent | https://arxiv.org/abs/2604.11753 |
| OAgent | https://github.com/OPPO-PersonalAI/OAgents |
| AgentFold | https://arxiv.org/abs/2510.24699 |
| HiAgent | https://github.com/HiAgent2024/HiAgent |
| DeepAgent | https://github.com/RUC-NLPIR/DeepAgent |
| ROMA | https://github.com/sentient-agi/ROMA |
| AOrchestra | https://github.com/FoundationAgents/AOrchestra |

Table 1 and the authors' fixed-harness interpretations are checked against:

- Paper: https://arxiv.org/abs/2608.25593
- HarnessFactory source: https://github.com/bingreeky/JIT/tree/main/harness_factory

Before implementation begins for a Harness, record the exact upstream revision, license, inspected files, defining behaviors, and intentional DSH deviations in a dedicated research note.
