# ROMA research note

English | [中文](roma.zh.md)

## Sources

- Repository: <https://github.com/sentient-agi/ROMA>
- Revision: `a6e3bb4f9e0694375fa627fa4b8bf8cae50592a6`
- License: no `LICENSE`, `COPYING`, or package license declaration was present at the inspected revision. This project does not copy ROMA source.

- Inspected files: `README.md`; engine `solve.py`, `dag.py`, `scheduler.py`, and `runtime.py`; atomizer, planner, and aggregator modules; task and subtask models; and planner and aggregator seed prompts.

## Defining behavior

ROMA represents work as immutable task nodes in nested dependency DAGs. Every node is atomized into either `EXECUTE` or `PLAN`. Planned children are recursively atomized, dependency-ready children can run concurrently, and dependent children receive predecessor results. Reaching the configured recursion depth forces execution. An aggregator synthesizes completed children into the parent result, so information flows top-down through goals and bottom-up through results.

## DSH implementation

`roma_solve` is the single parent coordinator action. Atomizer, planner, and aggregator calls use the parent conversation's routed DSH model. The Atomizer returns the official `is_atomic` and `PLAN` or `EXECUTE` outputs without assigning a task type. The Planner assigns one of ROMA's five task types, and that type follows the child through recursive atomization and execution; the root uses ROMA's `THINK` default. Atomic nodes run as isolated DSH child Sessions with scoped tools. The parent tool result persists the complete recursive tree, decisions, task types, dependency plans, child Session ids, and aggregate results.

## Shared components

ROMA reuses `runtime/dag.ts` for dependency validation and ready-node selection, uses the DSH subagent service for atomic nodes, and records the complete task tree through Session data.

## Intentional deviations

The implementation does not embed DSPy, NetworkX, ROMA storage, checkpoint, MLflow, REST, or TUI layers. It uses DSH Session durability and the shared DAG validator instead. Node, depth, fan-out, concurrency, and auxiliary-token limits are explicit plugin configuration. The optional ROMA verifier is outside the fixed Harness mechanism and is omitted.
