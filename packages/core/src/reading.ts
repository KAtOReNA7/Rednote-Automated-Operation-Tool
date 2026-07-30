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
  readonly currentPersonalScoreAssertion: boolean;
  readonly readingState: ReadingState;
  readonly researchDossierReady: boolean;
  readonly scoreType: ScoreType;
  readonly userConfirmedScore: boolean;
}

export class ReadingStateConfirmationRequiredError extends Error {
  public constructor() {
    super('Reading state changes require an explicit user confirmation.');
    this.name = 'ReadingStateConfirmationRequiredError';
  }
}

export function createDefaultReadingState(): ReadingState {
  return ReadingState.UNCLASSIFIED;
}

export function transitionReadingState(
  current: ReadingState,
  next: ReadingState,
  context: ReadingTransitionContext,
): ReadingState {
  if (current === next) {
    return current;
  }

  if (context.actor !== ReadingTransitionActor.USER || !context.explicitlyConfirmed) {
    throw new ReadingStateConfirmationRequiredError();
  }

  return next;
}

export function allowsSpecificFirstPersonExperience(readingState: ReadingState): boolean {
  return readingState === ReadingState.R1_READ_CLEAR;
}

export function allowsPublicScore(context: PublicScoreContext): boolean {
  switch (context.scoreType) {
    case ScoreType.PERSONAL:
      return (
        context.userConfirmedScore &&
        (context.readingState === ReadingState.R1_READ_CLEAR ||
          (context.readingState === ReadingState.R2_READ_FUZZY &&
            context.currentPersonalScoreAssertion))
      );
    case ScoreType.RESEARCH_ANALYSIS:
      return (
        context.researchDossierReady &&
        context.readingState !== ReadingState.S2_RESEARCH_INSUFFICIENT &&
        context.readingState !== ReadingState.UNCLASSIFIED
      );
    case ScoreType.INTERNAL_PREDICTION:
      return false;
  }
}
