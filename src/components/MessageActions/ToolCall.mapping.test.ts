import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import ToolCall from './ToolCall';

const renderTool = (props: Record<string, unknown>) => {
  const client = new QueryClient();
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ToolCall, props),
    ),
  );
};

describe('mapping tool call chrome', () => {
  it('uses distinct human-readable labels for mapping operations', () => {
    expect(
      renderTool({
        type: 'search_places',
        near: 'Testville',
        category: 'cafe',
        status: 'success',
      }),
    ).toContain('Finding places');
    expect(
      renderTool({
        type: 'get_place_details',
        placeHandle: 'place_1',
        status: 'success',
      }),
    ).toContain('Retrieving place details');
    expect(
      renderTool({
        type: 'get_route',
        origin: 'Central Cafe',
        destination: 'North Market',
        mode: 'driving',
        status: 'success',
      }),
    ).toContain('Finding driving');
    expect(
      renderTool({
        type: 'show_map',
        query: 'places: place_2, place_1 · route: route_1',
        description: 'Route and places',
        status: 'success',
      }),
    ).toContain('Showing map');
  });

  it('does not fall back to generic tool chrome for show_map', () => {
    const markup = renderTool({
      type: 'show_map',
      query: 'places: place_1, place_2 · route: route_1',
      description: 'Route and places',
      status: 'success',
    });

    expect(markup).toContain('Showing map');
    expect(markup).toContain('places: place_1, place_2');
    expect(markup).not.toContain('map_1');
    expect(markup).not.toContain('Using tool:');
  });
});
