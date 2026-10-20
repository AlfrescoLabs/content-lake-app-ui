# content-lake-app-ui

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-20-green.svg)](https://nodejs.org/)
[![Angular](https://img.shields.io/badge/Angular-18-DD0031.svg)](https://angular.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue.svg)](https://docs.docker.com/compose/)
[![Status](https://img.shields.io/badge/Status-PoC-yellow.svg)]()

Demo Angular application for the AI Ready Content Hub project (ARCH). It provides a unified search and chat UI that talks to the RAG service and opens source documents in Alfresco ACA or Nuxeo Web UI.

> **This is a demo application, not a reference authentication implementation.** The sign-in screen
> exists to show dual-source permission filtering end to end. Do not copy its authentication flow
> into a production application. See [Authentication and sessions](#authentication-and-sessions).

## AI Ready Content Hub Ecosystem

Part of the **AI Ready Content Hub** ecosystem -- a PoC for ingesting Alfresco and Nuxeo content into [hxpr](https://github.com/HylandSoftware/hxpr) for hybrid semantic search and RAG.

| Repo | Role |
|---|---|
| [content-lake-app](https://github.com/AlfrescoLabs/content-lake-app) | Java ingestion pipeline and RAG service |
| [content-lake-app-deployment](https://github.com/AlfrescoLabs/content-lake-app-deployment) | Docker Compose stack that wires everything together |
| [alfresco-content-lake-ui](https://github.com/AlfrescoLabs/alfresco-content-lake-ui) | ACA/ADW extension: semantic search + RAG chat sidebar |
| **[content-lake-app-ui](https://github.com/AlfrescoLabs/content-lake-app-ui)** | Standalone demo UI (Alfresco + Nuxeo dual auth) (this repo) |
| [nuxeo-deployment](https://github.com/aborroy/nuxeo-deployment) | Local Nuxeo + PostgreSQL stack (required for Nuxeo profiles) |

## Features
- Alfresco and Nuxeo authentication inputs for demo use.
- Search and chat results from every source the index holds, not only Alfresco and Nuxeo.
- Source filter built from what the backend reports, so a CMIS repository, a filesystem tree or any
  plugin connector is selectable without a change here. Two sources of the same type are offered
  separately and labelled by source id.
- Faceted search: narrow results by Source and File type with document counts (click to filter, friendly mime labels).
- Table-aware results: a chunk extracted as a table is rendered as one rather than reflowed as prose.
- Saved searches: scope a search to an hxpr named query, when the backend publishes any.
- Document budget: ask for a number of distinct documents rather than a number of chunks, and see how
  many documents answered.
- Chat UI backed by the RAG streaming endpoint.
- Conversation memory: the running summary the assistant carries between turns.
- Answer options: composer toggles to auto-detect filters from the question and to request a structured answer (summary, key points, citations).
- Citation faithfulness: grounded / unsupported badge and unsupported-claims list when backend verification is enabled.
- Operational status view (`/status`): hxpr connectivity, per-source document counts, embedding-model
  reachability, and, when configured, the connectors an ingester has loaded and anything that failed to load.
- Deep links that open documents in ACA or Nuxeo Web UI.
- Docker image with runtime URL substitution for deployment environments.

## Authentication and sessions

The two repositories are authenticated independently, and the two sessions are deliberately not
handled the same way.

| Source | Held as | Survives a page reload | Why |
|---|---|---|---|
| Alfresco | `{username, ticket}` in `sessionStorage` | Yes | An Alfresco ticket is revocable and scoped, so persisting it is an acceptable demo trade |
| Nuxeo | `{username, credentials}` in memory only | No | `credentials` is `base64(user:pass)`, a reusable secret that nothing can revoke short of a password change, so it never reaches web storage |

Reloading the page therefore keeps you connected to Alfresco but ends the Nuxeo session, and you
connect to Nuxeo again. That is the intended behaviour.

The Nuxeo credential cannot be replaced with a token here: the RAG service's dual-source path
requires `Authorization: Basic base64(TICKET_xxx:)` together with
`X-Nuxeo-Authorization: Basic base64(user:pass)` on the same request, and querying both repositories
at once is the point of this UI. A Nuxeo token is accepted only on the single-source path.

## Quick Start

```bash
npm install
npm start
```

The dev server uses `proxy.conf.json` and proxies `/api/rag`, `/alfresco`, and `/nuxeo` to
`http://localhost` by default. The full deployment stack must be running locally (see
[content-lake-app-deployment](https://github.com/AlfrescoLabs/content-lake-app-deployment)).

### Environment variables

The Docker image substitutes four placeholders at container startup, from the environment variable of
the same name:

| Placeholder | Purpose | Default (fallback) |
|---|---|---|
| `__ALFRESCO_URL__` | Alfresco Repository base URL | same-origin (`/alfresco`) |
| `__NUXEO_URL__` | Nuxeo base URL | same-origin (`/nuxeo`) |
| `__RAG_URL__` | RAG service base URL | same-origin (`/api/rag`) |
| `__CONNECTORS_URL__` | Connector listing endpoint on an ingester | empty, and the panel is hidden |

If a placeholder is unset or points at `localhost` while the browser is on a remote host, the app
falls back to same-origin proxy paths automatically.

`CONNECTORS_URL` has no same-origin default because `/api/connectors` is not a RAG service route and
the deployment proxy does not forward it: it is published by each ingester, and
`connector-batch-ingester` publishes a port of its own. Point it at an absolute URL to switch the
status page's connector panel on, for example `http://localhost:9090/api/connectors` for the Alfresco
batch ingester or `http://localhost:9096/api/connectors` for the connector ingester. Left unset, the
panel does not render and no request is made.

## Build

```bash
npm run build
```

Production builds use `src/environments/environment.prod.ts`, and the container runtime replaces the `__ALFRESCO_URL__`, `__NUXEO_URL__`, `__RAG_URL__`, and `__CONNECTORS_URL__` placeholders in the compiled bundle at startup. If those values are missing, or still point at `localhost` while the browser is on a remote host, the app falls back to same-origin proxy paths (`/alfresco`, `/nuxeo`, `/api/rag`) and, for the connector listing, to no panel at all.

## Test

```bash
npm test              # Karma + Jasmine, watch mode
npm run test:ci       # single ChromeHeadless run
```

## Docker

The included Dockerfile builds the Angular app and serves it with nginx. The runtime container proxies `/api/rag`, `/alfresco`, and `/nuxeo` so the browser stays same-origin.

For local deployment via `content-lake-app-deployment`, this repo is expected at the sibling path `../content-lake-app-ui` unless `CONTENT_LAKE_APP_UI_CONTEXT` is overridden.

## Project structure
- `src/` -- Angular source code.
- `src/app/` -- Application modules, services, components.
- `src/environments/` -- Environment variables.
- `src/styles.scss` -- Material 3 theme (Satori-ready) + app design tokens.
- `angular.json` -- Project config (application builder, Karma test target).
- `tsconfig.json` -- TypeScript config.
- `tsconfig.spec.json` -- TypeScript config for unit tests.
- `package.json` -- Dependencies.
- `.github/workflows/` -- CI quality gates placeholder (pending Satori package access).

## Satori adoption

See [docs/satori.md](docs/satori.md) for current status and remaining integration steps.
