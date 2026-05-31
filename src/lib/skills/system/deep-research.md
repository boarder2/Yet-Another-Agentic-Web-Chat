---
name: deep-research
description: How to invoke the deep_research tool effectively — scoping the task, what the subagent can and cannot do, parallelization, and how to use the returned findings. Load this when the user is asking for a research-heavy investigation that will require reading multiple sources rather than a single fact lookup.
---

# Using the `deep_research` tool

`deep_research` spawns an independent research **subagent** that goes deep on **one focused topic** and returns a comprehensive write-up plus citations.

## What happens when you call it

1. A new subagent is launched with its own conversation. It does **not** see your full chat history — only the `task` string you pass plus a small slice of recent context.
2. The subagent has its own web-research tool set (see below) and runs up to ~10 turns / 8 web searches.
3. It returns:
   - A textual `summary` of its findings (placed into a ToolMessage you'll see).
   - A set of `relevantDocuments` (with citations) that are merged into your main retrieval context — you can cite them in your final answer.

Token usage is forwarded back to your run, so each call is roughly the cost of an extra small agent run.

## Tools the subagent has

- `web_search` — open web search
- `url_fetch` — retrieve full page contents
- `image_search` / `image_analysis`
- `pdf_loader`

It does **not** have: `code_execution`, `ask_user`, `create_chart`, `file_search`, `deep_research` itself (no recursion), or access to your local files/uploads. If the task depends on any of those, extract what's needed yourself first and inline the relevant data into the `task` string.

## Writing the `task`

This is the single most important thing. The subagent has **no context** beyond what you write here.

A good task statement contains:

1. **The specific question or scope.** What you want answered or compiled.
2. **Why / how the answer will be used.** Helps the subagent judge what depth and structure to deliver.
3. **Boundaries.** What's explicitly out of scope, time windows, geographies, formats.
4. **Preferred sources or anti-sources** when relevant ("prefer primary sources", "skip Reddit/Quora").
5. **Output shape.** "Return a table of …", "Return a bullet list of vendor, price, latency", "Return a 3-paragraph narrative with citations".

### Good vs bad examples

**Too vague (don't do this):**

> "Research climate policy"

**Better:**

> "Compile every binding emissions-reduction commitment made by G7 nations between 2023-01 and 2026-05. For each: country, commitment text (paraphrased OK), target year, baseline year, and the legal instrument it sits in (treaty/law/executive order). Prefer government primary sources and official press releases over news commentary. Return as a structured list grouped by country. Used to populate a comparison table in a policy brief."

**Vague:**

> "Find the best vector database"

**Better:**

> "Evaluate Pinecone, Qdrant, Weaviate, Milvus, and pgvector for a Node.js app with ~10M embeddings, p95 latency target <50ms, and self-hosting required (no SaaS). For each, summarize: licensing, self-host story, indexing algorithms supported, memory/disk tradeoffs, benchmark numbers if published since 2024, and known gotchas. Return as a per-product section followed by a one-paragraph recommendation."

### Task hygiene

- **One topic per call.** Don't bolt on "and also research adjacent topics" — the subagent will dilute its effort. Split into multiple calls instead.
- **Ask for evidence, not opinions.** Opinion prompts will come back hedged. Ask for sourced facts and form the opinion yourself.
- **Keep scope narrow.** A focused task with five concrete deliverables beats a sprawling one.

## Parallel calls

`deep_research` calls are parallelizable. If the main question splits naturally into independent sub-questions (e.g. one per product, one per jurisdiction), **dispatch them in a single tool-call batch**. They run concurrently and you get the results back together. Sequential calls only make sense when later tasks depend on earlier findings.

## After the call

- Read the returned summary carefully — it may flag what the subagent could _not_ find or where it hit its search cap.
- The retrieved documents are available for citation in your final answer just like normal search results.
- If the subagent's findings are incomplete in a specific way, you can dispatch a follow-up `deep_research` with a tighter task — but don't re-ask the same question hoping for better luck.
