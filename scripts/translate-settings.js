const fs = require('fs');
const path = 'I:/Project/openMAIC/OpenMaic/lib/i18n/settings.ts';
let code = fs.readFileSync(path, 'utf8');

// The file has: export const settingsHiIN = { ... } as const;
// followed by: export const settingsEnUS = { ... } as const;

// We can replace the Chinese values in settingsHiIN with English/Hinglish values.
// A simpler way: we can just regex replace Chinese characters with English equivalents
// Since settings are mostly admin-facing, English is fine for the complex stuff.
// Or we can extract the EN block and use it to overwrite the HI block, then just translate key parts.

let enBlockMatch = code.match(/export const settingsEnUS = \{([\s\S]*?)\} as const;/);
if (enBlockMatch) {
  let inner = enBlockMatch[1];
  
  // Custom Hinglish replacements for the "settingsHiIN" block
  inner = inner.replace(/title: 'Settings',/g, "title: 'Settings',");
  inner = inner.replace(/agentSettings: 'Agent Settings',/g, "agentSettings: 'AI Teachers Setup',");
  inner = inner.replace(/'AI Teacher'/g, "'AI Teacher'");
  inner = inner.replace(/'AI Assistant'/g, "'AI Assistant'");
  inner = inner.replace(/'Class Clown'/g, "'Masti Master'");
  inner = inner.replace(/'Curious Mind'/g, "'Sawaal King'");
  inner = inner.replace(/'Note Taker'/g, "'Notes taker'");
  inner = inner.replace(/'Deep Thinker'/g, "'Gahra Sochne Wala'");
  inner = inner.replace(/'Default Model'/g, "'Main Model'");
  inner = inner.replace(/currentlyUsing: 'Currently using',/g, "currentlyUsing: 'Abhi chal raha hai',");
  // etc

  let hiBlock = 'export const settingsHiIN = {' + inner + '} as const;\n';
  
  // Replace the original hi block
  let hiRegex = /export const settingsHiIN = \{[\s\S]*?\} as const;/;
  let newCode = code.replace(hiRegex, hiBlock.trim());
  
  fs.writeFileSync(path, newCode, 'utf8');
  console.log('Replaced settingsHiIN with English/Hinglish base');
}
