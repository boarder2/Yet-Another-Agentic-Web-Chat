import { z } from 'zod';
import { Command } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { retrievePdfDoc } from '@/lib/utils/documents';
import { defineTool } from '@/lib/tools/defineTool';

// Schema for PDF transcript tool input
const PDFLoaderToolSchema = z.object({
  pdfUrl: z.string(),
});

/**
 * PDFLoaderTool - Retrieves the content of a PDF document
 *
 * Responsibilities:
 * 1. Extract PDF URL from the provided input
 * 2. Fetch the PDF content using a PDF parsing library
 * 3. Return the content as a string
 */
export const pdfLoaderTool = defineTool(
  async (input: z.infer<typeof PDFLoaderToolSchema>, runtime) => {
    try {
      const { pdfUrl } = input;
      const { retrievalSignal } = runtime.context;

      // Check for cancellation early
      if (retrievalSignal?.aborted || runtime.signal?.aborted) {
        console.log('[pdfLoaderTool] Operation cancelled');
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'PDF loading cancelled.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      console.log(`[pdfLoaderTool] Retrieving content for PDF: "${pdfUrl}"`);

      const doc = await retrievePdfDoc(pdfUrl);

      if (!doc) {
        console.log(`[pdfLoaderTool] No documents found for PDF: ${pdfUrl}`);
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'No transcript available for this video.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      console.log(`[pdfLoaderTool] Retrieved document from PDF: ${pdfUrl}`);

      await runtime.persist({
        kind: 'pdf_loader',
        body: `[pdf_loader ${pdfUrl}]\n${doc.pageContent ?? ''}`,
        metadataExtras: { source: pdfUrl },
      });

      return new Command({
        update: {
          relevantDocuments: [doc],
          messages: [
            new ToolMessage({
              content: JSON.stringify({
                document: [doc],
              }),
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    } catch (error) {
      console.error(
        '[pdfLoaderTool] Error during PDF content retrieval:',
        error,
      );
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: 'Error occurred during image search: ' + errorMessage,
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'pdf_loader',
    description: 'Fetch PDF text from a URL.',
    schema: PDFLoaderToolSchema,
  },
);
