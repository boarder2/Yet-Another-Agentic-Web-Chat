import { z } from 'zod';
import { Command } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import {
  MAP_LIMITS,
  MapRouteModeSchema,
  MapRouteRequestSchema,
} from '@/lib/maps/types';
import { defineTool } from '@/lib/tools/defineTool';
import {
  currentDocumentCount,
  currentMappingService,
  mappingSignal,
  mappingToolError,
  mappingUnavailable,
  outputPlace,
  registerMapSpec,
  registerPlaces,
  registerRoute,
  routeDocument,
  routePublicSummary,
  emitLocationOverlay,
  currentLocationForPurpose,
  isCurrentLocationText,
  isSavedLocationText,
  looksLikeCoordinateText,
  type MappingToolRuntime,
} from './mappingToolUtils';
import type { MapPlace } from '@/lib/maps/types';

export const GetRouteToolSchema = z
  .object({
    origin: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxQueryLength)
      .refine((value) => !looksLikeCoordinateText(value), {
        message: 'use a named origin or address, not coordinates',
      })
      .describe('Named origin, address, or landmark; never coordinates.'),
    destination: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxQueryLength)
      .refine((value) => !looksLikeCoordinateText(value), {
        message: 'use a named destination or address, not coordinates',
      })
      .describe('Named destination, address, or landmark; never coordinates.'),
    mode: MapRouteModeSchema.describe(
      'Route mode. Transit, traffic, and turn-by-turn navigation are not supported.',
    ),
  })
  .strict();

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

