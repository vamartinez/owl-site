import { build } from 'esbuild';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * esbuild configuration for Lambda handler bundling.
 *
 * Bundles each service handler independently from src/services/{service}/handler.ts to dist/.
 * Configured for AWS Lambda Node.js 20 runtime with tree-shaking and minification.
 */

const servicesDir = join(__dirname, 'src', 'services');

// Discover all service handler entry points
function getEntryPoints(): string[] {
  const entries: string[] = [];

  try {
    const services = readdirSync(servicesDir);
    for (const service of services) {
      const servicePath = join(servicesDir, service);
      if (statSync(servicePath).isDirectory()) {
        const handlerPath = join(servicePath, 'handler.ts');
        try {
          statSync(handlerPath);
          entries.push(handlerPath);
        } catch {
          // No handler.ts in this directory — skip
        }
      }
    }
  } catch {
    // services directory doesn't exist yet — return empty
  }

  return entries;
}

async function bundle(): Promise<void> {
  const entryPoints = getEntryPoints();

  if (entryPoints.length === 0) {
    console.log('No service handlers found to bundle.');
    return;
  }

  console.log(`Bundling ${entryPoints.length} service handlers...`);

  await build({
    entryPoints,
    bundle: true,
    platform: 'node',
    target: 'node20',
    outdir: join(__dirname, 'dist', 'services'),
    outbase: join(__dirname, 'src', 'services'),
    format: 'cjs',
    minify: true,
    treeShaking: true,
    sourcemap: true,
    external: [
      // AWS SDK v3 is available in Lambda runtime — exclude to reduce bundle size
      '@aws-sdk/*',
    ],
    logLevel: 'info',
  });

  console.log('Bundle complete.');
}

bundle().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
