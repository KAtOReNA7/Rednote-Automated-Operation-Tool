import type {
  BibliographyJobResultV1,
  BibliographicObservationV1,
  DiscoveryPlanV1,
} from './contracts.js';
import { CatalogError } from './errors.js';

export interface DiscoveryOriginInputV1 {
  readonly originKind: BibliographicObservationV1['originKind'];
  readonly originRecordId: string;
  readonly originRevision: number;
  readonly sequence: number;
}

export interface DiscoveryProcessCountsV1 {
  readonly editions: number;
  readonly expressions: number;
  readonly observations: number;
  readonly reviewCases: number;
  readonly works: number;
}

export interface DiscoveryExecutionStateV1 {
  readonly checkpoint: number;
  readonly counts: DiscoveryProcessCountsV1;
  readonly plan: DiscoveryPlanV1;
  readonly state: 'CREATED' | 'EXISTING_COMPLETED' | 'RESUMED';
}

export interface BibliographyDiscoveryPersistenceV1 {
  beginExecution(
    runId: string,
    executionId: string,
    planHash: string,
    now: string,
  ): DiscoveryExecutionStateV1;
  finishExecution(
    runId: string,
    counts: DiscoveryProcessCountsV1,
    now: string,
  ): BibliographyJobResultV1;
  getOriginBatch(
    runId: string,
    afterSequence: number,
    limit: number,
  ): readonly DiscoveryOriginInputV1[];
  interruptExecution(
    runId: string,
    state: 'CANCELLED' | 'FAILED' | 'INTERRUPTED',
    stableError: string | null,
    now: string,
  ): BibliographyJobResultV1;
  processOrigin(
    runId: string,
    input: DiscoveryOriginInputV1,
    now: string,
  ): DiscoveryProcessCountsV1;
  saveCheckpoint(
    runId: string,
    checkpoint: number,
    counts: DiscoveryProcessCountsV1,
    now: string,
  ): void;
}

export interface DiscoveryExecutionContextV1 {
  heartbeat(): Promise<'CANCEL' | 'CONTINUE' | 'PAUSE'>;
  readonly now: () => Date;
  readonly signal: AbortSignal;
}

function addCounts(
  left: DiscoveryProcessCountsV1,
  right: DiscoveryProcessCountsV1,
): DiscoveryProcessCountsV1 {
  return Object.freeze({
    editions: left.editions + right.editions,
    expressions: left.expressions + right.expressions,
    observations: left.observations + right.observations,
    reviewCases: left.reviewCases + right.reviewCases,
    works: left.works + right.works,
  });
}

export class BibliographyDiscoveryService {
  readonly #persistence: BibliographyDiscoveryPersistenceV1;

  public constructor(persistence: BibliographyDiscoveryPersistenceV1) {
    this.#persistence = persistence;
  }

  public async execute(
    runId: string,
    executionId: string,
    planHash: string,
    context: DiscoveryExecutionContextV1,
  ): Promise<BibliographyJobResultV1> {
    const started = this.#persistence.beginExecution(
      runId,
      executionId,
      planHash,
      context.now().toISOString(),
    );
    if (started.state === 'EXISTING_COMPLETED') {
      return this.#persistence.finishExecution(runId, started.counts, context.now().toISOString());
    }
    let checkpoint = started.checkpoint;
    let counts = started.counts;
    const deadline = context.now().getTime() + started.plan.limits.maxRuntimeMs;

    try {
      while (!context.signal.aborted) {
        const control = await context.heartbeat();
        if (control !== 'CONTINUE') {
          return this.#persistence.interruptExecution(
            runId,
            control === 'CANCEL' ? 'CANCELLED' : 'INTERRUPTED',
            null,
            context.now().toISOString(),
          );
        }
        if (context.now().getTime() >= deadline) {
          return this.#persistence.interruptExecution(
            runId,
            'INTERRUPTED',
            'CATALOG_RUNTIME_LIMIT',
            context.now().toISOString(),
          );
        }
        const batch = this.#persistence.getOriginBatch(
          runId,
          checkpoint,
          started.plan.limits.batchSize,
        );
        if (batch.length === 0) break;
        for (const input of batch) {
          if (context.signal.aborted) {
            return this.#persistence.interruptExecution(
              runId,
              'INTERRUPTED',
              null,
              context.now().toISOString(),
            );
          }
          counts = addCounts(
            counts,
            this.#persistence.processOrigin(runId, input, context.now().toISOString()),
          );
          checkpoint = input.sequence;
        }
        this.#persistence.saveCheckpoint(runId, checkpoint, counts, context.now().toISOString());
      }
      return this.#persistence.finishExecution(runId, counts, context.now().toISOString());
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      this.#persistence.interruptExecution(
        runId,
        'FAILED',
        'CATALOG_EXECUTION_FAILED',
        context.now().toISOString(),
      );
      throw error;
    }
  }
}
