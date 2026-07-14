const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

let modifiedFiles = 0;

walkDir('src', function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // 1. Replace hardcoded color: 'white' -> color: 'var(--text-primary)'
    // BUT only when the element has a background from the theme, like var(--bg-tertiary)
    // Actually, looking at the codebase, most `color: 'white'` are for text that should adapt,
    // EXCEPT when inside an element that explicitly has a hardcoded background (e.g., #3b82f6, #10b981).
    // Let's do a simple regex: if a line has `color: 'white'` AND `var(--bg-`, we replace it.
    
    // We split by lines to make it safer
    let lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("color: 'white'") || lines[i].includes('color: "white"')) {
        if (lines[i].includes('var(--bg-') || lines[i].includes('backgroundColor: \'transparent\'')) {
          lines[i] = lines[i].replace(/color:\s*['"]white['"]/g, "color: 'var(--text-primary)'");
        } else if (!lines[i].match(/backgroundColor:\s*['"]#(3b82f6|10b981|ef4444|8b5cf6|f59e0b)['"]/)) {
          // If there's no hardcoded colored background, let's also replace it to be safe
          // But wait, what if it's a generic text like <h2 style={{color: 'white'}}>?
          // We should change it to var(--text-primary)
          lines[i] = lines[i].replace(/color:\s*['"]white['"]/g, "color: 'var(--text-primary)'");
        }
      }
      
      // Do the same for color: '#fff' or '#ffffff'
      if (lines[i].match(/color:\s*['"]#(fff|ffffff)['"]/i)) {
        if (!lines[i].match(/backgroundColor:\s*['"]#(3b82f6|10b981|ef4444|8b5cf6|f59e0b)['"]/i)) {
          // exception: if it's inside Tooltip contentStyle, wait, I will fix Dashboard manually or let this handle it.
          // exception: alerts.ts confirmButtonColor
          if (!filePath.includes('alerts.ts') && !lines[i].includes('backgroundColor: \'#1e293b\'') && !lines[i].includes('borderRadius: \'50%\'')) {
             lines[i] = lines[i].replace(/color:\s*['"]#(fff|ffffff)['"]/gi, "color: 'var(--text-primary)'");
          }
        }
      }

      // Recharts Dashboard tooltips
      if (filePath.includes('Dashboard.tsx') || filePath.includes('SuperAdmin.tsx')) {
        lines[i] = lines[i].replace(/backgroundColor:\s*['"]#(1a1a1e|1e293b)['"]/g, "backgroundColor: 'var(--bg-secondary)'");
        lines[i] = lines[i].replace(/borderColor:\s*['"]#27272a['"]/g, "borderColor: 'var(--border-color)'");
        lines[i] = lines[i].replace(/color:\s*['"]#f8f8f8['"]/g, "color: 'var(--text-primary)'");
      }
    }
    
    content = lines.join('\n');

    if (content !== original) {
      fs.writeFileSync(filePath, content);
      console.log('Modified: ' + filePath);
      modifiedFiles++;
    }
  }
});

console.log('Total files modified: ' + modifiedFiles);
