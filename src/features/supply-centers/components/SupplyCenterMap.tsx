import { useEffect } from 'react'
import { latLngBounds } from 'leaflet'
import { LocateFixed, MapPinned } from 'lucide-react'
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import type { DrivingRoute, SupplyCenter, UserLocation } from '../utils/supplyCenters'
import { hasCoordinates } from '../utils/supplyCenters'

const DEFAULT_CENTER: [number, number] = [10.4542, -64.1728]

interface SupplyCenterMapProps {
  centers: SupplyCenter[]
  selectedCenter: SupplyCenter | null
  onSelect: (centerId: string) => void
  userLocation: UserLocation | null
  route: DrivingRoute | null
  routeStatus: 'idle' | 'loading' | 'ready' | 'error'
}

function FitToContent({
  centers,
  selectedCenter,
  userLocation,
  route,
}: Pick<
  SupplyCenterMapProps,
  'centers' | 'selectedCenter' | 'userLocation' | 'route'
>) {
  const map = useMap()

  useEffect(() => {
    const routeCoordinates = route?.coordinates ?? []

    if (routeCoordinates.length > 1) {
      map.fitBounds(latLngBounds(routeCoordinates).pad(0.16), { animate: false })
      return
    }

    if (selectedCenter && hasCoordinates(selectedCenter) && userLocation) {
      map.fitBounds(
        latLngBounds([
          [selectedCenter.latitude, selectedCenter.longitude],
          [userLocation.latitude, userLocation.longitude],
        ]).pad(0.22),
        { animate: false },
      )
      return
    }

    if (selectedCenter && hasCoordinates(selectedCenter)) {
      map.setView([selectedCenter.latitude, selectedCenter.longitude], 15, { animate: false })
      return
    }

    const mappedCenters = centers.filter(hasCoordinates)

    if (mappedCenters.length > 1) {
      map.fitBounds(
        latLngBounds(
          mappedCenters.map((center) => [center.latitude, center.longitude] as [number, number]),
        ).pad(0.18),
        { animate: false },
      )
      return
    }

    if (mappedCenters.length === 1) {
      map.setView([mappedCenters[0].latitude, mappedCenters[0].longitude], 14, {
        animate: false,
      })
    }
  }, [centers, map, route, selectedCenter, userLocation])

  return null
}

export default function SupplyCenterMap({
  centers,
  selectedCenter,
  onSelect,
  userLocation,
  route,
  routeStatus,
}: SupplyCenterMapProps) {
  const mappedCenters = centers.filter(hasCoordinates)

  if (mappedCenters.length === 0) {
    return (
      <div className="flex min-h-[520px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-700 bg-slate-900/70 px-6 text-center">
        <MapPinned size={28} className="text-slate-500" />
        <h3 className="mt-4 text-lg font-medium text-white">No hay centros con coordenadas</h3>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          Revisa el archivo Excel o desactiva filtros para mostrar puntos navegables.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[24px] border border-white/10">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={13}
        scrollWheelZoom
        className="h-[520px] w-full bg-slate-950"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToContent
          centers={mappedCenters}
          selectedCenter={selectedCenter}
          userLocation={userLocation}
          route={route}
        />

        {route?.coordinates.length ? (
          <Polyline
            positions={route.coordinates}
            pathOptions={{
              color: '#22d3ee',
              weight: 5,
              opacity: 0.85,
              dashArray: routeStatus === 'loading' ? '12 10' : undefined,
            }}
          />
        ) : null}

        {userLocation ? (
          <>
            <Circle
              center={[userLocation.latitude, userLocation.longitude]}
              radius={60}
              pathOptions={{
                color: '#38bdf8',
                fillColor: '#38bdf8',
                fillOpacity: 0.08,
                weight: 1,
              }}
            />
            <CircleMarker
              center={[userLocation.latitude, userLocation.longitude]}
              radius={9}
              pathOptions={{
                color: '#e0f2fe',
                fillColor: '#38bdf8',
                fillOpacity: 1,
                weight: 3,
              }}
            >
              <Tooltip direction="top" offset={[0, -10]}>
                <div className="flex items-center gap-2">
                  <LocateFixed size={14} />
                  <span>Tu ubicacion</span>
                </div>
              </Tooltip>
            </CircleMarker>
          </>
        ) : null}

        {mappedCenters.map((center) => {
          const isSelected = selectedCenter?.id === center.id

          return (
            <CircleMarker
              key={center.id}
              center={[center.latitude, center.longitude]}
              radius={isSelected ? 11 : 8}
              pathOptions={{
                color: isSelected ? '#f8fafc' : '#0f172a',
                fillColor: isSelected ? '#22d3ee' : '#c084fc',
                fillOpacity: 0.95,
                weight: isSelected ? 3 : 2,
              }}
              eventHandlers={{
                click: () => onSelect(center.id),
              }}
            >
              <Tooltip direction="top" offset={[0, -12]}>
                <div className="min-w-[180px]">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    Centro de acopio
                  </div>
                  <div className="mt-1 font-medium text-slate-900">{center.name}</div>
                  <div className="mt-1 text-sm text-slate-700">{center.location || 'Sin direccion'}</div>
                </div>
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}
