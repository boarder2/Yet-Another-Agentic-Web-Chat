import { z } from 'zod';
import { emitStreamEvent } from '@/lib/streaming/events';
import { MAP_LIMITS } from '@/lib/maps/types';
import { TurnMapRegistryError } from '@/lib/maps/turnMapRegistry';
import { defineTool } from '@/lib/tools/defineTool';
import {
  emitLocationOverlay,
  type MappingToolRuntime,
} from './mappingToolUtils';

const ShortPlaceHandleSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAP_LIMITS.maxPlaceIdLength)
  .regex(
    /^place_[1-9]\d*$/,
    'only a placeHandle returned by search_places is valid',
  );

const ShortRouteHandleSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAP_LIMITS.maxPlaceIdLength)
  .regex(
    /^route_[1-9]\d*$/,
    'only a routeHandle returned by get_route is valid',
  );

export const ShowMapToolSchema = z
  .object({
    placeHandles: z
      .array(ShortPlaceHandleSchema)
      .max(128)
      .optional()
      .describe('Selected placeHandles returned by search_places.'),
    routeHandle: ShortRouteHandleSchema.optional().describe(
      'Optional routeHandle returned by get_route.',
    ),
    title: z
      .string()
      .trim()
      .max(240)
      .optional()
      .describe('Optional short title for this map.'),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      (!input.placeHandles || input.placeHandles.length === 0) &&
      !input.routeHandle
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeHandles'],
        message: 'select at least one placeHandle or provide a routeHandle',
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

    try {
      // Composition is the only map-construction boundary. Discovery tools
      // leave validated records in the turn registry for this explicit call.
      const placement = runtime.context.mapRegistry.composeMap({
        ...(input.placeHandles ? { placeHandles: input.placeHandles } : {}),
        ...(input.routeHandle ? { routeHandle: input.routeHandle } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
      });
      emitStreamEvent(runtime.context.emitter, {
        type: 'map_spec',
        data: {
          mapId: placement.mapId,
          spec: placement.spec,
          source: 'show_map',
        },
      });
      emitStreamEvent(runtime.context.emitter, {
        type: 'map_placement',
        data: {
          placementId: placement.placementId,
          mapId: placement.mapId,
          placementNumber: placement.placementNumber,
        },
      });

      const overlay = runtime.context.mapRegistry.resolveSessionOverlay(
        placement.mapId,
      );
      if (overlay) {
        emitLocationOverlay(runtime, placement.mapId, overlay);
      }

      return JSON.stringify({
        title: placement.title,
        pinCount: placement.pinCount ?? placement.spec.places.length,
        hasRoute: Boolean(placement.spec.route),
      });
    } catch (error) {
      if (error instanceof TurnMapRegistryError) {
        return `Error: ${error.message}`;
      }
      return 'Error: The map could not be shown. Keep the validated textual summary and links.';
    }
  },
  {
    name: 'show_map',
    description:
      'Compose and display one independent writer-owned inline map from selected placeHandles and an optional routeHandle returned by mapping tools. Never write map markup, coordinates, or private IDs. Each successful call creates one immutable placement and may be repeated for different groupings; there is no per-answer map-count limit. A map needs at least one selected place or route, contains at most 12 unique pins including route endpoints, and has at most one route. Invalid handle selections fail atomically without a partial map. Keep the equivalent numbered prose in the answer.',
    schema: ShowMapToolSchema,
  },
);
