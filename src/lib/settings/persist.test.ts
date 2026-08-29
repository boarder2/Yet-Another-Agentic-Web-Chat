import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  patchSettings: vi.fn(),
}));

vi.mock('@/lib/hooks/api/useSettings', () => ({
  fetchSettings: vi.fn(),
  patchSettings: mocks.patchSettings,
}));

async function createPersistenceHarness() {
  vi.resetModules();
  class MemoryStorage {
    private readonly values = new Map<string, string>();

    get length() {
      return this.values.size;
    }

    clear() {
      this.values.clear();
    }

    getItem(key: string) {
      return this.values.get(key) ?? null;
    }

    key(index: number) {
      return [...this.values.keys()][index] ?? null;
    }

    removeItem(key: string) {
      this.values.delete(key);
    }

    setItem(key: string, value: string) {
      this.values.set(key, value);
    }
  }

  const storage = new MemoryStorage();
  const windowMock = new EventTarget();
  const documentMock = new EventTarget();
  Object.defineProperty(windowMock, 'localStorage', { value: storage });
  Object.defineProperty(documentMock, 'visibilityState', { value: 'visible' });
  vi.stubGlobal('window', windowMock);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', documentMock);

  const persist = await import('./persist');
  persist.installSettingsPersistence();
  return { persist, storage };
}

describe('settings persistence flush failures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.patchSettings.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('propagates explicit flush failures and retains the pending write for retry', async () => {
    const { persist, storage } = await createPersistenceHarness();
    const failure = new Error('offline');
    mocks.patchSettings
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);

    storage.setItem('openrouterQuantizations', '["fp8"]');

    await expect(persist.flushSettings()).rejects.toBe(failure);
    expect(mocks.patchSettings).toHaveBeenCalledTimes(1);
    expect(mocks.patchSettings).toHaveBeenLastCalledWith({
      openrouterQuantizations: '["fp8"]',
    });

    // A caller can retry without rewriting the setting because the failed key
    // remains pending after the rejected explicit flush.
    await expect(persist.flushSettings()).resolves.toBeUndefined();
    expect(mocks.patchSettings).toHaveBeenCalledTimes(2);
    expect(mocks.patchSettings).toHaveBeenLastCalledWith({
      openrouterQuantizations: '["fp8"]',
    });
  });

  it('swallows debounced failures while leaving the write retryable', async () => {
    const { persist, storage } = await createPersistenceHarness();
    mocks.patchSettings
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);

    storage.setItem('openrouterQuantizations', '["int4"]');
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.patchSettings).toHaveBeenCalledTimes(1);

    // The background rejection must not escape as an unhandled rejection, and
    // its pending key remains available to an explicit retry.
    await expect(persist.flushSettings()).resolves.toBeUndefined();
    expect(mocks.patchSettings).toHaveBeenCalledTimes(2);
    expect(mocks.patchSettings).toHaveBeenLastCalledWith({
      openrouterQuantizations: '["int4"]',
    });
  });
});
