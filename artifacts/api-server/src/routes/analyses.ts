import { count, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AnalyzePrdBody,
  AnalyzePrdResponse,
  GetAiStatusResponse,
  GetAnalysisParams,
  GetAnalysisResponse,
  GetDashboardSummaryResponse,
  ListAnalysesQueryParams,
  ListAnalysesResponse,
  ListAnalysesResponseItem,
} from "@workspace/api-zod";
import { analysesTable, db } from "@workspace/db";
import {
  AnalysisOutputError,
  AnalysisProviderError,
  aiIsConfigured,
  analyzePrdWithGemini,
  getAiStatusMessage,
  makeConfidenceSignal,
  runPreflightChecks,
} from "../lib/analysis-service";

const router: IRouter = Router();
const MAX_PRD_LENGTH = 20_000;

function toListItem(row: {
  id: number;
  featureName: string;
  findings: unknown;
  createdAt: Date;
}) {
  const findings = Array.isArray(row.findings) ? row.findings : [];
  const highSeverityCount = findings.filter(
    (finding) =>
      !!finding &&
      typeof finding === "object" &&
      "severity" in finding &&
      finding.severity === "High",
  ).length;

  return ListAnalysesResponseItem.parse({
    id: row.id,
    featureName: row.featureName,
    findingCount: findings.length,
    highSeverityCount,
    createdAt: row.createdAt,
  });
}

router.get("/ai/status", (_req, res): void => {
  const ready = aiIsConfigured();
  res.json(
    GetAiStatusResponse.parse({
      ready,
      message: getAiStatusMessage(),
    }),
  );
});

router.get("/analyses", async (req, res): Promise<void> => {
  const query = ListAnalysesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid history paging parameters." });
    return;
  }

  const rows = await db
    .select({
      id: analysesTable.id,
      featureName: analysesTable.featureName,
      findings: analysesTable.findings,
      createdAt: analysesTable.createdAt,
    })
    .from(analysesTable)
    .orderBy(desc(analysesTable.createdAt), desc(analysesTable.id))
    .limit(query.data.limit)
    .offset(query.data.offset);

  res.json(ListAnalysesResponse.parse(rows.map(toListItem)));
});

router.post("/analyses", async (req, res): Promise<void> => {
  const rawPrd = req.body?.prdText;
  if (typeof rawPrd === "string" && rawPrd.length > MAX_PRD_LENGTH) {
    res.status(413).json({
      error: `PRD text must be ${MAX_PRD_LENGTH.toLocaleString()} characters or fewer.`,
    });
    return;
  }

  const input = AnalyzePrdBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
      error: "Enter a feature name and PRD text before analyzing.",
    });
    return;
  }

  const featureName = input.data.featureName.trim();
  const prdText = input.data.prdText;
  if (!featureName || !prdText.trim()) {
    res.status(400).json({
      error: "Enter a feature name and PRD text before analyzing.",
    });
    return;
  }

  const preflightChecks = runPreflightChecks(featureName, prdText);
  if (!aiIsConfigured()) {
    res.status(503).json({
      error:
        "Gemini is not configured. Add GEMINI_API_KEY in Replit Secrets, then retry.",
    });
    return;
  }

  let result: Awaited<ReturnType<typeof analyzePrdWithGemini>>;
  try {
    result = await analyzePrdWithGemini(featureName, prdText);
  } catch (error) {
    if (error instanceof AnalysisOutputError) {
      req.log.warn({ err: error }, "AI analysis output failed validation");
      res.status(502).json({
        error:
          "The AI returned an analysis that could not be verified. No result was saved. Please retry.",
      });
      return;
    }

    if (error instanceof AnalysisProviderError) {
      req.log.error({ kind: error.kind }, "Gemini analysis request failed");
      if (error.kind === "credits") {
        res.status(503).json({
          error:
            "The Gemini API quota or account limit has been reached. Check Google AI Studio quota and retry later. No result was saved.",
        });
        return;
      }

      if (error.kind === "rate_limit") {
        res.status(503).json({
          error:
            "Gemini is temporarily rate-limited. Wait briefly and retry. No result was saved.",
        });
        return;
      }

      if (error.kind === "invalid_key") {
        res.status(503).json({
          error:
            "Gemini rejected the configured API key. Check GEMINI_API_KEY in Replit Secrets, then retry. No result was saved.",
        });
        return;
      }

      res.status(502).json({
        error:
          "The AI service could not complete the analysis. No result was saved. Please retry.",
      });
      return;
    }

    req.log.error({ err: error }, "Unexpected analysis failure");
    res.status(502).json({
      error:
        "The AI service could not complete the analysis. No result was saved. Please retry.",
    });
    return;
  }

  const confidence = makeConfidenceSignal(prdText);
  let row;
  try {
    [row] = await db
      .insert(analysesTable)
      .values({
        featureName,
        prdText,
        findings: result.findings,
        questions: result.questions,
        confidence,
        preflightChecks,
      })
      .returning();
  } catch (error) {
    req.log.error({ err: error }, "Analysis completed but could not be persisted");
    res.status(503).json({
      error:
        "The analysis could not be saved. No completed result is being shown; please retry.",
    });
    return;
  }

  if (!row) {
    req.log.error("Analysis insert returned no saved row");
    res.status(503).json({
      error: "The analysis could not be saved. Please retry.",
    });
    return;
  }

  res.status(201).json(
    AnalyzePrdResponse.parse({
      id: row.id,
      featureName: row.featureName,
      prdText: row.prdText,
      findings: row.findings,
      questions: row.questions,
      confidence: row.confidence,
      preflightChecks: row.preflightChecks,
      createdAt: row.createdAt,
    }),
  );
});

