import { Buffer } from 'node:buffer';
import { describe, it, expect } from 'vitest';
import {
  VANG_VONG_MAX_DATA_BYTES,
  VANG_VONG_SUPPORTED_SCHEMA_VERSIONS,
  mapLegacyVangVongState,
  summarizeVangVongSave,
  validateVangVongSave,
} from '../../api/_vang-vong-save.js';

const FIXED_NOW = Date.UTC(2026, 10, 25, 12, 0, 0);

function validSave(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    gold: 5000,
    currentStageIndex: 3,
    maxUnlockedStage: 5,
    towerFloor: 12,
    maxTowerFloor: 15,
    worldBossTotalDamage: 123456,
    pvpRank: 8,
    pvpScore: 1250,
    rankLevel: 4,
    battleSpeed: 2,
    lastIdleClaimTime: FIXED_NOW - 1000,
    isMuted: false,
    activeBeastId: 'beast_kim_quy',
    heroes: [
      {
        id: 'hero_1',
        name: 'Lê Lợi',
        level: 10,
        stars: 3,
        slotIndex: 0,
        equippedItemIds: ['item_sword_1', 'item_ring_2'],
      },
      {
        id: 'hero_2',
        name: 'Trần Hưng Đạo',
        level: 12,
        stars: 4,
        slotIndex: 1,
        equippedItemIds: [],
      },
    ],
    shards: {
      'Lê Lợi': 15,
      'Nguyễn Trãi': 30,
    },
    ...overrides,
  };
}

