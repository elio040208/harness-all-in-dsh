# MemoBrain research note

## Sources

- Official MemoBrain repository: https://github.com/qhjqhj00/MemoBrain at `82f16e17c28313a57bf95d83340142b96507f3d1` (Apache-2.0).
- Inspected official files: `src/{memobrain.py,problem_tree.py,prompts.py,schema.py}` and `examples/{react_with_memory.py,memory_snapshot.json}`.
- Paper: https://arxiv.org/abs/2601.08079.
- JIT HarnessFactory repository: https://github.com/bingreeky/JIT at `ababa06c2f54d799fd9fbc356e5368f61a452260` (Apache-2.0).
- Inspected JIT files: `harness_factory/harnesses/memobrain/{memory.py,planning.py,action.py,tool_policy.py,prompt.yaml}` and `harness_factory/descriptions/memobrain.md`.

## Defining behavior

MemoBrain runs a direct ReAct loop without an explicit plan. A separate memory model passively consumes every complete assistant/tool-response episode and adds task, subtask, or evidence nodes plus rationale-bearing dependency edges to a reasoning graph. When the working history exceeds its memory budget, another memory-model call selects invalid or superseded nodes to flush and completed paths to fold into summary nodes. The reconstructed context protects the initial three and latest four messages.

## DSH implementation

The DSH agent loop remains the sole task executor. A Session projection groups each assistant response, tool call, and tool result into a complete episode. Before the next task step, an auxiliary call through the conversation's routed provider writes a validated graph patch. Its provider, model, raw output, parsed patch, and failure state are persisted in a plugin-authored Session message, so replay reconstructs exactly the same graph without rerunning the memory model.

At 25% of the routed model's context window, the token-meter measurement triggers a second auxiliary call that selects flush and fold operations. Flush marks redundant nodes inactive. Fold creates a summary node, transfers the covered event references, removes internal edges, and rewires incoming and outgoing dependencies as in the original `ReasoningGraph.fold_nodes`. DSH then replaces the non-system surface with the original task, the optimized graph, and a transcript projection of the earliest three and latest four user, assistant, call, or result events. Runtime instruction injections and memory-maintenance records stay out of this protected transcript. The immutable raw Session log remains available.

## Shared components

`runtime/auxiliary-llm.ts` centralizes route inheritance, streaming assembly, cancellation, finish validation, and text extraction for Harness-owned model calls. `runtime/content.ts` provides the common replay-safe content projection now shared with GAM. Later graph- and hierarchy-based Harnesses can reuse both components.

## Intentional deviations

- The original uses an absolute 32K-token memory threshold. DSH configures a provider-portable ratio, defaulting to 25% of the routed model's declared context window.
- The original rebuilds an OpenAI message list and keeps its first three and last four entries verbatim. DSH writes one explicit checkpoint containing the exact original task, optimized graph, and text projections of the earliest three and latest four non-system surface events; structured raw events remain in Session.
- The original examples use marker-delimited tool calls. DSH retains native structured tool calls and the standard agent loop; only the executive-memory behavior is reproduced.
