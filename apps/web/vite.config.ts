import {tanstackRouter} from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import {type Plugin, defineConfig, loadEnv} from 'vite';

import {PWA_ICONS} from './config/app-icons';
import {offlineShellPlugin} from './config/offline-shell';

function pwaManifestPlugin(basePath: string): Plugin {
  return {
    name: 'tempo-pwa-manifest',
    generateBundle() {
      const icon = (name: string) => `${basePath}${name}`;
      const manifest = {
        name: 'Wisp',
        short_name: 'Wisp',
        id: basePath,
        description: 'A read-only view of your bank accounts: balances, transactions and where your money goes.',
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        background_color: '#F5F6FA',
        theme_color: '#F5F6FA',
        icons: PWA_ICONS.map(({file, sizes, purpose}) => ({
          src: icon(file),
          sizes,
          type: 'image/png',
          purpose,
        })),
      };

      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  const basePath = env.VITE_BASE_PATH || '/';

  return {
    base: basePath,
    plugins: [
      // Must run before the React transform so it can split each route into its own chunk.
      tanstackRouter({target: 'react', autoCodeSplitting: true}),
      react(),
      pwaManifestPlugin(basePath),
      offlineShellPlugin(basePath),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
        '@tempo/contracts': path.resolve(import.meta.dirname, '../../packages/contracts/src'),
      },
    },
  };
});
