import { ReadingState, ScoreType } from './statuses.js';

export enum ReadingTransitionActor {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

export interface ReadingTransitionContext {
  readonly actor: ReadingTransitionActor;
  readonly explicitlyConfirmed: boolean;
}

export interface PublicScoreContext {
  readonly readingState: ReadingState;
  readonly scoreType: ScoreType;
  readonly userConfirmedScore: boolean;
}

export class ReadingStateConfirmationRequiredError extends Error {
  public constructor() {
    super('READ_CLEAR requires an explicit user confirmation.');
    this.name = 'ReadingStateConfirmationRequiredError';
  }
}

export function createDefaultReadingState(): ReadingState {
  return ReadingState.UNKNOWN;
}

export function transitionReadingState(
  current: ReadingState,
  next: ReadingState,
  context: ReadingTransitionContext,
): ReadingState {
  if (current === next) {
    return current;
  }

  if (
    next === ReadingState.READ_CLEAR &&
    (context.actor !== ReadingTransitionActor.USER || !context.explicitlyConfirmed)
  ) {
    throw new ReadingStateConfirmationRequiredError();
  }

  return next;
}

export function allowsSpecificFirstPersonExperience(readingState: ReadingState): boolean {
  return readingState === ReadingState.READ_CLEAR;
}

export function allowsPublicScore(context: PublicScoreContext): boolean {
  switch (context.scoreType) {
    case ScoreType.PERSONAL:
      return context.readingState === ReadingState.READ_CLEAR && context.userConfirmedScore;
    case ScoreType.RESEARCH_ANALYSIS:
      return true;
    case ScoreType.INTERNAL_PREDICTION:
      return false;
  }
}
