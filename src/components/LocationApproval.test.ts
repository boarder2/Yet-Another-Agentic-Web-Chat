// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocationApproval from './LocationApproval';
import type { MapCoordinate } from '@/lib/maps/types';

const baseProps = {
  approvalId: 'approval-1',
  approvalSessionId: 'page-1',
  pageSessionId: 'page-1',
  reason: 'Find places near you',
  authorizedPurposes: ['nearby', 'routing', 'tiles'],
  authorizedHosts: ['nominatim.example', 'tiles.example'],
  providerHosts: ['nominatim.example'],
  tileHosts: ['tiles.example'],
  allowSave: true,
  onUse: vi.fn(),
  onUnavailable: vi.fn(),
  onCancel: vi.fn().mockResolvedValue(undefined),
};

let container: HTMLDivElement;
let root: Root;
let geolocationDescriptor: PropertyDescriptor | undefined;

function renderApproval(overrides: Record<string, unknown> = {}): void {
  root.render(
    createElement(LocationApproval, {
      ...baseProps,
      ...overrides,
    } as never),
  );
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`button not found: ${label}`);
  return match as HTMLButtonElement;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  geolocationDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    'geolocation',
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (geolocationDescriptor) {
    Object.defineProperty(navigator, 'geolocation', geolocationDescriptor);
  } else {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });
  }
  vi.clearAllMocks();
});

describe('LocationApproval', () => {
  it('does not request browser permission until the user explicitly chooses Use once', async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    await act(async () => renderApproval());
    expect(getCurrentPosition).not.toHaveBeenCalled();

    await act(async () => button('Use once').click());
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(baseProps.onUse).not.toHaveBeenCalled();
    expect(getCurrentPosition.mock.calls[0]?.[2]).toMatchObject({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10_000,
    });

    const success = getCurrentPosition.mock.calls[0]?.[0] as (
      position: GeolocationPosition,
    ) => void;
    await act(async () =>
      success({
        coords: { latitude: 40.1234, longitude: -75.5678 },
      } as GeolocationPosition),
    );

    expect(baseProps.onUse).toHaveBeenCalledWith(
      'approval-1',
      { lat: 40.1234, lon: -75.5678 } satisfies MapCoordinate,
      'once',
    );
  });

  it('discloses the configured hosts and hides save-in-answer for private approvals', async () => {
    await act(async () =>
      renderApproval({
        allowSave: false,
        approvalSessionId: undefined,
        pageSessionId: undefined,
      }),
    );

    expect(container.textContent).toContain('nominatim.example');
    expect(container.textContent).toContain('tiles.example');
    expect(container.textContent).toContain(
      'Saving the exact route is unavailable in private chats.',
    );
    expect(
      [...container.querySelectorAll('button')].some(
        (candidate) => candidate.textContent?.trim() === 'Use and save',
      ),
    ).toBe(false);
    expect(button('Use once')).toBeTruthy();
  });

  it('does not expose response controls to a different page session', async () => {
    await act(async () =>
      renderApproval({ approvalSessionId: 'page-1', pageSessionId: 'page-2' }),
    );

    expect(container.textContent).toContain(
      'Respond there to share your location.',
    );
    expect(
      [...container.querySelectorAll('button')].some((candidate) =>
        ['Use once', 'Use and save', 'Cancel'].includes(
          candidate.textContent?.trim() ?? '',
        ),
      ),
    ).toBe(false);
  });

  it('passes Use and save through only after the browser returns a valid coordinate', async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    await act(async () => renderApproval());
    await act(async () => button('Use and save').click());
    expect(baseProps.onUse).not.toHaveBeenCalled();

    const success = getCurrentPosition.mock.calls[0]?.[0] as (
      position: GeolocationPosition,
    ) => void;
    await act(async () =>
      success({
        coords: { latitude: 40.1234, longitude: -75.5678 },
      } as GeolocationPosition),
    );

    expect(baseProps.onUse).toHaveBeenCalledWith(
      'approval-1',
      { lat: 40.1234, lon: -75.5678 } satisfies MapCoordinate,
      'save',
    );
    expect(baseProps.onUnavailable).not.toHaveBeenCalled();
  });

  it('ignores a browser position that arrives after the approval expires', async () => {
    vi.useFakeTimers();
    try {
      const getCurrentPosition = vi.fn();
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition },
      });
      const expiresAt = Date.now() + 1_000;

      await act(async () => renderApproval({ expiresAt }));
      await act(async () => button('Use once').click());
      const success = getCurrentPosition.mock.calls[0]?.[0] as (
        position: GeolocationPosition,
      ) => void;

      await act(async () => {
        vi.advanceTimersByTime(1_001);
      });
      expect(baseProps.onUnavailable).toHaveBeenCalledWith(
        'approval-1',
        'expired',
      );

      await act(async () =>
        success({
          coords: { latitude: 40.1234, longitude: -75.5678 },
        } as GeolocationPosition),
      );
      expect(baseProps.onUse).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports browser denial without exposing a coordinate to the resume callback', async () => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error: PositionErrorCallback) =>
        error({ code: 1, message: 'denied' } as GeolocationPositionError),
    );
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    await act(async () => renderApproval());
    await act(async () => button('Use once').click());

    expect(baseProps.onUnavailable).toHaveBeenCalledWith(
      'approval-1',
      'permission_denied',
    );
    expect(baseProps.onUse).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      'Browser location permission was denied.',
    );
  });

  it('reports unsupported or expired approvals without requesting browser location', async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });

    await act(async () => renderApproval());
    await act(async () => button('Use once').click());
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(baseProps.onUnavailable).toHaveBeenCalledWith(
      'approval-1',
      'unsupported',
    );

    act(() => root.unmount());
    root = createRoot(container);
    vi.clearAllMocks();
    await act(async () =>
      renderApproval({
        expiresAt: Date.now() - 1,
        approvalSessionId: undefined,
      }),
    );
    expect(baseProps.onUnavailable).toHaveBeenCalledWith(
      'approval-1',
      'expired',
    );
  });

  it('sends a coordinate-free cancellation without invoking geolocation', async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    await act(async () => renderApproval());
    await act(async () => button('Cancel').click());

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(baseProps.onCancel).toHaveBeenCalledWith('approval-1');
  });
});
