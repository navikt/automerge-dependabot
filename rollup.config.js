import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const config = {
  input: 'src/index.js',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [commonjs(), nodeResolve({ preferBuiltins: true })],
  onwarn(warning, warn) {
    // Suppress known-harmless warnings from node_modules (e.g. TypeScript-compiled CJS
    // using `this` at module level, and circular deps in semver/@actions packages).
    if (warning.id && warning.id.includes('node_modules')) return;
    if (warning.ids && warning.ids.every(id => id.includes('node_modules'))) return;
    warn(warning);
  }
};

export default config;
