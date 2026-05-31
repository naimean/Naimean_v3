import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const chapelHtmlPath = path.join(repoRoot, 'public', 'chapel.html');

function getAudioFoldersConfig() {
  const html = fs.readFileSync(chapelHtmlPath, 'utf8');
  const startToken = 'const AUDIO_FOLDERS = ';
  const endToken = '\n      const overlayLayer = document.getElementById(\'overlay-layer\');';
  const startIndex = html.indexOf(startToken);
  const endIndex = html.indexOf(endToken, startIndex);

  assert.notEqual(startIndex, -1, 'Expected chapel.html to define AUDIO_FOLDERS');
  assert.notEqual(endIndex, -1, 'Expected chapel.html overlay layer initialization after AUDIO_FOLDERS');

  const objectLiteral = html.slice(startIndex + startToken.length, endIndex).trim();
  return new Function(`return (${objectLiteral});`)();
}

test('chapel soundboard uses audio files from each hotspot folder', () => {
  const audioFolders = getAudioFoldersConfig();

  for (const [folder, audioPaths] of Object.entries(audioFolders)) {
    assert.ok(Array.isArray(audioPaths) && audioPaths.length > 0, `Expected ${folder} to have audio paths`);

    for (const audioPath of audioPaths) {
      assert.match(
        audioPath,
        new RegExp(`^assets/audio/${folder.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/.+\\.mp3$`),
        `Expected ${folder} clip to point at an mp3 inside its own folder`,
      );

      const filePath = path.join(repoRoot, 'public', audioPath);
      assert.ok(fs.existsSync(filePath), `Expected ${audioPath} to exist in the repository`);
    }
  }
});

test('chapel Ace Ventura soundboard matches the mp3s bundled in its folder', () => {
  const audioFolders = getAudioFoldersConfig();
  const configuredPaths = [...(audioFolders.ace_ventura ?? [])].sort();
  const aceVenturaDir = path.join(repoRoot, 'public', 'assets', 'audio', 'ace_ventura');
  const assetPaths = fs
    .readdirSync(aceVenturaDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.mp3'))
    .map((fileName) => `assets/audio/ace_ventura/${fileName}`)
    .sort();

  assert.deepEqual(configuredPaths, assetPaths);
});
