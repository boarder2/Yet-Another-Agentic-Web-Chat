'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, LocateFixed, MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import ApprovalPanel, { ApprovalChip } from '@/components/ui/ApprovalPanel';
import type { MapCoordinate } from '@/lib/maps/types';
import type {
  LocationDeclineReason,
  LocationRetention,
} from '@/lib/maps/locationSchemas';

export type LocationApprovalProps = {
  approvalId: string;
  /** Session recorded with the approval request, when available. */
  approvalSessionId?: string;
  /** Current ChatWindow page session. */
  pageSessionId?: string;
  reason?: string;
  authorizedPurposes: string[];
  authorizedHosts: string[];
  providerHosts: string[];
  tileHosts: string[];
  allowSave: boolean;
  expiresAt?: number;
  onUse: (
    approvalId: string,
    coordinates: MapCoordinate,
    retention: LocationRetention,
  ) => Promise<void> | void;
  onUnavailable: (
    approvalId: string,
    reason: LocationDeclineReason,
  ) => Promise<void> | void;
  onCancel: (approvalId: string) => Promise<void> | void;
  onDismiss?: () => void;
  queuePosition?: number;
  queueTotal?: number;
};

function declineReason(error: GeolocationPositionError): LocationDeclineReason {
  if (error.code === 1) return 'permission_denied';
  if (error.code === 3) return 'timeout';
  return 'unavailable';
}

function validCoordinate(position: GeolocationPosition): MapCoordinate | null {
  const { latitude: lat, longitude: lon } = position.coords;
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
    ? { lat, lon }
    : null;
}

function hostLabel(host: string): string {
  return host.replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 255);
}

