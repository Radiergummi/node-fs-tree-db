'use strict';

/*
 global module,
 require,
 JSON
 */

const debug = require('debug')('treeDb:cache');

class Cache {

  /**
   * creates a new cache object and merges configuration options
   *
   * @param {object} options
   * @constructor
   */
  constructor (options) {
    this.cacheStorage = {};

    // merge configuration
    this.config = Object.assign({
      ttl:       108000,
      separator: '/'
    }, options);

    debug('initialized new cache storage with TTL set to %s', this.config.ttl);
  }
  
  toString () {
    return JSON.stringify(this.cacheStorage);
  }

  /**
   * retrieves a nested key from cache
   *
   * @param   {string}  key
   * @returns {Promise}
   */
  get (key) {
    return new Promise((resolve, reject) => {
      let path    = key.split(this.config.separator),
          storage = Object.assign({}, this.cacheStorage);

      debug('trying to retrieve key %s', key);

      for (let i = 0, pathLength = path.length; i < pathLength; i++) {
        debug('iterating over path segment %s (%s/%s)', path[ i ], i+1, pathLength);
        if (!storage || typeof storage !== 'object') {
          debug('current path segment %s does not exist', path[ i ]);
          return reject();
        }

        debug('setting next search path to %s', path[ i ]);
        storage = storage[ path[ i ] ];
      }

      if (storage === undefined) {
        debug('key %s does not exist at path %s', key, path[ i ]);
        return reject();
      }

      debug('found key %s', key);
      return resolve(storage);
    });
  }
  
  /**
   * sets a nested key in the cache and applies a TTL removal
   *
   * @param   {string}          key
   * @param   {*}               value
   * @param   {number|boolean}  [ttl]
   * @returns {Promise}
   */
  set (key, value, ttl) {
    ttl = ttl || this.config.ttl;

    return new Promise((resolve) => {
      if (key.length === 0) {
        debug('setting whole tree');
        this.cacheStorage = value;

        return resolve();
      }

      let path   = key.split(this.config.separator),
          target = this.cacheStorage;

      debug('setting key %s', key);
      for (let i = 0; i < path.length - 1; i++) {
        let key = path[ i ];

        debug('iterating over path segment %s (%s/%s)', key, i+1, path.length);
        if (key in target) {

          debug('found key %s in storage', key);
          target = target[ key ];
        } else {

          debug('key %s does not exist yet. creating', key);
          target[ key ] = {};
          target        = target[ key ];
        }
      }

      debug('setting key %s to value', path[ path.length - 1 ]);
      target[ path[ path.length - 1 ] ] = value;

      return resolve();
    }).then(() => {
      if (!ttl) {

        debug('setting TTL %s for key', ttl, key);

        // set a timeout to delete the key once it is expired
        setTimeout(() => {
          debug('key %s expired, removing', key);
          this.remove(key);
        }, ttl);
      }
    });
  }

  /**
   * removes a nested key from the cache
   *
   * @param   {string}  key
   * @returns {Promise}
   */
  remove (key) {
    return new Promise((resolve) => {
      let path   = key.split(this.config.separator),
          target = this.cacheStorage;

      debug('removing key %s', key);
      for (let i = 0; i < path.length - 1; i++) {
        let key = path[ i ];

        debug('iterating over path segment %s (%s/%s)', key, i+1, path.length);
        if (key in target) {

          debug('found key %s in storage', key);
          target = target[ key ];
        } else {

          debug('key %s does not exist in storage', key);
          return resolve();
        }
      }

      debug('deleted key %s from storage', key);
      delete target[ path[ path.length - 1 ] ];
    });
  }
}

export {Cache as default}

