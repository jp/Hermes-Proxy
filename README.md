# Hermes Proxy

Hermes Proxy is a desktop HTTP/HTTPS interception app built with Electron and Vite.
It captures requests/responses, lets you replay requests, and export/import HAR files.

## Features
- Live traffic table with request/response details
- Replay requests (with editable URL/headers)
- Export all traffic as HAR
- Import HAR files into the traffic table
- Save response bodies

## Development
Install dependencies:

```bash
npm install
```

Run the app in dev mode (Vite + Electron):

```bash
npm run dev
```

Build the renderer:

```bash
npm run build
```

Package binaries (macOS/Windows/Linux targets via electron-builder):

```bash
npm run dist -- --publish never
```
