import { randomBytes } from 'node:crypto';

import { AUTHENTICITY_LIMITS } from './constants.js';
import { AuthenticityError } from './errors.js';
import { authenticitySemanticHash } from './identity.js';

interface PendingAuthenticityConfirmation<T> {
  readonly expiresAt: number;
  readonly payload: T;
  readonly previewHash: string;
  readonly senderId: number;
  readonly windowId: number;
}

export interface AuthenticityConfirmationPreview<T> {
  readonly expiresAt: string;
  readonly payload: T;
  readonly previewHash: string;
  readonly token: string;
}

export class AuthenticityConfirmationBroker<T> {
  readonly #clock: () => Date;
  readonly #lifetimeMs: number;
  readonly #pending = new Map<string, PendingAuthenticityConfirmation<T>>();

  public constructor(
    clock: () => Date = () => new Date(),
    lifetimeMs = AUTHENTICITY_LIMITS.confirmationTtlMs,
  ) {
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1_000 || lifetimeMs > 15 * 60_000) {
      throw new TypeError('Authenticity confirmation lifetime is invalid.');
    }
    this.#clock = clock;
    this.#lifetimeMs = lifetimeMs;
  }

  public issue(payload: T, senderId: number, windowId: number): AuthenticityConfirmationPreview<T> {
    this.prune();
    const token = randomBytes(32).toString('base64url');
    const previewHash = authenticitySemanticHash(payload);
    const expiresAt = this.#clock().getTime() + this.#lifetimeMs;
    this.#pending.set(token, { expiresAt, payload, previewHash, senderId, windowId });
    return Object.freeze({
      expiresAt: new Date(expiresAt).toISOString(),
      payload,
      previewHash,
      token,
    });
  }

  public consume(token: string, previewHash: string, senderId: number, windowId: number): T {
    const pending = this.#pending.get(token);
    this.#pending.delete(token);
    if (
      pending === undefined ||
      pending.expiresAt <= this.#clock().getTime() ||
      pending.previewHash !== previewHash ||
      pending.senderId !== senderId ||
      pending.windowId !== windowId
    ) {
      throw new AuthenticityError('AUTHENTICITY_CONFIRMATION_INVALID');
    }
    return pending.payload;
  }

  public clearWindow(windowId: number): void {
    for (const [token, pending] of this.#pending) {
      if (pending.windowId === windowId) this.#pending.delete(token);
    }
  }

  public prune(): void {
    const now = this.#clock().getTime();
    for (const [token, pending] of this.#pending) {
      if (pending.expiresAt <= now) this.#pending.delete(token);
    }
  }
}
