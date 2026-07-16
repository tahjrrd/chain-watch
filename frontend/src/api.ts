import type {
  Overview,
  ChainListResponse,
  ChainDetail,
  FacilityDetail,
  FacilityListResponse,
  NearResponse,
  SortKey,
  Ownership,
} from './types'

// Thin typed fetch layer. Every call goes through /api (vite proxy -> :8000).

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = typeof body?.detail === 'string' ? body.detail : ''
    } catch {
      /* ignore parse errors */
    }
    throw new ApiError(res.status, detail || `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

export function getOverview(signal?: AbortSignal): Promise<Overview> {
  return getJson<Overview>('/api/overview', signal)
}

export type ChainQuery = {
  q?: string
  state?: string
  size_band?: 'small' | 'medium' | 'large' | 'single'
  ownership?: Ownership
  has_abuse?: boolean
  sort_by?: SortKey
  descending?: boolean
}

export function getChains(
  params: ChainQuery,
  signal?: AbortSignal,
): Promise<ChainListResponse> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.state) search.set('state', params.state)
  if (params.size_band) search.set('size_band', params.size_band)
  if (params.ownership) search.set('ownership', params.ownership)
  if (params.has_abuse) search.set('has_abuse', 'true')
  if (params.sort_by) search.set('sort_by', params.sort_by)
  if (params.descending !== undefined) {
    search.set('descending', String(params.descending))
  }
  const qs = search.toString()
  return getJson<ChainListResponse>(`/api/chains${qs ? `?${qs}` : ''}`, signal)
}

export function getChain(
  chainId: string,
  signal?: AbortSignal,
): Promise<ChainDetail> {
  return getJson<ChainDetail>(
    `/api/chains/${encodeURIComponent(chainId)}`,
    signal,
  )
}

export type FacilityQuery = {
  q?: string
  state?: string
  limit?: number
}

export function getFacilities(
  params: FacilityQuery,
  signal?: AbortSignal,
): Promise<FacilityListResponse> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.state) search.set('state', params.state)
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  const qs = search.toString()
  return getJson<FacilityListResponse>(
    `/api/facilities${qs ? `?${qs}` : ''}`,
    signal,
  )
}

export function getNear(
  zip: string,
  signal?: AbortSignal,
): Promise<NearResponse> {
  return getJson<NearResponse>(
    `/api/near?zip=${encodeURIComponent(zip)}`,
    signal,
  )
}

export function getFacility(
  ccn: string,
  signal?: AbortSignal,
): Promise<FacilityDetail> {
  return getJson<FacilityDetail>(
    `/api/facilities/${encodeURIComponent(ccn)}`,
    signal,
  )
}

export { ApiError }
