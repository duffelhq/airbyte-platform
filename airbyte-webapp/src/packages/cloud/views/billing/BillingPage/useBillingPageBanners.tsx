import { useCurrentWorkspace } from "core/api";
import { useFreeConnectorProgram, useGetCloudWorkspace } from "core/api/cloud";
import { CloudWorkspaceReadWorkspaceTrialStatus as WorkspaceTrialStatus } from "core/api/types/CloudApi";
import { useExperiment } from "hooks/services/Experiment";

import { LOW_BALANCE_CREDIT_THRESHOLD } from "./components/LowCreditBalanceHint/LowCreditBalanceHint";

export const useBillingPageBanners = () => {
  const currentWorkspace = useCurrentWorkspace();
  const cloudWorkspace = useGetCloudWorkspace(currentWorkspace.workspaceId);
  const { programStatusQuery } = useFreeConnectorProgram();
  const { hasEligibleConnections, hasNonEligibleConnections, isEnrolled } = programStatusQuery.data || {};
  const isNewTrialPolicyEnabled = useExperiment("billing.newTrialPolicy", false);

  const isPreTrial = isNewTrialPolicyEnabled
    ? cloudWorkspace.workspaceTrialStatus === WorkspaceTrialStatus.pre_trial
    : false;

  const creditStatus =
    (cloudWorkspace.remainingCredits ?? 0) < LOW_BALANCE_CREDIT_THRESHOLD
      ? (cloudWorkspace.remainingCredits ?? 0) <= 0
        ? "zero"
        : "low"
      : "positive";

  const calculateVariant = (): "warning" | "error" | "info" => {
    if (creditStatus === "low" && (hasNonEligibleConnections || !hasEligibleConnections)) {
      return "warning";
    }

    if (
      creditStatus === "zero" &&
      !isPreTrial &&
      (hasNonEligibleConnections || !hasEligibleConnections || (hasEligibleConnections && !isEnrolled))
    ) {
      return "error";
    }

    return "info";
  };

  return {
    bannerVariant: calculateVariant(),
  };
};
