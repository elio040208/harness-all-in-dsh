# Plan-and-Execute 研究笔记

[English](plan-and-execute.md) | 中文

## 来源

- 原始 Plan-and-Act 仓库：[SqueezeAILab/plan-and-act](https://github.com/SqueezeAILab/plan-and-act)，revision `534ed56f0d75e3059e54907859b89c901094f293`，Apache-2.0。
- 检查文件：`plan_and_act/cot/inference/plan.py`、`plan_and_act/cot/inference/act.py` 和 `run_plan_and_act.py`。
- JIT HarnessFactory：[bingreeky/JIT](https://github.com/bingreeky/JIT)，revision `ababa06c2f54d799fd9fbc356e5368f61a452260`，Apache-2.0。
- 检查 JIT 文件：`harness_factory/harnesses/plan_and_execute/` 下的 memory、planning、action、tool policy、prompt，以及对应 description。

## 定义行为

原始 Plan-and-Act 把 planner 和 executor 分开。Planner 先生成详细计划，executor 再根据当前 observation、任务、历史轮次和计划选择即时动作。固定 Harness 适配会在第 0 步生成 3–7 项编号线性 roadmap；普通步骤使用完整工具目录执行 ReAct action/observation loop；每八个执行步骤追加一次进度摘要。Full history 保留初始计划、所有 action、observation 和后续摘要。

## DSH 实现

实现保留 DSH Agent loop 和完整 Session 历史。第一个模型步骤必须调用 `submit_plan` 提交 3–7 个有序步骤，tool guard 在成功前阻止任务工具。成功 call 和 result 作为普通 Session 事件持久化。Host projection 从这些事件恢复当前 roadmap、执行步数和 resume 状态。达到配置间隔时，guard 要求模型先调用 `record_progress`。System-prompt section 会在每次请求中呈现回放得到的 roadmap 和最新摘要。

## 共享组件

Plan-and-Execute 复用 ReAct 的 prompt 注册 helper，以及移除无关计划、压缩和递归控制机制的固定 Harness bundle。可回放 projection 和管理工具模式也可供后续 roadmap 型 Harness 使用。

## 有意差异

- Planner 和 executor 使用同一条 DSH 模型路由，而不是独立训练的 checkpoint。
- 结构化 DSH 工具调用取代 tagged text 或 JSON repair；无效参数通过工具验证失败并保留在日志中。
- Roadmap call 仍看到稳定的 DSH tool schema，guard 负责 planner/executor 阶段限制。
- 全局步数上限由部署管理，adapter 不会在固定步数后强制回答。
