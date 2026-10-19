---
name: Gemini provider setup
description: Server-side Gemini credentials, key-specific model availability, and structured-output constraints for SpecLens.
---

SpecLens uses the official Google Gen AI SDK with `GEMINI_API_KEY` on the API server only. Select a model that the key lists for `generateContent` and that Google's documentation marks as supporting structured output. Keep provider validation and exact-quote checks on the server; do not persist output after provider, parse, or evidence validation fails.

**Why:** The user's AI Studio quota showed Gemini 3 Flash over its daily limit while Gemini 3.5 Flash Lite remained available, so the model choice must respect the key's live quota and supported actions.

**How to apply:** Before changing models, check the key's model list without displaying its value, verify structured-output support, and use a schema within Google's supported subset. Keep the established analysis response contract and verify with a real provider request.
