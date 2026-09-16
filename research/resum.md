# ReSum research note

English | [中文](resum.zh.md)

## Sources

- Original WebResummer repository: https://github.com/Alibaba-NLP/DeepResearch/tree/main/WebAgent/WebResummer at `f72f75d8c3eb842f2bbbab096a12206ff66e270f` (Apache-2.0).
- Inspected original files: `src/react_agent.py`, `src/summary_utils.py`, `src/prompt.py`, `src/main.py`, and `src/run_resum.sh`.
- JIT HarnessFactory repository: https://github.com/bingreeky/JIT at `ababa06c2f54d799fd9fbc356e5368f61a452260` (Apache-2.0).
- Inspected JIT files: `harness_factory/harnesses/resum/{memory.py,planning.py,action.py,tool_policy.py,prompt.yaml}`, `harness_factory/descriptions/resum.md`, and `harness_factory/harnesses/resum/description.yaml`.

## Defining behavior

WebResummer runs a direct ReAct loop while keeping a separate full trajectory for evaluation. It measures the active model context after every action. With ReSum enabled, reaching 90% of the configured context budget invokes a summarizer over the conversation since the last reset. The first summary is grounded in the original question and recent history; later summaries also receive the preceding summary. A successful summary replaces the active context with the system prompt and a synthetic user observation containing the original question and the consolidated summary. Failed or empty summaries leave the active history unchanged.

The fixed Harness interpretation classifies ReSum as summarized memory with no planner, ReAct execution, and the full tool registry. JIT's seed implementation adds a linear initial roadmap and an eight-step progress review. This reproduction follows that classification and WebResummer's original execution loop instead of importing the extra planner.

## DSH implementation

The Harness keeps the standard DSH ReAct loop and full tool registry. Its profile enables DSH's durable surface compaction at a `0.9` pressure ratio, retains zero raw-history tokens, and allows one summary attempt. The DSH transaction preserves the system prompt, summarizes the complete balanced non-system surface, records the summary and source event sequence in the Session log, and replaces the selected history with one checkpoint observation. A later compaction naturally includes the previous checkpoint and new events, which provides the iterative-summary behavior of WebResummer while keeping replay deterministic.

## Shared components

ReSum reuses the common prompt-section helper and DSH's existing token meter, LLM routing, Session surface replacement, compaction events, cancellation, and resume behavior. Later folding Harnesses can reuse the same durable replacement mechanism while supplying different selection policies.

## Intentional deviations

- DSH uses the currently routed model for summarization unless the host config selects another provider/model; the original launches a dedicated ReSumTool server.
- DSH selects only balanced surface units so tool calls never lose their matching results. This may defer a checkpoint until a safe step boundary.
- The durable DSH checkpoint framing replaces WebResummer's literal `<summary>` wrapper, but it carries the same restart role and remains model-visible after replay.
- The original interval fallback defaults to 1000 rounds. This profile uses only the token-pressure trigger because DSH deployment step limits are independent of the model context budget.
