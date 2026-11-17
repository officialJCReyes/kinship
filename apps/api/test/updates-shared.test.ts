// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The shared rules of the update check (packages/shared): SemVer, the release manifest, the changelog reader, which releases
// are offered and when the banner and the update steps show. The api and the web app use these same functions.
import { readFileSync } from 'node:fs';
import {
  MAX_NOTES_CHARS,
  backupIsFresh,
  bannerLine,
  bannerVisible,
  compareSemver,
  compareVersionText,
  groupKind,
  needsBackupWarning,
  offeredRange,
  parseChangelog,
  parseReleaseHeading,
  parseReleaseManifest,
  parseSemver,
  parseUpdateSettings,
  sectionsBetween,
  updateStepsVisible,
  versionFromTag,
} from '@kinship/shared';
import type { KnownRelease } from '@kinship/shared';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`scripts/fixtures/${name}`, root), 'utf8'));

describe('SemVer', () => {
  const VERSIONS = [
    '0.1.0-alpha.1',
    '0.1.0-alpha.2',
    '0.1.0-alpha.10',
    '0.1.0-beta',
    '0.1.0-rc.1',
    '0.1.0',
    '0.2.0-rc.1',
    '0.2.0',
    '0.9.0',
    '0.10.0',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.10.0',
    '10.0.0',
  ];

  it('orders versions like SemVer (0.10.0 is newer than 0.9.0, a pre-release is older than its release)', () => {
    for (let i = 0; i < VERSIONS.length; i++) {
      for (let j = 0; j < VERSIONS.length; j++) {
        const a = parseSemver(VERSIONS[i]);
        const b = parseSemver(VERSIONS[j]);
        if (!a || !b) throw new Error('fixture version does not parse');
        expect(Math.sign(compareSemver(a, b)), `${VERSIONS[i]} vs ${VERSIONS[j]}`).toBe(Math.sign(i - j));
      }
    }
    expect(compareVersionText('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersionText('0.2.0-rc.1', '0.2.0')).toBeLessThan(0);
  });

  it('agrees with the release pipeline (scripts/release-info.mjs) on every pair', async () => {
    const pipelineUrl = new URL('scripts/release-info.mjs', root).href;
    const pipeline = (await import(pipelineUrl)) as {
      parseVersion: (text: string) => unknown;
      compareVersions: (a: unknown, b: unknown) => number;
    };
    for (const a of VERSIONS) {
      for (const b of VERSIONS) {
        const here = compareVersionText(a, b);
        const there = pipeline.compareVersions(pipeline.parseVersion(a), pipeline.parseVersion(b));
        expect(Math.sign(here ?? NaN), `${a} vs ${b}`).toBe(Math.sign(there));
      }
    }
  });

  it('refuses anything that is not MAJOR.MINOR.PATCH with an optional pre-release', () => {
    for (const bad of [
      '1.2',
      'v1.2.3',
      '01.2.3',
      '1.2.3+build',
      '1.2.3-',
      '1.2.3-a..b',
      '',
      ' 1.2.3',
      '1.2.3 ',
      3,
      null,
    ]) {
      expect(parseSemver(bad), String(bad)).toBeNull();
    }
    expect(parseSemver('1'.repeat(70) + '.0.0')).toBeNull();
    expect(parseSemver('99999999999999999999.0.0')).toBeNull();
  });

  it('takes a version from a release tag only when the tag is v and a version', () => {
    expect(versionFromTag('v0.2.0')).toBe('0.2.0');
    expect(versionFromTag('v0.2.0-rc.1')).toBe('0.2.0-rc.1');
    for (const bad of ['0.2.0', 'nightly', 'v1', 'V1.0.0', 'v1.0.0+x', undefined, 4])
      expect(versionFromTag(bad)).toBeNull();
  });
});

describe('the release manifest', () => {
  const golden = fixture('release-manifest.golden.json');
  const ok = { tagVersion: '0.2.0', githubPrerelease: false };

  it('reads the golden manifest and the real alpha.2 manifest', () => {
    const parsed = parseReleaseManifest(golden, ok);
    expect(parsed).toMatchObject({ ok: true, manifest: { version: '0.2.0', channel: 'stable', security: true } });
    const alpha = parseReleaseManifest(fixture('release-manifest.alpha2.json'), {
      tagVersion: '0.1.0-alpha.2',
      githubPrerelease: true,
    });
    expect(alpha).toMatchObject({ ok: true, manifest: { channel: 'prerelease', migration: true, breaking: true } });
  });

  it('refuses a manifest for another version than the tag, and names every wrong field', () => {
    expect(parseReleaseManifest(golden, { ...ok, tagVersion: '0.3.0' })).toMatchObject({ ok: false });
    const bad = parseReleaseManifest(
      {
        version: 'x',
        date: '2026-13-45',
        channel: 'beta',
        security: 'yes',
        breaking: 1,
        migration: null,
        notes: '',
        upgradeFrom: 3,
        upgradeNotes: 4,
      },
      ok,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const text = bad.problems.join(' | ');
      for (const field of [
        'version',
        'date',
        'channel',
        'security',
        'breaking',
        'migration',
        'notes',
        'upgradeFrom',
        'upgradeNotes',
      ])
        expect(text, field).toContain(`"${field}"`);
    }
    for (const notAnObject of [null, 'text', 4, [], undefined]) {
      expect(parseReleaseManifest(notAnObject, ok)).toMatchObject({ ok: false });
    }
  });

  it('never offers as stable what GitHub calls a pre-release, or what the manifest or version says is one', () => {
    const stable = golden as Record<string, unknown>;
    expect(parseReleaseManifest(stable, { ...ok, githubPrerelease: true })).toMatchObject({
      manifest: { channel: 'prerelease' },
    });
    expect(parseReleaseManifest({ ...stable, channel: 'prerelease' }, ok)).toMatchObject({
      manifest: { channel: 'prerelease' },
    });
    expect(
      parseReleaseManifest({ ...stable, version: '0.2.0-rc.1' }, { tagVersion: '0.2.0-rc.1', githubPrerelease: false }),
    ).toMatchObject({ manifest: { channel: 'prerelease' } });
  });

  it('drops unknown fields and shortens notes that claim to be huge', () => {
    const huge = {
      ...(golden as object),
      notes: 'line\n'.repeat(100_000),
      upgradeNotes: 'x'.repeat(5_000_000),
      extra: 'ignored',
    };
    const parsed = parseReleaseManifest(huge, ok);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.notes.length).toBeLessThanOrEqual(MAX_NOTES_CHARS + 100);
      expect(parsed.manifest.notes).toContain('Shortened');
      expect(parsed.manifest.upgradeNotes?.length).toBeLessThanOrEqual(MAX_NOTES_CHARS + 100);
      expect('extra' in parsed.manifest).toBe(false);
    }
  });
});

