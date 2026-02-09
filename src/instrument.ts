import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Sentry Initialization
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

// OpenTelemetry (Grafana Cloud) Initialization
if (process.env.GRAFANA_OTLP_ENDPOINT && process.env.GRAFANA_OTLP_TOKEN) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'kue-platform',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${process.env.GRAFANA_OTLP_ENDPOINT}/v1/traces`,
      headers: {
        Authorization: `Basic ${process.env.GRAFANA_OTLP_TOKEN}`,
      },
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  console.log('OpenTelemetry SDK started for Grafana Cloud');
}
