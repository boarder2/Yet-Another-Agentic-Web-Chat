# YAAWC Search API Documentation

## Overview

YAAWC's Search API provides AI-powered search capabilities. You can run different types of searches, choose models, and get results with cited sources. The search API is a simplified, stateless variant of the chat API — it does not persist messages or manage conversation state.

## Endpoint

### **POST** `http://localhost:3000/api/search`

**Note**: Replace `3000` with any other port if you've changed the default PORT.

### Request

The API accepts a JSON object in the request body, where you define the focus mode, chat models, embedding models, and your query.

#### Request Body Structure

```json
{
  "chatModel": {
    "provider": "openai",
    "name": "gpt-4o-mini"
  },
  "systemModel": {
    "provider": "openai",
    "name": "gpt-4o-mini"
  },
  "embeddingModel": {
    "provider": "openai",
    "name": "text-embedding-3-large"
  },
  "focusMode": "webSearch",
  "query": "What is YAAWC",
  "history": [
    ["human", "Hi, how are you?"],
    ["assistant", "I am doing well, how can I help you today?"]
  ],
  "selectedSystemPromptIds": [],
  "stream": false
}
```

### Request Parameters

- **`chatModel`** (object, optional): Defines the chat model used for the agent's reasoning and final answer. For model details send a GET request to `http://localhost:3000/api/models`. Use the key value (e.g., `"gpt-4o-mini"` not the display name).
  - `provider`: Specifies the provider (e.g., `openai`, `ollama`, `anthropic`, `groq`, `custom_openai`).
  - `name`: The specific model from the chosen provider (e.g., `gpt-4o-mini`).
  - Optional fields for custom OpenAI configuration:
    - `customOpenAIBaseURL`: Base URL for a custom OpenAI-compatible instance.
    - `customOpenAIKey`: API key for a custom OpenAI instance.
  - `ollamaContextWindow` (number, optional): Context window size for Ollama models (default: 2048).

- **`systemModel`** (object, optional): Defines a separate model for internal/system tasks (e.g., URL summarization, query generation). Defaults to the `chatModel` if not provided. Same structure as `chatModel`.

- **`embeddingModel`** (object, optional): Defines the embedding model for similarity-based search result re-ranking. For model details send a GET request to `http://localhost:3000/api/models`.
  - `provider`: The provider for the embedding model (e.g., `openai`).
  - `name`: The specific embedding model (e.g., `text-embedding-3-large`).

- **`focusMode`** (string, required): Specifies which focus mode to use. Available modes:
  - `webSearch` — General web search with all agent tools enabled (default).
  - `localResearch` — Research local/uploaded files with citations.
  - `chat` — Creative conversation with no tools.

- **`query`** (string, required): The search query or question.

- **`selectedSystemPromptIds`** (array of strings, optional): IDs of persona/system prompts to apply to the response. These customize the agent's tone and instructions.

- **`history`** (array, optional): An array of message pairs representing the conversation history. Each pair consists of a role (either `"human"` or `"assistant"`) and the message content. This allows the system to use conversational context. Example:

  ```json
  [
    ["human", "What is YAAWC?"],
    ["assistant", "YAAWC is an AI-powered search engine..."]
  ]
  ```

- **`stream`** (boolean, optional): When set to `true`, enables streaming responses. Default is `false`.

- **`userLocation`** (string, optional): User's location to bias search results geographically.

- **`userProfile`** (string, optional): User profile/about-me text for personalization context.

- **`messageImageIds`** (array of strings, optional): IDs of previously uploaded images to include in the query for multimodal models.

### Response

The response from the API includes the final message, the sources used, and model statistics.

#### Standard Response (stream: false)

```json
{
  "message": "YAAWC is an innovative, open-source AI-powered search engine...",
  "sources": [
    {
      "pageContent": "YAAWC is an innovative, open-source AI-powered search engine designed to enhance the way users search for information online.",
      "metadata": {
        "title": "What is YAAWC?",
        "url": "https://example.com/yaawc"
      }
    }
  ],
  "modelStats": {
    "modelName": "gpt-4o-mini",
    "responseTime": 3200,
    "usage": {
      "input_tokens": 1500,
      "output_tokens": 300,
      "total_tokens": 1800
    }
  }
}
```

#### Streaming Response (stream: true)

When streaming is enabled, the API returns a stream of newline-delimited JSON objects. Each line contains a complete, valid JSON object. The response has `Content-Type: text/event-stream`.

Example of streamed response objects:

```
{"type":"init","data":"Stream connected"}
{"type":"sources","data":[{"pageContent":"...","metadata":{"title":"...","url":"..."}}]}
{"type":"response","data":"YAAWC is an "}
{"type":"response","data":"innovative, open-source "}
{"type":"response","data":"AI-powered search engine..."}
{"type":"stats","data":{"modelName":"gpt-4o-mini","usage":{...}}}
{"type":"ping","timestamp":1700000000000}
{"type":"done"}
```

Clients should process each line as a separate JSON object. The different message types include:

- **`init`**: Initial connection message.
- **`sources`**: Sources used for the response.
- **`response`**: Chunks of the generated answer text.
- **`stats`**: Model usage statistics (token counts, model name).
- **`ping`**: Keep-alive signal sent every 30 seconds to prevent reverse proxy timeouts.
- **`done`**: Indicates the stream is complete.

### Fields in the Response

- **`message`** (string): The search result, generated based on the query and focus mode.
- **`sources`** (array): A list of sources used to generate the search result. Each source includes:
  - `pageContent`: A snippet of the relevant content from the source.
  - `metadata`: Metadata about the source, including:
    - `title`: The title of the webpage.
    - `url`: The URL of the webpage.
- **`modelStats`** (object, optional): Statistics about the model invocation, including token usage and response time.

### Error Handling

If an error occurs during the search process, the API will return an appropriate error message with an HTTP status code.

- **400**: If the request is malformed or missing required fields (e.g., no focus mode or query), or if an invalid model or focus mode is specified.
- **500**: If an internal server error occurs during the search.
