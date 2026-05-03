/**
 * Adapter for extracting text from binary formats (PDF, DOCX).
 */
export async function extractText(
  buf: Buffer,
  mime: string | null | undefined,
): Promise<string | null> {
  if (mime === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    return result.text ?? null;
  }
  if (
    mime ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value ?? null;
  }
  return null;
}
