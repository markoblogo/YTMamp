const fs = require('fs');
const path = require('path');

const KNOWN_PLUGIN_MANIFEST_EXTENSIONS = ['.plugin.json', '.json'];

function safeReadJson(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        throw new Error(`Failed to parse manifest "${path.basename(filePath)}": ${err.message}`);
    }
}

function validatePluginManifest(manifest, filePath) {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error(`Manifest "${path.basename(filePath)}" must be an object`);
    }

    if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
        throw new Error(`Manifest "${path.basename(filePath)}" must define a non-empty "name"`);
    }

    if (manifest.enabled === false) {
        return null;
    }

    const entry = manifest.entry || manifest.main;
    if (typeof entry !== 'string' || !entry.trim()) {
        throw new Error(`Manifest "${path.basename(filePath)}" must define "entry"`);
    }

    return {
        name: manifest.name.trim(),
        version: typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : '1.0.0',
        enabled: manifest.enabled !== false,
        entry: path.resolve(path.dirname(filePath), entry),
        filePath,
        source: {
            file: path.basename(filePath),
            dir: path.dirname(filePath)
        }
    };
}

function collectManifestPaths(directory) {
    if (!directory || !fs.existsSync(directory)) return [];

    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) return [];

    const files = fs.readdirSync(directory);
    const manifestNames = files.filter((file) =>
        KNOWN_PLUGIN_MANIFEST_EXTENSIONS.some((extension) => file.endsWith(extension))
    );

    return manifestNames.map((name) => path.join(directory, name));
}

function createSafeLogger(baseName, logger) {
    const fallback = () => { };
    return {
        debug: (message, ...args) => (typeof logger.debug === 'function' ? logger.debug(`[PluginRuntime:${baseName}] ${message}`, ...args) : fallback()),
        info: (message, ...args) => (typeof logger.info === 'function' ? logger.info(`[PluginRuntime:${baseName}] ${message}`, ...args) : fallback()),
        warn: (message, ...args) => (typeof logger.warn === 'function' ? logger.warn(`[PluginRuntime:${baseName}] ${message}`, ...args) : fallback()),
        error: (message, ...args) => (typeof logger.error === 'function' ? logger.error(`[PluginRuntime:${baseName}] ${message}`, ...args) : fallback())
    };
}

function createPluginContext(name, eventBus, logger) {
    const safeLogger = createSafeLogger(name, logger);

    return {
        name,
        bus: eventBus,
        onTrack: (handler) => eventBus.on('track', handler),
        onState: (handler) => eventBus.on('state', handler),
        subscribe: (eventName, handler) => eventBus.on(eventName, handler),
        emit: (eventName, payload) => eventBus.emit(eventName, payload),
        log: {
            debug: (...args) => safeLogger.debug(...args),
            info: (...args) => safeLogger.info(...args),
            warn: (...args) => safeLogger.warn(...args),
            error: (...args) => safeLogger.error(...args)
        }
    };
}

function publishStatus(statusCallback, status) {
    if (typeof statusCallback === 'function') {
        statusCallback(status);
    }
}

function invokeInit(api, manifest, logger) {
    const safeLogger = createSafeLogger(manifest.name, logger);
    const module = require(manifest.entry);
    const initializer = typeof module === 'function'
        ? module
        : (module && (typeof module.init === 'function' ? module.init : null));

    if (!initializer) {
        throw new Error(`Plugin "${manifest.name}" does not export an initializer`);
    }

    safeLogger.info(`Initializing plugin from ${manifest.entry}`);
    const result = initializer(api);

    if (typeof result === 'function') {
        return { dispose: result };
    }
    if (result && typeof result === 'object' && typeof result.dispose === 'function') {
        return { dispose: result.dispose };
    }

    return { dispose: null };
}

function createPluginRuntime(options) {
    const eventBus = options.eventBus;
    const searchDirectories = Array.isArray(options.searchDirectories)
        ? options.searchDirectories.filter(Boolean)
        : [];
    const logger = options.logger || {};
    const onPluginStatus = options.onPluginStatus;

    const plugins = [];

    function loadPlugin(manifestPath) {
        let manifest;

        try {
            const raw = safeReadJson(manifestPath);
            manifest = validatePluginManifest(raw, manifestPath);
            if (!manifest) return;
        } catch (err) {
            const status = {
                name: path.basename(manifestPath),
                status: 'failed',
                reason: err.message
            };
            publishStatus(onPluginStatus, status);
            return;
        }

        try {
            const existing = plugins.find((entry) => entry.name === manifest.name);
            if (existing) {
                throw new Error(`Plugin "${manifest.name}" already loaded`);
            }
            const pluginPath = manifest.entry;

            if (!fs.existsSync(pluginPath) || !pluginPath.endsWith('.js')) {
                throw new Error(`Entry "${pluginPath}" not found or not a .js file`);
            }

            const api = createPluginContext(manifest.name, eventBus, logger);
            const { dispose } = invokeInit(api, manifest, logger);
            const pluginState = {
                name: manifest.name,
                version: manifest.version,
                filePath: manifest.filePath,
                source: manifest.source,
                status: 'active',
                dispose
            };

            plugins.push(pluginState);
            publishStatus(onPluginStatus, {
                name: manifest.name,
                status: 'active',
                file: manifest.filePath,
                version: manifest.version
            });

            return pluginState;
        } catch (err) {
            publishStatus(onPluginStatus, {
                name: manifest.name,
                status: 'failed',
                file: manifest.filePath,
                reason: err.message
            });
        }
    }

    function init() {
        const manifestPaths = searchDirectories.flatMap((dir) => collectManifestPaths(dir));
        if (!manifestPaths.length) {
            publishStatus(onPluginStatus, { name: 'runtime', status: 'idle', reason: 'No manifest files found' });
            return [];
        }

        manifestPaths.forEach(loadPlugin);
        return plugins.map((plugin) => ({
            name: plugin.name,
            status: plugin.status,
            filePath: plugin.filePath,
            version: plugin.version
        }));
    }

    function unload() {
        plugins.forEach((plugin) => {
            if (typeof plugin.dispose === 'function') {
                try {
                    plugin.dispose();
                } catch (err) {
                    const status = {
                        name: plugin.name,
                        status: 'failed',
                        reason: `Failed to dispose: ${err.message}`
                    };
                    publishStatus(onPluginStatus, status);
                }
            }
            plugin.status = 'disposed';
            publishStatus(onPluginStatus, {
                name: plugin.name,
                status: plugin.status
            });
        });
    }

    function getStatusSnapshot() {
        return plugins.map((plugin) => ({
            name: plugin.name,
            status: plugin.status,
            version: plugin.version,
            filePath: plugin.filePath
        }));
    }

    return { init, unload, getStatusSnapshot };
}

module.exports = { createPluginRuntime };
