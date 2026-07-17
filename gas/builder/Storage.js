/**
 * NCGAS Builder — Drive sharded storage.
 *
 * Layout (per user's Drive):
 *   NCGAS_Apps/
 *     <appId>/
 *       manifest.json        plain JSON  (index + deploy state; WRITTEN LAST = commit marker)
 *       globals.json.gz      gzip        (rbac + sharedServices + sharedRules)
 *       page_<pageId>.json.gz gzip       (one shard per page)
 *
 * Shard split/merge logic is shared/blueprint-utils.js (pushed to this project
 * as BlueprintUtils.js by scripts/sync-gas.mjs), so client and server can
 * never disagree about the format. Validation runs before every write.
 */

var Storage_ = {
  ROOT: 'NCGAS_Apps',

  rootFolder_: function () {
    var it = DriveApp.getFoldersByName(this.ROOT);
    return it.hasNext() ? it.next() : DriveApp.createFolder(this.ROOT);
  },

  appFolder_: function (appId, createIfMissing) {
    var root = this.rootFolder_();
    var it = root.getFoldersByName(appId);
    if (it.hasNext()) return it.next();
    if (!createIfMissing) throw NcError_('NOT_FOUND', 'App `' + appId + '` not found in Drive folder ' + this.ROOT);
    return root.createFolder(appId);
  },

  // -------------------------------------------------------- file helpers --

  writeText_: function (folder, name, text) {
    this.deleteByName_(folder, name);
    folder.createFile(name, text, 'application/json');
  },

  writeGzip_: function (folder, name, text) {
    this.deleteByName_(folder, name);
    var blob = Utilities.gzip(Utilities.newBlob(text, 'application/json', name.replace(/\.gz$/, '')));
    blob.setName(name);
    folder.createFile(blob);
  },

  readMaybeGzip_: function (folder, baseName) {
    // prefer .gz, fall back to plain (forward-compat with hand-placed files)
    var it = folder.getFilesByName(baseName + '.gz');
    if (it.hasNext()) {
      return Utilities.ungzip(it.next().getBlob()).getDataAsString('UTF-8');
    }
    it = folder.getFilesByName(baseName);
    if (it.hasNext()) return it.next().getBlob().getDataAsString('UTF-8');
    return null;
  },

  readJson_: function (folder, baseName, requiredLabel) {
    var text = this.readMaybeGzip_(folder, baseName);
    if (text === null) {
      if (requiredLabel) throw NcError_('SHARD_MISSING', 'Missing `' + baseName + '(.gz)` — ' + requiredLabel);
      return null;
    }
    try { return JSON.parse(text); }
    catch (e) { throw NcError_('SHARD_CORRUPT', baseName + ' holds invalid JSON: ' + e.message); }
  },

  deleteByName_: function (folder, name) {
    var it = folder.getFilesByName(name);
    while (it.hasNext()) it.next().setTrashed(true);
  },

  // ------------------------------------------------------------- actions --

  saveApp: function (blueprint) {
    NCGASBlueprint.assertValid(blueprint, { expression: NCGASExpression });
    var shards = NCGASBlueprint.splitIntoShards(blueprint);
    var folder = this.appFolder_(blueprint.appId, true);

    this.writeGzip_(folder, 'globals.json.gz', JSON.stringify(shards.globals));

    var keepFiles = { 'manifest.json': true, 'globals.json.gz': true };
    shards.manifest.pageIds.forEach(function (pageId) {
      var name = 'page_' + pageId + '.json.gz';
      keepFiles[name] = true;
      Storage_.writeGzip_(folder, name, JSON.stringify(shards.pages[pageId]));
    });

    // remove shards of deleted pages so loads can't resurrect them
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (!keepFiles[f.getName()] && /^page_.*\.json(\.gz)?$/.test(f.getName())) f.setTrashed(true);
    }

    shards.manifest.savedAt = new Date().toISOString();
    this.writeText_(folder, 'manifest.json', JSON.stringify(shards.manifest, null, 2));

    return { savedAt: shards.manifest.savedAt, shards: shards.manifest.pageIds.length + 2, folderUrl: folder.getUrl() };
  },

  loadApp: function (appId) {
    var folder = this.appFolder_(appId, false);
    var manifest = this.readJson_(folder, 'manifest.json', 'app index is gone; the save may have been interrupted');
    var globals = this.readJson_(folder, 'globals.json', 'globals shard referenced by manifest');
    var pages = {};
    (manifest.pageIds || []).forEach(function (pageId) {
      pages[pageId] = Storage_.readJson_(folder, 'page_' + pageId + '.json', 'page shard referenced by manifest');
    });
    var blueprint = NCGASBlueprint.mergeShards(manifest, globals, pages);
    NCGASBlueprint.assertValid(blueprint, { expression: NCGASExpression });
    return blueprint;
  },

  listApps: function () {
    var root = this.rootFolder_();
    var out = [];
    var folders = root.getFolders();
    while (folders.hasNext()) {
      var folder = folders.next();
      try {
        var manifest = this.readJson_(folder, 'manifest.json', null);
        if (!manifest) continue;
        out.push({
          appId: manifest.appId,
          name: (manifest.meta && manifest.meta.name) || manifest.appId,
          updatedAt: (manifest.meta && manifest.meta.lastModified) || manifest.savedAt,
          pages: (manifest.pageIds || []).length,
          url: manifest.deploy && manifest.deploy.url
        });
      } catch (e) {
        out.push({ appId: folder.getName(), name: folder.getName() + ' (corrupt: ' + e.message + ')', broken: true });
      }
    }
    return out.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
  },

  deleteApp: function (appId) {
    this.appFolder_(appId, false).setTrashed(true);
    return { deleted: appId };
  },

  /** Persist deployment coordinates after a successful compile. */
  updateDeploy: function (appId, deploy) {
    var folder = this.appFolder_(appId, false);
    var manifest = this.readJson_(folder, 'manifest.json', 'cannot update deploy info');
    manifest.deploy = deploy;
    this.writeText_(folder, 'manifest.json', JSON.stringify(manifest, null, 2));
    return manifest.deploy;
  }
};
