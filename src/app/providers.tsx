import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { type ReactNode, useEffect } from "react"
import { restoreProvider } from "@/data/providers"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function ProviderBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    restoreProvider()
  }, [])
  return <>{children}</>
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProviderBootstrap>{children}</ProviderBootstrap>
    </QueryClientProvider>
  )
}
