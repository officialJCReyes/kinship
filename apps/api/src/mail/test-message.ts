// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The "Send test to me" email: fixed text, no link that does anything, nothing about the family. Step 53b moves it into the
// shared email layout with the other templates.
import { escapeHtml } from './html.js';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function renderTestMail(facts: { recipientName: string; publicUrl: string; provider: string }): RenderedMail {
  const lines = [
    `Hello ${facts.recipientName},`,
    '',
    `This is a test email from KinShip at ${facts.publicUrl}. If you can read it, email works: invitations and password resets can be sent by email.`,
    '',
    `You asked for it on the Storage & email page in Admin. It was sent through ${facts.provider}.`,
    '',
    'There is nothing to do. You can delete this email.',
  ];
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KinShip test email</title></head>',
    '<body style="margin:0;padding:24px;background-color:#F6F4EC;font-family:Arial,Helvetica,sans-serif;color:#17231F;">',
    ...lines
      .filter((line) => line !== '')
      .map((line) => `<p style="margin:0 0 16px 0;font-size:16px;line-height:24px;">${escapeHtml(line)}</p>`),
    '</body></html>',
  ].join('');
  return { subject: 'KinShip test email', text: lines.join('\n'), html };
}
