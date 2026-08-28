import { z } from 'zod';
import { Command } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { MAP_LIMITS, MapPlaceSearchRequestSchema } from '@/lib/maps/types';
import { normalizeOverpassCategory } from '@/lib/maps/providers/overpass';
import { defineTool } from '@/lib/tools/defineTool';
import {
  currentDocumentCount,
  currentMappingService,
  mappingSignal,
  mappingToolError,
  mappingUnavailable,
  outputPlace,
  placeDocument,
  registerMapSpec,
  registerPlaces,
  emitLocationOverlay,
  currentLocationForPurpose,
  isCurrentLocationText,
  isSavedLocationText,
  looksLikeCoordinateText,
  type MappingToolRuntime,
} from './mappingToolUtils';

export const SearchPlacesToolSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxQueryLength)
      .refine((value) => !looksLikeCoordinateText(value), {
        message: 'use a named place or address, not coordinates',
      })
      .optional()
      .describe('Named place, address, or search phrase; never coordinates.'),
    near: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxQueryLength)
      .refine((value) => !looksLikeCoordinateText(value), {
        message: 'use a named locality or landmark, not coordinates',
      })
      .optional()
      .describe('Named locality or landmark to search around.'),
    /** Alias kept for models that phrase the location as a place. */
    location: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxQueryLength)
      .refine((value) => !looksLikeCoordinateText(value), {
        message: 'use a named locality or landmark, not coordinates',
      })
      .optional()
      .describe('Alias for near; never provide coordinates.'),
    category: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxCategoryLength)
      .optional()
      .describe(
        'Supported place category, such as cafe, restaurant, or museum.',
      ),
    radiusMeters: z
      .number()
      .int()
      .positive()
      .max(MAP_LIMITS.maxRadiusMeters)
      .optional()
      .describe('Nearby-search radius in meters; defaults conservatively.'),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAP_LIMITS.maxPlaces)
      .optional()
      .describe('Maximum number of places, never more than 12.'),
  })
  .strict()
  .superRefine((input, ctx) => {
    const near = input.near ?? input.location;
    if (!input.query && !near && !input.category) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'query, near, location, or category is required',
      });
    }
    if (input.near && input.location && input.near !== input.location) {
      ctx.addIssue({
        code: 'custom',
        path: ['location'],
        message: 'near and location must refer to the same place',
      });
    }
  });

