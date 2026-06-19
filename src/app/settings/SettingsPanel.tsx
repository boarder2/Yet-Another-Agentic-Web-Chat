'use client';

import {
  LoaderCircle,
  Settings as SettingsIcon,
  ArrowLeft,
} from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Prompt } from '@/lib/types/prompt';
import {
  writeLocalStorage,
  useLocalStorageJSON,
} from '@/lib/hooks/useLocalStorage';
import { subscribeSettingsSynced } from '@/lib/settings/persist';
import { useQueryClient } from '@tanstack/react-query';
import { useConfig, useSaveConfig } from '@/lib/hooks/api/useConfig';
import { useModels } from '@/lib/hooks/api/useModels';
import {
  useSystemPrompts,
  useCreateSystemPrompt,
  useUpdateSystemPrompt,
  useDeleteSystemPrompt,
} from '@/lib/hooks/api/useSystemPrompts';
import { qk } from '@/lib/api/keys';
import {
  DEFAULT_CONTEXT_WINDOW,
  PREDEFINED_CONTEXT_SIZES,
} from '@/lib/models/presets';
import { cn } from '@/lib/utils';

import { SettingsType, SectionKey } from './types';
import {
  MobileSettingsNav,
  DesktopSettingsNav,
} from './components/SettingsNav';
import AutomaticSearchSection from './sections/AutomaticSearchSection';
import PersonalizationSection from './sections/PersonalizationSection';
import VoiceSection from './sections/VoiceSection';
import MemorySection from './sections/MemorySection';
import RetentionSection from './sections/RetentionSection';
import PersonaPromptsSection from './sections/PersonaPromptsSection';
import ResearchMethodologiesSection from './sections/ResearchMethodologiesSection';
import DefaultSearchSection from './sections/DefaultSearchSection';
import SearchProvidersSection from './sections/SearchProvidersSection';
import ModelSettingsSection from './sections/ModelSettingsSection';
import ModelPresetsSection from './sections/ModelPresetsSection';
import ModelVisibilitySection from './sections/ModelVisibilitySection';
import ImageGenerationSection from './sections/ImageGenerationSection';
import ApiKeysSection from './sections/ApiKeysSection';
import SkillsSection from './sections/SkillsSection';

// Stable default reference for useLocalStorageJSON (required by useSyncExternalStore).
const EMPTY_HIDDEN_MODELS: string[] = [];

export type SettingsPanelVariant = 'page' | 'modal';

/**
 * The full settings UI (nav + every section). Section selection is **controlled**
 * via props so it can be driven by either URL state (page wrapper) or local
 * state (modal). `variant` only tweaks chrome — the page renders its own
 * heading/divider and adds bottom padding for the mobile fixed bar; the modal
 * supplies its own header/close, so neither is rendered there.
 */