export const getRouteTool = defineTool(
  async (
    input: z.infer<typeof GetRouteToolSchema>,
    runtime: MappingToolRuntime,
  ): Promise<Command> => {
    const signal = mappingSignal(runtime);
    if (signal?.aborted) {
      return resultCommand(
        'Mapping operation was cancelled.',
        runtime.toolCallId,
      );
    }

    try {
      let service = currentMappingService(runtime.context);
      if (!service)
        return resultCommand(mappingUnavailable(), runtime.toolCallId);

      const originIsCurrent = isCurrentLocationText(input.origin);
      const originIsSaved = isSavedLocationText(input.origin);
      let originPlace: MapPlace | undefined;
      let originCoordinate: { lat: number; lon: number };
      let originName = input.origin;
      let currentLocationSession = currentLocationForPurpose(
        runtime.context,
        'routing',
      );

      if (originIsCurrent) {
        if (!currentLocationSession) {
          return resultCommand(
            'No approved current location is available. Call request_location first or ask for a named origin; never infer coordinates.',
            runtime.toolCallId,
          );
        }
        originCoordinate = currentLocationSession.coordinate;
        originName = 'Current location';
      } else {
        if (originIsSaved && !runtime.context.mappingSavedLocationEnabled) {
          return resultCommand(
            'Saved personalization location is not enabled for mapping. Ask for a named origin or request the user’s current location instead.',
            runtime.toolCallId,
          );
        }
        const originQuery = originIsSaved
          ? runtime.context.userLocation?.trim()
          : input.origin;
        if (!originQuery) {
          return resultCommand(
            'Saved personalization location is not enabled for mapping. Ask for a named origin or request the user’s current location instead.',
            runtime.toolCallId,
          );
        }
        // Named and explicitly opted-in saved locations are geocoded by the
        // provider; the coordinate remains in the trusted route object.
        const originResult = await service.searchPlaces(
          { query: originQuery, limit: 1 },
          signal,
        );
        if (signal?.aborted)
          return resultCommand(
            'Mapping operation was cancelled.',
            runtime.toolCallId,
          );
        originPlace = originResult.places[0];
        if (!originPlace) {
          return resultCommand(
            `No validated origin was found for "${originIsSaved ? 'the saved location' : input.origin}". Ask for a textual origin or omit the route; never guess coordinates.`,
            runtime.toolCallId,
          );
        }
        originCoordinate = originPlace.coordinate;
        originName = originIsSaved
          ? `${originPlace.name} central area (approximate)`
          : originPlace.name;
      }

      service = currentMappingService(runtime.context);
      if (!service)
        return resultCommand(mappingUnavailable(), runtime.toolCallId);
      const destinationResult = await service.searchPlaces(
        { query: input.destination, limit: 1 },
        signal,
      );
      if (signal?.aborted)
        return resultCommand(
          'Mapping operation was cancelled.',
          runtime.toolCallId,
        );
      const destinationPlace = destinationResult.places[0];
      if (!destinationPlace) {
        return resultCommand(
          `No validated destination was found for "${input.destination}". Omit the route rather than inventing coordinates.`,
          runtime.toolCallId,
        );
      }

      service = currentMappingService(runtime.context);
      if (!service)
        return resultCommand(mappingUnavailable(), runtime.toolCallId);
      if (originIsCurrent) {
        // Re-check the run-bound token after destination geocoding so an
        // approval that expired during the lookup cannot authorize another
        // provider request.
        currentLocationSession = currentLocationForPurpose(
          runtime.context,
          'routing',
        );
        if (!currentLocationSession) {
          return resultCommand(
            'The approved current location expired before routing. Request location approval again or ask for a named origin.',
            runtime.toolCallId,
          );
        }
        originCoordinate = currentLocationSession.coordinate;
      }
      if (signal?.aborted)
        return resultCommand(
          'Mapping operation was cancelled.',
          runtime.toolCallId,
        );
      const routeResult = await service.getRoute(
        MapRouteRequestSchema.parse({
          origin: originCoordinate,
          destination: destinationPlace.coordinate,
          mode: input.mode,
        }),
        signal,
      );
      if (signal?.aborted)
        return resultCommand(
          'Mapping operation was cancelled.',
          runtime.toolCallId,
        );
      const route = routeResult.route;
      if (originIsCurrent) {
        // The provider call may finish after the ten-minute approval window.
        // Revalidate before deciding whether its exact origin/geometry may be
        // retained or sent to the approving page.
        currentLocationSession = currentLocationForPurpose(
          runtime.context,
          'routing',
        );
      }
      // The adapter must return the exact endpoints requested. Apart from
      // preventing a misleading answer, this keeps a malformed provider from
      // smuggling an unverified endpoint into a transient-location overlay.
      if (
        route.origin.lat !== originCoordinate.lat ||
        route.origin.lon !== originCoordinate.lon ||
        route.destination.lat !== destinationPlace.coordinate.lat ||
        route.destination.lon !== destinationPlace.coordinate.lon
      ) {
        return resultCommand(
          'Error: The mapping provider returned a route for different endpoints; no route was added.',
          runtime.toolCallId,
        );
      }
      const places = originIsCurrent
        ? [destinationPlace]
        : originPlace && originPlace.id === destinationPlace.id
          ? [originPlace]
          : originPlace
            ? [originPlace, destinationPlace]
            : [destinationPlace];
      const mapSpec = {
        places,
        route,
        attribution: routeResult.attribution,
        retrievedAt: routeResult.retrievedAt,
        title: `Route: ${input.origin} to ${input.destination}`.slice(0, 240),
        summary: `${input.mode} route from ${input.origin} to ${input.destination}.`,
      };
      const mapRegistration = registerMapSpec(runtime, mapSpec, 'get_route', {
        // Keep this decision stable for the whole provider operation. If the
        // ten-minute token expires after routing returns, the exact route must
        // still never enter the registry or a durable map milestone.
        retainRoute:
          !originIsCurrent || currentLocationSession?.retention === 'save',
      });
      const placeRegistrations = registerPlaces(runtime, places, {
        mapHandle: mapRegistration?.handle,
        mapId: mapRegistration?.mapId,
      });
      if (originIsCurrent && mapRegistration && currentLocationSession) {
        emitLocationOverlay(runtime, mapRegistration.mapId, {
          origin: originCoordinate,
          route,
        });
      }
      const routeRegistration =
        originIsCurrent && currentLocationSession?.retention !== 'save'
          ? undefined
          : registerRoute(runtime, route, {
              mapHandle: mapRegistration?.handle,
              mapId: mapRegistration?.mapId,
            });
      const originHandle = originPlace
        ? placeRegistrations.find(
            (candidate) => candidate.place.id === originPlace?.id,
          )?.handle
        : undefined;
      const destinationHandle = placeRegistrations.find(
        (candidate) => candidate.place.id === destinationPlace.id,
      )?.handle;
      const document = routeDocument(
        route,
        currentDocumentCount() + 1,
        `${input.origin} to ${input.destination}`,
        originName,
        destinationPlace.name,
        { hideExactLinks: originIsCurrent },
      );

      return resultCommand(
        JSON.stringify({
          route: routePublicSummary(
            route,
            originName,
            destinationPlace.name,
            routeRegistration?.handle,
            mapRegistration?.handle,
            { hideExactLinks: originIsCurrent },
          ),
          ...(originHandle && originPlace
            ? { origin: outputPlace(originPlace, originHandle) }
            : {}),
          ...(destinationHandle
            ? { destination: outputPlace(destinationPlace, destinationHandle) }
            : {}),
          ...(mapRegistration
            ? {}
            : {
                mapNote:
                  'The route was validated, but this turn has no remaining map registration capacity; keep the textual route summary and links.',
              }),
          provider: routeResult.provider,
          attribution: routeResult.attribution,
          retrievedAt: routeResult.retrievedAt,
        }),
        runtime.toolCallId,
        [document],
      );
    } catch (error) {
      return resultCommand(mappingToolError(error, signal), runtime.toolCallId);
    }
  },
  {
    name: 'get_route',
    description:
      'Build one provider-validated driving, walking, or cycling route between named places. Never send coordinates. The result includes a short routeHandle/mapHandle, distance, duration estimate, attribution, and external navigation link; transit, traffic, and navigation-grade turn-by-turn claims are unavailable.',
    schema: GetRouteToolSchema,
  },
);
