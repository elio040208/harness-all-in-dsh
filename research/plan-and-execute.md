# Plan-and-Execute research note

English | [中文](plan-and-execute.zh.md)

## Sources

- Original Plan-and-Act repository: https://github.com/SqueezeAILab/plan-and-act at `534ed56f0d75e3059e54907859b89c901094f293` (Apache-2.0).
- Inspected original files: `plan_and_act/cot/inference/plan.py`, `plan_and_act/cot/inference/act.py`, and `run_plan_and_act.py`.

## Defining behavior

The original Plan-and-Act system separates a planner from an executor. The planner produces a detailed plan before the executor chooses immediate actions from the current observation, task, previous rounds, and plan.

## DSH implementation

The implementation keeps DSH's Agent loop and full Session history. The model calls `submit_plan` early with a detailed ordered roadmap after any task inspection needed to make it concrete. The official planner does not impose a fixed number of roadmap items, so the tool accepts any non-empty sequence. The successful tool call and result are ordinary durable Session events. A host projection folds those events into the active roadmap, counts completed action steps, and restores the same state on resume. At the configured interval (eight by default), runtime context advises `record_progress`; task tools remain callable. A runtime-context snapshot renders the replayed roadmap and latest summary only when that state changes; the system policy remains stable.

## Shared components

Plan-and-Execute reuses the prompt registration helper introduced by ReAct and the common fixed-harness bundle that removes unrelated DSH planning, compaction, and recursive-control mechanisms. Later roadmap-based Harnesses can reuse the replayable projection and management-tool pattern without copying an Agent loop.

## Intentional deviations

- Planner and executor use the same configured DSH model rather than separately trained planner and actor checkpoints.
- Structured DSH tool calls replace tagged text or JSON repair. Invalid roadmap and summary arguments fail through tool validation and remain visible as tool errors.
- The original planner runs before the executor. DSH permits task inspection before roadmap submission because filesystem and repository tasks often require observations before a concrete plan can be written; this weakens the original phase boundary but keeps the tool catalogue stable.
- The original planner/executor controller owns progress updates. DSH represents periodic progress as an advised logged tool call instead of blocking another task action when the model omits it.
- The global step limit remains deployment-owned; this adapter does not force an answer after a fixed count.
