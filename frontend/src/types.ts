// Types mirroring API_CONTRACT.md

export type Thresholds = {
  high_turnover_pct: number
  heavy_fines_dollars: number
}

export type Overview = {
  facilities: number
  chains: number
  independents: number
  pct_facilities_in_chains: number
  states: number
  total_fines_dollars: number
  abuse_flag_count: number
  thresholds: Thresholds
  processing_date: string
}

export type ChainSummary = {
  chain_id: string
  chain_name: string
  facilities_in_data: number
  states: string[]
  avg_overall_rating: number | null
  avg_staffing_rating: number | null
  avg_health_inspection_rating?: number | null
  avg_qm_rating?: number | null
  avg_turnover_pct: number | null
  total_fines_dollars: number
  total_certified_beds: number
  fines_per_bed: number | null
  total_penalties: number
  abuse_count: number
  special_focus_count: number
  flagged_facilities: number
  flag_rate_pct: number
  // Size-normalized metrics (added by contract).
  fines_per_facility: number
  abuse_rate_pct: number
  penalties_per_facility: number
  size_band: SizeBand
  // Ownership fields (added by contract, may be absent until backend lands).
  majority_ownership?: Ownership | string | null
  for_profit_pct?: number | null
}

export type SizeBand = 'single' | 'small' | 'medium' | 'large'

export type Ownership = 'for_profit' | 'non_profit' | 'government' | 'mixed'

export type ChainListResponse = {
  total: number
  chains: ChainSummary[]
}

// Light facility record returned by the /api/facilities search endpoint.
export type FacilitySearchItem = {
  ccn: string
  name: string
  city: string | null
  state: string | null
  chain_name: string | null
  overall_rating: number | null
  flags: string[]
}

export type FacilityListResponse = {
  total: number
  facilities: FacilitySearchItem[]
}

// Facility with distance, returned by /api/near.
export type NearbyFacility = FacilitySearchItem & {
  distance_miles: number
  fines_dollars: number | null
  lat: number | null
  lng: number | null
}

export type NearResponse = {
  zip: string
  centroid: { lat: number; lng: number }
  resolved_by: 'zip' | 'prefix'
  total: number
  flagged_total: number
  abuse_total: number
  facilities: NearbyFacility[]
}

export type FacilityInChain = {
  ccn: string
  name: string
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
  certified_beds: number | null
  overall_rating: number | null
  staffing_rating: number | null
  qm_rating: number | null
  turnover_pct: number | null
  fines_dollars: number | null
  fines_count: number | null
  flags: string[]
}

export type FineYear = {
  year: number
  fine_count: number
  fine_dollars: number
}

export type ChainDetail = ChainSummary & {
  fine_timeline: FineYear[]
  facilities: FacilityInChain[]
}

export type FlagObject = {
  key: string
  label: string
  detail: string
}

export type FacilityDetail = {
  ccn: string
  name: string
  address?: string | null
  city: string | null
  state: string | null
  zip?: string | null
  ownership_type?: string | null
  chain_id?: string | null
  chain_name?: string | null
  certified_beds?: number | null
  overall_rating: number | null
  staffing_rating: number | null
  qm_rating?: number | null
  health_inspection_rating?: number | null
  // staffing hours
  reported_rn_staffing_hours?: number | null
  adjusted_rn_staffing_hours?: number | null
  reported_total_staffing_hours?: number | null
  adjusted_total_staffing_hours?: number | null
  turnover_pct: number | null
  // fines
  fines_dollars?: number | null
  fines_count?: number | null
  total_penalties?: number | null
  payment_denials?: number | null
  // inspection
  last_inspection_date?: string | null
  lat?: number | null
  lng?: number | null
  fine_timeline?: FineYear[]
  flags: FlagObject[]
}

// Sortable columns for the chain table.
export type SortKey =
  | 'chain_name'
  | 'facilities_in_data'
  | 'avg_overall_rating'
  | 'avg_staffing_rating'
  | 'avg_turnover_pct'
  | 'fines_per_facility'
  | 'fines_per_bed'
  | 'total_fines_dollars'
  | 'penalties_per_facility'
  | 'abuse_rate_pct'
  | 'abuse_count'
  | 'special_focus_count'
  | 'flag_rate_pct'
  | 'majority_ownership'
