# DeepAgent 研究笔记

[English](deepagent.md) | 中文

## 来源

- 官方仓库：[RUC-NLPIR/DeepAgent](https://github.com/RUC-NLPIR/DeepAgent)，revision `2e25aba3326295fff41fe1216792af353bb98558`，MIT。
- 检查文件：`src/run_deep_agent.py`、`prompts_deepagent.py`、`run_tool_search_server.py`、根 README 和许可证。
- 论文：[DeepAgent](https://arxiv.org/abs/2510.21618)。
- JIT HarnessFactory revision `ababa06c2f54d799fd9fbc356e5368f61a452260`；检查 DeepAgent memory、action、planning、tool policy、prompt 和 description。

## 定义行为

DeepAgent 在不受限 reasoning 中交替选择三类 action 之一：外部工具、工具发现或 thought folding。Thought folding 由模型主动触发，并通过辅助模型并行生成 episodic、working 和 tool memory。Runtime 随后用原任务和三类 memory 重建 prompt，并丢弃之前的活跃 reasoning surface。Episodic memory 记录里程碑和进度，working memory 记录即时目标和下一动作，tool memory 记录成功参数、失败模式、响应规律和派生规则。官方默认最多允许三次 fold。

Tool discovery 会搜索大型目录并返回有界详细 schema。完全重复的 search 和 external tool call 会被拒绝。官方 runtime 还使用辅助模型缩短大型 tool response。

## DSH 实现

主模型继续使用原生 DSH loop，每步一个 tool call。`deepagent_fold_thoughts` 收集上次 fold 后的全部 interaction，通过当前模型路由并发运行三次 memory call，并在持久 tool result 中返回 raw output、provider/model 和来源 interaction id。Session projection 验证并保存每次 fold。下一次模型请求前，插件用原始任务和三类 memory 替换非 system surface；完整 raw trajectory 保留在 Session event 和共享 tool-episode projection 中。

`deepagent_tool_search` 读取当前 request header 中准确的模型可见 tool schema，根据 query term 对名称、描述和 parameter schema 排序，并返回有界目录。Projection state 会拒绝完全重复的 search 和普通 tool call。

## 共享组件

DeepAgent 使用 `runtime/tool-episodes.ts` 进行无损 interaction grouping，并使用 `runtime/auxiliary-llm.ts` 运行三次 memory call。Fold prompt、状态转换、tool search 和 reset checkpoint 仍由 DeepAgent 拥有。

## 有意差异

- 官方 open-set retriever 使用独立 embedding server 和辅助选择 pass；本独立 DSH 插件确定性搜索真实 request tool catalogue，不增加固定外部部署。
- 原生 DSH tool call 取代 marker parser 和 stop-token protocol；headless profile 的 one-call limit 保留一轮一个 action。
- 官方 runtime 可用两次额外辅助调用总结大型 tool response；DSH 由既有 tool presentation、spill 和 result policy 管理输出，不覆盖其他工具的持久结果。
- 官方 fold memory 请求 JSON，但允许 extraction fallback；DSH 保存非空 raw auxiliary output，避免 parser 静默丢弃生成记忆。
