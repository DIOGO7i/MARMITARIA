// Distância de entrega: do endereço do restaurante até o endereço do cliente, PELAS RUAS (não em linha reta).
// Usa a Routes API do Google Maps (computeRoutes), com a chave só no servidor (GOOGLE_MAPS_API_KEY no .env).
// Sem a chave, o sistema funciona normalmente e só não mostra a distância.
import type { DB } from './db';

export interface DistanceResult { meters: number; seconds: number; approximate: boolean }
export type RouteFn = (origin: string, destination: string) => Promise<DistanceResult | null>;

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const EXACT_TYPES = ['street_address', 'premise', 'subpremise', 'establishment', 'point_of_interest'];

/** Chamada à Routes API. Devolve null quando o Google não acha o endereço ou não há rota. */
export function googleRoutes(key: string, fetchFn: typeof fetch = fetch): RouteFn {
  return async (origin, destination) => {
    const res = await fetchFn(ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // só os campos necessários (menos dados e sem custo extra)
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,geocodingResults',
      },
      body: JSON.stringify({
        origin: { address: origin }, destination: { address: destination },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', // sem trânsito: faixa "Essentials" (mais barata)
        languageCode: 'pt-BR', regionCode: 'br', units: 'METRIC',
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = String(data?.error?.message ?? res.status);
      throw Object.assign(new Error(`Mapa indisponível (${msg.slice(0, 160)})`), { status: 502, provider: true });
    }
    const r = data?.routes?.[0];
    if (!r || typeof r.distanceMeters !== 'number') return null;
    const dest = data?.geocodingResults?.destination;
    const types: string[] = dest?.type ?? [];
    const approximate = !!dest?.partialMatch || (types.length > 0 && !types.some((t) => EXACT_TYPES.includes(t)));
    return { meters: r.distanceMeters, seconds: Number(String(r.duration ?? '0s').replace(/s$/, '')) || 0, approximate };
  };
}

export function routeFromEnv(env = process.env): RouteFn | null {
  return env.GOOGLE_MAPS_API_KEY ? googleRoutes(env.GOOGLE_MAPS_API_KEY) : null;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Endereço completo para o mapa: rua e número, bairro e a cidade do restaurante. */
export function fullAddress(street: string, neighborhood: string | null | undefined, city: string) {
  return [street.trim(), neighborhood?.trim(), city.trim(), 'Brasil'].filter(Boolean).join(', ');
}

/**
 * Distância com cache no banco: o mesmo endereço não é consultado de novo (economiza a cota do Google).
 * Resultados "não encontrado" ficam guardados por 1 dia; os encontrados, por 180 dias.
 */
export async function cachedDistance(db: DB, route: RouteFn, origin: string, destination: string) {
  const key = norm(origin) + ' => ' + norm(destination);
  const row = db.prepare('SELECT meters, seconds, approximate, found, created_at FROM distance_cache WHERE cache_key = ?').get(key) as any;
  const ageDays = row ? (Date.now() - Date.parse(row.created_at)) / 86_400_000 : Infinity;
  if (row && ageDays < (row.found ? 180 : 1)) {
    return { cached: true, result: row.found ? { meters: row.meters, seconds: row.seconds, approximate: !!row.approximate } : null };
  }
  const result = await route(origin, destination);
  db.prepare(`INSERT INTO distance_cache(cache_key, meters, seconds, approximate, found, created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET meters=excluded.meters, seconds=excluded.seconds, approximate=excluded.approximate, found=excluded.found, created_at=excluded.created_at`)
    .run(key, result?.meters ?? null, result?.seconds ?? null, result?.approximate ? 1 : 0, result ? 1 : 0, new Date().toISOString());
  return { cached: false, result };
}