describe('vang-vong cloud-save schema module', () => {
  it('exports expected constants', () => {
    expect(VANG_VONG_SUPPORTED_SCHEMA_VERSIONS).toEqual([1]);
    expect(Object.isFrozen(VANG_VONG_SUPPORTED_SCHEMA_VERSIONS)).toBe(true);
    expect(VANG_VONG_MAX_DATA_BYTES).toBe(65536);
  });

  it('1. validates a normal save and returns a fresh normalized copy', () => {
    const input = validSave();
    const result = validateVangVongSave(input, { nowMs: FIXED_NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual(input);
    expect(result.value).not.toBe(input);
    expect(result.value.heroes).not.toBe(input.heroes);
    expect(result.value.heroes[0]).not.toBe(input.heroes[0]);
    expect(result.value.heroes[0].equippedItemIds).not.toBe(input.heroes[0].equippedItemIds);
    expect(result.value.shards).not.toBe(input.shards);
  });

  it('2. validates worst-case 64 heroes and 64 shards within 60000 bytes (Vietnamese and astral)', () => {
    const makeWorstCase = (makeName: (i: number) => string) => {
      const heroes = Array.from({ length: 64 }, (_, i) => ({
        id: `h${String(i).padStart(2, '0')}_${'a'.repeat(28)}`,
        name: makeName(i),
        level: 9999,
        stars: 5,
        slotIndex: -1,
        equippedItemIds: Array.from(
          { length: 8 },
          (_, j) => `i${j}_${String(i).padStart(2, '0')}_${'b'.repeat(26)}`,
        ),
      }));
      const shards: Record<string, number> = {};
      for (let i = 0; i < 64; i += 1) {
        shards[makeName(i)] = 9999999;
      }
      return validSave({
        gold: 1e12,
        currentStageIndex: 999,
        maxUnlockedStage: 999,
        towerFloor: 9999,
        maxTowerFloor: 9999,
        worldBossTotalDamage: Number.MAX_SAFE_INTEGER,
        pvpRank: 99,
        pvpScore: 1e7,
        rankLevel: 999,
        battleSpeed: 3,
        lastIdleClaimTime: FIXED_NOW + 300000,
        isMuted: true,
        activeBeastId: 'b'.repeat(40),
        heroes,
        shards,
      });
    };

    const vnSave = makeWorstCase((i) => `${'ữ'.repeat(38)}${String(i).padStart(2, '0')}`);
    const vnResult = validateVangVongSave(vnSave, { nowMs: FIXED_NOW });
    expect(vnResult.ok).toBe(true);
    if (vnResult.ok) {
      expect(Buffer.byteLength(JSON.stringify(vnResult.value), 'utf8')).toBeLessThanOrEqual(60000);
    }

    const astralSave = makeWorstCase(
      (i) => `${'𝔸'.repeat(39)}${String.fromCodePoint(0x1f600 + i)}`,
    );
    const astralResult = validateVangVongSave(astralSave, { nowMs: FIXED_NOW });
    expect(astralResult.ok).toBe(true);
    if (astralResult.ok) {
      expect(Buffer.byteLength(JSON.stringify(astralResult.value), 'utf8')).toBeLessThanOrEqual(
        60000,
      );
    }
  });

  it('3. rejects unknown root key without leaking key text in error object', () => {
    const input = validSave({ SENTINEL_KEY_X: 123 });
    const result = validateVangVongSave(input, { nowMs: FIXED_NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_save');
    expect(result.path).toMatch(/^#k\d+$/);
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });

  it('4. rejects __proto__ from JSON.parse and constructor own key on hero', () => {
    const rawJson = JSON.stringify(validSave()).replace(
      '{',
      '{"__proto__":{"x":1},',
    );
    const parsed = JSON.parse(rawJson);
    const protoResult = validateVangVongSave(parsed, { nowMs: FIXED_NOW });
    expect(protoResult.ok).toBe(false);
    if (!protoResult.ok) {
      expect(protoResult.error).toBe('invalid_save');
    }

    const inputWithHeroConstructor = validSave();
    Object.defineProperty(inputWithHeroConstructor.heroes[0], 'constructor', {
      value: { evil: true },
      enumerable: true,
      configurable: true,
    });
    const ctorResult = validateVangVongSave(inputWithHeroConstructor, { nowMs: FIXED_NOW });
    expect(ctorResult.ok).toBe(false);
    if (!ctorResult.ok) {
      expect(ctorResult.error).toBe('invalid_save');
    }
  });

  it('5. rejects extra key on a hero with heroes[0] path prefix', () => {
    const input = validSave();
    (input.heroes[0] as Record<string, unknown>).extraHeroField = 'nope';
    const result = validateVangVongSave(input, { nowMs: FIXED_NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_save');
    expect(result.path.startsWith('heroes[0]')).toBe(true);
    expect(result.path).not.toContain('extraHeroField');
  });

  it('6. checks schemaVersion first: missing -> invalid_save, 2 -> unsupported_schema', () => {
    const missing = validSave();
    delete (missing as Record<string, unknown>).schemaVersion;
    const missingRes = validateVangVongSave(missing, { nowMs: FIXED_NOW });
    expect(missingRes).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'schemaVersion',
    });

    const unsupported = validSave({ schemaVersion: 2 });
    const unsupportedRes = validateVangVongSave(unsupported, { nowMs: FIXED_NOW });
    expect(unsupportedRes).toEqual({
      ok: false,
      error: 'unsupported_schema',
      path: 'schemaVersion',
    });
  });

  it('7. rejects unsafe integer, float, and stringified number', () => {
    const unsafeGold = validateVangVongSave(validSave({ gold: 2 ** 53 }), { nowMs: FIXED_NOW });
    expect(unsafeGold).toEqual({ ok: false, error: 'invalid_save', path: 'gold' });

    const floatLevelInput = validSave();
    floatLevelInput.heroes[0].level = 1.5;
    const floatLevel = validateVangVongSave(floatLevelInput, { nowMs: FIXED_NOW });
    expect(floatLevel).toEqual({ ok: false, error: 'invalid_save', path: 'heroes[0].level' });

    const stringGold = validateVangVongSave(validSave({ gold: '1' }), { nowMs: FIXED_NOW });
    expect(stringGold).toEqual({ ok: false, error: 'invalid_save', path: 'gold' });
  });

  describe('8. integer boundary checks', () => {
    const rootBounds: Array<[string, number, number]> = [
      ['gold', 0, 1e12],
      ['currentStageIndex', 0, 999],
      ['maxUnlockedStage', 0, 999],
      ['towerFloor', 1, 9999],
      ['maxTowerFloor', 1, 9999],
      ['worldBossTotalDamage', 0, Number.MAX_SAFE_INTEGER],
      ['pvpRank', 1, 99],
      ['pvpScore', 0, 1e7],
      ['rankLevel', 1, 999],
    ];

    it.each(rootBounds)('enforces bounds for %s (%i..%i)', (field, min, max) => {
      expect(validateVangVongSave(validSave({ [field]: min }), { nowMs: FIXED_NOW }).ok).toBe(true);
      expect(validateVangVongSave(validSave({ [field]: max }), { nowMs: FIXED_NOW }).ok).toBe(true);

      const below = validateVangVongSave(validSave({ [field]: min - 1 }), { nowMs: FIXED_NOW });
      expect(below).toEqual({ ok: false, error: 'invalid_save', path: field });

      const above = validateVangVongSave(validSave({ [field]: max + 1 }), { nowMs: FIXED_NOW });
      expect(above).toEqual({ ok: false, error: 'invalid_save', path: field });
    });

    it('enforces battleSpeed in {1, 2, 3}', () => {
      for (const speed of [1, 2, 3]) {
        expect(validateVangVongSave(validSave({ battleSpeed: speed }), { nowMs: FIXED_NOW }).ok).toBe(
          true,
        );
      }
      expect(validateVangVongSave(validSave({ battleSpeed: 0 }), { nowMs: FIXED_NOW })).toEqual({
        ok: false,
        error: 'invalid_save',
        path: 'battleSpeed',
      });
      expect(validateVangVongSave(validSave({ battleSpeed: 4 }), { nowMs: FIXED_NOW })).toEqual({
        ok: false,
        error: 'invalid_save',
        path: 'battleSpeed',
      });
    });

    it('enforces hero level, stars, slotIndex, and shard value bounds', () => {
      const heroBounds: Array<['level' | 'stars' | 'slotIndex', number, number]> = [
        ['level', 1, 9999],
        ['stars', 0, 5],
        ['slotIndex', -1, 5],
      ];

      for (const [field, min, max] of heroBounds) {
        const atMin = validSave();
        atMin.heroes[0][field] = min;
        expect(validateVangVongSave(atMin, { nowMs: FIXED_NOW }).ok).toBe(true);

        const atMax = validSave();
        atMax.heroes[0][field] = max;
        expect(validateVangVongSave(atMax, { nowMs: FIXED_NOW }).ok).toBe(true);

        const below = validSave();
        below.heroes[0][field] = min - 1;
        expect(validateVangVongSave(below, { nowMs: FIXED_NOW })).toEqual({
          ok: false,
          error: 'invalid_save',
          path: `heroes[0].${field}`,
        });

        const above = validSave();
        above.heroes[0][field] = max + 1;
        expect(validateVangVongSave(above, { nowMs: FIXED_NOW })).toEqual({
          ok: false,
          error: 'invalid_save',
          path: `heroes[0].${field}`,
        });
      }

      expect(
        validateVangVongSave(validSave({ shards: { 'Lê Lợi': 0 } }), { nowMs: FIXED_NOW }).ok,
      ).toBe(true);
      expect(
        validateVangVongSave(validSave({ shards: { 'Lê Lợi': 9999999 } }), { nowMs: FIXED_NOW }).ok,
      ).toBe(true);
      expect(
        validateVangVongSave(validSave({ shards: { 'Lê Lợi': -1 } }), { nowMs: FIXED_NOW }),
      ).toEqual({
        ok: false,
        error: 'invalid_save',
        path: 'shards[#0].value',
      });
      expect(
        validateVangVongSave(validSave({ shards: { 'Lê Lợi': 10000000 } }), { nowMs: FIXED_NOW }),
      ).toEqual({
        ok: false,
        error: 'invalid_save',
        path: 'shards[#0].value',
      });
    });
  });

  it('9. enforces lastIdleClaimTime minimum and clamps future timestamps to nowMs', () => {
    expect(
      validateVangVongSave(validSave({ lastIdleClaimTime: Date.UTC(2023, 11, 31) }), {
        nowMs: FIXED_NOW,
      }),
    ).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'lastIdleClaimTime',
    });

    const futureRes = validateVangVongSave(
      validSave({ lastIdleClaimTime: FIXED_NOW + 10 * 60 * 1000 }),
      { nowMs: FIXED_NOW },
    );
    expect(futureRes.ok).toBe(true);
    if (futureRes.ok) {
      expect(futureRes.value.lastIdleClaimTime).toBe(FIXED_NOW);
    }

    const pastRes = validateVangVongSave(validSave({ lastIdleClaimTime: FIXED_NOW - 1000 }), {
      nowMs: FIXED_NOW,
    });
    expect(pastRes.ok).toBe(true);
    if (pastRes.ok) {
      expect(pastRes.value.lastIdleClaimTime).toBe(FIXED_NOW - 1000);
    }
  });

  it('10. enforces string rules (surrogates, NFC, control chars, length, and redacted shard paths)', () => {
    const badNames = [
      '\uD800',
      'e\u0301',
      'hero\nname',
      'a'.repeat(41),
      '',
    ];

    for (const badName of badNames) {
      const save = validSave();
      save.heroes[0].name = badName;
      expect(validateVangVongSave(save, { nowMs: FIXED_NOW })).toEqual({
        ok: false,
        error: 'invalid_save',
        path: 'heroes[0].name',
      });
    }

    const secretShardKey = 'SECRET_SHARD\u0007';
    const badShardSave = validSave({
      shards: {
        [secretShardKey]: 5,
      },
    });
    const shardResult = validateVangVongSave(badShardSave, { nowMs: FIXED_NOW });
    expect(shardResult).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'shards[#0]',
    });
    expect(JSON.stringify(shardResult)).not.toContain('SECRET_SHARD');
  });

  it('11. rejects duplicate hero id, name, or non-negative slotIndex, but allows repeated -1', () => {
    const dupId = validSave();
    dupId.heroes[1].id = dupId.heroes[0].id;
    expect(validateVangVongSave(dupId, { nowMs: FIXED_NOW })).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'heroes[1].id',
    });

    const dupName = validSave();
    dupName.heroes[1].name = dupName.heroes[0].name;
    expect(validateVangVongSave(dupName, { nowMs: FIXED_NOW })).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'heroes[1].name',
    });

    const dupSlot = validSave();
    dupSlot.heroes[1].slotIndex = 0;
    expect(validateVangVongSave(dupSlot, { nowMs: FIXED_NOW })).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'heroes[1].slotIndex',
    });

    const benchSlots = validSave();
    benchSlots.heroes[0].slotIndex = -1;
    benchSlots.heroes[1].slotIndex = -1;
    expect(validateVangVongSave(benchSlots, { nowMs: FIXED_NOW }).ok).toBe(true);
  });

  it('12. enforces array and object cardinality limits', () => {
    const nineItems = validSave();
    nineItems.heroes[0].equippedItemIds = Array.from({ length: 9 }, (_, i) => `item_${i}`);
    expect(validateVangVongSave(nineItems, { nowMs: FIXED_NOW })).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'heroes[0].equippedItemIds',
    });

    const dupItems = validSave();
    dupItems.heroes[0].equippedItemIds = ['item_1', 'item_1'];
    expect(validateVangVongSave(dupItems, { nowMs: FIXED_NOW })).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'heroes[0].equippedItemIds[1]',
    });

    const sixtyFiveHeroes = validSave({
      heroes: Array.from({ length: 65 }, (_, i) => ({
        id: `hero_${i}`,
        name: `Anh Hùng ${i}`,
        level: 1,
        stars: 0,
        slotIndex: -1,
        equippedItemIds: [],
      })),
    });
    expect(validateVangVongSave(sixtyFiveHeroes, { nowMs: FIXED_NOW })).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'heroes',
    });

    const tooManyShards: Record<string, number> = {};
    for (let i = 0; i < 65; i += 1) {
      tooManyShards[`Shard ${i}`] = 1;
    }
    expect(validateVangVongSave(validSave({ shards: tooManyShards }), { nowMs: FIXED_NOW })).toEqual(
      {
        ok: false,
        error: 'invalid_save',
        path: 'shards',
      },
    );
  });

  it('13. rejects nested arrays inside equippedItemIds (max depth 4)', () => {
    const nested = validSave();
    (nested.heroes[0].equippedItemIds as unknown[]) = [['nested_item']];
    expect(validateVangVongSave(nested, { nowMs: FIXED_NOW })).toEqual({
      ok: false,
      error: 'invalid_save',
      path: 'heroes[0].equippedItemIds[0]',
    });
  });

  it('14. summarizeVangVongSave returns exactly the 7 expected integer keys', () => {
    const result = validateVangVongSave(validSave(), { nowMs: FIXED_NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const summary = summarizeVangVongSave(result.value);
    expect(Object.keys(summary).sort()).toEqual([
      'currentStageIndex',
      'gold',
      'heroCount',
      'maxTowerFloor',
      'maxUnlockedStage',
      'pvpScore',
      'rankLevel',
    ]);
    expect(summary).toEqual({
      currentStageIndex: 3,
      maxUnlockedStage: 5,
      maxTowerFloor: 15,
      rankLevel: 4,
      pvpScore: 1250,
      gold: 5000,
      heroCount: 2,
    });
  });

  describe('15. mapLegacyVangVongState', () => {
    it('strips combat stats, inventory, enemy heroes, and extra root keys, then validates OK', () => {
      const legacy = {
        gold: 9000,
        currentStageIndex: 4,
        maxUnlockedStage: 6,
        towerFloor: 20,
        maxTowerFloor: 25,
        worldBossTotalDamage: 50000,
        pvpRank: 5,
        pvpScore: 1500,
        rankLevel: 3,
        battleSpeed: 2,
        lastIdleClaimTime: FIXED_NOW - 5000,
        isMuted: true,
        activeBeastId: 'beast_ho_ly',
        inventory: [{ id: 'sword_1', qty: 1 }],
        extraLegacyField: 'ignored',
        heroes: [
          {
            id: 'hero_a',
            name: 'Hai Bà Trưng',
            level: 20,
            stars: 5,
            slotIndex: 0,
            equippedItemIds: ['item_a'],
            atk: 999,
            maxHp: 5000,
            hp: 5000,
            rage: 100,
            skill: { name: 'Slash' },
            avatarUrl: 'https://example.com/a.png',
          },
          {
            id: 'enemy_1',
            name: 'Quái Vật',
            level: 10,
            stars: 1,
            slotIndex: 0,
            equippedItemIds: [],
            isEnemy: true,
          },
        ],
        shards: {
          'Hai Bà Trưng': 42,
        },
      };

      const mapped = mapLegacyVangVongState(legacy, { nowMs: FIXED_NOW });
      expect(mapped).not.toBeNull();
      expect(mapped).not.toHaveProperty('inventory');
      expect(mapped).not.toHaveProperty('extraLegacyField');
      expect(mapped?.heroes).toHaveLength(1);
      expect(mapped?.heroes[0]).not.toHaveProperty('atk');
      expect(mapped?.heroes[0]).not.toHaveProperty('maxHp');

      const validated = validateVangVongSave(mapped, { nowMs: FIXED_NOW });
      expect(validated.ok).toBe(true);
    });

    it('applies defaults for missing scalars and returns null for non-plain objects', () => {
      expect(mapLegacyVangVongState(null)).toBeNull();
      expect(mapLegacyVangVongState([])).toBeNull();
      expect(mapLegacyVangVongState('x')).toBeNull();

      const mapped = mapLegacyVangVongState({}, { nowMs: FIXED_NOW });
      expect(mapped).toEqual({
        schemaVersion: 1,
        gold: 5000,
        currentStageIndex: 0,
        maxUnlockedStage: 0,
        towerFloor: 1,
        maxTowerFloor: 1,
        worldBossTotalDamage: 0,
        pvpRank: 8,
        pvpScore: 1250,
        rankLevel: 1,
        battleSpeed: 1,
        lastIdleClaimTime: FIXED_NOW,
        isMuted: false,
        activeBeastId: 'beast_kim_quy',
        heroes: [],
        shards: {},
      });
    });

    it('does not coerce invalid types like string level, leaving validation to reject', () => {
      const legacy = {
        heroes: [
          {
            id: 'hero_1',
            name: 'Lê Lợi',
            level: '5',
            stars: 1,
            slotIndex: 0,
            equippedItemIds: [],
          },
        ],
      };

      const mapped = mapLegacyVangVongState(legacy, { nowMs: FIXED_NOW });
      expect(mapped?.heroes[0].level).toBe('5');

      const validated = validateVangVongSave(mapped, { nowMs: FIXED_NOW });
      expect(validated).toEqual({
        ok: false,
        error: 'invalid_save',
        path: 'heroes[0].level',
      });
    });

    it('clamps pre-2024 and far-future lastIdleClaimTime values and falls back for non-numbers', () => {
      const minIdleClaimMs = Date.UTC(2024, 0, 1);
      const baseHeroes = [
        {
          id: 'hero_1',
          name: 'Lê Lợi',
          level: 1,
          stars: 1,
          slotIndex: 0,
          equippedItemIds: [],
        },
      ];

      const pre2024 = mapLegacyVangVongState(
        { lastIdleClaimTime: 1600000000000, heroes: baseHeroes },
        { nowMs: FIXED_NOW },
      );
      expect(pre2024?.lastIdleClaimTime).toBe(minIdleClaimMs);
      expect(validateVangVongSave(pre2024, { nowMs: FIXED_NOW }).ok).toBe(true);

      const farFuture = mapLegacyVangVongState(
        { lastIdleClaimTime: FIXED_NOW + 365 * 24 * 60 * 60 * 1000, heroes: baseHeroes },
        { nowMs: FIXED_NOW },
      );
      expect(farFuture?.lastIdleClaimTime).toBe(FIXED_NOW);
      expect(validateVangVongSave(farFuture, { nowMs: FIXED_NOW }).ok).toBe(true);

      const nonNumber = mapLegacyVangVongState(
        { lastIdleClaimTime: 'not-a-number', heroes: baseHeroes },
        { nowMs: FIXED_NOW },
      );
      expect(nonNumber?.lastIdleClaimTime).toBe(FIXED_NOW);
    });
  });
});
