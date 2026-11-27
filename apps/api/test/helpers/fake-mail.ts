// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fakes for email tests. Nothing here ever contacts a real provider:
//   * memoryTransport: a MailTransport that keeps what it was given, and can be told to fail.
//   * startFakeSmtp: a tiny SMTP server on 127.0.0.1 (plain, STARTTLS or TLS from the first byte, AUTH PLAIN), enough for
//     nodemailer, with a self-signed certificate made at test time (no key is committed).
//   * startFakeHttp: a local HTTP server standing in for Resend's API.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TLSSocket, createSecureContext } from 'node:tls';
import { MailSendError } from '../../src/mail/transport.js';
import type { MailTransport, OutgoingMail } from '../../src/mail/transport.js';

export interface MemoryTransport extends MailTransport {
  sent: OutgoingMail[];
  /** The next sends fail with these errors, in order (then sends work again). */
  failNext(...errors: MailSendError[]): void;
}

export function memoryTransport(): MemoryTransport {
  const queue: MailSendError[] = [];
  const sent: OutgoingMail[] = [];
  return {
    provider: 'fake',
    sent,
    failNext(...errors) {
      queue.push(...errors);
    },
    async send(mail) {
      const error = queue.shift();
      if (error) throw error;
      sent.push(mail);
      return { providerId: `fake-${sent.length}` };
    },
  };
}

export const temporary = (message = 'SMTP ECONNECTION: connect ECONNREFUSED 127.0.0.1:25') =>
  new MailSendError(message, false);
export const permanent = (message = 'SMTP EENVELOPE 550: mailbox unavailable') => new MailSendError(message, true);

/** A self-signed certificate for localhost and 127.0.0.1, made with openssl in a temporary folder. */
export function selfSignedCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-cert-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    return { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert: readFileSync(join(dir, 'cert.pem'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface ReceivedMail {
  from: string;
  to: string[];
  data: string;
  /** Was the connection encrypted when the message was sent? */
  tls: boolean;
  /** The user name that signed in, or null. */
  user: string | null;
}

export interface FakeSmtpOptions {
  mode: 'plain' | 'starttls' | 'tls';
  /** Required for starttls and tls. */
  certificate?: { key: string; cert: string };
  /** A user name and password that sign in; without it AUTH is not offered. */
  auth?: { user: string; password: string };
  /** Recipients answered with 550. */
  reject?: string[];
}

export interface FakeSmtp {
  port: number;
  received: ReceivedMail[];
  /** Every line a client sent, for checking that nothing secret travelled unencrypted. */
  plainLines: string[];
  close(): Promise<void>;
}

export async function startFakeSmtp(options: FakeSmtpOptions): Promise<FakeSmtp> {
  const received: ReceivedMail[] = [];
  const plainLines: string[] = [];
  const context = options.certificate ? createSecureContext(options.certificate) : undefined;
  const sockets = new Set<Socket>();

  function session(socket: Socket, encrypted: boolean, greet: boolean): void {
    let buffer = '';
    let user: string | null = null;
    let from = '';
    let to: string[] = [];
    let inData = false;
    let data = '';
    let authWaiting = false;
    const say = (line: string) => socket.write(`${line}\r\n`);
    if (greet) say('220 fake.test ESMTP');

    const plainAuth = (b64: string) => {
      const parts = Buffer.from(b64, 'base64').toString('utf8').split('\u0000');
      const [, name = '', pass = ''] = parts;
      if (options.auth && name === options.auth.user && pass === options.auth.password) {
        user = name;
        say('235 2.7.0 Authentication successful');
      } else {
        say('535 5.7.8 Authentication credentials invalid');
      }
    };

    const onLine = (line: string) => {
      if (!encrypted) plainLines.push(line);
      if (inData) {
        if (line === '.') {
          inData = false;
          received.push({ from, to, data, tls: encrypted, user });
          from = '';
          to = [];
          data = '';
          say('250 2.0.0 queued as fake');
        } else {
          data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
        }
        return;
      }
      if (authWaiting) {
        authWaiting = false;
        plainAuth(line);
        return;
      }
      const verb = line.split(' ')[0]?.toUpperCase() ?? '';
      if (verb === 'EHLO' || verb === 'HELO') {
        const lines = ['250-fake.test'];
        if (options.mode === 'starttls' && !encrypted) lines.push('250-STARTTLS');
        if (options.auth) lines.push('250-AUTH PLAIN');
        lines.push('250 8BITMIME');
        socket.write(`${lines.join('\r\n')}\r\n`);
      } else if (verb === 'STARTTLS' && options.mode === 'starttls' && !encrypted && context) {
        say('220 2.0.0 Ready to start TLS');
        socket.removeAllListeners('data');
        const secure = new TLSSocket(socket, { isServer: true, secureContext: context });
        sockets.add(secure);
        session(secure, true, false);
      } else if (verb === 'AUTH') {
        const [, mech = '', initial] = line.split(' ');
        if (!options.auth || mech.toUpperCase() !== 'PLAIN') say('504 5.5.4 Unrecognized authentication type');
        else if (initial) plainAuth(initial);
        else {
          authWaiting = true;
          say('334 ');
        }
      } else if (verb === 'MAIL') {
        from = /<([^>]*)>/.exec(line)?.[1] ?? '';
        say('250 2.1.0 OK');
      } else if (verb === 'RCPT') {
        const address = /<([^>]*)>/.exec(line)?.[1] ?? '';
        if (options.reject?.includes(address)) say('550 5.1.1 Mailbox unavailable');
        else {
          to.push(address);
          say('250 2.1.5 OK');
        }
      } else if (verb === 'DATA') {
        inData = true;
        say('354 End data with <CR><LF>.<CR><LF>');
      } else if (verb === 'RSET') {
        from = '';
        to = [];
        say('250 2.0.0 OK');
      } else if (verb === 'QUIT') {
        say('221 2.0.0 Bye');
        socket.end();
      } else if (verb === 'NOOP') {
        say('250 2.0.0 OK');
      } else {
        say('502 5.5.2 Command not recognized');
      }
    };

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        onLine(line);
      }
    });
    socket.on('error', () => undefined);
  }

  const server = createNetServer((raw) => {
    sockets.add(raw);
    raw.on('close', () => sockets.delete(raw));
    if (options.mode === 'tls' && context) {
      const secure = new TLSSocket(raw, { isServer: true, secureContext: context });
      sockets.add(secure);
      session(secure, true, true);
    } else {
      session(raw, false, true);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    received,
    plainLines,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface FakeHttpRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface FakeHttp {
  url: string;
  requests: FakeHttpRequest[];
  close(): Promise<void>;
}

/** A local HTTP server; `answer` decides each response. */
export async function startFakeHttp(
  answer: (request: FakeHttpRequest, response: ServerResponse) => void,
): Promise<FakeHttp> {
  const requests: FakeHttpRequest[] = [];
  const server = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      const request = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      requests.push(request);
      answer(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/emails`,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
