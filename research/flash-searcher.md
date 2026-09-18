# Flash-Searcher research note

English | [中文](flash-searcher.zh.md)

## Sources

- Official Flash-Searcher repository: https://github.com/OPPO-PersonalAI/Flash-Searcher at `844f51f70dd641647760d90dbb027d0d45c111f0` (Apache-2.0).
- Inspected official files: `FlashOAgents/agents.py`, `FlashOAgents/memory.py`, `FlashOAgents/agent_types.py`, `FlashOAgents/prompts/default/toolcalling_agent.yaml`, `base_agent.py`, `run_flash_searcher.py`, and `README.md`.
- Paper: https://arxiv.org/abs/2509.25301.

## Defining behavior

Flash-Searcher begins with a dedicated planning call that decomposes the task into one to five goals and one to five candidate paths per goal. Goals should advance in parallel, while paths inside one goal are sequential fallbacks with explicit success criteria. The ReAct loop may issue up to five tool calls for independent goals in one action. Every eight steps by default, a separate model call analyzes each goal and path, marks progress, adjusts blocked paths, and supplies the next parallel sub-paths. Full history retains the plan, actions, observations, and periodic reviews.

The paper describes a dependency DAG and aggressive parallel scheduling. The public repository's shipped execution loop currently runs multiple calls sequentially; its `ThreadPoolExecutor` implementation is present but commented out, and the README directs users to enable it when tool capacity permits. This reproduction uses DSH's bounded native parallel scheduler instead.

## DSH implementation

The model calls `submit_dag_plan` early after any task inspection needed to define concrete goals. Its structured graph contains stable goal ids, explicit dependencies, and ordered fallback paths. Validation rejects duplicate ids, missing dependencies, repeated or self dependencies, and cycles. A Session projection commits the graph only after the tool succeeds and reconstructs it on replay. A runtime-context snapshot derives ready goals from dependency completion and shows every path's success criterion without changing the system policy.

The profile raises `agent-loop.maxParallelToolCalls` to five. The model may therefore emit independent calls for different ready goals in one response, and DSH schedules them concurrently while preserving durable call/result pairing. `record_dag_review` records every goal after a status or active-path transition so completed prerequisites unlock dependents. Every configured eight action steps, runtime context advises a complete graph review without blocking task tools. A successful review updates the ready set and the current per-goal directive.

## Shared components

`src/runtime/dag.ts` owns dependency validation and ready-node selection without Flash-Searcher-specific prompt or state assumptions. AgentFold and recursive planners can reuse those functions. The Harness also reuses the common prompt registry, management-tool guard pattern, Session projection, and DSH tool scheduler.

## Intentional deviations

- Structured DSH tool arguments replace the original free-form Markdown plan, making graph dependencies and replay state machine-checkable.
- Periodic review is emitted through a guarded model-visible tool call rather than an extra private model request. The review and its acceptance are therefore explicit Session events.
- DSH permits task inspection before DAG submission and advises rather than forces periodic reviews. This supports tasks whose dependency graph requires initial filesystem evidence and avoids replacing task observations with protocol errors, but it is weaker than the reference controller's dedicated planning and review calls.
- DSH executes independent calls concurrently; the pinned public Python entry point executes them sequentially unless its commented parallel block is enabled.
- The deployment owns the global step limit and forced-answer policy.
