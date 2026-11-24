import { dirname } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

export interface ManualDepositRecord {
  id: string;
  requesterJid: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
}

export interface BotState {
  owners: Record<string, { jid: string; claimedAt: string }>;
  manualDeposits: Record<string, ManualDepositRecord>;
  languages?: Record<string, string>;
}

const emptyState = (): BotState => ({ owners: {}, manualDeposits: {}, languages: {} });

export class JsonStore {
  private state: BotState = emptyState();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<BotState>;
      this.state = {
        owners: parsed.owners ?? {},
        manualDeposits: parsed.manualDeposits ?? {},
        languages: parsed.languages ?? {}
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = emptyState();
      await this.persist();
    }
  }

  getOwner(groupJid: string): BotState['owners'][string] | undefined {
    return this.state.owners[groupJid];
  }

  listOwners(): Array<BotState['owners'][string]> {
    return Object.values(this.state.owners);
  }

  ownerGroups(): string[] {
    return Object.keys(this.state.owners);
  }

  getManualDeposit(id: string): ManualDepositRecord | undefined {
    return this.state.manualDeposits[id];
  }

  listManualDeposits(): ManualDepositRecord[] {
    return Object.values(this.state.manualDeposits);
  }

  async saveManualDeposit(deposit: ManualDepositRecord): Promise<void> {
    this.state.manualDeposits[deposit.id] = deposit;
    await this.persist();
  }

  async claimOwner(groupJid: string, jid: string): Promise<boolean> {
    if (this.state.owners[groupJid]) return false;
    this.state.owners[groupJid] = { jid, claimedAt: new Date().toISOString() };
    await this.persist();
    return true;
  }

  getLanguage(jid: string): string | undefined {
    return this.state.languages?.[jid];
  }

  listLanguages(): Record<string, string> {
    return this.state.languages ?? {};
  }

  async setLanguage(jid: string, lang: string | null): Promise<void> {
    const languages = this.state.languages ?? {};
    if (lang) languages[jid] = lang;
    else delete languages[jid];
    this.state.languages = languages;
    await this.persist();
  }

  private async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      await rename(temporary, this.filePath);
    });
    return this.writeChain;
  }
}
