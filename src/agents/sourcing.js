/**
 * Lead sourcing — the real thing.
 *
 * Two live providers, both returning businesses that exist in a public
 * dataset, each with a real source URL:
 *
 *   osm    — OpenStreetMap via Nominatim (geocode) + Overpass (query).
 *            Free, no key, works out of the box. Data quality varies by city.
 *   places — Google Places API (New) Text Search.
 *            Needs GOOGLE_PLACES_API_KEY. Best coverage for Indian SMBs,
 *            includes rating + review count, which is the strongest
 *            "this business is real and active" signal.
 *
 * Rules this module keeps:
 *   - nothing is invented; every row comes from a fetch or is dropped
 *   - every row carries the exact public URL it came from
 *   - every row still lands in the office as "Needs human verification"
 *     because a dataset cannot tell you the cafe is still open
 *   - cache/no-network failures are reported plainly, never filled with fake rows
 */
import { config } from '../config.js';

/* ── niche → OSM tags ────────────────────────────────────────── */

const TAG_MAP = [
  { words: ['cafe', 'coffee', 'bakery cafe', 'chai'], tags: [['amenity', 'cafe']] },
  { words: ['restaurant', 'diner', 'eatery', 'bistro'], tags: [['amenity', 'restaurant']] },
  { words: ['fast food', 'qsr', 'cloud kitchen', 'food'], tags: [['amenity', 'fast_food'], ['amenity', 'restaurant']] },
  { words: ['dentist', 'dental'], tags: [['amenity', 'dentist']] },
  { words: ['clinic', 'doctor', 'physician', 'medical'], tags: [['amenity', 'clinic'], ['amenity', 'doctors']] },
  { words: ['hospital'], tags: [['amenity', 'hospital']] },
  { words: ['gym', 'fitness', 'crossfit'], tags: [['leisure', 'fitness_centre']] },
  { words: ['yoga', 'pilates'], tags: [['leisure', 'fitness_centre'], ['sport', 'yoga']] },
  { words: ['salon', 'hairdresser', 'parlour', 'parlor', 'beauty'], tags: [['shop', 'hairdresser'], ['shop', 'beauty']] },
  { words: ['spa', 'massage'], tags: [['leisure', 'spa'], ['shop', 'massage']] },
  { words: ['bakery', 'cake', 'patisserie'], tags: [['shop', 'bakery'], ['shop', 'confectionery']] },
  { words: ['hotel', 'stay', 'resort'], tags: [['tourism', 'hotel'], ['tourism', 'guest_house']] },
  { words: ['grocery', 'kirana', 'supermarket'], tags: [['shop', 'supermarket'], ['shop', 'convenience']] },
  { words: ['boutique', 'clothing', 'fashion', 'apparel'], tags: [['shop', 'clothes']] },
  { words: ['jewellery', 'jewelry', 'jeweller'], tags: [['shop', 'jewelry']] },
  { words: ['furniture', 'interior', 'decor'], tags: [['shop', 'furniture'], ['shop', 'interior_decoration']] },
  { words: ['real estate', 'property', 'builder'], tags: [['office', 'estate_agent']] },
  { words: ['school', 'coaching', 'tuition', 'institute'], tags: [['amenity', 'school'], ['amenity', 'training']] },
  { words: ['lawyer', 'advocate', 'legal', 'ca', 'chartered'], tags: [['office', 'lawyer'], ['office', 'accountant']] },
  { words: ['garage', 'car repair', 'service centre', 'auto'], tags: [['shop', 'car_repair']] },
  { words: ['photographer', 'studio'], tags: [['shop', 'photo'], ['craft', 'photographer']] },
  { words: ['travel', 'tour'], tags: [['shop', 'travel_agency']] },
];

const GENERIC_TAGS = [
  ['shop', 'hairdresser'],
  ['amenity', 'cafe'],
  ['amenity', 'restaurant'],
];

export function tagsForNiche(niche) {
  const text = String(niche || '').toLowerCase();
  for (const entry of TAG_MAP) {
    if (entry.words.some((word) => text.includes(word))) return entry.tags;
  }
  return GENERIC_TAGS;
}

/* ── helpers ─────────────────────────────────────────────────── */

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const first = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return clean(value);
    if (value && typeof value === 'object' && !Array.isArray(value) && value.text) return clean(value.text);
  }
  return '';
};

