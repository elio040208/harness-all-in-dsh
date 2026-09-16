# AggAgent research note

## Sources

- Official AggAgent repository: https://github.com/princeton-pli/AggAgent at `9638f7d88aee01eb636c02841e13a05bb2e3c449` (MIT).
- Inspected official files: `aggagent/{agent.py,tools.py,prompts.py}`, `aggregation/_strategy/aggagent.py`, rollout entry points, and README usage.
- Paper: https://arxiv.org/abs/2604.11753.
- JIT HarnessFactory repository: https://github.com/bingreeky/JIT at `ababa06c2f54d799fd9fbc356e5368f61a452260` (Apache-2.0).
- Inspected JIT files: `harness_factory/harnesses/aggagent/{memory.py,action.py,planning.py,tool_policy.py,prompt.yaml}` and `harness_factory/descriptions/aggagent.md`.

## Defining behavior

AggAgent first creates independent full tool-using rollouts, then gives a separate aggregation agent a compact catalogue instead of concatenating every transcript into its prompt. The aggregator retrieves final solutions, searches an individual trajectory using ROUGE-L recall, opens a contiguous segment of at most five steps, and submits a standalone solution through a validated finish tool. Raw environment observations outrank rollout reasoning, and agreement among rollouts is not treated as evidence by itself.

## DSH implementation

The coordinator launches four fresh DSH child Agents concurrently through the `spawn` subagent provider. Every rollout has an isolated Session, inherits the parent model route, receives the task as a standalone prompt, and retains ordinary task tools while the four aggregator tools are denied. The parent Session catalog records child Session ids, while one logged plugin message records terminal status, step counts, and compact metadata.

The aggregator stays inside the standard DSH Agent loop. Rollouts run in the first pre-step, before the aggregation model receives a request, and their Session ids, terminal status, and compact metadata enter the parent as one logged plugin message. The aggregator's four tools reproduce the official `get_solution`, `search_trajectory`, `get_segment`, and `finish` operations. A shared trajectory component projects structured assistant calls and tool results from child Session events, implements query-token ROUGE-L recall, truncates search snippets to 150 words and segments to 600 words, limits segment reads to five steps, and produces approximate token/tool metadata. When final solutions differ, `finish` is rejected until the aggregator inspects raw trajectory evidence. A successful finish validates the required `<explanation>` and `<answer>` sections and concludes the parent turn.

## Shared components

`runtime/trajectory.ts` is the common child-Session projection and inspection layer for coordinator Harnesses. OAgent, ROMA, and AOrchestra can reuse the durable trajectory representation, metadata, final-result retrieval, ranked search, and bounded segment reads while supplying different scheduling and adjudication policies.

## Intentional deviations

- The official evaluation pipeline generates rollout files before starting AggAgent. DSH performs that phase automatically in the parent Agent's first pre-step so generation and aggregation occur in one logged Session run.
- The official aggregator can execute up to 100 private LLM iterations. DSH uses the configured standard Agent-loop limits so provider budgets and cancellation remain deployment-owned.
- The official code supports special long-form and Qwen finish formats. This Table 1 reproduction implements the default XML solution format used by the general aggregation path.
- The JIT adaptation runs rollouts sequentially. This implementation follows the paper and official parallel-scaling design by launching isolated children concurrently.
