// Domains are attached to the `site` service in Hexclave's dashboard (Deployments), not here. Two, for good:
//   - ardia.dev and www.ardia.dev, the site's own (canonical URLs, the app's feed, telemetry, release notes);
//   - netnyahoo.com and www.netnyahoo.com, the name before the rename: copies on 0.2.32 and earlier keep asking it for
//     /appcast.xml, /switches.json, /otel/v1/logs and /release-notes. Never detach it or let it lapse.
// DNS as netnyahoo.com has it (Vercel DNS, the platform's Fly edge): the apex an A and an AAAA record to the addresses
// the dashboard gives for the service, www a CNAME to the service's *.fly.dev host; TLS is issued once they resolve.
export const deploymentGroupId = "site";

export const deploy = ({ secret, service }: any) => ({
  services: {
    site: {
      type: "serverless",
      public: true,
      ports: { 8080: { protocol: "http" } },
      dockerfilePath: "Dockerfile",
      maxInstances: 2,
      // nginx.conf reaches the telemetry services (infra/telemetry) by these private hostnames.
      env: {
        TELEMETRY_COLLECTOR_HOST: service("otel-collector").hostname(),
        TELEMETRY_CLICKHOUSE_HOST: service("ph-clickhouse").hostname(),
        TELEMETRY_OBJECTS_HOST: service("ph-objects").hostname(),
        TELEMETRY_REPLAYS_READ_TOKEN: secret("TELEMETRY_REPLAYS_READ_TOKEN"),
      },
    },
  },
});
