// backend/cloudflare/node-http-shim.js
// Minimal Node.js http.IncomingMessage / http.ServerResponse stand-ins so backend/api/router.js and middleware.js run
// unchanged inside a Cloudflare Worker (nodejs_compat provides node:stream and node:events).
//
// Covers exactly what the backend uses: req.method/url/headers/socket.remoteAddress, the 'data'/'end'/'error'/'aborted'
// events and destroy(); res.setHeader/getHeader/removeHeader/hasHeader/writeHead/write/end/headersSent/statusCode.

const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');

// Headers a Worker must not set by hand: the runtime frames the body itself.
const FRAMING_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive']);

function headersToNodeObject(headers) {
  const out = {};
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    out[key] = out[key] === undefined ? value : `${out[key]}, ${value}`;
  }
  return out;
}

function createNodeRequest({ method, url, headers, body, remoteAddress }) {
  const req = new Readable({ read() {} });
  if (body && body.length > 0) req.push(Buffer.from(body));
  req.push(null);
  req.method = String(method || 'GET').toUpperCase();
  req.url = url;
  req.headers = headers;
  req.httpVersion = '1.1';
  req.socket = { remoteAddress: remoteAddress || '127.0.0.1', encrypted: true };
  req.connection = req.socket;
  return req;
}

function createNodeResponse() {
  const res = new EventEmitter();
  const headers = new Map(); // lower-case name -> { name, value }
  const chunks = [];
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });

  res.statusCode = 200;
  res.statusMessage = '';
  res.headersSent = false;
  res.writableEnded = false;
  res.finished = false;

  res.setHeader = (name, value) => {
    if (res.headersSent) {
      const err = new Error('Cannot set headers after they are sent to the client');
      err.code = 'ERR_HTTP_HEADERS_SENT';
      throw err;
    }
    headers.set(String(name).toLowerCase(), { name: String(name), value });
    return res;
  };
  res.getHeader = (name) => {
    const h = headers.get(String(name).toLowerCase());
    return h ? h.value : undefined;
  };
  res.hasHeader = (name) => headers.has(String(name).toLowerCase());
  res.removeHeader = (name) => {
    headers.delete(String(name).toLowerCase());
  };
  res.getHeaders = () => {
    const out = {};
    for (const [k, h] of headers) out[k] = h.value;
    return out;
  };

  res.writeHead = (status, reasonOrHeaders, maybeHeaders) => {
    if (res.headersSent) {
      const err = new Error('Cannot write headers after they are sent to the client');
      err.code = 'ERR_HTTP_HEADERS_SENT';
      throw err;
    }
    res.statusCode = Number(status) || 200;
    let extra = maybeHeaders;
    if (typeof reasonOrHeaders === 'string') res.statusMessage = reasonOrHeaders;
    else extra = reasonOrHeaders;
    if (extra && typeof extra === 'object') {
      for (const [name, value] of Object.entries(extra)) headers.set(name.toLowerCase(), { name, value });
    }
    res.headersSent = true;
    return res;
  };

  const toBuffer = (chunk, encoding) => {
    if (chunk === undefined || chunk === null) return null;
    if (Buffer.isBuffer(chunk)) return chunk;
    if (chunk instanceof Uint8Array) return Buffer.from(chunk);
    return Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
  };

  res.write = (chunk, encoding) => {
    if (res.writableEnded) return false;
    if (!res.headersSent) res.headersSent = true;
    const b = toBuffer(chunk, encoding);
    if (b) chunks.push(b);
    return true;
  };

  res.end = (chunk, encoding) => {
    if (res.writableEnded) return res;
    if (typeof chunk === 'function') chunk = undefined;
    const b = toBuffer(chunk, encoding);
    if (b) chunks.push(b);
    res.headersSent = true;
    res.writableEnded = true;
    res.finished = true;
    const outHeaders = [];
    for (const { name, value } of headers.values()) {
      if (FRAMING_HEADERS.has(name.toLowerCase()) || value === undefined) continue;
      if (Array.isArray(value)) value.forEach(v => outHeaders.push([name, String(v)]));
      else outHeaders.push([name, String(value)]);
    }
    resolveDone({ status: res.statusCode, headers: outHeaders, body: Buffer.concat(chunks) });
    res.emit('finish');
    res.emit('close');
    return res;
  };

  res.done = done;
  return res;
}

function toWebResponse({ status, headers, body }, method) {
  const nullBody = method === 'HEAD' || status === 204 || status === 205 || status === 304;
  const h = new Headers();
  for (const [name, value] of headers) h.append(name, value);
  return new Response(nullBody ? null : body, { status, headers: h });
}

module.exports = {
  headersToNodeObject,
  createNodeRequest,
  createNodeResponse,
  toWebResponse
};
