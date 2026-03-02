import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { retrievePdfDoc } from '@/lib/utils/documents';
import { writer } from '@langchain/langgraph';

const PDFLoaderToolSchema = z.object({
  pdfUrl: z
    .string()
    .describe(
      'The PDF document URL. Provide the URL of the PDF document to retrieve its content.',
    ),
});

export const pdfLoaderTool = tool(
  async (
    input: z.infer<typeof PDFLoaderToolSchema>,
    config?: RunnableConfig,
  ): Promise<string> => {
    const { pdfUrl } = input;

    const retrievalSignal: AbortSignal | undefined =
      config?.configurable?.retrievalSignal;

    if (retrievalSignal?.aborted || config?.signal?.aborted) {
      return 'PDF loading cancelled.';
    }

    try {
      const doc = await retrievePdfDoc(pdfUrl);

      if (!doc) {
        return 'No content available for this PDF.';
      }

      try {
        writer({ type: 'sources_added', data: [doc], searchQuery: pdfUrl });
      } catch {
        // writer not available
      }

      return JSON.stringify({ document: [doc] });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return `Error occurred during PDF loading: ${errorMessage}`;
    }
  },
  {
    name: 'pdf_loader',
    description: 'Retrieves the content of a PDF document given its URL.',
    schema: PDFLoaderToolSchema,
  },
);
