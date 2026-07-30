import {
  TOPIC_STATE_POLICY_VERSION,
  type TopicCandidateState,
  type TopicStateAction,
} from './constants.js';
import { TopicError } from './errors.js';

export interface TopicStateTransitionResult {
  readonly from: TopicCandidateState;
  readonly policyVersion: typeof TOPIC_STATE_POLICY_VERSION;
  readonly reason: string;
  readonly to: TopicCandidateState;
}

export function transitionTopicState(
  current: TopicCandidateState,
  action: TopicStateAction,
  undoTarget: TopicCandidateState | null = null,
): TopicStateTransitionResult {
  let next: TopicCandidateState | null = null;
  switch (action) {
    case 'LOCK':
      if (current === 'PROPOSED' || current === 'HELD') next = 'LOCKED';
      break;
    case 'HOLD':
      if (current === 'PROPOSED' || current === 'LOCKED') next = 'HELD';
      break;
    case 'RESUME':
      if (current === 'HELD') next = 'PROPOSED';
      break;
    case 'ARCHIVE':
      if (current !== 'ARCHIVED') next = 'ARCHIVED';
      break;
    case 'RESTORE':
      if (current === 'ARCHIVED') next = 'PROPOSED';
      break;
    case 'UNDO':
      if (undoTarget !== null && undoTarget !== current) next = undoTarget;
      break;
  }
  if (next === null) throw new TopicError('TOPIC_POLICY_BLOCKED');
  return Object.freeze({
    from: current,
    policyVersion: TOPIC_STATE_POLICY_VERSION,
    reason: action,
    to: next,
  });
}
