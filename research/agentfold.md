# AgentFold research note

English | [中文](agentfold.zh.md)

## Sources

- Official DeepResearch repository: https://github.com/Alibaba-NLP/DeepResearch at `f72f75d8c3eb842f2bbbab096a12206ff66e270f` (Apache-2.0).
- Inspected official files: `WebAgent/AgentFold/infer.py`, `WebAgent/AgentFold/serve.sh`, the root README, and the root license.
- Paper: https://arxiv.org/abs/2510.24699, especially Sections 3.1–3.3.
- JIT HarnessFactory repository: https://github.com/bingreeky/JIT at `ababa06c2f54d799fd9fbc356e5368f61a452260` (Apache-2.0).
- Inspected JIT files: `harness_factory/harnesses/agentfold/{memory.py,action.py,planning.py,tool_policy.py,prompt.yaml}` and `harness_factory/descriptions/agentfold.md`.

## Defining behavior

AgentFold divides its model context into the invariant question, tool catalogue, multi-scale state summaries, and one latest interaction retained at full fidelity. At every non-initial intermediate step the model chooses a contiguous folding range ending at the latest interaction and writes its replacement summary while also choosing the next external action. Folding only the latest interaction performs granular condensation. Starting at an older active summary boundary deeply consolidates that summary suffix plus the latest interaction. The resulting summary blocks always partition all history before the next latest interaction.

The official runtime formats older blocks as `[Compressed Step N]` or `[Compressed Step N to M]` and the latest interaction as `[Step N]`. Its checked-in inference code executes one search or visit action per turn and applies the fold before appending that turn's new full interaction.

## DSH implementation

The native Agent loop remains responsible for model requests and external tools. `agentfold_fold` represents the folding directive as a logged DSH tool call. After the first interaction, the prompt asks the model to emit that fold call and one external task call in the same response. The profile therefore allows two parallel calls; the fold transition only reads the previous completed workspace, so result arrival order cannot change its meaning.

A Session projection groups every completed non-management tool step into one immutable full-fidelity interaction. Successful fold results validate that the range ends at the latest interaction and starts at an active summary boundary, then replace the selected summary suffix with one block. Before the next model request, a plugin-authored checkpoint replaces the non-system surface with the original question, ordered summaries, and newest full interaction. The Session event log retains every raw assistant message, tool call, result, fold directive, and replaced event sequence.

## Shared components

AgentFold reuses the project's prompt registry and content extraction helpers. Its contiguous partition validator and two-level workspace are specific to AgentFold; no premature common memory abstraction was introduced. HiAgent and DeepAgent will be compared against this implementation before any genuinely shared surface-folding component is extracted.

## Intentional deviations

- The JIT adaptation combines AgentFold with Flash-Searcher DAG planning and periodic eight-step replanning. Neither the paper nor the official AgentFold runtime does so, so this implementation omits that hybrid layer.
- The official model emits custom `<compress>`, `<motivation>`, and `<tool_call>` text in one completion. DSH expresses the same fold/action decision through two native tool calls, preserving validation, Session logging, and ordinary tool presentation.
- The official runtime is specialized to `search` and `visit`. The DSH reproduction exposes the current profile's task tools while retaining the one-external-action-per-interaction instruction.
- The original code does not validate that a fold ends at the latest interaction even though its comment and paper require it. This implementation enforces the published invariant and rejects ranges that split an active summary block.
- Final answers do not require a last fold because no subsequent model request consumes that workspace; the official inference path likewise returns before applying a fold when it detects an answer.
