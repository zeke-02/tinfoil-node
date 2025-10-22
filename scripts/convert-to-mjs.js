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

      content = content.replace(/from\s+["'](\..+?)\.js["']/g, 'from "$1.mjs"');
      content = content.replace(/from\s+["'](\..+?)["']/g, 'from "$1.mjs"');
      content = content.replace(/import\s*\(\s*["'](\..+?)\.js["']\s*\)/g, 'import("$1.mjs")');
      content = content.replace(/import\s*\(\s*["'](\..+?)["']\s*\)/g, 'import("$1.mjs")');

      const mjsPath = filePath.replace(/\.js$/, '.mjs');
      fs.writeFileSync(mjsPath, content);
      fs.unlinkSync(filePath);
    }
  }
}

convertToMjs(esmDir);
console.log('Converted all .js files to .mjs in dist/esm');
