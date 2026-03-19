import { PrismaClient, Prisma } from '@prisma/client';
import { SPORTS, getEnabledSports, SPORT_NAMES } from '../src/config/sports.js';

const prisma = new PrismaClient();

const API_KEY = process.env.THE_ODDS_API_KEY;
const BASE_URL = process.env.THE_ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4';
const REGIONS = process.env.THE_ODDS_API_REGIONS || 'uk';
const MARKETS = process.env.THE_ODDS_API_MARKETS || 'h2h';

const ALL_SPORTS = SPORTS.map((s) => s.key);

async function fetchOdds(sportKey: string) {
  const url = new URL(`${BASE_URL}/sports/${sportKey}/odds`);
  url.searchParams.set('apiKey', API_KEY!);
  url.searchParams.set('regions', REGIONS);
  url.searchParams.set('markets', MARKETS);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error ${res.status} for ${sportKey}`);

  const remaining = res.headers.get('x-requests-remaining');
  console.log(`  API credits remaining: ${remaining}`);

  return res.json() as Promise<Array<{
    id: string;
    sport_key: string;
    commence_time: string;
    home_team?: string;
    away_team?: string;
    bookmakers?: Array<{
      markets?: Array<{
        outcomes?: Array<{ name: string; price: number }>;
      }>;
    }>;
  }>>;
}

async function importSport(sportKey: string) {
  console.log(`\n📥 Importing ${SPORT_NAMES[sportKey] || sportKey}...`);

  const apiEvents = await fetchOdds(sportKey);
  let imported = 0;
  let skipped = 0;

  for (const apiEvent of apiEvents) {
    const startsAt = new Date(apiEvent.commence_time);
    if (startsAt.getTime() <= Date.now()) {
      skipped++;
      continue;
    }

    const existing = await prisma.event.findFirst({
      where: { externalEventId: apiEvent.id },
    });

    if (existing) {
      // Update odds on existing event
      const outcomes = apiEvent.bookmakers?.[0]?.markets?.[0]?.outcomes ?? [];
      if (outcomes.length > 0) {
        await prisma.event.update({
          where: { id: existing.id },
          data: {
            currentOdds: {
              outcomes,
              updatedAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
            oddsUpdatedAt: new Date(),
          },
        });
      }
      skipped++;
      continue;
    }

    const outcomes = apiEvent.bookmakers?.[0]?.markets?.[0]?.outcomes ?? [];
    if (outcomes.length < 2) {
      skipped++;
      continue;
    }

    const outcomeNames = outcomes.map((o) => o.name);
    const title = apiEvent.home_team && apiEvent.away_team
      ? `${apiEvent.home_team} vs ${apiEvent.away_team}`
      : outcomeNames.filter((n) => n.toLowerCase() !== 'draw').join(' vs ');

    await prisma.event.create({
      data: {
        title,
        description: SPORT_NAMES[sportKey] || sportKey,
        startsAt,
        outcomes: outcomeNames,
        payoutMultiplier: 2.0,
        status: 'OPEN',
        externalEventId: apiEvent.id,
        externalSportKey: sportKey,
        currentOdds: {
          outcomes,
          updatedAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
        oddsUpdatedAt: new Date(),
      },
    });

    imported++;
    console.log(`  ✅ ${title}`);
  }

  console.log(`  Done: ${imported} imported, ${skipped} skipped`);
  return { imported, skipped };
}

async function main() {
  if (!API_KEY) {
    console.error('❌ THE_ODDS_API_KEY not set in .env');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const filteredArgs = args.filter((a) => !a.startsWith('--'));
  const sports = args.includes('--all')
    ? ALL_SPORTS
    : args.includes('--all-enabled')
      ? getEnabledSports().map((s) => s.key)
      : filteredArgs.length > 0
        ? filteredArgs
        : ALL_SPORTS;

  console.log('🎯 Prediction Platform — Event Import');
  console.log(`Sports: ${sports.map((s) => SPORT_NAMES[s] || s).join(', ')}`);

  let totalImported = 0;
  let totalSkipped = 0;

  for (const sport of sports) {
    try {
      const result = await importSport(sport);
      totalImported += result.imported;
      totalSkipped += result.skipped;
    } catch (error) {
      console.error(`  ❌ Failed: ${error}`);
    }
  }

  console.log(`\n🏁 Total: ${totalImported} imported, ${totalSkipped} skipped`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});