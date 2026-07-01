// Stub for parquetjs lazy-loaded lzo module.
// LZO compression is never used; this prevents build errors.
module.exports = {
  compress: () => { throw new Error('LZO compression not supported') },
  decompress: () => { throw new Error('LZO compression not supported') },
}
