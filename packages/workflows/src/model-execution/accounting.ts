import {
  addMicroUsd,
  centsToMicroUsd,
  estimateRateMicroUsd,
  parseDecimalRational,
  parseProviderUsdToMicroUsd,
} from './money.js';
import type { ModelUnitDemandV1, ProviderCostObservationV1, UsageObservationV1 } from './types.js';

export const DEFAULT_WARNING_MICRO_USD = centsToMicroUsd(8_000);
export const DEFAULT_HARD_LIMIT_MICRO_USD = centsToMicroUsd(10_000);

export interface ModelPriceScheduleV1 {
  readonly cachedInputPerMillionUsd: string | null;
  readonly cacheWritePerMillionUsd: string | null;
  readonly callUsd: string | null;
  readonly currency: 'USD';
  readonly imageGenerationCallUsd: string | null;
  readonly imageUsd: string | null;
  readonly inputPerMillionUsd: string | null;
  readonly inputTokensIncludeCachedInput: boolean;
  readonly operationKind: string;
  readonly outputPerMillionUsd: string | null;
  readonly protocolMode: string | null;
  readonly providerConfigFingerprint: string;
  readonly searchCallUsd: string | null;
  readonly toolUnitUsd: string | null;
  readonly usageSemanticsVersion: string;
  readonly version: number;
}

export interface CalculatedCostV1 {
  readonly amountMicroUsd: number | null;
  readonly complete: boolean;
  readonly knownPartialAmountMicroUsd: number;
  readonly state: 'UNPRICED_USAGE' | 'USER_PRICE_TABLE_ESTIMATE';
}

function charged(
  units: number | null,
  rate: string | null,
  per: number,
  required: boolean,
): { readonly amount: number; readonly complete: boolean } {
  if (units === null || units === 0) {
    return { amount: 0, complete: !required || units === 0 };
  }
  return rate === null
    ? { amount: 0, complete: false }
    : { amount: estimateRateMicroUsd(units, rate, per), complete: true };
}

export function calculateUserPriceTableCost(
  usage: UsageObservationV1,
  schedule: ModelPriceScheduleV1,
): CalculatedCostV1 {
  const cached = usage.cachedInputTokens;
  const normalInput =
    schedule.inputTokensIncludeCachedInput &&
    usage.inputTokens !== null &&
    cached !== null &&
    cached <= usage.inputTokens
      ? usage.inputTokens - cached
      : usage.inputTokens;
  const parts = [
    charged(normalInput, schedule.inputPerMillionUsd, 1_000_000, normalInput === null),
    charged(usage.outputTokens, schedule.outputPerMillionUsd, 1_000_000, false),
    charged(cached, schedule.cachedInputPerMillionUsd, 1_000_000, false),
    charged(usage.cacheWriteTokens, schedule.cacheWritePerMillionUsd, 1_000_000, false),
    charged(usage.images, schedule.imageUsd, 1, false),
    charged(usage.imageGenerationCalls, schedule.imageGenerationCallUsd, 1, false),
    charged(usage.webSearchCalls, schedule.searchCallUsd, 1, false),
    charged(usage.toolCalls, schedule.toolUnitUsd, 1, false),
    charged(schedule.callUsd === null ? 0 : 1, schedule.callUsd, 1, false),
  ];
  const knownPartialAmountMicroUsd = addMicroUsd(parts.map((part) => part.amount));
  const complete = parts.every((part) => part.complete);
  return Object.freeze({
    amountMicroUsd: complete ? knownPartialAmountMicroUsd : null,
    complete,
    knownPartialAmountMicroUsd,
    state: complete ? 'USER_PRICE_TABLE_ESTIMATE' : 'UNPRICED_USAGE',
  });
}

export function parseProviderCostObservation(
  observation: ProviderCostObservationV1 | null,
): number | null {
  if (
    observation === null ||
    observation.currency !== 'USD' ||
    observation.evidenceKind !== 'ALLOWLISTED_RESPONSE_FIELD'
  ) {
    return null;
  }
  return parseProviderUsdToMicroUsd(observation.decimalAmountString);
}

export function validatePriceSchedule(schedule: ModelPriceScheduleV1): void {
  for (const value of [
    schedule.cachedInputPerMillionUsd,
    schedule.cacheWritePerMillionUsd,
    schedule.callUsd,
    schedule.imageGenerationCallUsd,
    schedule.imageUsd,
    schedule.inputPerMillionUsd,
    schedule.outputPerMillionUsd,
    schedule.searchCallUsd,
    schedule.toolUnitUsd,
  ]) {
    if (value !== null) {
      parseDecimalRational(value);
    }
  }
}

export function utcBillingMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function utcWeekKey(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface UnitBudgetPolicyV1 {
  readonly maxExternalCallsMonthly: number;
  readonly maxExternalCallsWeekly: number;
  readonly maxImageGenerationCalls: number | null;
  readonly maxImages: number | null;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly maxToolCalls: number | null;
  readonly maxWebSearchCalls: number | null;
}

export function assertDemandCoveredByUnitPolicy(
  demand: ModelUnitDemandV1,
  policy: UnitBudgetPolicyV1 | null,
): void {
  if (policy === null) {
    throw new Error('BUDGET_UNPRICED_LIMIT_REQUIRED');
  }
  const pairs: readonly [number, number | null][] = [
    [demand.externalCalls, policy.maxExternalCallsMonthly],
    [demand.externalCalls, policy.maxExternalCallsWeekly],
    [demand.images, policy.maxImages],
    [demand.imageGenerationCalls, policy.maxImageGenerationCalls],
    [demand.inputTokens ?? 0, policy.maxInputTokens],
    [demand.outputTokens ?? 0, policy.maxOutputTokens],
    [demand.webSearchCalls, policy.maxWebSearchCalls],
    [demand.toolCalls, policy.maxToolCalls],
  ];
  if (
    pairs.some(([demanded, maximum]) => demanded > 0 && (maximum === null || demanded > maximum))
  ) {
    throw new Error('BUDGET_UNPRICED_LIMIT_REQUIRED');
  }
}
