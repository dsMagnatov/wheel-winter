import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sanitizeSettings } from '../src/settings.js';

const loopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const loopbackAddresses = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

export function scenePresetStorage() {
  return {
    name: 'winter-scene-preset',
    apply: 'serve',
    configureServer(server) {
      const file = resolve(server.config.root, 'src/scene-preset.json');
      const temporary = resolve(server.config.root, 'src/.scene-preset.tmp');
      const readPreset = () => sanitizeSettings(JSON.parse(readFileSync(file, 'utf8')));

      server.middlewares.use('/__scene-preset', async (request, response) => {
        const reply = (status, data) => {
          response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify(data));
        };
        const host = request.headers.host;
        if (!loopbackHost.test(host) || !loopbackAddresses.includes(request.socket.remoteAddress)) {
          return reply(403, { error: 'Local access only' });
        }

        try {
          if (request.method === 'GET') return reply(200, readPreset());
          if (request.method !== 'PATCH') return reply(405, { error: 'Unsupported method' });
          if (request.headers.origin !== `http://${host}` || request.headers['content-type'] !== 'application/json') {
            return reply(403, { error: 'Same-origin JSON required' });
          }

          let body = '';
          for await (const chunk of request.iterator({ destroyOnReturn: false })) {
            body += chunk;
            if (body.length > 16_384) return reply(413, { error: 'Preset is too large' });
          }

          let changes;
          try {
            changes = sanitizeSettings(JSON.parse(body));
          } catch {
            return reply(400, { error: 'Invalid JSON' });
          }
          if (!Object.keys(changes).length) return reply(400, { error: 'No valid settings' });

          // Keep read, merge and replacement together so concurrent requests cannot lose unrelated edits.
          const preset = { ...readPreset(), ...changes };
          writeFileSync(temporary, JSON.stringify(preset, null, 2) + '\n');
          renameSync(temporary, file);
          return reply(200, preset);
        } catch (error) {
          server.config.logger.error(`Scene preset: ${error.message}`);
          return reply(500, { error: 'Could not access the project preset' });
        }
      });
    },
  };
}
