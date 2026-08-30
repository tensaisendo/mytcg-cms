const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const FILE_UID = 'plugin::upload.file';
const FOLDER_UID = 'plugin::upload.folder';

function parseArgs(argv) {
  const args = {
    concurrency: 1,
    retries: 2,
    recursive: false,
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--source') {
      args.source = argv[index + 1];
      index += 1;
    } else if (arg === '--target') {
      args.target = argv[index + 1];
      index += 1;
    } else if (arg === '--concurrency') {
      args.concurrency = Math.max(1, Number(argv[index + 1]) || 1);
      index += 1;
    } else if (arg === '--retries') {
      args.retries = Math.max(0, Number(argv[index + 1]) || 0);
      index += 1;
    } else if (arg === '--recursive') {
      args.recursive = true;
    } else if (arg === '--write') {
      args.write = true;
    }
  }

  if (!args.source || !args.target) {
    throw new Error(
      'Usage: npm run media:upload-folder -- --source "C:\\path\\OP09" --target "EN/OP09 - NAME" [--write]'
    );
  }

  return args;
}

function listImageFiles(source, recursive) {
  const files = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (recursive) walk(fullPath);
        continue;
      }

      if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  walk(source);
  return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
}

function findLocalDuplicates(files) {
  const seen = new Map();
  const duplicates = [];

  for (const filePath of files) {
    const key = path.basename(filePath).toLowerCase();
    const previous = seen.get(key);

    if (previous) {
      duplicates.push([previous, filePath]);
    } else {
      seen.set(key, filePath);
    }
  }

  return duplicates;
}

async function getFolders() {
  return strapi.db.query(FOLDER_UID).findMany({
    populate: { parent: true },
    orderBy: { path: 'asc' },
  });
}

function findFolderByNameAndParent(folders, name, parentId) {
  return folders.find((folder) => {
    const folderParentId = folder.parent?.id || null;
    return folder.name === name && folderParentId === parentId;
  });
}

async function ensureFolderPath(targetPath, dryRun) {
  const parts = targetPath
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) throw new Error('Target folder cannot be empty');

  let folders = await getFolders();
  let parent = null;

  for (const name of parts) {
    let folder = findFolderByNameAndParent(folders, name, parent?.id || null);

    if (!folder) {
      if (dryRun) {
        console.log(`DRY RUN would create folder: ${parent ? `${parent.path}/` : ''}${name}`);
        return {
          id: null,
          path: null,
          name,
        };
      }

      folder = await strapi.plugin('upload').service('folder').create({
        name,
        parent: parent?.id || null,
      });
      console.log(`CREATED FOLDER ${folder.path} ${name}`);
      folders = await getFolders();
    }

    parent = folder;
  }

  return parent;
}

async function getExistingFilesByName(folderPath) {
  const files = await strapi.db.query(FILE_UID).findMany({
    where: {
      folderPath,
    },
    select: ['id', 'name', 'folderPath', 'url'],
  });

  const byName = new Map();
  const duplicates = [];

  for (const file of files) {
    const key = String(file.name || '').toLowerCase();
    const previous = byName.get(key);

    if (previous) duplicates.push([previous, file]);
    else byName.set(key, file);
  }

  return { byName, duplicates };
}

function getFilePayload(filePath) {
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const mimeType = mime.lookup(fileName) || 'application/octet-stream';

  return {
    filepath: filePath,
    originalFilename: fileName,
    size: stat.size,
    mimetype: mimeType,
  };
}

async function uploadOne(filePath, folderId) {
  const fileName = path.basename(filePath);
  const [uploadedFile] = await strapi.plugin('upload').service('upload').upload({
    files: getFilePayload(filePath),
    data: {
      fileInfo: {
        name: fileName,
        alternativeText: fileName,
        caption: fileName,
        folder: folderId,
      },
    },
  });

  return uploadedFile;
}

