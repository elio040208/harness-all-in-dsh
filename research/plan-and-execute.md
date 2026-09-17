# Plan-and-Execute research note

English | [中文](plan-and-execute.zh.md)

## Sources

- Original Plan-and-Act repository: https://github.com/SqueezeAILab/plan-and-act at `534ed56f0d75e3059e54907859b89c901094f293` (Apache-2.0).
- Inspected original files: `plan_and_act/cot/inference/plan.py`, `plan_and_act/cot/inference/act.py`, and `run_plan_and_act.py`.

## Defining behavior

The original Plan-and-Act system separates a planner from an executor. The planner produces a detailed plan before the executor chooses immediate actions from the current observation, task, previous rounds, and plan.

## DSH implementation

The implementation keeps DSH's Agent loop and full Session history. The first model step must call `submit_plan` with 3-7 ordered steps; a tool guard blocks task tools until that succeeds. The successful tool call and result are ordinary durable Session events. A host projection folds those events into the active roadmap, counts completed action steps, and restores the same state on resume. At the configured interval (eight by default), the guard requires `record_progress` before another task action. A runtime-context snapshot renders the replayed roadmap and latest summary only when that state changes; the system policy remains stable.

## Shared components

Plan-and-Execute reuses the prompt registration helper introduced by ReAct and the common fixed-harness bundle that removes unrelated DSH planning, compaction, and recursive-control mechanisms. Later roadmap-based Harnesses can reuse the replayable projection and management-tool pattern without copying an Agent loop.

## Intentional deviations

- Planner and executor use the same configured DSH model rather than separately trained planner and actor checkpoints.
- Structured DSH tool calls replace tagged text or JSON repair. Invalid roadmap and summary arguments fail through tool validation and remain visible as tool errors.
- The roadmap call sees the normal DSH tool schemas. A guard enforces the planner/executor phase boundary even though schemas remain stable for request-cache compatibility.
- The global step limit remains deployment-owned; this adapter does not force an answer after a fixed count.
