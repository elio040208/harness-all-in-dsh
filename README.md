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

- ReAct：已接入。复用 DSH 原生 `ReactLoopAgent`，保留完整历史和任务工具，关闭会改变该固定 Harness 的压缩、显式规划与递归委派机制。
- Plan-and-Execute：已接入。先持久化 3–7 步线性 roadmap，再进入 ReAct 执行；默认每 8 个执行步骤持久化一次进度总结。
- ReSum：已接入。在上下文压力达到 90% 时压缩全部非 system 历史，Session 保留完整事件轨迹，下一步从持久化 checkpoint 继续。
- Flash-Searcher：已接入。结构化 DAG 记录 1–5 个 goal、依赖和顺序 fallback path；DSH 最多并发执行 5 个跨 goal 调用，并默认每 8 步要求一次完整图 review。
- GAM：已接入。完整工具结果进入持久 page store，模型为每页写 abstract；默认每 4 个 action step 检索并整合相关页面，再以 integrated memory 替换工作 surface。
- MemoBrain：已接入。每个完整 tool episode 由辅助模型被动写入 task/subtask/evidence 依赖图；工作上下文达到 25% 时自动 flush 无效节点、fold 已完成路径，并保护首尾上下文生成新 checkpoint。
- 其余 7 项：按 Table 1 顺序逐项研究和实现。

安装到从 `headless` 模板创建的 profile 后即可运行：

```sh
dsh --profile harness-react --from-default-profile headless --dump-config
dsh plugin --profile harness-react add /absolute/path/to/harness-all-in-dsh
dsh --profile harness-react "your task"
```

源码安装会执行 `prepare` 构建；从 GitHub 安装时需要按 DSH 提示允许该构建脚本。各 Harness 的原始实现、固定 revision 与有意偏差记录在 `research/` 下的同名说明中。

研究来源见 [research/SOURCES.md](research/SOURCES.md)，总体架构见 [docs/architecture.md](docs/architecture.md)。
