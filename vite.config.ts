import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Adds a strict Content-Security-Policy to the built index.html.
 * GitHub Pages cannot send headers, so the policy travels as a meta tag
 * (SECURITY.md §7). Dev builds skip it because Vite injects inline scripts.
 */
function csp(supabaseUrl: string): Plugin {
  const api = new URL(supabaseUrl);
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${api.origin} wss://${api.host}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'xs-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = env.VITE_SUPABASE_URL ?? '';
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), ...(supabaseUrl ? [csp(supabaseUrl)] : [])],
    build: {
      target: 'es2022',
      sourcemap: false,
      // Long-lived vendor chunks: an app release does not make returning
      // users download React or the Supabase client again.
      rolldownOptions: {
        output: {
          advancedChunks: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
              { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
              { name: 'vendor', test: /node_modules[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
