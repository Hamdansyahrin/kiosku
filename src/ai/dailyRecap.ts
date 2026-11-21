import { InferenceMode, Schema, type GenerativeModel } from "firebase/ai";
import { getRemoteConfigValues } from "../firebase/remoteConfig";
import type { DailyAggregate } from "../shop/types";
import { runStructured } from "./engine";
import { createHybridModel } from "./models";
import type { InferenceOutcome, ValidationResult } from "./types";

/**
 * Daily recap — the hybrid feature. At the end of the day the owner wants
 * a short, human summary of today's numbers: what sold, roughly what was
 * earned, one piece of advice. That is a small, private, short-context
 * job — exactly what on-device Gemini Nano is for — so the model runs
 * PREFER_ON_DEVICE and falls back to cloud Gemini when Nano is not
 * available. All figures are computed deterministically (shop/stats.ts);
 * the model only narrates them.
 */

export interface RecapNarrative {
  headline: string;
  highlights: string[];
  advice: string;
}

const recapSchema = Schema.object({
  properties: {
    headline: Schema.string({
      description: "One short sentence summarizing the day's trading.",
    }),
    highlights: Schema.array({
      items: Schema.string(),
      description: "2-4 short bullet facts drawn only from the given numbers.",
    }),
    advice: Schema.string({
      description: "One concrete, practical suggestion for tomorrow.",
    }),
  },
  optionalProperties: [],
});

function recapSchemaAsJson(): object {
  return JSON.parse(JSON.stringify(recapSchema)) as object;
}

let recapModel: GenerativeModel | null = null;

function getRecapModel(): GenerativeModel {
  if (!recapModel) {
    const { parseCloudModel } = getRemoteConfigValues();
    recapModel = createHybridModel({
      mode: InferenceMode.PREFER_ON_DEVICE,
      onDeviceParams: {
        promptOptions: { responseConstraint: recapSchemaAsJson() },
      },
      inCloudParams: {
        model: parseCloudModel,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: recapSchema,
        },
      },
    });
  }
  return recapModel;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateRecap(raw: unknown): ValidationResult<RecapNarrative> {
  if (!isRecord(raw)) return { ok: false, errors: ["not an object"] };
  const headline = typeof raw.headline === "string" ? raw.headline.trim() : "";
  const advice = typeof raw.advice === "string" ? raw.advice.trim() : "";
  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights.filter(
        (h): h is string => typeof h === "string" && h.trim().length > 0,
      )
    : [];
  const errors: string[] = [];
  if (!headline) errors.push("headline missing");
  if (highlights.length === 0) errors.push("highlights empty");
  if (!advice) errors.push("advice missing");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { headline, highlights, advice } };
}

function formatIdr(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

/** Generate the recap narrative for one day's aggregate. */
export async function generateDailyRecap(
  aggregate: DailyAggregate,
  language: "id" | "en",
): Promise<InferenceOutcome<RecapNarrative>> {
  const top = aggregate.items.slice(0, 5);
  const facts = {
    date: aggregate.dayKey,
    orders: aggregate.orderCount,
    totalSales: formatIdr(aggregate.totalSalesIdr),
    estimatedMargin:
      aggregate.marginIdr !== null
        ? `${formatIdr(aggregate.marginIdr)} (estimated over ${Math.round(
            aggregate.marginCoverage * 100,
          )}% of sales whose cost price is known)`
        : "unknown (no cost prices recorded yet)",
    topItems: top.map(
      (it) => `${it.name}: ${it.qty} sold, ${formatIdr(it.revenueIdr)}`,
    ),
  };
  const langName = language === "id" ? "Bahasa Indonesia" : "English";
  const prompt = `You are the back-office assistant of an Indonesian warung (small neighbourhood shop). Write the end-of-day recap from these verified figures — use ONLY these numbers, never invent others. Respond in ${langName}.

Return JSON: headline (one sentence), highlights (2-4 short facts), advice (one concrete suggestion for tomorrow, e.g. restock or promotion).

Today's figures:
${JSON.stringify(facts, null, 2)}`;

  return runStructured<RecapNarrative>({
    feature: "daily-recap",
    model: getRecapModel(),
    modeRequested: InferenceMode.PREFER_ON_DEVICE,
    prompt,
    validate: validateRecap,
  });
}
