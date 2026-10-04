import {TanStackRouterVite} from '@tanstack/router-plugin/vite';
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
        name: 'Tempo',
        short_name: 'Tempo',
        id: basePath,
        description: 'Personal finance overview and bank account tracker',
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        background_color: '#17161B',
        theme_color: '#17161B',
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
      react(),
      TanStackRouterVite(),
      pwaManifestPlugin(basePath),
      offlineShellPlugin(basePath),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
  };
});
