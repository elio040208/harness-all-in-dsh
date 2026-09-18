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

`aorchestra_delegate` exposes all four tuple fields. As in the official tool, instruction and model are required while context and tools are optional; omitting tools leaves the child catalogue unfiltered. Provided model and tool choices are validated against the configured choices and current DSH request catalogue. The tool then starts a fresh DSH child Session with the selected model route, optional scoped tool allowlist, subtask persona, and selected context. `aorchestra_complete` accepts the official answer-only payload and records the standalone answer plus all delegation metadata in the parent Session result. The coordinator prompt encourages delegation, but completion is not guarded by an extra call-order requirement absent from the official tool.

## Shared components

AOrchestra uses the DSH subagent service for isolated children and reuses the shared trajectory projection for child answers, tool observations, stop reasons, and step counts.

## Intentional deviations

Full child trajectories remain in their durable DSH Sessions. The parent receives the child answer, bounded tool-observation summary, stop reason, step count, tuple, and child Session id instead of copying a benchmark-specific serialized trace into its context. DSH owns environment and cost policy; AOrchestra's benchmark runners, model-price table, JSON action loop, and fixed Gemini trace summarizer are not embedded. Model choices, provider route, and delegation limit are explicit plugin configuration.
