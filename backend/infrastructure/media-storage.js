// backend/infrastructure/media-storage.js
// Private Media Byte Sniffing, Size/Quarantine Guard & Isolated Storage Engine (no git noise)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getStorageConfig } = require('./storage-engine');

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const RUNTIME_MEDIA_DIR = path.join(__dirname, '..', '..', 'data', 'runtime_media');
const memoryBlobs = new Map();

// Known harmless malware test signature (EICAR) to verify quarantine behavior cleanly
const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR';

const MAGIC_CHECKERS = {
  '.jpg': { mime: 'image/jpeg', check: (b) => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  '.jpeg': { mime: 'image/jpeg', check: (b) => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  '.png': { mime: 'image/png', check: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A },
  '.webp': { mime: 'image/webp', check: (b) => b.length >= 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
  '.pdf': { mime: 'application/pdf', check: (b) => b.length >= 5 && b.slice(0, 5).toString('ascii') === '%PDF-' }
};

function createError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function stripJpegMetadata(buffer) {
  // Strip APP1 (EXIF, 0xFFE1) and COM (0xFFFE) segments from JPEG streams when safe
  if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return buffer;
  const chunks = [buffer.slice(0, 2)];
  let pos = 2;
  while (pos + 3 < buffer.length && buffer[pos] === 0xFF) {
    const marker = buffer[pos + 1];
    if (marker === 0xDA || marker === 0xD9) {
      chunks.push(buffer.slice(pos));
      break;
    }
    const segLen = buffer.readUInt16BE(pos + 2);
    if (segLen < 2 || pos + 2 + segLen > buffer.length) {
      return buffer; // Fallback to original buffer if malformed segment header
    }
    if (marker !== 0xE1 && marker !== 0xFE) {
      chunks.push(buffer.slice(pos, pos + 2 + segLen));
    }
    pos += 2 + segLen;
  }
  return Buffer.concat(chunks);
}

const MediaStorage = {
  inspectAndPrepare({ fileName, dataBase64, declaredMimeType }) {
    const rawName = path.basename(String(fileName || 'upload.bin')).replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(rawName).toLowerCase();
    const spec = MAGIC_CHECKERS[ext];
    if (!spec) {
      throw createError(`Định dạng tệp "${ext || rawName}" không được hỗ trợ. Chỉ chấp nhận JPG, PNG, WEBP, PDF.`, 422, 'UNSUPPORTED_MEDIA_TYPE');
    }

    if (!dataBase64 || typeof dataBase64 !== 'string') {
      throw createError('Nội dung tệp tải lên trống hoặc không hợp lệ.', 422, 'EMPTY_MEDIA');
    }

    const strippedB64 = dataBase64.replace(/^data:[^;]+;base64,/, '').trim();
    const rawBuf = Buffer.from(strippedB64, 'base64');
    if (rawBuf.length === 0) {
      throw createError('Không thể giải mã nội dung base64 của tệp.', 422, 'INVALID_BASE64');
    }
    if (rawBuf.length > MAX_BYTES) {
      throw createError(`Dung lượng tệp (${(rawBuf.length / 1048576).toFixed(2)} MB) vượt quá giới hạn 5 MB.`, 413, 'MEDIA_TOO_LARGE');
    }

    const asciiPreview = rawBuf.slice(0, 256).toString('utf8');
    if (asciiPreview.includes(EICAR_SIGNATURE)) {
      return {
        fileName: rawName,
        ext,
        mimeType: spec.mime,
        buffer: rawBuf,
        sizeBytes: rawBuf.length,
        checksum: crypto.createHash('sha256').update(rawBuf).digest('hex'),
        scanStatus: 'quarantined',
        quarantineReason: 'Phát hiện chữ ký tệp nguy hiểm trong quá trình quét tự động.'
      };
    }

    // Reject script injection / polyglot disguises regardless of extension
    if (/<script[\s>]/i.test(asciiPreview) || /<!DOCTYPE\s+html/i.test(asciiPreview)) {
      throw createError('Tệp chứa nội dung mã thực thi/HTML không hợp lệ (nghi vấn giả mạo định dạng).', 422, 'INVALID_MEDIA_SIGNATURE');
    }

    if (!spec.check(rawBuf)) {
      throw createError(`Chữ ký nhị phân (magic bytes) không khớp với phần mở rộng "${ext}".`, 422, 'INVALID_MEDIA_SIGNATURE');
    }

    if (declaredMimeType && declaredMimeType !== spec.mime && !(declaredMimeType === 'image/jpg' && spec.mime === 'image/jpeg')) {
      throw createError(`MIME type "${declaredMimeType}" không khớp với tệp "${spec.mime}".`, 422, 'MIME_MISMATCH');
    }

    const cleanBuf = (ext === '.jpg' || ext === '.jpeg') ? stripJpegMetadata(rawBuf) : rawBuf;

    return {
      fileName: rawName,
      ext,
      mimeType: spec.mime,
      buffer: cleanBuf,
      sizeBytes: cleanBuf.length,
      checksum: crypto.createHash('sha256').update(cleanBuf).digest('hex'),
      scanStatus: 'clean',
      quarantineReason: null
    };
  },

  async writeBlob(storageKey, buffer) {
    const cfg = getStorageConfig();
    if (cfg.memoryOnly) {
      memoryBlobs.set(storageKey, Buffer.from(buffer));
      return { driver: 'memory', key: storageKey };
    }
    fs.mkdirSync(RUNTIME_MEDIA_DIR, { recursive: true });
    const safeKey = path.basename(storageKey);
    const fullPath = path.join(RUNTIME_MEDIA_DIR, safeKey);
    fs.writeFileSync(fullPath, buffer);
    return { driver: 'disk_runtime', key: safeKey };
  },

  async readBlob(storageKey) {
    const cfg = getStorageConfig();
    if (cfg.memoryOnly) {
      return memoryBlobs.get(storageKey) || null;
    }
    const safeKey = path.basename(storageKey);
    const fullPath = path.join(RUNTIME_MEDIA_DIR, safeKey);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath);
  },

  async deleteBlob(storageKey) {
    const cfg = getStorageConfig();
    if (cfg.memoryOnly) {
      memoryBlobs.delete(storageKey);
      return;
    }
    const safeKey = path.basename(storageKey);
    const fullPath = path.join(RUNTIME_MEDIA_DIR, safeKey);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
};

module.exports = MediaStorage;
