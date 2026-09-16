# HiAgent research note

English | [中文](hiagent.zh.md)

## Sources

- Official repository: https://github.com/HiAgent2024/HiAgent at `cebdd8e4eacec1a532ce2c0041db8902217b90ba`. The repository has no root license declaration.
- Inspected official files: `agentboard/agents/ours_agent.py`, `evaluate_model.sh`, and the root README.
- Paper: https://arxiv.org/abs/2408.09559 and the ACL 2025 version at https://aclanthology.org/2025.acl-long.1575/.

## Defining behavior

The checked-in official implementation retains the complete in-trial trajectory internally but sends only a fixed-size sample to the model. It always preserves the first and latest interaction. Middle interactions receive an inverted-Gaussian boundary score plus the novelty of their observation relative to the next middle observation, measured as one minus TF-IDF cosine similarity. The highest-value middle entries fill the remaining slots, while every unselected position remains visible as an `Omitted: Action-Observation pair` placeholder.

The paper describes a broader hierarchical design based on subgoal chunks, observation summaries, and detailed trajectory retrieval. Those mechanisms are not present in the official repository's registered `OurAgent`; its only executable memory policy is value-based trajectory sampling.

## DSH implementation

HiAgent runs the native DSH ReAct loop with one external action per step and no explicit planner. The shared `runtime/tool-episodes.ts` projection helper groups assistant, tool-call, and tool-result Session events into immutable interactions. HiAgent keeps every interaction in its Session projection, reproduces the official TF-IDF and boundary scoring, and replaces the next model surface with the original goal plus selected entries and ordered omission placeholders. The default memory size is 15 and is configurable in `cordis.yml`.

## Shared components

`runtime/tool-episodes.ts` now owns event grouping, explanation extraction, multi-tool aggregation, result capture, and source sequence tracking. AgentFold was refactored onto the same component without changing its public interaction representation. The two Harnesses still own different selection and replacement policies.

## Intentional deviations

- The implementation reproduces the official repository's executable value sampler, not paper-only subgoal summarization and retrieval code that the repository does not provide.
- The official evaluation agent serializes actions into one text prompt and parses one textual action. DSH uses native tool calls and Session events.
- The official code depends on scikit-learn. This implementation calculates the same two-document smooth-IDF cosine weights directly, avoiding a Python runtime dependency.
- The official code includes reward-delta scoring, but all stored rewards are zero, so the term is always zero and is omitted here.
- The official prompt shrinks the sample only once if it exceeds the model window. DSH retains the fixed configured memory size and relies on the profile's context policy; no unlogged token-estimation loop is added.
