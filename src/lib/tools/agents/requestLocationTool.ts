import { z } from 'zod';
import { Command, interrupt } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { defineTool } from '@/lib/tools/defineTool';
import {
  LocationApprovalPayloadSchema,
  LocationTokenResumeResponseSchema,
  LocationApprovalResponseSchema,
  getLocationSession,
  revokeLocationToken,
  type LocationDeclineReason,
} from '@/lib/maps/locationSessions';
import { mappingConfigurationFingerprint } from '@/lib/maps/runtime';
import { currentMappingService } from './mappingToolUtils';
import {
  currentLocationForPurpose,
  mappingHostsForApproval,
  type MappingToolRuntime,
} from './mappingToolUtils';

const RequestLocationToolSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .optional()
      .describe('Brief reason the answer needs the current location.'),
  })
  .strict();

function resultCommand(content: string, toolCallId: string): Command {
  return new Command({
    update: {
      messages: [new ToolMessage({ content, tool_call_id: toolCallId })],
    },
  });
}

function declineReason(value: unknown): LocationDeclineReason | undefined {
  if (
    value === 'cancelled' ||
    value === 'permission_denied' ||
    value === 'unsupported' ||
    value === 'timeout' ||
    value === 'unavailable' ||
    value === 'expired'
  ) {
    return value;
  }
  return undefined;
}

function hasApprovedSession(runtime: MappingToolRuntime): boolean {
  return Boolean(
    currentLocationForPurpose(runtime.context, 'nearby') ||
    currentLocationForPurpose(runtime.context, 'routing'),
  );
}

export const requestLocationTool = defineTool(
  async (
    input: z.infer<typeof RequestLocationToolSchema>,
    runtime: MappingToolRuntime,
  ): Promise<Command> => {
    const { context } = runtime;
    const toolCallId = runtime.toolCallId;
    if (!context.interactiveSession || !context.emitter) {
      return resultCommand(
        'Current browser location requires a top-level interactive session. Ask for a named origin instead.',
        toolCallId,
      );
    }

    const service = currentMappingService(context);
    const config = context.mappingConfig;
    if (!service || !config?.available) {
      return resultCommand(
        'Current browser location is unavailable for this turn. Ask for a named locality or origin instead; do not infer a location.',
        toolCallId,
      );
    }
    if (!context.clientSessionId || !context.assistantMessageId) {
      return resultCommand(
        'Current browser location needs an active page session. Ask for a named locality or origin instead.',
        toolCallId,
      );
    }
    if (hasApprovedSession(runtime)) {
      return resultCommand(
        'Current location was already approved for this turn. Use it only for the authorized nearby or routing operation; never request or expose its coordinates.',
        toolCallId,
      );
    }

    const purposes = [
      ...(config.capabilities.nearby ? (['nearby'] as const) : []),
      ...(config.capabilities.routing ? (['routing'] as const) : []),
      ...(config.capabilities.tiles ? (['tiles'] as const) : []),
    ];
    if (!purposes.includes('nearby') && !purposes.includes('routing')) {
      return resultCommand(
        'The configured mapping provider cannot use a current browser location for this request. Ask for a named origin or locality instead.',
        toolCallId,
      );
    }

    const hosts = mappingHostsForApproval(context);
    const createdAt = Date.now();
    const payload = LocationApprovalPayloadSchema.parse({
      ...(input.reason ? { reason: input.reason } : {}),
      authorizedPurposes: purposes,
      authorizedHosts: hosts.authorizedHosts,
      providerHosts: hosts.providerHosts,
      tileHosts: hosts.tileHosts,
      configHash: mappingConfigurationFingerprint(config),
      clientSessionId: context.clientSessionId,
      aiMessageId: context.assistantMessageId,
      allowSave: !context.isPrivate,
      createdAt,
      expiresAt: createdAt + 10 * 60 * 1000,
    });

    // The interrupt payload contains only disclosure and retention metadata.
    // The browser coordinate is submitted later to /api/maps/location.
    const response: unknown = interrupt({
      kind: 'location',
      toolCallId,
      payload,
      snapshot: null,
    });

    const tokenResponse = LocationTokenResumeResponseSchema.safeParse(response);
    if (tokenResponse.success) {
      const approvedSession = getLocationSession(
        tokenResponse.data.locationToken,
        {
          binding: {
            runId: context.threadId,
            chatId: context.chatId,
            messageId: context.messageId,
            aiMessageId: context.assistantMessageId,
            clientSessionId: tokenResponse.data.clientSessionId,
          },
          authorizedHosts: mappingHostsForApproval(context).authorizedHosts,
          configHash: mappingConfigurationFingerprint(config),
        },
      );
      if (context.isPrivate && tokenResponse.data.retention === 'save') {
        revokeLocationToken(tokenResponse.data.locationToken);
        return resultCommand(
          'Saving a precise route is unavailable in a private chat. Ask for a named origin instead.',
          toolCallId,
        );
      }
      if (!payload.allowSave && tokenResponse.data.retention === 'save') {
        revokeLocationToken(tokenResponse.data.locationToken);
        return resultCommand(
          'This location approval does not allow saving the route in the answer. Ask for a named origin instead.',
          toolCallId,
        );
      }
      if (
        !approvedSession ||
        approvedSession.retention !== tokenResponse.data.retention ||
        !approvedSession.authorizedPurposes.some(
          (purpose) => purpose === 'nearby' || purpose === 'routing',
        )
      ) {
        revokeLocationToken(tokenResponse.data.locationToken);
        return resultCommand(
          'Current location approval expired or became invalid. Ask the user for a named origin instead.',
          toolCallId,
        );
      }
      return resultCommand(
        'Current location approved for this turn. The server may use it only for the authorized nearby or routing operation. Coordinates are not included in this response.',
        toolCallId,
      );
    }

    const declined = LocationApprovalResponseSchema.safeParse(response);
    if (
      declined.success &&
      !declined.data.approved &&
      declined.data.clientSessionId !== undefined &&
      declined.data.clientSessionId !== context.clientSessionId
    ) {
      return resultCommand(
        'Current location approval belonged to another page session. Ask for a named origin instead.',
        toolCallId,
      );
    }
    if (declined.success && !declined.data.approved) {
      const reason = declineReason(declined.data.reason);
      return resultCommand(
        reason === 'permission_denied'
          ? 'The user denied browser location. Ask for a named origin or locality instead.'
          : reason === 'unsupported'
            ? 'Browser location is not supported here. Ask for a named origin or locality instead.'
            : reason === 'expired'
              ? 'The browser location approval expired. Ask for a named origin or locality instead.'
              : 'The user did not approve browser location. Ask for a named origin or locality instead.',
        toolCallId,
      );
    }

    return resultCommand(
      'Current location approval was invalid or expired. Ask for a named origin or locality instead.',
      toolCallId,
    );
  },
  {
    name: 'request_location',
    description:
      'Request explicit browser-location approval before using the current location for nearby search or a route. The user sees every authorized provider/tile host and chooses Use once, Use and save, or Cancel. Never ask for or expose coordinates, and never use IP geolocation.',
    schema: RequestLocationToolSchema,
  },
);
