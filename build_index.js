const fs = require('fs');
const path = require('path');

const DUMPS_DIR = path.join(__dirname, 'scts дампы');
const OUTPUT_DIR = path.join(__dirname, 'scts_chunks');
const TARGET_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per chunk

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log('📂 Reading dumps from:', DUMPS_DIR);

// Read all dump files
const dumpFiles = fs.readdirSync(DUMPS_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();

console.log(`📄 Found ${dumpFiles.length} dump files`);

let allContent = [];

// Combine all dumps
for (const file of dumpFiles) {
  const filePath = path.join(DUMPS_DIR, file);
  console.log(`  Reading ${file}...`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  allContent = allContent.concat(data);
}

console.log(`✅ Total items: ${allContent.length}`);

// Normalize names for search
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Create compact index
const index = [];
const idToChunk = {};

allContent.forEach((item, idx) => {
  const normName = normalizeName(item.name);
  index.push({
    id: item.id,
    name: item.name,
    year: item.year,
    normName: normName,
    idx: idx
  });
  idToChunk[item.id] = null; // Will be filled after chunking
});

console.log(`📊 Index created: ${index.length} entries`);

// Split content into chunks
const chunks = [];
let currentChunk = [];
let currentSize = 0;

for (let i = 0; i < allContent.length; i++) {
  const itemJson = JSON.stringify(allContent[i]);
  const itemSize = Buffer.byteLength(itemJson, 'utf8');

  if (currentSize + itemSize > TARGET_CHUNK_SIZE && currentChunk.length > 0) {
    chunks.push(currentChunk);
    currentChunk = [];
    currentSize = 0;
  }

  currentChunk.push(allContent[i]);
  currentSize += itemSize;
}

if (currentChunk.length > 0) {
  chunks.push(currentChunk);
}

console.log(`📦 Split into ${chunks.length} chunks`);

// Write chunks
chunks.forEach((chunk, chunkIdx) => {
  const chunkFile = `chunk_${String(chunkIdx + 1).padStart(3, '0')}.json`;
  const chunkPath = path.join(OUTPUT_DIR, chunkFile);
  fs.writeFileSync(chunkPath, JSON.stringify(chunk), 'utf8');

  const sizeKB = (Buffer.byteLength(JSON.stringify(chunk), 'utf8') / 1024).toFixed(1);
  console.log(`  ✓ ${chunkFile} (${sizeKB}KB, ${chunk.length} items)`);

  // Map IDs to chunk
  chunk.forEach(item => {
    idToChunk[item.id] = chunkIdx;
  });
});

// Update index with chunk info
const indexWithChunks = index.map(entry => ({
  ...entry,
  chunk_id: idToChunk[entry.id]
}));

// Write index
const indexPath = path.join(OUTPUT_DIR, 'index.json');
fs.writeFileSync(indexPath, JSON.stringify(indexWithChunks, null, 2), 'utf8');

const indexSizeKB = (Buffer.byteLength(JSON.stringify(indexWithChunks), 'utf8') / 1024).toFixed(1);
console.log(`\n✅ Index written: ${indexSizeKB}KB`);

console.log(`\n🎉 Build complete!`);
console.log(`   Output: ${OUTPUT_DIR}`);
console.log(`   Files: index.json + ${chunks.length} chunks`);
console.log(`\n📤 Next: Add to git and push`);
console.log(`   git add scts_chunks/`);
console.log(`   git commit -m "Add indexed chunks"`);
console.log(`   git push`);
