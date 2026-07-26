import Busboy from 'busboy'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type UploadErrorCode =
  | 'VALIDATION'
  | 'VIDEO_FORMAT_UNSUPPORTED'
  | 'VIDEO_FILE_TOO_LARGE'
  | 'UPLOAD_ABORTED'
  | 'UPLOAD_FAILED'

export class UploadStreamError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    public readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'UploadStreamError'
  }
}

export interface PersistedUpload {
  size: number
  sha256: string
}

export interface StreamedVideoUpload extends PersistedUpload {
  fileName: string
  extension: string
  finalPath: string
}

interface MultipartUploadOptions {
  directory: string
  maxFileSize: number
  allowedExtensions: readonly string[]
  fieldName?: string
  removeDirectoryOnFailure?: boolean
}

/**
 * Persist a readable stream without buffering it in memory.
 *
 * Bytes beyond maxFileSize are consumed but not written. This lets multipart
 * parsers finish cleanly before the temporary file is removed.
 */
export async function persistUploadStream(
  input: NodeJS.ReadableStream,
  temporaryPath: string,
  maxFileSize: number,
): Promise<PersistedUpload> {
  const hash = createHash('sha256')
  let writtenBytes = 0
  let exceededLimit = false

  const meter = new Transform({
    transform(chunk: Buffer | Uint8Array, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = Math.max(0, maxFileSize - writtenBytes)
      const accepted = buffer.subarray(0, remaining)

      if (accepted.length) {
        hash.update(accepted)
        writtenBytes += accepted.length
      }
      if (accepted.length < buffer.length) {
        exceededLimit = true
      }
      callback(null, accepted.length ? accepted : undefined)
    },
  })

  try {
    await pipeline(
      input,
      meter,
      createWriteStream(temporaryPath, { flags: 'wx' }),
    )
    if (exceededLimit) {
      throw new UploadStreamError(
        'VIDEO_FILE_TOO_LARGE',
        413,
        'File exceeds 2GB limit',
      )
    }
    return {
      size: writtenBytes,
      sha256: hash.digest('hex'),
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function receiveMultipartVideoUpload(
  request: Request,
  options: MultipartUploadOptions,
): Promise<StreamedVideoUpload> {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    throw new UploadStreamError(
      'VALIDATION',
      400,
      'Expected multipart/form-data',
    )
  }
  if (!request.body) {
    throw new UploadStreamError('VALIDATION', 400, 'Request body is empty')
  }

  const {
    directory,
    maxFileSize,
    allowedExtensions,
    fieldName = 'file',
    removeDirectoryOnFailure = false,
  } = options
  const temporaryPath = path.join(directory, 'source.tmp')
  await mkdir(path.dirname(directory), { recursive: true })
  // The caller supplies a newly generated video directory. Refuse to reuse an
  // existing one so cleanup can never remove a previous upload after an ID
  // collision.
  await mkdir(directory)

  let selectedFile: { fileName: string; extension: string } | null = null
  let writePromise: Promise<PersistedUpload> | null = null
  let validationError: UploadStreamError | null = null

  try {
    const headers = Object.fromEntries(request.headers.entries())
    let parser
    try {
      parser = Busboy({
        headers,
        limits: {
          files: 1,
          fields: 8,
          parts: 10,
          // Read one extra byte so an exactly-max-sized file remains valid.
          fileSize: maxFileSize + 1,
        },
      })
    } catch (error) {
      throw new UploadStreamError(
        'VALIDATION',
        400,
        'Invalid multipart request',
        { cause: error },
      )
    }

    parser.on('file', (name, file, info) => {
      if (name !== fieldName) {
        validationError ||= new UploadStreamError(
          'VALIDATION',
          400,
          `Unexpected file field: ${name}`,
        )
        file.resume()
        return
      }
      if (selectedFile) {
        validationError ||= new UploadStreamError(
          'VALIDATION',
          400,
          'Only one video file is allowed',
        )
        file.resume()
        return
      }

      const extension = path.extname(info.filename).toLowerCase()
      if (!allowedExtensions.includes(extension)) {
        validationError ||= new UploadStreamError(
          'VIDEO_FORMAT_UNSUPPORTED',
          400,
          `Unsupported format: ${extension || '(none)'}`,
        )
        file.resume()
        return
      }

      selectedFile = { fileName: info.filename, extension }
      writePromise = persistUploadStream(file, temporaryPath, maxFileSize)
      // Avoid an unhandled-rejection warning while the multipart parser drains.
      void writePromise.catch(() => {})
    })
    parser.on('filesLimit', () => {
      validationError ||= new UploadStreamError(
        'VALIDATION',
        400,
        'Only one video file is allowed',
      )
    })
    parser.on('fieldsLimit', () => {
      validationError ||= new UploadStreamError(
        'VALIDATION',
        400,
        'Too many multipart fields',
      )
    })
    parser.on('partsLimit', () => {
      validationError ||= new UploadStreamError(
        'VALIDATION',
        400,
        'Too many multipart parts',
      )
    })

    let parserError: unknown
    try {
      await pipeline(
        Readable.fromWeb(request.body as never),
        parser,
      )
    } catch (error) {
      parserError = error
    }

    if (validationError) throw validationError
    if (parserError) {
      if (request.signal.aborted) {
        throw new UploadStreamError('UPLOAD_ABORTED', 400, 'Upload was interrupted')
      }
      throw parserError
    }
    const completedFile = selectedFile as {
      fileName: string
      extension: string
    } | null
    const completedWrite = writePromise as Promise<PersistedUpload> | null
    if (!completedFile || !completedWrite) {
      throw new UploadStreamError('VALIDATION', 400, 'No file provided')
    }

    const persisted = await completedWrite
    const finalPath = path.join(directory, `source${completedFile.extension}`)
    await rename(temporaryPath, finalPath)
    return {
      ...persisted,
      fileName: completedFile.fileName,
      extension: completedFile.extension,
      finalPath,
    }
  } catch (error) {
    const pendingWrite = writePromise as Promise<PersistedUpload> | null
    if (pendingWrite) {
      await pendingWrite.catch(() => {})
    }
    await rm(temporaryPath, { force: true }).catch(() => {})
    if (removeDirectoryOnFailure) {
      await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
    if (error instanceof UploadStreamError) throw error
    throw new UploadStreamError(
      request.signal.aborted ? 'UPLOAD_ABORTED' : 'UPLOAD_FAILED',
      request.signal.aborted ? 400 : 500,
      request.signal.aborted ? 'Upload was interrupted' : String(error),
      { cause: error },
    )
  }
}
