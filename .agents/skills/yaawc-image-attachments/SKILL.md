---
name: yaawc-image-attachments
description: Image upload/storage, attachment UX, multimodal messages, vision gating, and display.
---

# Image Attachments

Images attach via clipboard paste or file picker, stored on disk in `uploads/` (not SQLite). Works across all focus modes.

## Vision gating

Attach is gated by the `imageCapable` localStorage flag (key `SELECTION_KEYS.imageCapable`; read reactively in `ChatWindow`, sent as `payload.imageCapable`). Toggle: `VisionToggle` inside `ModelPicker` (`fields.vision`); presets carry it. Write via `writeLocalStorage`/`writeSelectionToStorage` so subscribers update.

## Data flow

1. Paste/pick → `POST /api/uploads/images` (max 10MB each; png/jpg/jpeg/gif/webp; saved under random hex names) → `{ images: [{ imageId, fileName, mimeType }] }`; thumbnails in `MessageInput`, removable before send.
2. Send includes `messageImageIds` + `messageImages` (full objects). `chat/route.ts` saves the user message with `metadata.images = messageImages` and passes `messageImageIds` to `searchAndAnswer()`.
3. `buildMultimodalHumanMessage(content, imageIds)` (`src/lib/utils/images.ts`) loads each image via `loadImageAsBase64()` and builds a `HumanMessage` whose `content` array holds the text part plus a base64 `image_url` part per image.
4. History replay: `buildHistoryFromDb()` (`src/lib/utils/buildHistory.ts`) calls the same builder for rows with `metadata.images` — the DB row is the single source of truth, no tuple format.
5. `GET /api/uploads/images/[imageId]` serves with immutable cache headers; hex-only id validation (`/^[a-f0-9]{32}$/`) prevents path traversal.

## Key files

`src/app/api/uploads/images/(…)route.ts` (upload/serve) · `src/lib/utils/images.ts` · `src/lib/utils/buildHistory.ts` · `src/components/MessageInput.tsx` (paste, thumbnails) · `MessageInputActions/Attach.tsx` (picker routes images vs documents) · `MessageBox.tsx` (gallery in user messages).
