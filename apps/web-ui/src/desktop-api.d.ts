import type { DesktopBridge } from '@mystery-operations/shared';
import type * as V2 from '@mystery-operations/v2';

declare global {
  type V2PlanCandidateContract = V2.PlanCandidateStatus;
  type V2PlanFieldsContract = V2.PlanRescheduleFields;
  type V2PlanModeContract = V2.PlanRescheduleMode;
  type V2PlanPreviewContract = V2.PlanReschedulePreview;
  type V2WeeklyPlanContract = V2.WeeklyPlan;
  type V2ContentPackageFieldsContract = V2.ContentPackageFields;
  type V2ContentWorkspaceContract = V2.ContentWorkspace;
  type V2InteractionDeletePreviewContract = V2.InteractionDeletePreview;
  type V2InteractionStatusContract = Exclude<V2.InteractionStatus, 'DELETED'>;
  type V2InteractionWorkspaceContract = V2.InteractionWorkspace;
  type V2MetricsReviewContract = V2.MetricsReview;

  interface Window {
    readonly rednoteDesktop?: DesktopBridge;
    readonly rednoteV2?: V2.V2Bridge;
  }
}

export {};
