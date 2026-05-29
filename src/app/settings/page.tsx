'use client';

import {
  LoaderCircle,
  Settings as SettingsIcon,
  ArrowLeft,
} from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Prompt } from '@/lib/types/prompt';
import { writeLocalStorage } from '@/lib/hooks/useLocalStorage';
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

import { SettingsType, SectionKey } from './types';
import {
  MobileSettingsNav,
  DesktopSettingsNav,
} from './components/SettingsNav';
import PreferencesSection from './sections/PreferencesSection';
import AutomaticSearchSection from './sections/AutomaticSearchSection';
import PersonalizationSection from './sections/PersonalizationSection';
import MemorySection from './sections/MemorySection';
import RetentionSection from './sections/RetentionSection';
import PersonaPromptsSection from './sections/PersonaPromptsSection';
import ResearchMethodologiesSection from './sections/ResearchMethodologiesSection';
import DefaultSearchSection from './sections/DefaultSearchSection';
import SearchProvidersSection from './sections/SearchProvidersSection';
import ModelSettingsSection from './sections/ModelSettingsSection';
import ModelVisibilitySection from './sections/ModelVisibilitySection';
import ImageGenerationSection from './sections/ImageGenerationSection';
import ApiKeysSection from './sections/ApiKeysSection';
import SkillsSection from './sections/SkillsSection';

const predefinedContextSizes = [
  1024, 2048, 3072, 4096, 8192, 16384, 32768, 65536, 131072,
];

