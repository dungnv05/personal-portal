import { Buffer } from 'node:buffer';

export const VANG_VONG_SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1]);
export const VANG_VONG_MAX_DATA_BYTES = 65536;

const MIN_IDLE_CLAIM_MS = Date.UTC(2024, 0, 1);
const MAX_HEROES = 64;
const MAX_EQUIPPED_ITEMS = 8;
const MAX_SHARD_KEYS = 64;
const MAX_SHARD_VALUE = 9999999;

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const BEAST_ID_RE = /^[a-z0-9_]{1,40}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const ROOT_KEYS = Object.freeze([
  'schemaVersion',
  'gold',
  'currentStageIndex',
  'maxUnlockedStage',
  'towerFloor',
  'maxTowerFloor',
  'worldBossTotalDamage',
  'pvpRank',
  'pvpScore',
  'rankLevel',
  'battleSpeed',
  'lastIdleClaimTime',
  'isMuted',
  'activeBeastId',
  'heroes',
  'shards',
]);
const ROOT_KEY_SET = new Set(ROOT_KEYS);

const HERO_KEYS = Object.freeze([
  'id',
  'name',
  'level',
  'stars',
  'slotIndex',
  'equippedItemIds',
]);
const HERO_KEY_SET = new Set(HERO_KEYS);

const INTEGER_BOUNDS = Object.freeze({
  gold: [0, 1e12],
  currentStageIndex: [0, 999],
  maxUnlockedStage: [0, 999],
  towerFloor: [1, 9999],
  maxTowerFloor: [1, 9999],
  worldBossTotalDamage: [0, Number.MAX_SAFE_INTEGER],
  pvpRank: [1, 99],
  pvpScore: [0, 1e7],
  rankLevel: [1, 999],
});

const LEGACY_SCALAR_DEFAULTS = Object.freeze([
  ['gold', 5000],
  ['currentStageIndex', 0],
  ['maxUnlockedStage', 0],
  ['towerFloor', 1],
  ['maxTowerFloor', 1],
  ['worldBossTotalDamage', 0],
  ['pvpRank', 8],
  ['pvpScore', 1250],
  ['rankLevel', 1],
  ['battleSpeed', 1],
  ['isMuted', false],
  ['activeBeastId', 'beast_kim_quy'],
]);

