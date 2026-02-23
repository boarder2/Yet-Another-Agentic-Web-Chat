# YAAWC's Architecture

YAAWC's architecture consists of the following key components:

1. **User Interface**: A web-based interface built with React and Next.js that allows users to interact with YAAWC for searching the web, researching local files, and conversational chat.
2. **LangGraph React Agent (`SimplifiedAgent`)**: The core reasoning engine. A LangGraph-based agentic workflow that autonomously decides which tools to invoke (web search, URL summarization, deep research, file search, image search, etc.) to answer user queries.
3. **SearXNG**: A metadata search engine used by YAAWC to search the web for sources.
4. **LLMs (Large Language Models)**: Utilized by the agent for reasoning, tool invocation decisions, content understanding, writing responses, and citing sources. Examples include Claude, GPTs, Gemini, etc.
5. **Embedding Models**: Used for similarity-based re-ranking of search results using cosine similarity or dot product distance.
6. **Focus Modes**: YAAWC supports three focus modes that control the agent's behavior:
   - **Web Search**: The agent has access to all tools (web search, URL summarization, deep research, image search, etc.) for comprehensive web-based research.
   - **Local Research**: The agent uses file search tools to research uploaded/local files with citations.
   - **Chat**: A conversational mode with no tools — the agent responds from its training data only.

For a more detailed explanation of how these components work together, see [WORKING.md](https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/tree/master/docs/architecture/WORKING.md).
