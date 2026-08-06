import { badRequest, notFound, route } from '@/lib/api/route';
import { getArtifact, getVersion } from '@/lib/artifacts/service';
import {
  ARTIFACT_CSP_HEADER,
  artifactFilename,
  injectCspMeta,
} from '@/lib/artifacts/csp';

type Ctx = { params: Promise<{ id: string }> };

/**
 * The iframe `src`, and the only place artifact content is served as
 * `text/html`. The response carries the sandbox policy as real headers; the
 * download variant injects the same policy as a `<meta>` tag so the file stays
 * inert once it is off the server.
 */
export const GET = route(
  'Failed to fetch artifact content',
  async (req: Request, { params }: Ctx) => {
    const { id } = await params;
    const { searchParams } = new URL(req.url);

    const versionParam = searchParams.get('version');
    let version: number | undefined;
    if (versionParam !== null) {
      version = Number(versionParam);
      if (!Number.isInteger(version) || version < 1)
        throw badRequest('version must be a positive integer');
    }

    const artifact = getArtifact(id);
    if (!artifact) throw notFound('Artifact not found');

    const row = getVersion(id, version);
    if (!row) throw notFound('Artifact version not found');

    const download = searchParams.get('download') === '1';
    const body = download ? injectCspMeta(row.content) : row.content;

    return new Response(body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': ARTIFACT_CSP_HEADER,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        ...(download && {
          'Content-Disposition': `attachment; filename="${artifactFilename(artifact.title, row.version)}"`,
        }),
      },
    });
  },
);