function fail(error, path) {
  return { ok: false, error, path };
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function findForbiddenOwnKeyIndex(obj) {
  const names = Object.getOwnPropertyNames(obj);
  for (let i = 0; i < names.length; i += 1) {
    if (FORBIDDEN_KEYS.has(names[i])) {
      return i;
    }
  }
  return -1;
}

function isSafeIntInRange(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function isWellFormedString(value) {
  if (typeof value.isWellFormed === 'function') {
    return value.isWellFormed();
  }
  return !LONE_SURROGATE_RE.test(value);
}

function isValidNameString(value) {
  if (typeof value !== 'string') {
    return false;
  }
  if (!isWellFormedString(value)) {
    return false;
  }
  if (value !== value.normalize('NFC')) {
    return false;
  }
  if (CONTROL_CHAR_RE.test(value)) {
    return false;
  }
  const codePointLength = [...value].length;
  return codePointLength >= 1 && codePointLength <= 40;
}

function validateHero(hero, index, seenIds, seenNames, seenSlots) {
  const heroPath = `heroes[${index}]`;
  if (!isPlainObject(hero)) {
    return fail('invalid_save', heroPath);
  }

  const forbiddenIdx = findForbiddenOwnKeyIndex(hero);
  if (forbiddenIdx !== -1) {
    return fail('invalid_save', `${heroPath}.#k${forbiddenIdx}`);
  }

  const ownKeys = Object.keys(hero);
  for (let i = 0; i < ownKeys.length; i += 1) {
    if (!HERO_KEY_SET.has(ownKeys[i])) {
      return fail('invalid_save', `${heroPath}.#k${i}`);
    }
  }

  for (let i = 0; i < HERO_KEYS.length; i += 1) {
    if (!hasOwn(hero, HERO_KEYS[i])) {
      return fail('invalid_save', `${heroPath}.${HERO_KEYS[i]}`);
    }
  }

  if (typeof hero.id !== 'string' || !ID_RE.test(hero.id) || seenIds.has(hero.id)) {
    return fail('invalid_save', `${heroPath}.id`);
  }
  seenIds.add(hero.id);

  if (!isValidNameString(hero.name) || seenNames.has(hero.name)) {
    return fail('invalid_save', `${heroPath}.name`);
  }
  seenNames.add(hero.name);

  if (!isSafeIntInRange(hero.level, 1, 9999)) {
    return fail('invalid_save', `${heroPath}.level`);
  }

  if (!isSafeIntInRange(hero.stars, 0, 5)) {
    return fail('invalid_save', `${heroPath}.stars`);
  }

  if (!isSafeIntInRange(hero.slotIndex, -1, 5)) {
    return fail('invalid_save', `${heroPath}.slotIndex`);
  }
  if (hero.slotIndex >= 0) {
    if (seenSlots.has(hero.slotIndex)) {
      return fail('invalid_save', `${heroPath}.slotIndex`);
    }
    seenSlots.add(hero.slotIndex);
  }

  if (!Array.isArray(hero.equippedItemIds) || hero.equippedItemIds.length > MAX_EQUIPPED_ITEMS) {
    return fail('invalid_save', `${heroPath}.equippedItemIds`);
  }

  const seenItemIds = new Set();
  const normalizedItemIds = [];
  for (let j = 0; j < hero.equippedItemIds.length; j += 1) {
    const itemId = hero.equippedItemIds[j];
    if (typeof itemId !== 'string' || !ID_RE.test(itemId) || seenItemIds.has(itemId)) {
      return fail('invalid_save', `${heroPath}.equippedItemIds[${j}]`);
    }
    seenItemIds.add(itemId);
    normalizedItemIds.push(itemId);
  }

  return {
    ok: true,
    value: {
      id: hero.id,
      name: hero.name,
      level: hero.level,
      stars: hero.stars,
      slotIndex: hero.slotIndex,
      equippedItemIds: normalizedItemIds,
    },
  };
}

function validateShards(rawShards) {
  if (!isPlainObject(rawShards)) {
    return fail('invalid_save', 'shards');
  }

  const forbiddenIdx = findForbiddenOwnKeyIndex(rawShards);
  if (forbiddenIdx !== -1) {
    return fail('invalid_save', `shards[#${forbiddenIdx}]`);
  }

  const keys = Object.keys(rawShards);
  if (keys.length > MAX_SHARD_KEYS) {
    return fail('invalid_save', 'shards');
  }

  const normalizedShards = {};
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!isValidNameString(key)) {
      return fail('invalid_save', `shards[#${i}]`);
    }
    const count = rawShards[key];
    if (!isSafeIntInRange(count, 0, MAX_SHARD_VALUE)) {
      return fail('invalid_save', `shards[#${i}].value`);
    }
    Object.defineProperty(normalizedShards, key, {
      value: count,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return { ok: true, value: normalizedShards };
}

export function validateVangVongSave(input, { nowMs = Date.now() } = {}) {
  if (!isPlainObject(input)) {
    return fail('invalid_save', '');
  }

  const forbiddenRootIdx = findForbiddenOwnKeyIndex(input);
  if (forbiddenRootIdx !== -1) {
    return fail('invalid_save', `#k${forbiddenRootIdx}`);
  }

  if (!hasOwn(input, 'schemaVersion') || !Number.isSafeInteger(input.schemaVersion)) {
    return fail('invalid_save', 'schemaVersion');
  }
  if (!VANG_VONG_SUPPORTED_SCHEMA_VERSIONS.includes(input.schemaVersion)) {
    return fail('unsupported_schema', 'schemaVersion');
  }

  const rootKeys = Object.keys(input);
  for (let i = 0; i < rootKeys.length; i += 1) {
    if (!ROOT_KEY_SET.has(rootKeys[i])) {
      return fail('invalid_save', `#k${i}`);
    }
  }

  for (let i = 0; i < ROOT_KEYS.length; i += 1) {
    if (!hasOwn(input, ROOT_KEYS[i])) {
      return fail('invalid_save', ROOT_KEYS[i]);
    }
  }

  for (const [field, [min, max]] of Object.entries(INTEGER_BOUNDS)) {
    if (!isSafeIntInRange(input[field], min, max)) {
      return fail('invalid_save', field);
    }
  }

  if (
    !Number.isSafeInteger(input.battleSpeed) ||
    (input.battleSpeed !== 1 && input.battleSpeed !== 2 && input.battleSpeed !== 3)
  ) {
    return fail('invalid_save', 'battleSpeed');
  }

  if (
    !Number.isSafeInteger(input.lastIdleClaimTime) ||
    input.lastIdleClaimTime < MIN_IDLE_CLAIM_MS
  ) {
    return fail('invalid_save', 'lastIdleClaimTime');
  }
  const normalizedLastIdleClaimTime =
    input.lastIdleClaimTime > nowMs ? nowMs : input.lastIdleClaimTime;

  if (typeof input.isMuted !== 'boolean') {
    return fail('invalid_save', 'isMuted');
  }

  if (typeof input.activeBeastId !== 'string' || !BEAST_ID_RE.test(input.activeBeastId)) {
    return fail('invalid_save', 'activeBeastId');
  }

  if (!Array.isArray(input.heroes) || input.heroes.length < 1 || input.heroes.length > MAX_HEROES) {
    return fail('invalid_save', 'heroes');
  }

  const seenHeroIds = new Set();
  const seenHeroNames = new Set();
  const seenHeroSlots = new Set();
  const normalizedHeroes = [];

  for (let i = 0; i < input.heroes.length; i += 1) {
    const heroResult = validateHero(
      input.heroes[i],
      i,
      seenHeroIds,
      seenHeroNames,
      seenHeroSlots,
    );
    if (!heroResult.ok) {
      return heroResult;
    }
    normalizedHeroes.push(heroResult.value);
  }

  const shardsResult = validateShards(input.shards);
  if (!shardsResult.ok) {
    return shardsResult;
  }

  const value = {
    schemaVersion: input.schemaVersion,
    gold: input.gold,
    currentStageIndex: input.currentStageIndex,
    maxUnlockedStage: input.maxUnlockedStage,
    towerFloor: input.towerFloor,
    maxTowerFloor: input.maxTowerFloor,
    worldBossTotalDamage: input.worldBossTotalDamage,
    pvpRank: input.pvpRank,
    pvpScore: input.pvpScore,
    rankLevel: input.rankLevel,
    battleSpeed: input.battleSpeed,
    lastIdleClaimTime: normalizedLastIdleClaimTime,
    isMuted: input.isMuted,
    activeBeastId: input.activeBeastId,
    heroes: normalizedHeroes,
    shards: shardsResult.value,
  };

  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > VANG_VONG_MAX_DATA_BYTES) {
    return fail('payload_too_large', '');
  }

  return { ok: true, value };
}

export function summarizeVangVongSave(value) {
  return {
    currentStageIndex: value.currentStageIndex,
    maxUnlockedStage: value.maxUnlockedStage,
    maxTowerFloor: value.maxTowerFloor,
    rankLevel: value.rankLevel,
    pvpScore: value.pvpScore,
    gold: value.gold,
    heroCount: value.heroes.length,
  };
}

export function mapLegacyVangVongState(legacy, { nowMs = Date.now() } = {}) {
  if (!isPlainObject(legacy)) {
    return null;
  }

  const result = {
    schemaVersion: 1,
  };

  for (let i = 0; i < LEGACY_SCALAR_DEFAULTS.length; i += 1) {
    const [key, defaultValue] = LEGACY_SCALAR_DEFAULTS[i];
    if (key === 'isMuted') {
      const rawClaim = hasOwn(legacy, 'lastIdleClaimTime') ? legacy.lastIdleClaimTime : undefined;
      result.lastIdleClaimTime = Number.isFinite(rawClaim)
        ? Math.trunc(Math.min(Math.max(rawClaim, MIN_IDLE_CLAIM_MS), nowMs))
        : nowMs;
    }
    result[key] = hasOwn(legacy, key) ? legacy[key] : defaultValue;
  }

  const heroes = [];
  if (Array.isArray(legacy.heroes)) {
    for (let i = 0; i < legacy.heroes.length; i += 1) {
      const h = legacy.heroes[i];
      if (h && h.isEnemy === true) {
        continue;
      }
      heroes.push({
        id: h?.id,
        name: h?.name,
        level: h?.level,
        stars: h?.stars,
        slotIndex: h?.slotIndex,
        equippedItemIds: Array.isArray(h?.equippedItemIds) ? [...h.equippedItemIds] : [],
      });
    }
  }
  result.heroes = heroes;

  const shards = {};
  if (isPlainObject(legacy.shards)) {
    for (const key of Object.keys(legacy.shards)) {
      Object.defineProperty(shards, key, {
        value: legacy.shards[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  result.shards = shards;

  return result;
}
