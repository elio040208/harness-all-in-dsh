# OAgent research note

English | [中文](oagent.zh.md)

## Sources

- Official OAgents repository: https://github.com/OPPO-PersonalAI/OAgents at `027f2c4579ee7e7767bfe54c66df48a902d43e98` (Apache-2.0).
- Inspected official files: `OAgents/src/oagents/agents.py`, `OAgents/example/oagents_deep_research/run_gaia_tts.py`, and the root README. The official test-time-scaling implementation supplies independent rollouts plus list-wise, scoring, and voting result mergers.
- Papers: https://arxiv.org/abs/2506.15741 and https://arxiv.org/abs/2506.12928.

## Defining behavior

The official BON path performs repeated independent runs of the same configured Agent. Each rollout starts from the same task state, creates its own initial planning step, and executes until it returns an answer or reaches the step limit. Rollouts run sequentially. The list-wise result merger receives every complete trajectory, selects one candidate index, and returns that rollout's answer without synthesizing a replacement. The reference GAIA command uses four rollouts.

## DSH implementation

One model-facing composite tool runs the complete BON path and concludes the coordinator turn. It starts four same-configuration DSH child Agents sequentially through the configured `spawn` provider. Every rollout receives the same task and tools, uses a planning-first rollout persona, owns an isolated Session, and cannot recursively call the ensemble tool. The child route inherits the coordinator's provider and model.

The shared Session-to-trajectory projection supplies each complete rollout and its final assistant content. The list-wise judge uses the coordinator's current DSH model route through the shared auxiliary-LLM helper and may return only a rollout number. The selected answer is copied unchanged from that rollout. The tool result persists the complete judge input records, child Session ids and stop reasons, provider/model, raw judge output, parse failure when present, selected rollout, and final answer. A successful tool result concludes the parent turn. If the coordinator emits prose instead of invoking the tool, a bounded turn-stopping reminder gives it another opportunity without creating an unbounded loop.

## Shared components

`runtime/subagent-ensemble.ts` now owns fresh child creation, tool denial, result settlement, Session capture, and disposal for coordinator Harnesses. AggAgent was refactored onto this runner. `runtime/trajectory.ts` remains the shared durable representation, while `runtime/auxiliary-llm.ts` supplies the critic call.

## Intentional deviations

- DSH isolates conversation state in child Sessions but does not overwrite or roll back the user's shared working tree; doing so inside a plugin could destroy unrelated or concurrent edits. Filesystem side effects therefore remain shared and are disclosed rather than silently reset.
- Experts use native DSH tool calls and standard Agent loops instead of marker-delimited JSON actions and a nested Python loop.
- The official runtime creates a dedicated planning message before each rollout. DSH expresses the same planning-first policy in the child persona while retaining the native Agent loop.
