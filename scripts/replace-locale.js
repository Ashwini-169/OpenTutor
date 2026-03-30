const fs = require('fs');
const path = require('path');

const dirsToSearch = ['app', 'components', 'lib', 'community'];
const root = 'I:/Project/openMAIC/OpenMaic';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else {
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.md')) {
        results.push(filePath);
      }
    }
  }
  return results;
}

dirsToSearch.forEach(dir => {
  const fullPath = path.join(root, dir);
  if (!fs.existsSync(fullPath)) return;
  const files = walk(fullPath);
  files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;
    
    // Replace standard strings
    content = content.replace(/zh-CN/g, 'hi-IN');
    content = content.replace(/zh-cn/g, 'hi-in');
    content = content.replace(/ZhCN/g, 'HiIN');
    content = content.replace(/简体中文/g, 'Hinglish');
    
    // Specifically in TTS constants to use Indian voices
    // We update some known voice names if they matched Chinese before
    content = content.replace(/XiaoxiaoNeural/g, 'SwaraNeural');
    content = content.replace(/YunxiNeural/g, 'MadhurNeural');
    
    if (content !== original) {
      fs.writeFileSync(file, content, 'utf8');
      console.log('Updated:', file);
    }
  });
});
