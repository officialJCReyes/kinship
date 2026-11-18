// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Release logic for .github/workflows/release.yml, kept here so it can be tested.
//
//   node scripts/release-info.mjs prepare        works out what to build and push (reads GitHub's env)
//   node scripts/release-info.mjs notes <dir>    writes release-notes.md and release-manifest.json
//   node scripts/release-info.mjs validate <f>   checks a manifest file against the contract
//
// Rules (design/kinship-release-and-deployment-plan.md, sections 3, 4, 5 and 7):
//   - a release is a tag vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-pre.N, and it must match the
//     version in every package.json (the four of the apps and packages, and e2e/), or nothing is built;
//   - images get the exact version and sha-<7 chars>; a stable release also gets MAJOR.MINOR,
//     `latest` (only if no newer stable tag exists) and, from 1.0, MAJOR; a pre-release gets
//     only the exact version and the sha tag and never moves `latest`;
//   - a tag push publishes; a manual run never does, unless it was started on a tag; a pull request
//     (which only runs when it touches the release machinery) is always a dry run.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const IMAGE_REGISTRY = 'ghcr.io/officialjcreyes'; // GHCR needs lowercase
export const IMAGES = ['kinship-api', 'kinship-web'];
export const PACKAGE_FILES = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
  'e2e/package.json',
];

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;

/** Parses "1.2.3" or "1.2.3-rc.1". Build metadata ("+...") is not used by KinShip and is refused. */
export function parseVersion(text) {
  const match = VERSION.exec(text);
  if (!match) throw new Error(`"${text}" is not a version like 1.2.3 or 1.2.3-rc.1`);
  const [, major, minor, patch, pre] = match;
  return { version: text, major: Number(major), minor: Number(minor), patch: Number(patch), pre: pre ?? null };
}

/** Parses a release tag: "v" and then a version. */
export function parseTag(tag) {
  if (!tag.startsWith('v')) throw new Error(`The tag "${tag}" must start with "v", as in v0.1.0 or v0.2.0-rc.1`);
  return parseVersion(tag.slice(1));
}

/** SemVer order: negative when a < b. A pre-release is lower than its release. */
export function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] - b[key];
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  const left = a.pre.split('.');
  const right = b.pre.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (!xn && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The tag of the version before this one: the highest earlier stable tag, or for a pre-release any earlier tag. A stable
 * release with no earlier stable tag (0.2.0 before 0.1.0 was tagged) falls back to the highest earlier tag of any kind, so
 * its migration and breaking-change flags are compared with something instead of being silently false.
 */
export function previousTag(existingTags, current) {
  const earlier = existingTags
    .map((tag) => {
      try {
        return { tag, parsed: parseTag(tag) };
      } catch {
        return undefined;
      }
    })
    .filter((entry) => entry !== undefined && compareVersions(entry.parsed, current) < 0)
    .sort((a, b) => compareVersions(b.parsed, a.parsed));
  if (current.pre !== null) return earlier[0]?.tag ?? null;
  return (earlier.find((entry) => entry.parsed.pre === null) ?? earlier[0])?.tag ?? null;
}

/** True when no stable tag newer than this one exists, so this release may be `latest`. */
export function isNewestStable(existingTags, current) {
  if (current.pre !== null) return false;
  return !existingTags.some((tag) => {
    try {
      const other = parseTag(tag);
      return other.pre === null && compareVersions(other, current) > 0;
    } catch {
      return false;
    }
  });
}

/** Image tag suffixes (the part after the colon) for a release. */
export function imageTags({ parsed, sha, newestStable }) {
  const tags = [parsed.version];
  if (parsed.pre === null) {
    tags.push(`${parsed.major}.${parsed.minor}`);
    if (parsed.major >= 1) tags.push(String(parsed.major)); // the plan: the major tag exists "after 1.0"
    if (newestStable) tags.push('latest');
  }
  tags.push(`sha-${sha.slice(0, 7)}`);
  return tags;
}

/** The most text KinShip keeps for one release's notes or upgrade notes (the in-app reader caps them the same way). */
export const MAX_NOTES_CHARS = 20_000;

/** Cuts text at a line end under the cap and says so. */
export function capText(text, max = MAX_NOTES_CHARS) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lineEnd = cut.lastIndexOf('\n');
  return `${(lineEnd > max / 2 ? cut.slice(0, lineEnd) : cut).trimEnd()}\n\n_(Shortened. Read the rest on the release page.)_`;
}

