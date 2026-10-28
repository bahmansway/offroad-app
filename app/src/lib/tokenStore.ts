import * as SecureStore from 'expo-secure-store';
import type { TokenPair } from './types';

export interface TokenStore {
  get(): Promise<TokenPair | null>;
  set(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
  /** Called when another tab/window changed the tokens (web only). Returns an unsubscribe function. */
  subscribe?(onChange: () => void): () => void;
}

/** Runs `fn` while holding a cross-tab lock when the platform has one (web), otherwise just runs it. */
export type LockFn = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

const KEY = 'offroad.tokens';

/** Native: tokens live in the iOS Keychain / Android Keystore. One app instance → no cross-tab races. */
export const tokenStore: TokenStore = {
  async get() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      return raw ? (JSON.parse(raw) as TokenPair) : null;
    } catch {
      return null;
    }
  },
  async set(tokens) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};

export const withLock: LockFn | undefined = undefined;
