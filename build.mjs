/**
 * Production build entry point.
 *
 * esbuild bundles `src/main.ts` into the single CommonJS `main.js` artifact that
 * Obsidian loads. The `obsidian` package is external because those APIs are supplied
 * by the host application at runtime; bundling them would make the plugin larger
 * and would bind it to a development dependency instead of the host API.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2020',
  outfile: 'main.js',
  sourcemap: false,
  legalComments: 'none',
});
