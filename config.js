/*
  config.js

  Public configuration for the client. This file is safe to commit because it
  contains only the Cloudflare Worker URL (not any secret API keys).

  If you want to override the URL locally for testing, keep your local
  `secrets.js` (which is in .gitignore). `secrets.js` will be loaded after this
  file and can override WORKER_URL for local development.
*/

// Replace the value below with your deployed Worker URL if different.
const WORKER_URL = 'https://loreal-worker.sustaitah03.workers.dev/';