/**
 * The heading of a release in CHANGELOG.md. Three shapes are understood: `## [1.2.3] - 2026-01-02` (Keep a Changelog, as the
 * file is written today), `## [1.2.3](https://...) (2026-01-02)` (release-please) and `## 1.2.3 (2026-01-02)`.
 * Returns { date } (null when the heading has none) or null when the line is not the heading of this version.
 */
export function matchReleaseHeading(line, version) {
  const escaped = version.replace(/[.+*?^$()[\]{}|\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[?${escaped}\\]?(?:\\([^)]*\\))?(?:\\s+-\\s+(\\S+)|\\s+\\((\\S+)\\))?\\s*$`);
  const match = heading.exec(line);
  if (!match) return null;
  const date = match[1] ?? match[2] ?? null;
  return { date: date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null };
}

/** The text of a release's section up to the next "## " heading, without trailing link definitions. */
export function extractChangelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => matchReleaseHeading(line, version) !== null);
  if (start === -1) throw new Error(`CHANGELOG.md has no section "## [${version}]"`);
  const date = matchReleaseHeading(lines[start], version)?.date ?? null;
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end);
  while (body.length > 0 && /^(\[[^\]]+\]:\s.*)?$/.test(body[body.length - 1] ?? '')) body.pop();
  const text = body.join('\n').trim();
  if (text === '') throw new Error(`The CHANGELOG.md section for ${version} is empty`);
  return { text, date };
}

/** Does the changelog section list anything under "### Security"? */
export function hasSecurityNotes(sectionText) {
  const lines = sectionText.split('\n');
  const start = lines.findIndex((line) => /^### Security\s*$/.test(line));
  if (start === -1) return false;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^### /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim() !== '';
}

/** The "## <version>" section of UPGRADE.md, or null. */
export function extractUpgradeNotes(upgrade, version) {
  if (!upgrade) return null;
  const lines = upgrade.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}` || line.trim().startsWith(`## [${version}]`));
  if (start === -1) return null;
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  const text = lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
  return text === '' ? null : text;
}

/**
 * What changed since the previous release: whether a database migration was added and whether a commit
 * is marked as a breaking change (`feat!:` or a "BREAKING CHANGE:" line). `git` runs a git command.
 */
export function detectChanges(git, previous) {
  if (previous === null) return { migration: false, breaking: false };
  const migration = git(['diff', '--name-only', `${previous}..HEAD`, '--', 'apps/api/migrations']).trim() !== '';
  const log = git(['log', `${previous}..HEAD`, '--format=%B%x00']);
  const breaking = log.split('\0').some((message) => {
    const subject = message.trim().split('\n')[0] ?? '';
    return /^[a-z]+(\([^)]*\))?!:/.test(subject) || /^BREAKING[ -]CHANGE:/m.test(message);
  });
  return { migration, breaking };
}

/**
 * The version a new install gets by default is written in compose.yml (`${KINSHIP_VERSION:-x}`, twice) and in .env.example
 * (`KINSHIP_VERSION=x`). Both must be the version being released, or a release would install the previous one. Throws with
 * what is wrong. (release-please bumps them from the markers next to those lines; this is the check that it did.)
 */
export function checkInstallDefaults(read, version) {
  const problems = [];
  const compose = [...read('compose.yml').matchAll(/\$\{KINSHIP_VERSION:-([^}]*)\}/g)].map((m) => m[1]);
  if (compose.length === 0) problems.push('compose.yml has no ${KINSHIP_VERSION:-<version>} default');
  for (const found of compose) if (found !== version) problems.push(`compose.yml defaults KINSHIP_VERSION to ${found}`);
  const env = [...read('.env.example').matchAll(/^KINSHIP_VERSION=(\S*)\s*$/gm)].map((m) => m[1]);
  if (env.length !== 1) problems.push('.env.example must have exactly one KINSHIP_VERSION= line');
  for (const found of env) if (found !== version) problems.push(`.env.example sets KINSHIP_VERSION=${found}`);
  if (problems.length > 0)
    throw new Error(`The install files do not match version ${version}:\n  ${problems.join('\n  ')}`);
}

/**
 * Works out what a run of the release workflow should do. `env` is GitHub's environment, `read` reads a
 * file in the repository, `tags` lists the existing tags.
 */
