# harness-all-in-dsh

用 DeepSeek Harness（DSH）的原生插件、Session、Agent、Subagent 与 Workflow 接缝，复现公开论文中的 Agent Harness。

首个研究目标是复现 *JIT-Agent: Scaling Harness Intelligence via Just-in-Time Harness Evolution* Table 1 收录的 13 个固定 Harness。项目不包含 JIT-Agent 仓库副本，也不复现其训练流程；JIT HarnessFactory 仅作为 Table 1 具体实现语义的参考来源之一。

## 目标

- 每个 Harness 都从标准 `dsh` profile 启动，不发布绕过 DSH launcher 的 Agent 应用。
- 使用 DSH Session 日志保存所有模型可见计划、摘要、折叠结果、子任务结果与最终聚合结果。
- 使用 DSH 默认 Agent loop、subagent、workflow、scoped tools 和 surface replacement，而不是在插件中嵌入另一套通用 Agent loop。
- 对照原论文、官方代码和 JIT HarnessFactory 的实现语义，记录每一项有意偏差。
- 先证明机制可运行，再进行同模型、同任务、同预算的横向评测。

## Harness 清单

| Harness | 核心机制 | DSH 承载方式 |
|---|---|---|
| ReAct | 交替推理、工具调用和观察 | 默认 agent-loop |
| Plan-and-Execute | 线性计划后执行 | 计划 Session 事件 + pre-step 指令 |
| ReSum | 达到上下文阈值后总结并重启工作上下文 | surface compaction |
| Flash-Searcher | DAG 分解、ready-node 调度和周期性重规划 | workflow + 状态投影 |
| GAM | 可检索记忆页与周期性研究整合 | 持久记忆投影 + 检索服务 |
| MemoBrain | 依赖感知 reasoning graph、flush 和 fold | reasoning-graph 投影 + surface replacement |
| AggAgent | 隔离的并行 rollout 与轨迹检索聚合 | subagent + aggregator controller |
| OAgent | 异构专家路径与 critic 投票 | subagent ensemble controller |
| AgentFold | 模型主动折叠指定轨迹区间 | fold 工具 + surface replacement |
| HiAgent | 分层记忆与价值采样 | 分层状态投影 + 可见历史策略 |
| DeepAgent | 三层记忆、主动 fold 与工具搜索 | memory projection + tool router |
| ROMA | atomizer、DAG、递归执行与聚合 | recursive subagent controller |
| AOrchestra | 动态构造子 Agent 的指令、上下文、工具和模型 | configurable subagent controller |

## 当前状态

项目骨架已建立。`src/catalog.ts` 是 13 个 Harness 的唯一清单；下一阶段先实现共同的运行记录和测试夹具，再按机制族逐个移植。

研究来源见 [research/SOURCES.md](research/SOURCES.md)，总体架构见 [docs/architecture.md](docs/architecture.md)。
