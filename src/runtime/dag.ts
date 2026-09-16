/** Minimal dependency node shared by DAG-planned Harnesses. */
export interface DependencyNode {
  readonly id: string
  readonly dependsOn: readonly string[]
}

/** Validate ids, dependency references, and acyclicity for a dependency graph. */
export function assertValidDag(nodes: readonly DependencyNode[]): void {
  const byId = new Map<string, DependencyNode>()
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`duplicate DAG node id: ${node.id}`)
    byId.set(node.id, node)
  }
  for (const node of nodes) {
    const seen = new Set<string>()
    for (const dependency of node.dependsOn) {
      if (dependency === node.id) throw new Error(`DAG node ${node.id} depends on itself`)
      if (seen.has(dependency)) throw new Error(`DAG node ${node.id} repeats dependency ${dependency}`)
      if (!byId.has(dependency)) throw new Error(`DAG node ${node.id} has unknown dependency ${dependency}`)
      seen.add(dependency)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`DAG contains a cycle through ${id}`)
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) visit(id)
}

/** Return unresolved nodes whose dependencies are all complete. */
export function readyDagNodeIds(
  nodes: readonly DependencyNode[],
  completedIds: ReadonlySet<string>,
): readonly string[] {
  return nodes
    .filter(node => !completedIds.has(node.id)
      && node.dependsOn.every(dependency => completedIds.has(dependency)))
    .map(node => node.id)
}
