import type { MarketDataProvider, ProviderConfig, ProviderId } from "./types"
import { MockMarketDataProvider } from "./mockProvider"
import { HttpMarketDataProvider } from "./httpProvider"
import { ItickMarketDataProvider } from "./itickProvider"
import { VnstockMarketDataProvider } from "./vnstockProvider"

const STORAGE_KEY = "vnquant_api_key"
const PROVIDER_ID_KEY = "vnquant_provider_id"
const BASE_URL_KEY = "vnquant_base_url"

let currentProvider: MarketDataProvider = new MockMarketDataProvider()

export function getDataProvider(): MarketDataProvider {
  return currentProvider
}

export function getProviderId(): ProviderId {
  return (localStorage.getItem(PROVIDER_ID_KEY) as ProviderId) || "mock"
}

export function setApiKey(key: string, remember = false) {
  if (remember) {
    localStorage.setItem(STORAGE_KEY, key)
    sessionStorage.removeItem(STORAGE_KEY)
  } else {
    sessionStorage.setItem(STORAGE_KEY, key)
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function getApiKey(): string | null {
  return sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY)
}

export function clearApiKey() {
  sessionStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(STORAGE_KEY)
}

export function setBaseUrl(url: string) {
  localStorage.setItem(BASE_URL_KEY, url)
}

export function getBaseUrl(): string | null {
  return localStorage.getItem(BASE_URL_KEY)
}

/**
 * Create and activate a provider from config.
 * Falls back to Mock on any construction error.
 */
export function activateProvider(config: ProviderConfig): MarketDataProvider {
  try {
    let provider: MarketDataProvider
    switch (config.id) {
      case "mock":
        provider = new MockMarketDataProvider()
        break
      case "http":
        provider = new HttpMarketDataProvider(config)
        break
      case "itick":
        provider = new ItickMarketDataProvider(config)
        break
      case "vnstock":
        provider = new VnstockMarketDataProvider(config)
        break
      default:
        provider = new MockMarketDataProvider()
    }
    currentProvider = provider
    localStorage.setItem(PROVIDER_ID_KEY, config.id)
    return provider
  } catch (e) {
    console.warn("Failed to activate provider, falling back to Mock", e)
    currentProvider = new MockMarketDataProvider()
    return currentProvider
  }
}

/** Restore last provider on app load */
export function restoreProvider(): MarketDataProvider {
  const id = getProviderId()
  const apiKey = getApiKey() ?? undefined
  const baseUrl = getBaseUrl() ?? undefined

  if (id === "mock") {
    currentProvider = new MockMarketDataProvider()
    return currentProvider
  }

  // vnstock needs no key; http may work with baseUrl only
  if (id === "vnstock") {
    return activateProvider({ id: "vnstock", baseUrl, apiKey })
  }

  if (id === "http") {
    if (!baseUrl) {
      currentProvider = new MockMarketDataProvider()
      return currentProvider
    }
    return activateProvider({ id: "http", apiKey, baseUrl })
  }

  if (id === "itick" && !apiKey) {
    currentProvider = new MockMarketDataProvider()
    return currentProvider
  }

  return activateProvider({ id, apiKey, baseUrl })
}

export async function testConnection() {
  return currentProvider.testConnection()
}

export const AVAILABLE_PROVIDERS: {
  id: ProviderId
  name: string
  description: string
  requiresApiKey: boolean
  requiresBaseUrl: boolean
}[] = [
  {
    id: "mock",
    name: "Mock Provider",
    description: "Synthetic data for development. Always available, no network.",
    requiresApiKey: false,
    requiresBaseUrl: false,
  },
  {
    id: "http",
    name: "Generic HTTP",
    description:
      "Point to any CORS-enabled JSON API that follows the expected OHLCV shape.",
    requiresApiKey: false,
    requiresBaseUrl: true,
  },
  {
    id: "vnstock",
    name: "VNStock (Vercel API)",
    description:
      "POST /api/scan chunks (sequential server-side). Optional API key for higher quota.",
    requiresApiKey: false,
    requiresBaseUrl: false,
  },
  {
    id: "itick",
    name: "iTick (VN)",
    description:
      "iTick stock kline API. Requires token. May be blocked by CORS in browser.",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
]

// Re-exports
export type { MarketDataProvider, ProviderConfig, ProviderId } from "./types"
export { MockMarketDataProvider } from "./mockProvider"
export { HttpMarketDataProvider } from "./httpProvider"
export { ItickMarketDataProvider } from "./itickProvider"
export { VnstockMarketDataProvider } from "./vnstockProvider"
export { DataProviderError, isDataProviderError } from "./errors"
