# Architecture

## Design rule

The project reproduces observable harness behavior through DSH extension points. It does not impose the paper's four-module source layout on DSH and does not embed the reference Python runtime.

## Execution families

### In-loop adaptations

ReAct, Plan-and-Execute, ReSum, Flash-Searcher, GAM, MemoBrain, AgentFold, HiAgent, and DeepAgent retain the shipped DSH Agent loop. Plugins contribute durable state, prompt sections, scoped tools, request-time policy, and replay-aware surface replacement.

### Coordinators

AggAgent, OAgent, ROMA, and AOrchestra own a run interval that creates DSH child Agents through the subagent or workflow seams. Child transcripts remain isolated Session logs. Only explicit results enter a coordinator or parent Session.

## Logging rule

Anything that changes a later model request must be reconstructable from Session data. Planning, summarization, folding, memory selection, delegation configuration, aggregation, and voting therefore require durable events or ordinary logged messages. Direct auxiliary LLM calls that affect execution are not acceptable unless their input and output are represented by a purpose-built logged lifecycle.

## Fidelity levels

- `mechanism`: the defining state transition or orchestration algorithm is present.
- `behavior`: the Harness completes end-to-end tasks through the same class of control flow as the reference.
- `benchmark`: the implementation is evaluated under matched model, tool, task, and budget settings.

No result may claim a higher fidelity level without evidence for every preceding level.
