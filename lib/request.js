'use strict'

const { Readable } = require('readable-stream')
const qs = require('querystring')
const util = require('util')
const url = require('url')

function parseURL (options) {
  const parsedURL = url.parse(
    typeof options.url === 'object'
      ? url.format(options.url)
      : options.url
  )

  // Returns non-empty string only non-empty object
  if (qs.stringify(options.query)) {
    const original = qs.parse(parsedURL.query)
    const combined = Object.assign(original, options.query)

    const query = qs.stringify(combined)
    if (query) {
      parsedURL.path = parsedURL.pathname + '?' + query
    }
  }

  return parsedURL
}

/**
 * Request
 *
 * @constructor
 * @param {Object} options
 * @param {(Object|String)} options.url
 * @param {String} [options.method='GET']
 * @param {String} [options.remoteAddress]
 * @param {Object} [options.headers]
 * @param {Object} [options.query]
 * @param {any} [options.payload]
 */
function Request (options) {
  Readable.call(this)

  const parsedURL = parseURL(options)

  this.url = parsedURL.path

  this.httpVersion = '1.1'
  this.method = options.method ? options.method.toUpperCase() : 'GET'

  this.headers = {}
  const headers = options.headers || {}
  const fields = Object.keys(headers)
  fields.forEach((field) => {
    this.headers[field.toLowerCase()] = headers[field]
  })

  this.headers['user-agent'] = this.headers['user-agent'] || 'lightMyRequest'

  const hostHeaderFromUri = function () {
    if (parsedURL.port) {
      return parsedURL.host
    }

    if (parsedURL.protocol) {
      return parsedURL.hostname + (parsedURL.protocol === 'https:' ? ':443' : ':80')
    }

    return null
  }
  this.headers.host = this.headers.host || hostHeaderFromUri() || options.authority || 'localhost:80'

  this.connection = {
    remoteAddress: options.remoteAddress || '127.0.0.1'
  }

  // we keep both payload and body for compatibility reasons
  var payload = options.payload || options.body || null
  if (payload && typeof payload !== 'string' && !(typeof payload.resume === 'function') && !Buffer.isBuffer(payload)) {
    payload = JSON.stringify(payload)
    this.headers['content-type'] = this.headers['content-type'] || 'application/json'
  }

  // Set the content-length for the corresponding payload if none set
  if (payload && !(typeof payload.resume === 'function') && !this.headers.hasOwnProperty('content-length')) {
    this.headers['content-length'] = (Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload)).toString()
  }

  // Use _lightMyRequest namespace to avoid collision with Node
  this._lightMyRequest = {
    payload,
    isDone: false,
    simulate: options.simulate || {}
  }

  return this
}

util.inherits(Request, Readable)

Request.prototype.prepare = function (next) {
  const payload = this._lightMyRequest.payload
  if (!payload || typeof payload.resume !== 'function') { // does not quack like a stream
    return next()
  }

  const chunks = []

  payload.on('data', (chunk) => chunks.push(Buffer.from(chunk)))

  payload.on('end', () => {
    const payload = Buffer.concat(chunks)
    this.headers['content-length'] = this.headers['content-length'] || ('' + payload.length)
    this._lightMyRequest.payload = payload
    return next()
  })

  // Force to resume the stream. Needed for Stream 1
  payload.resume()
}

Request.prototype._read = function (size) {
  setImmediate(() => {
    if (this._lightMyRequest.isDone) {
      // 'end' defaults to true
      if (this._lightMyRequest.simulate.end !== false) {
        this.push(null)
      }

      return
    }

    this._lightMyRequest.isDone = true

    if (this._lightMyRequest.payload) {
      if (this._lightMyRequest.simulate.split) {
        this.push(this._lightMyRequest.payload.slice(0, 1))
        this.push(this._lightMyRequest.payload.slice(1))
      } else {
        this.push(this._lightMyRequest.payload)
      }
    }

    if (this._lightMyRequest.simulate.error) {
      this.emit('error', new Error('Simulated'))
    }

    if (this._lightMyRequest.simulate.close) {
      this.emit('close')
    }

    // 'end' defaults to true
    if (this._lightMyRequest.simulate.end !== false) {
      this.push(null)
    }
  })
}

Request.prototype.destroy = function () {}

module.exports = Request