export function prepare({ env, read, tags, now = new Date() }) {
  const event = env.GITHUB_EVENT_NAME;
  const refType = env.GITHUB_REF_TYPE;
  const refName = env.GITHUB_REF_NAME;
  const sha = env.GITHUB_SHA ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('GITHUB_SHA is not a full commit hash');

  const versions = Object.fromEntries(PACKAGE_FILES.map((file) => [file, JSON.parse(read(file)).version]));
  const distinct = new Set(Object.values(versions));
  if (distinct.size !== 1) {
    throw new Error(
      `The package.json files disagree about the version:\n${Object.entries(versions)
        .map(([file, version]) => `  ${file}: ${version}`)
        .join('\n')}`,
    );
  }
  const packageVersion = parseVersion([...distinct][0]);
  checkInstallDefaults(read, packageVersion.version);

  let publish;
  if (event === 'push' && refType === 'tag') {
    const fromTag = parseTag(refName);
    if (fromTag.version !== packageVersion.version) {
      throw new Error(
        `The tag ${refName} is version ${fromTag.version}, but package.json says ${packageVersion.version}. Fix one and tag again.`,
      );
    }
    publish = true;
  } else if (event === 'workflow_dispatch') {
    const dryRun = env.DRY_RUN !== 'false';
    if (!dryRun && refType !== 'tag') {
      throw new Error('Publishing is only allowed from a tag. Run it on a tag, or leave "dry run" on.');
    }
    if (!dryRun) {
      const fromTag = parseTag(refName);
      if (fromTag.version !== packageVersion.version) {
        throw new Error(
          `The tag ${refName} is version ${fromTag.version}, but package.json says ${packageVersion.version}.`,
        );
      }
    }
    publish = !dryRun;
  } else if (event === 'pull_request') {
    publish = false; // a rehearsal of the release on a pull request: build and test, push nothing
  } else {
    throw new Error(`Unexpected trigger: ${event} on ${refType} ${refName}`);
  }

  const section = extractChangelogSection(read('CHANGELOG.md'), packageVersion.version);
  const newestStable = isNewestStable(tags, packageVersion);
  const suffixes = imageTags({ parsed: packageVersion, sha, newestStable });
  const tagList = (image) => suffixes.map((suffix) => `${IMAGE_REGISTRY}/${image}:${suffix}`);

  return {
    version: packageVersion.version,
    tag: `v${packageVersion.version}`,
    prerelease: packageVersion.pre !== null,
    publish,
    sha,
    shaShort: sha.slice(0, 7),
    buildDate: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    latest: suffixes.includes('latest'),
    changelogDate: section.date,
    tagSuffixes: suffixes,
    apiTags: tagList('kinship-api'),
    webTags: tagList('kinship-web'),
  };
}

const MANIFEST_KEYS = [
  'version',
  'date',
  'channel',
  'security',
  'breaking',
  'migration',
  'upgradeFrom',
  'notes',
  'upgradeNotes',
];

/**
 * Checks a manifest against the contract the in-app update check reads (packages/shared/src/updates.ts has the same rules).
 * Throws with every problem found.
 */
export function validateManifest(manifest) {
  const problems = [];
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('The manifest is not an object');
  }
  for (const key of Object.keys(manifest)) if (!MANIFEST_KEYS.includes(key)) problems.push(`unknown field "${key}"`);
  const version = (() => {
    try {
      return typeof manifest.version === 'string' && manifest.version.length <= 64
        ? parseVersion(manifest.version)
        : null;
    } catch {
      return null;
    }
  })();
  if (version === null) problems.push('"version" is not a version of at most 64 characters');
  if (typeof manifest.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.date))
    problems.push('"date" is not YYYY-MM-DD');
  if (manifest.channel !== 'stable' && manifest.channel !== 'prerelease')
    problems.push('"channel" is not stable or prerelease');
  else if (version !== null && (manifest.channel === 'stable') !== (version.pre === null)) {
    problems.push('"channel" does not match the version');
  }
  for (const key of ['security', 'breaking', 'migration']) {
    if (typeof manifest[key] !== 'boolean') problems.push(`"${key}" is not true or false`);
  }
  if (manifest.upgradeFrom !== null) {
    try {
      if (typeof manifest.upgradeFrom !== 'string') throw new Error('not text');
      parseVersion(manifest.upgradeFrom);
    } catch {
      problems.push('"upgradeFrom" is neither null nor a version');
    }
  }
  if (typeof manifest.notes !== 'string' || manifest.notes.trim() === '') problems.push('"notes" is empty');
  else if (manifest.notes.length > MAX_NOTES_CHARS + 200) problems.push('"notes" is too long');
  if (manifest.upgradeNotes !== null && typeof manifest.upgradeNotes !== 'string')
    problems.push('"upgradeNotes" is not text or null');
  else if (typeof manifest.upgradeNotes === 'string' && manifest.upgradeNotes.length > MAX_NOTES_CHARS + 200) {
    problems.push('"upgradeNotes" is too long');
  }
  if (problems.length > 0) throw new Error(`Invalid release manifest:\n  ${problems.join('\n  ')}`);
  return manifest;
}

