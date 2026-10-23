'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ComponentType } from 'react';

import type { AgentMetricChartResult, AgentMetricsProps } from '../atoms/agent-details/types.js';
import { CATALOG_STALE_TIME_MS, useServerQueryClient } from '../server/queryClient.js';
import { queryKeys } from '../server/queryKeys.js';
import { useAgentMetricsServer } from '../server/ServerContext.js';
import type { AgentMetricRangeRequest } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';
import { defaultMetricsTimeRange, resolveSessionTimeRange, type SessionTimeRange } from '../utils/sessionShareUrl.js';

function metricsRangeRequest({
  agentId,
  timeRange,
}: {
  agentId: string;
  timeRange: SessionTimeRange;
}): AgentMetricRangeRequest {
  const resolvedRange = resolveSessionTimeRange(timeRange);
  return {
    agentId,
    startTimestamp: new Date(resolvedRange.startTs).toISOString(),
    endTimestamp: new Date(resolvedRange.endTs).toISOString(),
  };
}

export function AgentMetricsContainer({
  agentId,
  timeRange: controlledTimeRange,
  onTimeRangeChange,
  showTimeRangeFilter = true,
}: AgentMetricsProps) {
  const metricsServer = useAgentMetricsServer();
  const AgentMetricsView = useSlot('AgentMetricsView');
  const [internalTimeRange, setInternalTimeRange] = useState(defaultMetricsTimeRange);
  const timeRange = controlledTimeRange ?? internalTimeRange;
  const setTimeRange = onTimeRangeChange ?? setInternalTimeRange;
  const queryClient = useServerQueryClient();
  // Resolve a rolling window once per selection so re-renders reuse the cached responses.
  const request = useMemo(() => metricsRangeRequest({ agentId, timeRange }), [agentId, timeRange]);

  const definitionsQuery = useQuery(
    {
      queryKey: queryKeys.metrics.charts(),
      queryFn: () => metricsServer.getCharts(),
      staleTime: CATALOG_STALE_TIME_MS,
    },
    queryClient,
  );
  const metersQuery = useQuery(
    { queryKey: queryKeys.metrics.meters(request), queryFn: () => metricsServer.getMeters(request) },
    queryClient,
  );
  const definitions = definitionsQuery.data;
  const chartQueries = useQueries(
    {
      queries: (definitions ?? []).map(definition => {
        const chartRequest = { ...request, chartName: definition.name };
        return {
          queryKey: queryKeys.metrics.chartData(chartRequest),
          queryFn: () => metricsServer.getChartData(chartRequest),
        };
      }),
    },
    queryClient,
  );

  const chartsError = definitionsQuery.isError
    ? getErrorMessage(definitionsQuery.error, 'Metric charts could not be loaded.')
    : undefined;
  const meters = metersQuery.data;
  const meterError = metersQuery.isError
    ? getErrorMessage(metersQuery.error, 'Aggregate metrics could not be loaded.')
    : undefined;
  const charts = (definitions ?? []).map((definition, index): AgentMetricChartResult => {
    const chartQuery = chartQueries[index];
    if (chartQuery?.data != null) return { definition, graphs: chartQuery.data.graphs };
    if (chartQuery?.isError === true) {
      return { definition, error: getErrorMessage(chartQuery.error, `${definition.displayName} could not be loaded.`) };
    }
    return { definition };
  });
  const chartsLoading =
    !definitionsQuery.isError && (definitionsQuery.isPending || chartQueries.some(chartQuery => chartQuery.isPending));

  return (
    <AgentMetricsView
      meters={meters}
      meterError={meterError}
      charts={charts}
      chartsLoading={chartsLoading}
      chartsError={chartsError}
      timeRange={timeRange}
      onTimeRangeChange={setTimeRange}
      showTimeRangeFilter={showTimeRangeFilter}
    />
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentMetrics: ComponentType<AgentMetricsProps>;
  }
}
