import { useCallback, useEffect, useState } from "react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/common/card"
import { Button } from "@/components/common/button"
import { Input } from "@/components/common/input"
import { Badge } from "@/components/common/badge"
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Trash2,
  RefreshCw,
  Info,
  Database,
} from "lucide-react"
import {
  AVAILABLE_PROVIDERS,
  activateProvider,
  getApiKey,
  getBaseUrl,
  getDataProvider,
  getProviderId,
  setApiKey,
  setBaseUrl,
  clearApiKey,
  testConnection,
  type ProviderId,
} from "@/data/providers"
import {
  clearCache,
  clearAllData,
  getCacheStats,
} from "@/data/cache"
import { clearScannerCache } from "@/data/scannerService"
import {
  getUniverseConfig,
  setUniverseMode,
  setCustomSymbols,
  resolveUniverse,
  type UniverseMode,
} from "@/config/universe"

type ConnectionStatus = "not_configured" | "connected" | "invalid" | "testing"

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function SettingsPage() {
  const [providerId, setProviderId] = useState<ProviderId>("mock")
  const [apiKey, setApiKeyInput] = useState("")
  const [baseUrl, setBaseUrlInput] = useState("")
  const [remember, setRemember] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>("not_configured")
  const [message, setMessage] = useState("")
  const [activeName, setActiveName] = useState("Mock Provider")
  const [cacheStats, setCacheStats] = useState<{
    memory: { total: number; valid: number; expired: number }
    indexedDb: { count: number; totalBytes: number; byKind: Record<string, number> }
  } | null>(null)
  const [cacheBusy, setCacheBusy] = useState(false)
  const [universeMode, setUniverseModeState] = useState<UniverseMode>("liquid")
  const [customList, setCustomList] = useState("")
  const [universeCount, setUniverseCount] = useState(0)

  const refreshCacheStats = useCallback(async () => {
    try {
      const s = await getCacheStats()
      setCacheStats(s)
    } catch {
      setCacheStats(null)
    }
  }, [])

  useEffect(() => {
    const id = getProviderId()
    setProviderId(id)
    setApiKeyInput(getApiKey() ?? "")
    setBaseUrlInput(getBaseUrl() ?? "")
    const p = getDataProvider()
    setActiveName(p.name)
    if (id === "mock") {
      setStatus("connected")
      setMessage("Mock provider active")
    } else if (id === "vnstock") {
      setStatus("not_configured")
      setMessage("Deployed? Click Test Connection to verify /api/health")
    } else if (getApiKey() || id === "http") {
      setStatus("not_configured")
      setMessage("Click Test Connection to verify")
    }
    void refreshCacheStats()
    const uc = getUniverseConfig()
    setUniverseModeState(uc.mode)
    setCustomList((uc.customSymbols ?? []).join(", "))
    setUniverseCount(resolveUniverse(uc).length)
  }, [refreshCacheStats])

  const selectedMeta = AVAILABLE_PROVIDERS.find((p) => p.id === providerId)

  const handleActivateAndTest = async () => {
    setStatus("testing")
    setMessage("Activating & testing…")
    try {
      if (apiKey.trim()) setApiKey(apiKey.trim(), remember)
      if (baseUrl.trim()) setBaseUrl(baseUrl.trim())
      const provider = activateProvider({
        id: providerId,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      })
      setActiveName(provider.name)
      const result = await testConnection()
      if (result.ok) {
        setStatus("connected")
        setMessage(result.message ?? "Connected successfully")
      } else {
        setStatus("invalid")
        setMessage(result.message ?? "Connection failed")
      }
    } catch (e) {
      setStatus("invalid")
      setMessage(e instanceof Error ? e.message : "Unknown error")
    }
  }

  const handleClearKey = () => {
    clearApiKey()
    setApiKeyInput("")
    setStatus("not_configured")
    setMessage("API key cleared from browser storage")
  }

  const handleSwitchToMock = () => {
    activateProvider({ id: "mock" })
    setProviderId("mock")
    setActiveName("Mock Provider")
    setStatus("connected")
    setMessage("Switched to Mock Provider")
  }

  const handleClearCache = async (kind?: "ohlcv" | "index" | "company" | "fundamentals") => {
    setCacheBusy(true)
    try {
      await clearCache(kind)
      setMessage(kind ? `Cleared ${kind} cache` : "Cleared all cache entries")
      await refreshCacheStats()
    } finally {
      setCacheBusy(false)
    }
  }

  const handleClearAllData = async () => {
    setCacheBusy(true)
    try {
      await clearAllData()
      setMessage("All local cache data cleared (memory + IndexedDB)")
      await refreshCacheStats()
    } finally {
      setCacheBusy(false)
    }
  }

  const StatusBadge = () => {
    if (status === "connected")
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> Connected
        </Badge>
      )
    if (status === "invalid")
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Invalid / Error
        </Badge>
      )
    if (status === "testing")
      return (
        <Badge variant="secondary" className="gap-1">
          <RefreshCw className="h-3 w-3 animate-spin" /> Testing
        </Badge>
      )
    return (
      <Badge variant="outline" className="gap-1">
        <AlertCircle className="h-3 w-3" /> Not configured
      </Badge>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Data provider, API keys and cache management
        </p>
      </div>

      {/* Active provider */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Active Data Source</CardTitle>
            <StatusBadge />
          </div>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Provider</span>
            <span className="font-medium">{activeName}</span>
          </div>
          {message && <p className="text-muted-foreground pt-1">{message}</p>}
        </CardContent>
      </Card>

      {/* Provider selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Provider</CardTitle>
          <CardDescription>
            API keys are stored only in the browser (sessionStorage by default).
            This is a frontend-only app — no server-side secret storage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Provider</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value as ProviderId)}
            >
              {AVAILABLE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {selectedMeta && (
              <p className="text-xs text-muted-foreground">{selectedMeta.description}</p>
            )}
          </div>

          {selectedMeta?.requiresBaseUrl && (
            <div className="space-y-2">
              <label htmlFor="base-url" className="text-sm font-medium">
                Base URL
              </label>
              <Input
                id="base-url"
                type="url"
                placeholder="https://your-cors-enabled-api.example.com"
                value={baseUrl}
                onChange={(e) => setBaseUrlInput(e.target.value)}
              />
            </div>
          )}

          {(selectedMeta?.requiresApiKey || providerId === "http" || providerId === "vnstock") && (
            <div className="space-y-2">
              <label htmlFor="api-key" className="text-sm font-medium">
                API Key / Token
              </label>
              <Input
                id="api-key"
                type="password"
                placeholder={providerId === "vnstock" ? "vnstock_xxxxxxxx (optional)" : "Enter API key or token"}
                value={apiKey}
                onChange={(e) => setApiKeyInput(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded border-input"
            />
            Remember this key on this device (uses localStorage)
          </label>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleActivateAndTest} disabled={status === "testing"}>
              {status === "testing" ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Testing…
                </>
              ) : (
                "Save / Test Connection"
              )}
            </Button>
            <Button variant="outline" onClick={handleClearKey}>
              Clear Key
            </Button>
            <Button variant="secondary" onClick={handleSwitchToMock}>
              Use Mock
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cache */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" />
              Client Cache
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshCacheStats()}
              disabled={cacheBusy}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${cacheBusy ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <CardDescription>
            Memory (hot) + IndexedDB (persistent). Data is never sent to a server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cacheStats ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs mb-1">Memory</div>
                <div className="font-medium">
                  {cacheStats.memory.valid} valid / {cacheStats.memory.total} total
                </div>
                {cacheStats.memory.expired > 0 && (
                  <div className="text-xs text-warning">
                    {cacheStats.memory.expired} expired
                  </div>
                )}
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs mb-1">IndexedDB</div>
                <div className="font-medium">
                  {cacheStats.indexedDb.count} entries
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(cacheStats.indexedDb.totalBytes)}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading cache stats…</p>
          )}

          {cacheStats && Object.keys(cacheStats.indexedDb.byKind).length > 0 && (
            <div className="text-xs text-muted-foreground">
              By kind:{" "}
              {Object.entries(cacheStats.indexedDb.byKind)
                .map(([k, v]) => `${k}=${v}`)
                .join(" · ")}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={cacheBusy}
              onClick={() => void handleClearCache("ohlcv")}
            >
              Clear OHLCV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={cacheBusy}
              onClick={() => void handleClearCache()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear All Cache
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={cacheBusy}
              onClick={() => void handleClearAllData()}
            >
              Clear All Local Data
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CORS notice */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" />
            CORS & Offline
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            If the live provider is unavailable, the app will serve valid cached
            data from IndexedDB when present (offline / degraded mode).
          </p>
          <p>
            This app will not create a proxy backend or bypass CORS. Use Mock or
            a CORS-enabled endpoint.
          </p>
        </CardContent>
      </Card>

      {/* Universe */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scanner Universe</CardTitle>
          <CardDescription>
            Default liquid sample (~50–60 names). Custom list for focused scans.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center text-sm">
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={universeMode}
              onChange={(e) => {
                const m = e.target.value as UniverseMode
                setUniverseModeState(m)
                setUniverseMode(m)
                setUniverseCount(resolveUniverse().length)
              }}
            >
              <option value="liquid">All Liquid Stocks (sample)</option>
              <option value="custom">Custom Symbol List</option>
            </select>
            <span className="text-muted-foreground">{universeCount} symbols</span>
          </div>
          {universeMode === "custom" && (
            <div className="space-y-2">
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="VCB, FPT, HPG, ..."
                value={customList}
                onChange={(e) => setCustomList(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const syms = customList.split(/[\s,;]+/).filter(Boolean)
                  setCustomSymbols(syms)
                  setUniverseCount(resolveUniverse().length)
                  setMessage(`Custom universe saved (${syms.length} symbols)`)
                }}
              >
                Save Custom List
              </Button>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={cacheBusy}
            onClick={async () => {
              setCacheBusy(true)
              try {
                await clearScannerCache()
                setMessage("Scanner result cache cleared")
              } finally {
                setCacheBusy(false)
              }
            }}
          >
            Clear Scanner Cache
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>VN Quant Trading Web App – Frontend-only architecture</p>
          <p>React + Vite + TypeScript + Tailwind + TanStack Query</p>
          <p>All quant computation runs in the browser. No backend server.</p>
        </CardContent>
      </Card>
    </div>
  )
}
