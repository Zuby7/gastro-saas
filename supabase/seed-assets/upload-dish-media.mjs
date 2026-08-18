#!/usr/bin/env node
// ============================================================================
// Uploads the real dish photos in supabase/seed-assets/dishes/*.jpg into the
// local Supabase Storage `dish-media` bucket, at the exact storage_path
// values supabase/seed.sql already inserted into `media_assets` for the demo
// tenant ("Trattoria Da Mario", id 11111111-1111-4111-8111-111111111111).
//
// Why this is a separate script, not part of seed.sql: `media_assets` (see
// supabase/migrations/20260801110000_restaurant_profile_and_menu_management.sql)
// requires a real object in Supabase Storage, not just a URL column -- but
// Supabase Storage's actual file bytes live in the storage-api backend, not
// in Postgres, so a plain SQL seed file cannot upload them. `supabase db
// reset` also only resets the Postgres database; it does not clear
// previously uploaded Storage objects, and conversely a fresh reset's
// `media_assets` rows do not automatically have matching Storage objects
// either -- this script is what actually makes the seeded dish photos
// resolve.
//
// Run once after `supabase db reset` (and again any time you reset without
// having previously run it):
//   node supabase/seed-assets/upload-dish-media.mjs
//
// Reads the local Supabase URL + service-role key from apps/web/.env.local
// (falling back to SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars if
// set) -- the service-role key is required because the `dish-media` bucket
// is private (RLS-gated, docs/security/tenant-isolation.md) and this script
// uploads on behalf of the tenant, not as any particular authenticated user.
// Never commit a real (non-local) service-role key anywhere near this file.
// ============================================================================

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const BUCKET = "dish-media";

// Maps each local seed image to the storage_path supabase/seed.sql used for
// the matching media_assets row. Keep in sync with that file.
const FILES = [
  "bruschetta.jpg",
  "caprese.jpg",
  "minestrone.jpg",
  "pizza-margherita.jpg",
  "pizza-salami.jpg",
  "carbonara.jpg",
  "lasagne.jpg",
  "risotto.jpg",
  "tiramisu.jpg",
  "pannacotta.jpg",
  "acqua-minerale.jpg",
  "limonade.jpg",
];

async function loadLocalEnv() {
  const envPath = path.join(repoRoot, "apps", "web", ".env.local");
  const env = {};
  try {
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    // apps/web/.env.local may not exist -- fall back to process.env only.
  }
  return env;
}

async function main() {
  const localEnv = await loadLocalEnv();
  const supabaseUrl =
    process.env.SUPABASE_URL ?? localEnv.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error(
      "No SUPABASE_SERVICE_ROLE_KEY found (checked process.env and apps/web/.env.local). Aborting.",
    );
    process.exitCode = 1;
    return;
  }

  const dishesDir = path.join(__dirname, "dishes");
  const available = new Set(await readdir(dishesDir));

  let uploaded = 0;
  let failed = 0;

  for (const filename of FILES) {
    if (!available.has(filename)) {
      console.error(`Skipping ${filename}: not found in ${dishesDir}`);
      failed += 1;
      continue;
    }

    const filePath = path.join(dishesDir, filename);
    const bytes = await readFile(filePath);
    const storagePath = `${DEMO_TENANT_ID}/dishes/${filename}`;

    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/${BUCKET}/${encodeURIComponent(storagePath).replace(/%2F/g, "/")}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
        },
        body: bytes,
      },
    );

    if (res.ok) {
      uploaded += 1;
      console.log(`Uploaded ${storagePath} (${bytes.length} bytes)`);
    } else {
      failed += 1;
      const body = await res.text().catch(() => "");
      console.error(`Failed to upload ${storagePath}: ${res.status} ${body}`);
    }
  }

  console.log(`Done: ${uploaded} uploaded, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
