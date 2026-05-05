// Per-viewer profile persistence for Pixel Brawler.
//
// Mirrors the marbles-3d/skins.js convention: lowercased-username keyed object
// stored under one localStorage key, silent no-op on quota / private-mode
// errors, alias resolution handled by classes.js before calling these setters.

import { resolveClassId, resolveColorId, resolveHatId } from './classes.js';

const STORAGE_KEY = 'pixel-brawler:viewer-profiles';

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

function writeStore(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Storage full / private mode / disabled — silently no-op.
  }
}

// Returns { class, color, hat } or null if no profile exists.
// All values are canonical IDs (already resolved from any aliases).
export function resolveProfile(username) {
  if (!username) return null;
  const store = readStore();
  const entry = store[username.toLowerCase()];
  if (!entry || typeof entry !== 'object') return null;
  return {
    class: entry.class || null,
    color: entry.color || null,
    hat: entry.hat || null,
  };
}

function updateProfile(username, patch) {
  if (!username) return false;
  const store = readStore();
  const key = username.toLowerCase();
  store[key] = { ...(store[key] || {}), ...patch };
  writeStore(store);
  return true;
}

// Each setter accepts either a canonical ID or a friendly alias.
// Returns true on success, false on unknown value or missing username.

export function setViewerClass(username, name) {
  const id = resolveClassId(name);
  if (!id) return false;
  return updateProfile(username, { class: id });
}

export function setViewerColor(username, name) {
  const id = resolveColorId(name);
  if (!id) return false;
  return updateProfile(username, { color: id });
}

export function setViewerHat(username, name) {
  const id = resolveHatId(name);
  if (!id) return false;
  // 'none' clears the hat — store as null so resolveProfile returns null for hat.
  if (id === 'none') return updateProfile(username, { hat: null });
  return updateProfile(username, { hat: id });
}
