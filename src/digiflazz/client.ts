import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { DigiflazzProvider } from '../plugins/interfaces.js';

const DEFAULT_BASE_URL = 'https://api.digiflazz.com/v1';

type JsonObject = Record<string, unknown>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface DigiflazzClientOptions {
  username: string;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export interface PriceListItem {
  product_name: string;
  category: string;
  brand: string;
  type?: string;
  seller_name: string;
  price?: number;
  admin?: number;
  commission?: number;
  buyer_sku_code: string;
  buyer_product_status: boolean;
  seller_product_status: boolean;
  unlimited_stock?: boolean;
  stock?: number;
  multi?: boolean;
  start_cut_off?: string;
  end_cut_off?: string;
  desc: string;
}

export interface PrepaidTransaction {
  ref_id: string;
  customer_no: string;
  buyer_sku_code: string;
  message: string;
  status: string;
  rc: string;
  sn?: string;
  buyer_last_saldo?: number;
  price: number;
  tele?: string;
  wa?: string;
}

export interface PriceListQuery {
  code?: string;
  category?: string;
  brand?: string;
  type?: string;
}

export const md5Signature = (value: string): string =>
  createHash('md5').update(value, 'utf8').digest('hex');

/** Available for integrations that require an HMAC signature; Digiflazz's buyer API uses MD5. */
export const hmacSignature = (secret: string, value: string, algorithm = 'sha256'): string =>
  createHmac(algorithm, secret).update(value, 'utf8').digest('hex');

const object = (value: unknown, label: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Digiflazz returned an invalid ${label}`);
  }
  return value as JsonObject;
};

const stringValue = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Digiflazz response missing ${field}`);
  return value;
};

const numberValue = (value: unknown, field: string, required = true): number | undefined => {
  if (value === undefined && !required) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Digiflazz response has invalid ${field}`);
  return parsed;
};

const booleanValue = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`Digiflazz response has invalid ${field}`);
  return value;
};

export class DigiflazzClient implements DigiflazzProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly transactions = new Map<string, { sku: string; customer: string }>();

  constructor(private readonly options: DigiflazzClientOptions) {
    if (!options.username || !options.apiKey) throw new Error('Digiflazz username and apiKey are required');
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async post<T>(path: string, body: JsonObject, parse: (value: unknown) => T): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Digiflazz returned non-JSON response (HTTP ${response.status})`);
    }
    if (!response.ok) throw new Error(`Digiflazz HTTP ${response.status}`);
    return parse(payload);
  }

  async checkBalance(): Promise<{ balance: number; currency: string }> {
    return this.post('/cek-saldo', {
      cmd: 'deposit',
      username: this.options.username,
      sign: md5Signature(`${this.options.username}${this.options.apiKey}depo`)
    }, (payload) => {
      const data = object(object(payload, 'response').data, 'balance data');
      return { balance: numberValue(data.deposit, 'deposit')!, currency: 'IDR' };
    });
  }

  async getPriceList(query: PriceListQuery = {}): Promise<PriceListItem[]> {
    return this.post('/price-list', {
      cmd: 'prepaid',
      username: this.options.username,
      ...query,
      sign: md5Signature(`${this.options.username}${this.options.apiKey}pricelist`)
    }, (payload) => {
      const data = object(payload, 'response').data;
      if (!Array.isArray(data)) throw new Error('Digiflazz response data is not a price list');
      return data.map((item) => {
        const row = object(item, 'price-list item');
        return {
          product_name: stringValue(row.product_name, 'product_name'),
          category: stringValue(row.category, 'category'),
          brand: stringValue(row.brand, 'brand'),
          type: typeof row.type === 'string' ? row.type : undefined,
          seller_name: stringValue(row.seller_name, 'seller_name'),
          price: numberValue(row.price, 'price', false),
          admin: numberValue(row.admin, 'admin', false),
          commission: numberValue(row.commission, 'commission', false),
          buyer_sku_code: stringValue(row.buyer_sku_code, 'buyer_sku_code'),
          buyer_product_status: booleanValue(row.buyer_product_status, 'buyer_product_status'),
          seller_product_status: booleanValue(row.seller_product_status, 'seller_product_status'),
          unlimited_stock: typeof row.unlimited_stock === 'boolean' ? row.unlimited_stock : undefined,
          stock: numberValue(row.stock, 'stock', false),
          multi: typeof row.multi === 'boolean' ? row.multi : undefined,
          start_cut_off: typeof row.start_cut_off === 'string' ? row.start_cut_off : undefined,
          end_cut_off: typeof row.end_cut_off === 'string' ? row.end_cut_off : undefined,
          desc: typeof row.desc === 'string' ? row.desc : ''
        };
      });
    });
  }

  async prepaidTransaction(input: { sku: string; customer: string; refId?: string; testing?: boolean }): Promise<PrepaidTransaction> {
    const refId = input.refId ?? randomUUID();
    this.transactions.set(refId, { sku: input.sku, customer: input.customer });
    return this.post('/transaction', {
      username: this.options.username,
      buyer_sku_code: input.sku,
      customer_no: input.customer,
      ref_id: refId,
      ...(input.testing === undefined ? {} : { testing: input.testing }),
      sign: md5Signature(`${this.options.username}${this.options.apiKey}${refId}`)
    }, parseTransaction);
  }

  async checkStatus(input: { refId: string; sku?: string; customer?: string }): Promise<PrepaidTransaction> {
    const saved = this.transactions.get(input.refId);
    const sku = input.sku ?? saved?.sku;
    const customer = input.customer ?? saved?.customer;
    if (!sku || !customer) {
      throw new Error('Status is available only for a ref_id created by this running bot.');
    }
    return this.prepaidTransaction({ sku, customer, refId: input.refId });
  }

  async priceList(query: PriceListQuery = {}): Promise<PriceListItem[]> {
    return this.getPriceList(query);
  }

  async transaction(input: { sku: string; customer: string; refId?: string; testing?: boolean }): Promise<PrepaidTransaction> {
    return this.prepaidTransaction(input);
  }

  async status(input: { refId: string; sku?: string; customer?: string }): Promise<PrepaidTransaction> {
    return this.checkStatus(input);
  }

  async createOrder(input: { sku: string; customer: string }): Promise<{ id: string; status: string }> {
    const transaction = await this.prepaidTransaction(input);
    return { id: transaction.ref_id, status: transaction.status };
  }
}

const parseTransaction = (payload: unknown): PrepaidTransaction => {
  const data = object(object(payload, 'response').data, 'transaction data');
  return {
    ref_id: stringValue(data.ref_id, 'ref_id'),
    customer_no: stringValue(data.customer_no, 'customer_no'),
    buyer_sku_code: stringValue(data.buyer_sku_code, 'buyer_sku_code'),
    message: stringValue(data.message, 'message'),
    status: stringValue(data.status, 'status'),
    rc: stringValue(data.rc, 'rc'),
    sn: typeof data.sn === 'string' ? data.sn : undefined,
    buyer_last_saldo: numberValue(data.buyer_last_saldo, 'buyer_last_saldo', false),
    price: numberValue(data.price, 'price')!,
    tele: typeof data.tele === 'string' ? data.tele : undefined,
    wa: typeof data.wa === 'string' ? data.wa : undefined
  };
};