# GAM research note

English | [中文](gam.zh.md)

## Sources

- Official General Agentic Memory repository: https://github.com/VectorSpaceLab/general-agentic-memory at `565db2cc2518d377e44389b82aecf3cc129d5fe5` (MIT).
- Inspected official files: `research/gam_research/agents/{memory_agent.py,research_agent.py}`, `research/gam_research/schemas/{memory.py,page.py,search.py}`, `research/gam_research/retriever/{bm25.py,dense_retriever.py,index_retriever.py}`, and `research/gam_research/prompts/{memory_prompts.py,research_prompts.py}`.
- Paper: https://arxiv.org/abs/2511.18423.

## Defining behavior

GAM separates lightweight memory from lossless history. The Memorizer generates one concise abstract for each input while retaining the complete input as an immutable page. The Researcher plans retrieval from the abstract catalogue, searches pages through keyword, dense-vector, and direct page-index channels, deduplicates hits, integrates relevant facts, checks whether the result is sufficient, and may issue focused follow-up retrieval requests.

## DSH implementation

GAM composes the implemented Flash-Searcher controller rather than duplicating its DAG planner. Every non-management tool result becomes a complete Session-derived page. When new pages lack abstracts, runtime context advises `gam_memorize_pages`, which accepts exactly one factual, self-contained abstract for every pending page without blocking ordinary task tools. The page id and abstract catalogue are durable projection state reconstructed from tool call/result events.

Every four action steps, runtime context advises a memory-integration pass. `gam_search_pages` supports exact keyword retrieval and direct page ids over full content, and `gam_integrate_memory` records the consolidated factual result and its source page ids. Ordinary task tools remain callable while maintenance is pending. On the following pre-step, the plugin replaces the complete non-system Session surface with a user-role checkpoint containing the exact original task and integrated memory. The raw Session events and page projection remain available for replay and later retrieval even though the model's working history has been reset.

## Shared components

GAM reuses Flash-Searcher's validated DAG, review projection, prompt registry, and five-slot DSH scheduler. Its page projection and explicit search/integration tools establish the common page-store pattern that later memory Harnesses can extend without embedding another Agent loop.

## Intentional deviations

- The original dense channel uses sentence-transformer embeddings and FAISS. This installable TypeScript bundle keeps exact keyword and direct-page retrieval dependency-free; semantic query wording still appears in model-selected keywords, but no embedding model is bundled.
- The original Researcher performs up to three private LLM plan/search/integrate/reflect iterations. DSH exposes search and integration as logged tools, so every model-visible research decision is replayable and the model may iterate until its evidence is sufficient.
- The original creates abstracts in a separate Memorizer call. DSH advises the conversation model to emit the same abstract through a logged tool call after it has observed the complete tool result; maintenance is not a hard gate on task tools.
- The DSH checkpoint retains no raw tail after integration; exact older evidence remains queryable from the durable page projection.
