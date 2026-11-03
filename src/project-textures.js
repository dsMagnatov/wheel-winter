export const textureTargets = ['snow', 'rubber', 'rim'];
export const textureSlots = ['map', 'bumpMap', 'roughnessMap'];
const textureDirectory = new URL(`${import.meta.env.BASE_URL}project-textures/`, location.href);

export async function loadProjectTextures(scene) {
  const response = await fetch(new URL('manifest.json', textureDirectory), { cache: 'no-store' });
  if (!response.ok) throw new Error('Texture manifest is unavailable');
  const manifest = await response.json();
  const jobs = textureTargets.flatMap(target => textureSlots.flatMap(slot => {
    const entry = manifest[target]?.[slot];
    if (!entry) return [];
    return [(async () => {
      const texture = await scene.loadTexture(new URL(entry.file, textureDirectory).href);
      scene.applyTexture(target, slot, texture, entry.name);
    })()];
  }));
  const results = await Promise.allSettled(jobs);
  if (results.some(result => result.status === 'rejected')) throw new Error('Some project textures did not load');
}
