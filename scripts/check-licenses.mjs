// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dependency license check. Every installed package (dependencies and dev
// dependencies, direct and transitive) must carry a license on the allow list
// below; anything else fails the check, so a new license is a decision a person
// makes (add it here, with a reason in the pull request), never an accident.
//
// Writes reports/licenses.json and reports/licenses.txt (CI uploads them as an
// artifact). Needs `pnpm install` to have run. Usage: node scripts/check-licenses.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Licenses compatible with AGPL-3.0-or-later (decided by JC, 2026-11-15).
export const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'MPL-2.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'CC0-1.0',
]);

/**
 * Named exceptions (decided by JC, 2026-11-15). An exception only applies to
 * the exact package, the exact license and the scope listed, so it cannot
 * quietly cover a different package, a new license, or a production use.
 */
export const EXCEPTIONS = [
  {
    name: 'caniuse-lite',
    license: 'CC-BY-4.0',
    scope: 'development',
    reason:
      'Browser-support data used only by build and lint tooling (via eslint-plugin-react-hooks, babel, browserslist). Not part of any shipped file.',
  },
];

// sharp's prebuilt libvips (decided by JC, step 37c). One package per platform, only the matching one is ever installed.
// LGPL-3.0-or-later is compatible with AGPL-3.0-or-later. libvips is a separate shared library file next to sharp's native
// addon, loaded at run time, never copied into KinShip's code, so anyone can replace it (ADR 0034). Production scope only
// for the image pipeline; development scope covers the docs build (Astro), which installs the same file.
const LIBVIPS_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm',
  'linux-arm64',
  'linux-ppc64',
  'linux-riscv64',
  'linux-s390x',
  'linux-x64',
  'linuxmusl-arm64',
  'linuxmusl-x64',
];
for (const platform of LIBVIPS_PLATFORMS)
  for (const scope of ['production', 'development'])
    EXCEPTIONS.push({
      name: `@img/sharp-libvips-${platform}`,
      license: 'LGPL-3.0-or-later',
      scope,
      reason:
        'libvips for sharp (the photo pipeline). A separate shared library loaded at run time, not part of KinShip\u2019s code, and replaceable. LGPL-3.0 is compatible with AGPL-3.0 (ADR 0034).',
    });

export function exceptionFor(row) {
  return EXCEPTIONS.find((e) => e.name === row.name && e.license === row.license && e.scope === row.scope);
}

/**
 * Is an SPDX license expression acceptable? "A OR B" needs one allowed side,
 * "A AND B" needs both, parentheses group. Anything we cannot read (a "WITH"
 * exception, a made-up name, "UNKNOWN") is not acceptable.
 */
export function isAllowed(expression, allowed = ALLOWED) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function parseOr() {
    let result = parseAnd();
    while (peek() === 'OR') {
      take();
      const right = parseAnd();
      result = result || right;
    }
    return result;
  }
  function parseAnd() {
    let result = parseAtom();
    while (peek() === 'AND') {
      take();
      const right = parseAtom();
      result = result && right;
    }
    return result;
  }
  function parseAtom() {
    const token = take();
    if (token === undefined) return false;
    if (token === '(') {
      const inner = parseOr();
      if (take() !== ')') return false;
      return inner;
    }
    if (token === ')' || token === 'OR' || token === 'AND' || token === 'WITH') return false;
    if (peek() === 'WITH') {
      take();
      take();
      return false; // license exceptions need a human decision
    }
    return allowed.has(token);
  }

  const result = parseOr();
  return position === tokens.length && result;
}

function pnpm(args) {
  const execPath = process.env.npm_execpath;
  const [command, prefix] =
    execPath && /\.(c|m)?js$/.test(execPath) ? [process.execPath, [execPath]] : [execPath || 'pnpm', []];
  return JSON.parse(
    execFileSync(command, [...prefix, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  );
}

function flatten(byLicense) {
  const rows = [];
  for (const [license, packages] of Object.entries(byLicense)) {
    for (const pkg of packages) {
      for (const version of pkg.versions) rows.push({ name: pkg.name, version, license });
    }
  }
  return rows;
}

function main() {
  const all = flatten(pnpm(['-r', 'licenses', 'list', '--json']));
  const shipped = new Set(
    flatten(pnpm(['-r', '--prod', 'licenses', 'list', '--json'])).map((r) => `${r.name}@${r.version}`),
  );

  const rows = all
    .map((row) => {
      const scope = shipped.has(`${row.name}@${row.version}`) ? 'production' : 'development';
      const exception = exceptionFor({ ...row, scope });
      return {
        ...row,
        scope,
        allowed: isAllowed(row.license) || exception !== undefined,
        ...(exception ? { exception: exception.reason } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const rejected = rows.filter((row) => !row.allowed);

  const counts = {};
  for (const row of rows) counts[row.license] = (counts[row.license] ?? 0) + 1;

  const summary = {
    checkedAt: new Date().toISOString(),
    allowList: [...ALLOWED].sort(),
    packages: rows.length,
    production: rows.filter((r) => r.scope === 'production').length,
    byLicense: counts,
    rejected: rejected.length,
  };

  const text = [
    `Dependency license check: ${rows.length} packages (${summary.production} production, ${rows.length - summary.production} development)`,
    `Allow list: ${summary.allowList.join(', ')}`,
    '',
    'Packages by license:',
    ...Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([license, n]) => `  ${String(n).padStart(4)}  ${license}`),
    '',
    ...(rows.some((r) => r.exception)
      ? [
          'Exceptions used (see EXCEPTIONS in scripts/check-licenses.mjs):',
          ...rows
            .filter((r) => r.exception)
            .map((r) => `  ${r.name}@${r.version}  ${r.license}  (${r.scope}): ${r.exception}`),
          '',
        ]
      : []),
    rejected.length === 0
      ? 'Result: PASS, every package has an allowed license.'
      : `Result: FAIL, ${rejected.length} package(s) without an allowed license:\n${rejected.map((r) => `  ${r.name}@${r.version}  ${r.license}  (${r.scope})`).join('\n')}`,
    '',
    'All packages:',
    ...rows.map((r) => `  ${r.allowed ? 'ok  ' : 'FAIL'} ${r.name}@${r.version}  ${r.license}  (${r.scope})`),
    '',
  ].join('\n');

  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/licenses.json', `${JSON.stringify({ summary, packages: rows }, null, 2)}\n`);
  writeFileSync('reports/licenses.txt', text);

  console.log(text.split('\nAll packages:')[0]);
  if (rejected.length > 0) process.exit(1);
}

// Run only when executed directly (the test imports isAllowed).
if (import.meta.url === `file://${process.argv[1]}`) main();