describe('the changelog reader', () => {
  const real = readFileSync(new URL('CHANGELOG.md', root), 'utf8');

  it('reads the changelog as it is written today', () => {
    const sections = parseChangelog(real);
    expect(sections.map((s) => s.version)).toEqual(['0.1.0-alpha.2', '0.1.0-alpha.1']);
    const alpha2 = sections[0];
    expect(alpha2?.date).toBe('2026-11-16');
    const kinds = alpha2?.groups.map((g) => g.kind);
    expect(kinds).toContain('new');
    expect(kinds).toContain('improved');
    expect(alpha2?.groups.find((g) => g.kind === 'new')?.title).toMatch(/adds/);
    // The trailing link definitions and the Unreleased heading are not content.
    expect(JSON.stringify(sections)).not.toContain('compare/v0.1.0');
    expect(JSON.stringify(sections)).not.toContain('Planned for 0.1.0');
  });

  it('reads release-please headings and groups', () => {
    const sample = `# Changelog

## [0.3.0](https://github.com/o/r/compare/v0.2.0...v0.3.0) (2027-01-05)

### ⚠ BREAKING CHANGES

* rename BACKUP_KEEP

### Features

* a thing

### Bug Fixes

* another

### Security

* a fix

## [0.2.0](https://github.com/o/r/compare/v0.1.0...v0.2.0) (2026-12-01)

### Features

* older
`;
    const sections = parseChangelog(sample);
    expect(sections.map((s) => [s.version, s.date])).toEqual([
      ['0.3.0', '2027-01-05'],
      ['0.2.0', '2026-12-01'],
    ]);
    expect(sections[0]?.groups.map((g) => g.kind)).toEqual(['breaking', 'new', 'fixed', 'security']);
  });

  it('never fails: garbage, empty text, odd headings and a missing section give an empty or partial list', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('just some text\n### Fixed\n- x')).toEqual([]);
    expect(parseChangelog('## [Unreleased]\n\n- x\n\n## Notes\n\n- y')).toEqual([]);
    expect(parseChangelog('## 1.0.0 (2026-01-01)\n\nplain text')[0]?.groups).toEqual([
      { kind: 'other', title: '', body: 'plain text' },
    ]);
    expect(parseChangelog('## [1.0.0] - 2026-01-01\r\n\r\n### Fixed\r\n\r\n- crlf\r\n')[0]?.groups[0]?.body).toBe(
      '- crlf',
    );
    expect(parseChangelog('\u0000\u0001## [1.0.0]\n### \n')).toEqual([]);
    expect(parseReleaseHeading('## [Unreleased]')).toBeNull();
    expect(parseReleaseHeading('### [1.0.0]')).toBeNull();
  });

  it('maps headings to the five groups, security and breaking first', () => {
    const table: Array<[string, string]> = [
      ['Security', 'security'],
      ['Security fixes', 'security'],
      ['⚠ BREAKING CHANGES', 'breaking'],
      ['Breaking changes', 'breaking'],
      ['Features', 'new'],
      ['Added', 'new'],
      ['What 0.2.0 adds', 'new'],
      ['Bug Fixes', 'fixed'],
      ['Fixed', 'fixed'],
      ['Changed', 'improved'],
      ['Performance Improvements', 'improved'],
      ['What it does not include yet', 'other'],
      ['Something unexpected', 'other'],
    ];
    for (const [title, kind] of table) expect(groupKind(title), title).toBe(kind);
  });

  it('lists what an admin missed: newer than last seen, up to what runs, newest first, pre-releases folded away', () => {
    const sections = parseChangelog(`## [0.4.0] - 2027-03-01
### Fixed
- a
## [0.3.0] - 2027-02-01
### Fixed
- b
## [0.3.0-rc.2] - 2027-01-25
### Fixed
- rc
## [0.3.0-rc.1] - 2027-01-20
### Fixed
- rc
## [0.2.0] - 2026-12-01
### Fixed
- c
## [0.1.0-alpha.2] - 2026-11-16
### Fixed
- d
`);
    const versions = (after: string, upTo: string) => sectionsBetween(sections, after, upTo).map((s) => s.version);
    expect(versions('0.2.0', '0.4.0')).toEqual(['0.4.0', '0.3.0']);
    expect(versions('0.1.0-alpha.2', '0.3.0')).toEqual(['0.3.0', '0.2.0']);
    expect(versions('0.1.0-alpha.2', '0.3.0-rc.2')).toEqual(['0.3.0-rc.2', '0.3.0-rc.1', '0.2.0']);
    expect(versions('0.4.0', '0.4.0')).toEqual([]);
    expect(versions('0.5.0', '0.4.0')).toEqual([]);
    expect(versions('nope', '0.4.0')).toEqual([]);
  });
});

