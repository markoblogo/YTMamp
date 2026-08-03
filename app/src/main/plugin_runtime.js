const fs = require('fs');
const path = require('path');

const KNOWN_PLUGIN_MANIFEST_EXTENSIONS = ['.plugin.json', '.json'];
const PANEL_TITLE_MAX_LENGTH = 80;
const PANEL_TEXT_MAX_LENGTH = 200;
const PANEL_ID_PATTERN = /^[a-zA-Z0-9._-]{1,80}$/;

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

function sanitizePanelPayload(payload, pluginName) {
    if (!payload || typeof payload !== 'object') {
        throw new Error(`Plugin "${pluginName}" passed invalid panel payload`);
    }

    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!PANEL_ID_PATTERN.test(id)) {
        throw new Error(`Plugin "${pluginName}" panel id invalid`);
    }

    if (typeof payload.html === 'string' || typeof payload.css === 'string' || payload.dom === 'object') {
        throw new Error(`Plugin "${pluginName}" panel payload contains unsafe DOM field`);
    }

    if (typeof payload.title !== 'undefined' && typeof payload.title !== 'string') {
        throw new Error(`Plugin "${pluginName}" panel title must be a string`);
    }
    if (typeof payload.text !== 'undefined' && typeof payload.text !== 'string') {
        throw new Error(`Plugin "${pluginName}" panel text must be a string`);
    }

    const text = (typeof payload.text === 'string' ? payload.text : '').slice(0, PANEL_TEXT_MAX_LENGTH).trim();

    return {
        id,
        title: (typeof payload.title === 'string' ? payload.title : id).slice(0, PANEL_TITLE_MAX_LENGTH),
        text
    };
}

function safeJsonClone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (err) {
        return value;
    }
}

function createPluginContext(name, eventBus, logger, onPanelMountRequest) {
    const safeLogger = createSafeLogger(name, logger);
    const safeHandlerCall = (handlerName, handler, payload) => {
        try {
            handler(payload);
        } catch (err) {
            safeLogger.error(`[handler:${handlerName}]`, err.message);
        }
    };

    const safeSubscribe = (eventName, handler) => {
        if (typeof handler !== 'function') {
            throw new Error(`Handler for ${eventName} must be function`);
        }
        return eventBus.on(eventName, (payload) => safeHandlerCall(eventName, handler, safeJsonClone(payload)));
    };

    const requestPanelMount = (payload) => {
        try {
            const panel = sanitizePanelPayload(payload, name);
            if (typeof onPanelMountRequest === 'function') {
                return onPanelMountRequest({ plugin: name, type: 'panel.mount', panel });
            }
            return { status: 'unsupported', reason: 'Panel mounts are not supported' };
        } catch (err) {
            safeLogger.warn(`Blocking panel registration for "${name}": ${err.message}`);
            if (typeof onPanelMountRequest === 'function') {
                onPanelMountRequest({
                    type: 'panel.mount',
                    plugin: name,
                    status: 'blocked',
                    reason: err.message
                });
            }
            return { status: 'blocked', reason: err.message };
        }
    };

    return {
        name,
        bus: eventBus,
        onTrack: (handler) => safeSubscribe('track', handler),
        onState: (handler) => safeSubscribe('state', handler),
        subscribe: (eventName, handler) => safeSubscribe(eventName, handler),
        emit: (eventName, payload) => {
            try {
                return eventBus.emit(eventName, payload);
            } catch (err) {
                safeLogger.error(`emit failed for event "${eventName}": ${err.message}`);
                return false;
            }
        },
        mountPanel: (payload) => requestPanelMount(payload),
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
    const onPluginUI = options.onPluginUI;

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

            const api = createPluginContext(manifest.name, eventBus, logger, (request) => {
                if (request.type === 'panel.mount') {
                    const uiPayload = {
                        ...request,
                        status: 'ok',
                        panelId: request.panel && request.panel.id
                    };
                    if (typeof onPluginUI === 'function') onPluginUI(uiPayload);
                    return {
                        status: 'ok',
                        type: request.type,
                        panelId: request.panel && request.panel.id
                    };
                }
                const uiPayload = { ...request, status: 'ok' };
                if (typeof onPluginUI === 'function') onPluginUI(uiPayload);
                return { status: 'ok' };
            });
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
