// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildNotes,
  capText,
  checkInstallDefaults,
  matchReleaseHeading,
  validateManifest,
  MAX_NOTES_CHARS,
  compareVersions,
  detectChanges,
  extractChangelogSection,
  extractUpgradeNotes,
  hasSecurityNotes,
  imageTags,
  isNewestStable,
  parseTag,
  parseVersion,
  prepare,
  previousTag,
} from './release-info.mjs';

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-12-01

### Added
- Something new.

### Security
- Fixed a thing.

## [0.1.0-alpha.1] - 2026-11-15

**Pre-release. Data may be wiped.**

### Added
- First things.

[Unreleased]: https://example.test/compare
[0.1.0-alpha.1]: https://example.test/tag
`;

/** A fake repository: every package.json at one version, plus a changelog. */
function repo(version, extra = {}) {
  const files = {
    'package.json': JSON.stringify({ version }),
    'apps/api/package.json': JSON.stringify({ version }),
    'apps/web/package.json': JSON.stringify({ version }),
    'packages/shared/package.json': JSON.stringify({ version }),
    'e2e/package.json': JSON.stringify({ version }),
    'CHANGELOG.md': CHANGELOG,
    'compose.yml': `image: a:\${KINSHIP_VERSION:-${version}}\nimage: b:\${KINSHIP_VERSION:-${version}}\n`,
    '.env.example': `# x\nKINSHIP_VERSION=${version}\n`,
    ...extra,
  };
  return (file) => {
    if (!(file in files)) throw new Error(`no such file ${file}`);
    return files[file];
  };
}

const tagPush = (tag) => ({ GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: tag, GITHUB_SHA: SHA });

test('parses versions and tags, and refuses anything else', () => {
  assert.deepEqual(parseTag('v0.1.0'), { version: '0.1.0', major: 0, minor: 1, patch: 0, pre: null });
  assert.equal(parseTag('v1.2.3-rc.1').pre, 'rc.1');
  assert.equal(parseTag('v0.1.0-alpha.1').pre, 'alpha.1');
  for (const bad of ['0.1.0', 'v0.1', 'v01.0.0', 'v1.0.0-', 'v1.0.0+build', 'vx', 'v1.0.0-rc..1', '']) {
    assert.throws(() => parseTag(bad), undefined, bad);
  }
  assert.throws(() => parseVersion('v0.1.0'));
});

test('orders versions like SemVer', () => {
  const order = [
    '0.1.0-alpha.1',
    '0.1.0-alpha.2',
    '0.1.0-alpha.10',
    '0.1.0-beta.1',
    '0.1.0-rc.1',
    '0.1.0',
    '0.1.1',
    '0.2.0',
    '0.10.0',
    '1.0.0-rc.1',
    '1.0.0',
  ];
  const sorted = [...order]
    .sort(() => 0.5 - Math.random())
    .sort((a, b) => compareVersions(parseVersion(a), parseVersion(b)));
  assert.deepEqual(sorted, order);
});

test('a stable 0.x release gets exact, minor, latest and sha tags, and no major tag', () => {
  const tags = imageTags({ parsed: parseVersion('0.3.1'), sha: SHA, newestStable: true });
  assert.deepEqual(tags, ['0.3.1', '0.3', 'latest', 'sha-abcdef0']);
});

test('a stable release from 1.0 on also gets the major tag', () => {
  const tags = imageTags({ parsed: parseVersion('1.4.2'), sha: SHA, newestStable: true });
  assert.deepEqual(tags, ['1.4.2', '1.4', '1', 'latest', 'sha-abcdef0']);
});

test('a pre-release gets only the exact version and the sha tag, never latest, minor or major', () => {
  for (const version of ['0.1.0-alpha.1', '0.4.0-rc.1', '1.0.0-rc.2']) {
    const tags = imageTags({ parsed: parseVersion(version), sha: SHA, newestStable: true });
    assert.deepEqual(tags, [version, 'sha-abcdef0'], version);
  }
});

