# Northgrip Winter Tires

Interactive Three.js showcase with a winter storm, a tire carousel, and a demo order dialog. Scroll or swipe up to spin the wheel and reach the collection. Drag the center wheel to inspect it.

```sh
pnpm install
pnpm dev
pnpm build
```

The site loads its saved scene from `src/scene-preset.json` and project textures from `public/project-textures/`. The production output is in `dist/`.

The snow shader includes code adapted from [SnowSystemThreeJS](https://github.com/achrefelouafi/SnowSystemThreeJS) under the [MIT license](public/licenses/snow-system-threejs-MIT.txt). Font and image provenance are documented in `public/fonts/` and `public/textures/`.
