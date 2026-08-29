import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  images: {
    remotePatterns: [
      // Supabase Storage public URLs, if used for logos/avatars
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
