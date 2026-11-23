import { mkdir } from 'node:fs/promises';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import type { AuthenticationState } from '@whiskeysockets/baileys';

export async function loadAuth(authDir: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  await mkdir(authDir, { recursive: true });
  return useMultiFileAuthState(authDir);
}

