import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  LOCAL_API_HOST,
  type LocalApiClock,
  LocalApiError,
  type PairingView,
} from './contracts.js';

const DEFAULT_TTL_MILLISECONDS = 120_000;
const MAX_FAILED_ATTEMPTS = 5;

interface PairingRecord {
  readonly codeDigest: Buffer;
  readonly expiresAt: number;
  failedAttempts: number;
  readonly listenerInstanceId: string;
  readonly pairingSessionId: string;
  readonly port: number;
  readonly windowId: number;
}

export interface PairingSessionManagerOptions {
  readonly clock?: LocalApiClock;
  readonly randomCode?: () => Buffer;
  readonly randomId?: () => string;
  readonly ttlMilliseconds?: number;
}

export interface ConsumedPairing {
  readonly pairingSessionId: string;
  readonly windowId: number;
}

function digestCode(code: string): Buffer {
  return createHash('sha256').update(code, 'utf8').digest();
}

export class PairingSessionManager {
  readonly #clock: LocalApiClock;
  readonly #randomCode: () => Buffer;
  readonly #randomId: () => string;
  readonly #records = new Map<string, PairingRecord>();
  readonly #ttlMilliseconds: number;

  public constructor(options: PairingSessionManagerOptions = {}) {
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#randomCode = options.randomCode ?? (() => randomBytes(32));
    this.#randomId = options.randomId ?? randomUUID;
    this.#ttlMilliseconds = options.ttlMilliseconds ?? DEFAULT_TTL_MILLISECONDS;
  }

  public start(listenerInstanceId: string, port: number, windowId: number): PairingView {
    this.clearForWindow(windowId);
    this.#purgeExpired();
    const codeBytes = this.#randomCode();
    if (codeBytes.length !== 32) {
      throw new LocalApiError('LOCAL_API_INTERNAL_ERROR');
    }
    const pairingCode = codeBytes.toString('base64url');
    const pairingSessionId = this.#randomId();
    const expiresAt = this.#clock.now().getTime() + this.#ttlMilliseconds;
    this.#records.set(pairingSessionId, {
      codeDigest: digestCode(pairingCode),
      expiresAt,
      failedAttempts: 0,
      listenerInstanceId,
      pairingSessionId,
      port,
      windowId,
    });
    return {
      endpoint: `http://${LOCAL_API_HOST}:${port}`,
      expiresAt: new Date(expiresAt).toISOString(),
      pairingCode,
      pairingSessionId,
    };
  }

  public hasActive(listenerInstanceId: string, port: number): boolean {
    this.#purgeExpired();
    return [...this.#records.values()].some(
      (record) => record.listenerInstanceId === listenerInstanceId && record.port === port,
    );
  }

  public consume(code: string, listenerInstanceId: string, port: number): ConsumedPairing {
    const supplied = digestCode(code);
    const now = this.#clock.now().getTime();
    let expiredMatch = false;
    let listenerRecord: PairingRecord | undefined;
    for (const [id, record] of this.#records) {
      if (record.expiresAt <= now) {
        this.#records.delete(id);
        if (
          record.listenerInstanceId === listenerInstanceId &&
          record.port === port &&
          timingSafeEqual(supplied, record.codeDigest)
        ) {
          expiredMatch = true;
        }
        continue;
      }
      if (record.listenerInstanceId !== listenerInstanceId || record.port !== port) {
        continue;
      }
      listenerRecord = record;
      if (timingSafeEqual(supplied, record.codeDigest)) {
        this.#records.delete(record.pairingSessionId);
        return {
          pairingSessionId: record.pairingSessionId,
          windowId: record.windowId,
        };
      }
    }
    if (expiredMatch) {
      throw new LocalApiError('LOCAL_API_PAIRING_EXPIRED');
    }
    if (listenerRecord === undefined) {
      throw new LocalApiError('LOCAL_API_PAIRING_NOT_ACTIVE');
    }
    listenerRecord.failedAttempts += 1;
    if (listenerRecord.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      this.#records.delete(listenerRecord.pairingSessionId);
      throw new LocalApiError('LOCAL_API_PAIRING_ATTEMPTS_EXCEEDED');
    }
    throw new LocalApiError('LOCAL_API_PAIRING_INVALID');
  }

  public cancel(pairingSessionId: string, windowId: number): void {
    const record = this.#records.get(pairingSessionId);
    if (record === undefined || record.windowId !== windowId) {
      throw new LocalApiError('LOCAL_API_PAIRING_NOT_ACTIVE');
    }
    this.#records.delete(pairingSessionId);
  }

  public clearForWindow(windowId: number): void {
    for (const [id, record] of this.#records) {
      if (record.windowId === windowId) {
        this.#records.delete(id);
      }
    }
  }

  public clear(): void {
    this.#records.clear();
  }

  public activeCount(): number {
    this.#purgeExpired();
    return this.#records.size;
  }

  #purgeExpired(): void {
    const now = this.#clock.now().getTime();
    for (const [id, record] of this.#records) {
      if (record.expiresAt <= now) {
        this.#records.delete(id);
      }
    }
  }
}

export const PAIRING_TTL_MILLISECONDS = DEFAULT_TTL_MILLISECONDS;
export const PAIRING_MAX_FAILED_ATTEMPTS = MAX_FAILED_ATTEMPTS;