/** The release body and the manifest the in-app update notice will read (from 0.2). */
export function buildNotes({ version, prerelease, read, git, tags }) {
  const parsed = parseVersion(version);
  const section = extractChangelogSection(read('CHANGELOG.md'), version);
  const previous = previousTag(tags, parsed);
  const { migration, breaking } = detectChanges(git, previous);

  const readOptional = (file) => {
    try {
      return read(file);
    } catch {
      return null; // UPGRADE.md only exists once a release needs it
    }
  };
  const upgrade = readOptional('UPGRADE.md');
  const upgradeNotes = extractUpgradeNotes(upgrade, version);
  if (breaking && upgradeNotes === null) {
    throw new Error(
      `This release has breaking changes since ${previous}, but UPGRADE.md has no "## ${version}" section. Write one first.`,
    );
  }

  const images = IMAGES.map((name) => `${IMAGE_REGISTRY}/${name}:${version}`);
  const body = [
    section.text,
    '',
    '---',
    '',
    `Images: \`${images.join('`, `')}\` (linux/amd64 and linux/arm64).`,
    'Install: see [INSTALL.md](https://github.com/officialJCReyes/kinship/blob/main/INSTALL.md). Attached: `compose.yml` and `env.example` (copy it to `.env`) for this release.',
    `Verify the build: \`gh attestation verify oci://${images[0]} --repo officialJCReyes/kinship\`.`,
    '',
  ].join('\n');

  const manifest = {
    version,
    date: section.date ?? new Date().toISOString().slice(0, 10),
    channel: prerelease ? 'prerelease' : 'stable',
    security: hasSecurityNotes(section.text),
    breaking,
    migration,
    upgradeFrom: null,
    notes: capText(section.text),
    upgradeNotes: upgradeNotes === null ? null : capText(upgradeNotes),
  };
  validateManifest(manifest);
  return { body, manifest, previous };
}

// ---- command line ---------------------------------------------------------------------------

const gitIn = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const readFromRepo = (file) => readFileSync(file, 'utf8');
const listTags = () => gitIn(['tag', '--list', 'v*']).split('\n').filter(Boolean);

function setOutput(name, value) {
  const text = String(value);
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`${name}=${text}`);
    return;
  }
  // Multi-line values need a delimiter that cannot appear in them.
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<__KINSHIP_EOF__\n${text}\n__KINSHIP_EOF__\n`);
}

function main() {
  const [command, arg] = process.argv.slice(2);
  try {
    if (command === 'prepare') {
      const info = prepare({ env: process.env, read: readFromRepo, tags: listTags() });
      for (const [key, value] of Object.entries(info)) {
        setOutput(key, Array.isArray(value) ? value.join('\n') : value);
      }
      console.log(JSON.stringify(info, null, 2));
    } else if (command === 'notes' && arg) {
      const version = JSON.parse(readFromRepo('package.json')).version;
      const { body, manifest, previous } = buildNotes({
        version,
        prerelease: parseVersion(version).pre !== null,
        read: readFromRepo,
        git: gitIn,
        tags: listTags().filter((tag) => tag !== `v${version}`),
      });
      mkdirSync(arg, { recursive: true });
      writeFileSync(join(arg, 'release-notes.md'), body);
      writeFileSync(join(arg, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`Compared with the previous tag: ${previous ?? '(none)'}`);
      console.log(
        `Flags: migration=${manifest.migration} breaking=${manifest.breaking} security=${manifest.security}; notes ${manifest.notes.length} characters`,
      );
      console.log(`Wrote ${join(arg, 'release-notes.md')} and ${join(arg, 'release-manifest.json')}`);
    } else if (command === 'validate' && arg) {
      validateManifest(JSON.parse(readFromRepo(arg)));
      console.log(`${arg} is a valid release manifest`);
    } else {
      console.error('Usage: release-info.mjs prepare | notes <output-dir> | validate <manifest.json>');
      process.exitCode = 2;
    }
  } catch (error) {
    // GitHub shows this line as the annotation on the failed step.
    console.error(`::error::${error instanceof Error ? error.message.split('\n').join('%0A') : error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
