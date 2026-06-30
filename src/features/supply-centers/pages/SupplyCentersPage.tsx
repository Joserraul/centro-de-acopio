import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Clock3,
  ExternalLink,
  LoaderCircle,
  LocateFixed,
  MapPinned,
  Navigation,
  Phone,
  RefreshCcw,
  Route,
  Search,
  TriangleAlert,
} from 'lucide-react'
import SupplyCenterMap from '../components/SupplyCenterMap'
import {
  buildGoogleMapsDirectionsUrl,
  buildWazeDirectionsUrl,
  calculateDistanceKm,
  formatDistance,
  formatTravelTime,
  hasCoordinates,
  loadDrivingRoute,
  loadSupplyCenters,
  sortCentersByDistance,
  type DrivingRoute,
  type SupplyCenter,
  type UserLocation,
} from '../utils/supplyCenters'

type LoadingStatus = 'idle' | 'loading' | 'ready' | 'error'
type TrackingStatus = 'idle' | 'requesting' | 'active' | 'unsupported' | 'error'

const quickTips = [
  'Carga la hoja Excel ya colocada en el proyecto sin romper el visor NASA.',
  'Activa tu ubicacion para ordenar los puntos por cercania y calcular una ruta.',
  'Abre Google Maps o Waze desde el centro seleccionado si quieres navegacion guiada.',
]

function getGeolocationErrorMessage(error: GeolocationPositionError) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Se nego el permiso de ubicacion en el navegador.'
    case error.POSITION_UNAVAILABLE:
      return 'La ubicacion actual no esta disponible en este momento.'
    case error.TIMEOUT:
      return 'La ubicacion tardo demasiado en responder.'
    default:
      return 'No se pudo obtener tu ubicacion actual.'
  }
}

