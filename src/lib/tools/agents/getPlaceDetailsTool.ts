import { z } from 'zod';
import { Command } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { MAP_LIMITS } from '@/lib/maps/types';
import { defineTool } from '@/lib/tools/defineTool';
import {
  currentDocumentCount,
  currentMappingService,
  mappingSignal,
  mappingToolError,
  mappingUnavailable,
  outputPlace,
  placeByHandle,
  placeDocument,
  type MappingToolRuntime,
} from './mappingToolUtils';

export const GetPlaceDetailsToolSchema = z
  .object({
    placeHandle: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxPlaceIdLength)
      .optional()
      .describe('The short placeHandle returned by search_places.'),
    /** Alias for bridges that use a generic handle field. */
    handle: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxPlaceIdLength)
      .optional()
      .describe('Alias for placeHandle; use only a registered short handle.'),
  })
  .strict()
  .superRefine((input, ctx) => {
    const handle = input.placeHandle ?? input.handle;
    if (!handle) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeHandle'],
        message: 'placeHandle is required',
      });
      return;
    }
    if (!/^place_[1-9]\d*$/.test(handle)) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeHandle'],
        message: 'only a registered placeHandle may be used',
      });
    }
    if (
      input.placeHandle &&
      input.handle &&
      input.placeHandle !== input.handle
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['handle'],
        message: 'placeHandle and handle must match',
      });
    }
  });

function resultCommand(
  content: string,
  toolCallId: string,
  documents: import('@langchain/core/documents').Document[] = [],
): Command {
  return new Command({
    update: {
      relevantDocuments: documents,
      messages: [new ToolMessage({ content, tool_call_id: toolCallId })],
    },
  });
}

export const getPlaceDetailsTool = defineTool(
  async (
    input: z.infer<typeof GetPlaceDetailsToolSchema>,
    runtime: MappingToolRuntime,
  ): Promise<Command> => {
    const signal = mappingSignal(runtime);
    const placeHandle = input.placeHandle ?? input.handle;
    if (!placeHandle) {
      return resultCommand(
        'Error: A registered placeHandle is required.',
        runtime.toolCallId,
      );
    }
    if (signal?.aborted) {
      return resultCommand(
        'Mapping operation was cancelled.',
        runtime.toolCallId,
      );
    }

    try {
      const reference = placeByHandle(runtime, placeHandle);
      if (!reference) {
        return resultCommand(
          `Error: No registered place matches "${placeHandle}". Use a placeHandle returned by search_places; do not provide a provider ID.`,
          runtime.toolCallId,
        );
      }
      const service = currentMappingService(runtime.context);
      if (!service)
        return resultCommand(mappingUnavailable(), runtime.toolCallId);
      const result = await service.getPlaceDetails(
        { placeId: reference.place.id },
        signal,
      );
      if (signal?.aborted) {
        return resultCommand(
          'Mapping operation was cancelled.',
          runtime.toolCallId,
        );
      }

      // A provider must not silently substitute another identity for the one
      // the model selected. Coordinates and provider IDs remain server-side.
      if (
        result.place.id !== reference.place.id ||
        result.place.provider !== reference.place.provider ||
        result.place.sourceUrl !== reference.place.sourceUrl
      ) {
        return resultCommand(
          'Error: The mapping provider returned a different place identity; no details were added.',
          runtime.toolCallId,
        );
      }

      const document = placeDocument(
        result.place,
        currentDocumentCount() + 1,
        result.place.name,
        placeHandle,
        { details: true },
      );
      return resultCommand(
        JSON.stringify({
          place: outputPlace(result.place, placeHandle),
          provider: result.provider,
          attribution: result.attribution,
          retrievedAt: result.retrievedAt,
        }),
        runtime.toolCallId,
        [document],
      );
    } catch (error) {
      return resultCommand(mappingToolError(error, signal), runtime.toolCallId);
    }
  },
  {
    name: 'get_place_details',
    description:
      'Retrieve available provider details for a place returned by search_places. Pass only its short placeHandle, never a raw provider ID or coordinates. Ratings, hours, phone, and other facts are returned only when the provider supplies them and must be cited from the returned source.',
    schema: GetPlaceDetailsToolSchema,
  },
);
