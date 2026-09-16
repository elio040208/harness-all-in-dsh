/** Stable ids for the fixed Harness reproduction targets. */
export type HarnessId =
  | 'react'
  | 'plan-and-execute'
  | 'resum'
  | 'flash-searcher'
  | 'gam'
  | 'memobrain'
  | 'aggagent'
  | 'oagent'
  | 'agentfold'
  | 'hiagent'
  | 'deepagent'
  | 'roma'
  | 'aorchestra'

/** DSH execution ownership used by one Harness reproduction. */
export type ExecutionFamily = 'in-loop' | 'coordinator'

/** One research target and its defining implementation mechanism. */
export interface HarnessDefinition {
  readonly id: HarnessId
  readonly displayName: string
  readonly family: ExecutionFamily
  readonly mechanism: string
  readonly primarySource: string
}

/** The complete, ordered fixed Harness reproduction catalogue. */
export const HARNESS_CATALOG = [
  { id: 'react', displayName: 'ReAct', family: 'in-loop', mechanism: 'full-history tool loop', primarySource: 'https://arxiv.org/abs/2210.03629' },
  { id: 'plan-and-execute', displayName: 'Plan-and-Execute', family: 'in-loop', mechanism: 'linear roadmap followed by execution', primarySource: 'https://github.com/SqueezeAILab/plan-and-act' },
  { id: 'resum', displayName: 'ReSum', family: 'in-loop', mechanism: 'token-triggered context summarization', primarySource: 'https://github.com/Alibaba-NLP/DeepResearch/tree/main/WebAgent/WebResummer' },
  { id: 'flash-searcher', displayName: 'Flash-Searcher', family: 'in-loop', mechanism: 'DAG planning and ready-node scheduling', primarySource: 'https://github.com/OPPO-PersonalAI/Flash-Searcher' },
  { id: 'gam', displayName: 'GAM', family: 'in-loop', mechanism: 'retrievable memory pages and research integration', primarySource: 'https://github.com/VectorSpaceLab/general-agentic-memory' },
  { id: 'memobrain', displayName: 'MemoBrain', family: 'in-loop', mechanism: 'dependency-aware reasoning graph with flush and fold', primarySource: 'https://github.com/qhjqhj00/MemoBrain' },
  { id: 'aggagent', displayName: 'AggAgent', family: 'coordinator', mechanism: 'isolated rollouts with trajectory-tool aggregation', primarySource: 'https://arxiv.org/abs/2604.11753' },
  { id: 'oagent', displayName: 'OAgent', family: 'coordinator', mechanism: 'heterogeneous expert ensemble and critic vote', primarySource: 'https://github.com/OPPO-PersonalAI/OAgents' },
  { id: 'agentfold', displayName: 'AgentFold', family: 'in-loop', mechanism: 'model-directed folding of trajectory ranges', primarySource: 'https://github.com/Alibaba-NLP/DeepResearch/tree/main/WebAgent/AgentFold' },
  { id: 'hiagent', displayName: 'HiAgent', family: 'in-loop', mechanism: 'hierarchical value-sampled working memory', primarySource: 'https://github.com/HiAgent2024/HiAgent' },
  { id: 'deepagent', displayName: 'DeepAgent', family: 'in-loop', mechanism: 'three-tier memory folding and tool search', primarySource: 'https://github.com/RUC-NLPIR/DeepAgent' },
  { id: 'roma', displayName: 'ROMA', family: 'coordinator', mechanism: 'recursive atomize-plan-execute-aggregate control', primarySource: 'https://github.com/sentient-agi/ROMA' },
  { id: 'aorchestra', displayName: 'AOrchestra', family: 'coordinator', mechanism: 'runtime-configured sub-agent delegation', primarySource: 'https://github.com/FoundationAgents/AOrchestra' },
] as const satisfies readonly HarnessDefinition[]

/** Resolve one Harness definition by stable id. */
export function harnessById(id: HarnessId): HarnessDefinition {
  const definition = HARNESS_CATALOG.find(candidate => candidate.id === id)
  if (definition === undefined) throw new Error(`unknown Harness id: ${id}`)
  return definition
}
