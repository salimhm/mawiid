import { Elysia } from 'elysia';

const histogram_buckets = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
];

type histogram_labels = Record<'method' | 'route' | 'status', string>;

type histogram_series = {
  buckets: number[];
  count: number;
  sum: number;
};

const series = new Map<string, histogram_series>();

function escape_label(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function format_labels(labels: histogram_labels & { le?: string }): string {
  return `{${Object.entries(labels)
    .map(([key, value]) => `${key}="${escape_label(value)}"`)
    .join(',')}}`;
}

function normalise_route(pathname: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const numeric = /^\d+$/;
  const opaque_identifier = /^(?:[A-Za-z]{2,}_)?[A-Za-z0-9_-]{16,}$/;
  return pathname
    .split('/')
    .map((segment) => (uuid.test(segment) || numeric.test(segment) || opaque_identifier.test(segment) ? ':id' : segment))
    .join('/');
}

function observe(labels: histogram_labels, duration_seconds: number): void {
  if (!Number.isFinite(duration_seconds) || duration_seconds < 0) return;
  const key = JSON.stringify(labels);
  const value = series.get(key) ?? { buckets: Array<number>(histogram_buckets.length).fill(0), count: 0, sum: 0 };
  histogram_buckets.forEach((bucket, index) => {
    if (duration_seconds <= bucket) value.buckets[index] = (value.buckets[index] ?? 0) + 1;
  });
  value.count += 1;
  value.sum += duration_seconds;
  series.set(key, value);
}

function status_code(status: unknown): string {
  return typeof status === 'number' ? String(status) : '200';
}

function render(): string {
  const rows = [
    '# HELP mawiid_http_server_duration_seconds HTTP request duration of the Mawiid backend.',
    '# TYPE mawiid_http_server_duration_seconds histogram',
  ];
  for (const [key, value] of series.entries()) {
    const labels = JSON.parse(key) as histogram_labels;
    histogram_buckets.forEach((bucket, index) => {
      rows.push(`mawiid_http_server_duration_seconds_bucket${format_labels({ ...labels, le: String(bucket) })} ${value.buckets[index] ?? 0}`);
    });
    rows.push(`mawiid_http_server_duration_seconds_bucket${format_labels({ ...labels, le: '+Inf' })} ${value.count}`);
    rows.push(`mawiid_http_server_duration_seconds_sum${format_labels(labels)} ${value.sum}`);
    rows.push(`mawiid_http_server_duration_seconds_count${format_labels(labels)} ${value.count}`);
  }
  return `${rows.join('\n')}\n`;
}

const request_started_at = new WeakMap<Request, number>();

export const lib_metrics = new Elysia({ name: 'metrics' })
  .onRequest({ as: 'global' }, ({ request }) => {
    request_started_at.set(request, performance.now());
  })
  .onAfterHandle({ as: 'global' }, ({ request, set }) => {
    const started_at = request_started_at.get(request);
    if (started_at === undefined || new URL(request.url).pathname === '/metrics') return;
    observe(
      {
        method: request.method,
        route: normalise_route(new URL(request.url).pathname),
        status: status_code(set.status),
      },
      (performance.now() - started_at) / 1_000,
    );
  })
  .get('/metrics', () => new Response(render(), { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' } }));
