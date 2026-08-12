import {
  classifyCapabilityProbeFailure,
  classifyCapabilityProbeResponse,
} from './capability-probe-classifier.js';
import {
  CAPABILITY_PROBE_LIMITS,
  type CapabilityProbeObservation,
  type CapabilityProbePlan,
  type CapabilityProbeRequest,
  type CapabilityProbeRunResult,
  type CapabilityProbeRunnerOptions,
  type CapabilityProbeStep,
  type CapabilityProbeTransport,
  type ProbeReasonCode,
} from './capability-probe-contracts.js';
import { capabilityProbeRequestBody } from './capability-probe-payloads.js';

function requestForStep(
  baseUrl: string,
  credential: string,
  step: CapabilityProbeStep,
  signal: AbortSignal,
  timeoutMs: number,
): CapabilityProbeRequest {
  const method =
    step.kind === 'METADATA' ? 'GET' : step.kind === 'BATCH_METADATA' ? 'OPTIONS' : 'POST';
  const path: CapabilityProbeRequest['path'] =
    step.kind === 'METADATA'
      ? '/models'
      : step.kind === 'BATCH_METADATA'
        ? '/batches'
        : step.kind === 'IMAGE'
          ? '/images/generations'
          : step.protocolMode === 'CHAT_COMPLETIONS'
            ? '/chat/completions'
            : '/responses';
  return {
    baseUrl,
    body: method === 'POST' ? capabilityProbeRequestBody(step) : null,
    credential,
    method,
    path,
    signal,
    timeoutMs,
  };
}

export function capabilityProbeStepTimeoutMs(step: CapabilityProbeStep): number {
  return step.kind === 'STRUCTURED'
    ? CAPABILITY_PROBE_LIMITS.structuredStepTimeoutMs
    : step.kind === 'IMAGE'
      ? CAPABILITY_PROBE_LIMITS.imageStepTimeoutMs
      : CAPABILITY_PROBE_LIMITS.stepTimeoutMs;
}

function globalStopReason(
  observations: readonly CapabilityProbeObservation[],
  consecutiveInfrastructureFailures: number,
): ProbeReasonCode | null {
  const reason = observations[0]?.reasonCode;
  if (
    reason === 'AUTHENTICATION_REJECTED' ||
    reason === 'PERMISSION_REJECTED' ||
    reason === 'RATE_LIMITED' ||
    reason === 'CONFIG_STALE'
  ) {
    return reason;
  }
  return consecutiveInfrastructureFailures >= 3 ? 'AMBIGUOUS_OUTCOME' : null;
}

function isInfrastructureFailure(observation: CapabilityProbeObservation): boolean {
  return ['NETWORK_UNREACHABLE', 'TLS_FAILURE', 'TIMEOUT', 'AMBIGUOUS_OUTCOME'].includes(
    observation.reasonCode,
  );
}

export class CapabilityProbeRunner {
  readonly #transport: CapabilityProbeTransport;

  public constructor(transport: CapabilityProbeTransport) {
    this.#transport = transport;
  }

  public async run(
    plan: CapabilityProbePlan,
    baseUrl: string,
    credential: string,
    options: CapabilityProbeRunnerOptions,
  ): Promise<CapabilityProbeRunResult> {
    if (
      plan.requestCount !== plan.steps.length ||
      plan.requestCount > CAPABILITY_PROBE_LIMITS.maxExternalRequests
    ) {
      return {
        completedAt: (options.now ?? (() => new Date()))().toISOString(),
        observations: [],
        reasonCode: 'INTERNAL_ERROR',
        sentRequestCount: 0,
        status: 'FAILED',
      };
    }
    const now = options.now ?? (() => new Date());
    const deadline =
      now().getTime() + (options.runDeadlineMs ?? CAPABILITY_PROBE_LIMITS.runDeadlineMs);
    const observations: CapabilityProbeObservation[] = [];
    let sentRequestCount = 0;
    let completedRequestCount = 0;
    let consecutiveInfrastructureFailures = 0;
    let stopReason: ProbeReasonCode | null = null;

    for (const step of plan.steps) {
      if (options.signal.aborted) {
        stopReason = 'ABORTED';
        break;
      }
      if (!options.isConfigCurrent()) {
        stopReason = 'CONFIG_STALE';
        break;
      }
      const remaining = deadline - now().getTime();
      if (remaining <= 0) {
        stopReason = 'TIMEOUT';
        break;
      }
      options.onProgress?.({
        completedRequestCount,
        currentCapability: step.capability,
        plannedRequestCount: plan.requestCount,
        runId: options.runId,
        sentRequestCount,
        status: 'RUNNING',
      });
      let stepObservations: readonly CapabilityProbeObservation[];
      try {
        await options.beforeExternalRequest?.(step);
      } catch {
        stopReason = 'INTERNAL_ERROR';
        break;
      }
      sentRequestCount += 1;
      try {
        const response = await this.#transport.request(
          requestForStep(
            baseUrl,
            credential,
            step,
            options.signal,
            Math.min(remaining, options.stepTimeoutMs ?? capabilityProbeStepTimeoutMs(step)),
          ),
        );
        stepObservations = classifyCapabilityProbeResponse(step, response, now().toISOString());
      } catch (error) {
        stepObservations = [classifyCapabilityProbeFailure(step, error, now().toISOString())];
      }
      await options.afterExternalRequest?.(step, stepObservations);
      completedRequestCount += 1;
      for (const observation of stepObservations) {
        observations.push(observation);
        await options.onObservation?.(observation);
      }
      consecutiveInfrastructureFailures = stepObservations.some(isInfrastructureFailure)
        ? consecutiveInfrastructureFailures + 1
        : 0;
      stopReason = globalStopReason(stepObservations, consecutiveInfrastructureFailures);
      if (stopReason !== null) {
        break;
      }
    }

    const status: CapabilityProbeRunResult['status'] =
      stopReason === 'ABORTED'
        ? 'CANCELLED'
        : stopReason === null && sentRequestCount === plan.requestCount
          ? 'SUCCEEDED'
          : sentRequestCount === 0
            ? 'FAILED'
            : 'PARTIAL';
    options.onProgress?.({
      completedRequestCount,
      currentCapability: null,
      plannedRequestCount: plan.requestCount,
      runId: options.runId,
      sentRequestCount,
      status,
    });
    return {
      completedAt: now().toISOString(),
      observations: Object.freeze(observations),
      reasonCode: stopReason,
      sentRequestCount,
      status,
    };
  }
}
