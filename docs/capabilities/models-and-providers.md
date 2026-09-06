# Models and providers

YAAWC separates the model that writes the answer from the model used for internal work. Settings discovers configured models and lets you choose them per chat, workspace, workflow, schedule, widget, or feature-specific task.

Reasoning effort is invocation configuration, not part of a model ID. The normalized levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; **Provider default** is represented by leaving the field unset.

## Chat and System models

The composer model picker selects:

- **Chat model:** writes the final answer and performs the main agent reasoning.
- **System model:** handles internal operations such as retrieval processing, long-page summaries, image analysis, memory processing when configured separately, and other system chains. If it is unset, the Chat model is used.
- **Vision capability:** allows image attachments and multimodal input for the selected Chat model when enabled.
- **Context window:** controls the conversation context budget and the compaction indicator.

A named Model Preset can save the Chat model, System model, vision flag, context window, and each role's optional reasoning effort together. A workspace can pin its own Chat and System models and override the global composer selection. Workflows and schedules store their own model selection, including optional role-specific effort. Agent-run dashboard chat widgets and Agent Panel executor definitions use the same model-reference contract.

## Native reasoning effort

Named effort is supported only for models that advertise a documented native control from one of these five providers: **OpenRouter, OpenAI, Anthropic, Google Gemini, and DeepSeek AI**. Model discovery exposes the supported levels for each exact model; OpenRouter combines its `supported_parameters` metadata with documented model exceptions, while direct providers use maintained model profiles. Unknown, unprofiled, and budget-token-only models expose no effort selector and receive no effort parameter.

When a level is selected, YAAWC maps it to the provider's native request shape: OpenRouter and OpenAI reasoning effort, Anthropic adaptive/output effort or disabled thinking, Gemini thinking level, or DeepSeek effort/toggle controls. `off` uses the provider's documented disabled form where one exists. YAAWC does not approximate named effort with token budgets, and Provider default sends no effort control. Provider rejection is surfaced as the provider error; YAAWC does not silently retry without the selected effort.

Chat and System effort are independent. If System is omitted, its complete Chat model reference—including effective effort—is used. A saved level that becomes stale is clamped to the nearest level currently supported at runtime and is shown as configured versus effective; the saved preset, workspace, workflow, widget, or panel definition is not rewritten. Unsupported models use Provider default.

Effort settings for the composer sync through the database alongside other model selections; selecting Provider default removes the optional setting. Presets, workspace/workflow/schedule/widget/panel definitions retain configured values. A continuable run stores the effective Chat/System/executor references in its versioned snapshot, so resume uses the paused run's effort rather than current settings. Completed assistant metadata retains effective model configuration, and historical Model Info displays it after the active snapshot is cleared.

Reasoning effort applies only to agent Chat/System work and Agent Panel/subagent role routing. It does not apply to embeddings, memory-processing models, image generation, TTS narration, OpenAI-compatible providers, or other non-agent model tasks.

## Supported model providers

Chat models can come from OpenAI, Anthropic, Google Gemini, DeepSeek AI, OpenRouter, or a configured OpenAI-compatible provider. Built-in and compatible-provider model lists are discovered from their configured endpoints; the available model names depend on the provider account or local server.

### OpenRouter endpoint quantization

When the OpenRouter provider is available, **Settings → Model Settings → OpenRouter** provides one instance-wide endpoint quantization allow-list for its chat models. The section is hidden when OpenRouter is unavailable. The checklist saves selections automatically. The supported values are `int4`, `int8`, `fp4`, `mxfp4`, `nvfp4`, `fp6`, `fp8`, `mxfp8`, `fp16`, `bf16`, and `fp32`.

Selecting one or more values sends them as OpenRouter `provider.quantizations`; multiple values use OR semantics, so any selected quantization is allowed. Leaving every value unchecked removes the preference and restores OpenRouter's default routing. The model catalog is not pre-filtered. If no matching endpoint is available for a selected model, OpenRouter's runtime error is surfaced and YAAWC does not retry without the restriction.

