/** Provider seams intentionally contain no credentials or implementations. */
export interface LlmProvider {
  complete(input: { prompt: string; context?: string }): Promise<string>;
}

export interface DigiflazzProvider {
  checkBalance(): Promise<{ balance: number; currency: string }>;
  createOrder(input: { sku: string; customer: string }): Promise<{ id: string; status: string }>;
}

export interface ManualDepositService {
  createRequest(input: { requesterJid: string; amount: number }): Promise<{ id: string; status: 'pending' }>;
}

export interface HostingProvider {
  provision(input: { product: string; customer: string }): Promise<{ id: string; status: string }>;
}

export interface PterodactylConfig {
  baseUrl: string;
  apiTokenEnvVar: string;
}

export interface CoolifyConfig {
  baseUrl: string;
  apiTokenEnvVar: string;
}
