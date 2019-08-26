const fs = require(`fs`);
const path = require(`path`);
const childProcess = require(`child_process`);
const JSZip = require(`jszip`);
const chalk = require(`chalk`);
const disparity = require(`disparity`);
const dirCompare = require(`dir-compare`);
const promisify = require(`util`).promisify;
const mkdirp = promisify(require(`mkdirp`));
const del = promisify(require(`node-delete`));

/**
 * @typedef PluginDiffOutput
 * @type {object}
 * @property {array.<string>} removedFiles Removed outputted files' paths.
 * @property {array.<string>} addedFiles Added outputted files' paths.
 * @property {object} changedFiles Changed outputted files' paths pointing to their diff.
 */

/**
 * Exports the given fixtures with the current version of the given currentPlugin and diffs the results
 * against the files exported with the comparePlugin at the state of the given Git reference.
 * @param {string} currentPluginKey The key of a currently present plugin.
 * @param {string} comparePluginKey The key of a plugin that needs to be present in the given Git reference.
 * @param {string} ref The Git reference to compare with, for example `master`, `HEAD~1` or a commit reference.
 * @param {array.<string>} fixtures Paths to the compared fixtures, relative to the current working directory.
 * @returns {Promise<PluginDiffOutput>} Information what output files were removed, added or changed plus the diffs for changed files.
 */
module.exports = async function diffPluginOutputs(currentPluginKey, comparePluginKey, ref, fixtures) {
  const date = new Date();

  // get manufacturer and fixture data later used by export plugins
  fixtures = fixtures.map(relativePath => {
    const absolutePath = path.join(process.cwd(), relativePath);
    return [
      path.basename(path.dirname(absolutePath)), // man key
      path.basename(absolutePath, path.extname(absolutePath)) // fix key
    ];
  });

  console.log(`## Diffing plugin output`);
  console.log(`# current plugin:`, currentPluginKey);
  console.log(`# compare plugin:`, comparePluginKey);
  console.log(`# ref:`, ref);
  console.log(`# fixtures:`, fixtures.map(([man, fix]) => `${man}/${fix}`).join(`, `));
  console.log();

  const tempDir = path.join(__dirname, `..`, `tmp`);
  if (process.cwd().match(tempDir)) {
    console.error(`${chalk.red(`[Error]`)} This script can't be run from inside the tmp directory.`);
    process.exit(1);
  }

  const currentOut = path.join(tempDir, `current_output`);
  const compareOut = path.join(tempDir, `compare_output`);

  // delete old temp folder and recreate it
  await del([tempDir], { force: true });
  await mkdirp(tempDir);

  // export with current plugin script
  try {
    await exportFixtures(
      currentOut,
      path.join(__dirname, `..`, `plugins`, currentPluginKey, `export.js`),
      path.join(__dirname, `..`)
    );
  }
  catch (error) {
    console.error(`${chalk.red(`[Error]`)} Exporting with current plugin script failed:`, error);
    process.exit(1);
  }

  // get compare script and fixture files as archive
  const compareArchivePath = path.join(tempDir, `compare.zip`);
  const unzipDir = path.join(tempDir, `compareFiles`);

  try {
    await promisify(childProcess.exec)(`git archive ${ref} -o ${compareArchivePath}`, {
      cwd: path.join(__dirname, `..`),
      encoding: `utf-8`
    });
  }
  catch (error) {
    console.error(`${chalk.red(`[Error]`)} Failed to download compare plugin script: ${error.message}`);
    process.exit(1);
  }

  // unzip compare archive
  await mkdirp(unzipDir);
  const compareArchiveData = await promisify(fs.readFile)(compareArchivePath);
  const zip = await JSZip.loadAsync(compareArchiveData);

  await Promise.all(Object.keys(zip.files).map(async fileName => {
    const file = zip.files[fileName];
    const filePath = path.join(unzipDir, file.name);

    if (file.dir) {
      return;
    }

    await mkdirp(path.dirname(filePath));
    const fileBuffer = await file.async(`nodebuffer`);
    await promisify(fs.writeFile)(filePath, fileBuffer);
  }));

  // delete compare archive
  await del(compareArchivePath, { force: true });

  // export with compare plugin script
  try {
    await exportFixtures(
      compareOut,
      path.join(unzipDir, `plugins`, comparePluginKey, `export.js`),
      unzipDir
    );
  }
  catch (error) {
    console.error(`${chalk.red(`[Error]`)} Exporting with compare plugin script failed:`, error);
    process.exit(1);
  }

  // find the differences
  const outputData = await findDifferences(currentOut, compareOut);

  console.log(`Done.`);
  return outputData;


  /**
   *
   * @param {string} outputPath The path where to output the exported fixtures.
   * @param {string} pluginScript The path of the plugin export script.
   * @param {string} baseDir The OFL root directory.
   * @returns {Promise.<*, Error>} A Promise that resolves when all exported fixtures are saved to the filesystem.
   */
  async function exportFixtures(outputPath, pluginScript, baseDir) {
    const plugin = require(pluginScript);
    const { fixtureFromRepository } = require(path.join(baseDir, `lib`, `model.js`));

    const outFiles = await plugin.export(fixtures.map(([man, fix]) => fixtureFromRepository(man, fix)), {
      baseDir: baseDir,
      date: date,
      displayedPluginVersion: `dummy version by diff-plugin-outputs`
    });

    return await Promise.all(outFiles.map(async outFile => {
      const outFilePath = path.join(outputPath, outFile.name);
      await mkdirp(path.dirname(outFilePath));
      await promisify(fs.writeFile)(outFilePath, outFile.content);
    }));
  }
};

