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
| AggAgent | https://github.com/princeton-pli/AggAgent |
| OAgent | https://github.com/OPPO-PersonalAI/OAgents at `027f2c4579ee7e7767bfe54c66df48a902d43e98` |
| AgentFold | https://github.com/Alibaba-NLP/DeepResearch/tree/main/WebAgent/AgentFold at `f72f75d8c3eb842f2bbbab096a12206ff66e270f` |
| HiAgent | https://github.com/HiAgent2024/HiAgent at `cebdd8e4eacec1a532ce2c0041db8902217b90ba` |
| DeepAgent | https://github.com/RUC-NLPIR/DeepAgent at `2e25aba3326295fff41fe1216792af353bb98558` |
| ROMA | https://github.com/sentient-agi/ROMA at `a6e3bb4f9e0694375fa627fa4b8bf8cae50592a6` |
| AOrchestra | https://github.com/FoundationAgents/AOrchestra at `14a1a2051d6b03c479b706f8f555a60b8419e3b5` |

Table 1 and the authors' fixed-harness interpretations are checked against:

- Paper: https://arxiv.org/abs/2608.25593
- HarnessFactory source: https://github.com/bingreeky/JIT/tree/main/harness_factory

Before implementation begins for a Harness, record the exact upstream revision, license, inspected files, defining behaviors, and intentional DSH deviations in a dedicated research note.
