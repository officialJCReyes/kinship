// SPDX-License-Identifier: AGPL-3.0-or-later

/** English, the only language at launch. Other languages add a file with the same keys. */
export const en = {
  'app.name': 'KinShip',
  'app.skipToContent': 'Skip to content',
  'nav.main': 'Main',
  'nav.about': 'About',
  'nav.home': 'Home',

  'account.signedInAs': 'Signed in as {name}',
  'account.signOut': 'Sign out',
  'account.signingOut': 'Signing out…',

  'common.loading': 'Loading…',
  'common.unexpectedError': 'Something went wrong. Please try again.',
  'common.cannotReachApi': 'Cannot reach the server. Check your connection and try again.',

  'home.welcome': 'Welcome, {name}',
  'home.tree': 'You are signed in to {tree}.',
  'home.treeUnnamed': 'You are signed in.',
  'home.comingNext': 'The family tree is coming next.',

  'login.title': 'Sign in',
  'login.subtitle': 'Sign in to your family tree.',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.invalidCredentials': 'The email or password is not correct.',
  'login.rateLimited': 'Too many attempts. Try again in {minutes} minute(s).',
  'login.forgot': 'Forgot your password? Ask the person who runs this server to set a new one.',
  'login.footer': 'KinShip {version}',

  'setup.title': 'Welcome to KinShip',
  'setup.intro': 'No accounts exist yet. Create the SuperAdmin account, then start your first family tree.',
  'setup.tokenLabel': 'Setup token',
  'setup.tokenHelp':
    'KinShip printed a one-time token in its log when it started. Find it with: docker compose logs api',
  'setup.displayName': 'Your name',
  'setup.email': 'Email',
  'setup.password': 'Password',
  'setup.passwordHelp': 'At least {min} characters.',
  'setup.confirmPassword': 'Confirm password',
  'setup.treeName': 'Name your first tree',
  'setup.treeNameHelp': 'Most families use their surname, like Hale Family. You can rename it later.',
  'setup.submit': 'Create account and continue',
  'setup.submitting': 'Creating account…',
  'setup.passwordTooShort': 'The password must be at least {min} characters.',
  'setup.passwordMismatch': 'The two passwords are not the same.',
  'setup.invalidEmail': 'Enter a valid email address.',
  'setup.invalidToken': 'That setup token is not right. Check the log of the api container.',
  'setup.alreadyDone': 'KinShip is already set up. Sign in instead.',
  'setup.rateLimited': 'Too many attempts. Try again in {minutes} minute(s).',
  'setup.neverAgain': 'This screen never appears again once an account exists.',
  'setup.goToLogin': 'Go to sign in',

  'about.title': 'About KinShip',
  'about.webVersion': 'Web version',
  'about.apiVersion': 'API version',
  'about.schema': 'Database schema',
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