Quantized endpoints can have different quality characteristics, and restricting the list can reduce endpoint availability. A malformed persisted value makes OpenRouter unavailable until the setting is reset or replaced with supported values. Changes apply to newly started LangChain-backed OpenRouter operations; in-flight operations are unchanged. The separate OpenRouter image-generation integration is unaffected.

### OpenAI-compatible providers

Configure named endpoints in **Settings → AI Models → OpenAI-Compatible Providers**. Multiple providers may share a URL, while their names and encrypted request headers remain independent. Names are case-insensitively unique and renaming a provider preserves its stable model references.

Enter an HTTP(S) root or a URL ending in `/v1`; YAAWC stores the canonical `/v1` form. Enabled providers are discovered with `GET /v1/models`. A standard `{ data: [{ id, name? }] }` response supplies Chat models, which use streaming `/v1/chat/completions` requests. Enable **Supports Embeddings** to expose every discovered ID as an embedding option; YAAWC does not infer vision, tool, context, or reasoning capabilities.

Request headers are optional. Header names are returned for management, but values are write-only in the UI and API and are encrypted individually at rest. Leaving an existing value blank preserves it; removing a row explicitly deletes it. A non-empty header write requires the encryption passphrase. The provider Test action works while the provider is disabled, accepts a valid empty model list, rejects redirects, and limits discovery to 20 seconds. Errors are sanitized and one unavailable provider does not hide other catalogs.

Compatible-provider requests originate from the YAAWC server process, not the browser. If YAAWC runs in a container, `localhost` and `127.0.0.1` refer to that application container; use a host gateway, service name, or network address reachable from the container for an endpoint running elsewhere. Private or local endpoints must likewise be reachable from the process that runs YAAWC.

Embedding models can come from OpenAI, Google Gemini, Hugging Face Transformers, or enabled OpenAI-compatible providers. The Transformers option runs a local `Xenova/all-MiniLM-L6-v2` embedding model. Embeddings are used for chat-document indexing and search, memory retrieval, and memory re-indexing.

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

Provider and search API keys, plus compatible-provider header values, are entered in Settings and encrypted at rest. A required encryption passphrase must be configured before credentials can be stored or decrypted. Provider definitions, URLs, and non-secret model settings are stored separately from credential values; see [Privacy and data](./privacy-and-data.md).

A provider may be absent from the model picker when its credential is missing, it is disabled, its endpoint cannot be loaded, all of its models are hidden, or model discovery fails. The model refresh control retries discovery. A model that was saved in a preset or workspace override can become unavailable later; select a replacement or update the saved configuration. Explicit stale compatible-provider references remain unavailable rather than being silently replaced.

## Embedding and model limits

- File search and memory retrieval require vectors made with the currently selected embedding model. Re-index memories after changing it and re-upload chat attachments that were indexed with incompatible dimensions.
- A remote provider's context, rate, quota, vision, image-output, or tool-calling limits still apply. YAAWC reports provider failures rather than widening those limits.
- System-model work can add model usage even when the final answer uses a different Chat model. The message model information shows per-model usage when available.
- Local Transformers embeddings avoid a remote embedding API call but still require the model package/runtime to load successfully.

## If a provider does not work

Check the encryption passphrase first, then refresh the provider model list or use the compatible provider's Test action. Re-enter a credential if it was saved under a different passphrase. For a compatible endpoint, verify that its canonical `/v1` URL and `/v1/models` response are reachable from the YAAWC server process or container; a valid empty `data` list is successful. For web features, verify the selected search provider and fallback. For image generation, verify that the selected OpenRouter model supports image output. A failed provider does not make local capability documentation, settings, or already stored chats unavailable.

For deployment-level configuration, see [Configuration](./configuration.md). For voice and appearance settings, see [Administration and settings](./administration-and-settings.md).
