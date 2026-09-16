# OAgent research note

## Sources

- Official OAgents repository: https://github.com/OPPO-PersonalAI/OAgents at `027f2c4579ee7e7767bfe54c66df48a902d43e98` (Apache-2.0).
- Inspected official files: `OAgents/src/oagents/agents.py`, `OAgents/example/oagents_deep_research/run_gaia_tts.py`, and the root README. The official test-time-scaling implementation supplies independent rollouts plus list-wise, scoring, and voting result mergers.
- Papers: https://arxiv.org/abs/2506.15741 and https://arxiv.org/abs/2506.12928.
- JIT HarnessFactory repository: https://github.com/bingreeky/JIT at `ababa06c2f54d799fd9fbc356e5368f61a452260` (Apache-2.0).
- Inspected JIT files: `harness_factory/harnesses/oagent/{memory.py,action.py,planning.py,tool_policy.py,prompt.yaml}` and `harness_factory/descriptions/oagent.md`.

## Defining behavior

The fixed OAgent combines heterogeneous redundancy with an LLM critic. Its default ensemble runs one methodical Plan-and-Execute worker and two adaptive ReAct workers. Each expert receives fresh full history and the complete task-tool catalogue. A final critic sees each answer plus at most five bounded tool observations, evaluates compliance, evidence, logic, and specificity, then selects one named expert while optionally synthesizing a stronger final answer. Invalid critic output falls back to the first expert.

## DSH implementation

One model-facing composite tool runs the entire ensemble and concludes the coordinator turn. It starts three fresh DSH child Agents sequentially through the configured `spawn` provider, gives each its own persona and Session, and denies recursive access to the ensemble tool. The child route inherits the coordinator's provider and model.

The shared Session-to-trajectory projection supplies each expert's final assistant content and the first five complete tool observations. The critic request uses the coordinator's current DSH model route through the shared auxiliary-LLM helper. The tool result persists the bounded critic input, child Session ids and stop reasons, provider/model, raw critic output, parse failure when present, selected expert, and final answer. A successful tool result concludes the parent turn. If the coordinator emits prose instead of invoking the tool, a bounded turn-stopping reminder gives it another opportunity without creating an unbounded loop.

## Shared components

`runtime/subagent-ensemble.ts` now owns fresh child creation, tool denial, result settlement, Session capture, and disposal for coordinator Harnesses. AggAgent was refactored onto this runner. `runtime/trajectory.ts` remains the shared durable representation, while `runtime/auxiliary-llm.ts` supplies the critic call.

## Intentional deviations

- The official OAgents repository exposes general best-of-N and list-wise test-time scaling. This implementation follows the Table 1 fixed adaptation's one PE plus two ReAct experts and evidence-aware JSON critic.
- The JIT adaptation resets a copied filesystem baseline between sequential experts and restores the selected output. DSH isolates conversation state in child Sessions but does not overwrite or roll back the user's shared working tree; doing so inside a plugin could destroy unrelated or concurrent edits. Filesystem side effects therefore remain shared and are disclosed rather than silently reset.
- Experts use native DSH tool calls and standard Agent loops instead of marker-delimited JSON actions and a nested Python loop.
- The reference truncates evidence by characters. The shared DSH trajectory layer applies word-bounded truncation so Unicode text is not cut mid-codepoint.