describe('the three switches', () => {
  it('takes any non-empty subset of true and false', () => {
    expect(parseUpdateSettings({ check: false })).toEqual({ ok: true, settings: { check: false } });
    expect(parseUpdateSettings({ check: true, preReleases: true, safetyCopy: false })).toMatchObject({ ok: true });
  });
  it('names the field that is wrong', () => {
    expect(parseUpdateSettings({})).toEqual({ ok: false, code: 'invalid_request', field: 'settings' });
    expect(parseUpdateSettings([])).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(parseUpdateSettings({ nope: true })).toEqual({ ok: false, code: 'invalid_request', field: 'nope' });
    expect(parseUpdateSettings({ check: 'yes' })).toEqual({
      ok: false,
      code: 'invalid_update_setting',
      field: 'check',
    });
    expect(parseUpdateSettings({ safetyCopy: 1 })).toMatchObject({ ok: false, field: 'safetyCopy' });
  });
});

function release(version: string, extra: Partial<KnownRelease> = {}): KnownRelease {
  return {
    version,
    date: '2026-12-01',
    channel: parseSemver(version)?.pre ? 'prerelease' : 'stable',
    security: false,
    breaking: false,
    migration: false,
    notes: 'notes',
    upgradeNotes: null,
    details: true,
    ...extra,
  };
}