test('an older stable release does not take latest from a newer one', () => {
  const existing = ['v0.1.0', 'v0.2.0'];
  assert.equal(isNewestStable(existing, parseVersion('0.1.1')), false);
  assert.equal(isNewestStable(existing, parseVersion('0.2.1')), true);
  assert.equal(isNewestStable(['v0.2.0-rc.1'], parseVersion('0.1.0')), true, 'a pre-release is not "newer stable"');
  assert.equal(isNewestStable([], parseVersion('0.1.0-alpha.1')), false);
});

test('finds the previous tag: stable skips pre-releases, a pre-release sees everything earlier', () => {
  const existing = ['v0.1.0', 'v0.2.0-rc.1', 'v0.2.0', 'v0.3.0-rc.1', 'v0.3.0', 'not-a-tag'];
  assert.equal(previousTag(existing, parseVersion('0.3.0')), 'v0.2.0');
  assert.equal(previousTag(existing, parseVersion('0.3.0-rc.2')), 'v0.3.0-rc.1');
  assert.equal(previousTag(existing, parseVersion('0.2.0')), 'v0.1.0');
  assert.equal(previousTag([], parseVersion('0.1.0-alpha.1')), null);
});

test('extracts a changelog section, its date, and drops trailing link definitions', () => {
  const section = extractChangelogSection(CHANGELOG, '0.1.0-alpha.1');
  assert.equal(section.date, '2026-11-15');
  assert.ok(section.text.startsWith('**Pre-release. Data may be wiped.**'));
  assert.ok(section.text.includes('- First things.'));
  assert.ok(!section.text.includes('example.test'));
  assert.ok(!section.text.includes('Something new'), 'stops at the next version');
  assert.throws(() => extractChangelogSection(CHANGELOG, '9.9.9'), /no section "## \[9\.9\.9\]"/);
  assert.throws(() => extractChangelogSection('## [1.0.0] - 2026-01-01\n\n## [0.9.0]\nx', '1.0.0'), /empty/);
  assert.throws(() => extractChangelogSection(CHANGELOG, '0.1.0'), /no section/, '0.1.0 is not 0.1.0-alpha.1');
});

test('sees whether a release has security notes', () => {
  assert.equal(hasSecurityNotes(extractChangelogSection(CHANGELOG, '0.2.0').text), true);
  assert.equal(hasSecurityNotes(extractChangelogSection(CHANGELOG, '0.1.0-alpha.1').text), false);
  assert.equal(hasSecurityNotes('### Security\n\n### Added\n- x'), false);
});

test('reads upgrade notes for a version', () => {
  const upgrade = '# Upgrade\n\n## 0.2.0\nChange BACKUP_KEEP.\n\n## 0.1.0\nNothing.\n';
  assert.equal(extractUpgradeNotes(upgrade, '0.2.0'), 'Change BACKUP_KEEP.');
  assert.equal(extractUpgradeNotes(upgrade, '0.3.0'), null);
  assert.equal(extractUpgradeNotes(null, '0.2.0'), null);
});

test('prepare: a matching tag push publishes with the right tags and image names', () => {
  const info = prepare({
    env: tagPush('v0.1.0-alpha.1'),
    read: repo('0.1.0-alpha.1'),
    tags: [],
    now: new Date('2026-11-15T19:04:05.678Z'),
  });
  assert.equal(info.publish, true);
  assert.equal(info.prerelease, true);
  assert.equal(info.latest, false);
  assert.equal(info.buildDate, '2026-11-15T19:04:05Z');
  assert.deepEqual(info.apiTags, [
    'ghcr.io/officialjcreyes/kinship-api:0.1.0-alpha.1',
    'ghcr.io/officialjcreyes/kinship-api:sha-abcdef0',
  ]);
  assert.deepEqual(info.webTags, [
    'ghcr.io/officialjcreyes/kinship-web:0.1.0-alpha.1',
    'ghcr.io/officialjcreyes/kinship-web:sha-abcdef0',
  ]);
});

