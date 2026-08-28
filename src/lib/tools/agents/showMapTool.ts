import { z } from 'zod';
import { emitStreamEvent } from '@/lib/streaming/events';
import { MAP_LIMITS } from '@/lib/maps/types';
import { TurnMapRegistryError } from '@/lib/maps/turnMapRegistry';
import { defineTool } from '@/lib/tools/defineTool';
import { mapForHandle, type MappingToolRuntime } from './mappingToolUtils';

export const ShowMapToolSchema = z
  .object({
    handle: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxPlaceIdLength)
      .optional()
      .describe('A mapHandle or routeHandle returned by a mapping tool.'),
    /** Alias for clients that name the field after the map handle. */
    mapHandle: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxPlaceIdLength)
      .optional()
      .describe('Alias for handle; use only a registered short handle.'),
  })
  .strict()
  .superRefine((input, ctx) => {
    const handle = input.handle ?? input.mapHandle;
    if (!handle) {
      ctx.addIssue({
        code: 'custom',
        path: ['handle'],
        message: 'handle or mapHandle is required',
      });
      return;
    }
    if (input.mapHandle && input.handle && input.mapHandle !== input.handle) {
      ctx.addIssue({
        code: 'custom',
        path: ['mapHandle'],
        message: 'handle and mapHandle must match',
      });
    }
    if (!/^map_[1-9]\d*$/.test(handle) && !/^route_[1-9]\d*$/.test(handle)) {
      ctx.addIssue({
        code: 'custom',
        path: ['handle'],
        message: 'only a registered mapHandle or routeHandle may be used',
      });
    }
  });

export const showMapTool = defineTool(
  async (
    input: z.infer<typeof ShowMapToolSchema>,
    runtime: MappingToolRuntime,
  ): Promise<string> => {
    if (runtime.context.retrievalSignal?.aborted || runtime.signal?.aborted) {
      return 'Mapping operation was cancelled.';
    }
    // Placement uses only the provider-validated snapshot already in the
    // current-turn registry; it does not make a provider call.
    const handle = input.handle ?? input.mapHandle;
    if (!handle)
      return 'Error: A registered mapHandle or routeHandle is required.';
    const registration = mapForHandle(runtime, handle);
    if (!registration) {
      return `Error: No registered map matches "${handle}". Use a mapHandle returned by search_places or get_route.`;
    }

    const snapshot = runtime.context.mapRegistry.snapshot();
    try {
      const placement = runtime.context.mapRegistry.place(registration.handle);
      emitStreamEvent(runtime.context.emitter, {
        type: 'map_placement',
        data: {
          placementId: placement.placementId,
          mapId: placement.mapId,
          handle: placement.handle,
          placementNumber: placement.placementNumber,
        },
      });
      return JSON.stringify({
        handle,
        mapHandle: placement.handle,
        title: placement.title,
        pinCount: placement.spec.places.length,
        hasRoute: Boolean(placement.spec.route),
      });
    } catch (error) {
      try {
        runtime.context.mapRegistry.restore(snapshot);
      } catch {
        // Keep a placement failure isolated from the ordinary answer.
      }
      if (error instanceof TurnMapRegistryError) {
        return `Error: ${error.message}`;
      }
      return 'Error: The map could not be shown. Keep the validated textual summary and links.';
    }
  },
  {
    name: 'show_map',
    description:
      'Place the one writer-owned inline map for this answer. Pass only a mapHandle or routeHandle returned by search_places or get_route; never write map markup, coordinates, or internal IDs. Keep the equivalent numbered prose list in the answer. A turn can show at most one map.',
    schema: ShowMapToolSchema,
  },
);
