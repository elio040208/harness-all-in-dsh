# ReAct research note

English | [中文](react.zh.md)

## Sources

- Official repository: https://github.com/ysymyth/ReAct at `6bdb3a1fd38b8188fc7ba4102969fe483df8fdc9` (MIT).
- Inspected implementation: `hotpotqa.ipynb` blob `0bd48a1f559bc19c3de634422240beb5cc6a111e` and `prompts/prompts_naive.json` blob `df9097412ed4f55da903cbb847d9e21c956c9bf0`.
- Paper: https://arxiv.org/abs/2210.03629.

## Defining behavior

The official HotpotQA loop retains the complete prompt trajectory and repeatedly asks the model for a `Thought` followed by one `Action`. The environment executes `Search`, `Lookup`, or `Finish`, appends the resulting `Observation`, and repeats for at most seven iterations.

## DSH implementation

DSH's shipped `ReactLoopAgent` already owns the required request-tool-result cycle and durable full message history. This project therefore does not embed another loop. The ReAct adapter contributes the model policy, serializes tool execution, disables automatic, manual, tool-result, and image compaction, and removes planning, goal, recursive-agent, workflow, and Ralph tools that would change the selected fixed Harness. Ordinary task capabilities such as filesystem, shell, web, and skills remain available.

## Intentional deviations

- Native structured tool calls replace the original textual `Action[...]` parser. Tool results are the observations.
- DSH does not require the model to expose private chain-of-thought text. Provider-native reasoning may remain hidden while the control sequence stays ReAct.
- The original seven-step HotpotQA cap is benchmark-specific. The DSH implementation currently relies on task/runtime budgets rather than imposing that cap globally.
