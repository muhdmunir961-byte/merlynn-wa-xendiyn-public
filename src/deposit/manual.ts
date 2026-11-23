import { randomUUID } from 'node:crypto';
import type { ManualDepositService as ManualDepositContract } from '../plugins/interfaces.js';
import { JsonStore, type ManualDepositRecord } from '../persistence/json-store.js';

export interface ManualDepositResult {
  id: string;
  requesterJid: string;
  amount: number;
  status: ManualDepositRecord['status'];
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
}

const copy = (deposit: ManualDepositRecord): ManualDepositResult => ({ ...deposit });

export class ManualDepositService implements ManualDepositContract {
  constructor(private readonly store: JsonStore) {}

  async createRequest(input: { requesterJid: string; amount: number }): Promise<{ id: string; status: 'pending' }> {
    if (!input.requesterJid.trim()) throw new Error('requesterJid is required');
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('amount must be a positive number');
    const deposit: ManualDepositRecord = {
      id: randomUUID(),
      requesterJid: input.requesterJid,
      amount: input.amount,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    await this.store.saveManualDeposit(deposit);
    return { id: deposit.id, status: 'pending' };
  }

  listPending(): ManualDepositResult[] {
    return this.store.listManualDeposits().filter((deposit) => deposit.status === 'pending').map(copy);
  }

  get(id: string): ManualDepositResult | undefined {
    const deposit = this.store.getManualDeposit(id);
    return deposit ? copy(deposit) : undefined;
  }

  async approve(id: string, ownerJid: string): Promise<ManualDepositResult> {
    return this.review(id, ownerJid, 'approved');
  }

  async reject(id: string, ownerJid: string, reason?: string): Promise<ManualDepositResult> {
    return this.review(id, ownerJid, 'rejected', reason);
  }

  // Explicit aliases make call sites read clearly when invoked from owner-only commands.
  async ownerApprove(id: string, ownerJid: string): Promise<ManualDepositResult> {
    return this.approve(id, ownerJid);
  }

  async ownerReject(id: string, ownerJid: string, reason?: string): Promise<ManualDepositResult> {
    return this.reject(id, ownerJid, reason);
  }

  private async review(
    id: string,
    ownerJid: string,
    status: 'approved' | 'rejected',
    reason?: string
  ): Promise<ManualDepositResult> {
    if (!ownerJid.trim()) throw new Error('ownerJid is required');
    const existing = this.store.getManualDeposit(id);
    if (!existing) throw new Error(`Manual deposit ${id} was not found`);
    if (existing.status !== 'pending') throw new Error(`Manual deposit ${id} is already ${existing.status}`);
    const reviewed: ManualDepositRecord = {
      ...existing,
      status,
      reviewedAt: new Date().toISOString(),
      reviewedBy: ownerJid,
      ...(status === 'rejected' && reason ? { rejectionReason: reason } : {})
    };
    await this.store.saveManualDeposit(reviewed);
    return copy(reviewed);
  }
}
