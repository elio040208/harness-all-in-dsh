# AOrchestra 研究笔记

[English](aorchestra.md) | 中文

## 来源

- 官方仓库：[FoundationAgents/AOrchestra](https://github.com/FoundationAgents/AOrchestra)。
- 检查 revision：`14a1a2051d6b03c479b706f8f555a60b8419e3b5`。
- 许可证：Apache-2.0。
- 检查文件：根 README 和 LICENSE，`main_agent.py`，delegate/complete/submit/trace formatter tool，ReAct subagent，GAIA/TerminalBench/SWE-bench prompt 和 runner，以及配置文件。

## 定义行为

AOrchestra 把子 Agent 表示为运行时创建的四元组 `phi = <I,C,T,M>`：精确子任务 instruction、筛选后的历史 context、允许的 tool subset 和选定 model。MainAgent 反复检查之前的 delegation result，为剩余工作创建新的专用 tuple，或完成任务。每次 delegation 都启动新 sub-agent，并返回结果和执行轨迹信息。

## DSH 实现

`aorchestra_delegate` 显式暴露四个 tuple field。它会根据配置验证 model choice，根据当前 DSH request catalogue 验证 tool，然后以所选模型路由、scoped tool allowlist、subtask persona 和指定 context 启动全新 DSH child Session。`aorchestra_complete` 把独立答案和全部 delegation metadata 写入父 Session result。

## 共享组件

AOrchestra 使用 DSH subagent service 创建隔离 child，并复用共享 trajectory projection 提取 child answer、tool observation、stop reason 和 step count。

## 有意差异

- 完整 child trajectory 保存在各自持久 DSH Session 中；父会话只接收 child answer、有界 tool-observation summary、stop reason、step count、tuple 和 child Session id。
- DSH 管理 environment 和 cost policy；项目不嵌入 AOrchestra benchmark runner、model-price table、JSON action loop 或固定 Gemini trace summarizer。
- Model choice、provider route 和 delegation limit 都是显式插件配置。
