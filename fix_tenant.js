const fs = require('fs');
const path = require('path');

const srcDir = path.join('c:/Users/USER/Desktop/Sistema Nexus Company/src');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

let count = 0;

walkDir(srcDir, (filePath) => {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    if (content.includes("where('tenantId', '==', currentUser.uid)")) {
      content = content.replace(/where\('tenantId',\s*'==',\s*currentUser\.uid\)/g, "where('tenantId', '==', tenantId)");
      changed = true;
    }
    
    if (content.includes("tenantId: currentUser.uid")) {
      content = content.replace(/tenantId:\s*currentUser\.uid/g, "tenantId");
      changed = true;
    }
    
    if (content.includes("doc(db, 'configuracoes', currentUser.uid)")) {
      content = content.replace(/doc\(db,\s*'configuracoes',\s*currentUser\.uid\)/g, "doc(db, 'configuracoes', tenantId || '')");
      changed = true;
    }

    if (changed) {
      // Ensure tenantId is in useAuth destructing
      content = content.replace(/const\s+\{([^}]*currentUser[^}]*)\}\s*=\s*useAuth\(\)/g, (match, p1) => {
        if (!p1.includes('tenantId')) {
            return `const { ${p1.trim()}, tenantId } = useAuth()`;
        }
        return match;
      });
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated: ${filePath}`);
      count++;
    }
  }
});

console.log(`Total files updated: ${count}`);
