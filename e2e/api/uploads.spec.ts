import fs from 'fs';
import path from 'path';
import { test, expect } from '../fixtures/api';

test.describe('POST /api/uploads', () => {
  test('returns empty files array when no files are uploaded', async ({
    request,
  }) => {
    const res = await request.post('/api/uploads', {
      multipart: {
        chat_model_provider: 'test',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ files: [] });
  });

  test('rejects unsupported file extension with 400', async ({ request }) => {
    // The route must validate file extensions before processing and reject
    // unsupported types (only pdf, docx, txt are allowed).
    const res = await request.post('/api/uploads', {
      multipart: {
        files: {
          name: 'image.png',
          mimeType: 'image/png',
          buffer: Buffer.from('fake png data'),
        },
        chat_model_provider: 'test',
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'File type not supported' });
  });

  test('processes a valid .txt file and returns its metadata', async ({
    request,
  }) => {
    const res = await request.post('/api/uploads', {
      multipart: {
        files: {
          name: 'readme.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Hello, this is a test upload file content.'),
        },
        chat_model_provider: 'test',
        chat_model: 'test-direct',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files).toHaveLength(1);

    const file = body.files[0];
    expect(file.fileName).toBe('readme.txt');
    expect(file.fileExtension).toBe('txt');
    expect(typeof file.fileId).toBe('string');
    // fileId is a hex string from crypto.randomBytes (32 hex chars).
    expect(file.fileId).toMatch(/^[0-9a-f]{32}$/);
  });

  test('returns 500 when neither chat model provider resolves', async ({
    request,
  }) => {
    // When chat_model_provider is nonexistent, both the custom_openai branch and
    // the chatModelProvider && chatModelConfig branch fail, so `llm` is never
    // assigned. The handler reaches the map callback where llm is used
    // uninitialized, throws, and hits the 500 catch block.
    const res = await request.post('/api/uploads', {
      multipart: {
        files: {
          name: 'doc.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('content'),
        },
        chat_model_provider: 'nonexistent',
        chat_model: 'nope',
      },
    });
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ message: 'An error has occurred.' });
  });

  test('generates real semantic topics via structured output', async ({
    request,
  }) => {
    const res = await request.post('/api/uploads', {
      multipart: {
        files: {
          name: 'topics.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Structured output topic generation test.'),
        },
        chat_model_provider: 'test',
        chat_model: 'test-structured',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const file = body.files[0];
    expect(file.fileName).toBe('topics.txt');

    // generateFileTopics persists `${filename}, ${topics.join(', ')}` — read
    // it back from disk since the route's response doesn't expose topics.
    const extractedPath = path.resolve(
      'e2e/.test-data/uploads',
      `${file.fileId}-extracted.json`,
    );
    const extracted = JSON.parse(fs.readFileSync(extractedPath, 'utf-8'));
    expect(extracted.topics).toBe(
      'topics.txt, deterministic topic one, deterministic topic two',
    );
  });
});