function messageResult(
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

export const searchPlacesTool = defineTool(
  async (
    input: z.infer<typeof SearchPlacesToolSchema>,
    runtime: MappingToolRuntime,
  ): Promise<Command> => {
    const signal = mappingSignal(runtime);
    if (signal?.aborted)
      return messageResult(
        'Mapping operation was cancelled.',
        runtime.toolCallId,
      );

    try {
      const service = currentMappingService(runtime.context);
      if (!service)
        return messageResult(mappingUnavailable(), runtime.toolCallId);

      const near = input.near ?? input.location;
      const category = input.category
        ? normalizeOverpassCategory(input.category)
        : undefined;
      let result;
      let searchQuery = input.query ?? category ?? '';
      let localityName: string | undefined;
      let currentLocationSession:
        ReturnType<typeof currentLocationForPurpose> | undefined;

      if (near && isCurrentLocationText(near)) {
        currentLocationSession = currentLocationForPurpose(
          runtime.context,
          'nearby',
        );
        if (!currentLocationSession) {
          return messageResult(
            'No approved current location is available. Call request_location first or use a named locality; never infer the user location.',
            runtime.toolCallId,
          );
        }
        result = await service.searchPlaces(
          {
            center: currentLocationSession.coordinate,
            radiusMeters: input.radiusMeters,
            category: category ?? 'business',
            limit: input.limit,
          },
          signal,
        );
        localityName = 'your current location';
        searchQuery = input.query ?? `${category ?? 'business'} near me`;
      } else if (near && isSavedLocationText(near)) {
        if (
          !runtime.context.mappingSavedLocationEnabled ||
          !runtime.context.userLocation?.trim()
        ) {
          return messageResult(
            'Saved personalization location is not enabled for mapping. Ask for a named locality or request the user’s current location instead.',
            runtime.toolCallId,
          );
        }
        // Saved personalization is a separate opt-in. It is resolved on the
        // server as text and reduced to a provider locality center; no exact
        // profile value is included in the model-visible result.
        const localityResult = await service.searchPlaces(
          { query: runtime.context.userLocation.trim(), limit: 1 },
          signal,
        );
        if (signal?.aborted)
          return messageResult(
            'Mapping operation was cancelled.',
            runtime.toolCallId,
          );
        const locality = localityResult.places[0];
        if (!locality) {
          return messageResult(
            'The saved location could not be resolved to a validated locality. Omit nearby results rather than guessing.',
            runtime.toolCallId,
          );
        }
        localityName = `${locality.name} central area (approximate)`;
        const freshService = currentMappingService(runtime.context);
        if (!freshService)
          return messageResult(mappingUnavailable(), runtime.toolCallId);
        result = await freshService.searchPlaces(
          {
            center: locality.coordinate,
            radiusMeters: input.radiusMeters,
            category: category ?? 'business',
            limit: input.limit,
          },
          signal,
        );
        searchQuery =
          input.query ?? `${category ?? 'business'} near saved location`;
      } else if (near) {
        // Geocode the named locality first; the returned coordinate stays in
        // the trusted registry and is never included in the tool message.
        const localityResult = await service.searchPlaces(
          { query: near, limit: 1 },
          signal,
        );
        if (signal?.aborted)
          return messageResult(
            'Mapping operation was cancelled.',
            runtime.toolCallId,
          );
        const locality = localityResult.places[0];
        if (!locality) {
          return messageResult(
            `No validated location was found for "${near}". Do not infer coordinates or invent nearby places.`,
            runtime.toolCallId,
          );
        }
        localityName = locality.name;
        const freshService = currentMappingService(runtime.context);
        if (!freshService)
          return messageResult(mappingUnavailable(), runtime.toolCallId);
        if (signal?.aborted)
          return messageResult(
            'Mapping operation was cancelled.',
            runtime.toolCallId,
          );
        result = await freshService.searchPlaces(
          {
            center: locality.coordinate,
            radiusMeters: input.radiusMeters,
            category: category ?? 'business',
            limit: input.limit,
          },
          signal,
        );
        searchQuery = input.query ?? `${category ?? 'business'} near ${near}`;
      } else {
        result = await service.searchPlaces(
          MapPlaceSearchRequestSchema.parse({
            query: input.query ?? category,
            ...(category ? { category } : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          }),
          signal,
        );
      }

      if (signal?.aborted)
        return messageResult(
          'Mapping operation was cancelled.',
          runtime.toolCallId,
        );
      const places = result.places.slice(
        0,
        input.limit ?? MAP_LIMITS.maxPlaces,
      );
      const mapTitle = localityName
        ? `Places near ${localityName}`
        : input.query
          ? `Places for ${input.query}`
          : 'Validated places';
      const mapSpec = {
        places,
        ...(currentLocationSession
          ? { origin: currentLocationSession.coordinate }
          : {}),
        attribution: result.attribution,
        retrievedAt: result.retrievedAt,
        title: mapTitle.slice(0, 240),
        summary: `${places.length} provider-validated place${places.length === 1 ? '' : 's'} found.`,
      };
      const registration =
        places.length > 0
          ? registerMapSpec(runtime, mapSpec, 'search_places', {
              ...(currentLocationSession
                ? {
                    retainOrigin: currentLocationSession.retention === 'save',
                  }
                : {}),
            })
          : null;
      const placeRegistrations = registerPlaces(runtime, places, {
        mapHandle: registration?.handle,
        mapId: registration?.mapId,
      });
      if (currentLocationSession && registration) {
        emitLocationOverlay(runtime, registration.mapId, {
          origin: currentLocationSession.coordinate,
        });
      }
      const sourceStart = currentDocumentCount();
      const documents = places.map((place, index) => {
        const reference = placeRegistrations.find(
          (candidate) => candidate.place.id === place.id,
        );
        const handle = reference?.handle ?? `place_${index + 1}`;
        return placeDocument(
          place,
          sourceStart + index + 1,
          searchQuery,
          handle,
        );
      });
      const responsePlaces = places.map((place, index) => {
        const reference = placeRegistrations.find(
          (candidate) => candidate.place.id === place.id,
        );
        return outputPlace(place, reference?.handle ?? `place_${index + 1}`);
      });

      return messageResult(
        JSON.stringify({
          places: responsePlaces,
          ...(registration ? { mapHandle: registration.handle } : {}),
          ...(places.length > 0 && !registration
            ? {
                mapNote:
                  'The turn already has its one map placement available; keep the numbered prose and use the existing map handle if appropriate.',
              }
            : {}),
          ...(places.length === 0
            ? { note: 'No validated places found; omit unavailable facts.' }
            : {}),
          provider: result.provider,
          attribution: result.attribution,
          retrievedAt: result.retrievedAt,
        }),
        runtime.toolCallId,
        documents,
      );
    } catch (error) {
      return messageResult(mappingToolError(error, signal), runtime.toolCallId);
    }
  },
  {
    name: 'search_places',
    description:
      'Find provider-validated named places or nearby businesses. Use names/addresses and supported categories only; never provide coordinates. Each result has a short placeHandle, and a successful result may include a mapHandle for show_map. Preserve the numbered list in prose and omit facts the provider did not return.',
    schema: SearchPlacesToolSchema,
  },
);
