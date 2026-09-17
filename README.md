# harness-all-in-dsh

English | [中文](README.zh.md)

Reproductions of published Agent Harnesses built as native [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins and Agent presets.

The project currently provides 13 fixed Harnesses. Original papers and official implementations are the primary references; each research note records the inspected revision and intentional differences.

## Why this project

- Run every Harness through supported `dsh` profiles instead of a separate launcher.
- Preserve model-visible plans, summaries, memory transitions, child results, and aggregation results in DSH Session data.
- Reuse the DSH Agent loop, subagent providers, scoped tools, and surface replacement instead of embedding another general-purpose Agent runtime.
- Compare Harnesses under the same model, task, tool, and budget settings.
- Separate implemented mechanism fidelity from future benchmark claims.

## Included Harnesses

| Harness | Core mechanism | DSH implementation |
|---|---|---|
| ReAct | Interleaved reasoning, tool calls, and observations | Native Agent loop with full history |
| Plan-and-Execute | Linear plan followed by execution | Durable plan events and pre-step policy |
| ReSum | Context-pressure summarization and restart | Session surface compaction |
| Flash-Searcher | Dependency DAG and ready-node scheduling | Validated DAG projection and bounded parallel calls |
| GAM | Searchable memory pages and research integration | Durable page projection and retrieval tools |
| MemoBrain | Dependency-aware reasoning graph with flush and fold | Graph projection and surface replacement |
| AggAgent | Independent rollouts and evidence-first aggregation | Isolated child Sessions and trajectory tools |
| OAgent | Heterogeneous experts and critic selection | Child-Agent ensemble and logged critic result |
| AgentFold | Model-directed folding of trajectory ranges | Fold tool and replayable summaries |
| HiAgent | Hierarchical, value-sampled working memory | Full Session history with sampled model surface |
| DeepAgent | Three-tier memory folding and tool search | Memory tools and catalogue search |
| ROMA | Recursive atomize-plan-execute-aggregate control | Recursive child Sessions and dependency DAGs |
| AOrchestra | Runtime-selected instruction, context, tools, and model | Configurable child-Agent controller |

All 13 Harnesses are implemented at mechanism level. Benchmark comparisons require a matched evaluation matrix and are not claimed by this repository.

## Use the Harnesses in DSH Web

Install this repository as a bundle in the `web` profile, then restart DSH Web:

```sh
dsh plugin --profile web add /absolute/path/to/harness-all-in-dsh
dsh web
```

Create a new Session and choose one of the modes whose name starts with `Harness ·`. A Session that already contains messages cannot change its Agent preset.

The presets share Shell, filesystem, search, Skill, and user-question tools. Planning, memory, folding, compaction, and child-Agent behavior come only from the selected Harness. The Web process owns the deployment-wide parallel tool-call limit, so a preset does not override that setting.

Harness tools remain visible throughout a Session, so planning and memory state changes do not rewrite the model-facing tool catalogue. Plan-and-Execute and Flash-Searcher allow workspace inspection and fact gathering before the initial plan; periodic reviews and GAM maintenance are model-visible recommendations. Coordinator Harnesses still reject ordinary task tools because those actions belong to their child Agents. Admission decisions are frozen for one model response, and protocol denials remain in the Session log for diagnostics but do not become task evidence, memory, trajectory entries, or progress counts.

## Run a Harness from the command line

Create a profile from `headless`, install the bundle, and apply the selected Harness overlay:

```sh
dsh --profile harness-react --from-default-profile headless --dump-config
dsh plugin --profile harness-react add /absolute/path/to/harness-all-in-dsh
dsh --profile harness-react --patch /absolute/path/to/harness-all-in-dsh/profiles/react.cordis.patch.yml "your task"
```

Replace `react` with another file name from [`profiles/`](profiles/) to select a different Harness. The headless overlays carry Harness-specific parallel-call limits for reproducible experiments.

Installing from source runs the package `prepare` script. Follow the DSH prompt before allowing the build script for a GitHub installation.

## Documentation

- [Architecture](docs/architecture.md) explains the DSH-native implementation rules and fidelity levels.
- [Research sources](research/SOURCES.md) links every Harness to its paper, official code, inspected revision, and implementation note.
- [`presets/`](presets/) contains the Web-selectable Agent compositions.
- [`profiles/`](profiles/) contains headless experiment overlays.

## Development

```sh
pnpm install
pnpm run check
```

`pnpm run check` runs TypeScript checking, unit tests, and the production build. Real-model experiments require a configured DSH model provider and are separate from the keyless test suite.

## License

This project is licensed under the [MIT License](LICENSE). Upstream projects retain their own licenses; the research notes identify the license observed for each inspected revision.
