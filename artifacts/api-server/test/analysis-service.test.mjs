import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  AnalysisOutputError,
  AnalysisProviderError,
  aiIsConfigured,
  analyzePrdWithGemini,
  classifyGeminiError,
  GEMINI_MODEL,
  makeConfidenceSignal,
  runPreflightChecks,
} from "../src/lib/analysis-service.ts";

const originalGeminiApiKey = process.env.GEMINI_API_KEY;
const originalGoogleStudio = process.env.GOOGLE_STUDIO;

after(() => {
  if (originalGeminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiApiKey;
  if (originalGoogleStudio === undefined) delete process.env.GOOGLE_STUDIO;
  else process.env.GOOGLE_STUDIO = originalGoogleStudio;
});

function validDraft(evidence = "Users can request a data export from settings.") {
  return {
    findings: [
      {
        category: "Ambiguity",
        severity: "Medium",
        title: "Export behavior is unclear",
        evidenceType: "quoted_text",
        evidence,
        missingRequirement: "The output format and completion behavior are unclear.",
        implementationRisk:
          "Engineering could choose different formats and completion flows.",
        recommendation:
          "Specify the supported format and how users receive the export.",
      },
    ],
    questions: [
      "Which export format should the first release support?",
      "How should the user know when an export is ready?",
    ],
  };
}

async function withMockGemini(response, action) {
  process.env.GEMINI_API_KEY = "local-test-key";
  delete process.env.GOOGLE_STUDIO;
  const calls = [];
  const models = {
    generateContent: async (params) => {
      calls.push(params);
      if (response.error) throw response.error;
      return {
        text: response.text ?? JSON.stringify(response.draft),
      };
    },
  };
  await action(models, calls);
}

test("AI configuration reports a missing key without reading or exposing it", () => {
  assert.equal(aiIsConfigured(""), false);
  assert.equal(aiIsConfigured("configured"), true);
});

test("Gemini API configuration accepts the existing server-side Google Studio secret", () => {
  process.env.GEMINI_API_KEY = "";
  process.env.GOOGLE_STUDIO = "configured-server-secret";
  assert.equal(aiIsConfigured(), true);
});

test("analysis fails clearly without either server-side Gemini key", async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_STUDIO;
  await assert.rejects(
    analyzePrdWithGemini("Data export", "Users can export reports."),
    (error) =>
      error instanceof AnalysisProviderError && error.kind === "missing_key",
  );
});

test("preflight checks are deterministic and short context is a non-blocking signal", () => {
  const checks = runPreflightChecks("Export", "Users can export.");
  assert.equal(checks.length, 6);
  assert.equal(checks.find((check) => check.id === "prd-content")?.passed, true);
  assert.equal(checks.find((check) => check.id === "context")?.passed, false);
  assert.match(
    checks.find((check) => check.id === "context")?.detail ?? "",
    /not a blocker/,
  );
});

test("a valid Gemini response is accepted only when its quote exactly appears in the PRD", async () => {
  await withMockGemini({ draft: validDraft() }, async (models, calls) => {
    const result = await analyzePrdWithGemini(
      "Data export",
      "Users can request a data export from settings.",
      models,
    );
    assert.equal(result.findings.length, 1);
    assert.equal(
      result.findings[0].evidence,
      "Users can request a data export from settings.",
    );
    assert.ok(result.findings[0].id);
    assert.equal(result.questions.length, 2);
    assert.equal(calls[0].model, GEMINI_MODEL);
    assert.equal(calls[0].config.responseMimeType, "application/json");
    assert.equal(calls[0].config.responseJsonSchema.type, "object");
  });
});

test("an unsupported quotation rejects the entire Gemini response", async () => {
  await withMockGemini(
    { draft: validDraft("This sentence is not in the PRD.") },
    async (models) => {
      await assert.rejects(
        analyzePrdWithGemini(
          "Data export",
          "Users can export reports.",
          models,
        ),
        AnalysisOutputError,
      );
    },
  );
});

test("unspecified evidence is normalized to null before returning the finding", async () => {
  const draft = {
    findings: [
      {
        category: "Missing Logic",
        severity: "Medium",
        title: "Retry behavior is missing",
        evidenceType: "not_specified",
        evidence: "",
        missingRequirement: "The retry policy is not defined.",
        implementationRisk:
          "Implementations could retry at different times or not at all.",
        recommendation: "Specify when and how many retries are allowed.",
      },
    ],
    questions: [
      "How many retry attempts should the first release allow?",
      "How long should the app wait between retry attempts?",
    ],
  };
  await withMockGemini({ draft }, async (models) => {
    const result = await analyzePrdWithGemini(
      "Data export",
      "Users can export reports.",
      models,
    );
    assert.equal(result.findings[0].evidenceType, "not_specified");
    assert.equal(result.findings[0].evidence, null);
  });
});

test("malformed Gemini JSON is rejected instead of returned as an analysis", async () => {
  await withMockGemini({ text: "not valid JSON" }, async (models) => {
    await assert.rejects(
      analyzePrdWithGemini("Data export", "Users can export reports.", models),
      AnalysisOutputError,
    );
  });
});

test("Gemini service errors are returned as provider errors", async () => {
  await withMockGemini(
    { error: Object.assign(new Error("test service unavailable"), { status: 503 }) },
    async (models) => {
      await assert.rejects(
        analyzePrdWithGemini(
          "Data export",
          "Users can export reports.",
          models,
        ),
        AnalysisProviderError,
      );
    },
  );
});

test("Gemini quota and rate-limit errors are distinguished", () => {
  assert.equal(
    classifyGeminiError(
      Object.assign(new Error("You have exceeded your quota."), {
        status: 429,
      }),
    ).kind,
    "credits",
  );
  assert.equal(
    classifyGeminiError(
      Object.assign(new Error("Rate limit exceeded for requests per minute."), {
        status: 429,
      }),
    ).kind,
    "rate_limit",
  );
});

test("an invalid Gemini key is classified without returning provider details", () => {
  const error = classifyGeminiError(
    Object.assign(new Error("API key not valid"), { status: 400 }),
  );
  assert.equal(error.kind, "invalid_key");
  assert.equal(error.message, "Gemini rejected the configured API key.");
});

test("confidence is a bounded heuristic with an explicit calibration disclaimer", () => {
  const signal = makeConfidenceSignal("A concise PRD.");
  assert.ok(signal.score >= 0 && signal.score <= 100);
  assert.match(signal.explanation, /not a statistically calibrated probability/i);
});
