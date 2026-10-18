import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const analysesTable = pgTable("speclens_analyses", {
  id: serial("id").primaryKey(),
  featureName: varchar("feature_name", { length: 120 }).notNull(),
  prdText: text("prd_text").notNull(),
  findings: jsonb("findings").notNull(),
  questions: jsonb("questions").notNull(),
  confidence: jsonb("confidence").notNull(),
  preflightChecks: jsonb("preflight_checks").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertAnalysisSchema = createInsertSchema(analysesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type AnalysisRecord = typeof analysesTable.$inferSelect;
