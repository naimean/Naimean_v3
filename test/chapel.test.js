import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const chapelHtmlPath = path.join(repoRoot, 'public', 'chapel.html');
const folderNames = [
  'ace_ventura',
  'silly_goose',
  'crusty_the_clown',
  'casey_jones',
  'rick',
  'morty',
  'scrooge_mcduck',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getChapelHtml() {
  return fs.readFileSync(chapelHtmlPath, 'utf8');
}

function getAudioPathsForFolder(html, folder) {
  const folderPattern = new RegExp(`${escapeRegExp(folder)}:\\s*\\[(?<paths>[\\s\\S]*?)\\n\\s*\\]`, 'm');
  const match = html.match(folderPattern);

  assert.ok(match?.groups?.paths, `Expected chapel.html to define audio paths for ${folder}`);

  return Array.from(match.groups.paths.matchAll(/'([^']+\.(?:mp3|m4a))'/g), (entry) => entry[1]);
}

function getAudioFoldersConfig() {
  const html = fs.readFileSync(chapelHtmlPath, 'utf8');
  return Object.fromEntries(folderNames.map((folder) => [folder, getAudioPathsForFolder(html, folder)]));
}

test('chapel soundboard uses audio files from each hotspot folder', () => {
  const audioFolders = getAudioFoldersConfig();

  for (const [folder, audioPaths] of Object.entries(audioFolders)) {
    assert.ok(Array.isArray(audioPaths) && audioPaths.length > 0, `Expected ${folder} to have audio paths`);

    for (const audioPath of audioPaths) {
      assert.match(
        audioPath,
        new RegExp(`^assets/audio/${escapeRegExp(folder)}/.+\\.(?:mp3|m4a)$`),
        `Expected ${folder} clip to point at an mp3 or m4a inside its own folder`,
      );

      const filePath = path.join(repoRoot, 'public', audioPath);
      assert.ok(fs.existsSync(filePath), `Expected ${audioPath} to exist in the repository`);
    }
  }
});
test('chapel Ace Ventura soundboard matches the mp3s bundled in its folder', () => {
  const configuredPaths = [...getAudioPathsForFolder(getChapelHtml(), 'ace_ventura')].sort();
  const aceVenturaDir = path.join(repoRoot, 'public', 'assets', 'audio', 'ace_ventura');
  const assetPaths = fs
    .readdirSync(aceVenturaDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.mp3'))
    .map((fileName) => `assets/audio/ace_ventura/${fileName}`)
    .sort();

  assert.deepEqual(configuredPaths, assetPaths);
});
