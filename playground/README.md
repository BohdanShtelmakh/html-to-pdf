# Local Playground

```sh
npm ci
npm run playground
```

Open http://127.0.0.1:4173. Set `PORT` to use a different port.
The editor renders through the checked-out package, not Chromium. Choose an
invoice, grid report or 60-row table; edit HTML and download the generated PDF.

HTML and PDFs are not written to disk. One render runs at a time in a separate
process with a 10-second deadline, 128 MB V8 heap limit, 128 KB request limit,
1,500-element limit and 5 MB output limit. The child is terminated afterward.
The displayed peak RSS includes native allocations; the V8 heap limit is **not**
a total process memory cap. Rendering time excludes worker startup and validation.

This demo accepts text and embedded CSS only. Images, SVG, scripts, event
handlers and external stylesheets are rejected. Automatic font lookup and emoji
font downloads are disabled for reproducibility; this does not demonstrate the
package's full font/image support.

```sh
npm run test:playground
```

## Local Container Check

With Docker Desktop running (the container uses port 4180, separate from the
native playground on port 4173):

```sh
docker compose -f playground/compose.yml up --build -d
PLAYGROUND_URL=http://127.0.0.1:4180 node playground/load-test.cjs
docker compose -f playground/compose.yml stats --no-stream
docker compose -f playground/compose.yml down
```

This creates the renderer and a small fixed-upstream gateway, with no
host data volumes. The published port binds to loopback. Total container memory
is limited to 384 MiB, swap is disabled, CPU is limited to 0.5, and the filesystem
is read-only. The renderer's runtime network is internal (no Internet access).
The gateway publishes loopback port 4180 and has separate 64 MiB / 0.1 CPU
limits; it forwards only to the renderer, not arbitrary destinations.
The image build downloads dependencies; the runtime does not.

The test performs 30 sequential renders, an eight-request burst (excess requests
must return 429), then a recovery render. Worker RSS is not whole-container RAM:
sample `docker stats` during the test and check `docker inspect` for OOM kills.
On macOS, Docker Desktop VM memory is additional to container memory.

## Public Deployment (Deferred)

This version deliberately binds only to loopback and has no deployment workflow.
Do not expose it by changing the bind address alone. Before public deployment:

- Run the renderer in a non-root container with a read-only filesystem, a hard
  memory/CPU limit, and blocked outbound network access.
- Put HTTPS, global and per-client rate limits, and request size limits at the
  reverse proxy. CORS is not authentication or abuse protection.
- Configure an exact allowed frontend origin and API URL; the current frontend
  uses same-origin `/render` and cannot run as-is on GitHub Pages.
- Keep credentials and application data out of the renderer container.
- Load-test concurrency and establish a hosting budget before enabling access.

The user has deferred GitHub Pages and API publication until local validation.
