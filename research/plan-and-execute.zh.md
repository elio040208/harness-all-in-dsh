# Plan-and-Execute 研究笔记

[English](plan-and-execute.md) | 中文

## 来源

- 原始 Plan-and-Act 仓库：[SqueezeAILab/plan-and-act](https://github.com/SqueezeAILab/plan-and-act)，revision `534ed56f0d75e3059e54907859b89c901094f293`，Apache-2.0。
- 检查文件：`plan_and_act/cot/inference/plan.py`、`plan_and_act/cot/inference/act.py` 和 `run_plan_and_act.py`。

## 定义行为

原始 Plan-and-Act 把 planner 和 executor 分开。Planner 先生成详细计划，executor 再根据当前 observation、任务、历史轮次和计划选择即时动作。

## DSH 实现

实现保留 DSH Agent loop 和完整 Session 历史。模型可先完成制定具体 roadmap 所需的任务检查，再尽早调用 `submit_plan` 提交详细的有序 roadmap。官方 planner 不限制 roadmap 条目数，因此该工具接受任意非空步骤序列。成功 call 和 result 作为普通 Session 事件持久化。Host projection 从这些事件恢复当前 roadmap、执行步数和 resume 状态。达到配置间隔时，runtime context 建议调用 `record_progress`，但任务工具仍可使用。Runtime-context snapshot 只在状态变化时呈现回放得到的 roadmap 和最新摘要，system policy 保持稳定。

## 共享组件

Plan-and-Execute 复用 ReAct 的 prompt 注册 helper，以及移除无关计划、压缩和递归控制机制的固定 Harness bundle。可回放 projection 和管理工具模式也可供后续 roadmap 型 Harness 使用。

## 有意差异

- Planner 和 executor 使用同一条 DSH 模型路由，而不是独立训练的 checkpoint。
- 结构化 DSH 工具调用取代 tagged text 或 JSON repair；无效参数通过工具验证失败并保留在日志中。
- 原实现先运行 planner，再进入 executor。DSH 允许在提交 roadmap 前检查任务，因为文件系统和代码仓库任务通常需要先读取事实才能写出具体计划；这会弱化原始阶段边界，但保持工具目录稳定。
- 原 controller 自行管理进度更新。DSH 把周期进度表示为建议性的持久 tool call；模型遗漏时不会阻止下一次任务 action。
- 全局步数上限由部署管理，adapter 不会在固定步数后强制回答。
