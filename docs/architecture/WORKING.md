# How does YAAWC work?

Curious about how YAAWC works? Don't worry, we'll cover it here. Before we begin, make sure you've read about the architecture of YAAWC to ensure you understand what it's made up of. Haven't read it? You can read it [here](https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/tree/master/docs/architecture/README.md).

We'll understand how YAAWC works by taking an example of a scenario where a user asks: "How does an A.C. work?". We'll break down the process into steps to make it easier to understand. The steps are as follows:

1. The message is sent to the `/api/chat` route. The route resolves the selected chat model, system model, and embedding model from the request body and configured providers.
2. The route creates a `SimplifiedAgent` — a LangGraph React Agent — and passes the `focusMode` (e.g., `webSearch`, `localResearch`, `chat`). The agent selects tools and prompts based on the focus mode:
   - **Web Search mode**: `web_search`, `url_fetch`, `image_search`, `image_analysis`, `youtube_transcript`, `pdf_loader`, `deep_research`, `todo_list`
   - **Local Research mode**: `file_search`
   - **Chat mode**: No tools (the agent responds from its training data)
3. The agent autonomously reasons about the query and decides which tools to invoke. For a factual question like "How does an A.C. work?", it would typically call the `web_search` tool, which queries SearXNG for results.
4. Search results are returned to the agent, which may then call `url_fetch` to fetch and read specific web pages for deeper content, or invoke additional tools as needed.
5. The agent synthesizes all gathered information and streams a response with cited sources back to the user.

## How are the answers cited?

The LLMs are prompted to cite sources using numbered references (e.g., `[1]`, `[2]`). The prompt templates instruct the agent to cite inline, and the UI renders these as clickable source links.

## Deep Research

For complex multi-part questions, the agent can invoke the `deep_research` tool. This launches a subagent that breaks the question into sub-tasks, researches each one independently, and returns a comprehensive synthesis. Deep research subagent events are streamed to the UI in real-time.

## Image and Video Search

The agent can invoke `image_search` to find images matching the query, and `youtube_transcript` to retrieve and summarize YouTube video transcripts. The `image_analysis` tool allows the agent to analyze images attached to the conversation using multimodal LLM capabilities.
