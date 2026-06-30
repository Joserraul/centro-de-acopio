import * as XLSX from 'xlsx'
import workbookUrl from '../../../../Centros de Acopio - Cumaná.xlsx?url'

export interface SupplyCenter {
  id: string
  name: string
  location: string
  schedules: string
  contact: string
  coordinatesText: string
  observation: string
  latitude: number | null
  longitude: number | null
}

export interface UserLocation {
  latitude: number
  longitude: number
}

export interface DrivingRoute {
  coordinates: [number, number][]
  distanceMeters: number
  durationSeconds: number
}

interface SupplyCenterWorkbookRow {
  'CENTRO DE ACOPIO'?: string
  'UBICACIÓN'?: string
  HORARIOS?: string
  CONTACTO?: string
  'Latitud-longitud'?: string
  OBSERVACIÓN?: string
}

const DEFAULT_WORKBOOK_SHEET_INDEX = 0

function cleanText(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function dmsToDecimal(
  degreesText: string,
  minutesText: string,
  secondsText: string,
  hemisphere: string,
) {
  const degrees = Number(degreesText)
  const minutes = Number(minutesText)
  const seconds = Number(secondsText)

  if ([degrees, minutes, seconds].some(Number.isNaN)) {
    return null
  }

  const decimal = degrees + minutes / 60 + seconds / 3600
  const sign = hemisphere === 'S' || hemisphere === 'W' ? -1 : 1

  return decimal * sign
}

export function parseCoordinatePair(rawValue: string) {
  const value = cleanText(rawValue)

  if (!value) {
    return null
  }

  const decimalMatch = value.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
  )

  if (decimalMatch) {
    const latitude = Number(decimalMatch[1])
    const longitude = Number(decimalMatch[2])

    if (!Number.isNaN(latitude) && !Number.isNaN(longitude)) {
      return { latitude, longitude }
    }
  }

  const normalized = value
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

  const dmsPattern =
    /(\d{1,3})°\s*(\d{1,2})'\s*(\d{1,2}(?:\.\d+)?)"?\s*([NSEW])/gi
  const matches = Array.from(normalized.matchAll(dmsPattern))

  if (matches.length < 2) {
    return null
  }

  const coordinates = matches
    .map((match) => {
      const decimal = dmsToDecimal(match[1], match[2], match[3], match[4].toUpperCase())

      if (decimal === null) {
        return null
      }

      return {
        value: decimal,
        hemisphere: match[4].toUpperCase(),
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  const latitude = coordinates.find(
    (coordinate) => coordinate.hemisphere === 'N' || coordinate.hemisphere === 'S',
  )?.value
  const longitude = coordinates.find(
    (coordinate) => coordinate.hemisphere === 'E' || coordinate.hemisphere === 'W',
  )?.value

  if (latitude === undefined || longitude === undefined) {
    return null
  }

  return { latitude, longitude }
}

export function normalizeSupplyCenterRow(
  row: SupplyCenterWorkbookRow,
  index: number,
): SupplyCenter | null {
  const name = cleanText(row['CENTRO DE ACOPIO'])

  if (!name) {
    return null
  }

  const location = cleanText(row['UBICACIÓN'])
  const schedules = cleanText(row.HORARIOS)
  const contact = cleanText(row.CONTACTO)
  const coordinatesText = cleanText(row['Latitud-longitud'])
  const observation = cleanText(row.OBSERVACIÓN)
  const coordinates = parseCoordinatePair(coordinatesText)

  return {
    id: `${slugify(name) || 'centro'}-${index + 1}`,
    name,
    location,
    schedules,
    contact,
    coordinatesText,
    observation,
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
  }
}

export async function loadSupplyCenters() {
  const response = await fetch(workbookUrl)

  if (!response.ok) {
    throw new Error('No se pudo cargar el archivo Excel de centros de acopio.')
  }

  const workbookBuffer = await response.arrayBuffer()
  const workbook = XLSX.read(workbookBuffer, { type: 'array' })
  const sheetName = workbook.SheetNames[DEFAULT_WORKBOOK_SHEET_INDEX]

  if (!sheetName) {
    throw new Error('El archivo Excel no contiene hojas utilizables.')
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<SupplyCenterWorkbookRow>(sheet, {
    defval: '',
  })

  return rows
    .map((row, index) => normalizeSupplyCenterRow(row, index))
    .filter((center): center is SupplyCenter => Boolean(center))
}

export function hasCoordinates(center: SupplyCenter) {
  return center.latitude !== null && center.longitude !== null
}

export function calculateDistanceKm(origin: UserLocation, target: UserLocation) {
  const earthRadiusKm = 6371
  const latitudeDelta = ((target.latitude - origin.latitude) * Math.PI) / 180
  const longitudeDelta = ((target.longitude - origin.longitude) * Math.PI) / 180
  const originLatitude = (origin.latitude * Math.PI) / 180
  const targetLatitude = (target.latitude * Math.PI) / 180

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(targetLatitude) *
      Math.sin(longitudeDelta / 2) ** 2

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function formatDistance(distanceKm: number) {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`
  }

  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`
}

export function formatTravelTime(durationSeconds: number) {
  const totalMinutes = Math.round(durationSeconds / 60)

  if (totalMinutes < 60) {
    return `${totalMinutes} min`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (minutes === 0) {
    return `${hours} h`
  }

  return `${hours} h ${minutes} min`
}

export function buildGoogleMapsDirectionsUrl(
  center: SupplyCenter,
  origin?: UserLocation | null,
) {
  if (!hasCoordinates(center)) {
    return null
  }

  const params = new URLSearchParams({
    api: '1',
    destination: `${center.latitude},${center.longitude}`,
    travelmode: 'driving',
  })

  if (origin) {
    params.set('origin', `${origin.latitude},${origin.longitude}`)
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function buildWazeDirectionsUrl(center: SupplyCenter) {
  if (!hasCoordinates(center)) {
    return null
  }

  const params = new URLSearchParams({
    ll: `${center.latitude},${center.longitude}`,
    navigate: 'yes',
  })

  return `https://waze.com/ul?${params.toString()}`
}

export function sortCentersByDistance(
  centers: SupplyCenter[],
  userLocation: UserLocation | null,
) {
  if (!userLocation) {
    return [...centers].sort((left, right) => left.name.localeCompare(right.name, 'es'))
  }

  return [...centers].sort((left, right) => {
    if (!hasCoordinates(left) && !hasCoordinates(right)) {
      return left.name.localeCompare(right.name, 'es')
    }

    if (!hasCoordinates(left)) {
      return 1
    }

    if (!hasCoordinates(right)) {
      return -1
    }

    return (
      calculateDistanceKm(userLocation, {
        latitude: left.latitude,
        longitude: left.longitude,
      }) -
      calculateDistanceKm(userLocation, {
        latitude: right.latitude,
        longitude: right.longitude,
      })
    )
  })
}

export async function loadDrivingRoute(
  origin: UserLocation,
  destination: UserLocation,
  signal?: AbortSignal,
): Promise<DrivingRoute> {
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'false',
  })

  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?${params.toString()}`,
    { signal },
  )

  if (!response.ok) {
    throw new Error('No se pudo calcular la ruta sugerida.')
  }

  const payload = (await response.json()) as {
    routes?: Array<{
      distance?: number
      duration?: number
      geometry?: { coordinates?: Array<[number, number]> }
    }>
  }

  const route = payload.routes?.[0]
  const coordinates = route?.geometry?.coordinates

  if (!route || !coordinates?.length) {
    throw new Error('El servicio de rutas no devolvio un trayecto utilizable.')
  }

  return {
    coordinates: coordinates.map(([longitude, latitude]) => [latitude, longitude]),
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
  }
}
