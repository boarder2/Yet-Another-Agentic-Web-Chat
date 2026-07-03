import {
  getAnthropicApiKey,
  getBaseUrl,
  getCustomOpenaiApiKey,
  getGeminiApiKey,
  getGroqApiKey,
  getOpenaiApiKey,
  getOpenrouterApiKey,
  getDeepseekApiKey,
  getAimlApiKey,
  getBraveSearchApiKey,
  getBraveLLMApiKey,
  getMojeekApiKey,
} from '@/lib/config';
import { setCredential, type CredentialKey } from '@/lib/credentials';
import { isEncryptionConfigured } from '@/lib/encryption';
import { MASKED_SECRET, maskSecret } from '@/lib/maskedSecret';
import { getCodeExecutionConfig } from '@/lib/config';
import { getResolvedSearchCapabilities } from '@/lib/search/providers';
import { invalidateModelCache } from '@/lib/providers/modelCache';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';

export const GET = async (_req: Request) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: Record<string, any> = {};

    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    config['chatModelProviders'] = {};
    config['embeddingModelProviders'] = {};

    for (const provider in chatModelProviders) {
      config['chatModelProviders'][provider] = Object.keys(
        chatModelProviders[provider],
      ).map((model) => {
        return {
          name: model,
          displayName: chatModelProviders[provider][model].displayName,
        };
      });
    }

    for (const provider in embeddingModelProviders) {
      config['embeddingModelProviders'][provider] = Object.keys(
        embeddingModelProviders[provider],
      ).map((model) => {
        return {
          name: model,
          displayName: embeddingModelProviders[provider][model].displayName,
        };
      });
    }

    // Mask all API keys in the response
    config['openaiApiKey'] = maskSecret(getOpenaiApiKey());
    config['groqApiKey'] = maskSecret(getGroqApiKey());
    config['anthropicApiKey'] = maskSecret(getAnthropicApiKey());
    config['geminiApiKey'] = maskSecret(getGeminiApiKey());
    config['deepseekApiKey'] = maskSecret(getDeepseekApiKey());
    config['openrouterApiKey'] = maskSecret(getOpenrouterApiKey());
    config['customOpenaiApiKey'] = maskSecret(getCustomOpenaiApiKey());
    config['aimlApiKey'] = maskSecret(getAimlApiKey());

    config['baseUrl'] = getBaseUrl();

    // Never the passphrase itself — just whether one is configured. Drives the
    // app-wide EncryptionGate (src/components/EncryptionGate.tsx): until this
    // is true, credential storage is unavailable and the UI blocks usage.
    config['encryptionConfigured'] = isEncryptionConfigured();

    // Search provider credentials (encrypted, credentials.ts). The endpoint URL
    // and provider/locale preferences are DB-backed settings (settings/server.ts).
    config['braveSearchApiKey'] = maskSecret(getBraveSearchApiKey());
    config['braveLLMApiKey'] = maskSecret(getBraveLLMApiKey());
    config['mojeekApiKey'] = maskSecret(getMojeekApiKey());
    config['searchCapabilitiesRegular'] = getResolvedSearchCapabilities(false);
    config['searchCapabilitiesPrivate'] = getResolvedSearchCapabilities(true);

    // Drives the code-widget kind chooser. Only the boolean is exposed.
    const ceCfg = getCodeExecutionConfig();
    config['codeExecution'] = {
      enabled: ceCfg.enabled && !('validationError' in ceCfg),
    };

    return Response.json({ ...config }, { status: 200 });
  } catch (err) {
    console.error('An error occurred while getting config:', err);
    return Response.json(
      { message: 'An error occurred while getting config' },
      { status: 500 },
    );
  }
};

export const POST = async (req: Request) => {
  try {
    const config = await req.json();

    // Model/search provider API keys — encrypted, stored in `credentials`.
    const credentialFields: Array<{ body: string; key: CredentialKey }> = [
      { body: 'openaiApiKey', key: 'model.openai' },
      { body: 'groqApiKey', key: 'model.groq' },
      { body: 'anthropicApiKey', key: 'model.anthropic' },
      { body: 'geminiApiKey', key: 'model.gemini' },
      { body: 'deepseekApiKey', key: 'model.deepseek' },
      { body: 'aimlApiKey', key: 'model.aimlapi' },
      { body: 'openrouterApiKey', key: 'model.openrouter' },
      { body: 'customOpenaiApiKey', key: 'model.customOpenai' },
      { body: 'braveSearchApiKey', key: 'search.braveSearch' },
      { body: 'braveLLMApiKey', key: 'search.braveLLM' },
      { body: 'mojeekApiKey', key: 'search.mojeek' },
    ];

    // MASKED_SECRET is the placeholder GET returns for an existing key: it means
    // "unchanged", so skip it entirely rather than decrypt-then-re-encrypt an
    // identical value on every unrelated save. Everything else is a real write —
    // a new secret to store, or '' to clear.
    const writes = credentialFields.filter(
      (f) => config[f.body] !== undefined && config[f.body] !== MASKED_SECRET,
    );

    // Only a non-empty write needs the passphrase; clearing a key ('') deletes.
    if (writes.some((f) => config[f.body]) && !isEncryptionConfigured()) {
      return Response.json(
        {
          message:
            'No encryption passphrase configured. Set SECURITY.ENCRYPTION_PASSPHRASE in config.toml before saving credentials.',
        },
        { status: 503 },
      );
    }

    let providerChanged = false;
    for (const field of writes) {
      // Only model-provider credentials feed the model list; search keys don't,
      // so changing one mustn't force a full model-cache refetch.
      if (field.key.startsWith('model.')) providerChanged = true;
      setCredential(field.key, config[field.body]);
    }

    // If any model-provider credential changed, invalidate the cached model
    // lists so the next /api/models call refetches from source.
    if (providerChanged) {
      invalidateModelCache();
    }

    return Response.json({ message: 'Config updated' }, { status: 200 });
  } catch (err) {
    console.error('An error occurred while updating config:', err);
    return Response.json(
      { message: 'An error occurred while updating config' },
      { status: 500 },
    );
  }
};
