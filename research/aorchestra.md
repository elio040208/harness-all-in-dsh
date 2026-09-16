# AOrchestra research note

English | [中文](aorchestra.zh.md)

## Sources

- Repository: <https://github.com/FoundationAgents/AOrchestra>
- Revision: `14a1a2051d6b03c479b706f8f555a60b8419e3b5`
- License: Apache-2.0

- Inspected files: `README.md`, `LICENSE`, `main_agent.py`, delegation and completion tools, the ReAct subagent, GAIA/TerminalBench/SWE-bench prompts and runners, and configuration.

## Defining behavior

AOrchestra treats a child Agent as a runtime-created four-tuple `phi = <I,C,T,M>`: a precise subtask instruction, curated prior context, an allowed tool subset, and a selected model. The MainAgent iteratively reviews prior delegation results, creates another specialized tuple for remaining work, or completes the task. Each delegation starts a fresh sub-agent and returns its result plus execution trace information.

## DSH implementation

`aorchestra_delegate` exposes all four tuple fields explicitly. It validates the model against configured choices and tools against the current DSH request catalogue, then starts a fresh DSH child Session with the selected model route, a scoped tool allowlist, a subtask persona, and only the selected context. `aorchestra_complete` records the standalone answer and all delegation metadata in the parent Session result.

## Shared components

AOrchestra uses the DSH subagent service for isolated children and reuses the shared trajectory projection for child answers, tool observations, stop reasons, and step counts.

## Intentional deviations

Full child trajectories remain in their durable DSH Sessions. The parent receives the child answer, bounded tool-observation summary, stop reason, step count, tuple, and child Session id instead of copying a benchmark-specific serialized trace into its context. DSH owns environment and cost policy; AOrchestra's benchmark runners, model-price table, JSON action loop, and fixed Gemini trace summarizer are not embedded. Model choices, provider route, and delegation limit are explicit plugin configuration.
