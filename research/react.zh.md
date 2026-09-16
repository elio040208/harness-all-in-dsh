# ReAct 研究笔记

[English](react.md) | 中文

## 来源

- 官方仓库：[ysymyth/ReAct](https://github.com/ysymyth/ReAct)，revision `6bdb3a1fd38b8188fc7ba4102969fe483df8fdc9`，MIT。
- 检查文件：`hotpotqa.ipynb` blob `0bd48a1f559bc19c3de634422240beb5cc6a111e` 和 `prompts/prompts_naive.json` blob `df9097412ed4f55da903cbb847d9e21c956c9bf0`。
- 论文：[ReAct](https://arxiv.org/abs/2210.03629)。

## 定义行为

官方 HotpotQA loop 保留完整 prompt 轨迹，并反复要求模型先生成 `Thought`，再生成一个 `Action`。环境执行 `Search`、`Lookup` 或 `Finish`，追加对应 `Observation`，最多重复七轮。

## DSH 实现

DSH 自带的 `ReactLoopAgent` 已经负责请求、工具和结果循环，并持久化完整消息历史，因此项目不再嵌入另一套 loop。ReAct adapter 只提供模型策略；固定 headless profile 串行执行工具，并关闭会改变该 Harness 的压缩、显式计划、goal、递归 Agent、workflow 和 Ralph 工具。文件、Shell、Web 和 Skill 等普通任务能力保持可用。

## 有意差异

- 原生结构化工具调用取代文本 `Action[...]` parser，工具结果就是 observation。
- DSH 不要求模型输出私有 chain-of-thought；provider 可以隐藏内部推理，同时保留 ReAct 控制顺序。
- 原实现的七步上限属于 HotpotQA benchmark。DSH 实现由部署任务和 runtime 预算控制，不全局强制该上限。
