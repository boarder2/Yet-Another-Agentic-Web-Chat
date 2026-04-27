import { NextResponse } from 'next/server';
import { getAutocompleteProvider } from '@/lib/search/providers';

/**
 * Autocomplete passthrough used by external browsers configured to use this
 * app as a search provider. Not used by the in-app prompt editor, so it is
 * not affected by private chat mode.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || '';
  const emptyResponse = () =>
    new NextResponse(JSON.stringify([query, []]), {
      headers: { 'Content-Type': 'application/x-suggestions+json' },
    });

  try {
    if (!query) return emptyResponse();

    const provider = getAutocompleteProvider();
    if (!provider || !provider.autocomplete) {
      return emptyResponse();
    }

    const suggestions = await provider.autocomplete(
      query,
      AbortSignal.timeout(3000),
    );

    return new NextResponse(JSON.stringify([query, suggestions]), {
      headers: { 'Content-Type': 'application/x-suggestions+json' },
    });
  } catch (error) {
    console.error('Error fetching autocomplete suggestions:', error);
    return emptyResponse();
  }
}
