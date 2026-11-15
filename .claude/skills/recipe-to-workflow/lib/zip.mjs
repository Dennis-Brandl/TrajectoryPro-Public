// A minimal ZIP writer, so building a .WFmasterX needs no dependency install.
//
// Only what a package needs: deflated entries, no directory records, no zip64,
// no encryption. Mission Designer and Mission Commander read these with JSZip,
// which accepts both stored and deflated entries.
//
// Timestamps are fixed rather than "now" so rebuilding a recipe produces a
// byte-identical package. A changing mtime would make every rebuild look like a
// change in git even when the workflow is untouched.

import { deflateRawSync } from 'node:zlib'

const DOS_TIME = 0x6000 // 12:00:00
const DOS_DATE = 0x5c21 // 2026-01-01

let CRC_TABLE = null
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  CRC_TABLE = t
  return t
}

function crc32(buf) {
  const t = crcTable()
  let c = 0 ^ -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ t[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

/**
 * Build a ZIP from [{ name, data }] where data is a Buffer or string.
 * Entry order is preserved, so callers control it and get a stable archive.
 */
export function zipSync(entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const deflated = deflateRawSync(raw, { level: 9 })
    // A tiny file can deflate larger than it started; store it as-is if so.
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // this disk
  eocd.writeUInt16LE(0, 6) // disk with central directory
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, centralBuf, eocd])
}

/** Mission Designer's package naming: anything outside A-Za-z0-9._- becomes _. */
export function sanitizeName(name) {
  return (name || 'workflow').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200)
}

/** `Roast Chicken` + `1.0.0` -> `Roast Chicken(1.0.0)`, as Designer names downloads. */
export function withVersionSuffix(name, version) {
  const v = version && version.trim()
  return v ? name + '(' + v + ')' : name
}
