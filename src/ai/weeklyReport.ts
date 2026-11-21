import { InferenceMode, Schema, type GenerativeModel } from "firebase/ai";
import { getRemoteConfigValues } from "../firebase/remoteConfig";
import type { WeekStats } from "../shop/stats";
import { runStructured } from "./engine";
import { createCloudModel } from "./models";
import type { InferenceOutcome, ValidationResult } from "./types";

/**
 * Weekly report — the cloud feature. A week of ledger data is
 * long-context, higher-stakes reasoning: margin analysis across dozens of
 * products, a restock plan, and a polished supplier message. That is
 * deliberately ONLY_IN_CLOUD work for the cloud Gemini model; the
 * on-device model is never asked to chew on it. Figures are computed
 * deterministically (shop/stats.ts) and handed to the model as a compact
 * table — the model analyzes and writes, it does not invent numbers.
 */

export interface WeeklyReportContent {
  summary: string;
  marginAnalysis: string;
  bestSellers: string[];
  restockPlan: { product: string; qtySuggestion: string; reason: string }[];
  supplierMessage: string;
  risks: string[];
}

const reportSchema = Schema.object({
  properties: {
    summary: Schema.string({
      description: "A short paragraph summarizing the week's trading.",
    }),
    marginAnalysis: Schema.string({
      description:
        "Analysis of the week's margins: which products earn, which drag, using only the given figures.",
    }),
    bestSellers: Schema.array({
      items: Schema.string(),
      description: "3-5 best-selling products with their week's numbers.",
    }),
    restockPlan: Schema.array({
      items: Schema.object({
        properties: {
          product: Schema.string(),
          qtySuggestion: Schema.string({
            description: "Suggested restock quantity, e.g. '10 packs'.",
          }),
          reason: Schema.string(),
        },
      }),
      description: "Products to restock before next week, most urgent first.",
    }),
    supplierMessage: Schema.string({
      description:
        "A ready-to-send WhatsApp message to the shop's supplier in polite Bahasa Indonesia, listing the restock order from the restock plan with quantities, asking for price confirmation and delivery.",
    }),
    risks: Schema.array({
      items: Schema.string(),
      description: "Risks or watch-outs for next week drawn from the data.",
    }),
  },
  optionalProperties: [],
});

function getReportModel(): GenerativeModel {
  const { weeklyReportModel } = getRemoteConfigValues();
  return createCloudModel({
    model: weeklyReportModel,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: reportSchema,
    },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0,
      )
    : [];
}

export function validateWeeklyReport(
  raw: unknown,
): ValidationResult<WeeklyReportContent> {
  if (!isRecord(raw)) return { ok: false, errors: ["not an object"] };
  const errors: string[] = [];
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const marginAnalysis =
    typeof raw.marginAnalysis === "string" ? raw.marginAnalysis.trim() : "";
  const supplierMessage =
    typeof raw.supplierMessage === "string" ? raw.supplierMessage.trim() : "";
  if (!summary) errors.push("summary missing");
  if (!marginAnalysis) errors.push("marginAnalysis missing");
  if (!supplierMessage) errors.push("supplierMessage missing");
  const bestSellers = stringList(raw.bestSellers);
  if (bestSellers.length === 0) errors.push("bestSellers empty");
  const restockPlan: WeeklyReportContent["restockPlan"] = [];
  if (Array.isArray(raw.restockPlan)) {
    raw.restockPlan.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        errors.push(`restockPlan[${i}] is not an object`);
        return;
      }
      const product = typeof item.product === "string" ? item.product : "";
      const qtySuggestion =
        typeof item.qtySuggestion === "string" ? item.qtySuggestion : "";
      const reason = typeof item.reason === "string" ? item.reason : "";
      if (product && qtySuggestion) {
        restockPlan.push({ product, qtySuggestion, reason });
      }
    });
  }
  if (restockPlan.length === 0) errors.push("restockPlan empty");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      summary,
      marginAnalysis,
      bestSellers,
      restockPlan,
      supplierMessage,
      risks: stringList(raw.risks),
    },
  };
}

function formatIdr(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

/** Generate the weekly report over the given week's computed stats. */
export async function generateWeeklyReport(
  stats: WeekStats,
  language: "id" | "en",
): Promise<InferenceOutcome<WeeklyReportContent>> {
  const payload = {
    range: `${stats.rangeStart} to ${stats.rangeEnd}`,
    totals: {
      orders: stats.orderCount,
      totalSales: formatIdr(stats.totalSalesIdr),
      estimatedMargin:
        stats.marginIdr !== null
          ? `${formatIdr(stats.marginIdr)} (estimated over ${Math.round(
              stats.marginCoverage * 100,
            )}% of sales whose cost price is known)`
          : "unknown (no cost prices recorded)",
    },
    byDay: stats.days.map((d) => ({
      date: d.dayKey,
      orders: d.orderCount,
      sales: formatIdr(d.totalSalesIdr),
    })),
    productsByRevenue: stats.items.slice(0, 20).map((it) => ({
      product: it.name,
      qtySold: it.qty,
      revenue: formatIdr(it.revenueIdr),
      margin:
        it.costIdr !== null
          ? formatIdr(it.revenueIdr - it.costIdr)
          : "cost unknown",
    })),
    productsByQty: stats.topByQty.slice(0, 10).map((it) => ({
      product: it.name,
      qtySold: it.qty,
    })),
  };
  const langName = language === "id" ? "Bahasa Indonesia" : "English";
  const prompt = `You are the back-office analyst of an Indonesian warung (small neighbourhood shop). Write the weekly business report from the verified figures below — use ONLY these numbers, never invent others. Write summary, marginAnalysis, bestSellers and risks in ${langName}. The supplierMessage must ALWAYS be in polite Bahasa Indonesia (it goes to a local supplier), as a WhatsApp-ready message listing the restock order.

Return JSON matching the schema: summary, marginAnalysis, bestSellers (3-5 entries with numbers), restockPlan (product, qtySuggestion, reason — base quantities on the week's sales velocity), supplierMessage, risks.

Week's verified figures:
${JSON.stringify(payload, null, 2)}`;

  return runStructured<WeeklyReportContent>({
    feature: "weekly-report",
    model: getReportModel(),
    modeRequested: InferenceMode.ONLY_IN_CLOUD,
    prompt,
    validate: validateWeeklyReport,
    maxAttempts: 3,
  });
}
