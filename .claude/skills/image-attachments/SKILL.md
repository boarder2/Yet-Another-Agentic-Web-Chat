---
name: image-attachments
description: Use when working on image upload/display, the uploads API, MessageInput image/clipboard paste, multimodal chat messages, or vision model integration.
---

# Image Attachments

Users can attach images to chat messages via clipboard paste or file picker. Images are stored on disk in the `uploads/` directory (not in SQLite) to avoid database bloat. The feature works across all focus modes.

## Vision gating (`imageCapable`)

Image attach is gated by the `imageCapable` localStorage flag (read reactively in `ChatWindow` via `useLocalStorageBoolean('imageCapable', ...)`; sent as `payload.imageCapable`). The toggle lives in the chat **`ModelConfigurator`** dialog, rendered by the unified `ModelPicker`'s `VisionToggle` (`src/components/models/VisionToggle.tsx`) when `fields.vision` is set. Presets also carry `imageCapable`. The flag uses key `SELECTION_KEYS.imageCapable` — write via `writeLocalStorage`/`writeSelectionToStorage` so subscribers update.

## Data Flow

1. User pastes/picks image(s) → `POST /api/uploads/images` → saved to `uploads/` with random hex filename → returns `{ images: [{ imageId, fileName, mimeType }] }`
2. Thumbnails shown in MessageInput; user can remove individual images before sending
3. On send, `messageImageIds` (string[]) and `messageImages` (full `{imageId, fileName, mimeType}[]`) are included in the API payload
4. `chat/route.ts` saves the user message to DB with `metadata.images = messageImages` (full objects, not just IDs) and passes `messageImageIds` to `SimplifiedAgent.searchAndAnswer()`
5. `SimplifiedAgent.searchAndAnswer()` calls `buildMultimodalHumanMessage(query, messageImageIds)` to construct the multimodal `HumanMessage` with base64 `image_url` content parts
6. For history replay, `buildHistoryFromDb()` in `src/lib/utils/buildHistory.ts` reads `metadata.images` from DB rows and calls `buildMultimodalHumanMessage()` directly — no tuple format used

## API Endpoints

- `POST /api/uploads/images` — Upload images (max 10MB each, png/jpg/jpeg/gif/webp)
- `GET /api/uploads/images/[imageId]` — Serve uploaded images with immutable cache headers; validates hex-only imageId to prevent path traversal

## Key Files

- `src/app/api/uploads/images/route.ts` — Upload endpoint
- `src/app/api/uploads/images/[imageId]/route.ts` — Serving endpoint
- `src/lib/utils/images.ts` — `loadImageAsBase64()` and `buildMultimodalHumanMessage()` utilities
- `src/lib/utils/buildHistory.ts` — `buildHistoryFromDb()`: reconstructs LangChain messages from DB rows, calling `buildMultimodalHumanMessage()` for rows with `metadata.images`
- `src/lib/search/simplifiedAgent.ts` — `searchAndAnswer()` receives `messageImageIds` and builds multimodal HumanMessage
- `src/components/MessageInput.tsx` — Paste handler, thumbnail strip, upload logic
- `src/components/MessageInputActions/Attach.tsx` — File picker routes images vs documents
- `src/components/MessageBox.tsx` — Renders image gallery in user messages
- `src/components/ChatWindow.tsx` — `ImageAttachment` type, `pendingImages` state, payload wiring

## Security

- MIME type validation (only image types accepted)
- File size limit (10MB per image)
- Hex-only imageId validation (`/^[a-f0-9]{32}$/`) prevents path traversal
- Images served with correct Content-Type from file extension

## Multimodal Message Construction

The `buildMultimodalHumanMessage()` utility in `src/lib/utils/images.ts`:

1. Takes message content string and array of image IDs
2. Loads each image from disk via `loadImageAsBase64()`
3. Constructs a LangChain `HumanMessage` with `content` array containing:
   - `{ type: "text", text: messageContent }`
   - `{ type: "image_url", image_url: { url: "data:<mime>;base64,<data>" } }` for each image

## Chat History Threading

Images are threaded through history via the DB. User messages are saved with `metadata.images` containing the full `{imageId, fileName, mimeType}[]` array. `buildHistoryFromDb()` reads these rows and calls `buildMultimodalHumanMessage(content, imageIds)` for any user message whose metadata includes images. No tuple format is used — the DB row is the single source of truth.