describe('which releases are offered', () => {
  it('takes every stable release newer than the running one, newest first, with the flags combined', () => {
    const range = offeredRange(
      [
        release('0.10.0', { security: true }),
        release('0.9.0', { migration: true }),
        release('0.8.0', { breaking: true }),
        release('0.7.0'),
        release('0.6.0'),
      ],
      '0.7.0',
      false,
    );
    expect(range?.releases.map((r) => r.version)).toEqual(['0.10.0', '0.9.0', '0.8.0']);
    expect(range).toMatchObject({ from: '0.7.0', to: '0.10.0', security: true, migration: true, breaking: true });
  });

  it('returns null when nothing is newer, and ignores anything that is not a version', () => {
    expect(offeredRange([release('0.7.0'), release('0.6.0')], '0.7.0', false)).toBeNull();
    expect(offeredRange([], '0.7.0', false)).toBeNull();
    expect(offeredRange([release('0.8.0')], 'unknown', false)).toBeNull();
    expect(offeredRange([{ ...release('0.8.0'), version: 'nightly' }], '0.7.0', false)).toBeNull();
  });

  it('offers pre-releases only when asked, and a stable release when running a pre-release', () => {
    const all = [release('0.3.0-rc.1'), release('0.2.1'), release('0.2.0')];
    expect(offeredRange(all, '0.2.0', false)?.releases.map((r) => r.version)).toEqual(['0.2.1']);
    expect(offeredRange(all, '0.2.0', true)?.releases.map((r) => r.version)).toEqual(['0.3.0-rc.1', '0.2.1']);
    expect(offeredRange([release('0.2.0'), release('0.2.0-rc.1')], '0.2.0-rc.1', false)?.to).toBe('0.2.0');
    // A release whose channel says pre-release is not stable even if its version looks stable.
    expect(offeredRange([release('0.3.0', { channel: 'prerelease' })], '0.2.0', false)).toBeNull();
  });

  it('counts a duplicate version once', () => {
    expect(offeredRange([release('0.3.0'), release('0.3.0')], '0.2.0', false)?.releases).toHaveLength(1);
  });
});

describe('the banner and the update steps', () => {
  const plain = offeredRange([release('0.3.0')], '0.2.0', false);
  const migration = offeredRange([release('0.3.0', { migration: true })], '0.2.0', false);
  const unknown = offeredRange([release('0.3.0', { details: false })], '0.2.0', false);
  const now = new Date('2026-12-10T12:00:00Z');
  if (!plain || !migration || !unknown) throw new Error('fixture');

  it('picks the banner line from the flags (unknown details count as a warning)', () => {
    expect(bannerLine(plain)).toBe('none');
    expect(bannerLine(migration)).toBe('migration');
    expect(bannerLine({ ...migration, breaking: true })).toBe('both');
    expect(bannerLine({ ...plain, breaking: true })).toBe('breaking');
    expect(bannerLine(unknown)).toBe('unknown');
    expect(needsBackupWarning(plain)).toBe(false);
    expect(needsBackupWarning(unknown)).toBe(true);
  });

  it('hides the banner for a dismissed version and shows it again for a newer one', () => {
    expect(bannerVisible(null, null)).toBe(false);
    expect(bannerVisible(plain, null)).toBe(true);
    expect(bannerVisible(plain, '0.3.0')).toBe(false);
    expect(bannerVisible(plain, '0.2.9')).toBe(true);
    expect(bannerVisible(plain, '0.4.0')).toBe(false);
    expect(bannerVisible(plain, 'garbage')).toBe(true);
  });

  it('counts a backup as fresh for 24 hours, and not from the future', () => {
    expect(backupIsFresh('2026-12-10T00:00:00Z', now)).toBe(true);
    expect(backupIsFresh('2026-12-09T12:00:00Z', now)).toBe(true);
    expect(backupIsFresh('2026-12-09T11:59:00Z', now)).toBe(false);
    expect(backupIsFresh('2027-01-01T00:00:00Z', now)).toBe(false);
    expect(backupIsFresh('not a time', now)).toBe(false);
    expect(backupIsFresh(null, now)).toBe(false);
  });

  it('keeps the steps hidden until a recent backup exists or this version is ticked', () => {
    const steps = (range: typeof plain, lastBackupAt: string | null, ackVersion: string | null) =>
      updateStepsVisible({ range: range as NonNullable<typeof range>, lastBackupAt, now, ackVersion });
    expect(steps(plain, null, null)).toBe(true);
    expect(steps(migration, null, null)).toBe(false);
    expect(steps(migration, '2026-12-01T00:00:00Z', null)).toBe(false);
    expect(steps(migration, '2026-12-10T08:00:00Z', null)).toBe(true);
    expect(steps(migration, null, '0.3.0')).toBe(true);
    expect(steps(migration, null, '0.2.5')).toBe(false);
    expect(steps(unknown, null, null)).toBe(false);
  });
});
