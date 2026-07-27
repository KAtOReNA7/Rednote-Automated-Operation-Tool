import type { Job } from './types.js';
import type { JobQueueService } from './queue-service.js';

export class JobRecoveryService {
  readonly #queueService: JobQueueService;

  public constructor(queueService: JobQueueService) {
    this.#queueService = queueService;
  }

  public recoverExpiredLeases(limit = 100): readonly Job[] {
    return this.#queueService.recoverExpiredLeases(limit);
  }
}
