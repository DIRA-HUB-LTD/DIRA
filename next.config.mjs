/** @type {import('next').NextConfig} */
const nextConfig = {
  // The assessment engine is a TypeScript workspace package (packages/assessment-engine).
  // Next.js 16 compiles workspace packages itself; listing it keeps that explicit.
  transpilePackages: ["@dira/assessment-engine"],
};

export default nextConfig;
