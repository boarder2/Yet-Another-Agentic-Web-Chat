import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { retrievePdfDoc } from '@/lib/utils/documents';

// Schema for PDF loader tool input
const PDFLoaderToolSchema = z.object({
  pdfUrl: z
    .string()
    .describe(
      'The PDF document URL. Provide the URL of the PDF document to retrieve its content.',
    ),
});

/**
 * PDFLoaderTool - Retrieves the content of a PDF document
 */
export const pdfLoaderTool = tool(
  async (
    input: z.infer<typeof PDFLoaderToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const { pdfUrl } = input;

      const retrievalSignal: AbortSignal | undefined =
        config?.configurable?.retrievalSignal;
      if (retrievalSignal?.aborted || config?.signal?.aborted) {
        console.log('[pdfLoaderTool] Operation cancelled');
        return 'PDF loading cancelled.';
      }

      console.log(`[pdfLoaderTool] Retrieving content for PDF: "${pdfUrl}"`);

      const doc = await retrievePdfDoc(pdfUrl);

      if (!doc) {
        console.log(`[pdfLoaderTool] No documents found for PDF: ${pdfUrl}`);
        return 'No content could be retrieved from this PDF.';
      }

      // Emit source metadata
      await dispatchCustomEvent('sources', {
        sources: [{
          sourceId: 1,
          title: doc.metadata?.title || 'PDF Document',
          url: pdfUrl,
        }],
      }, config);

      console.log(`[pdfLoaderTool] Retrieved document from PDF: ${pdfUrl}`);
      return `PDF Content (${pdfUrl}):\n\n${doc.pageContent}`;
    } catch (error) {
      console.error(
        '[pdfLoaderTool] Error during PDF content retrieval:',
        error,
      );
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return 'Error occurred during PDF loading: ' + errorMessage;
    }
  },
  {
    name: 'pdf_loader',
    description: 'Retrieves the content of a PDF document given its URL.',
    schema: PDFLoaderToolSchema,
  },
);
