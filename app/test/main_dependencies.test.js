const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const mainPath = path.join(__dirname, '../src/main/main.js');

test('all relative main-process requires resolve to packaged source files', () => {
    const source = fs.readFileSync(mainPath, 'utf8');
    const requireFromMain = createRequire(pathToFileURL(mainPath));
    const imports = [...source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)].map((match) => match[1]);

    assert.ok(imports.length > 0);
    for (const modulePath of imports) {
        assert.doesNotThrow(
            () => requireFromMain.resolve(modulePath),
            `Cannot resolve ${modulePath} from src/main/main.js`
        );
    }
});
