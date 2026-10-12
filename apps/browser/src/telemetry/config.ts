// Our own collector, behind ardia.dev: events and logs are both OTLP log records.
export const LOGS_URL = "https://ardia.dev/otel/v1/logs";

// nginx rejects bodies over 512 KB.
export const MAX_BODY_BYTES = 500_000;

// DEV telemetry sends only with ARDIA_TELEMETRY=1.
export const DEV_SEND_ENV = "ARDIA_TELEMETRY";
