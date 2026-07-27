import { SpoilerLevel } from './statuses.js';

export interface SpoilerWarnings {
  readonly bodyOpening: boolean;
  readonly cover: boolean;
  readonly title: boolean;
}

export function hasRequiredSpoilerWarnings(
  spoilerLevel: SpoilerLevel,
  warnings: SpoilerWarnings,
): boolean {
  switch (spoilerLevel) {
    case SpoilerLevel.NONE:
      return true;
    case SpoilerLevel.LIGHT:
      return warnings.title || warnings.bodyOpening;
    case SpoilerLevel.FULL:
      return warnings.cover && warnings.title && warnings.bodyOpening;
  }
}
