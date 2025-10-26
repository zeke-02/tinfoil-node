#!/usr/bin/env node

/**
 * Converts all .js files in dist/esm to .mjs and updates import paths
 */

const fs = require('fs');
const path = require('path');

const esmDir = path.join(__dirname, '..', 'dist', 'esm');

function getAllJsFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
    } else if (item.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function updateImportPaths(content) {
  // Replace .js extensions in import/export statements with .mjs
  // Also add .mjs to imports that don't have any extension
  
  // First, replace existing .js extensions with .mjs
  content = content.replace(/from\s+['"](\.\.?\/[^'"]+)\.js['"]/g, 'from "$1.mjs"');
  content = content.replace(/import\s*\(\s*['"](\.\.?\/[^'"]+)\.js['"]\s*\)/g, 'import("$1.mjs")');
  
  // Then, add .mjs to relative imports without extensions
  // Match from "./something" or from "../something" but not from "package-name"
  content = content.replace(/from\s+["'](\.\.?\/[^"']+)["']/g, (match, path) => {
    // Don't add extension if it already has one (check for file extensions like .js, .mjs, .json, etc.)
    if (/\.(m?js|json)$/.test(path)) {
      return match;
    }
    // Add .mjs extension
    const quote = match.includes('"') ? '"' : "'";
    return `from ${quote}${path}.mjs${quote}`;
  });
  
  // Handle dynamic imports
  content = content.replace(/import\s*\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g, (match, path) => {
    if (/\.(m?js|json)$/.test(path)) {
      return match;
    }
    const quote = match.includes('"') ? '"' : "'";
    return `import(${quote}${path}.mjs${quote})`;
  });
  
  return content;
}

function convertToMjs() {
  if (!fs.existsSync(esmDir)) {
    console.error(`ESM directory not found: ${esmDir}`);
    process.exit(1);
  }

  const jsFiles = getAllJsFiles(esmDir);
  
  for (const jsFile of jsFiles) {
    // Read the file content
    let content = fs.readFileSync(jsFile, 'utf8');
    
    // Update import paths
    content = updateImportPaths(content);
    
    // Write to .mjs file
    const mjsFile = jsFile.replace(/\.js$/, '.mjs');
    fs.writeFileSync(mjsFile, content, 'utf8');
    
    // Delete the original .js file
    fs.unlinkSync(jsFile);
  }
  
  console.log(`Converted all .js files to .mjs in ${esmDir}`);
}

convertToMjs();

