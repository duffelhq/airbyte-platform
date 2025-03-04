import classNames from "classnames";
import React from "react";
import { FormattedMessage } from "react-intl";
import { Outlet } from "react-router-dom";

import { LoadingPage } from "components";
import { CreditsIcon } from "components/icons/CreditsIcon";
import { AdminWorkspaceWarning } from "components/ui/AdminWorkspaceWarning";
import { FlexItem } from "components/ui/Flex";
import { ThemeToggle } from "components/ui/ThemeToggle";

import { useCurrentWorkspace } from "core/api";
import { useGetCloudWorkspaceAsync } from "core/api/cloud";
import { CloudWorkspaceReadWorkspaceTrialStatus as WorkspaceTrialStatus } from "core/api/types/CloudApi";
import { useAuthService } from "core/services/auth";
import { FeatureItem, useFeature } from "core/services/features";
import { isCorporateEmail } from "core/utils/freeEmailProviders";
import { useAppMonitoringService } from "hooks/services/AppMonitoringService";
import { useExperiment } from "hooks/services/Experiment";
import { CloudRoutes } from "packages/cloud/cloudRoutePaths";
import { useExperimentSpeedyConnection } from "packages/cloud/components/experiments/SpeedyConnection/hooks/useExperimentSpeedyConnection";
import { SpeedyConnectionBanner } from "packages/cloud/components/experiments/SpeedyConnection/SpeedyConnectionBanner";
import { RoutePaths } from "pages/routePaths";
import { ResourceNotFoundErrorBoundary } from "views/common/ResourceNotFoundErrorBoundary";
import { StartOverErrorView } from "views/common/StartOverErrorView";
import { AirbyteHomeLink } from "views/layout/SideBar/AirbyteHomeLink";
import { MenuContent } from "views/layout/SideBar/components/MenuContent";
import { NavItem } from "views/layout/SideBar/components/NavItem";
import SettingsIcon from "views/layout/SideBar/components/SettingsIcon";
import { MainNavItems } from "views/layout/SideBar/MainNavItems";
import { SideBar } from "views/layout/SideBar/SideBar";

import { CloudHelpDropdown } from "./CloudHelpDropdown";
import styles from "./CloudMainView.module.scss";
import { InsufficientPermissionsErrorBoundary } from "./InsufficientPermissionsErrorBoundary";
import { WorkspaceStatusBanner } from "./WorkspaceStatusBanner";
import { LOW_BALANCE_CREDIT_THRESHOLD } from "../../billing/BillingPage/components/LowCreditBalanceHint/LowCreditBalanceHint";
import { WorkspacePopout } from "../../workspaces/WorkspacePopout";

const CloudMainView: React.FC<React.PropsWithChildren<unknown>> = (props) => {
  const workspace = useCurrentWorkspace();
  const cloudWorkspace = useGetCloudWorkspaceAsync(workspace.workspaceId);

  const isShowAdminWarningEnabled = useFeature(FeatureItem.ShowAdminWarningInWorkspace);
  const isNewTrialPolicy = useExperiment("billing.newTrialPolicy", false);
  const { trackError } = useAppMonitoringService();

  // exp-speedy-connection
  const { isExperimentVariant } = useExperimentSpeedyConnection();

  const { user } = useAuthService();

  const isTrial = isNewTrialPolicy
    ? cloudWorkspace?.workspaceTrialStatus === WorkspaceTrialStatus.in_trial ||
      cloudWorkspace?.workspaceTrialStatus === WorkspaceTrialStatus.pre_trial
    : Boolean(cloudWorkspace?.trialExpiryTimestamp);

  const showExperimentBanner = isExperimentVariant && isTrial && user && isCorporateEmail(user.email);

  return (
    <div className={classNames(styles.mainContainer)}>
      <InsufficientPermissionsErrorBoundary errorComponent={<StartOverErrorView />} trackError={trackError}>
        <SideBar>
          <AirbyteHomeLink />
          {isShowAdminWarningEnabled && <AdminWorkspaceWarning />}
          <WorkspacePopout>
            {({ onOpen, value }) => (
              <button className={styles.workspaceButton} onClick={onOpen} data-testid="workspaceButton">
                {value}
              </button>
            )}
          </WorkspacePopout>
          <MenuContent>
            <MainNavItems />
            <MenuContent>
              <NavItem
                to={CloudRoutes.Billing}
                icon={<CreditsIcon />}
                label={<FormattedMessage id="sidebar.billing" />}
                testId="creditsButton"
                withNotification={
                  cloudWorkspace &&
                  (!cloudWorkspace.remainingCredits || cloudWorkspace.remainingCredits <= LOW_BALANCE_CREDIT_THRESHOLD)
                }
              />
              <CloudHelpDropdown />
              <NavItem
                label={<FormattedMessage id="sidebar.settings" />}
                icon={<SettingsIcon />}
                to={RoutePaths.Settings}
              />
              <FlexItem className={styles.themeContainer}>
                <ThemeToggle />
              </FlexItem>
            </MenuContent>
          </MenuContent>
        </SideBar>
        <div className={styles.content}>
          {cloudWorkspace &&
            (showExperimentBanner ? (
              <SpeedyConnectionBanner />
            ) : (
              <WorkspaceStatusBanner cloudWorkspace={cloudWorkspace} />
            ))}
          <div className={styles.dataBlock}>
            <ResourceNotFoundErrorBoundary errorComponent={<StartOverErrorView />} trackError={trackError}>
              <React.Suspense fallback={<LoadingPage />}>{props.children ?? <Outlet />}</React.Suspense>
            </ResourceNotFoundErrorBoundary>
          </div>
        </div>
      </InsufficientPermissionsErrorBoundary>
    </div>
  );
};

export default CloudMainView;