test('prepare: image names are lowercase', () => {
  const info = prepare({ env: tagPush('v0.2.0'), read: repo('0.2.0'), tags: [] });
  for (const tag of [...info.apiTags, ...info.webTags]) assert.equal(tag, tag.toLowerCase());
  assert.ok(info.apiTags.includes('ghcr.io/officialjcreyes/kinship-api:latest'));
});

test('prepare: a tag that does not match package.json fails, and says which is which', () => {
  assert.throws(
    () => prepare({ env: tagPush('v0.1.1'), read: repo('0.1.0-alpha.1'), tags: [] }),
    /v0\.1\.1 is version 0\.1\.1, but package\.json says 0\.1\.0-alpha\.1/,
  );
});

test('prepare: e2e/package.json is checked too', () => {
  const read = repo('0.1.0-alpha.1', { 'e2e/package.json': JSON.stringify({ version: '0.0.0' }) });
  assert.throws(() => prepare({ env: tagPush('v0.1.0-alpha.1'), read, tags: [] }), /e2e\/package.json: 0\.0\.0/);
});

test('prepare: package.json files that disagree fail', () => {
  const read = repo('0.1.0-alpha.1', { 'apps/web/package.json': JSON.stringify({ version: '0.0.0' }) });
  assert.throws(
    () => prepare({ env: tagPush('v0.1.0-alpha.1'), read, tags: [] }),
    /disagree[\s\S]*apps\/web\/package\.json: 0\.0\.0/,
  );
});

test('prepare: a malformed tag fails', () => {
  assert.throws(() => prepare({ env: tagPush('v0.1'), read: repo('0.1.0-alpha.1'), tags: [] }), /not a version/);
  assert.throws(
    () => prepare({ env: tagPush('release-1'), read: repo('0.1.0-alpha.1'), tags: [] }),
    /must start with "v"/,
  );
});

test('prepare: a version with no changelog section fails', () => {
  assert.throws(
    () => prepare({ env: tagPush('v0.9.0'), read: repo('0.9.0'), tags: [] }),
    /no section "## \[0\.9\.0\]"/,
  );
});

test('prepare: a manual run is a dry run by default and never publishes from a branch', () => {
  const base = {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF_TYPE: 'branch',
    GITHUB_REF_NAME: 'release/0.1',
    GITHUB_SHA: SHA,
  };
  const dry = prepare({ env: { ...base, DRY_RUN: 'true' }, read: repo('0.1.0-alpha.1'), tags: [] });
  assert.equal(dry.publish, false);
  assert.equal(prepare({ env: base, read: repo('0.1.0-alpha.1'), tags: [] }).publish, false, 'no input means dry run');
  assert.throws(
    () => prepare({ env: { ...base, DRY_RUN: 'false' }, read: repo('0.1.0-alpha.1'), tags: [] }),
    /only allowed from a tag/,
  );
});

test('prepare: a manual run on a tag can publish (to repeat a failed release), if the tag matches', () => {
  const onTag = {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: 'v0.1.0-alpha.1',
    GITHUB_SHA: SHA,
    DRY_RUN: 'false',
  };
  assert.equal(prepare({ env: onTag, read: repo('0.1.0-alpha.1'), tags: [] }).publish, true);
  assert.throws(
    () => prepare({ env: { ...onTag, GITHUB_REF_NAME: 'v0.1.1' }, read: repo('0.1.0-alpha.1'), tags: [] }),
    /package\.json says/,
  );
});

