# AOrchestra source review

## Upstream

- Repository: <https://github.com/FoundationAgents/AOrchestra>
- Revision: `14a1a2051d6b03c479b706f8f555a60b8419e3b5`
- License: Apache-2.0

## Inspected files

- `README.md`
- `LICENSE`
- `aorchestra/main_agent.py`
- `aorchestra/tools/delegate.py`
- `aorchestra/tools/{complete,submit,trace_formatter}.py`
- `aorchestra/subagents/react_agent.py`
- `aorchestra/prompts/{gaia,terminalbench,swebench}.py`
- `aorchestra/runners/{gaia,terminalbench,swebench}_runner.py`
- `aorchestra/config.py`

## Defining behavior

AOrchestra treats a child Agent as a runtime-created four-tuple `phi = <I,C,T,M>`: a precise subtask instruction, curated prior context, an allowed tool subset, and a selected model. The MainAgent iteratively reviews prior delegation results, creates another specialized tuple for remaining work, or completes the task. Each delegation starts a fresh sub-agent and returns its result plus execution trace information.

## DSH-native mapping and deviations

`aorchestra_delegate` exposes all four tuple fields explicitly. It validates the model against configured choices and tools against the current DSH request catalogue, then starts a fresh DSH child Session with the selected model route, a scoped tool allowlist, a subtask persona, and only the selected context. `aorchestra_complete` records the standalone answer and all delegation metadata in the parent Session result.

Full child trajectories remain in their durable DSH Sessions. The parent receives the child answer, bounded tool-observation summary, stop reason, step count, tuple, and child Session id instead of copying a benchmark-specific serialized trace into its context. DSH owns environment and cost policy; AOrchestra's benchmark runners, model-price table, JSON action loop, and fixed Gemini trace summarizer are not embedded. Model choices, provider route, and delegation limit are explicit plugin configuration.
