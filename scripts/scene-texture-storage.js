import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream';

const targets = ['snow', 'rubber', 'rim'];
const slots = ['map', 'bumpMap', 'roughnessMap'];
const loopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const loopbackAddresses = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const maxBytes = 20 * 1024 * 1024;
const imageTypes = new Map([
  ['image/png', ['png', bytes => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))]],
  ['image/jpeg', ['jpg', bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff]],
  ['image/webp', ['webp', bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP']],
  ['image/gif', ['gif', bytes => /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))]],
  ['image/bmp', ['bmp', bytes => bytes.toString('ascii', 0, 2) === 'BM']],
  ['image/avif', ['avif', bytes => bytes.toString('ascii', 4, 8) === 'ftyp' && /^(avif|avis)$/.test(bytes.toString('ascii', 8, 12))]],
]);
const storedFilename = /^(snow|rubber|rim)-(map|bumpMap|roughnessMap)-[\da-f]{24}\.(png|jpg|webp|gif|bmp|avif)$/;
const imageContentTypes = new Map(Array.from(imageTypes, ([type, [extension]]) => [extension, type]));

function textureName(header, fallback) {
  try {
    const name = decodeURIComponent(header ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
    return name || fallback;
  } catch {
    return fallback;
  }
}

function writeAtomically(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function sceneTextureStorage() {
  return {
    name: 'winter-scene-textures',
    apply: 'serve',
    configureServer(server) {
      const directory = resolve(server.config.publicDir, 'project-textures');
      const manifestPath = resolve(directory, 'manifest.json');
      const readManifest = () => JSON.parse(readFileSync(manifestPath, 'utf8'));
      const writeManifest = manifest => writeAtomically(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      const removeImage = file => {
        if (typeof file !== 'string' || !storedFilename.test(file)) return;
        try {
          rmSync(resolve(directory, file), { force: true });
        } catch (error) {
          server.config.logger.warn(`Scene texture cleanup: ${error.message}`);
        }
      };

      // Newly uploaded files are available immediately, even with the project directory excluded from HMR.
      server.middlewares.use('/project-textures', (request, response) => {
        const filename = request.url.slice(1).split('?')[0];
        const manifest = filename === 'manifest.json';
        const extension = storedFilename.exec(filename)?.[3];
        if ((!manifest && !extension) || !['GET', 'HEAD'].includes(request.method)) {
          response.writeHead(404).end();
          return;
        }

        const stream = createReadStream(resolve(directory, filename));
        stream.once('error', () => {
          if (!response.headersSent) response.writeHead(404).end();
        });
        stream.once('open', () => {
          response.writeHead(200, {
            'Content-Type': manifest ? 'application/json' : imageContentTypes.get(extension),
            'Cache-Control': manifest ? 'no-store' : 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
          });
          if (request.method === 'HEAD') {
            stream.destroy();
            response.end();
            return;
          }
          pipeline(stream, response, () => {});
        });
      });

      server.middlewares.use('/__scene-textures', async (request, response) => {
        const reply = (status, data) => {
          response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(data === undefined ? undefined : JSON.stringify(data));
        };
        const host = request.headers.host;
        if (!loopbackHost.test(host) || !loopbackAddresses.includes(request.socket.remoteAddress)
          || request.headers.origin !== `http://${host}`) {
          return reply(403, { error: 'Local same-origin access only' });
        }

        const match = /^\/(?:([^/]+)(?:\/([^/]+))?)?$/.exec(request.url);
        if (!match || (match[1] && !targets.includes(match[1])) || (match[2] && !slots.includes(match[2]))) {
          return reply(404, { error: 'Unknown texture slot' });
        }
        const [, target, slot] = match;

        try {
          if (request.method === 'DELETE' && !slot) {
            const manifest = readManifest();
            const removed = target ? [manifest[target]] : Object.values(manifest);
            if (target) delete manifest[target];
            writeManifest(target ? manifest : {});
            for (const textures of removed) {
              for (const entry of Object.values(textures ?? {})) removeImage(entry?.file);
            }
            return reply(204);
          }
          if (request.method !== 'PUT' || !slot) return reply(405, { error: 'Unsupported method' });

          const imageType = imageTypes.get(request.headers['content-type']);
          if (!imageType) return reply(415, { error: 'Unsupported image type' });
          if (Number(request.headers['content-length']) > maxBytes) return reply(413, { error: 'Image is too large' });
          const chunks = [];
          let length = 0;
          for await (const chunk of request.iterator({ destroyOnReturn: false })) {
            length += chunk.length;
            if (length > maxBytes) return reply(413, { error: 'Image is too large' });
            chunks.push(chunk);
          }
          const bytes = Buffer.concat(chunks, length);
          const [extension, isImage] = imageType;
          if (!isImage(bytes)) return reply(415, { error: 'Invalid image signature' });

          const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
          const file = `${target}-${slot}-${hash}.${extension}`;
          const entry = { file, name: textureName(request.headers['x-texture-name'], file) };
          const path = resolve(directory, file);
          const manifest = readManifest();
          const previous = manifest[target]?.[slot]?.file;
          const needsFile = !existsSync(path);
          if (needsFile) writeAtomically(path, bytes);
          manifest[target] = { ...manifest[target], [slot]: entry };
          try {
            writeManifest(manifest);
          } catch (error) {
            if (needsFile && previous !== file) removeImage(file);
            throw error;
          }
          if (previous !== file) removeImage(previous);
          return reply(200, entry);
        } catch (error) {
          server.config.logger.error(`Scene texture: ${error.message}`);
          return reply(500, { error: 'Could not save the project texture' });
        }
      });
    },
  };
}
