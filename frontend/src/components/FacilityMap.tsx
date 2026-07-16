import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { LatLngBounds } from 'leaflet'
import { fmtMoney, flagLabel, titleCase } from '../format'

// Permissive item type — both near-search items and chain facilities satisfy it.
export type MapFacility = {
  ccn: string
  name: string
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
  fines_dollars: number | null
  flags: string[]
  overall_rating: number | null
}

export type MapCentroid = {
  lat: number
  lng: number
  label: string
}

const SEVERITY_RED = '#b91c1c'
const SEVERITY_AMBER = '#b45309'
const SEVERITY_GRAY = '#9aa2ab'

// Color by severity: red for abuse/special-focus, amber for any other flag,
// gray when clean.
function severityColor(flags: string[]): string {
  if (flags.includes('abuse') || flags.includes('special_focus')) return SEVERITY_RED
  if (flags.length > 0) return SEVERITY_AMBER
  return SEVERITY_GRAY
}

// Radius scaled by fines (sqrt scale) into a 4–16px range.
function fineRadius(fines: number | null, maxFines: number): number {
  const v = fines && fines > 0 ? fines : 0
  if (maxFines <= 0) return 4
  return 4 + Math.sqrt(v / maxFines) * 12
}

function hasCoords(f: MapFacility): boolean {
  return (
    f.lat !== null &&
    f.lng !== null &&
    !Number.isNaN(f.lat) &&
    !Number.isNaN(f.lng)
  )
}

function FitBounds({
  facilities,
  centroid,
}: {
  facilities: MapFacility[]
  centroid?: MapCentroid | null
}) {
  const map = useMap()
  useEffect(() => {
    const pts = facilities
      .filter(hasCoords)
      .map((f) => [f.lat as number, f.lng as number] as [number, number])
    if (centroid) pts.push([centroid.lat, centroid.lng])
    if (pts.length === 0) return
    if (pts.length === 1) {
      map.setView(pts[0], 9)
      return
    }
    const bounds = new LatLngBounds(pts)
    map.fitBounds(bounds, { padding: [24, 24] })
  }, [facilities, centroid, map])
  return null
}

export function FacilityMap({
  facilities,
  centroid,
  onSelectFacility,
}: {
  facilities: MapFacility[]
  centroid?: MapCentroid | null
  onSelectFacility: (ccn: string) => void
}) {
  const mapped = useMemo(() => facilities.filter(hasCoords), [facilities])
  const maxFines = useMemo(
    () => Math.max(0, ...mapped.map((f) => f.fines_dollars ?? 0)),
    [mapped],
  )
  return (
    <div className="dsr-map-wrap">
      <MapContainer
        className="leaflet-map"
        center={[39.5, -98.35]}
        zoom={4}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds facilities={mapped} centroid={centroid} />
        {mapped.map((f) => {
          const color = severityColor(f.flags)
          return (
            <CircleMarker
              key={f.ccn}
              center={[f.lat as number, f.lng as number]}
              radius={fineRadius(f.fines_dollars, maxFines)}
              pathOptions={{
                color: '#ffffff',
                weight: 1,
                fillColor: color,
                fillOpacity: 0.85,
              }}
            >
              <Popup>
                <div className="map-popup">
                  <button
                    className="map-popup-name map-popup-link"
                    onClick={() => onSelectFacility(f.ccn)}
                  >
                    {titleCase(f.name)}
                  </button>
                  <div className="dim">
                    {[f.city ? titleCase(f.city) : null, f.state]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </div>
                  <div>{fmtMoney(f.fines_dollars)} in fines</div>
                  {f.flags.length > 0 && (
                    <div className="map-popup-flags">
                      {f.flags.map((k) => flagLabel(k)).join(', ')}
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
        {centroid && (
          <CircleMarker
            center={[centroid.lat, centroid.lng]}
            radius={7}
            pathOptions={{
              color: '#ffffff',
              weight: 3,
              fillColor: '#0f172a',
              fillOpacity: 1,
            }}
          >
            <Popup>
              <div className="map-popup">
                <div className="map-popup-name">{centroid.label}</div>
              </div>
            </Popup>
          </CircleMarker>
        )}
      </MapContainer>
      <div className="dsr-map-legend">
        <div className="dsr-legend-row">
          <span className="dsr-legend-dot" style={{ background: SEVERITY_RED }} />
          Abuse / special focus
          <span
            className="dsr-legend-dot"
            style={{ background: SEVERITY_AMBER, marginLeft: 8 }}
          />
          Other flag
          <span
            className="dsr-legend-dot"
            style={{ background: SEVERITY_GRAY, marginLeft: 8 }}
          />
          Clean
        </div>
        <div className="dsr-legend-note">Dot size scales with total fines.</div>
      </div>
    </div>
  )
}
