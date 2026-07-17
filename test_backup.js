// Run: node test_backup.js  (from resistance-band-pwa/)
import assert from 'node:assert'
import { extractInventory } from './src/backup.js'

// Fields absent → nothing present, empty lists
let r = extractInventory({ rbts_log: [] })
assert.equal(r.gearPresent, false)
assert.equal(r.bandsPresent, false)
assert.deepEqual(r.gear, [])
assert.deepEqual(r.myBands, [])

// Null/garbage state → same
r = extractInventory(null)
assert.equal(r.gearPresent, false)
assert.equal(r.bandsPresent, false)

// Present but empty arrays → present (deliberate empty inventory)
r = extractInventory({ rbts_gear: [], rbts_myBands: [] })
assert.equal(r.gearPresent, true)
assert.equal(r.bandsPresent, true)
assert.deepEqual(r.gear, [])
assert.deepEqual(r.myBands, [])

// Only one field present → the other stays not-present
r = extractInventory({ rbts_myBands: ['b28', 'b28', 'b41'] })
assert.equal(r.gearPresent, false)
assert.equal(r.bandsPresent, true)
assert.deepEqual(r.myBands, ['b28', 'b28', 'b41'])   // duplicates preserved (qty)

// Junk entries filtered: gear needs object with id+name; bands need strings
r = extractInventory({
  rbts_gear: [{ id: 'g1', brand: 'X3', name: 'Bar', qty: 1, status: 'owned' }, null, 'junk', { id: 'g2' }],
  rbts_myBands: ['b1', 7, null, 'b2'],
})
assert.equal(r.gear.length, 1)
assert.equal(r.gear[0].id, 'g1')
assert.deepEqual(r.myBands, ['b1', 'b2'])

// Non-array field values are treated as absent
r = extractInventory({ rbts_gear: 'oops', rbts_myBands: { a: 1 } })
assert.equal(r.gearPresent, false)
assert.equal(r.bandsPresent, false)

console.log('backup.js tests OK')
