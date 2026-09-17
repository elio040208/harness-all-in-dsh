# 架构

[English](architecture.md) | 中文

本项目通过 DSH 扩展点复现可观察的 Harness 行为，并继续使用 DSH Agent loop、Session 日志、模型路由和工具 runtime 作为执行基础。

## 设计规则

- 使用插件、投影、scoped tools 和 surface 策略实现行为，不嵌入第二套通用 Agent runtime。
- 让所有模型可见计划、摘要、记忆状态、委派选择和聚合结果都能从 Session 数据重建。
- 把不变的 Harness 策略放在 system-prompt section 中，把变化的执行状态写成持久 runtime-context snapshot，而不是重写 system prompt。
- 把子任务保存在隔离的 DSH Session 中，只把显式结果写入父 Session。
- 把部署选择暴露为插件配置，让模型、工具、任务和预算设置位于 Harness 算法之外。
- 在 `research/` 中记录检查过的上游 revision 和所有有意差异。

## 执行类别

### Loop 内适配

ReAct、Plan-and-Execute、ReSum、Flash-Searcher、GAM、MemoBrain、AgentFold、HiAgent 和 DeepAgent 保留 DSH 自带的 Agent loop。对应插件提供稳定策略 section、持久状态投影和 context snapshot、scoped tools、请求时 guard 和支持回放的 surface replacement。

### 协调器

AggAgent、OAgent、ROMA 和 AOrchestra 拥有一个有界协调动作。它们通过 subagent 服务创建 DSH 子 Agent，把每条子轨迹保存在独立 Session 中，并把选中或聚合后的结果持久化到父 Session。

## 共享组件

- `runtime/auxiliary-llm.ts` 通过继承模型路由、支持取消的方式运行并记录 Harness 自有模型调用。
- `runtime/dag.ts` 验证依赖图并选择 ready node。
- `runtime/tool-episodes.ts` 把回放得到的 call 和 result 组合为完整交互。
- `runtime/trajectory.ts` 把子 Session 投影为可搜索、有长度限制的轨迹。
- `runtime/subagent-ensemble.ts` 管理隔离子任务的创建、工具拒绝、结果结算和释放。
- `runtime/prompt.ts` 把不变策略保留在 system prompt 中，把变化的 Harness 状态写入 runtime-context snapshot。
- `runtime/protocol.ts` 为每个模型响应冻结一个 Harness 阶段，从同一阶段同时派生 runtime context 和可见工具，并只把 guard 保留为拦截模型不可见调用的兜底。
- `presets/_shared/agent-tools.cordis.yml` 定义 Web preset 共用的模型工具。

在至少两个实现需要相同行为之前，Harness 特有状态保留在各自模块中。

## 持久化规则

凡是会改变后续模型请求的内容，都必须能从 Session 数据复现。因此，计划、总结、折叠、记忆选择、委派配置、聚合和投票都使用持久事件、工具结果或插件消息。只有当输入、路由、输出和失败状态都进入 Session 生命周期时，插件才可以使用私有辅助模型调用。

动态 context provider 从可回放的 projection state 派生文本。DSH 只在文本变化时记录新的 user-role runtime-context snapshot，而 system prompt 在执行状态转换期间保持稳定。

Protocol phase 以模型响应为原子单位。一个工具调用产生的状态只能在下一次 prompt assembly 时改变准入规则，因此 exclusive barrier 和有界并行调度不会拒绝同一请求生成的后续调用。结构阶段始终强制执行；周期维护在 `guided` 模式下只提醒，在 `strict` 模式下强制执行。

Surface replacement 只改变模型看到的内容，不会删除底层 Session 事件。回放可以重建相同工作状态，而不重新运行之前的模型调用。

## Preset 所有权

DSH Web 把每个 Harness 挂载为一个 Agent preset。Preset 共享普通任务能力，所选 Harness 单独拥有自己的计划、记忆、压缩和协调器行为。Web host 继续拥有模型路由、Session 持久化、sandbox 策略、subagent provider 和并行工具调用上限等进程级服务。

Headless profile 使用 `profiles/` 下的显式 overlay。每个 overlay 插入一个 Harness 插件，并设置实验所需的 Agent-loop 并发上限。

## 保真度级别

- `mechanism`：已经实现定义该 Harness 的状态转换或编排算法。
- `behavior`：Harness 可以通过与参考实现同类的控制流程完成端到端任务。
- `benchmark`：在匹配的模型、工具、任务和预算下，实验支持对比结果。

任何结果在声称更高保真度前，都必须具备前面所有级别的证据。当前仓库只声称全部 Harness 已达到机制实现级别，文档不包含 benchmark 结论。