test('prepare: a pull request is always a dry run, whatever the version', () => {
  const env = {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF_TYPE: 'branch',
    GITHUB_REF_NAME: '5/merge',
    GITHUB_SHA: SHA,
  };
  const info = prepare({ env, read: repo('0.1.0-alpha.1'), tags: [] });
  assert.equal(info.publish, false);
  assert.equal(info.version, '0.1.0-alpha.1');
  // The package.json files must still agree, and the changelog must still have the section.
  assert.throws(() => prepare({ env, read: repo('0.9.0'), tags: [] }), /no section "## \[0\.9\.0\]"/);
});

test('prepare: other triggers are refused', () => {
  assert.throws(
    () =>
      prepare({
        env: { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'x', GITHUB_SHA: SHA },
        read: repo('0.1.0-alpha.1'),
        tags: [],
      }),
    /Unexpected trigger/,
  );
  assert.throws(
    () => prepare({ env: { ...tagPush('v0.1.0-alpha.1'), GITHUB_SHA: 'abc' }, read: repo('0.1.0-alpha.1'), tags: [] }),
    /full commit hash/,
  );
});

/** A fake `git` that answers the two questions detectChanges asks. */
const fakeGit =
  ({ migrations = '', log = '' }) =>
  (args) =>
    args[0] === 'diff' ? migrations : log;

test('detects a new migration and a breaking change since the previous tag', () => {
  assert.deepEqual(detectChanges(fakeGit({}), 'v0.1.0'), { migration: false, breaking: false });
  assert.deepEqual(detectChanges(fakeGit({ migrations: 'apps/api/migrations/0003_x.sql\n' }), 'v0.1.0'), {
    migration: true,
    breaking: false,
  });
  const log = (message) => `${message}\0`;
  assert.equal(detectChanges(fakeGit({ log: log('feat!: rename BACKUP_KEEP\n\nbody') }), 'v0.1.0').breaking, true);
  assert.equal(detectChanges(fakeGit({ log: log('feat(api)!: change a thing') }), 'v0.1.0').breaking, true);
  assert.equal(
    detectChanges(fakeGit({ log: log('fix: x\n\nBREAKING CHANGE: the setting is gone') }), 'v0.1.0').breaking,
    true,
  );
  assert.equal(
    detectChanges(fakeGit({ log: log('feat: add the thing! really') + log('fix: ok') }), 'v0.1.0').breaking,
    false,
  );
  assert.deepEqual(
    detectChanges(fakeGit({ migrations: 'x', log: 'feat!: y\0' }), null),
    { migration: false, breaking: false },
    'first release has nothing to compare',
  );
});

test('release notes: the changelog text plus install and verify lines, and a manifest', () => {
  const { body, manifest } = buildNotes({
    version: '0.1.0-alpha.1',
    prerelease: true,
    read: repo('0.1.0-alpha.1'),
    git: fakeGit({}),
    tags: [],
  });
  assert.ok(body.startsWith('**Pre-release. Data may be wiped.**'));
  assert.ok(body.includes('ghcr.io/officialjcreyes/kinship-api:0.1.0-alpha.1'));
  assert.ok(body.includes('gh attestation verify'));
  assert.deepEqual(manifest, {
    version: '0.1.0-alpha.1',
    date: '2026-11-15',
    channel: 'prerelease',
    security: false,
    breaking: false,
    migration: false,
    upgradeFrom: null,
    notes: manifest.notes,
    upgradeNotes: null,
  });
  assert.ok(manifest.notes.includes('First things.'));
});

test('release notes: breaking changes need UPGRADE.md, and a migration is flagged', () => {
  const breaking = fakeGit({ log: 'feat!: x\0', migrations: 'apps/api/migrations/0003_y.sql' });
  assert.throws(
    () => buildNotes({ version: '0.2.0', prerelease: false, read: repo('0.2.0'), git: breaking, tags: ['v0.1.0'] }),
    /breaking changes since v0\.1\.0, but UPGRADE\.md has no "## 0\.2\.0" section/,
  );
  const { manifest } = buildNotes({
    version: '0.2.0',
    prerelease: false,
    read: repo('0.2.0', { 'UPGRADE.md': '## 0.2.0\nRename the setting.\n' }),
    git: breaking,
    tags: ['v0.1.0'],
  });
  assert.equal(manifest.breaking, true);
  assert.equal(manifest.migration, true);
  assert.equal(manifest.security, true);
  assert.equal(manifest.channel, 'stable');
  assert.equal(manifest.upgradeNotes, 'Rename the setting.');
});

