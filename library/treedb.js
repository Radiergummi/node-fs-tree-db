'use strict';

/*
 global module,
 require
 */

const debug = require('debug')('treeDb');

import Cache from "./cache";
import fs    from "mz/fs";
import path  from "path";

/**
 * the main tree DB class
 */
class TreeDB {

  /**
   * creates a new TreeDB instance and initializes the storage
   *
   * @param {object} [options]
   * @constructor
   */
  constructor(options) {

    // merge defaults with options
    this.config = Object.assign({
      rootPath: path.join(__dirname, '..', '..', 'db'),
      cache:    {
        ttl: false
      }
    }, options);

    // create the database instance in memory
    this.__cache = new Cache(this.config.cache);

    // set the root directory to the storage pool
    this.config.root = path.join(this.config.rootPath, 'storage');
    debug('set database root to %s', this.config.root);

    this.loadDatabase();

    // TODO: Add fs.watch to watch for external changes
  }

  /**
   * cache getter to aid with db.cache
   *
   * @returns {object}
   */
  get cache() {
    return this.__cache.cacheStorage;
  }

  /**
   * retrieves a single node
   *
   * @param   {string}  nodePath
   * @returns {Promise}
   */
  getPath(nodePath) {

    // trim leading slash
    if (nodePath.charAt(0) === '/') {
      nodePath = nodePath.slice(1, nodePath.length);
    }

    // retrieve the path from cache, if available
    return this.__cache.get(nodePath)

    // cache has the path, return it
      .then((content) => content)

      // cache does not have it, read from path
      .catch(() => {
        return this.readPath(nodePath)

        // store the value in cache
          .then((content) => {
            this.__cache.set(nodePath, content);

            return content;
          })
      });
  }

  /**
   * retrieves a branch with all of its sub branches and leaves
   *
   * @param   {string}  nodePath
   * @returns {Promise}
   */
  getBranch(nodePath) {

    // trim leading slash
    if (nodePath.charAt(0) === '/') {
      nodePath = nodePath.slice(1, nodePath.length);
    }

    return this.__cache.get(nodePath)
      .then((content) => content)
      .catch(() => {
        let tree     = {},
            basePath = path.join(this.config.root, (nodePath
                ? nodePath
                : ''
            ));

        // start the recursive branch query from the base path
        return this.readBranch(basePath, tree).then(() => {
          this.__cache.set(nodePath, tree);
          return tree;
        });
      });
  }

  /**
   * initially loads or creates the database
   *
   * @returns {Promise}
   */
  loadDatabase() {

    // if the database root exists
    fs.exists(this.config.root)
      .then((exists) => {
        if (exists) {
          debug('loading existing database structure');
          return fs.readdir(this.config.root);
        }

        debug('creating non-existent database root');

        // create the database root
        return fs.mkdir(path.join(this.config.rootPath))

        // create the storage root
          .then(() => fs.mkdir(path.join(this.config.root)))

          // create the schema root
          .then(() => fs.mkdir(path.join(this.config.rootPath, 'schema')));
      })
      .catch((error) => {
        debug('FATAL: Could not create root directory structure in ' + this.config.rootPath);
        throw new Error(error);
      })
      .then(() => {
        let tree = {};

        // start the recursive branch query from the base path
        return this.readBranch(this.config.root, tree).then(() => {
          this.__cache.set('', tree.storage, false);
          return tree.storage;
        });
      });
  }

  dumpDatabase() {
    // TODO: Write all database branches
  }

  /**
   * reads a path
   *
   * @param   {string}  nodePath
   * @returns {Promise}
   */
  readPath(nodePath) {

    // resolve the node path
    nodePath = path.join(this.config.root, nodePath);
    debug('resolved node path to %s', nodePath);

    // create a new promise to catch ENOENTs (which are no "real" errors in a flat db)
    return new Promise((resolve, reject) => {
      fs.lstat(nodePath).then((stats) => {
        if (stats.isFile()) {
          debug('node %s is an endpoint, parsing.', nodePath);

          return resolve(this.readLeaf(nodePath));
        }

        if (stats.isDirectory()) {

          debug('node %s has children, retrieving child nodes', nodePath);
          return fs.readdir(nodePath)
            .then((childNodes) => {

              debug('found %s child nodes for %s', childNodes.length,
                nodePath);
              return resolve(childNodes);
            })
        }
      })
        .catch((error) => {
          if (error.code === 'ENOENT') {

            debug('node %s does not exist', nodePath);
            return resolve(undefined);
          }

          debug('could not retrieve node %s: %s', nodePath, error.message);
          return reject(error);
        });
    });
  }

  /**
   * reads a branch
   *
   * @param {string}    nodePath the path to read from
   * @param {object}    branch   the current branch to start with
   * @returns {Promise}
   */
  readBranch(nodePath, branch) {
    debug('trying to read tree at %s', nodePath);

    // create a new promise to catch ENOENTs (which are no "real" errors in a flat db)
    return new Promise((resolve, reject) => {
      fs.lstat(nodePath).then((stats) => {
        if (stats.isFile()) {

          return fs.readFile(nodePath).then(
            (content) => {
              debug('node %s is an endpoint, adding content to tree', nodePath);
              branch[ path.basename(nodePath) ] = content.toString();

              return resolve();
            }
          );
        }

        if (stats.isDirectory()) {
          debug('node %s has children, retrieving child nodes', nodePath);
          return fs.readdir(nodePath)
            .then((childNodes) => {
              debug('found %s child nodes for %s', childNodes.length,
                nodePath);
              branch[ path.basename(nodePath) ] = {};
              const childNodePromises           = [];

              for (let i = 0; i < childNodes.length; i ++) {
                branch[ path.basename(nodePath) ][ childNodes[ i ] ] =
                  null;
                debug('reading branch %s', path.join(nodePath,
                  childNodes[ i ]));
                childNodePromises.push(this.readBranch(path.join(nodePath, childNodes[ i
                  ]), branch[ path.basename(nodePath) ]));
              }

              return resolve(Promise.all(childNodePromises));
            });
        }
      })
        .catch((error) => {
          if (error.code === 'ENOENT') {
            debug('node %s does not exist', nodePath);
            return resolve(undefined);
          }

          debug('could not retrieve node %s: %s', nodePath, error.message);
          return reject(error);
        });
    });
  }

  /**
   * reads the content of a leaf
   *
   * @param   {string}  nodePath
   * @returns {Promise}
   */
  readLeaf(nodePath) {
    debug('reading endpoint %s', nodePath);
    return fs.readFile(nodePath).then((content) => {
      return {
        [path.basename(nodePath)]: content.toString()
      };
    })
  }

  
  writePath(nodePath, content) {
    // TODO: Stub
  }

  writeBranch(nodePath, content, branch) {
    // TODO: Stub
  }

  /**
   *
   * @param nodePath
   * @param content
   * @returns {Promise}
   */
  writeLeaf(nodePath, content) {
    debug('writing endpoint %s', nodePath);

    return fs.writeFile(nodePath, content)
      .then(() => this.__cache.set(nodePath, content))
      .catch((error) => {
        debug('could not write %s: %s', nodePath, error.message);
      });
  }
}


export {TreeDB as default}