export default function LocationApproval({
  approvalId,
  approvalSessionId,
  pageSessionId,
  reason,
  authorizedPurposes,
  authorizedHosts,
  providerHosts,
  tileHosts,
  allowSave,
  expiresAt,
  onUse,
  onUnavailable,
  onCancel,
  onDismiss,
  queuePosition,
  queueTotal,
}: LocationApprovalProps) {
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState('');
  const submittedRef = useRef(false);
  const activeAttemptRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const canRespond =
    pageSessionId === undefined ||
    approvalSessionId === undefined ||
    pageSessionId === approvalSessionId;

  const completeWithFailure = useCallback(
    async (failure: LocationDeclineReason) => {
      try {
        await onUnavailable(approvalId, failure);
      } catch {
        submittedRef.current = false;
        setSubmitted(false);
        setStatus('Location could not be shared. You can try again or cancel.');
      }
    },
    [approvalId, onUnavailable],
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      activeAttemptRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!canRespond || expiresAt === undefined) return;
    const expire = () => {
      // An active browser prompt may outlive the approval. Invalidate its
      // callback before reporting expiry so a late position can never be sent.
      if (submittedRef.current && activeAttemptRef.current === null) return;
      activeAttemptRef.current = null;
      submittedRef.current = true;
      setSubmitted(true);
      setStatus('This location approval has expired.');
      void completeWithFailure('expired');
    };
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    const timer = setTimeout(expire, remaining);
    return () => clearTimeout(timer);
  }, [canRespond, completeWithFailure, expiresAt]);

  const requestLocation = useCallback(
    async (retention: LocationRetention) => {
      if (!canRespond || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitted(true);
      const attempt = ++attemptRef.current;
      activeAttemptRef.current = attempt;
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        activeAttemptRef.current = null;
        setStatus('This location approval has expired.');
        await completeWithFailure('expired');
        return;
      }
      setStatus('Requesting your browser location…');

      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        activeAttemptRef.current = null;
        setStatus('Browser location is not supported here.');
        await completeWithFailure('unsupported');
        return;
      }

      const handlePosition = (position: GeolocationPosition) => {
        if (
          !canRespond ||
          !mountedRef.current ||
          activeAttemptRef.current !== attempt
        )
          return;
        activeAttemptRef.current = null;
        if (expiresAt !== undefined && expiresAt <= Date.now()) {
          setStatus('This location approval has expired.');
          void completeWithFailure('expired');
          return;
        }
        const coordinates = validCoordinate(position);
        if (!coordinates) {
          setStatus('The browser returned an invalid location.');
          void completeWithFailure('unavailable');
          return;
        }
        setStatus('Sending the approved location to this turn…');
        Promise.resolve()
          .then(() => onUse(approvalId, coordinates, retention))
          .catch(() => {
            submittedRef.current = false;
            setSubmitted(false);
            setStatus(
              'Location could not be shared. You can try again or cancel.',
            );
          });
      };

      const handleError = (error: GeolocationPositionError) => {
        if (
          !canRespond ||
          !mountedRef.current ||
          activeAttemptRef.current !== attempt
        )
          return;
        activeAttemptRef.current = null;
        const failure = declineReason(error);
        setStatus(
          failure === 'permission_denied'
            ? 'Browser location permission was denied.'
            : 'The browser could not provide a location.',
        );
        void completeWithFailure(failure);
      };

      try {
        navigator.geolocation.getCurrentPosition(handlePosition, handleError, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10_000,
        });
      } catch {
        activeAttemptRef.current = null;
        setStatus('The browser could not provide a location.');
        void completeWithFailure('unavailable');
      }
    },
    [approvalId, canRespond, completeWithFailure, expiresAt, onUse],
  );

  const cancel = useCallback(async () => {
    if (!canRespond || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    setStatus('Cancelling location access…');
    try {
      await onCancel(approvalId);
    } catch {
      submittedRef.current = false;
      setSubmitted(false);
      setStatus('The request could not be cancelled. Try again.');
      return;
    }
    onDismiss?.();
  }, [approvalId, canRespond, onCancel, onDismiss]);

  const purposeLabels = authorizedPurposes.map((purpose) =>
    purpose === 'nearby'
      ? 'Nearby places'
      : purpose === 'routing'
        ? 'Routes'
        : 'Map tiles',
  );
  const uniqueHosts = [
    ...new Set(authorizedHosts.map(hostLabel).filter(Boolean)),
  ];

  return (
    <ApprovalPanel
      icon={LocateFixed}
      title="Use your current location?"
      chips={
        <>
          {purposeLabels.map((purpose) => (
            <ApprovalChip key={purpose}>{purpose}</ApprovalChip>
          ))}
        </>
      }
      queuePosition={queuePosition}
      queueTotal={queueTotal}
      onDismiss={() => {
        if (canRespond) void cancel();
        else onDismiss?.();
      }}
      dismissLabel={canRespond ? 'Cancel' : 'Close'}
      footer={
        canRespond ? (
          <>
            <Button
              size="lg"
              icon={X}
              onClick={() => void cancel()}
              disabled={submitted}
            >
              Cancel
            </Button>
            <Button
              size="lg"
              icon={MapPin}
              onClick={() => void requestLocation('once')}
              disabled={submitted}
            >
              Use once
            </Button>
            {allowSave && (
              <Button
                variant="primary"
                size="lg"
                icon={Check}
                onClick={() => void requestLocation('save')}
                disabled={submitted}
              >
                Use and save
              </Button>
            )}
          </>
        ) : (
          <p role="status" className="text-xs text-fg-muted">
            This request is open in another chat page. Respond there to share
            your location.
          </p>
        )
      }
    >
      <div className="space-y-3 border-b border-surface-2 px-5 py-4 text-sm">
        <p className="text-fg">
          YAAWC will use the precise browser location only for this turn&apos;s
          authorized mapping operations. No IP-based location is used.
        </p>
        {reason && <p className="text-fg-muted">{reason}</p>}
        <div>
          <p className="font-medium text-fg">Services that may receive it</p>
          {uniqueHosts.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-xs text-fg-muted">
              {uniqueHosts.map((host) => (
                <li key={host}>{host}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-fg-muted">
              No external service hosts are configured for this provider.
            </p>
          )}
          {(providerHosts.length > 0 || tileHosts.length > 0) && (
            <p className="mt-1 text-xs text-fg-subtle">
              Provider: {providerHosts.map(hostLabel).join(', ') || 'none'} ·
              Tiles: {tileHosts.map(hostLabel).join(', ') || 'none'}
            </p>
          )}
        </div>
        <p className="text-xs text-fg-muted">
          Use once keeps the exact origin and route in this page session only.
          {allowSave
            ? ' Use and save keeps the exact route in this answer only; it never saves a reusable profile location.'
            : ' Saving the exact route is unavailable in private chats.'}
        </p>
        {expiresAt && (
          <p className="text-xs text-fg-subtle">
            This approval expires {new Date(expiresAt).toLocaleTimeString()}.
          </p>
        )}
        {status && (
          <p role="status" aria-live="polite" className="text-xs text-accent">
            {status}
          </p>
        )}
      </div>
    </ApprovalPanel>
  );
}

export { LocationApproval };
