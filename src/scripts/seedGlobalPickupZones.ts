import "dotenv/config";
import { prisma } from "../lib/prisma.js";

export interface GlobalPickupZoneSeed {
  zoneName: string;
  description: string | null;
  operatorName: string;
  morningPickupTime: string;
  afternoonPickupTime: string;
  morningPierArrival: string;
  afternoonPierArrival: string;
  hasPrivateTransfer: boolean;
  privateTransferCharge: number | null;
  surchargeAmount: number;
  surchargeUnit: "PER_BOOKING" | "PER_VEHICLE" | "PER_PERSON";
  currency: string;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Verified 14 Sunrise Jet Ski Global Pickup Zones (source: local tour_db).
 * All records use serviceId: null so they are shared across packages.
 */
export const GLOBAL_PICKUP_ZONES: GlobalPickupZoneSeed[] = [
  {
    zoneName: "Kata - Karon",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "07:30 AM",
    afternoonPickupTime: "11:30 AM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 0,
  },
  {
    zoneName: "Kamala",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "07:30 AM",
    afternoonPickupTime: "11:30 AM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 1,
  },
  {
    zoneName: "Tritrang",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "07:45 AM",
    afternoonPickupTime: "11:45 AM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 2,
  },
  {
    zoneName: "Kalim, Nakalay",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "07:45 AM",
    afternoonPickupTime: "11:45 AM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 3,
  },
  {
    zoneName: "Patong",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "08:00 AM",
    afternoonPickupTime: "12:00 PM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 4,
  },
  {
    zoneName: "Kathu",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "08:30 AM",
    afternoonPickupTime: "12:30 PM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 5,
  },
  {
    zoneName: "Phuket Town, Koh Sirey",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "08:50 AM",
    afternoonPickupTime: "12:50 PM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 6,
  },
  {
    zoneName: "Surin, Bangtao, Cherngtalay, Laguna",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "07:00 AM",
    afternoonPickupTime: "11:00 AM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 7,
  },
  {
    zoneName: "Chalong, Soi Ta-Aied",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "08:00 AM",
    afternoonPickupTime: "12:00 PM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 8,
  },
  {
    zoneName: "Kohkaew, Sapam, Kuandindaeng",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "08:30 AM",
    afternoonPickupTime: "12:30 PM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 9,
  },
  {
    zoneName: "Rawai, Saiyuan, Nai Harn, Panwa Cape",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "08:00 AM",
    afternoonPickupTime: "12:00 PM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: false,
    privateTransferCharge: null,
    surchargeAmount: 0,
    surchargeUnit: "PER_BOOKING",
    currency: "THB",
    isActive: true,
    sortOrder: 10,
  },
  {
    zoneName: "Layan, Naithon, Naiyang",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "07:00 AM",
    afternoonPickupTime: "11:00 AM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: true,
    privateTransferCharge: null,
    surchargeAmount: 1500,
    surchargeUnit: "PER_VEHICLE",
    currency: "THB",
    isActive: true,
    sortOrder: 11,
  },
  {
    zoneName: "Ao Por, Pa-klok, Yamu",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "07:00 AM",
    afternoonPickupTime: "11:00 AM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: true,
    privateTransferCharge: null,
    surchargeAmount: 1500,
    surchargeUnit: "PER_VEHICLE",
    currency: "THB",
    isActive: true,
    sortOrder: 12,
  },
  {
    zoneName: "Maikhao",
    description: null,
    operatorName: "Sunrise Jetski Safari",
    morningPickupTime: "07:00 AM",
    afternoonPickupTime: "11:00 AM",
    morningPierArrival: "09:00 AM",
    afternoonPierArrival: "01:00 PM",
    hasPrivateTransfer: true,
    privateTransferCharge: null,
    surchargeAmount: 1800,
    surchargeUnit: "PER_VEHICLE",
    currency: "THB",
    isActive: true,
    sortOrder: 13,
  },
];

const normalizeName = (name: string): string =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

export async function seedGlobalPickupZones(): Promise<{
  totalSource: number;
  skipped: number;
  created: number;
  finalGlobalCount: number;
  zoneNames: string[];
}> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  let created = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    const existingGlobals = await tx.pickupZone.findMany({
      where: { serviceId: null },
      select: { id: true, zoneName: true },
    });

    const existingNormalized = new Set(
      existingGlobals.map((z) => normalizeName(z.zoneName))
    );

    for (const zone of GLOBAL_PICKUP_ZONES) {
      const key = normalizeName(zone.zoneName);
      if (existingNormalized.has(key)) {
        skipped += 1;
        continue;
      }

      await tx.pickupZone.create({
        data: {
          serviceId: null,
          zoneName: zone.zoneName,
          description: zone.description,
          operatorName: zone.operatorName,
          morningPickupTime: zone.morningPickupTime,
          afternoonPickupTime: zone.afternoonPickupTime,
          morningPierArrival: zone.morningPierArrival,
          afternoonPierArrival: zone.afternoonPierArrival,
          hasPrivateTransfer: zone.hasPrivateTransfer,
          privateTransferCharge: zone.privateTransferCharge,
          surchargeAmount: zone.surchargeAmount,
          surchargeUnit: zone.surchargeUnit,
          currency: zone.currency,
          isActive: zone.isActive,
          sortOrder: zone.sortOrder,
        },
      });
      existingNormalized.add(key);
      created += 1;
    }
  });

  // Post-seed verification
  const finalGlobals = await prisma.pickupZone.findMany({
    where: { serviceId: null },
    orderBy: [{ sortOrder: "asc" }, { zoneName: "asc" }],
    select: { id: true, zoneName: true, isActive: true, serviceId: true },
  });

  const finalNormalizedMap = new Map<string, number>();
  for (const z of finalGlobals) {
    const key = normalizeName(z.zoneName);
    finalNormalizedMap.set(key, (finalNormalizedMap.get(key) ?? 0) + 1);
  }

  const duplicates = Array.from(finalNormalizedMap.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate normalized global pickup zones detected: ${duplicates.join(", ")}`);
  }

  const missing = GLOBAL_PICKUP_ZONES.filter(
    (z) => !finalNormalizedMap.has(normalizeName(z.zoneName))
  ).map((z) => z.zoneName);
  if (missing.length > 0) {
    throw new Error(`Missing expected global pickup zones after seed: ${missing.join(", ")}`);
  }

  return {
    totalSource: GLOBAL_PICKUP_ZONES.length,
    skipped,
    created,
    finalGlobalCount: finalGlobals.length,
    zoneNames: finalGlobals.map((z) => z.zoneName),
  };
}

async function runCli() {
  try {
    const result = await seedGlobalPickupZones();
    console.log("Global Pickup Zone Seed Summary:");
    console.log(`  Total source zones : ${result.totalSource}`);
    console.log(`  Existing skipped   : ${result.skipped}`);
    console.log(`  Newly created      : ${result.created}`);
    console.log(`  Final global count : ${result.finalGlobalCount}`);
    console.log(`  Zones              : ${result.zoneNames.join(" | ")}`);
  } catch (err) {
    console.error("Global Pickup Zone Seed FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("seedGlobalPickupZones.js") ||
    process.argv[1].endsWith("seedGlobalPickupZones.ts") ||
    process.argv[1].endsWith("seed-global-pickup-zones.ts"));

if (isDirectRun) {
  void runCli();
}
