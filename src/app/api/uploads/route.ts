import { NextResponse } from 'next/server';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAvailableEmbeddingModelProviders, getAvailableChatModelProviders } from '@/lib/providers';
import {
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
} from '@/lib/config';
import { UPLOADS_DIR } from '@/lib/dataDir';
import { getEmbeddingModelSelection } from '@/lib/settings/server';
import { extractText } from '@/lib/workspaces/extractAdapter';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatOllama } from '@langchain/ollama';
import { z } from 'zod';
import { withStructuredOutput } from '@/lib/utils/structuredOutput';
// import { getLangfuseCallbacks } from '@/lib/tracing/langfuse';

interface FileRes {
  fileName: string;
  fileExtension: string;
  fileId: string;
}

const uploadDir = UPLOADS_DIR;

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 100,
});

// Define Zod schema for structured topic generation output
const TopicsSchema = z.object({
  topics: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe('Array of 1-3 concise, descriptive topics that capture the main subject matter'),
});

type TopicsOutput = z.infer<typeof TopicsSchema>;

/**
 * Generate semantic topics for a document using LLM with structured output
 */
async function generateFileTopics(
  content: string,
  filename: string,
  llm: BaseChatModel
): Promise<string> {
  try {
    // Take first 1500 characters for topic generation to avoid token limits
    const excerpt = content.substring(0, 1500);
    
    const prompt = `Analyze the following document excerpt and generate 1-5 concise, descriptive topics that capture the main subject matter. The topics should be useful for determining if this document is relevant to answer questions.

Document filename: ${filename}
Document excerpt:
${excerpt}

Generate topics that describe what this document is about, its domain, and key subject areas. Focus on topics that would help determine relevance for search queries.`;

    // Use structured output for reliable topic extraction
    const structuredLlm = withStructuredOutput(llm, TopicsSchema, {
      name: 'generate_topics',
    });

    const result = await structuredLlm.invoke(prompt, {
      // ...getLangfuseCallbacks(),
    });
    console.log('Generated topics:', result.topics);
    // Filename is included for context
    return filename + ', ' + result.topics.join(', ');
  } catch (error) {
    console.warn('Error generating topics with LLM:', error);
    return `Document: ${filename}`;
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const files = formData.getAll('files') as File[];
    const chat_model = formData.get('chat_model');
    const chat_model_provider = formData.get('chat_model_provider');
    const context_window = formData.get('context_window_size');

    // Get available providers
    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    // Embedding model is a system-level setting: resolve from the DB (source of
    // truth) so uploads are indexed with the same model used at query time.
    const selectedEmbedding = getEmbeddingModelSelection();
    const embeddingProvider =
      embeddingModelProviders[
        selectedEmbedding.provider || Object.keys(embeddingModelProviders)[0]
      ];
    const embeddingModelConfig =
      embeddingProvider?.[
        selectedEmbedding.name || Object.keys(embeddingProvider || {})[0]
      ];

    if (!embeddingModelConfig) {
      return NextResponse.json(
        { message: 'Invalid embedding model selected' },
        { status: 400 },
      );
    }

    let embeddingsModel = embeddingModelConfig.model;

    // Setup chat model for topic generation (similar to chat route)
    const chatModelProvider =
      chatModelProviders[
        chat_model_provider as string ?? Object.keys(chatModelProviders)[0]
      ];
    const chatModelConfig =
      chatModelProvider[
        chat_model as string ?? Object.keys(chatModelProvider)[0]
      ];

    let llm: BaseChatModel;

    // Handle chat model creation like in chat route
    if (chat_model_provider === 'custom_openai') {
      llm = new ChatOpenAI({
        apiKey: getCustomOpenaiApiKey(),
        modelName: getCustomOpenaiModelName(),
        temperature: 0.1,
        configuration: {
          baseURL: getCustomOpenaiApiUrl(),
        },
      }) as unknown as BaseChatModel;
    } else if (chatModelProvider && chatModelConfig) {
      llm = chatModelConfig.model;

      if (llm instanceof ChatOllama && chat_model_provider === 'ollama') {
        const contextWindow = context_window
          ? parseInt(context_window as string, 10)
          : DEFAULT_CONTEXT_WINDOW;
        llm.numCtx = contextWindow;
      }
      (llm as any).contextWindowSize = context_window
        ? parseInt(context_window as string, 10)
        : DEFAULT_CONTEXT_WINDOW;
    }

    // Reject unsupported types up front: returning from the map callback below
    // only resolves that array element — Promise.all discards it and the
    // handler would still respond 200.
    const unsupported = files.find(
      (file: any) =>
        !['pdf', 'docx', 'txt'].includes(file.name.split('.').pop()!),
    );
    if (unsupported) {
      return NextResponse.json(
        { message: 'File type not supported' },
        { status: 400 },
      );
    }

    const processedFiles: FileRes[] = [];

    await Promise.all(
      files.map(async (file: any) => {
        const fileExtension = file.name.split('.').pop();
        const uniqueFileName = `${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;
        const filePath = path.join(uploadDir, uniqueFileName);

        const buffer = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(filePath, new Uint8Array(buffer));

        const text =
          fileExtension === 'txt'
            ? buffer.toString('utf-8')
            : ((await extractText(
                buffer,
                fileExtension === 'pdf'
                  ? 'application/pdf'
                  : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              )) ?? '');
        const docs = [
          new Document({ pageContent: text, metadata: { title: file.name } }),
        ];

        const splitted = await splitter.splitDocuments(docs);

        // Generate semantic topics using LLM
        const fullContent = docs.map(doc => doc.pageContent).join('\n');
        const semanticTopics = await generateFileTopics(fullContent, file.name, llm);

        const extractedDataPath = filePath.replace(/\.\w+$/, '-extracted.json');
        fs.writeFileSync(
          extractedDataPath,
          JSON.stringify({
            title: file.name,
            topics: semanticTopics,
            contents: splitted.map((doc) => doc.pageContent),
          }),
        );

        const embeddings = await embeddingsModel.embedDocuments(
          splitted.map((doc) => doc.pageContent),
        );
        const embeddingsDataPath = filePath.replace(
          /\.\w+$/,
          '-embeddings.json',
        );
        fs.writeFileSync(
          embeddingsDataPath,
          JSON.stringify({
            title: file.name,
            embeddings,
          }),
        );

        processedFiles.push({
          fileName: file.name,
          fileExtension: fileExtension,
          fileId: uniqueFileName.replace(/\.\w+$/, ''),
        });
      }),
    );

    return NextResponse.json({
      files: processedFiles,
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    return NextResponse.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
}
