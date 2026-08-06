// Pure reconcile logic for the two localStorage keys that gained a Firestore
// mirror in Task 6: rbts_bandGeom (band calibration -- rest lengths and
// Tension Master readings) and rbts_profiles (RIR target, set seeding, volume
// model, split). Both were localStorage-only, so a measurement typed on the
// iPad never reached the iPhone.
//
// Neither payload carries a timestamp of its own -- rbts_bandGeom is a bare
// {bandId: {...}} map and a profile array's entries carry only a creation
// date, not a "last touched" one -- so both are WRAPPED in Firestore as
// { data, updatedAt }, stamped fresh on every local write. A document written
// before this wrapper existed (or read from an older client) has no
// `updatedAt` field at all: unwrapMeta treats that as timestamp 0, the oldest
// possible value, rather than comparing against undefined. That is the whole
// point -- a legacy document must never look newer than a freshly-stamped
// one and steamroll real measurements a user spent time taking with a tape
// measure and a Tension Master.
//
// Kept in its own plain ES module (no JSX, no React, no Firestore SDK) so the
// decision itself can be unit-tested directly under node: App.jsx cannot be
// `import`ed there because it contains JSX. Mirrors why rbts_reports.js is
// its own plain module, isolated from both apps' globals.

/** Normalize a Firestore meta document into { data, updatedAt }. Accepts:
 *   - null/undefined (no document yet, or the read failed)
 *   - a bare legacy payload -- the raw map/array itself, no wrapper
 *   - a wrapped payload { data, updatedAt }
 * A bare payload, or a wrapped one missing `updatedAt`, both read as 0. */
export function unwrapMeta(payload) {
  if (payload == null) return { data: null, updatedAt: 0 }
  if (typeof payload === 'object' && !Array.isArray(payload) && payload.data !== undefined) {
    return { data: payload.data, updatedAt: payload.updatedAt || 0 }
  }
  return { data: payload, updatedAt: 0 }
}

/**
 * Decide how to reconcile a local vs. remote copy of one meta document.
 * Whole-document, not per-band/per-field: two devices measuring different
 * bands offline between syncs keep only the later document. That is
 * deliberate -- a per-band merge needs per-band timestamps, and the
 * realistic case here is one person with a tape measure, not concurrent
 * editors.
 *
 * @param {{data:*, updatedAt:number}} local  Always both fields; updatedAt is
 *   0 if this device has never stamped a write (e.g. data saved before this
 *   feature shipped).
 * @param {{data:*, updatedAt:number}} remote Already run through unwrapMeta,
 *   so a legacy document already reads updatedAt:0 here too.
 * @param {(data:*) => boolean} isEmpty "no real data" test -- bandGeom is
 *   empty at {}, a profile list is empty at [].
 * @returns {{action:'noop'|'adopt-remote'|'push-local', data:*, updatedAt:number}}
 *   - noop: neither side has anything to give the other.
 *   - adopt-remote: write remote.data/updatedAt into local storage.
 *   - push-local: write local.data to Firestore, stamped with local.updatedAt
 *     (minted fresh via the `now` param if this device never stamped one).
 *
 * Ties (equal updatedAt, including 0 vs. 0) resolve to push-local. That is
 * the rule that makes the legacy-document case safe: a legacy remote reads
 * as updatedAt 0, and a local device's pre-existing data commonly is ALSO
 * still at updatedAt 0 (never stamped before this feature existed) -- a tie
 * has to favor what is actually sitting on the device over a bare cloud
 * placeholder, or real measurements would be silently discarded the first
 * time that device ever signs in.
 *
 * @param {{unstampedIsSeed?:boolean}} [opts] `unstampedIsSeed` says that
 *   unstamped local data on this device is NOT evidence a user ever entered
 *   anything -- some other code path may have manufactured it. Such data is
 *   treated exactly as if it were empty: never pushed, always outranked. Use
 *   it only for a key that has an automatic seeder (see reconcileProfiles);
 *   for a key without one it would throw away real work.
 */
export function reconcileMeta(local, remote, isEmpty, now = Date.now, opts = {}) {
  const localEmpty  = isEmpty(local.data) || (!!opts.unstampedIsSeed && !local.updatedAt)
  const remoteEmpty = !remote || remote.data == null || isEmpty(remote.data)

  if (remoteEmpty && localEmpty) return { action: 'noop' }
  if (remoteEmpty) return { action: 'push-local', data: local.data, updatedAt: local.updatedAt || now() }
  if (localEmpty)  return { action: 'adopt-remote', data: remote.data, updatedAt: remote.updatedAt }

  if (remote.updatedAt > local.updatedAt) {
    return { action: 'adopt-remote', data: remote.data, updatedAt: remote.updatedAt }
  }
  return { action: 'push-local', data: local.data, updatedAt: local.updatedAt || now() }
}

/** rbts_bandGeom: a bare {bandId: {...}} map, empty at {}.
 *  Plain last-write-wins. Nothing ever manufactures band calibration, so an
 *  unstamped local map is real work someone did with a tape measure and a
 *  Tension Master, and it pushes -- deliberately NOT the profile rule below. */
export function reconcileBandGeom(local, remote, now = Date.now) {
  return reconcileMeta(local, remote, d => !d || Object.keys(d).length === 0, now)
}

/** rbts_profiles: an array, empty at [].
 *  Unlike band calibration this key HAS an automatic seeder --
 *  phase1.migrateToProfiles runs at module load on any device that has none
 *  and writes a default profile without stamping rbts_profilesUpdatedAt. That
 *  array is non-empty, so under the plain rule a fresh install pushed a
 *  machine-generated default to the cloud stamped now(), and every other
 *  device whose real profile predated the feature (updatedAt 0) lost the
 *  comparison and adopted it -- silently replacing rirTarget, volumeModel,
 *  defaultSets, splitId and ownedBands. rirTarget feeds progressionState, so
 *  that also changed READY / STALLED verdicts.
 *
 *  Unstamped therefore means "possibly the seed" here, and is treated as
 *  empty. Nothing is lost by that: the PWA has no profile editor, so a
 *  PWA-local profile is only ever an import or an adopt (both stamped) or the
 *  seed (never stamped). Edit profiles in fitness_app.html and bring them
 *  over in a backup file, which is the only route that exists. */
export function reconcileProfiles(local, remote, now = Date.now) {
  return reconcileMeta(local, remote, d => !Array.isArray(d) || d.length === 0, now,
                       { unstampedIsSeed: true })
}
