import React, { useMemo } from "react";
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";

import { ApiErrorBoundary } from "components/common/ApiErrorBoundary";

import { useGetInstanceConfiguration, useInvalidateAllWorkspaceScopeOnChange, useListWorkspaces } from "core/api";
import { useAnalyticsIdentifyUser, useAnalyticsRegisterValues } from "core/services/analytics";
import { useExperiment } from "hooks/services/Experiment";
import { useApiHealthPoll } from "hooks/services/Health";
import { useBuildUpdateCheck } from "hooks/services/useBuildUpdateCheck";
import { useCurrentWorkspace } from "hooks/services/useWorkspace";
import { CompleteOauthRequest } from "views/CompleteOauthRequest";
import MainView from "views/layout/MainView";

import { RoutePaths, DestinationPaths, SourcePaths } from "./routePaths";
import { WorkspaceRead } from "../core/request/AirbyteClient";

const ConnectionsRoutes = React.lazy(() => import("./connections/ConnectionsRoutes"));
const ConnectorBuilderRoutes = React.lazy(() => import("./connectorBuilder/ConnectorBuilderRoutes"));
const AllDestinationsPage = React.lazy(() => import("./destination/AllDestinationsPage"));
const CreateDestinationPage = React.lazy(() => import("./destination/CreateDestinationPage"));
const SelectDestinationPage = React.lazy(() => import("./destination/SelectDestinationPage"));
const DestinationItemPage = React.lazy(() => import("./destination/DestinationItemPage"));
const DestinationConnectionsPage = React.lazy(() => import("./destination/DestinationConnectionsPage"));
const DestinationSettingsPage = React.lazy(() => import("./destination/DestinationSettingsPage"));
const SetupPage = React.lazy(() => import("./SetupPage"));
const SettingsPage = React.lazy(() => import("./SettingsPage"));
const AllSourcesPage = React.lazy(() => import("./source/AllSourcesPage"));
const CreateSourcePage = React.lazy(() => import("./source/CreateSourcePage"));
const SelectSourcePage = React.lazy(() => import("./source/SelectSourcePage"));
const SourceItemPage = React.lazy(() => import("./source/SourceItemPage"));
const SourceSettingsPage = React.lazy(() => import("./source/SourceSettingsPage"));
const SourceConnectionsPage = React.lazy(() => import("./source/SourceConnectionsPage"));

const WorkspacesPage = React.lazy(() => import("./workspaces/WorkspacesPage"));

const useAddAnalyticsContextForWorkspace = (workspace: WorkspaceRead): void => {
  const analyticsContext = useMemo(
    () => ({
      workspace_id: workspace.workspaceId,
      customer_id: workspace.customerId,
    }),
    [workspace.workspaceId, workspace.customerId]
  );
  useAnalyticsRegisterValues(analyticsContext);
  useAnalyticsIdentifyUser(workspace.workspaceId);
};

const MainViewRoutes: React.FC = () => {
  return (
    <MainView>
      <ApiErrorBoundary>
        <Routes>
          <Route path={RoutePaths.Destination}>
            <Route index element={<AllDestinationsPage />} />
            <Route path={DestinationPaths.SelectDestinationNew} element={<SelectDestinationPage />} />
            <Route path={DestinationPaths.DestinationNew} element={<CreateDestinationPage />} />
            <Route path={DestinationPaths.Root} element={<DestinationItemPage />}>
              <Route index element={<DestinationSettingsPage />} />
              <Route path={DestinationPaths.Connections} element={<DestinationConnectionsPage />} />
            </Route>
          </Route>
          <Route path={RoutePaths.Source}>
            <Route index element={<AllSourcesPage />} />
            <Route path={SourcePaths.SelectSourceNew} element={<SelectSourcePage />} />
            <Route path={SourcePaths.SourceNew} element={<CreateSourcePage />} />
            <Route path={SourcePaths.Root} element={<SourceItemPage />}>
              <Route index element={<SourceSettingsPage />} />
              <Route path={SourcePaths.Connections} element={<SourceConnectionsPage />} />
            </Route>
          </Route>
          <Route path={`${RoutePaths.Connections}/*`} element={<ConnectionsRoutes />} />
          <Route path={`${RoutePaths.Settings}/*`} element={<SettingsPage />} />
          <Route path={`${RoutePaths.ConnectorBuilder}/*`} element={<ConnectorBuilderRoutes />} />

          <Route path="*" element={<Navigate to={RoutePaths.Connections} />} />
        </Routes>
      </ApiErrorBoundary>
    </MainView>
  );
};

const PreferencesRoutes = () => (
  <Routes>
    <Route path={RoutePaths.Setup} element={<SetupPage />} />
    <Route path="*" element={<Navigate to={RoutePaths.Setup} />} />
  </Routes>
);

export const AutoSelectFirstWorkspace: React.FC = () => {
  const location = useLocation();
  const { workspaces } = useListWorkspaces();
  const currentWorkspace = workspaces[0];
  const [searchParams] = useSearchParams();

  return (
    <Navigate
      to={{
        pathname: `/${RoutePaths.Workspaces}/${currentWorkspace.workspaceId}${location.pathname}`,
        search: `?${searchParams.toString()}`,
      }}
      replace
    />
  );
};

const RoutingWithWorkspace: React.FC<{ element?: JSX.Element }> = ({ element }) => {
  const { initialSetupComplete } = useGetInstanceConfiguration();
  const workspace = useCurrentWorkspace();
  useAddAnalyticsContextForWorkspace(workspace);
  useApiHealthPoll();

  // invalidate everything in the workspace scope when the workspaceId changes
  useInvalidateAllWorkspaceScopeOnChange(workspace.workspaceId);

  return initialSetupComplete ? element ?? <MainViewRoutes /> : <PreferencesRoutes />;
};

export const Routing: React.FC = () => {
  useBuildUpdateCheck();

  // TODO: Remove this after it is verified there are no problems with current routing
  const OldRoutes = useMemo(
    () =>
      Object.values(RoutePaths).map((r) => <Route path={`${r}/*`} key={r} element={<AutoSelectFirstWorkspace />} />),
    []
  );

  const isNewWorkspacesUIEnabled = useExperiment("workspaces.newWorkspacesUI", false);

  return (
    <Routes>
      {OldRoutes}
      <Route path={RoutePaths.AuthFlow} element={<CompleteOauthRequest />} />
      {isNewWorkspacesUIEnabled && <Route path={RoutePaths.Workspaces} element={<WorkspacesPage />} />}
      <Route path={`${RoutePaths.Workspaces}/:workspaceId/*`} element={<RoutingWithWorkspace />} />
      <Route path="*" element={<AutoSelectFirstWorkspace />} />
    </Routes>
  );
};
