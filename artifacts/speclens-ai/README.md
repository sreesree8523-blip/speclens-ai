# SpecLens AI

SpecLens AI checks a product requirements document for material ambiguity,
missing logic, and undefined inputs before engineering handoff. It provides
evidence-backed findings, prioritized questions, saved analysis history, and a
dashboard calculated from stored analyses.

## Setup

1. Provision the Replit PostgreSQL database.
2. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey)
   and add it to Replit Secrets as `GEMINI_API_KEY`. The key is read by the API
   server only and is never sent to the browser or returned by an API endpoint.
   For compatibility, the server also accepts this project's existing
   server-side `GOOGLE_STUDIO` secret; prefer `GEMINI_API_KEY` for new setup.
3. Apply the development database schema:

   ```sh
   pnpm --filter @workspace/db run push
   ```

4. Start the `artifacts/api-server: API Server` and
   `artifacts/speclens-ai: web` workflows.

The model currently used is `gemini-2.5-flash`, which was listed as supporting
`generateContent` by the configured Google AI Studio key. The API status
endpoint reports whether a server-side Gemini key is configured; account access
and quota are checked when an analysis is requested. SpecLens never substitutes
sample AI output. Quota exhaustion, rate limits, invalid keys, and malformed
model responses are reported without saving an analysis.

## Architecture

- **Frontend:** React, Vite, Wouter, and generated React Query hooks in
  `@workspace/api-client-react`.
- **API:** Shared Express server under `/api`; OpenAPI contract is maintained in
  `lib/api-spec/openapi.yaml`.
- **AI:** The API server calls Gemini through Google's official `@google/genai`
  SDK. Structured JSON is schema-validated, and each quoted evidence passage
  must exactly occur in the submitted PRD before it can be saved.
- **Persistence:** PostgreSQL via Drizzle. Completed analyses, PRD text,
  findings, questions, confidence signal, preflight checks, and creation time
  are stored in the `speclens_analyses` table.
- **Metrics:** Dashboard totals and category/severity counts are derived from
  persisted records.
- **No authentication:** This first version intentionally has no accounts or
  user-level access controls.

## API and validation

The PRD must be non-empty and no longer than 20,000 characters. Deterministic
preflight checks run before the model call; short context or missing acceptance
criteria are surfaced as review signals rather than automatic blockers.

No result is shown or saved when the model call fails or its response is
invalid. Persistence failures return an error instead of claiming the analysis
was saved. The UI provides a retry action. Confidence is a heuristic based on
document length and evidence verification, not a statistically calibrated
probability.

## Checks

```sh
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/speclens-ai run typecheck
```

The API unit tests exercise key detection, preflight checks, the confidence
disclaimer, schema-constrained Gemini requests, a valid cited finding, rejected
unsupported quotations and malformed JSON, and Gemini quota, rate-limit,
invalid-key, and service failures using a test client.

## Manual test steps

1. **Happy path:** Add a feature name and a complete PRD, run analysis, and
   confirm the findings, evidence, recommendations, questions, confidence
   explanation, and preflight checks appear.
2. **Empty input:** Submit with either required field blank. Confirm inline
   validation appears and no AI request is made.
3. **Ambiguous requirement:** Use a sentence such as “The export should be
   quick and easy.” Confirm any ambiguity finding cites the exact sentence.
4. **Missing logic:** Use a short password-reset flow without defining expiry,
   invalid-link, or unknown-account behavior. Confirm material omissions are
   labeled as not specified rather than quoted.
5. **API failure:** Run the API unit tests for Gemini quota, rate-limit,
   invalid-key, and service errors. Confirm failed requests do not create
   history records.
6. **Persistence after reload:** Complete an analysis, open History, open that
   saved record, refresh the page, and confirm it remains available. Check that
   the dashboard totals include the saved record.
