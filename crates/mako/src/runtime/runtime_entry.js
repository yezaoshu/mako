function createRuntime(makoModules, entryModuleId) {
  var modulesRegistry = {};

  function requireModule(moduleId) {
    if (moduleId === '$$IGNORED$$') return {};
    var cachedModule = modulesRegistry[moduleId];

    if (cachedModule !== undefined) {
      if (cachedModule.error) {
        throw cachedModule.error;
      }
      return cachedModule.exports;
    }

    var module = {
      id: moduleId,
      exports: {},
    };
    modulesRegistry[moduleId] = module;

    try {
      var execOptions = {
        id: moduleId,
        module: module,
        factory: makoModules[moduleId],
        require: requireModule,
      };

      requireModule.requireInterceptors.forEach(function (interceptor) {
        interceptor(execOptions);
      });
      execOptions.factory.call(
        execOptions.module.exports,
        execOptions.module,
        execOptions.module.exports,
        execOptions.require,
      );
    } catch (e) {
      modulesRegistry[moduleId].error = e;
      throw e;
    }

    return module.exports;
  }

  // module execution interceptor
  requireModule.requireInterceptors = [];

  /* mako/runtime/ensure chunk */
  !(function () {
    requireModule.chunkEnsures = {};
    // This file contains only the entry chunk.
    // The chunk loading function for additional chunks
    requireModule.ensure = function (chunkId) {
      return Promise.all(
        Object.keys(requireModule.chunkEnsures).reduce(function (
          promises,
          key,
        ) {
          requireModule.chunkEnsures[key](chunkId, promises);
          return promises;
        }, []),
      );
    };
  })();

  /* mako/runtime/ensure load js Chunk */
  !(function () {
    requireModule.jsonpInstalled = {};
    var installedChunks = requireModule.jsonpInstalled;

    requireModule.chunkEnsures.jsonp = function (chunkId, promises) {
      var data = installedChunks[chunkId];
      if (data === 0) return;

      if (data) {
        //     0       1        2
        // [resolve, reject, promise]
        promises.push(data[2]);
      } else {
        var promise = new Promise(function (resolve, reject) {
          data = installedChunks[chunkId] = [resolve, reject];
        });
        promises.push((data[2] = promise));
        var url = requireModule.publicPath + chunksIdToUrlMap[chunkId];
        var error = new Error();
        var onLoadEnd = function (event) {
          data = installedChunks[chunkId];
          if (data !== 0) installedChunks[chunkId] = undefined;
          if (data) {
            var errorType = event && event.type;
            var src = event && event.target && event.target.src;
            error.message =
              'Loading chunk ' +
              chunkId +
              ' failed. (' +
              errorType +
              ' : ' +
              src +
              ')';
            error.name = 'ChunkLoadError';
            error.type = errorType;
            data[1](error);
          }
        };
        // load
        requireModule.loadScript(url, onLoadEnd, 'chunk-' + chunkId);
        return promise;
      }
    };
  })();
  // chunk and async load

  /* mako/runtime/load script */
  !(function () {
    var inProgress = {};
    requireModule.loadScript = function (url, done, key) {
      if (inProgress[url]) {
        return inProgress[url].push(done);
      }
      var script = document.createElement('script');
      script.timeout = 120;
      script.src = url;
      inProgress[url] = [done];
      var onLoadEnd = function (prev, event) {
        clearTimeout(timeout);
        var doneFns = inProgress[url];
        delete inProgress[url];
        if (script.parentNode) script.parentNode.removeChild(script);
        if (doneFns) {
          doneFns.forEach(function (fn) {
            return fn(event);
          });
        }
        if (prev) return prev(event);
      };
      // May not be needed, already has timeout attributes
      var timeout = setTimeout(
        onLoadEnd.bind(null, undefined, { type: 'timeout', target: script }),
        120000,
      );
      script.onerror = onLoadEnd.bind(null, script.onerror);
      script.onload = onLoadEnd.bind(null, script.onload);
      document.head.appendChild(script);
    };
  })();
  /* mako/runtime/ensure load css chunk */
  !(function () {
    requireModule.cssInstalled = cssInstalledChunks;
    // __CSS_CHUNKS_URL_MAP
    requireModule.findStylesheet = function (url) {
      return Array.from(
        document.querySelectorAll('link[href][rel=stylesheet]'),
      ).find(function (link) {
        // why not use link.href?
        // because link.href contains hostname
        var linkUrl = link.getAttribute('href').split('?')[0];
        return linkUrl === url || linkUrl === requireModule.publicPath + url;
      });
    };

    requireModule.createStylesheet = function (
      chunkId,
      url,
      oldTag,
      resolve,
      reject,
    ) {
      var link = document.createElement('link');

      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = url;
      link.onerror = link.onload = function (event) {
        // avoid mem leaks, from webpack
        link.onerror = link.onload = null;

        if (event.type === 'load') {
          // finished loading css chunk
          cssInstalledChunks[chunkId] = 0;
          resolve();
        } else {
          // throw error and reset state
          delete cssInstalledChunks[chunkId];
          var errorType = event && event.type;
          var realHref = event && event.target && event.target.href;
          var err = new Error(
            'Loading CSS chunk ' + chunkId + ' failed.\n(' + realHref + ')',
          );

          err.code = 'CSS_CHUNK_LOAD_FAILED';
          err.type = errorType;
          err.request = realHref;
          link.parentNode.removeChild(link);
          reject(err);
        }
      };

      if (oldTag) {
        oldTag.parentNode.insertBefore(link, oldTag.nextSibling);
      } else {
        document.head.appendChild(link);
      }

      return link;
    };

    requireModule.chunkEnsures.css = function (chunkId, promises) {
      if (cssInstalledChunks[chunkId]) {
        // still pending, avoid duplicate promises
        promises.push(cssInstalledChunks[chunkId]);
      } else if (
        cssInstalledChunks[chunkId] !== 0 &&
        cssChunksIdToUrlMap[chunkId]
      ) {
        // load chunk and save promise
        cssInstalledChunks[chunkId] = new Promise(function (resolve, reject) {
          var url = cssChunksIdToUrlMap[chunkId];
          var fullUrl = requireModule.publicPath + url;

          if (requireModule.findStylesheet(url)) {
            // already loaded
            resolve();
          } else {
            // load new css chunk
            requireModule.createStylesheet(
              chunkId,
              fullUrl,
              null,
              resolve,
              reject,
            );
          }
        });
        promises.push(cssInstalledChunks[chunkId]);
        return promises;
      }
    };
  })();

  var jsonpCallback = function (data) {
    var installedChunks = requireModule.jsonpInstalled;
    var chunkIds = data[0];
    var modules = data[1];
    if (
      chunkIds.some(function (id) {
        return installedChunks[id] !== 0;
      })
    ) {
      registerModules(modules);
    }
    for (var i = 0; i < chunkIds.length; i++) {
      var id = chunkIds[i];
      if (installedChunks[id]) {
        installedChunks[id][0]();
      }
      installedChunks[id] = 0;
    }
  };

  var registerModules = function (modules) {
    for (var id in modules) {
      makoModules[id] = modules[id];
    }
  };

  // __inject_runtime_code__

  var exports = requireModule(entryModuleId);
  return {
    exports: exports,
    requireModule: requireModule,
    _modulesRegistry: modulesRegistry,
    _jsonpCallback: jsonpCallback,
    _makoModuleHotUpdate: requireModule.applyHotUpdate,
  };
}

var runtime = createRuntime(m, e);
var root = typeof globalThis !== 'undefined' ? globalThis : self;
root.jsonpCallback = runtime._jsonpCallback;
root.modulesRegistry = runtime._modulesRegistry;
root.makoModuleHotUpdate = runtime._makoModuleHotUpdate;
