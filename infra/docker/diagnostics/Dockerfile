FROM denoland/deno:2.6.7

WORKDIR /app
COPY infra/diagnostics/metrics.ts /app/metrics.ts

ENV RELAY_URL=http://relay:8080
ENV METRICS_INTERVAL_MS=10000

CMD ["run", "--allow-all", "/app/metrics.ts"]
