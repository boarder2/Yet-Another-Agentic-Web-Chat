'use client';

import { Settings as SettingsIcon, ArrowLeft } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Prompt } from '@/lib/types/prompt';
import { writeLocalStorage } from '@/lib/hooks/useLocalStorage';

import { SettingsType, SectionKey } from './types';
import {
  MobileSettingsNav,
  DesktopSettingsNav,
} from './components/SettingsNav';
import PreferencesSection from './sections/PreferencesSection';
import AutomaticSearchSection from './sections/AutomaticSearchSection';
import PersonalizationSection from './sections/PersonalizationSection';
import MemorySection from './sections/MemorySection';
import PrivateSessionsSection from './sections/PrivateSessionsSection';
import RetentionSection from './sections/RetentionSection';
import PersonaPromptsSection from './sections/PersonaPromptsSection';
import ResearchMethodologiesSection from './sections/ResearchMethodologiesSection';
import DefaultSearchSection from './sections/DefaultSearchSection';
import ModelSettingsSection from './sections/ModelSettingsSection';
import ModelVisibilitySection from './sections/ModelVisibilitySection';
import ApiKeysSection from './sections/ApiKeysSection';

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
  const [contextWindowSize, setContextWindowSize] = useState(2048);
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

  useEffect(() => {
    const fetchConfig = async () => {
      const res = await fetch(`/api/config`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = (await res.json()) as SettingsType;

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
        !data.selectedEmbeddingModelProvider ||
        !data.selectedEmbeddingModel
      ) {
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...data,
            selectedSystemModelProvider: systemModelProvider,
            selectedSystemModel: systemModel,
            selectedEmbeddingModelProvider: embeddingModelProvider,
            selectedEmbeddingModel: embeddingModel,
            linkSystemToChat: linkFlag,
          }),
        }).catch(() => {});
      }

      setChatModels(data.chatModelProviders || {});
      setEmbeddingModels(data.embeddingModelProviders || {});

      setAutomaticSuggestions(
        localStorage.getItem('autoSuggestions') !== 'false',
      );
      const storedContextWindow = parseInt(
        localStorage.getItem('ollamaContextWindow') ?? '2048',
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

      setIsLoading(false);
    };

    const fetchAllModels = async () => {
      try {
        const res = await fetch(`/api/models?include_hidden=true`, {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (res.ok) {
          const data = await res.json();
          setAllModels({
            chat: data.chatModelProviders || {},
            embedding: data.embeddingModelProviders || {},
          });
        }
      } catch (error) {
        console.error('Failed to fetch all models:', error);
      }
    };

    fetchConfig();
    fetchAllModels();

    const loadSearchSettings = () => {
      const storedSearchChatModelProvider = localStorage.getItem(
        'searchChatModelProvider',
      );
      const storedSearchChatModel = localStorage.getItem('searchChatModel');

      if (storedSearchChatModelProvider) {
        setSearchChatModelProvider(storedSearchChatModelProvider);
      }
      if (storedSearchChatModel) {
        setSearchChatModel(storedSearchChatModel);
      }
    };

    loadSearchSettings();

    const fetchSystemPrompts = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/system-prompts');
        if (response.ok) {
          const prompts = await response.json();
          const availablePrompts = prompts.filter((p: Prompt) => !p.readOnly);
          setUserSystemPrompts(availablePrompts);
        } else {
          console.error('Failed to load system prompts.');
        }
      } catch (_error) {
        console.error('Error loading system prompts.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSystemPrompts();

    const fetchMethodologies = async () => {
      try {
        const response = await fetch('/api/system-prompts?type=methodology');
        if (response.ok) {
          const methodologies = await response.json();
          setUserMethodologies(
            methodologies.filter((p: Prompt) => !p.readOnly),
          );
        }
      } catch (_error) {
        console.error('Error loading methodologies.');
      }
    };

    fetchMethodologies();
  }, []);

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
          ...config,
          [configKeyMap[key]]: value,
        } as SettingsType;

        await fetch(`/api/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configPayload),
        });

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

      const response = await fetch(`/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedConfig),
      });

      if (!response.ok) {
        throw new Error('Failed to update config');
      }

      setConfig(updatedConfig);

      if (
        key.toLowerCase().includes('api') ||
        key.toLowerCase().includes('url')
      ) {
        const res = await fetch(`/api/config`, {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          throw new Error('Failed to fetch updated config');
        }

        const data = await res.json();

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
      } else if (key === 'ollamaContextWindow') {
        localStorage.setItem('ollamaContextWindow', value.toString());
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

  const handleAddOrUpdateSystemPrompt = async () => {
    const currentPrompt = editingPrompt || {
      name: newPromptName,
      content: newPromptContent,
      type: newPromptType,
    };
    if (!currentPrompt.name.trim() || !currentPrompt.content.trim()) {
      console.error('Prompt name and content cannot be empty.');
      return;
    }

    const url = editingPrompt
      ? `/api/system-prompts/${editingPrompt.id}`
      : '/api/system-prompts';
    const method = editingPrompt ? 'PUT' : 'POST';
    const body = JSON.stringify({
      name: currentPrompt.name,
      content: currentPrompt.content,
      type: currentPrompt.type,
    });

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response.ok) {
        const savedPrompt = await response.json();
        if (editingPrompt) {
          setUserSystemPrompts(
            userSystemPrompts.map((p) =>
              p.id === savedPrompt.id ? savedPrompt : p,
            ),
          );
          setEditingPrompt(null);
        } else {
          setUserSystemPrompts([...userSystemPrompts, savedPrompt]);
          setNewPromptName('');
          setNewPromptContent('');
          setNewPromptType('persona');
          setIsAddingNewPrompt(false);
        }
        console.log(`System prompt ${editingPrompt ? 'updated' : 'added'}.`);
      } else {
        const errorData = await response.json();
        console.error(
          errorData.error ||
            `Failed to ${editingPrompt ? 'update' : 'add'} prompt.`,
        );
      }
    } catch (_error) {
      console.error(`Error ${editingPrompt ? 'updating' : 'adding'} prompt.`);
    }
  };

  const handleDeleteSystemPrompt = async (promptId: string) => {
    if (!confirm('Are you sure you want to delete this prompt?')) return;
    try {
      const response = await fetch(`/api/system-prompts/${promptId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setUserSystemPrompts(
          userSystemPrompts.filter((p) => p.id !== promptId),
        );
        console.log('System prompt deleted.');
      } else {
        const errorData = await response.json();
        console.error(errorData.error || 'Failed to delete prompt.');
      }
    } catch (_error) {
      console.error('Error deleting prompt.');
    }
  };

  const handleAddOrUpdateMethodology = async () => {
    const currentMethodology = editingMethodology || {
      name: newMethodologyName,
      content: newMethodologyContent,
    };
    if (!currentMethodology.name.trim() || !currentMethodology.content.trim()) {
      console.error('Methodology name and content cannot be empty.');
      return;
    }

    const url = editingMethodology
      ? `/api/system-prompts/${editingMethodology.id}`
      : '/api/system-prompts';
    const method = editingMethodology ? 'PUT' : 'POST';
    const body = JSON.stringify({
      name: currentMethodology.name,
      content: currentMethodology.content,
      type: 'methodology',
    });

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response.ok) {
        const saved = await response.json();
        if (editingMethodology) {
          setUserMethodologies(
            userMethodologies.map((m) => (m.id === saved.id ? saved : m)),
          );
          setEditingMethodology(null);
        } else {
          setUserMethodologies([...userMethodologies, saved]);
          setNewMethodologyName('');
          setNewMethodologyContent('');
          setIsAddingNewMethodology(false);
        }
      } else {
        const errorData = await response.json();
        console.error(
          errorData.error ||
            `Failed to ${editingMethodology ? 'update' : 'add'} methodology.`,
        );
      }
    } catch (_error) {
      console.error(
        `Error ${editingMethodology ? 'updating' : 'adding'} methodology.`,
      );
    }
  };

  const handleDeleteMethodology = async (methodologyId: string) => {
    if (!confirm('Are you sure you want to delete this methodology?')) return;
    try {
      const response = await fetch(`/api/system-prompts/${methodologyId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setUserMethodologies(
          userMethodologies.filter((m) => m.id !== methodologyId),
        );
      } else {
        const errorData = await response.json();
        console.error(errorData.error || 'Failed to delete methodology.');
      }
    } catch (_error) {
      console.error('Error deleting methodology.');
    }
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
          <svg
            aria-hidden="true"
            className="w-8 h-8 text-surface-2 fill-surface animate-spin"
            viewBox="0 0 100 101"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M100 50.5908C100.003 78.2051 78.1951 100.003 50.5908 100C22.9765 99.9972 0.997224 78.018 1 50.4037C1.00281 22.7993 22.8108 0.997224 50.4251 1C78.0395 1.00281 100.018 22.8108 100 50.4251ZM9.08164 50.594C9.06312 73.3997 27.7909 92.1272 50.5966 92.1457C73.4023 92.1642 92.1298 73.4365 92.1483 50.6308C92.1669 27.8251 73.4392 9.0973 50.6335 9.07878C27.8278 9.06026 9.10003 27.787 9.08164 50.594Z"
              fill="currentColor"
            />
            <path
              d="M93.9676 39.0409C96.393 38.4037 97.8624 35.9116 96.9801 33.5533C95.1945 28.8227 92.871 24.3692 90.0681 20.348C85.6237 14.1775 79.4473 9.36872 72.0454 6.45794C64.6435 3.54717 56.3134 2.65431 48.3133 3.89319C45.869 4.27179 44.3768 6.77534 45.014 9.20079C45.6512 11.6262 48.1343 13.0956 50.5786 12.717C56.5073 11.8281 62.5542 12.5399 68.0406 14.7911C73.527 17.0422 78.2187 20.7487 81.5841 25.4923C83.7976 28.5886 85.4467 32.059 86.4416 35.7474C87.1273 38.1189 89.5423 39.6781 91.9676 39.0409Z"
              fill="currentFill"
            />
          </svg>
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

                {activeSection === 'private-sessions' && (
                  <PrivateSessionsSection
                    privateSessionDurationMinutes={
                      privateSessionDurationMinutes
                    }
                    isCustomPrivateDuration={isCustomPrivateDuration}
                    customPrivateDurationInput={customPrivateDurationInput}
                    savingStates={savingStates}
                    setPrivateSessionDurationMinutes={
                      setPrivateSessionDurationMinutes
                    }
                    setIsCustomPrivateDuration={setIsCustomPrivateDuration}
                    setCustomPrivateDurationInput={
                      setCustomPrivateDurationInput
                    }
                    setConfig={setConfig}
                    saveConfig={saveConfig}
                  />
                )}

                {activeSection === 'retention' && (
                  <RetentionSection
                    config={config}
                    savingStates={savingStates}
                    setConfig={setConfig}
                    saveConfig={saveConfig}
                  />
                )}

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
