/**
 * Adapter for extracting text from binary formats (PDF, DOCX).
 * In v1 this is a stub that returns null, indicating that binary extraction is unavailable.
 * To add PDF support, install pdf-parse and implement accordingly.
 */
export async function extractText(
  _buf: Buffer,
  _mime: string | null | undefined,
): Promise<string | null> {
  return null;
}