export default function SettingsPanel({
  activeSection,
  onSelectSection,
  variant = 'page',
}: {
  activeSection: SectionKey;
  onSelectSection: (key: SectionKey) => void;
  variant?: SettingsPanelVariant;
}) {
  const [config, setConfig] = useState<SettingsType | null>(null);
  const [_chatModels, setChatModels] = useState<Record<string, unknown>>({});
  const [_embeddingModels, setEmbeddingModels] = useState<
    Record<string, unknown>
  >({});
  const [selectedChatModelProvider, setSelectedChatModelProvider] = useState<
    string | null
  >(null);
  const [selectedChatModel, setSelectedChatModel] = useState<string | null>(
    null,
  );
  const [selectedSystemModelProvider, setSelectedSystemModelProvider] =
    useState<string | null>(null);
  const [selectedSystemModel, setSelectedSystemModel] = useState<string | null>(
    null,
  );
  const [selectedEmbeddingModelProvider, setSelectedEmbeddingModelProvider] =
    useState<string | null>(null);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [automaticSuggestions, setAutomaticSuggestions] = useState(true);
  const [personalizationLocation, setPersonalizationLocation] = useState('');
  const [personalizationAbout, setPersonalizationAbout] = useState('');
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryRetrievalEnabled, setMemoryRetrievalEnabled] = useState(false);
  const [memoryAutoDetectionEnabled, setMemoryAutoDetectionEnabled] =
    useState(false);
  const [savingStates, setSavingStates] = useState<Record<string, boolean>>({});
  const [contextWindowSize, setContextWindowSize] = useState(
    DEFAULT_CONTEXT_WINDOW,
  );
  const [, setIsCustomContextWindow] = useState(false);

  const [privateSessionDurationMinutes, setPrivateSessionDurationMinutes] =
    useState(1440);
  const [isCustomPrivateDuration, setIsCustomPrivateDuration] = useState(false);
  const [customPrivateDurationInput, setCustomPrivateDurationInput] =
    useState('');

  const [userSystemPrompts, setUserSystemPrompts] = useState<Prompt[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  const [newPromptType, setNewPromptType] = useState<'persona'>('persona');
  const [isAddingNewPrompt, setIsAddingNewPrompt] = useState(false);

  const [userMethodologies, setUserMethodologies] = useState<Prompt[]>([]);
  const [editingMethodology, setEditingMethodology] = useState<Prompt | null>(
    null,
  );
  const [newMethodologyName, setNewMethodologyName] = useState('');
  const [newMethodologyContent, setNewMethodologyContent] = useState('');
  const [isAddingNewMethodology, setIsAddingNewMethodology] = useState(false);

  const [allModels, setAllModels] = useState<{
    chat: Record<string, Record<string, { displayName: string }>>;
    embedding: Record<string, Record<string, { displayName: string }>>;
  }>({ chat: {}, embedding: {} });
  // Hidden models are DB-backed (app_settings, synced from localStorage).
  const [hiddenModels, setHiddenModels] = useLocalStorageJSON<string[]>(
    'hiddenModels',
    EMPTY_HIDDEN_MODELS,
  );
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    new Set(),
  );

  const [searchChatModelProvider, setSearchChatModelProvider] =
    useState<string>('');
  const [searchChatModel, setSearchChatModel] = useState<string>('');

  const queryClient = useQueryClient();
  const isInitializedRef = useRef(false);
  const { data: configData } = useConfig();
  const { data: modelsData } = useModels(true);
  const { data: systemPromptsData } = useSystemPrompts();
  const { data: methodologiesData } = useSystemPrompts('methodology');
  const saveConfigMutation = useSaveConfig();
  const createSystemPromptMutation = useCreateSystemPrompt();
  const updateSystemPromptMutation = useUpdateSystemPrompt();
  const deleteSystemPromptMutation = useDeleteSystemPrompt();

  // (C) Config-API-backed state — mirrors the latest /api/config response
  // (retention, search providers, private-session duration, model lists).
  const applyConfigObject = useCallback((data: SettingsType) => {
    setConfig(data);
    setChatModels(data.chatModelProviders || {});
    setEmbeddingModels(data.embeddingModelProviders || {});

    const duration = data.privateSessionDurationMinutes ?? 1440;
    setPrivateSessionDurationMinutes(duration);
    const isPredefined = [5, 15, 30, 60, 480, 1440, 4320, 10080].includes(
      duration,
    );
    setIsCustomPrivateDuration(!isPredefined);
    if (!isPredefined) setCustomPrivateDurationInput(String(duration));
  }, []);

  // (B) localStorage-backed (DB-synced) state — model selections plus the
  // composer/memory/personalization fields. `persist` writes the resolved
  // embedding default back on first run only; the focus re-sync passes false so
  // it never echoes the value it just read.
  const readLocalStorageSettings = useCallback(
    (data: SettingsType, { persist }: { persist: boolean }) => {
      const chatModelProvidersKeys = Object.keys(data.chatModelProviders || {});
      const embeddingModelProvidersKeys = Object.keys(
        data.embeddingModelProviders || {},
      );

      const defaultChatModelProvider =
        chatModelProvidersKeys.length > 0 ? chatModelProvidersKeys[0] : '';
      const defaultEmbeddingModelProvider =
        embeddingModelProvidersKeys.length > 0
          ? embeddingModelProvidersKeys[0]
          : '';

      const chatModelProvider =
        localStorage.getItem('chatModelProvider') ||
        defaultChatModelProvider ||
        '';
      const chatModel =
        localStorage.getItem('chatModel') ||
        (data.chatModelProviders &&
        data.chatModelProviders[chatModelProvider]?.length > 0
          ? data.chatModelProviders[chatModelProvider][0].name
          : undefined) ||
        '';

      // The settings page only displays the chat system model (for Model
      // Presets); it is owned by the chat input's ModelConfigurator (localStorage,
      // DB-backed), NOT config.toml. The memory-processing model is separate.
      const systemModelProvider =
        localStorage.getItem('systemModelProvider') ||
        defaultChatModelProvider ||
        '';
      const systemModel =
        localStorage.getItem('systemModel') ||
        (data.chatModelProviders &&
        data.chatModelProviders[systemModelProvider]?.length > 0
          ? data.chatModelProviders[systemModelProvider][0].name
          : undefined) ||
        '';

      // The embedding model is DB-backed via the `embeddingModelProvider`/
      // `embeddingModel` localStorage keys (synced to the DB by the settings
      // persistence layer), NOT config.toml. Hydrate from there, defaulting to
      // the first available provider/model on a fresh install.
      const embeddingModelProvider =
        localStorage.getItem('embeddingModelProvider') ||
        defaultEmbeddingModelProvider ||
        '';
      const embeddingModel =
        localStorage.getItem('embeddingModel') ||
        (data.embeddingModelProviders &&
          data.embeddingModelProviders[embeddingModelProvider]?.[0].name) ||
        '';

      setSelectedChatModelProvider(chatModelProvider);
      setSelectedChatModel(chatModel);
      setSelectedSystemModelProvider(systemModelProvider);
      setSelectedSystemModel(systemModel);
      setSelectedEmbeddingModelProvider(embeddingModelProvider);
      setSelectedEmbeddingModel(embeddingModel);

      // systemModelProvider/systemModel intentionally NOT written here: the chat
      // system model is owned by the chat input's ModelConfigurator (localStorage,
      // DB-backed). The embedding selection is likewise DB-backed; persist its
      // resolved default so a fresh install has a concrete value.
      if (persist) {
        localStorage.setItem('embeddingModelProvider', embeddingModelProvider);
        localStorage.setItem('embeddingModel', embeddingModel);
      }

      setAutomaticSuggestions(
        localStorage.getItem('autoSuggestions') !== 'false',
      );
      const storedContextWindow = parseInt(
        localStorage.getItem('contextWindowSize') ??
          String(DEFAULT_CONTEXT_WINDOW),
      );
      setContextWindowSize(storedContextWindow);
      setIsCustomContextWindow(
        !PREDEFINED_CONTEXT_SIZES.includes(storedContextWindow),
      );

      setPersonalizationLocation(
        localStorage.getItem('personalization.location') || '',
      );
      setPersonalizationAbout(
        localStorage.getItem('personalization.about') || '',
      );

      setMemoryEnabled(localStorage.getItem('memoryEnabled') === 'true');
      setMemoryRetrievalEnabled(
        localStorage.getItem('memoryRetrievalEnabled') === 'true',
      );
      setMemoryAutoDetectionEnabled(
        localStorage.getItem('memoryAutoDetectionEnabled') === 'true',
      );

      const storedSearchChatModelProvider = localStorage.getItem(
        'searchChatModelProvider',
      );
      const storedSearchChatModel = localStorage.getItem('searchChatModel');
      if (storedSearchChatModelProvider)
        setSearchChatModelProvider(storedSearchChatModelProvider);
      if (storedSearchChatModel) setSearchChatModel(storedSearchChatModel);
    },
    [],
  );

  /* eslint-disable react-hooks/set-state-in-effect */
  // (C) Track the latest config on every change, including the window-focus
  // refetch, so retention/search-provider/private-duration/model-list UI
  // reflects edits made on another device. Structural sharing means this only
  // re-runs when the config actually differs.
  useEffect(() => {
    if (!configData) return;
    applyConfigObject(configData as unknown as SettingsType);
  }, [configData, applyConfigObject]);

  // One-time init: read the localStorage-backed settings, persist the resolved
  // embedding default, and clear the loading flag.
  useEffect(() => {
    if (!configData || isInitializedRef.current) return;
    isInitializedRef.current = true;
    readLocalStorageSettings(configData as unknown as SettingsType, {
      persist: true,
    });
    setIsLoading(false);
  }, [configData, readLocalStorageSettings]);

  // (B) Re-read the localStorage-backed settings whenever the cross-device
  // settings re-sync fires (tab focus/visibility). Without this they'd stay
  // stale until a full navigation/refresh.
  useEffect(() => {
    return subscribeSettingsSynced(() => {
      if (!configData) return;
      readLocalStorageSettings(configData as unknown as SettingsType, {
        persist: false,
      });
    });
  }, [configData, readLocalStorageSettings]);

  useEffect(() => {
    if (!modelsData) return;
    setAllModels({
      chat:
        (modelsData.chatModelProviders as unknown as Record<
          string,
          Record<string, { displayName: string }>
        >) || {},
      embedding:
        (modelsData.embeddingModelProviders as unknown as Record<
          string,
          Record<string, { displayName: string }>
        >) || {},
    });
  }, [modelsData]);

  useEffect(() => {
    if (!systemPromptsData) return;
    setUserSystemPrompts(
      (systemPromptsData as unknown as Prompt[]).filter(
        (p: Prompt) => !p.readOnly,
      ),
    );
  }, [systemPromptsData]);

  useEffect(() => {
    if (!methodologiesData) return;
    setUserMethodologies(
      (methodologiesData as unknown as Prompt[]).filter(
        (p: Prompt) => !p.readOnly,
      ),
    );
  }, [methodologiesData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saveConfig = async (
    key: string,
    value: string | string[] | number | boolean,
  ) => {
    setSavingStates((prev) => ({ ...prev, [key]: true }));

    try {
      const modelSelectionKeys = ['embeddingModelProvider', 'embeddingModel'];

      if (modelSelectionKeys.includes(key)) {
        // The embedding selection is DB-backed via localStorage (synced by the
        // settings persistence layer). The chat system model lives in the chat
        // picker; the memory model is its own DB-backed setting.
        localStorage.setItem(key, value.toString());

        fetch('/api/memories/reindex', { method: 'POST' })
          .then((res) => {
            if (res.ok) {
              toast.success(
                'Memories are being re-indexed with the new embedding model',
              );
            }
          })
          .catch(() => {
            toast.error('Failed to trigger memory re-indexing');
          });

        setTimeout(() => {
          setSavingStates((prev) => ({ ...prev, [key]: false }));
        }, 300);
        return;
      }

      const updatedConfig = {
        ...config,
        [key]: value,
      } as SettingsType;

      await saveConfigMutation.mutateAsync(
        updatedConfig as unknown as Record<string, unknown>,
      );

      setConfig(updatedConfig);

      if (
        key.toLowerCase().includes('api') ||
        key.toLowerCase().includes('url')
      ) {
        const freshConfig = await queryClient.fetchQuery({
          queryKey: qk.config,
        });
        const data = (freshConfig ?? {}) as unknown as SettingsType;

        setChatModels(data.chatModelProviders || {});
        setEmbeddingModels(data.embeddingModelProviders || {});

        const currentChatProvider = selectedChatModelProvider;
        const newChatProviders = Object.keys(data.chatModelProviders || {});

        if (!currentChatProvider && newChatProviders.length > 0) {
          const firstProvider = newChatProviders[0];
          const firstModel = data.chatModelProviders[firstProvider]?.[0]?.name;

          if (firstModel) {
            setSelectedChatModelProvider(firstProvider);
            setSelectedChatModel(firstModel);
            localStorage.setItem('chatModelProvider', firstProvider);
            localStorage.setItem('chatModel', firstModel);
          }
        } else if (
          currentChatProvider &&
          (!data.chatModelProviders ||
            !data.chatModelProviders[currentChatProvider] ||
            !Array.isArray(data.chatModelProviders[currentChatProvider]) ||
            data.chatModelProviders[currentChatProvider].length === 0)
        ) {
          const firstValidProvider = Object.entries(
            data.chatModelProviders || {},
          ).find(
            ([, models]) => Array.isArray(models) && models.length > 0,
          )?.[0];

          if (firstValidProvider) {
            setSelectedChatModelProvider(firstValidProvider);
            setSelectedChatModel(
              data.chatModelProviders[firstValidProvider][0].name,
            );
            localStorage.setItem('chatModelProvider', firstValidProvider);
            localStorage.setItem(
              'chatModel',
              data.chatModelProviders[firstValidProvider][0].name,
            );
          } else {
            setSelectedChatModelProvider(null);
            setSelectedChatModel(null);
            localStorage.removeItem('chatModelProvider');
            localStorage.removeItem('chatModel');
          }
        }

        // The chat system model (used only here for Model Presets) is owned by
        // the chat input's ModelConfigurator via localStorage; the settings page
        // neither persists nor re-defaults it on provider changes.

        const currentEmbeddingProvider = selectedEmbeddingModelProvider;
        const newEmbeddingProviders = Object.keys(
          data.embeddingModelProviders || {},
        );

        if (!currentEmbeddingProvider && newEmbeddingProviders.length > 0) {
          const firstProvider = newEmbeddingProviders[0];
          const firstModel =
            data.embeddingModelProviders[firstProvider]?.[0]?.name;

          if (firstModel) {
            setSelectedEmbeddingModelProvider(firstProvider);
            setSelectedEmbeddingModel(firstModel);
            localStorage.setItem('embeddingModelProvider', firstProvider);
            localStorage.setItem('embeddingModel', firstModel);
          }
        } else if (
          currentEmbeddingProvider &&
          (!data.embeddingModelProviders ||
            !data.embeddingModelProviders[currentEmbeddingProvider] ||
            !Array.isArray(
              data.embeddingModelProviders[currentEmbeddingProvider],
            ) ||
            data.embeddingModelProviders[currentEmbeddingProvider].length === 0)
        ) {
          const firstValidProvider = Object.entries(
            data.embeddingModelProviders || {},
          ).find(
            ([, models]) => Array.isArray(models) && models.length > 0,
          )?.[0];

          if (firstValidProvider) {
            setSelectedEmbeddingModelProvider(firstValidProvider);
            setSelectedEmbeddingModel(
              data.embeddingModelProviders[firstValidProvider][0].name,
            );
            localStorage.setItem('embeddingModelProvider', firstValidProvider);
            localStorage.setItem(
              'embeddingModel',
              data.embeddingModelProviders[firstValidProvider][0].name,
            );
          } else {
            setSelectedEmbeddingModelProvider(null);
            setSelectedEmbeddingModel(null);
            localStorage.removeItem('embeddingModelProvider');
            localStorage.removeItem('embeddingModel');
          }
        }

        setConfig(data);
      }

      if (key === 'automaticSuggestions') {
        localStorage.setItem('autoSuggestions', value.toString());
      } else if (key === 'chatModelProvider') {
        localStorage.setItem('chatModelProvider', value as string);
      } else if (key === 'chatModel') {
        localStorage.setItem('chatModel', value as string);
      } else if (key === 'contextWindowSize') {
        localStorage.setItem('contextWindowSize', value.toString());
      }
    } catch (err) {
      console.error('Failed to save:', err);
      setConfig((prev) => ({ ...prev! }));
    } finally {
      setTimeout(() => {
        setSavingStates((prev) => ({ ...prev, [key]: false }));
      }, 500);
    }
  };

  const saveSearchSetting = (key: string, value: string) => {
    localStorage.setItem(key, value);
  };

  const handlePersonalizationChange = (
    field: 'location' | 'about',
    rawValue: string,
  ) => {
    const key =
      field === 'location'
        ? 'personalization.location'
        : 'personalization.about';
    const setter =
      field === 'location'
        ? setPersonalizationLocation
        : setPersonalizationAbout;

    setter(rawValue);
    writeLocalStorage(key, rawValue.trim() ? rawValue : null);
  };

  // hiddenModels is DB-backed via useLocalStorageJSON; setHiddenModels persists
  // to localStorage and syncs to the DB, so no separate save call is needed.
  const handleModelVisibilityToggle = (
    modelKey: string,
    isVisible: boolean,
  ) => {
    setHiddenModels(
      isVisible
        ? hiddenModels.filter((m) => m !== modelKey)
        : [...hiddenModels, modelKey],
    );
  };

  const handleProviderVisibilityToggle = (
    providerModels: Record<string, unknown>,
    showAll: boolean,
  ) => {
    const modelKeys = Object.keys(providerModels);
    if (showAll) {
      setHiddenModels(
        hiddenModels.filter((modelKey) => !modelKeys.includes(modelKey)),
      );
    } else {
      const modelsToHide = modelKeys.filter(
        (modelKey) => !hiddenModels.includes(modelKey),
      );
      setHiddenModels([...hiddenModels, ...modelsToHide]);
    }
  };

  const toggleProviderExpansion = (providerId: string) => {
    setExpandedProviders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(providerId)) {
        newSet.delete(providerId);
      } else {
        newSet.add(providerId);
      }
      return newSet;
    });
  };

  const handleAddOrUpdateSystemPrompt = () => {
    const currentPrompt = editingPrompt || {
      name: newPromptName,
      content: newPromptContent,
      type: newPromptType,
    };
    if (!currentPrompt.name.trim() || !currentPrompt.content.trim()) {
      console.error('Prompt name and content cannot be empty.');
      return;
    }

    if (editingPrompt) {
      updateSystemPromptMutation.mutate(
        {
          id: editingPrompt.id,
          data: {
            name: currentPrompt.name,
            content: currentPrompt.content,
            type: currentPrompt.type,
          },
        },
        {
          onSuccess: (saved) => {
            setUserSystemPrompts(
              userSystemPrompts.map((p) =>
                p.id === saved.id ? (saved as unknown as Prompt) : p,
              ),
            );
            setEditingPrompt(null);
          },
          onError: () => console.error('Failed to update prompt.'),
        },
      );
    } else {
      createSystemPromptMutation.mutate(
        {
          name: currentPrompt.name,
          content: currentPrompt.content,
          type: currentPrompt.type,
        },
        {
          onSuccess: (saved) => {
            setUserSystemPrompts([
              ...userSystemPrompts,
              saved as unknown as Prompt,
            ]);
            setNewPromptName('');
            setNewPromptContent('');
            setNewPromptType('persona');
            setIsAddingNewPrompt(false);
          },
          onError: () => console.error('Failed to add prompt.'),
        },
      );
    }
  };

  const handleDeleteSystemPrompt = (promptId: string) => {
    if (!confirm('Are you sure you want to delete this prompt?')) return;
    deleteSystemPromptMutation.mutate(promptId, {
      onSuccess: () => {
        setUserSystemPrompts(
          userSystemPrompts.filter((p) => p.id !== promptId),
        );
      },
      onError: () => console.error('Failed to delete prompt.'),
    });
  };

  const handleAddOrUpdateMethodology = () => {
    const currentMethodology = editingMethodology || {
      name: newMethodologyName,
      content: newMethodologyContent,
    };
    if (!currentMethodology.name.trim() || !currentMethodology.content.trim()) {
      console.error('Methodology name and content cannot be empty.');
      return;
    }

    if (editingMethodology) {
      updateSystemPromptMutation.mutate(
        {
          id: editingMethodology.id,
          data: {
            name: currentMethodology.name,
            content: currentMethodology.content,
            type: 'methodology',
          },
        },
        {
          onSuccess: (saved) => {
            setUserMethodologies(
              userMethodologies.map((m) =>
                m.id === saved.id ? (saved as unknown as Prompt) : m,
              ),
            );
            setEditingMethodology(null);
          },
          onError: () => console.error('Failed to update methodology.'),
        },
      );
    } else {
      createSystemPromptMutation.mutate(
        {
          name: currentMethodology.name,
          content: currentMethodology.content,
          type: 'methodology',
        },
        {
          onSuccess: (saved) => {
            setUserMethodologies([
              ...userMethodologies,
              saved as unknown as Prompt,
            ]);
            setNewMethodologyName('');
            setNewMethodologyContent('');
            setIsAddingNewMethodology(false);
          },
          onError: () => console.error('Failed to add methodology.'),
        },
      );
    }
  };

  const handleDeleteMethodology = (methodologyId: string) => {
    if (!confirm('Are you sure you want to delete this methodology?')) return;
    deleteSystemPromptMutation.mutate(methodologyId, {
      onSuccess: () => {
        setUserMethodologies(
          userMethodologies.filter((m) => m.id !== methodologyId),
        );
      },
      onError: () => console.error('Failed to delete methodology.'),
    });
  };

  return (
    <div>
      {variant === 'page' && (
        <div className="flex flex-col pt-4">
          <div className="flex items-center space-x-2">
            <Link href="/" className="lg:hidden">
              <ArrowLeft />
            </Link>
            <div className="flex flex-row space-x-0.5 items-center">
              <SettingsIcon size={23} />
              <h1 className="text-3xl font-medium p-2">Settings</h1>
            </div>
          </div>
          <hr className="border-t border-surface-2 my-4 w-full" />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-row items-center justify-center min-h-[50vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      ) : (
        config && (
          <>
            <MobileSettingsNav
              activeSection={activeSection}
              onSelect={onSelectSection}
            />

            <div
              className={cn(
                'flex flex-row gap-8',
                variant === 'page' ? 'pb-28 lg:pb-8' : 'pb-2',
              )}
            >
              <DesktopSettingsNav
                activeSection={activeSection}
                onSelect={onSelectSection}
              />
              <div className="flex-1 min-w-0">
                {activeSection === 'voice' && <VoiceSection />}

                {activeSection === 'automatic-search' && (
                  <AutomaticSearchSection
                    automaticSuggestions={automaticSuggestions}
                    onToggle={(checked) => {
                      setAutomaticSuggestions(checked);
                      saveConfig('automaticSuggestions', checked);
                    }}
                  />
                )}

                {activeSection === 'personalization' && (
                  <PersonalizationSection
                    location={personalizationLocation}
                    about={personalizationAbout}
                    onChange={handlePersonalizationChange}
                  />
                )}

                {activeSection === 'memory' && (
                  <MemorySection
                    memoryEnabled={memoryEnabled}
                    memoryRetrievalEnabled={memoryRetrievalEnabled}
                    memoryAutoDetectionEnabled={memoryAutoDetectionEnabled}
                    setMemoryEnabled={setMemoryEnabled}
                    setMemoryRetrievalEnabled={setMemoryRetrievalEnabled}
                    setMemoryAutoDetectionEnabled={
                      setMemoryAutoDetectionEnabled
                    }
                    config={config}
                  />
                )}

                {activeSection === 'retention' && (
                  <RetentionSection
                    config={config}
                    savingStates={savingStates}
                    setConfig={setConfig}
                    saveConfig={saveConfig}
                    privateSessionDurationMinutes={
                      privateSessionDurationMinutes
                    }
                    isCustomPrivateDuration={isCustomPrivateDuration}
                    customPrivateDurationInput={customPrivateDurationInput}
                    setPrivateSessionDurationMinutes={
                      setPrivateSessionDurationMinutes
                    }
                    setIsCustomPrivateDuration={setIsCustomPrivateDuration}
                    setCustomPrivateDurationInput={
                      setCustomPrivateDurationInput
                    }
                  />
                )}

                {activeSection === 'skills' && <SkillsSection />}

                {activeSection === 'persona-prompts' && (
                  <PersonaPromptsSection
                    userSystemPrompts={userSystemPrompts}
                    editingPrompt={editingPrompt}
                    newPromptName={newPromptName}
                    newPromptContent={newPromptContent}
                    isAddingNewPrompt={isAddingNewPrompt}
                    setEditingPrompt={setEditingPrompt}
                    setNewPromptName={setNewPromptName}
                    setNewPromptContent={setNewPromptContent}
                    setIsAddingNewPrompt={setIsAddingNewPrompt}
                    onAddOrUpdate={handleAddOrUpdateSystemPrompt}
                    onDelete={handleDeleteSystemPrompt}
                  />
                )}

                {activeSection === 'research-methodologies' && (
                  <ResearchMethodologiesSection
                    userMethodologies={userMethodologies}
                    editingMethodology={editingMethodology}
                    newMethodologyName={newMethodologyName}
                    newMethodologyContent={newMethodologyContent}
                    isAddingNewMethodology={isAddingNewMethodology}
                    setEditingMethodology={setEditingMethodology}
                    setNewMethodologyName={setNewMethodologyName}
                    setNewMethodologyContent={setNewMethodologyContent}
                    setIsAddingNewMethodology={setIsAddingNewMethodology}
                    onAddOrUpdate={handleAddOrUpdateMethodology}
                    onDelete={handleDeleteMethodology}
                  />
                )}

                {activeSection === 'search-providers' && (
                  <SearchProvidersSection
                    config={config}
                    savingStates={savingStates}
                    setConfig={setConfig}
                    saveConfig={saveConfig}
                  />
                )}

                {activeSection === 'default-search' && (
                  <DefaultSearchSection
                    searchChatModelProvider={searchChatModelProvider}
                    searchChatModel={searchChatModel}
                    onModelChange={(provider, model) => {
                      setSearchChatModelProvider(provider);
                      setSearchChatModel(model);
                      saveSearchSetting('searchChatModelProvider', provider);
                      saveSearchSetting('searchChatModel', model);
                    }}
                    onReset={() => {
                      setSearchChatModelProvider('');
                      setSearchChatModel('');
                      localStorage.removeItem('searchChatModelProvider');
                      localStorage.removeItem('searchChatModel');
                    }}
                  />
                )}

                {activeSection === 'model-settings' && (
                  <ModelSettingsSection
                    config={config}
                    selectedEmbeddingModelProvider={
                      selectedEmbeddingModelProvider
                    }
                    selectedEmbeddingModel={selectedEmbeddingModel}
                    savingStates={savingStates}
                    setSelectedEmbeddingModelProvider={
                      setSelectedEmbeddingModelProvider
                    }
                    setSelectedEmbeddingModel={setSelectedEmbeddingModel}
                    setConfig={setConfig}
                    saveConfig={saveConfig}
                  />
                )}

                {activeSection === 'model-presets' && (
                  <ModelPresetsSection
                    selectedChatModelProvider={selectedChatModelProvider}
                    selectedChatModel={selectedChatModel}
                    selectedSystemModelProvider={selectedSystemModelProvider}
                    selectedSystemModel={selectedSystemModel}
                    contextWindowSize={contextWindowSize}
                    setSelectedChatModelProvider={setSelectedChatModelProvider}
                    setSelectedChatModel={setSelectedChatModel}
                    setSelectedSystemModelProvider={
                      setSelectedSystemModelProvider
                    }
                    setSelectedSystemModel={setSelectedSystemModel}
                    setContextWindowSize={setContextWindowSize}
                    setIsCustomContextWindow={setIsCustomContextWindow}
                  />
                )}

                {activeSection === 'model-visibility' && (
                  <ModelVisibilitySection
                    allModels={allModels}
                    hiddenModels={hiddenModels}
                    expandedProviders={expandedProviders}
                    onToggleModel={handleModelVisibilityToggle}
                    onToggleProvider={handleProviderVisibilityToggle}
                    onToggleExpand={toggleProviderExpansion}
                  />
                )}

                {activeSection === 'image-generation' && config && (
                  <ImageGenerationSection />
                )}

                {activeSection === 'api-keys' && (
                  <ApiKeysSection
                    config={config}
                    savingStates={savingStates}
                    setConfig={setConfig}
                    saveConfig={saveConfig}
                  />
                )}
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
