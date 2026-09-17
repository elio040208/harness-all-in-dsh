# Architecture

English | [中文](architecture.zh.md)

This project reproduces observable Harness behavior through DSH extension points while keeping the DSH Agent loop, Session log, model routing, and tool runtime as the execution foundation.

## Design rules

- Implement behavior as plugins, projections, scoped tools, and surface policies. Do not embed a second general-purpose Agent runtime.
- Keep every model-visible plan, summary, memory state, delegation choice, and aggregation result reconstructable from Session data.
- Keep invariant Harness policy in system-prompt sections. Materialize changing execution state as durable runtime-context snapshots instead of rewriting the system prompt.
- Keep child work in isolated DSH Sessions and copy only explicit results into a parent Session.
- Expose deployment choices as plugin configuration. Keep model, tool, task, and budget settings outside Harness algorithms.
- Record the inspected upstream revision and every intentional difference in `research/`.

## Execution families

### In-loop adaptations

ReAct, Plan-and-Execute, ReSum, Flash-Searcher, GAM, MemoBrain, AgentFold, HiAgent, and DeepAgent retain the shipped DSH Agent loop. Their plugins contribute stable policy sections, durable state projections and context snapshots, scoped tools, request-time guards, and replay-aware surface replacement.

### Coordinators

AggAgent, OAgent, ROMA, and AOrchestra own a bounded coordination action. They create DSH child Agents through the subagent service, keep each child transcript in its own Session, and persist the selected or aggregated result in the parent.

## Shared components

- `runtime/auxiliary-llm.ts` runs logged Harness-owned model calls with route inheritance and cancellation.
- `runtime/dag.ts` validates dependency graphs and selects ready nodes.
- `runtime/tool-episodes.ts` groups replayed calls and results into complete interactions.
- `runtime/trajectory.ts` projects child Sessions into searchable, bounded trajectories.
- `runtime/subagent-ensemble.ts` owns isolated child creation, tool denial, settlement, and disposal.
- `runtime/prompt.ts` keeps invariant policy in the system prompt and changing Harness state in runtime-context snapshots.
- `runtime/protocol.ts` freezes one Harness phase per model response, derives its runtime context and visible tool set together, and retains guards only as a fallback for calls the model could not see.
- `presets/_shared/agent-tools.cordis.yml` defines the common model-facing tools used by Web presets.

Harness-specific state remains in its owning module until at least two implementations need the same behavior.

## Durability rule

Anything that changes a later model request must be reproducible from Session data. Planning, summarization, folding, memory selection, delegation configuration, aggregation, and voting therefore use durable events, tool results, or plugin-authored messages. A private auxiliary call is acceptable only when its input, route, output, and failure state are represented in the Session lifecycle.

Dynamic context providers derive their text from replayable projection state. DSH logs a new user-role runtime-context snapshot only when that text changes, while the system prompt remains stable across execution-state transitions.

Protocol phases are response-atomic. State produced by one tool call becomes eligible to change admission only at the next prompt assembly, so exclusive barriers and bounded parallel scheduling cannot reject sibling calls that were generated from the same request. Phase changes never filter the model-facing tool catalogue. Planning, review, and memory-maintenance cadence is advisory; coordinator role separation and invalid Harness-management operations remain enforced. Protocol denials stay replayable in the Session log but projections exclude them from task evidence, memory, trajectories, and progress counts.

Surface replacement changes what the model sees; it never deletes the underlying Session events. Replay reconstructs the same working state without rerunning prior model calls.

## Preset ownership

DSH Web mounts each Harness as an Agent preset. Presets share ordinary task capabilities, while the selected Harness owns its planning, memory, compaction, and coordinator behavior. The Web host continues to own process-wide services such as model routing, Session persistence, sandbox policy, subagent providers, and the parallel tool-call limit.

Headless profiles use explicit overlays under `profiles/`. These overlays insert one Harness plugin and apply experiment-specific Agent-loop concurrency.

## Fidelity levels

- `mechanism`: the defining state transition or orchestration algorithm is implemented.
- `behavior`: the Harness completes end-to-end tasks through the same class of control flow as the reference.
- `benchmark`: matched model, tool, task, and budget experiments support a comparative result.

A result must not claim a higher fidelity level without evidence for every preceding level. The current repository claims mechanism-level implementation for all included Harnesses and keeps benchmark conclusions out of the documentation.
