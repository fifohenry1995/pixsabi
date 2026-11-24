'use strict';
// Makes text replies smaller (Brotli or gzip, built into Node), so the game costs less data on slow or expensive connections.
// Scripts and styles shrink to roughly a quarter. Pictures, sounds and other files that are already compressed are left alone.
const zlib = require('zlib');

const MIN_SIZE = 600;   // tiny replies are not worth compressing
const textType = (type) => /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg\+xml)/i.test(String(type || ''));

// Which encoding the browser accepts: Brotli is smaller, gzip is the fallback.
function accepted(req) {
  const ae = String((req && req.headers && req.headers['accept-encoding']) || '');
  if (/(^|[\s,])br(\s*;\s*q=(?!0(\.0+)?\b)[\d.]+)?\s*(,|$)/i.test(ae)) return 'br';
  if (/(^|[\s,])gzip(\s*;\s*q=(?!0(\.0+)?\b)[\d.]+)?\s*(,|$)/i.test(ae)) return 'gzip';
  return null;
}
// quality 'high' is for files that rarely change (kept in memory), 'fast' for replies made on the fly
function pack(buf, enc, quality) {
  if (enc === 'br') return zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality === 'high' ? 9 : 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  return zlib.gzipSync(buf, { level: quality === 'high' ? 9 : 5 });
}

const staticCache = new Map();   // "file|encoding|stamp" -> compressed bytes (the stamp changes when the file changes)
function staticPacked(key, read, enc) {
  const k = `${key}|${enc}`;
  let v = staticCache.get(k);
  if (!v) {
    if (staticCache.size > 300) staticCache.clear();
    v = pack(read(), enc, 'high');
    staticCache.set(k, v);
  }
  return v;
}
// A reply made on the fly (JSON, the home page): returns { body, encoding } or the original with encoding null.
function dynamic(req, type, buf) {
  const enc = textType(type) && buf.length >= MIN_SIZE ? accepted(req) : null;
  return enc ? { body: pack(buf, enc, 'fast'), encoding: enc } : { body: buf, encoding: null };
}
module.exports = { accepted, textType, dynamic, staticPacked, MIN_SIZE };
