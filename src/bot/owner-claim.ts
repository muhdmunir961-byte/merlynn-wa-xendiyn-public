import type { GroupMetadata } from '@whiskeysockets/baileys';
import { JsonStore } from '../persistence/json-store.js';

export async function claimGroupOwner(
  store: JsonStore,
  metadata: GroupMetadata,
  senderJid: string
): Promise<string> {
  const sender = metadata.participants.find((participant) => participant.id === senderJid);
  if (!sender || (sender.admin !== 'admin' && sender.admin !== 'superadmin')) {
    return 'Only a current group admin can claim ownership.';
  }
  if (store.getOwner(metadata.id)) return 'This group already has an owner.';
  const claimed = await store.claimOwner(metadata.id, senderJid);
  return claimed ? 'Owner claimed for this group.' : 'This group already has an owner.';
}
