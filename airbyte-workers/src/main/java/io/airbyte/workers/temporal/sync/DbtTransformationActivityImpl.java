/*
 * Copyright (c) 2023 Airbyte, Inc., all rights reserved.
 */

package io.airbyte.workers.temporal.sync;

import static io.airbyte.metrics.lib.ApmTraceConstants.ACTIVITY_TRACE_OPERATION_NAME;
import static io.airbyte.metrics.lib.ApmTraceConstants.Tags.ATTEMPT_NUMBER_KEY;
import static io.airbyte.metrics.lib.ApmTraceConstants.Tags.DESTINATION_DOCKER_IMAGE_KEY;
import static io.airbyte.metrics.lib.ApmTraceConstants.Tags.JOB_ID_KEY;

import datadog.trace.api.Trace;
import io.airbyte.api.client.AirbyteApiClient;
import io.airbyte.commons.functional.CheckedSupplier;
import io.airbyte.commons.json.Jsons;
import io.airbyte.commons.temporal.TemporalUtils;
import io.airbyte.commons.workers.config.WorkerConfigs;
import io.airbyte.commons.workers.config.WorkerConfigsProvider;
import io.airbyte.commons.workers.config.WorkerConfigsProvider.ResourceType;
import io.airbyte.config.AirbyteConfigValidator;
import io.airbyte.config.ConfigSchema;
import io.airbyte.config.Configs.WorkerEnvironment;
import io.airbyte.config.OperatorDbtInput;
import io.airbyte.config.ResourceRequirements;
import io.airbyte.config.helpers.LogConfigs;
import io.airbyte.config.persistence.split_secrets.SecretsHydrator;
import io.airbyte.featureflag.FeatureFlagClient;
import io.airbyte.metrics.lib.ApmTraceUtils;
import io.airbyte.metrics.lib.MetricClientFactory;
import io.airbyte.metrics.lib.OssMetricsRegistry;
import io.airbyte.persistence.job.models.IntegrationLauncherConfig;
import io.airbyte.persistence.job.models.JobRunConfig;
import io.airbyte.workers.ContainerOrchestratorConfig;
import io.airbyte.workers.Worker;
import io.airbyte.workers.general.DbtTransformationRunner;
import io.airbyte.workers.general.DbtTransformationWorker;
import io.airbyte.workers.normalization.DefaultNormalizationRunner;
import io.airbyte.workers.process.ProcessFactory;
import io.airbyte.workers.sync.DbtLauncherWorker;
import io.airbyte.workers.temporal.TemporalAttemptExecution;
import io.micronaut.context.annotation.Value;
import io.temporal.activity.Activity;
import io.temporal.activity.ActivityExecutionContext;
import jakarta.inject.Named;
import jakarta.inject.Singleton;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

/**
 * DbtTransformationActivityImpl.
 */
@Singleton
public class DbtTransformationActivityImpl implements DbtTransformationActivity {

  private final Optional<ContainerOrchestratorConfig> containerOrchestratorConfig;
  private final WorkerConfigsProvider workerConfigsProvider;
  private final ProcessFactory processFactory;
  private final SecretsHydrator secretsHydrator;
  private final Path workspaceRoot;
  private final WorkerEnvironment workerEnvironment;
  private final LogConfigs logConfigs;
  private final String airbyteVersion;
  private final Integer serverPort;
  private final AirbyteConfigValidator airbyteConfigValidator;
  private final TemporalUtils temporalUtils;
  private final AirbyteApiClient airbyteApiClient;
  private final FeatureFlagClient featureFlagClient;

  public DbtTransformationActivityImpl(@Named("containerOrchestratorConfig") final Optional<ContainerOrchestratorConfig> containerOrchestratorConfig,
                                       final WorkerConfigsProvider workerConfigsProvider,
                                       final ProcessFactory processFactory,
                                       final SecretsHydrator secretsHydrator,
                                       @Named("workspaceRoot") final Path workspaceRoot,
                                       final WorkerEnvironment workerEnvironment,
                                       final LogConfigs logConfigs,
                                       @Value("${airbyte.version}") final String airbyteVersion,
                                       @Value("${micronaut.server.port}") final Integer serverPort,
                                       final AirbyteConfigValidator airbyteConfigValidator,
                                       final TemporalUtils temporalUtils,
                                       final AirbyteApiClient airbyteApiClient,
                                       final FeatureFlagClient featureFlagClient) {
    this.containerOrchestratorConfig = containerOrchestratorConfig;
    this.workerConfigsProvider = workerConfigsProvider;
    this.processFactory = processFactory;
    this.secretsHydrator = secretsHydrator;
    this.workspaceRoot = workspaceRoot;
    this.workerEnvironment = workerEnvironment;
    this.logConfigs = logConfigs;
    this.airbyteVersion = airbyteVersion;
    this.serverPort = serverPort;
    this.airbyteConfigValidator = airbyteConfigValidator;
    this.temporalUtils = temporalUtils;
    this.airbyteApiClient = airbyteApiClient;
    this.featureFlagClient = featureFlagClient;
  }