test('a stable release with no earlier stable tag is compared with the latest earlier tag of any kind', () => {
  const alphas = ['v0.1.0-alpha.1', 'v0.1.0-alpha.2'];
  assert.equal(previousTag(alphas, parseVersion('0.2.0')), 'v0.1.0-alpha.2');
  assert.equal(previousTag([...alphas, 'v0.1.0'], parseVersion('0.2.0')), 'v0.1.0', 'a stable tag still wins');
  assert.equal(previousTag([], parseVersion('0.2.0')), null);
  // So 0.2.0 after an alpha is not reported as "no migration".
  const { manifest } = buildNotes({
    version: '0.2.0',
    prerelease: false,
    read: repo('0.2.0'),
    git: fakeGit({ migrations: 'apps/api/migrations/0007_x.sql' }),
    tags: alphas,
  });
  assert.equal(manifest.migration, true);
});

test('release headings: Keep a Changelog, release-please and bare forms are all understood', () => {
  assert.deepEqual(matchReleaseHeading('## [0.2.0] - 2026-12-01', '0.2.0'), { date: '2026-12-01' });
  assert.deepEqual(
    matchReleaseHeading('## [0.2.0](https://github.com/o/r/compare/v0.1.0...v0.2.0) (2026-12-01)', '0.2.0'),
    { date: '2026-12-01' },
  );
  assert.deepEqual(matchReleaseHeading('## 0.2.0 (2026-12-01)', '0.2.0'), { date: '2026-12-01' });
  assert.deepEqual(matchReleaseHeading('## [0.2.0]', '0.2.0'), { date: null });
  assert.equal(matchReleaseHeading('## [0.2.0-rc.1] - 2026-12-01', '0.2.0'), null);
  assert.equal(matchReleaseHeading('## [0.2.01] - 2026-12-01', '0.2.0'), null);
  assert.equal(matchReleaseHeading('### [0.2.0] - 2026-12-01', '0.2.0'), null);
  const generated = `# Changelog

## [0.3.0](https://x.test/compare/v0.2.0...v0.3.0) (2027-01-05)

### Features

* a thing

## [0.2.0](https://x.test/compare/v0.1.0...v0.2.0) (2026-12-01)

### Bug Fixes

* another
`;
  const section = extractChangelogSection(generated, '0.2.0');
  assert.equal(section.date, '2026-12-01');
  assert.ok(section.text.includes('another') && !section.text.includes('a thing'));
});

test('long notes are cut and said to be cut', () => {
  const long = Array.from({ length: 3000 }, (_, i) => `- line ${i}`).join('\n');
  const cut = capText(long);
  assert.ok(cut.length <= MAX_NOTES_CHARS + 100);
  assert.ok(cut.includes('Shortened'));
  assert.equal(capText('short'), 'short');
});

test('the manifest contract: a built manifest passes, and each broken field is named', () => {
  const { manifest } = buildNotes({
    version: '0.2.0',
    prerelease: false,
    read: repo('0.2.0'),
    git: fakeGit({}),
    tags: ['v0.1.0'],
  });
  assert.equal(validateManifest(manifest), manifest);
  const bad = (change) => () => validateManifest({ ...manifest, ...change });
  assert.throws(bad({ version: 'nope' }), /"version"/);
  assert.throws(bad({ date: '12/01/2026' }), /"date"/);
  assert.throws(bad({ channel: 'beta' }), /"channel"/);
  assert.throws(bad({ channel: 'prerelease' }), /does not match the version/);
  assert.throws(bad({ security: 'yes' }), /"security"/);
  assert.throws(bad({ upgradeFrom: 3 }), /"upgradeFrom"/);
  assert.throws(bad({ notes: '' }), /"notes"/);
  assert.throws(bad({ notes: 'x'.repeat(MAX_NOTES_CHARS + 500) }), /too long/);
  assert.throws(bad({ extra: 1 }), /unknown field "extra"/);
  assert.throws(() => validateManifest([]), /not an object/);
});

