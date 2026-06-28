import { NextRequest, NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/mcp/oauth';
import { getBaseUrl } from '@/lib/config';

/**
 * OAuth callback: GET /api/mcp/oauth/callback?code=&state=
 *
 * Looks up the flow row by state, runs finishAuth (PKCE exchange), persists
 * tokens, then renders a self-closing HTML page that postMessages the result
 * to the opener with an explicit origin (BASE_URL) — never '*'.
 */
/** Escape HTML special characters to prevent XSS in inline HTML content. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return renderResult(req, false, null, 'Missing code or state parameter');
  }

  const result = await handleOAuthCallback(state, code);

  return renderResult(req, result.ok, result.serverName ?? null, result.error);
}

function renderResult(
  req: NextRequest,
  ok: boolean,
  serverName: string | null,
  error?: string,
): NextResponse {
  // Prefer BASE_URL for targetOrigin; fall back to the request's own origin
  // (same-origin as the opener) — never fall back to the literal string 'null'
  // which would cause postMessage to be silently dropped.
  let targetOrigin: string;
  try {
    const baseUrl = getBaseUrl() ?? '';
    targetOrigin = baseUrl ? baseUrl.replace(/\/$/, '') : req.nextUrl.origin;
  } catch {
    targetOrigin = req.nextUrl.origin;
  }

  // JSON.stringify does not escape '/' — a serverName containing '</script>'
  // would break out of the inline <script> tag. Replace '</' → '<\/' to prevent
  // the HTML parser from closing the script element. The visible <p> body uses
  // escapeHtml for the same reason.
  const payload = JSON.stringify(
    ok
      ? { type: 'mcp_oauth_success', serverName }
      : { type: 'mcp_oauth_error', error: error ?? 'Unknown error' },
  );
  // XSS mitigation: prevent </script> breakout in inline JSON
  const safePayload = payload.replace(/<\//g, '<\\/');

  const visibleText = ok
    ? `Connected to ${escapeHtml(serverName ?? 'MCP server')} successfully.`
    : `Error: ${escapeHtml(error ?? 'Unknown error')}`;

  const html = `<!DOCTYPE html>
<html>
<head><title>MCP OAuth ${ok ? 'Success' : 'Error'}</title></head>
<body>
<p>${visibleText}</p>
<script>
(function() {
  try {
    window.opener.postMessage(${safePayload}, ${JSON.stringify(targetOrigin)});
  } catch(e) {}
  window.close();
})();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
