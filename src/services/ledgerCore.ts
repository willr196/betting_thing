import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { AppError } from '../utils/index.js';
import type { BalanceCheck } from '../types/index.js';

export type LedgerEntryBase = {
  userId: string;
  amount: number;
  type: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
};

export type LedgerHistoryOptions<TType extends string> = {
  limit?: number;
  offset?: number;
  types?: TType[];
};

type LedgerAdapter<TEntry extends LedgerEntryBase, TTxn, TType extends string> = {
  getUserBalanceForUpdate: (
    tx: Prisma.TransactionClient,
    userId: string
  ) => Promise<number | null>;
  updateUserBalance: (
    tx: Prisma.TransactionClient,
    userId: string,
    newBalance: number
  ) => Promise<void>;
  createTransaction: (
    tx: Prisma.TransactionClient,
    entry: TEntry,
    newBalance: number
  ) => Promise<{ id: string }>;
  getCachedBalance: (userId: string) => Promise<number | null>;
  aggregateBalance: (userId: string) => Promise<number | null>;
  listTransactions: (
    userId: string,
    options: { limit: number; offset: number; types?: TType[] }
  ) => Promise<TTxn[]>;
  countTransactions: (userId: string, options: { types?: TType[] }) => Promise<number>;
};

export function createLedgerService<
  TEntry extends LedgerEntryBase,
  TTxn,
  TType extends string
>(adapter: LedgerAdapter<TEntry, TTxn, TType>) {
  async function executeAtomicChange(
    client: Prisma.TransactionClient,
    entry: TEntry
  ): Promise<{ transactionId: string; newBalance: number }> {
    const currentBalance = await adapter.getUserBalanceForUpdate(client, entry.userId);

    if (currentBalance === null) {
      throw AppError.notFound('User');
    }

    const newBalance = currentBalance + entry.amount;
    if (newBalance < 0) {
      throw AppError.insufficientBalance(Math.abs(entry.amount), currentBalance);
    }

    const transaction = await adapter.createTransaction(client, entry, newBalance);
    await adapter.updateUserBalance(client, entry.userId, newBalance);

    return { transactionId: transaction.id, newBalance };
  }

  async function credit(
    entry: TEntry,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    if (entry.amount <= 0) {
      throw AppError.badRequest('Credit amount must be positive');
    }

    // PURCHASE is reserved for a future real-money flow that requires regulatory
    // review. Reject it at the ledger level to prevent accidental misuse.
    if (entry.type === 'PURCHASE') {
      throw AppError.forbidden('PURCHASE transactions are not supported');
    }

    if (tx) {
      return executeAtomicChange(tx, entry);
    }

    return prisma.$transaction(async (client) => executeAtomicChange(client, entry));
  }

  async function debit(
    entry: TEntry,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    const debitEntry = {
      ...entry,
      amount: entry.amount > 0 ? -entry.amount : entry.amount,
    } as TEntry;

    if (tx) {
      return executeAtomicChange(tx, debitEntry);
    }

    return prisma.$transaction(async (client) => executeAtomicChange(client, debitEntry));
  }

  async function getBalance(userId: string): Promise<{ cached: number; calculated: number }> {
    const [cached, calculated] = await Promise.all([
      adapter.getCachedBalance(userId),
      adapter.aggregateBalance(userId),
    ]);

    if (cached === null) {
      throw AppError.notFound('User');
    }

    return {
      cached,
      calculated: calculated ?? 0,
    };
  }

  async function verifyBalance(userId: string): Promise<BalanceCheck> {
    const { cached, calculated } = await getBalance(userId);

    return {
      userId,
      cachedBalance: cached,
      calculatedBalance: calculated,
      isValid: cached === calculated,
      discrepancy: cached - calculated,
    };
  }

  async function getHistory(
    userId: string,
    options: LedgerHistoryOptions<TType> = {}
  ): Promise<{ transactions: TTxn[]; total: number }> {
    const { limit = 50, offset = 0, types } = options;

    const [transactions, total] = await Promise.all([
      adapter.listTransactions(userId, { limit, offset, types }),
      adapter.countTransactions(userId, { types }),
    ]);

    return { transactions, total };
  }

  return {
    credit,
    debit,
    getBalance,
    verifyBalance,
    getHistory,
  };
}