  @Trace(operationName = ACTIVITY_TRACE_OPERATION_NAME)
  @Override
  public Void run(final JobRunConfig jobRunConfig,
                  final IntegrationLauncherConfig destinationLauncherConfig,
                  final ResourceRequirements resourceRequirements,
                  final OperatorDbtInput input) {
    MetricClientFactory.getMetricClient().count(OssMetricsRegistry.ACTIVITY_DBT_TRANSFORMATION, 1);

    ApmTraceUtils.addTagsToTrace(
        Map.of(ATTEMPT_NUMBER_KEY, jobRunConfig.getAttemptId(), JOB_ID_KEY, jobRunConfig.getJobId(), DESTINATION_DOCKER_IMAGE_KEY,
            destinationLauncherConfig.getDockerImage()));
    final ActivityExecutionContext context = Activity.getExecutionContext();
    final AtomicReference<Runnable> cancellationCallback = new AtomicReference<>(null);
    return temporalUtils.withBackgroundHeartbeat(
        cancellationCallback,
        () -> {
          final var fullDestinationConfig = secretsHydrator.hydrate(input.getDestinationConfiguration());
          final var fullInput = Jsons.clone(input).withDestinationConfiguration(fullDestinationConfig);

          final Supplier<OperatorDbtInput> inputSupplier = () -> {
            airbyteConfigValidator.ensureAsRuntime(ConfigSchema.OPERATOR_DBT_INPUT, Jsons.jsonNode(fullInput));
            return fullInput;
          };

          final CheckedSupplier<Worker<OperatorDbtInput, Void>, Exception> workerFactory;

          if (containerOrchestratorConfig.isPresent()) {
            final WorkerConfigs workerConfigs = workerConfigsProvider.getConfig(ResourceType.DEFAULT);
            workerFactory =
                getContainerLauncherWorkerFactory(workerConfigs, destinationLauncherConfig, jobRunConfig,
                    input.getConnectionId(), input.getWorkspaceId());
          } else {
            workerFactory = getLegacyWorkerFactory(destinationLauncherConfig, jobRunConfig, resourceRequirements);
          }
          final var worker = workerFactory.get();
          cancellationCallback.set(worker::cancel);

          final TemporalAttemptExecution<OperatorDbtInput, Void> temporalAttemptExecution =
              new TemporalAttemptExecution<>(
                  workspaceRoot, workerEnvironment, logConfigs,
                  jobRunConfig,
                  worker,
                  inputSupplier.get(),
                  airbyteApiClient,
                  airbyteVersion,
                  () -> context);

          return temporalAttemptExecution.get();
        },
        () -> context);
  }

  private CheckedSupplier<Worker<OperatorDbtInput, Void>, Exception> getLegacyWorkerFactory(final IntegrationLauncherConfig destinationLauncherConfig,
                                                                                            final JobRunConfig jobRunConfig,
                                                                                            final ResourceRequirements resourceRequirements) {
    return () -> new DbtTransformationWorker(
        jobRunConfig.getJobId(),
        Math.toIntExact(jobRunConfig.getAttemptId()),
        resourceRequirements,
        new DbtTransformationRunner(
            processFactory, new DefaultNormalizationRunner(
                processFactory,
                destinationLauncherConfig.getNormalizationDockerImage(),
                destinationLauncherConfig.getNormalizationIntegrationType())),
        () -> {});
  }

  @SuppressWarnings("LineLength")
  private CheckedSupplier<Worker<OperatorDbtInput, Void>, Exception> getContainerLauncherWorkerFactory(
                                                                                                       final WorkerConfigs workerConfigs,
                                                                                                       final IntegrationLauncherConfig destinationLauncherConfig,
                                                                                                       final JobRunConfig jobRunConfig,
                                                                                                       final UUID connectionId,
                                                                                                       final UUID workspaceId) {

    return () -> new DbtLauncherWorker(
        connectionId,
        workspaceId,
        destinationLauncherConfig,
        jobRunConfig,
        workerConfigs,
        containerOrchestratorConfig.get(),
        serverPort,
        featureFlagClient);
  }

}
