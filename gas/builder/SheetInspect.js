/**
 * NCGAS Builder — Google Sheet inspection for the CRUD data-source wizard.
 * Runs as the BUILDER USER's own identity (executeAs USER_ACCESSING), so this
 * only ever reads spreadsheets the person configuring the app already has
 * access to — never a privileged/shared service account.
 */

var SheetInspect_ = {
  MAX_SHEETS: 25,

  /** { spreadsheetId } -> { name, sheets: [{ name, headers: [...] }] } */
  inspect: function (spreadsheetId) {
    if (!spreadsheetId || typeof spreadsheetId !== 'string') {
      throw NcError_('MISSING_FIELD', 'spreadsheetId is required.');
    }
    var ss;
    try {
      ss = SpreadsheetApp.openById(spreadsheetId.trim());
    } catch (e) {
      throw NcError_('SHEET_ACCESS',
        'Tidak bisa membuka spreadsheet ini. Pastikan ID benar dan akun Anda punya akses. Detail: ' + e.message);
    }

    var tabs = ss.getSheets().slice(0, this.MAX_SHEETS);
    var sheets = tabs.map(function (sheet) {
      var lastCol = sheet.getLastColumn();
      var headers = lastCol > 0
        ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(function (h) { return h !== ''; })
        : [];
      return { name: sheet.getName(), headers: headers, rowCount: Math.max(0, sheet.getLastRow() - 1) };
    });

    return { name: ss.getName(), spreadsheetId: spreadsheetId.trim(), sheets: sheets };
  }
};
