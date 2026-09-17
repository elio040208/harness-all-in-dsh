# GAM 研究笔记

[English](gam.md) | 中文

## 来源

- 官方 General Agentic Memory 仓库：[VectorSpaceLab/general-agentic-memory](https://github.com/VectorSpaceLab/general-agentic-memory)，revision `565db2cc2518d377e44389b82aecf3cc129d5fe5`，MIT。
- 检查文件：memory/research agent、memory/page/search schema、BM25/dense/index retriever 和 memory/research prompt。
- 论文：[GAM](https://arxiv.org/abs/2511.18423)。

## 定义行为

GAM 把轻量记忆和无损历史分开。Memorizer 为每个输入生成简短 abstract，同时把完整输入保存为不可变 page。Researcher 从 abstract catalogue 规划检索，通过关键词、dense vector 和 page index 搜索，去重结果、整合事实、判断充分性，并按需发起聚焦检索。

## DSH 实现

GAM 组合现有 Flash-Searcher controller，不复制 DAG planner。每个非管理工具结果都会成为完整、由 Session 派生的 page。下一次任务 action 前，`gam_memorize_pages` 要求模型为每个新 page 写一个事实性、自包含 abstract。Page id 和 abstract catalogue 都是从工具 call/result 重建的持久 projection state。

每四个 action step，task tool 暂停，模型执行一次 memory integration。`gam_search_pages` 支持对完整内容进行精确关键词和 page id 检索；`gam_integrate_memory` 保存整合结果及其来源 page id。随后插件把完整非 system surface 替换为包含原始任务和 integrated memory 的用户 checkpoint。原始 Session event 和 page projection 仍可用于回放和后续检索。

## 共享组件

GAM 复用 Flash-Searcher 的 DAG、review projection、prompt registry 和五槽 DSH scheduler。Page projection 和显式 search/integration tool 构成可供其他 memory Harness 复用的 page-store 模式。

## 有意差异

- 原始 dense channel 使用 sentence-transformer 和 FAISS；本 TypeScript bundle 保持无额外依赖，只提供精确关键词和 page id 检索。
- 原始 Researcher 最多执行三轮私有 LLM plan/search/integrate/reflect；DSH 把 search 和 integration 暴露为日志工具，所有模型可见决策均可回放。
- 原实现通过独立 Memorizer call 生成 abstract；DSH 要求会话模型观察完整结果后，通过 guarded tool 写入 abstract。
- DSH integration checkpoint 不保留 raw tail；旧证据仍可从持久 page projection 精确查询。