test('the golden manifest (the contract the api tests read) and the real alpha.2 manifest are valid', async () => {
  const { readFileSync } = await import('node:fs');
  const golden = JSON.parse(readFileSync(new URL('./fixtures/release-manifest.golden.json', import.meta.url), 'utf8'));
  const { manifest } = buildNotes({
    version: '0.2.0',
    prerelease: false,
    read: repo('0.2.0', { 'UPGRADE.md': '## 0.2.0\nRename the setting.\n' }),
    git: fakeGit({ log: 'feat!: x\0', migrations: 'apps/api/migrations/0003_y.sql' }),
    tags: ['v0.1.0'],
  });
  assert.deepEqual(manifest, golden, 'the generator changed: update scripts/fixtures/release-manifest.golden.json too');
  validateManifest(golden);
  validateManifest(
    JSON.parse(readFileSync(new URL('./fixtures/release-manifest.alpha2.json', import.meta.url), 'utf8')),
  );
});

test('the install files must default to the version being released', () => {
  checkInstallDefaults(repo('0.2.0'), '0.2.0');
  assert.throws(() => checkInstallDefaults(repo('0.2.0'), '0.3.0'), /defaults KINSHIP_VERSION to 0\.2\.0/);
  assert.throws(
    () => checkInstallDefaults(repo('0.2.0', { '.env.example': 'KINSHIP_VERSION=0.1.0\n' }), '0.2.0'),
    /sets KINSHIP_VERSION=0\.1\.0/,
  );
  assert.throws(
    () => checkInstallDefaults(repo('0.2.0', { 'compose.yml': 'services: {}\n' }), '0.2.0'),
    /no \$\{KINSHIP/,
  );
  // The real files in this checkout agree with the package version (release-please keeps them so).
  const here = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  checkInstallDefaults(here, JSON.parse(here('package.json')).version);
});

// scripts/fixtures/release-please-changelog.md is what release-please 17.11.2 wrote (a dry run on 2026-11-17 over this
// repository's commits, plus a `security:` commit and a `feat(api)!:` commit so those sections exist). Both parsers read it:
// this one (the release notes and manifest) and the in-app reader (apps/api/test/updates-shared.test.ts).
test('a changelog written by release-please gives release notes and a manifest with the right flags', () => {
  const generated = readFileSync(new URL('./fixtures/release-please-changelog.md', import.meta.url), 'utf8');
  const section = extractChangelogSection(generated, '0.2.0-alpha.2');
  assert.equal(section.date, '2026-11-17');
  assert.ok(section.text.includes('### Security') && section.text.includes('### Features'));
  assert.equal(hasSecurityNotes(section.text), true);
  const { manifest } = buildNotes({
    version: '0.2.0-alpha.2',
    prerelease: true,
    read: repo('0.2.0-alpha.2', {
      'CHANGELOG.md': generated,
      'UPGRADE.md': '## 0.2.0-alpha.2\n\nSet BACKUP_RETENTION_DAILY.\n',
    }),
    git: fakeGit({ log: 'feat(api)!: rename BACKUP_KEEP\0' }),
    tags: ['v0.1.0-alpha.2'],
  });
  assert.equal(manifest.security, true);
  assert.equal(manifest.breaking, true);
  assert.equal(manifest.channel, 'prerelease');
  assert.ok(manifest.notes.includes('BREAKING CHANGES'));
  validateManifest(manifest);
});
