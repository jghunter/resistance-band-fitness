// Backup-file inventory fields (SPEC_gear_bands_sync_bridge.md).
// Each list is independent: a field is applied only when it is an array —
// an empty array is a deliberate empty inventory, an absent field means
// "leave this device's list alone".
export function extractInventory(state) {
  const gearPresent  = !!state && Array.isArray(state.rbts_gear)
  const bandsPresent = !!state && Array.isArray(state.rbts_myBands)
  return {
    gearPresent,
    bandsPresent,
    gear: gearPresent
      ? state.rbts_gear.filter(g => g && typeof g === 'object' && g.id && g.name)
      : [],
    myBands: bandsPresent
      ? state.rbts_myBands.filter(id => typeof id === 'string')
      : [],
  }
}