async function getJson(url, { method = 'GET', headers = {}, body, timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  try {
    let response;
    try {
      response = await fetch(url, { method, headers, body, signal: controller.signal });
    } catch (networkError) {
      if (networkError.name === 'AbortError') {
        throw new Error(`${host} did not answer within ${Math.round(timeoutMs / 1000)}s.`);
      }
      const code = networkError.cause?.code || networkError.code || '';
      throw new Error(
        `Could not reach ${host}${code ? ` (${code})` : ''}. Check this machine's internet connection or firewall.`,
      );
    }
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!response.ok) {
      const detail = json?.error?.message || json?.error || text.slice(0, 200) || response.statusText;
      throw new Error(`${response.status} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }
    if (!json) throw new Error('Response was not JSON');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/* ── scoring: the actual sales signal ────────────────────────── */

/**
 * A business with reviews but no website is the best prospect: it is real,
 * it has customers, and it is visibly under-served online.
 */
export function scoreProspect(place) {
  let score = 20;
  const signals = [];

  // A business with customers but no website is the best pitch.
  if (place.website) {
    score += 6;
    signals.push('Website listed — reachable by email/form');
  } else {
    score += 20;
    signals.push('No website — strongest pitch angle');
  }

  // Reachability matters more than perfection: an unreachable lead is dead.
  if (place.phone) {
    score += 10;
    signals.push('Phone number published');
  } else {
    score -= 6;
    signals.push('No phone published — harder first contact');
  }

  if (place.address) score += 3;

  const rating = Number(place.rating);
  if (Number.isFinite(rating) && rating > 0) {
    if (rating >= 4.4) {
      score += 14;
      signals.push(`${rating.toFixed(1)}★ — customers clearly like it`);
    } else if (rating >= 4.0) {
      score += 9;
      signals.push(`${rating.toFixed(1)}★ — solid reputation`);
    } else if (rating >= 3.5) {
      score += 4;
      signals.push(`${rating.toFixed(1)}★ — reputation needs work (good angle)`);
    } else {
      signals.push(`${rating.toFixed(1)}★ — low rating, lead with care`);
    }
  }

  const reviews = Number(place.reviews);
  if (Number.isFinite(reviews) && reviews > 0) {
    if (reviews >= 200) {
      score += 14;
      signals.push(`${reviews} reviews — established, busy`);
    } else if (reviews >= 50) {
      score += 11;
      signals.push(`${reviews} reviews — active customer base`);
    } else if (reviews >= 10) {
      score += 7;
      signals.push(`${reviews} reviews — small but real`);
    } else {
      score += 3;
      signals.push(`${reviews} reviews — quiet, verify it is open`);
    }
  }

  if (place.openingHours) {
    score += 4;
    signals.push('Opening hours published — likely operating');
  }

  return { score: Math.max(4, Math.min(98, Math.round(score))), signals };
}

/* ── OpenStreetMap provider ──────────────────────────────────── */

async function geocode(location) {
  const url = new URL('/search', config.sourcing.nominatimUrl);
  url.searchParams.set('q', location);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '0');

  const rows = await getJson(url.toString(), {
    headers: { 'User-Agent': config.sourcing.userAgent, Accept: 'application/json' },
    timeoutMs: 15_000,
  });
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(`Could not find "${location}". Try a city name like "Pune, India".`);
  }
  const row = rows[0];
  const [south, north, west, east] = (row.boundingbox || []).map(Number);
  if (![south, north, west, east].every(Number.isFinite)) {
    throw new Error(`No map bounds returned for "${location}".`);
  }
  return { name: clean(row.display_name), south, north, west, east, lat: Number(row.lat), lon: Number(row.lon) };
}

async function searchOsm({ niche, location, limit = 25 }) {
  const area = await geocode(location);
  const tags = tagsForNiche(niche);
  const bbox = `${area.south},${area.west},${area.north},${area.east}`;
  const parts = tags
    .map(([key, value]) => `node["${key}"="${value}"](${bbox});way["${key}"="${value}"](${bbox});`)
    .join('');

  const query = `[out:json][timeout:25];(${parts});out center tags ${Math.max(limit * 4, 120)};`;
  const endpoint = config.sourcing.overpassUrl;
  const json = await getJson(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': config.sourcing.userAgent,
    },
    body: new URLSearchParams({ data: query }).toString(),
    timeoutMs: 30_000,
  });

  const elements = Array.isArray(json?.elements) ? json.elements : [];
  const results = [];

  for (const element of elements) {
    const tags2 = element.tags || {};
    const name = clean(tags2.name || tags2['name:en'] || tags2.brand || '');
    if (!name) continue;

    const address = [
      tags2['addr:housenumber'],
      tags2['addr:street'],
      tags2['addr:suburb'] || tags2['addr:neighbourhood'],
      tags2['addr:city'] || area.name.split(',')[0],
      tags2['addr:postcode'],
    ]
      .map(clean)
      .filter(Boolean)
      .join(', ');

    const website = first(tags2.website, tags2['contact:website'], tags2.url, tags2['contact:facebook']);
    const phone = first(tags2.phone, tags2['contact:phone'], tags2['contact:mobile']);
    const openingHours = first(tags2.opening_hours);

    results.push({
      businessName: name,
      category: first(tags2.cuisine, tags2.shop, tags2.amenity, tags2.office, tags2.tourism),
      address,
      website,
      phone,
      rating: null,
      reviews: null,
      openingHours,
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      sourceName: 'OpenStreetMap',
      lat: element.lat ?? element.center?.lat ?? null,
      lon: element.lon ?? element.center?.lon ?? null,
    });
  }

  return { area, results, note: `${elements.length} map objects scanned` };
}

/* ── Google Places provider ──────────────────────────────────── */

async function searchPlaces({ niche, location, limit = 20, key }) {
  const body = JSON.stringify({
    textQuery: `${niche} in ${location}`,
    pageSize: Math.min(Math.max(limit, 1), 20),
    languageCode: 'en',
  });

  const json = await getJson(config.sourcing.placesUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': [
        'places.displayName',
        'places.formattedAddress',
        'places.websiteUri',
        'places.nationalPhoneNumber',
        'places.internationalPhoneNumber',
        'places.rating',
        'places.userRatingCount',
        'places.googleMapsUri',
        'places.primaryTypeDisplayName',
        'places.businessStatus',
        'places.regularOpeningHours.weekdayDescriptions',
      ].join(','),
    },
    body,
    timeoutMs: 25_000,
  });

  const places = Array.isArray(json?.places) ? json.places : [];
  const results = [];

  for (const place of places) {
    const name = first(place.displayName);
    if (!name) continue;
    if (place.businessStatus === 'CLOSED_PERMANENTLY') continue;

    results.push({
      businessName: name,
      category: first(place.primaryTypeDisplayName),
      address: first(place.formattedAddress),
      website: first(place.websiteUri),
      phone: first(place.nationalPhoneNumber, place.internationalPhoneNumber),
      rating: Number.isFinite(place.rating) ? place.rating : null,
      reviews: Number.isFinite(place.userRatingCount) ? place.userRatingCount : null,
      openingHours: (place.regularOpeningHours?.weekdayDescriptions || []).join(' · '),
      sourceUrl: first(place.googleMapsUri),
      sourceName: 'Google Places',
      lat: null,
      lon: null,
    });
  }

  return { area: { name: location }, results, note: `${places.length} places returned` };
}

/* ── public entry point ──────────────────────────────────────── */

export const sourcingStatus = () => ({
  provider: config.sourcing.provider,
  placesKey: Boolean(config.sourcing.placesKey),
  osmReady: true,
  overpassUrl: config.sourcing.overpassUrl,
});

/**
 * Live search. Returns real rows with real source URLs, or a plain error.
 * Never returns placeholder businesses.
 */
export async function sourceLeads({ niche, location, limit = 20, provider = 'auto' } = {}) {
  const wantNiche = clean(niche);
  const wantLocation = clean(location);
  if (!wantNiche) throw new Error('Tell me a niche — for example "cafes".');
  if (!wantLocation) throw new Error('Tell me a city — for example "Pune".');

  const cap = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const key = config.sourcing.placesKey;
  const choice = String(provider || 'auto').toLowerCase();

  let engine = choice;
  if (choice === 'auto') engine = key ? 'places' : 'osm';

  if (engine === 'places' && !key) {
    throw new Error('Google Places needs a key. Add GOOGLE_PLACES_API_KEY in Setup, or use OpenStreetMap (free).');
  }

  const started = Date.now();
  let payload;
  let engineLabel;

  if (engine === 'places') {
    payload = await searchPlaces({ niche: wantNiche, location: wantLocation, limit: cap, key });
    engineLabel = 'Google Places';
  } else {
    payload = await searchOsm({ niche: wantNiche, location: wantLocation, limit: cap });
    engineLabel = 'OpenStreetMap';
  }

  const seen = new Set();
  const scored = [];

  for (const place of payload.results) {
    const dedupeKey = place.businessName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const { score, signals } = scoreProspect(place);
    scored.push({ ...place, score, signals });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, cap);

  return {
    ok: true,
    niche: wantNiche,
    location: wantLocation,
    engine: engineLabel,
    area: payload.area?.name ? clean(payload.area.name) : wantLocation,
    scanned: payload.results.length,
    count: top.length,
    ms: Date.now() - started,
    note: payload.note,
    caveats: [
      'Every row still needs a human check — a dataset cannot confirm the business is open today.',
      placeCaveat(engineLabel),
    ],
    results: top,
  };
}

function placeCaveat(engine) {
  return engine === 'Google Places'
    ? 'Places data is fresher than OSM, but opening status, staff and budget are still unknown.'
    : 'OpenStreetMap is crowd-sourced: some listings are years old. Verify before you write.';
}
