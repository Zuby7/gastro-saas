import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {/* config options here */};

// Enables local `next dev` to resolve Cloudflare bindings (env vars, etc.)
// the same way the deployed Worker does. See docs/operations/deployment-strategy.md.
initOpenNextCloudflareForDev();

export default nextConfig;
