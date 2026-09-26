import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves its binary path relative to its own package dir,
  // so it must not be bundled. sharp ships native bindings.
  serverExternalPackages: ["ffmpeg-static", "sharp"],
};

export default nextConfig;