export default function SettingsPage() {
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
  const [linkSystemToChat, setLinkSystemToChat] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState(true);
  const [automaticSuggestions, setAutomaticSuggestions] = useState(true);
  const [personalizationLocation, setPersonalizationLocation] = useState('');
  const [personalizationAbout, setPersonalizationAbout] = useState('');
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryRetrievalEnabled, setMemoryRetrievalEnabled] = useState(false);
  const [memoryAutoDetectionEnabled, setMemoryAutoDetectionEnabled] =
    useState(false);
  const [savingStates, setSavingStates] = useState<Record<string, boolean>>({});
  const [contextWindowSize, setContextWindowSize] = useState(32768);
  const [isCustomContextWindow, setIsCustomContextWindow] = useState(false);

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
  const [hiddenModels, setHiddenModels] = useState<string[]>([]);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    new Set(),
  );

  const [searchChatModelProvider, setSearchChatModelProvider] =
    useState<string>('');
  const [searchChatModel, setSearchChatModel] = useState<string>('');

  const router = useRouter();
  const searchParams = useSearchParams();

  const queryClient = useQueryClient();
  const defaultsSavedRef = useRef(false);
  const isInitializedRef = useRef(false);
  const { data: configData } = useConfig();
  const { data: modelsData } = useModels(true);
  const { data: systemPromptsData } = useSystemPrompts();
  const { data: methodologiesData } = useSystemPrompts('methodology');
  const saveConfigMutation = useSaveConfig();
  const createSystemPromptMutation = useCreateSystemPrompt();
  const updateSystemPromptMutation = useUpdateSystemPrompt();
  const deleteSystemPromptMutation = useDeleteSystemPrompt();

  const activeSection: SectionKey =
    (searchParams.get('section') as SectionKey) || 'preferences';

  const setActiveSection = useCallback(
    (key: SectionKey) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('section', key);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!configData || isInitializedRef.current) return;
    isInitializedRef.current = true;
    const data = configData as unknown as SettingsType;

    setConfig(data);
    setHiddenModels(data.hiddenModels || []);

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

    const linkFlag = data.linkSystemToChat ?? true;
    setLinkSystemToChat(linkFlag);

    const systemModelProvider = linkFlag
      ? chatModelProvider
      : data.selectedSystemModelProvider || defaultChatModelProvider || '';
    const systemModel = linkFlag
      ? chatModel
      : data.selectedSystemModel ||
        (data.chatModelProviders &&
        data.chatModelProviders[systemModelProvider]?.length > 0
          ? data.chatModelProviders[systemModelProvider][0].name
          : undefined) ||
        '';

    const embeddingModelProvider =
      data.selectedEmbeddingModelProvider ||
      defaultEmbeddingModelProvider ||
      '';
    const embeddingModel =
      data.selectedEmbeddingModel ||
      (data.embeddingModelProviders &&
        data.embeddingModelProviders[embeddingModelProvider]?.[0].name) ||
      '';

    setSelectedChatModelProvider(chatModelProvider);
    setSelectedChatModel(chatModel);
    setSelectedSystemModelProvider(systemModelProvider);
    setSelectedSystemModel(systemModel);
    setSelectedEmbeddingModelProvider(embeddingModelProvider);
    setSelectedEmbeddingModel(embeddingModel);

    localStorage.setItem('systemModelProvider', systemModelProvider);
    localStorage.setItem('systemModel', systemModel);
    localStorage.setItem('embeddingModelProvider', embeddingModelProvider);
    localStorage.setItem('embeddingModel', embeddingModel);
    localStorage.setItem('linkSystemToChat', linkFlag.toString());

    if (
      (!data.selectedEmbeddingModelProvider || !data.selectedEmbeddingModel) &&
      !defaultsSavedRef.current
    ) {
      defaultsSavedRef.current = true;
      saveConfigMutation.mutate({
        ...data,
        selectedSystemModelProvider: systemModelProvider,
        selectedSystemModel: systemModel,
        selectedEmbeddingModelProvider: embeddingModelProvider,
        selectedEmbeddingModel: embeddingModel,
        linkSystemToChat: linkFlag,
      });
    }

    setChatModels(data.chatModelProviders || {});
    setEmbeddingModels(data.embeddingModelProviders || {});

    setAutomaticSuggestions(
      localStorage.getItem('autoSuggestions') !== 'false',
    );
    const storedContextWindow = parseInt(
      localStorage.getItem('contextWindowSize') ?? '32768',
    );
    setContextWindowSize(storedContextWindow);
    setIsCustomContextWindow(
      !predefinedContextSizes.includes(storedContextWindow),
    );

    const storedLocation =
      localStorage.getItem('personalization.location') || '';
    const storedAbout = localStorage.getItem('personalization.about') || '';
    setPersonalizationLocation(storedLocation);
    setPersonalizationAbout(storedAbout);

    setMemoryEnabled(localStorage.getItem('memoryEnabled') === 'true');
    setMemoryRetrievalEnabled(
      localStorage.getItem('memoryRetrievalEnabled') === 'true',
    );
    setMemoryAutoDetectionEnabled(
      localStorage.getItem('memoryAutoDetectionEnabled') === 'true',
    );

    const duration = data.privateSessionDurationMinutes ?? 1440;
    setPrivateSessionDurationMinutes(duration);
    const isPredefined = [5, 15, 30, 60, 480, 1440, 4320, 10080].includes(
      duration,
    );
    setIsCustomPrivateDuration(!isPredefined);
    if (!isPredefined) {
      setCustomPrivateDurationInput(String(duration));
    }

    const storedSearchChatModelProvider = localStorage.getItem(
      'searchChatModelProvider',
    );
    const storedSearchChatModel = localStorage.getItem('searchChatModel');
    if (storedSearchChatModelProvider)
      setSearchChatModelProvider(storedSearchChatModelProvider);
    if (storedSearchChatModel) setSearchChatModel(storedSearchChatModel);

    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configData]);

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
      const modelSelectionKeys = [
        'systemModelProvider',
        'systemModel',
        'embeddingModelProvider',
        'embeddingModel',
        'linkSystemToChat',
      ];

      const configKeyMap: Record<string, string> = {
        systemModelProvider: 'selectedSystemModelProvider',
        systemModel: 'selectedSystemModel',
        embeddingModelProvider: 'selectedEmbeddingModelProvider',
        embeddingModel: 'selectedEmbeddingModel',
        linkSystemToChat: 'linkSystemToChat',
      };

      if (modelSelectionKeys.includes(key)) {
        localStorage.setItem(key, value.toString());

        const configPayload = {
          [configKeyMap[key]]: value,
        } as Partial<SettingsType>;

        await saveConfigMutation.mutateAsync(
          configPayload as Record<string, unknown>,
        );

        if (key === 'embeddingModel' || key === 'embeddingModelProvider') {
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
        }

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

        const currentSystemProvider = selectedSystemModelProvider;
        const newSystemProviders = Object.keys(data.chatModelProviders || {});

        if (!currentSystemProvider && newSystemProviders.length > 0) {
          const firstProvider = newSystemProviders[0];
          const firstModel = data.chatModelProviders[firstProvider]?.[0]?.name;
          if (firstModel) {
            setSelectedSystemModelProvider(firstProvider);
            setSelectedSystemModel(firstModel);
            localStorage.setItem('systemModelProvider', firstProvider);
            localStorage.setItem('systemModel', firstModel);
          }
        } else if (
          currentSystemProvider &&
          (!data.chatModelProviders ||
            !data.chatModelProviders[currentSystemProvider] ||
            !Array.isArray(data.chatModelProviders[currentSystemProvider]) ||
            data.chatModelProviders[currentSystemProvider].length === 0)
        ) {
          const firstValidProvider = Object.entries(
            data.chatModelProviders || {},
          ).find(
            ([, models]) => Array.isArray(models) && models.length > 0,
          )?.[0];

          if (firstValidProvider) {
            setSelectedSystemModelProvider(firstValidProvider);
            setSelectedSystemModel(
              data.chatModelProviders[firstValidProvider][0].name,
            );
            localStorage.setItem('systemModelProvider', firstValidProvider);
            localStorage.setItem(
              'systemModel',
              data.chatModelProviders[firstValidProvider][0].name,
            );
          } else {
            setSelectedSystemModelProvider(null);
            setSelectedSystemModel(null);
            localStorage.removeItem('systemModelProvider');
            localStorage.removeItem('systemModel');
          }
        }

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

  const handleModelVisibilityToggle = async (
    modelKey: string,
    isVisible: boolean,
  ) => {
    let updatedHiddenModels: string[];

    if (isVisible) {
      updatedHiddenModels = hiddenModels.filter((m) => m !== modelKey);
    } else {
      updatedHiddenModels = [...hiddenModels, modelKey];
    }

    setHiddenModels(updatedHiddenModels);

    try {
      await saveConfig('hiddenModels', updatedHiddenModels);
    } catch (error) {
      console.error('Failed to save hidden models:', error);
      setHiddenModels(hiddenModels);
    }
  };

  const handleProviderVisibilityToggle = async (
    providerModels: Record<string, unknown>,
    showAll: boolean,
  ) => {
    const modelKeys = Object.keys(providerModels);
    let updatedHiddenModels: string[];

    if (showAll) {
      updatedHiddenModels = hiddenModels.filter(
        (modelKey) => !modelKeys.includes(modelKey),
      );
    } else {
      const modelsToHide = modelKeys.filter(
        (modelKey) => !hiddenModels.includes(modelKey),
      );
      updatedHiddenModels = [...hiddenModels, ...modelsToHide];
    }

    setHiddenModels(updatedHiddenModels);

    try {
      await saveConfig('hiddenModels', updatedHiddenModels);
    } catch (error) {
      console.error('Failed to save hidden models:', error);
      setHiddenModels(hiddenModels);
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

      {isLoading ? (
        <div className="flex flex-row items-center justify-center min-h-[50vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      ) : (
        config && (
          <>
            <MobileSettingsNav
              activeSection={activeSection}
              onSelect={setActiveSection}
            />

            <div className="flex flex-row gap-8 pb-28 lg:pb-8">
              <DesktopSettingsNav
                activeSection={activeSection}
                onSelect={setActiveSection}
              />
              <div className="flex-1 min-w-0">
                {activeSection === 'preferences' && <PreferencesSection />}

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
                    selectedChatModelProvider={selectedChatModelProvider}
                    selectedChatModel={selectedChatModel}
                    selectedSystemModelProvider={selectedSystemModelProvider}
                    selectedSystemModel={selectedSystemModel}
                    selectedEmbeddingModelProvider={
                      selectedEmbeddingModelProvider
                    }
                    selectedEmbeddingModel={selectedEmbeddingModel}
                    linkSystemToChat={linkSystemToChat}
                    contextWindowSize={contextWindowSize}
                    isCustomContextWindow={isCustomContextWindow}
                    savingStates={savingStates}
                    setSelectedChatModelProvider={setSelectedChatModelProvider}
                    setSelectedChatModel={setSelectedChatModel}
                    setSelectedSystemModelProvider={
                      setSelectedSystemModelProvider
                    }
                    setSelectedSystemModel={setSelectedSystemModel}
                    setSelectedEmbeddingModelProvider={
                      setSelectedEmbeddingModelProvider
                    }
                    setSelectedEmbeddingModel={setSelectedEmbeddingModel}
                    setLinkSystemToChat={setLinkSystemToChat}
                    setContextWindowSize={setContextWindowSize}
                    setIsCustomContextWindow={setIsCustomContextWindow}
                    setConfig={setConfig}
                    saveConfig={saveConfig}
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
                  <ImageGenerationSection
                    config={config}
                    savingStates={savingStates}
                    setConfig={setConfig}
                    saveConfig={saveConfig}
                  />
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
