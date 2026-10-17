// Sugestões de endereço enquanto digita (Places API "New" do Google: Autocomplete + Place Details).
// Usa a mesma chave da distância (GOOGLE_MAPS_API_KEY), só no servidor. Sem a chave, o campo vira texto livre.
// Com "sessionToken", as digitações de uma mesma busca + o detalhe do endereço escolhido contam como UMA sessão
// (as sugestões saem de graça e só o detalhe é cobrado).
import type { DB } from './db';

export interface Suggestion { id: string; main: string; secondary: string }
export interface PlaceAddress { street: string; number: string | null; neighborhood: string | null; city: string | null; state: string | null; postalCode: string | null; formatted: string }
export interface LatLng { latitude: number; longitude: number }
export interface PlacesApi {
  suggest(input: string, session: string, near: LatLng | null): Promise<Suggestion[]>;
  details(id: string, session: string): Promise<PlaceAddress | null>;
  locate(address: string): Promise<LatLng | null>;
}

const BASE = 'https://places.googleapis.com/v1';

async function call(fetchFn: typeof fetch, url: string, key: string, mask: string, body?: unknown) {
  const res = await fetchFn(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = String(data?.error?.message ?? res.status);
    throw Object.assign(new Error(`Sugestões de endereço indisponíveis (${msg.slice(0, 160)})`), { status: 502, provider: true });
  }
  return data;
}

/** Lê os pedaços do endereço que interessam para a entrega: rua, número e bairro. */
export function parseComponents(comps: any[] | undefined, formatted = ''): PlaceAddress {
  const get = (type: string, short = false) => {
    const c = (comps ?? []).find((x) => (x.types ?? []).includes(type));
    return c ? String(short ? c.shortText ?? c.longText : c.longText ?? c.shortText) : null;
  };
  const route = get('route');
  const number = get('street_number');
  const neighborhood = get('sublocality_level_1') ?? get('sublocality') ?? get('neighborhood');
  const street = route ? (number ? `${route}, ${number}` : route) : formatted.split(' - ')[0].split(',').slice(0, 2).join(',').trim();
  return {
    street, number, neighborhood,
    city: get('administrative_area_level_2') ?? get('locality'),
    state: get('administrative_area_level_1', true),
    postalCode: get('postal_code'),
    formatted,
  };
}

export function googlePlaces(key: string, fetchFn: typeof fetch = fetch): PlacesApi {
  return {
    async suggest(input, session, near) {
      const data = await call(fetchFn, `${BASE}/places:autocomplete`, key,
        'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text', {
          input, sessionToken: session, languageCode: 'pt-BR', includedRegionCodes: ['br'],
          ...(near ? { locationBias: { circle: { center: near, radius: 15000 } }, origin: near } : {}),
        });
      return (data?.suggestions ?? []).map((s: any) => s.placePrediction).filter((p: any) => p?.placeId).slice(0, 5).map((p: any) => ({
        id: String(p.placeId),
        main: String(p.structuredFormat?.mainText?.text ?? p.text?.text ?? ''),
        secondary: String(p.structuredFormat?.secondaryText?.text ?? ''),
      }));
    },
    async details(id, session) {
      const url = `${BASE}/places/${encodeURIComponent(id)}?languageCode=pt-BR&regionCode=br&sessionToken=${encodeURIComponent(session)}`;
      const data = await call(fetchFn, url, key, 'addressComponents,formattedAddress');
      if (!data) return null;
      return parseComponents(data.addressComponents, data.formattedAddress ?? '');
    },
    async locate(address) {
      const data = await call(fetchFn, `${BASE}/places:searchText`, key, 'places.location', { textQuery: address, languageCode: 'pt-BR', regionCode: 'br' });
      const l = data?.places?.[0]?.location;
      return l && typeof l.latitude === 'number' ? { latitude: l.latitude, longitude: l.longitude } : null;
    },
  };
}

export function placesFromEnv(env = process.env): PlacesApi | null {
  return env.GOOGLE_MAPS_API_KEY ? googlePlaces(env.GOOGLE_MAPS_API_KEY) : null;
}

/** Coordenadas do restaurante (para as sugestões virem da cidade dele primeiro). Fica guardado; refaz se o endereço mudar. */
export async function originPoint(db: DB, places: PlacesApi, address: string): Promise<LatLng | null> {
  const key = 'origem:' + address.trim().toLowerCase();
  const row = db.prepare('SELECT value FROM geo_cache WHERE cache_key = ?').get(key) as any;
  if (row) return JSON.parse(row.value);
  const p = await places.locate(address).catch(() => null);
  if (p) db.prepare('INSERT OR REPLACE INTO geo_cache(cache_key, value, created_at) VALUES (?,?,?)').run(key, JSON.stringify(p), new Date().toISOString());
  return p;
}
