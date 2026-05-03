import { Prompt } from '../types/prompt';

export const comparativeAnalysis: Prompt = {
  id: 'builtin-methodology-comparative-analysis',
  name: 'Comparative Analysis',
  content: `## Research Methodology: Comparative Analysis

Follow this structured research process:

1. **Identify Subjects & Dimensions**: Before searching, list the subjects being compared and the key dimensions/criteria for comparison (e.g., features, cost, performance, usability, reliability).

2. **Systematic Research**: Perform a separate web search for each subject, gathering data on every comparison dimension. Use url_fetch to extract detailed specs or claims from authoritative sources.

3. **Structured Comparison**: Organize findings into a comparison table or parallel sections — one row/section per dimension, one column per subject. Be explicit about where subjects are similar and where they differ.

4. **Evidence & Gaps**: For each cell in the comparison, cite the source. Flag any dimension where data is missing or uncertain for one or more subjects.

5. **Synthesis & Recommendation**: Conclude with a reasoned synthesis. Highlight the strongest differentiators, note trade-offs, and — if the user's context allows — offer a recommendation with clear rationale.`,
  type: 'methodology',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  readOnly: true,
};

export const deepDiveLiteratureReview: Prompt = {
  id: 'builtin-methodology-deep-dive',
  name: 'Deep Dive / Literature Review',
  content: `## Research Methodology: Deep Dive / Literature Review

Follow this structured research process:

1. **Scope the Topic**: Define the boundaries of the review — what is included and excluded. Identify key terms and synonyms for comprehensive searching.

2. **Enumerate Sources**: Use web_search with varied queries to find a broad set of sources. For comprehensive multi-source gathering, consider using deep_research. Aim for diversity: academic papers, industry reports, news articles, expert opinions.

3. **Summarize Each Source**: For each key source, use url_fetch to extract and summarize its main arguments, findings, and methodology. Note the author, date, and credibility.

4. **Thematic Analysis**: Organize findings by theme or chronologically. Identify recurring themes, points of agreement, contradictions, and evolving perspectives across the body of work.

5. **Gap Analysis & Implications**: Conclude with what the literature covers well, where gaps or unanswered questions remain, and what implications or future directions emerge from the review.`,
  type: 'methodology',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  readOnly: true,
};

export const factCheckVerification: Prompt = {
  id: 'builtin-methodology-fact-check',
  name: 'Fact-Check / Verification',
  content: `## Research Methodology: Fact-Check / Verification

Follow this structured research process:

1. **Claim Extraction**: Identify every distinct factual claim in the user's query or topic. List them explicitly before researching.

2. **Independent Verification**: For each claim, perform a separate web search to find at least two independent corroborating or refuting sources. Use url_fetch to read primary sources rather than relying on search snippets alone.

3. **Confidence Rating**: Rate each claim using one of these levels:
   - **Confirmed**: 2+ independent reliable sources agree
   - **Disputed**: Sources disagree or present conflicting evidence
   - **Unverified**: Insufficient independent sources found

4. **Nuance & Dissent**: For any disputed or complex claim, surface expert dissent, caveats, or context that qualifies the claim. Note if the claim is technically true but misleading, or true only under certain conditions.

5. **Verdict Summary**: Conclude with a clear summary table of claims and their confidence ratings. Highlight any claims that changed status during verification and explain why.`,
  type: 'methodology',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  readOnly: true,
};

export const builtinMethodologyTemplates: Prompt[] = [
  comparativeAnalysis,
  deepDiveLiteratureReview,
  factCheckVerification,
];
