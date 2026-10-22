#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const MODULE_FILES = [
  'src/engine/GameEngine.ts',
  'src/ai/AIEngine.ts',
  'src/audio/AudioManager.ts',
  'src/events/EventManager.ts',
  'src/multiplayer/MultiplayerEngine.ts',
  'server/index.ts',
  'tests/gameEngine.test.ts',
  'tests/aiEngine.test.ts',
  'tests/multiplayerAndSystems.test.ts',
  'tests/serverIntegration.test.ts',
];

function compileAll() {
  let count = 0;
  for (const rel of MODULE_FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const outRel = rel.replace(/\.ts$/, '.js');
    const outPath = path.join(DIST, outRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const code = fs.readFileSync(file, 'utf8');
    const transformed = babel.transformSync(code, {
      filename: file,
      presets: [
        ['@babel/preset-typescript', { allExtensions: true }],
      ],
      plugins: [
        '@babel/plugin-transform-modules-commonjs',
      ],
      sourceMaps: false,
    });
    fs.writeFileSync(outPath, transformed.code, 'utf8');
    count++;
  }
  console.log(`Compiled ${count} TypeScript module(s) to dist/`);
}

compileAll();
