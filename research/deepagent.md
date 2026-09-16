# DeepAgent research note

English | [中文](deepagent.zh.md)

## Sources

- Official repository: https://github.com/RUC-NLPIR/DeepAgent at `2e25aba3326295fff41fe1216792af353bb98558` (MIT).
- Inspected official files: `src/run_deep_agent.py`, `src/prompts/prompts_deepagent.py`, `src/run_tool_search_server.py`, the root README, and license.
- Paper: https://arxiv.org/abs/2510.21618.
- JIT HarnessFactory repository: https://github.com/bingreeky/JIT at `ababa06c2f54d799fd9fbc356e5368f61a452260` (Apache-2.0).
- Inspected JIT files: `harness_factory/harnesses/deepagent/{memory.py,action.py,planning.py,tool_policy.py,prompt.yaml}` and `harness_factory/descriptions/deepagent.md`.

## Defining behavior

DeepAgent interleaves unrestricted reasoning with exactly one of three actions: an external tool call, tool discovery, or thought folding. Thought folding is model-initiated and generates episodic, working, and tool memories in parallel through an auxiliary model. The runtime then rebuilds the original task prompt with those memories and discards the prior active reasoning surface. Episodic memory records milestones and progress, working memory records the immediate goal and next actions, and tool memory records successful parameters, failure modes, response patterns, and derived rules. The official default permits at most three folds.

Tool discovery searches a potentially very large catalogue and returns bounded detailed schemas. Exact duplicate searches and external tool calls are rejected. The official runtime also uses an auxiliary model to shorten large tool responses before returning them to the reasoning stream.

## DSH implementation

The main model remains on the native DSH loop with one tool call per step. `deepagent_fold_thoughts` captures all interactions since the prior fold, launches the three memory calls concurrently through the current model route, and returns their raw outputs plus provider/model and source interaction ids in the logged tool result. A Session projection validates and persists each completed fold. Before the next model request, the plugin replaces the non-system surface with the original task and the three memories; the complete raw trajectory remains in Session events and the shared tool-episode projection.

`deepagent_tool_search` reads the exact model-facing tool schemas from the current request header, ranks names, descriptions, and parameter schemas by query-term matches, and returns a bounded catalogue. Exact duplicate searches and ordinary tool calls are rejected from projected Session state.

## Shared components

DeepAgent uses `runtime/tool-episodes.ts` for the same lossless interaction grouping used by AgentFold and HiAgent. It uses `runtime/auxiliary-llm.ts` for all three memory calls. The fold-specific prompts, state transition, tool search, and reset checkpoint remain owned by DeepAgent.

## Intentional deviations

- The official open-set retriever uses a separately served embedding model and an auxiliary selection pass. This standalone DSH plugin has no fixed external retriever deployment, so it searches the actual request-header catalogue deterministically. All tools remain natively callable; search is an explicit discovery aid rather than a hidden availability gate.
- Native DSH tool calls replace DeepAgent's marker parser and stop-token protocol. The profile's one-call limit preserves the same one-action-per-step behavior.
- The official runtime may summarize verbose tool responses through two extra auxiliary calls. DSH's existing tool presentation, spill, and result policies own output transport; this plugin does not intercept or overwrite another tool's durable result.
- The official fold memories are requested as JSON but tolerate extraction fallbacks. DSH stores the raw non-empty auxiliary outputs so no generated memory is silently discarded by a parser.
