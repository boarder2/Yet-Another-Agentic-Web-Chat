# Models and providers

YAAWC separates the model that writes the answer from the model used for internal work. Settings discovers configured models and lets you choose them per chat, workspace, workflow, schedule, widget, or feature-specific task.

## Chat and System models

The composer model picker selects:

- **Chat model:** writes the final answer and performs the main agent reasoning.
- **System model:** handles internal operations such as retrieval processing, long-page summaries, image analysis, memory processing when configured separately, and other system chains. If it is unset, the Chat model is used.
- **Vision capability:** allows image attachments and multimodal input for the selected Chat model when enabled.
- **Context window:** controls the conversation context budget and the compaction indicator.

A named Model Preset can save the Chat model, System model, vision flag, and context window together. A workspace can pin its own Chat and System models and override the global composer selection. Workflows and schedules store their own model selection.

## Supported model providers

Chat models can come from OpenAI, Groq, Anthropic, Google Gemini, DeepSeek AI, AI/ML API, LM Studio, OpenRouter, or a Custom OpenAI-compatible endpoint. Model lists are discovered from the configured provider; the available model names depend on the provider account or local server.

Embedding models can come from OpenAI, Google Gemini, Hugging Face Transformers, AI/ML API, or LM Studio. The Transformers option runs a local `Xenova/all-MiniLM-L6-v2` embedding model. Embeddings are used for chat-document indexing and search, memory retrieval, and memory re-indexing.

Custom OpenAI requires a model name, base URL, and API key. LM Studio requires its local API URL and a model served by that installation. Refresh models after changing a key, endpoint, or model name.

## Search providers

**Settings → Search Providers** configures the primary provider for regular chats, an optional different provider for private chats, a fallback provider, language, region, and the SearXNG URL or provider credentials.

| Provider          | Web | Images | Videos | Autocomplete |
| ----------------- | --- | ------ | ------ | ------------ |
| SearXNG           | Yes | Yes    | Yes    | Yes          |
| Brave Search      | Yes | Yes    | Yes    | Yes          |
| Brave LLM Context | Yes | No     | No     | No           |
| Mojeek            | Yes | No     | No     | No           |

If the primary provider lacks a requested capability, YAAWC uses the configured fallback when it supports it. Otherwise the capability is unavailable and the related UI is hidden or the tool returns a clear unavailable result. Autocomplete uses the regular provider selection and is not switched by private-chat mode.

## Image generation

Image generation is a separate setting backed by OpenRouter. Enable it in **Settings → Image Generation**, choose a model that advertises image output, and choose default aspect ratio and resolution. The current options include 1:1, 3:2, 4:3, 16:9, 9:16, and 21:9, with 1K, 2K, or 4K output sizes. The agent can override the defaults for an individual request.

Image generation needs a valid OpenRouter API key, a selected image-capable model, and a durable top-level chat turn. It is not available to subagents or non-durable background contexts.

## Credentials and availability

Provider and search API keys are entered in Settings and encrypted at rest. A required encryption passphrase must be configured before credentials can be stored or decrypted. Provider URLs and non-secret model settings are stored separately from credentials; see [Privacy and data](./privacy-and-data.md).

A provider may be absent from the model picker when its credential is missing, its endpoint cannot be loaded, all of its models are hidden, or model discovery fails. The model refresh control retries discovery. A model that was saved in a preset or workspace override can become unavailable later; select a replacement or update the saved configuration.

## Embedding and model limits

- File search and memory retrieval require vectors made with the currently selected embedding model. Re-index memories after changing it and re-upload chat attachments that were indexed with incompatible dimensions.
- A remote provider's context, rate, quota, vision, image-output, or tool-calling limits still apply. YAAWC reports provider failures rather than widening those limits.
- System-model work can add model usage even when the final answer uses a different Chat model. The message model information shows per-model usage when available.
- Local Transformers embeddings avoid a remote embedding API call but still require the model package/runtime to load successfully.

## If a provider does not work

Check the encryption passphrase first, then refresh the provider model list. Re-enter a credential if it was saved under a different passphrase. Verify LM Studio or Custom OpenAI URLs and the model name. For web features, verify the selected search provider and fallback. For image generation, verify that the selected OpenRouter model supports image output. A failed provider does not make local capability documentation, settings, or already stored chats unavailable.

For deployment-level configuration, see [Configuration](./configuration.md). For voice and appearance settings, see [Administration and settings](./administration-and-settings.md).
