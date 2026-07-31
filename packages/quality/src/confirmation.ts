import { randomBytes } from 'node:crypto';

import { FACT_MAPPING_LIMITS } from './constants.js';
import { FactMappingError } from './errors.js';
import { factMappingHash } from './identity.js';

export interface FactMappingConfirmationPreview<T> {
  readonly expiresAt: string;
  readonly payload: T;
  readonly previewHash: string;
  readonly token: string;
}

interface Pending<T> {
  readonly expiresAt: string;
  readonly payload: T;
  readonly previewHash: string;
  readonly senderId: number;
  readonly windowId: number;
}

export class FactMappingConfirmationBroker<T> {
  readonly #now: () => number;
  readonly #pending = new Map<string, Pending<T>>();
  readonly #tokenFactory: () => string;

  public constructor(
    options: { readonly now?: () => number; readonly tokenFactory?: () => string } = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));
  }

  public issue(payload: T, senderId: number, windowId: number): FactMappingConfirmationPreview<T> {
    const token = this.#tokenFactory();
    const expiresAt = new Date(this.#now() + FACT_MAPPING_LIMITS.confirmationTtlMs).toISOString();
    const previewHash = factMappingHash(payload);
    this.#pending.set(token, { expiresAt, payload, previewHash, senderId, windowId });
    return Object.freeze({ expiresAt, payload, previewHash, token });
  }

  public consume(token: string, previewHash: string, senderId: number, windowId: number): T {
    const pending = this.#pending.get(token);
    this.#pending.delete(token);
    if (
      pending === undefined ||
      pending.previewHash !== previewHash ||
      pending.senderId !== senderId ||
      pending.windowId !== windowId
    ) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_INVALID');
    }
    if (Date.parse(pending.expiresAt) <= this.#now()) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_EXPIRED');
    }
    return pending.payload;
  }

  public clearWindow(windowId: number): void {
    for (const [token, pending] of this.#pending) {
      if (pending.windowId === windowId) this.#pending.delete(token);
    }
  }
}