export default function SupplyCentersPage() {
  const [centers, setCenters] = useState<SupplyCenter[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showOnlyWithCoordinates, setShowOnlyWithCoordinates] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState<LoadingStatus>('loading')
  const [loadingError, setLoadingError] = useState('')
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('idle')
  const [trackingError, setTrackingError] = useState('')
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [route, setRoute] = useState<DrivingRoute | null>(null)
  const [routeStatus, setRouteStatus] = useState<LoadingStatus>('idle')
  const [routeError, setRouteError] = useState('')
  const watchIdRef = useRef<number | null>(null)

  const loadWorkbook = useCallback(async () => {
    setLoadingStatus('loading')
    setLoadingError('')

    try {
      const loadedCenters = await loadSupplyCenters()
      setCenters(loadedCenters)
      setSelectedId((currentId) => {
        if (currentId && loadedCenters.some((center) => center.id === currentId)) {
          return currentId
        }

        return loadedCenters.find(hasCoordinates)?.id ?? loadedCenters[0]?.id ?? null
      })
      setLoadingStatus('ready')
    } catch (error) {
      setLoadingStatus('error')
      setLoadingError(
        error instanceof Error ? error.message : 'No se pudo leer el archivo de centros.',
      )
    }
  }, [])

  useEffect(() => {
    void loadWorkbook()
  }, [loadWorkbook])

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }

    setTrackingStatus('idle')
  }, [])

  useEffect(() => stopTracking, [stopTracking])

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setTrackingStatus('unsupported')
      setTrackingError('Este dispositivo o navegador no ofrece geolocalizacion.')
      return
    }

    if (watchIdRef.current !== null) {
      return
    }

    setTrackingStatus('requesting')
    setTrackingError('')

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setTrackingStatus('active')
      },
      (error) => {
        setTrackingStatus('error')
        setTrackingError(getGeolocationErrorMessage(error))

        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current)
          watchIdRef.current = null
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      },
    )
  }, [])

  const visibleCenters = useMemo(() => {
    const normalizedQuery = searchTerm.trim().toLowerCase()

    const filteredCenters = centers.filter((center) => {
      if (showOnlyWithCoordinates && !hasCoordinates(center)) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      return [center.name, center.location, center.schedules, center.contact, center.observation]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    })

    return sortCentersByDistance(filteredCenters, userLocation)
  }, [centers, searchTerm, showOnlyWithCoordinates, userLocation])

  useEffect(() => {
    if (!visibleCenters.length) {
      setSelectedId(null)
      return
    }

    setSelectedId((currentId) => {
      if (currentId && visibleCenters.some((center) => center.id === currentId)) {
        return currentId
      }

      return visibleCenters[0].id
    })
  }, [visibleCenters])

  const selectedCenter = useMemo(
    () => visibleCenters.find((center) => center.id === selectedId) ?? null,
    [selectedId, visibleCenters],
  )

  const mappableCenters = useMemo(() => centers.filter(hasCoordinates), [centers])

  const nearestCenter = useMemo(() => {
    if (!userLocation) {
      return null
    }

    return sortCentersByDistance(mappableCenters, userLocation)[0] ?? null
  }, [mappableCenters, userLocation])

  const selectedCenterDistance = useMemo(() => {
    if (!userLocation || !selectedCenter || !hasCoordinates(selectedCenter)) {
      return null
    }

    return calculateDistanceKm(userLocation, {
      latitude: selectedCenter.latitude,
      longitude: selectedCenter.longitude,
    })
  }, [selectedCenter, userLocation])

  useEffect(() => {
    if (!userLocation || !selectedCenter || !hasCoordinates(selectedCenter)) {
      setRoute(null)
      setRouteStatus('idle')
      setRouteError('')
      return
    }

    const controller = new AbortController()

    setRouteStatus('loading')
    setRouteError('')

    void loadDrivingRoute(
      userLocation,
      {
        latitude: selectedCenter.latitude,
        longitude: selectedCenter.longitude,
      },
      controller.signal,
    )
      .then((loadedRoute) => {
        setRoute(loadedRoute)
        setRouteStatus('ready')
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return
        }

        setRoute(null)
        setRouteStatus('error')
        setRouteError(
          error instanceof Error ? error.message : 'No se pudo calcular una ruta hacia el centro.',
        )
      })

    return () => controller.abort()
  }, [selectedCenter, userLocation])

  const googleMapsUrl = selectedCenter
    ? buildGoogleMapsDirectionsUrl(selectedCenter, userLocation)
    : null
  const wazeUrl = selectedCenter ? buildWazeDirectionsUrl(selectedCenter) : null

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030712] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.14),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.12),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(192,132,252,0.12),transparent_24%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:80px_80px]" />

      <div className="relative mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <section className="rounded-[32px] border border-white/10 bg-slate-950/75 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-xs uppercase tracking-[0.24em] text-emerald-100">
              <Navigation size={14} />
              Navegacion y centros de acopio
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
                Proyecto independiente
              </div>
              <button
                type="button"
                onClick={() => void loadWorkbook()}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/15"
              >
                <RefreshCcw size={16} />
                Recargar Informacion
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-8 xl:grid-cols-[1.25fr_0.75fr]">
            <div>
              <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight text-white sm:text-5xl">
                Centros de acopio en Cumaná con mapa, cercania y ruta sugerida.
              </h1>

              <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
                Esta pagina fue realizada para
                mostrar puntos de acopio, ubicacion actual, distancia estimada y enlaces de
                navegacion en tiempo real.
              </p>

              {/* <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {quickTips.map((tip) => (
                  <div
                    key={tip}
                    className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300"
                  >
                    {tip}
                  </div>
                ))}
              </div> */}
            </div>

            <div className="rounded-[28px] border border-emerald-400/15 bg-[linear-gradient(180deg,rgba(10,20,18,0.92),rgba(3,7,18,0.92))] p-6">
              <p className="font-display text-sm uppercase tracking-[0.28em] text-emerald-200/70">
                Estado operativo
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
                  <p className="text-sm text-slate-400">Centros cargados</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{centers.length}</p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
                  <p className="text-sm text-slate-400">Con coordenadas</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{mappableCenters.length}</p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
                  <p className="text-sm text-slate-400">Seguimiento</p>
                  <p className="mt-2 text-sm font-medium uppercase tracking-[0.18em] text-cyan-100">
                    {trackingStatus === 'active'
                      ? 'Activo'
                      : trackingStatus === 'requesting'
                        ? 'Solicitando'
                        : trackingStatus === 'unsupported'
                          ? 'No disponible'
                          : 'Inactivo'}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
                  <p className="text-sm text-slate-400">Mas cercano</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {nearestCenter?.name ?? 'Activa tu ubicacion'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {loadingError ? (
          <div className="flex items-center gap-3 rounded-[24px] border border-rose-400/20 bg-rose-400/10 px-5 py-4 text-sm text-rose-100">
            <TriangleAlert size={18} />
            <span>{loadingError}</span>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-100">
                  <Search size={20} />
                </div>
                <div>
                  <p className="font-display text-sm uppercase tracking-[0.28em] text-cyan-200/70">
                    Busqueda
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    Filtro de centros disponibles
                  </h2>
                </div>
              </div>

              <label className="mt-6 block">
                <span className="mb-2 block text-sm text-slate-300">
                  Buscar por nombre, direccion, horario o contacto
                </span>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Ej. Caritas, Santa Rosa, 24 horas"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/40 focus:bg-white/10"
                />
              </label>

              <label className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={showOnlyWithCoordinates}
                  onChange={(event) => setShowOnlyWithCoordinates(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400"
                />
                <span>Mostrar solo centros con coordenadas listas para mapa y navegacion.</span>
              </label>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={startTracking}
                  disabled={trackingStatus === 'requesting' || trackingStatus === 'active'}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LocateFixed size={16} />
                  {trackingStatus === 'active'
                    ? 'Ubicacion activa'
                    : trackingStatus === 'requesting'
                      ? 'Solicitando permiso'
                      : 'Activar ubicacion'}
                </button>

                <button
                  type="button"
                  onClick={stopTracking}
                  disabled={trackingStatus !== 'active'}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Detener seguimiento
                </button>
              </div>

              {trackingError ? (
                <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
                  {trackingError}
                </div>
              ) : null}
            </section>

            <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-display text-sm uppercase tracking-[0.28em] text-cyan-200/70">
                    Lista
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    {visibleCenters.length} centros visibles
                  </h2>
                </div>
                {loadingStatus === 'loading' ? (
                  <LoaderCircle size={18} className="animate-spin text-cyan-200" />
                ) : null}
              </div>

              <div className="mt-5 max-h-[720px] space-y-3 overflow-y-auto pr-1">
                {visibleCenters.map((center) => {
                  const isSelected = center.id === selectedId
                  const distance =
                    userLocation && hasCoordinates(center)
                      ? calculateDistanceKm(userLocation, {
                          latitude: center.latitude,
                          longitude: center.longitude,
                        })
                      : null

                  return (
                    <button
                      key={center.id}
                      type="button"
                      onClick={() => setSelectedId(center.id)}
                      className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                        isSelected
                          ? 'border-cyan-300/40 bg-cyan-400/10 shadow-[0_20px_60px_rgba(6,182,212,0.12)]'
                          : 'border-white/10 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-medium text-white">{center.name}</h3>
                          <p className="mt-1 text-sm text-slate-300">
                            {center.location || 'Sin direccion registrada'}
                          </p>
                        </div>
                        <div
                          className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
                            hasCoordinates(center)
                              ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                              : 'border border-slate-500/30 bg-slate-800 text-slate-300'
                          }`}
                        >
                          {hasCoordinates(center) ? 'Mapa listo' : 'Sin coords'}
                        </div>
                      </div>

                      {distance !== null ? (
                        <p className="mt-3 text-sm text-cyan-100">
                          Aprox. a {formatDistance(distance)}
                        </p>
                      ) : null}

                      {center.schedules ? (
                        <p className="mt-2 text-sm text-slate-400">Horario: {center.schedules}</p>
                      ) : null}
                    </button>
                  )
                })}

                {visibleCenters.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-slate-700 bg-slate-900/70 px-4 py-6 text-sm text-slate-400">
                    Ningun centro coincide con el filtro actual.
                  </div>
                ) : null}
              </div>
            </section>
          </aside>

          <div className="space-y-6">
            <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-emerald-400/10 p-3 text-emerald-100">
                    <MapPinned size={22} />
                  </div>
                  <div>
                    <p className="font-display text-sm uppercase tracking-[0.28em] text-cyan-200/70">
                      Mapa
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-white">
                      Vista y desplazamiento sugerido
                    </h2>
                  </div>
                </div>

                <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-emerald-100">
                  {routeStatus === 'ready'
                    ? 'Ruta calculada'
                    : routeStatus === 'loading'
                      ? 'Calculando ruta'
                      : 'Puntos de acopio'}
                </div>
              </div>

              <SupplyCenterMap
                centers={visibleCenters}
                selectedCenter={selectedCenter}
                onSelect={setSelectedId}
                userLocation={userLocation}
                route={route}
                routeStatus={routeStatus}
              />

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-400">
                <span>OpenStreetMap para base cartografica</span>
                <span>OSRM para la ruta estimada</span>
                <span>Google Maps y Waze como salida rapida</span>
              </div>
            </section>

            <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
              <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-display text-sm uppercase tracking-[0.28em] text-cyan-200/70">
                      Centro seleccionado
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-white">
                      {selectedCenter?.name ?? 'Selecciona un punto'}
                    </h2>
                  </div>
                  {selectedCenterDistance !== null ? (
                    <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
                      {formatDistance(selectedCenterDistance)}
                    </div>
                  ) : null}
                </div>

                {selectedCenter ? (
                  <div className="mt-6 space-y-4">
                    <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
                      <p className="text-sm text-slate-400">Ubicacion</p>
                      <p className="mt-2 text-white">
                        {selectedCenter.location || 'Sin direccion registrada'}
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
                        <div className="flex items-center gap-2 text-slate-300">
                          <Clock3 size={16} />
                          <span className="text-sm">Horarios</span>
                        </div>
                        <p className="mt-3 text-sm text-white">
                          {selectedCenter.schedules || 'Sin horario cargado'}
                        </p>
                      </div>

                      <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
                        <div className="flex items-center gap-2 text-slate-300">
                          <Phone size={16} />
                          <span className="text-sm">Contacto</span>
                        </div>
                        <p className="mt-3 text-sm text-white">
                          {selectedCenter.contact || 'Sin contacto registrado'}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
                      <p className="text-sm text-slate-400">Coordenadas fuente</p>
                      <p className="mt-2 break-words text-sm text-white">
                        {selectedCenter.coordinatesText || 'No disponibles'}
                      </p>
                    </div>

                    {selectedCenter.observation ? (
                      <div className="rounded-[22px] border border-amber-300/20 bg-amber-300/10 p-5 text-sm text-amber-100">
                        Observacion: {selectedCenter.observation}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-6 rounded-[22px] border border-dashed border-slate-700 bg-slate-900/70 px-5 py-8 text-sm text-slate-400">
                    Selecciona un centro desde la lista para ver su ficha.
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
                  <p className="font-display text-sm uppercase tracking-[0.28em] text-cyan-200/70">
                    Navegacion
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    Ruta al centro seleccionado
                  </h2>

                  <div className="mt-6 space-y-4">
                    <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
                      <div className="flex items-center gap-2 text-slate-300">
                        <Route size={16} />
                        <span className="text-sm">Resumen</span>
                      </div>

                      <div className="mt-3 space-y-2 text-sm text-white">
                        <p>
                          Distancia ruta:{' '}
                          {route ? formatDistance(route.distanceMeters / 1000) : 'No calculada'}
                        </p>
                        <p>
                          Tiempo estimado:{' '}
                          {route ? formatTravelTime(route.durationSeconds) : 'No calculado'}
                        </p>
                        <p>
                          Estado:{' '}
                          {routeStatus === 'ready'
                            ? 'Ruta lista'
                            : routeStatus === 'loading'
                              ? 'Calculando'
                              : routeStatus === 'error'
                                ? 'Error'
                                : 'Necesita ubicacion y centro con coordenadas'}
                        </p>
                      </div>
                    </div>

                    {routeError ? (
                      <div className="rounded-[22px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                        {routeError}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-3">
                      <a
                        href={googleMapsUrl ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                          googleMapsUrl
                            ? 'border border-cyan-400/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15'
                            : 'cursor-not-allowed border border-white/10 bg-white/5 text-slate-500'
                        }`}
                      >
                        <ExternalLink size={16} />
                        Abrir en Google Maps
                      </a>

                      <a
                        href={wazeUrl ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                          wazeUrl
                            ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15'
                            : 'cursor-not-allowed border border-white/10 bg-white/5 text-slate-500'
                        }`}
                      >
                        <ExternalLink size={16} />
                        Abrir en Waze
                      </a>
                    </div>
                  </div>
                </section>

                <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
                  <p className="font-display text-sm uppercase tracking-[0.28em] text-cyan-200/70">
                    Recomendacion
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">Uso en movil y PC</h2>

                  <div className="mt-5 space-y-3 text-sm text-slate-300">
                    <p>En movil, activa ubicacion y usa los botones de Google Maps o Waze.</p>
                    <p>En PC, compara centros, valida horarios y luego comparte el destino.</p>
                    <p>
                      Si un punto no aparece en el mapa, la fila sigue visible pero necesita
                      coordenadas mas precisas en el Excel.
                    </p>
                  </div>
                </section>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
