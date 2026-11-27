// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The two real transports against local fakes: Resend's API (a local HTTP server) and SMTP (a local SMTP server in plain,
// STARTTLS and TLS modes). No real provider is ever contacted.
import { beforeAll, describe, expect, it } from 'vitest';
import { createResendTransport, RESEND_ENDPOINT } from '../src/mail/resend.js';
import { createSmtpTransport } from '../src/mail/smtp.js';
import { MailSendError } from '../src/mail/transport.js';
import type { OutgoingMail } from '../src/mail/transport.js';
import { selfSignedCertificate, startFakeHttp, startFakeSmtp } from './helpers/fake-mail.js';

const mail: OutgoingMail = {
  id: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  from: 'Hale Family Tree <tree@hale.example>',
  to: 'daniel@hale.example',
  subject: 'KinShip test email',
  text: 'Hello Daniel,\n\nThis is a test.',
  html: '<p>Hello Daniel,</p>',
};

async function failure(promise: Promise<unknown>): Promise<MailSendError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MailSendError);
    return error as MailSendError;
  }
  throw new Error('expected the send to fail');
}

describe('Resend', () => {
  it('posts to the fixed Resend address by default', () => {
    expect(RESEND_ENDPOINT).toBe('https://api.resend.com/emails');
  });

  it('sends one JSON request with the key as a bearer token and the outbox id as the idempotency key', async () => {
    const server = await startFakeHttp((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"re-msg-1"}');
    });
    try {
      const transport = createResendTransport({ apiKey: 're_test_key_123456', endpoint: server.url });
      expect(await transport.send(mail)).toEqual({ providerId: 're-msg-1' });
      const [request] = server.requests;
      expect(request?.method).toBe('POST');
      expect(request?.headers['authorization']).toBe('Bearer re_test_key_123456');
      expect(request?.headers['idempotency-key']).toBe(mail.id);
      expect(JSON.parse(request?.body ?? '')).toEqual({
        from: mail.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: { 'Auto-Submitted': 'auto-generated' },
      });
    } finally {
      await server.close();
    }
  });

  it.each([
    [400, true],
    [422, true],
    [401, false],
    [403, false],
    [429, false],
    [500, false],
    [503, false],
  ])('an answer %i is permanent only for a malformed request (permanent: %s)', async (status, permanent) => {
    const server = await startFakeHttp((_req, res) => {
      res
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify({ name: 'validation_error', message: 'The hale.example domain is not verified.' }));
    });
    try {
      const transport = createResendTransport({ apiKey: 're_test_key_123456', endpoint: server.url });
      const error = await failure(transport.send(mail));
      expect(error.permanent).toBe(permanent);
      expect(error.message).toBe(
        `Resend answered ${status}: validation_error: The hale.example domain is not verified.`,
      );
    } finally {
      await server.close();
    }
  });

  it('does not follow a redirect', async () => {
    const server = await startFakeHttp((_req, res) => {
      res.writeHead(307, { location: 'http://127.0.0.1:9/elsewhere' }).end();
    });
    try {
      const transport = createResendTransport({ apiKey: 're_test_key_123456', endpoint: server.url });
      const error = await failure(transport.send(mail));
      expect(error.permanent).toBe(false);
      expect(error.message).toMatch(/^Could not reach Resend/);
      expect(server.requests).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('gives up after its time limit, as a temporary failure', async () => {
    const server = await startFakeHttp(() => {
      /* never answers */
    });
    try {
      const transport = createResendTransport({ apiKey: 're_test_key_123456', endpoint: server.url, timeoutMs: 200 });
      const error = await failure(transport.send(mail));
      expect(error).toMatchObject({ permanent: false, message: 'Could not reach Resend: timed out' });
    } finally {
      await server.close();
    }
  });

  it('reports a refused connection as temporary', async () => {
    const transport = createResendTransport({ apiKey: 're_test_key_123456', endpoint: 'http://127.0.0.1:9/emails' });
    const error = await failure(transport.send(mail));
    expect(error.permanent).toBe(false);
    expect(error.message).toMatch(/^Could not reach Resend: /);
  });
});

describe('SMTP', () => {
  let certificate: { key: string; cert: string };
  beforeAll(() => {
    certificate = selfSignedCertificate();
  });

  it('sends over STARTTLS with a password, and the password never crosses the network in clear', async () => {
    const server = await startFakeSmtp({
      mode: 'starttls',
      certificate,
      auth: { user: 'tree@hale.example', password: 'smtp-secret-password' },
    });
    try {
      const transport = createSmtpTransport({
        host: 'localhost',
        port: server.port,
        security: 'starttls',
        user: 'tree@hale.example',
        password: 'smtp-secret-password',
        ca: certificate.cert,
      });
      const result = await transport.send(mail);
      expect(result.providerId).toMatch(/^<.+>$/);
      expect(server.received).toHaveLength(1);
      const received = server.received[0]!;
      expect(received).toMatchObject({ from: 'tree@hale.example', to: ['daniel@hale.example'], tls: true });
      expect(received.user).toBe('tree@hale.example');
      expect(received.data).toContain('Subject: KinShip test email');
      expect(received.data).toContain('From: Hale Family Tree <tree@hale.example>');
      expect(received.data).toContain('Auto-Submitted: auto-generated');
      expect(server.plainLines.some((line) => line.startsWith('AUTH'))).toBe(false);
      expect(server.plainLines.join('\n')).not.toContain(Buffer.from('smtp-secret-password').toString('base64'));
    } finally {
      await server.close();
    }
  });

  it('sends over TLS from the first byte', async () => {
    const server = await startFakeSmtp({ mode: 'tls', certificate });
    try {
      const transport = createSmtpTransport({
        host: 'localhost',
        port: server.port,
        security: 'tls',
        user: undefined,
        password: undefined,
        ca: certificate.cert,
      });
      await transport.send(mail);
      expect(server.received[0]?.tls).toBe(true);
      expect(server.plainLines).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('sends without encryption only when told to (a local relay, no password)', async () => {
    const server = await startFakeSmtp({ mode: 'plain' });
    try {
      const transport = createSmtpTransport({
        host: '127.0.0.1',
        port: server.port,
        security: 'none',
        user: undefined,
        password: undefined,
      });
      await transport.send(mail);
      expect(server.received[0]?.tls).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('refuses to send when STARTTLS is required and the server does not offer it', async () => {
    const server = await startFakeSmtp({ mode: 'plain' });
    try {
      const transport = createSmtpTransport({
        host: '127.0.0.1',
        port: server.port,
        security: 'starttls',
        user: undefined,
        password: undefined,
      });
      const error = await failure(transport.send(mail));
      expect(error.permanent).toBe(false);
      expect(server.received).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('refuses a certificate it cannot trust (checks are always on)', async () => {
    const server = await startFakeSmtp({ mode: 'starttls', certificate });
    try {
      const transport = createSmtpTransport({
        host: 'localhost',
        port: server.port,
        security: 'starttls',
        user: undefined,
        password: undefined,
      });
      const error = await failure(transport.send(mail));
      expect(error.permanent).toBe(false);
      expect(error.message).toMatch(/certificate/i);
      expect(server.received).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('treats a refused sign-in as temporary (a setting to fix) and a refused recipient as permanent', async () => {
    const server = await startFakeSmtp({
      mode: 'starttls',
      certificate,
      auth: { user: 'tree@hale.example', password: 'right-password' },
      reject: ['nobody@hale.example'],
    });
    try {
      const base = {
        host: 'localhost',
        port: server.port,
        security: 'starttls' as const,
        user: 'tree@hale.example',
        ca: certificate.cert,
      };
      const wrong = await failure(createSmtpTransport({ ...base, password: 'wrong-password' }).send(mail));
      expect(wrong.permanent).toBe(false);
      expect(wrong.message).toMatch(/^SMTP EAUTH 535/);
      const refused = await failure(
        createSmtpTransport({ ...base, password: 'right-password' }).send({ ...mail, to: 'nobody@hale.example' }),
      );
      expect(refused.permanent).toBe(true);
      expect(refused.message).toMatch(/^SMTP \w+ 550/);
    } finally {
      await server.close();
    }
  });

  it('reports a server that is not there as temporary', async () => {
    const transport = createSmtpTransport({
      host: '127.0.0.1',
      port: 9,
      security: 'none',
      user: undefined,
      password: undefined,
      timeoutMs: 500,
    });
    const error = await failure(transport.send(mail));
    expect(error.permanent).toBe(false);
    expect(error.message).toMatch(/ECONNECTION|ECONNREFUSED/);
  });
});
