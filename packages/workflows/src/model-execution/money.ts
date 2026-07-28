export const MICRO_USD_PER_USD = 1_000_000n;
export const MICRO_USD_PER_CENT = 10_000n;
export const MAX_SQLITE_INTEGER = 9_007_199_254_740_991n;
export const MAX_MONEY_DECIMAL_LENGTH = 48;

export class DecimalMoneyError extends TypeError {
  public readonly code: 'DECIMAL_INVALID' | 'DECIMAL_PRECISION' | 'MONEY_OVERFLOW';

  public constructor(code: DecimalMoneyError['code']) {
    super(code);
    this.name = 'DecimalMoneyError';
    this.code = code;
  }
}

interface DecimalParts {
  readonly denominator: bigint;
  readonly numerator: bigint;
  readonly scale: number;
}

export function parseDecimalRational(value: string, maximumScale = 12): DecimalParts {
  if (
    value.length < 1 ||
    value.length > MAX_MONEY_DECIMAL_LENGTH ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)
  ) {
    throw new DecimalMoneyError('DECIMAL_INVALID');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > maximumScale) {
    throw new DecimalMoneyError('DECIMAL_PRECISION');
  }
  const denominator = 10n ** BigInt(fraction.length);
  return {
    denominator,
    numerator: BigInt(whole ?? '0') * denominator + BigInt(fraction || '0'),
    scale: fraction.length,
  };
}

function checkedSafeMoney(value: bigint): number {
  if (value < 0n || value > MAX_SQLITE_INTEGER) {
    throw new DecimalMoneyError('MONEY_OVERFLOW');
  }
  return Number(value);
}

export function parseProviderUsdToMicroUsd(value: string): number {
  const parts = parseDecimalRational(value, 6);
  return checkedSafeMoney(parts.numerator * 10n ** BigInt(6 - parts.scale));
}

export function centsToMicroUsd(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DecimalMoneyError('DECIMAL_INVALID');
  }
  return checkedSafeMoney(BigInt(value) * MICRO_USD_PER_CENT);
}

export function estimateRateMicroUsd(
  units: number,
  decimalUsdRate: string,
  unitsPerRate: number,
): number {
  if (
    !Number.isSafeInteger(units) ||
    units < 0 ||
    !Number.isSafeInteger(unitsPerRate) ||
    unitsPerRate < 1
  ) {
    throw new DecimalMoneyError('DECIMAL_INVALID');
  }
  const rate = parseDecimalRational(decimalUsdRate);
  const numerator = BigInt(units) * rate.numerator * MICRO_USD_PER_USD;
  const denominator = BigInt(unitsPerRate) * rate.denominator;
  return checkedSafeMoney((numerator + denominator - 1n) / denominator);
}

export function addMicroUsd(values: readonly number[]): number {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new DecimalMoneyError('DECIMAL_INVALID');
    }
    total += BigInt(value);
  }
  return checkedSafeMoney(total);
}

export function formatMicroUsd(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DecimalMoneyError('DECIMAL_INVALID');
  }
  const amount = BigInt(value);
  const whole = amount / MICRO_USD_PER_USD;
  const fraction = (amount % MICRO_USD_PER_USD).toString().padStart(6, '0').replace(/0+$/u, '');
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}
