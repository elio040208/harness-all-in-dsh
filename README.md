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
- AggAgent：已接入。并行启动 4 个隔离的 DSH rollout Session，再通过 solution、ROUGE-L search、bounded segment 和 validated finish 工具进行证据优先聚合。
- OAgent：已接入。默认顺序运行 1 个 Plan-and-Execute 专家和 2 个 ReAct 专家，再由同路由 critic 根据答案与工具证据选择或综合最终结果。
- AgentFold：已接入。每一步把旧历史表示为连续的多尺度摘要块，只保留最新一次工具交互的完整记录；模型在下一次动作时主动选择 granular condensation 或 deep consolidation。
- HiAgent：已接入。Session 保存完整轨迹，模型上下文默认仅保留首尾与按边界权重、TF-IDF observation novelty 选出的 15 个高价值交互，其余位置显示 `Omitted` 占位。
- DeepAgent：已接入。模型可主动搜索当前工具目录或触发 thought fold；fold 并行生成 episodic、working、tool 三类记忆，再从任务与结构化记忆组成的新 surface 继续。
- ROMA：已接入。父协调器递归执行 atomize、依赖 DAG planning、原子子 Session execution 与逐层 aggregation；深度上限强制执行，完整任务树保存在父 Session 工具结果中。
- AOrchestra：已接入。MainAgent 逐次动态指定子 Agent 的 `<instruction, context, tools, model>` 四元组；每次委派使用独立 DSH Session、模型路由和工具白名单，最后由显式 complete 动作汇总。
- Table 1 的 13 个固定 Harness 已全部接入；后续工作是建立同模型、同任务、同预算的评测矩阵。

## 在 DSH Web 中选择 Harness

把项目作为 bundle 安装到 `web` profile，重启 Web 后，新建 Session 的模式选择器会显示 13 个以 `Harness ·` 开头的模式：

```sh
dsh plugin --profile web add /absolute/path/to/harness-all-in-dsh
dsh web
```

每个模式都是独立的 Agent preset。公共的 Shell、文件、搜索、Skill 和提问工具由一个共享 composition 提供；计划、记忆、折叠、压缩和子 Agent 编排只由选中的 Harness 提供。已有消息的 Session 不能中途更换 preset，请新建 Session 后再选择模式。

Web 的工具调用并发上限属于部署级设置，因此这些 preset 不会覆盖它。需要严格复现实验并发上限时，使用下面的独立 `headless` profile overlay。

## 从命令行运行

安装到从 `headless` 模板创建的 profile 后，显式应用目标 Harness 的 overlay：

```sh
dsh --profile harness-react --from-default-profile headless --dump-config
dsh plugin --profile harness-react add /absolute/path/to/harness-all-in-dsh
dsh --profile harness-react --patch /absolute/path/to/harness-all-in-dsh/profiles/react.cordis.patch.yml "your task"
```

源码安装会执行 `prepare` 构建；从 GitHub 安装时需要按 DSH 提示允许该构建脚本。各 Harness 的原始实现、固定 revision 与有意偏差记录在 `research/` 下的同名说明中。

研究来源见 [research/SOURCES.md](research/SOURCES.md)，总体架构见 [docs/architecture.md](docs/architecture.md)。
