# harness-all-in-dsh

[English](README.md) | 中文

使用 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 原生插件和 Agent preset 复现公开的 Agent Harness。

项目目前提供 13 个固定 Harness。项目不复制 JIT-Agent 仓库，也不复现其训练流程。原始论文、官方实现和 JIT HarnessFactory 仅作为实现参考；每份研究笔记都会记录检查过的 revision 和有意差异。

## 项目目标

- 让每个 Harness 通过受支持的 `dsh` profile 运行，而不是另建启动器。
- 在 DSH Session 数据中保存模型可见计划、摘要、记忆转换、子任务结果和聚合结果。
- 复用 DSH Agent loop、subagent provider、scoped tools 和 surface replacement，而不是嵌入另一套通用 Agent runtime。
- 在相同模型、任务、工具和预算配置下比较 Harness。
- 区分已经实现的机制复现和仍需实验支持的 benchmark 结论。

## 已包含的 Harness

| Harness | 核心机制 | DSH 实现方式 |
|---|---|---|
| ReAct | 交替推理、工具调用和观察 | 保留完整历史的原生 Agent loop |
| Plan-and-Execute | 线性计划后执行 | 持久计划事件和 pre-step 策略 |
| ReSum | 上下文压力触发总结并重启 | Session surface compaction |
| Flash-Searcher | 依赖 DAG 和 ready-node 调度 | 经过验证的 DAG 投影和有界并行调用 |
| GAM | 可检索记忆页和研究整合 | 持久 page 投影和检索工具 |
| MemoBrain | 可 flush、fold 的依赖感知推理图 | Graph 投影和 surface replacement |
| AggAgent | 独立 rollout 和证据优先聚合 | 隔离子 Session 和轨迹工具 |
| OAgent | 异构专家和 critic 选择 | 子 Agent ensemble 和持久 critic 结果 |
| AgentFold | 模型主动折叠轨迹区间 | Fold 工具和可回放摘要 |
| HiAgent | 分层、价值采样的工作记忆 | 完整 Session 历史和采样后的模型 surface |
| DeepAgent | 三层记忆 fold 和工具搜索 | 记忆工具和工具目录搜索 |
| ROMA | 递归 atomize-plan-execute-aggregate 控制 | 递归子 Session 和依赖 DAG |
| AOrchestra | 运行时选择指令、上下文、工具和模型 | 可配置的子 Agent controller |

13 个 Harness 均已完成机制级实现。本仓库尚未声称 benchmark 对比结果；这类结论需要匹配的评测矩阵支持。

## 在 DSH Web 中使用

把本仓库作为 bundle 安装到 `web` profile，然后重启 DSH Web：

```sh
dsh plugin --profile web add /absolute/path/to/harness-all-in-dsh
dsh web
```

新建 Session 后，选择名称以 `Harness ·` 开头的模式。已经包含消息的 Session 不能更换 Agent preset。

这些 preset 共享 Shell、文件、搜索、Skill 和用户提问工具。计划、记忆、折叠、压缩和子 Agent 行为只由所选 Harness 提供。Web 进程统一管理部署级工具调用并发上限，因此 preset 不会覆盖该设置。

## 从命令行运行

从 `headless` 创建 profile，安装 bundle，再应用目标 Harness overlay：

```sh
dsh --profile harness-react --from-default-profile headless --dump-config
dsh plugin --profile harness-react add /absolute/path/to/harness-all-in-dsh
dsh --profile harness-react --patch /absolute/path/to/harness-all-in-dsh/profiles/react.cordis.patch.yml "your task"
```

把 `react` 替换为 [`profiles/`](profiles/) 中的其他文件名，即可选择另一种 Harness。Headless overlay 保存了各 Harness 的并行调用上限，用于可复现的实验。

从源码安装会运行 package 的 `prepare` 脚本。从 GitHub 安装时，请先阅读 DSH 提示，再允许执行构建脚本。

## 文档

- [架构](docs/architecture.zh.md)说明 DSH 原生实现原则和保真度级别。
- [研究来源](research/SOURCES.zh.md)把每个 Harness 链接到论文、官方代码、检查过的 revision 和实现笔记。
- [`presets/`](presets/) 保存 Web 可选的 Agent composition。
- [`profiles/`](profiles/) 保存 headless 实验 overlay。

## 开发

```sh
pnpm install
pnpm run check
```

`pnpm run check` 会执行 TypeScript 检查、单元测试和生产构建。真实模型实验需要配置 DSH 模型 provider，不属于无密钥测试套件。

## 许可证

本项目使用 [MIT License](LICENSE)。上游项目保留各自许可证；研究笔记会注明每个被检查 revision 的许可证状态。
