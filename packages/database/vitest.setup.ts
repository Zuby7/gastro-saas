// @supabase/supabase-js always constructs a RealtimeClient, which requires a
// native WebSocket global. Node 20 (this repo's CI runner version, see
// .github/workflows/ci.yml's NODE_VERSION) doesn't have one built in --
// Node 22+ does. Ticket #7's create-tenant-with-owner integration test is
// the first to call createClient() in this package, so shim it here rather
// than per-test.
import WebSocket from "ws";

if (typeof globalThis.WebSocket === "undefined") {
  // @ts-expect-error -- `ws`'s type doesn't exactly match lib.dom's WebSocket, close enough for this shim's purpose.
  globalThis.WebSocket = WebSocket;
}
