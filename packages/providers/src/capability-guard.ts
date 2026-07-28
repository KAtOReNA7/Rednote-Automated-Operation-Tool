import type { ProbeCapability, ProbeState } from './capability-probe-contracts.js';

export const CAPABILITY_GUARD_ERROR_CODES = Object.freeze([
  'CAPABILITY_UNKNOWN',
  'CAPABILITY_UNSUPPORTED',
  'CAPABILITY_STALE',
] as const);
export type CapabilityGuardErrorCode = (typeof CAPABILITY_GUARD_ERROR_CODES)[number];

export class CapabilityGuardError extends Error {
  public readonly code: CapabilityGuardErrorCode;
  public readonly capability: ProbeCapability;

  public constructor(code: CapabilityGuardErrorCode, capability: ProbeCapability) {
    super(code);
    this.name = 'CapabilityGuardError';
    this.code = code;
    this.capability = capability;
  }
}

export function assertCurrentCapabilitySupported(input: {
  readonly capability: ProbeCapability;
  readonly stale: boolean;
  readonly state: ProbeState;
}): void {
  if (input.stale) {
    throw new CapabilityGuardError('CAPABILITY_STALE', input.capability);
  }
  if (input.state === 'UNKNOWN') {
    throw new CapabilityGuardError('CAPABILITY_UNKNOWN', input.capability);
  }
  if (input.state === 'UNSUPPORTED') {
    throw new CapabilityGuardError('CAPABILITY_UNSUPPORTED', input.capability);
  }
}
