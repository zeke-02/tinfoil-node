#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const esmDir = path.join(__dirname, '..', 'dist', 'esm');

function convertToMjs(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      convertToMjs(filePath);
    } else if (file.endsWith('.js') && !file.endsWith('.mjs')) {
      let content = fs.readFileSync(filePath, 'utf8');

      // Replace .js extensions with .mjs in import statements
      // Match: from "./path/to/file.js" -> from "./path/to/file.mjs"
      content = content.replace(/from\s+(["'])(\.[^"']+?)\.js\1/g, 'from $1$2.mjs$1');

      // Match imports without .js extension and add .mjs
      // Match: from "./path/to/file" -> from "./path/to/file.mjs"
      content = content.replace(/from\s+(["'])(\.\/[^"']+?)(?<!\.mjs)\1/g, (match, quote, path) => {
        // Don't add .mjs if it already has an extension
        if (path.match(/\.\w+$/)) {
          return match;
        }
        return `from ${quote}${path}.mjs${quote}`;
      });

      // Handle dynamic imports with .js extension
      // Match: import("./path/to/file.js") -> import("./path/to/file.mjs")
      content = content.replace(/import\s*\(\s*(["'])(\.[^"']+?)\.js\1\s*\)/g, 'import($1$2.mjs$1)');

      // Handle dynamic imports without extension
      // Match: import("./path/to/file") -> import("./path/to/file.mjs")
      content = content.replace(/import\s*\(\s*(["'])(\.\/[^"']+?)(?<!\.mjs)\1\s*\)/g, (match, quote, path) => {
        // Don't add .mjs if it already has an extension
        if (path.match(/\.\w+$/)) {
          return match;
        }
        return `import(${quote}${path}.mjs${quote})`;
      });

      const mjsPath = filePath.replace(/\.js$/, '.mjs');
      fs.writeFileSync(mjsPath, content);
      fs.unlinkSync(filePath);
    }
  }
}

convertToMjs(esmDir);
console.log('Converted all .js files to .mjs in dist/esm');
