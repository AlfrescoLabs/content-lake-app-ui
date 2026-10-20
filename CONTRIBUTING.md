# Contributing

This project is part of the **AI Ready Content Hub** (ARCH) PoC ecosystem. Contributions are welcome.

## Before You Start

- Read the [README](README.md) to understand the app's purpose and setup.
- Check the open issues before starting new work.
- For significant changes, open an issue first to discuss the approach.

## Development Setup

```bash
npm install
npm start
```

The dev server proxies `/api/rag`, `/alfresco`, and `/nuxeo` to `http://localhost`. The
[content-lake-app-deployment](https://github.com/AlfrescoLabs/content-lake-app-deployment) stack
must be running locally.

## Making Changes

1. Fork the repository and create a branch from `main`.
2. Make your changes.
3. Build to verify: `npm run build`
4. Open a pull request. Describe what changed and why.

## Commit Messages

Use the format: `type: short description`

Types: `feat`, `fix`, `docs`, `chore`, `test`
