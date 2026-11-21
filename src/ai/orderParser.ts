import {
  InferenceMode,
  Schema,
  type GenerativeModel,
} from "firebase/ai";
import { getRemoteConfigValues } from "../firebase/remoteConfig";
import { runStructured } from "./engine";
import { createCloudModel, createHybridModel } from "./models";
import type { InferenceOutcome, ValidationResult } from "./types";

/**
 * Order parser — KiosKu's first vertical slice and the showcase of the
 * hybrid split:
 *
 *   Short order chat  -> PREFER_ON_DEVICE. Parsing a WhatsApp order is a
 *   small, structured, privacy-sensitive job: the shop's numbers should not
 *   have to leave the device, and it should work with the shop's flaky
 *   connection. Gemini Nano does it offline; the SDK falls back to cloud
 *   Gemini when Nano is unavailable.
 *
 *   Long input (over the Remote Config threshold) -> ONLY_IN_CLOUD. A
 *   multi-day chat dump is long-context work; forcing it through the cloud
 *   model is deliberate, and the routing log shows that decision.
 *
 * One JSON schema constrains BOTH paths: it is the cloud `responseSchema`
 * and, serialized to plain JSON, the on-device `responseConstraint`.
 */

export interface OrderItem {
  name: string;
  qty: number;
  /** Unit price in Indonesian rupiah; 0 when the message doesn't say. */
  unitPriceIdr: number;
}

export interface ParsedOrder {
  /** Buyer name when stated, otherwise "". */
  buyer: string;
  items: OrderItem[];
  /** Free-form extra notes (payment, delivery, timing); "" when none. */
  notes: string;
  /** Sum of qty * unitPriceIdr over items with a known price. */
  totalIdr: number;
}

export const orderSchema = Schema.object({
  properties: {
    buyer: Schema.string({
      description: "Name of the buyer if stated in the message; empty string otherwise.",
    }),
    items: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string({ description: "Product name as written by the buyer." }),
          qty: Schema.number({
            description: "Quantity ordered, in units. Use 1 when not stated.",
          }),
          unitPriceIdr: Schema.integer({
            description:
              "Unit price in Indonesian rupiah when stated (e.g. '15rb' = 15000); 0 when unknown.",
          }),
        },
      }),
    }),
    notes: Schema.string({
      description:
        "Anything else relevant: payment method, delivery, timing. Empty string when none.",
    }),
  },
  optionalProperties: [],
});

/** Plain-JSON form of the schema for Chrome's Prompt API responseConstraint. */
function orderSchemaAsJson(): object {
  return JSON.parse(JSON.stringify(orderSchema)) as object;
}

let hybridParseModel: GenerativeModel | null = null;

function getHybridParseModel(): GenerativeModel {
  if (!hybridParseModel) {
    const { parseCloudModel } = getRemoteConfigValues();
    hybridParseModel = createHybridModel({
      mode: InferenceMode.PREFER_ON_DEVICE,
      onDeviceParams: {
        promptOptions: { responseConstraint: orderSchemaAsJson() },
      },
      inCloudParams: {
        model: parseCloudModel,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: orderSchema,
        },
      },
    });
  }
  return hybridParseModel;
}

function getCloudParseModel(): GenerativeModel {
  const { parseCloudModel } = getRemoteConfigValues();
  return createCloudModel({
    model: parseCloudModel,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: orderSchema,
    },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceNonNegativeNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Validate + coerce the model's JSON into a ParsedOrder. Never trusts the
 *  raw output: wrong shapes are rejected with specific errors. */
export function validateParsedOrder(raw: unknown): ValidationResult<ParsedOrder> {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ["top-level value is not an object"] };
  }
  const buyer = typeof raw.buyer === "string" ? raw.buyer : "";
  const notes = typeof raw.notes === "string" ? raw.notes : "";
  if (!Array.isArray(raw.items)) {
    return { ok: false, errors: ["items is not an array"] };
  }
  const items: OrderItem[] = [];
  raw.items.forEach((item: unknown, i: number) => {
    if (!isRecord(item)) {
      errors.push(`items[${i}] is not an object`);
      return;
    }
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) errors.push(`items[${i}].name is missing`);
    const qty = coerceNonNegativeNumber(item.qty);
    if (qty === null || qty === 0) errors.push(`items[${i}].qty is invalid`);
    const unitPriceIdr = coerceNonNegativeNumber(item.unitPriceIdr) ?? 0;
    if (name && qty !== null && qty > 0) {
      items.push({ name, qty, unitPriceIdr: Math.round(unitPriceIdr) });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  if (items.length === 0) {
    return { ok: false, errors: ["no order items could be extracted"] };
  }
  const totalIdr = items.reduce((sum, it) => sum + it.qty * it.unitPriceIdr, 0);
  return { ok: true, value: { buyer, items, notes, totalIdr } };
}

const PARSE_INSTRUCTION = `You extract structured orders from informal WhatsApp-style messages sent to an Indonesian warung (small shop). The message may mix Indonesian and English and use shorthand like "2x", "rb" (ribu = thousand rupiah), "pcs", "lusin" (dozen = 12).

Return ONLY JSON matching the provided schema:
- buyer: the buyer's name if stated, else "".
- items: every ordered product with qty (units; "1 lusin" = 12) and unitPriceIdr (unit price in rupiah; "15rb" = 15000; 0 if the price is not stated).
- notes: payment/delivery/timing details, else "".

Message:
`;

export interface OrderParseOutcome {
  outcome: InferenceOutcome<ParsedOrder>;
  /** The routing decision taken before inference, for display + the log. */
  routedTo: "hybrid (prefer on-device)" | "cloud-only (long input)";
  inputChars: number;
}

/**
 * Parse one order message. The context-size router lives here: inputs over
 * the Remote Config threshold go cloud-only by design.
 */
export async function parseOrderMessage(
  message: string,
): Promise<OrderParseOutcome> {
  const { maxOnDeviceInputChars } = getRemoteConfigValues();
  const inputChars = message.length;
  const longInput = inputChars > maxOnDeviceInputChars;

  const outcome = await runStructured<ParsedOrder>({
    feature: "order-parse",
    model: longInput ? getCloudParseModel() : getHybridParseModel(),
    modeRequested: longInput
      ? InferenceMode.ONLY_IN_CLOUD
      : InferenceMode.PREFER_ON_DEVICE,
    prompt: PARSE_INSTRUCTION + message,
    validate: validateParsedOrder,
  });

  return {
    outcome,
    routedTo: longInput
      ? "cloud-only (long input)"
      : "hybrid (prefer on-device)",
    inputChars,
  };
}
