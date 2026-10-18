import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import {
  AnalysisOutputError,
  AnalysisProviderError,
  aiIsConfigured,
  analyzePrdWithOpenAI,
  makeConfidenceSignal,
  runPreflightChecks,
} from "../src/lib/analysis-service.ts";

const originalApiKey = process.env.OPENAI_API_KEY;
const originalBaseUrl = process.env.OPENAI_BASE_URL;

after(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = originalBaseUrl;
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

async function withMockOpenAI(response, action) {
  const server = createServer((_req, res) => {
    res.writeHead(response.status ?? 200, {
      "content-type": "application/json",
    });
    res.end(
      JSON.stringify(
        response.body ?? {
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify(response.draft),
              },
              finish_reason: "stop",
            },
          ],
        },
      ),
    );
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.env.OPENAI_API_KEY = "local-test-key";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;

  try {
    await action();
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("AI configuration reports a missing key without reading or exposing it", () => {
  assert.equal(aiIsConfigured(""), false);
  assert.equal(aiIsConfigured("configured"), true);
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

test("a valid AI response is accepted only when its quote exactly appears in the PRD", async () => {
  await withMockOpenAI({ draft: validDraft() }, async () => {
    const result = await analyzePrdWithOpenAI(
      "Data export",
      "Users can request a data export from settings.",
    );
    assert.equal(result.findings.length, 1);
    assert.equal(
      result.findings[0].evidence,
      "Users can request a data export from settings.",
    );
    assert.ok(result.findings[0].id);
    assert.equal(result.questions.length, 2);
  });
});

test("an unsupported quotation rejects the entire AI response", async () => {
  await withMockOpenAI(
    { draft: validDraft("This sentence is not in the PRD.") },
    async () => {
      await assert.rejects(
        analyzePrdWithOpenAI("Data export", "Users can export reports."),
        AnalysisOutputError,
      );
    },
  );
});

test("an OpenAI API failure is returned as a provider error", async () => {
  await withMockOpenAI(
    {
      status: 503,
      body: { error: { message: "test service unavailable" } },
    },
    async () => {
      await assert.rejects(
        analyzePrdWithOpenAI("Data export", "Users can export reports."),
        AnalysisProviderError,
      );
    },
  );
});

test("an exhausted OpenAI quota is distinguished from a temporary API outage", async () => {
  await withMockOpenAI(
    {
      status: 429,
      body: {
        error: {
          message: "You have no credits remaining.",
          type: "insufficient_quota",
          code: "insufficient_quota",
        },
      },
    },
    async () => {
      await assert.rejects(
        analyzePrdWithOpenAI("Data export", "Users can export reports."),
        (error) =>
          error instanceof AnalysisProviderError && error.kind === "credits",
      );
    },
  );
});

test("confidence is a bounded heuristic with an explicit calibration disclaimer", () => {
  const signal = makeConfidenceSignal("A concise PRD.");
  assert.ok(signal.score >= 0 && signal.score <= 100);
  assert.match(signal.explanation, /not a statistically calibrated probability/i);
});
