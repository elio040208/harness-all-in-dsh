# ROMA source review

## Upstream

- Repository: <https://github.com/sentient-agi/ROMA>
- Revision: `a6e3bb4f9e0694375fa627fa4b8bf8cae50592a6`
- License: no `LICENSE`, `COPYING`, or package license declaration was present at the inspected revision. This project does not copy ROMA source.

## Inspected files

- `README.md`
- `src/roma_dspy/core/engine/solve.py`
- `src/roma_dspy/core/engine/dag.py`
- `src/roma_dspy/core/engine/scheduler.py`
- `src/roma_dspy/core/engine/runtime.py`
- `src/roma_dspy/core/modules/{atomizer,planner,aggregator}.py`
- `src/roma_dspy/core/signatures/signatures.py`
- `src/roma_dspy/core/signatures/base_models/{task_node,subtask}.py`
- `prompt_optimization/prompts/seed_prompts/{planner,aggregator}_seed.py`

## Defining behavior

ROMA represents work as immutable task nodes in nested dependency DAGs. Every node is atomized into either `EXECUTE` or `PLAN`. Planned children are recursively atomized, dependency-ready children can run concurrently, and dependent children receive predecessor results. Reaching the configured recursion depth forces execution. An aggregator synthesizes completed children into the parent result, so information flows top-down through goals and bottom-up through results.

## DSH-native mapping and deviations

`roma_solve` is the single parent coordinator action. Atomizer, planner, and aggregator calls use the parent conversation's routed DSH model. Atomic nodes run as isolated DSH child Sessions with scoped tools. The parent tool result persists the complete recursive tree, decisions, dependency plans, child Session ids, and aggregate results.

The implementation does not embed DSPy, NetworkX, ROMA storage, checkpoint, MLflow, REST, or TUI layers. It uses DSH Session durability and the shared DAG validator instead. Node, depth, fan-out, concurrency, and auxiliary-token limits are explicit plugin configuration. The optional ROMA verifier is not part of the Table 1 harness mechanism and is omitted.
