# ROMA 研究笔记

[English](roma.md) | 中文

## 来源

- 官方仓库：[sentient-agi/ROMA](https://github.com/sentient-agi/ROMA)。
- 检查 revision：`a6e3bb4f9e0694375fa627fa4b8bf8cae50592a6`。
- 许可证：该 revision 没有 `LICENSE`、`COPYING` 或 package license 声明；本项目不复制 ROMA 源码。
- 检查文件：根 README，engine 的 solve、DAG、scheduler 和 runtime，atomizer/planner/aggregator module，task/subtask model，以及 planner/aggregator seed prompt。

## 定义行为

ROMA 把工作表示为嵌套依赖 DAG 中的不可变 task node。每个 node 被 atomize 为 `EXECUTE` 或 `PLAN`。Planned child 会递归 atomize；依赖已满足的 child 可并发运行，并接收 predecessor result。达到配置 recursion depth 后强制执行。Aggregator 把完成的 child 综合为 parent result，因此 goal 自顶向下传播，result 自底向上返回。

## DSH 实现

`roma_solve` 是唯一 parent coordinator action。Atomizer、planner 和 aggregator 使用父会话当前 DSH 模型路由。Atomic node 作为带 scoped tool 的隔离 DSH child Session 运行。父 tool result 持久化完整递归树、decision、依赖 plan、child Session id 和 aggregate result。

## 共享组件

ROMA 复用 `runtime/dag.ts` 进行依赖验证和 ready-node 选择，使用 DSH subagent service 运行原子节点，并通过 Session 日志保存完整任务树。

## 有意差异

- 实现不嵌入 DSPy、NetworkX、ROMA storage、checkpoint、MLflow、REST 或 TUI layer，而是使用 DSH Session durability 和共享 DAG validator。
- Node、depth、fan-out、concurrency 和 auxiliary-token limit 都是显式插件配置。
- 可选 ROMA verifier 不属于固定 Harness 机制，因此没有实现。