router.get("/analyses/:id", async (req, res): Promise<void> => {
  const params = GetAnalysisParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid analysis id." });
    return;
  }

  const [row] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.id, params.data.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Analysis not found." });
    return;
  }

  res.json(
    GetAnalysisResponse.parse({
      id: row.id,
      featureName: row.featureName,
      prdText: row.prdText,
      findings: row.findings,
      questions: row.questions,
      confidence: row.confidence,
      preflightChecks: row.preflightChecks,
      createdAt: row.createdAt,
    }),
  );
});

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [[analysisTotal], rows, recentRows] = await Promise.all([
    db.select({ total: count() }).from(analysesTable),
    db.select({ findings: analysesTable.findings }).from(analysesTable),
    db
      .select({
        id: analysesTable.id,
        featureName: analysesTable.featureName,
        findings: analysesTable.findings,
        createdAt: analysesTable.createdAt,
      })
      .from(analysesTable)
      .orderBy(desc(analysesTable.createdAt), desc(analysesTable.id))
      .limit(8),
  ]);

  const findingsByCategory = {
    ambiguity: 0,
    missingLogic: 0,
    undefinedInputs: 0,
  };
  const findingsBySeverity = { high: 0, medium: 0, low: 0 };
  let totalFindings = 0;

  for (const row of rows) {
    const findings = Array.isArray(row.findings) ? row.findings : [];
    for (const item of findings) {
      if (!item || typeof item !== "object") continue;
      const finding = item as Record<string, unknown>;
      totalFindings += 1;

      if (finding.category === "Ambiguity") findingsByCategory.ambiguity += 1;
      if (finding.category === "Missing Logic")
        findingsByCategory.missingLogic += 1;
      if (finding.category === "Undefined Inputs")
        findingsByCategory.undefinedInputs += 1;

      if (finding.severity === "High") findingsBySeverity.high += 1;
      if (finding.severity === "Medium") findingsBySeverity.medium += 1;
      if (finding.severity === "Low") findingsBySeverity.low += 1;
    }
  }

  res.json(
    GetDashboardSummaryResponse.parse({
      totalAnalyses: Number(analysisTotal?.total ?? 0),
      totalFindings,
      findingsByCategory,
      findingsBySeverity,
      recentAnalyses: recentRows.map(toListItem),
    }),
  );
});

export default router;