/**
 * @param {string} currentOut The output directory of the current version.
 * @param {string} compareOut The output directory of the compare version.
 * @returns {Promise<PluginDiffOutput>} The plugin diff output object.
 */
async function findDifferences(currentOut, compareOut) {
  const diffResult = await dirCompare.compare(compareOut, currentOut, {
    compareContent: true
  });

  /** @type {PluginDiffOutput} */
  const outputData = {
    removedFiles: [],
    addedFiles: [],
    changedFiles: {}
  };

  for (const difference of diffResult.diffSet) {
    let name;

    switch (difference.state) {
      case `equal`:
        continue;

      case `left`:
        name = getRelativePath(difference.relativePath, difference.name1, difference.type1);

        console.log(chalk.red(`File or directory ${name} was removed.`));

        outputData.removedFiles.push(name);
        continue;

      case `right`:
        name = getRelativePath(difference.relativePath, difference.name2, difference.type2);

        console.log(chalk.green(`File or directory ${name} was added.`));

        outputData.addedFiles.push(name);
        continue;

      case `distinct`: {
        name = getRelativePath(difference.relativePath, difference.name2, difference.type2);
        const file1 = fs.readFileSync(path.join(difference.path1, difference.name1), `utf8`);
        const file2 = fs.readFileSync(path.join(difference.path2, difference.name2), `utf8`);

        console.log(chalk.yellow(`Diff for ${name}`));
        console.log(disparity.unified(file1, file2));

        outputData.changedFiles[name] = disparity.unifiedNoColor(file1, file2);
        continue;
      }
    }
  }

  return outputData;
}

/**
 * @param {string} relativePath The relative path to the directory containing the item. relativePath in diffSet.
 * @param {string} name The item's name. name1/name2 in diffSet.
 * @param {'file'|'directory'} type Specifies if the item is a file or a directory. type1/type2 in diffSet.
 * @returns {string} The relative path to the item itself. Ends with an '/' if the item is a directory.
 */
function getRelativePath(relativePath, name, type) {
  if (type === `directory`) {
    return path.join(`.`, relativePath, name, `/`); // the '.' removes a '/' in the beginning of the relative path
  }
  return path.join(`.`, relativePath, name);
}
