import { ImapFlow } from 'imapflow';

/**
 * Test an IMAP connection with TLS.
 * Returns the connected client on success; caller must call logout().
 * Throws on auth/connection failure.
 */
export async function connectIMAP(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<ImapFlow> {
  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: username, pass: password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });

  await client.connect();
  return client;
}
