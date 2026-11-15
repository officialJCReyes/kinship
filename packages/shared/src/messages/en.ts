// SPDX-License-Identifier: AGPL-3.0-or-later

/** English, the only language at launch. Other languages add a file with the same keys. */
export const en = {
  'app.name': 'KinShip',
  'app.skipToContent': 'Skip to content',
  'nav.main': 'Main',
  'nav.about': 'About',

  'about.title': 'About KinShip',
  'about.webVersion': 'Web version',
  'about.apiVersion': 'API version',
  'about.build': 'Build',
  'about.license': 'License',
  'about.sourceCode': 'Source code',
  'about.freeSoftware':
    'KinShip is free software. You may run, study, change and share it. If you run a modified version for other people, you must offer them its source code.',
  'about.status': 'Status',
  'about.status.ok': 'The API and the database are running.',
  'about.status.databaseDown': 'The API is running but cannot reach the database.',
  'about.status.apiDown': 'Cannot reach the API.',
  'about.status.checking': 'Checking…',
  'about.loading': 'Loading…',
  'about.loadError': 'Could not load the version of the API.',
  'about.unknown': 'unknown',

  'notFound.title': 'Page not found',
  'notFound.body': 'There is nothing at this address.',
  'notFound.back': 'Go to About',
} as const;

export type MessageKey = keyof typeof en;