async function uploadWithRetry(filePath, folderId, retries) {
  let attempt = 0;

  while (true) {
    try {
      return await uploadOne(filePath, folderId);
    } catch (error) {
      attempt += 1;
      if (attempt > retries) throw error;
      console.log(`RETRY ${attempt}/${retries} ${path.basename(filePath)} ${error.message}`);
    }
  }
}

async function runQueue(items, concurrency, worker) {
  const results = [];
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = path.resolve(args.source);

  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Source folder does not exist: ${source}`);
  }

  const files = listImageFiles(source, args.recursive);
  const localDuplicates = findLocalDuplicates(files);

  console.log(`SOURCE ${source}`);
  console.log(`TARGET ${args.target}`);
  console.log(`MODE ${args.write ? 'WRITE' : 'DRY RUN'}`);
  console.log(`FILES ${files.length}`);

  if (localDuplicates.length) {
    console.log('\nLOCAL DUPLICATE FILENAMES');
    for (const [first, second] of localDuplicates) {
      console.log(`- ${path.basename(first)}: ${first} | ${second}`);
    }
    throw new Error('Resolve local duplicate filenames before upload');
  }

  const folder = await ensureFolderPath(args.target, !args.write);

  if (!folder?.id || !folder?.path) {
    console.log('\nDRY RUN stopped before remote duplicate check because the target folder does not exist yet.');
    return;
  }

  const before = await getExistingFilesByName(folder.path);

  if (before.duplicates.length) {
    console.log('\nREMOTE DUPLICATE FILENAMES IN TARGET FOLDER');
    for (const [first, second] of before.duplicates) {
      console.log(`- ${first.name}: ids ${first.id} and ${second.id}`);
    }
  }

  const toUpload = [];
  const existing = [];

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const remote = before.byName.get(fileName.toLowerCase());

    if (remote) existing.push({ filePath, remote });
    else toUpload.push(filePath);
  }

  console.log(`EXISTING ${existing.length}`);
  console.log(`TO UPLOAD ${toUpload.length}`);

  if (!args.write) {
    console.log('\nDRY RUN no file uploaded.');
    if (toUpload.length) {
      console.log('First files to upload:');
      for (const filePath of toUpload.slice(0, 20)) console.log(`- ${path.basename(filePath)}`);
      if (toUpload.length > 20) console.log(`... ${toUpload.length - 20} more`);
    }
    return;
  }

  const uploaded = [];
  const failed = [];

  await runQueue(toUpload, args.concurrency, async (filePath, index) => {
    const fileName = path.basename(filePath);

    try {
      const uploadedFile = await uploadWithRetry(filePath, folder.id, args.retries);
      uploaded.push(uploadedFile);
      console.log(`[${index + 1}/${toUpload.length}] UPLOADED ${fileName}`);
      return uploadedFile;
    } catch (error) {
      failed.push({ filePath, message: error.message });
      console.log(`[${index + 1}/${toUpload.length}] FAILED ${fileName} ${error.message}`);
      return null;
    }
  });

  const after = await getExistingFilesByName(folder.path);
  const missingAfter = files.filter((filePath) => !after.byName.has(path.basename(filePath).toLowerCase()));

  console.log('\nSUMMARY');
  console.log(`existing before: ${existing.length}`);
  console.log(`uploaded: ${uploaded.length}`);
  console.log(`failed: ${failed.length}`);
  console.log(`missing after verification: ${missingAfter.length}`);

  if (failed.length) {
    console.log('\nFAILED FILES');
    for (const item of failed) console.log(`- ${item.filePath}: ${item.message}`);
  }

  if (missingAfter.length) {
    console.log('\nMISSING AFTER VERIFICATION');
    for (const filePath of missingAfter) console.log(`- ${path.basename(filePath)}`);
    process.exitCode = 1;
  }
}

async function bootstrap() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    await main();
  } finally {
    await app.destroy();
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
