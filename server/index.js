import { createApp } from "./app.js";

// Node's built-in .env loader (stable since Node 20.6). Optional by design —
// the app must keep working with no .env present (offline fallback mode).
try {
  process.loadEnvFile();
} catch {
  // No .env file — fine, the app runs fully offline without one.
}

const app = createApp();
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Worldcup26 Access Concierge listening on http://localhost:${port}`);
});
