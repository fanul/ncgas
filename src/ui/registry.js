/**
 * Editor-side component registry: palette metadata, per-type defaults and
 * inspector field specs. The RENDERING for each type lives in
 * shared/runtime-core.js — adding a new component type means touching both
 * files (registry entry here, renderer there).
 *
 * `defaultColSpan` is the preferred width (out of 12) used when a component
 * is first placed; actual row/col placement is computed by the engine
 * (useNoCodeEngine.js) at add/move/paste time, not baked in here.
 *
 * Inspector field kinds: text | number | boolean | select | textarea |
 * expression (validated live) | json (parsed live) | options | columns
 */

export const REGISTRY = {
  HEADING: {
    label: 'Heading', icon: 'H', category: 'Display', defaultColSpan: 12,
    defaults: { properties: { text: 'Judul Baru', level: 2 } },
    fields: [
      { path: 'properties.text', label: 'Text', kind: 'text' },
      { path: 'properties.level', label: 'Level (1-4)', kind: 'number' },
      { path: 'properties.textExpression', label: 'Text expression (overrides)', kind: 'expression' }
    ],
    events: []
  },
  TEXT: {
    label: 'Text', icon: '¶', category: 'Display', defaultColSpan: 12,
    defaults: { properties: { text: 'Paragraf teks…' } },
    fields: [
      { path: 'properties.text', label: 'Text', kind: 'textarea' },
      { path: 'properties.textExpression', label: 'Text expression (overrides)', kind: 'expression' }
    ],
    events: []
  },
  KPI_CARD: {
    label: 'KPI Card', icon: '▣', category: 'Display', defaultColSpan: 4,
    defaults: { properties: { label: 'Total', valueExpression: '0' } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.valueExpression', label: 'Value expression', kind: 'expression' }
    ],
    events: ['onLoad']
  },
  CHART: {
    label: 'Chart', icon: '📊', category: 'Display', defaultColSpan: 6,
    defaults: {
      properties: {
        title: 'Grafik', chartType: 'bar',
        labelsExpression: "pluck(groupBySum(state.cart, 'product', 'total'), 'key')",
        valuesExpression: "pluck(groupBySum(state.cart, 'product', 'total'), 'total')"
      }
    },
    fields: [
      { path: 'properties.title', label: 'Judul', kind: 'text' },
      { path: 'properties.chartType', label: 'Tipe', kind: 'select', options: ['bar', 'line', 'pie', 'doughnut'] },
      { path: 'properties.labelsExpression', label: 'Labels expression (array)', kind: 'expression' },
      { path: 'properties.valuesExpression', label: 'Values expression (array, sejajar dengan labels)', kind: 'expression' }
    ],
    events: ['onLoad']
  },
  DIVIDER: {
    label: 'Divider', icon: '—', category: 'Display', defaultColSpan: 12,
    defaults: { properties: {} },
    fields: [],
    events: []
  },
  FORM_INPUT_TEXT: {
    label: 'Text Input', icon: 'ab', category: 'Form', defaultColSpan: 6,
    defaults: { properties: { label: 'Label', placeholder: '', defaultValue: '' } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.placeholder', label: 'Placeholder', kind: 'text' },
      { path: 'properties.defaultValue', label: 'Default value', kind: 'text' }
    ],
    events: ['onChange', 'onBlur']
  },
  FORM_INPUT_NUMBER: {
    label: 'Number Input', icon: '12', category: 'Form', defaultColSpan: 6,
    defaults: { properties: { label: 'Angka', placeholder: '', defaultValue: 0 } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.placeholder', label: 'Placeholder', kind: 'text' },
      { path: 'properties.defaultValue', label: 'Default value', kind: 'number' }
    ],
    events: ['onChange', 'onBlur']
  },
  FORM_INPUT_DATE: {
    label: 'Date Input', icon: '📅', category: 'Form', defaultColSpan: 6,
    defaults: { properties: { label: 'Tanggal' } },
    fields: [{ path: 'properties.label', label: 'Label', kind: 'text' }],
    events: ['onChange', 'onBlur']
  },
  FORM_IMAGE_UPLOAD: {
    label: 'Image Upload', icon: '🖼', category: 'Form', defaultColSpan: 6,
    defaults: { properties: { label: 'Foto', uploadService: '', maxSizeMB: 5 } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.uploadService', label: 'ID service DRIVE_UPLOAD', kind: 'text' },
      { path: 'properties.maxSizeMB', label: 'Ukuran maksimum (MB)', kind: 'number' }
    ],
    events: ['onChange']
  },
  FORM_SELECT: {
    label: 'Select', icon: '▾', category: 'Form', defaultColSpan: 6,
    defaults: { properties: { label: 'Pilihan', placeholder: 'Pilih...', options: [{ label: 'Opsi A', value: 'A' }], searchable: false, dependsOn: '' } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.placeholder', label: 'Placeholder', kind: 'text' },
      { path: 'properties.options', label: 'Options', kind: 'options' },
      { path: 'properties.optionsExpression', label: 'Options expression — cth. pluck(whereEquals(state.kota, \'provinsi_id\', comp_provinsi.value), \'nama\')', kind: 'expression' },
      { path: 'properties.searchable', label: 'Bisa dicari (ketik untuk memfilter)', kind: 'boolean' },
      { path: 'properties.dependsOn', label: 'Tergantung pada component ID (kosongkan jika tidak ada)', kind: 'text' }
    ],
    events: ['onChange']
  },
  FORM_CHECKBOX: {
    label: 'Checkbox', icon: '☑', category: 'Form', defaultColSpan: 6,
    defaults: { properties: { label: 'Setuju', defaultValue: false } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.defaultValue', label: 'Checked by default', kind: 'boolean' }
    ],
    events: ['onChange']
  },
  BUTTON: {
    label: 'Button', icon: '⏺', category: 'Action', defaultColSpan: 3,
    defaults: { properties: { label: 'Submit', variant: 'primary' } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.variant', label: 'Variant', kind: 'select', options: ['primary', 'secondary'] }
    ],
    events: ['onClick']
  },
  PRINT_BUTTON: {
    label: 'Print Button', icon: '🖨', category: 'Action', defaultColSpan: 3,
    defaults: {
      properties: {
        label: '🖨 Cetak Struk',
        title: 'Struk Pembelian',
        htmlTemplate: '<h3>{{coalesce(user.email, \'\')}}</h3><p>{{now()}}</p>{{items_table}}<p><b>Total: {{formatIDR(0)}}</b></p>',
        itemsExpression: '',
        itemColumns: [],
        pdfExportService: ''
      }
    },
    fields: [
      { path: 'properties.label', label: 'Label tombol', kind: 'text' },
      { path: 'properties.title', label: 'Judul struk', kind: 'text' },
      { path: 'properties.htmlTemplate', label: 'Template HTML — {{expression}} dievaluasi & di-escape; {{items_table}} = daftar item', kind: 'textarea' },
      { path: 'properties.itemsExpression', label: 'Items expression (array, opsional — untuk {{items_table}})', kind: 'expression' },
      { path: 'properties.itemColumns', label: 'Kolom item (kosong = otomatis dari data)', kind: 'columns' },
      { path: 'properties.pdfExportService', label: 'ID service PDF_EXPORT (opsional, untuk "Simpan PDF")', kind: 'text' }
    ],
    events: []
  },
  DATA_TABLE: {
    label: 'Data Table', icon: '▦', category: 'Data', defaultColSpan: 12,
    defaults: { properties: { title: 'Data', columns: [], rowsExpression: '', emptyText: 'Belum ada data' } },
    fields: [
      { path: 'properties.title', label: 'Title', kind: 'text' },
      { path: 'properties.rowsExpression', label: 'Rows expression (array)', kind: 'expression' },
      { path: 'properties.columns', label: 'Columns (empty = auto)', kind: 'columns' },
      { path: 'properties.emptyText', label: 'Empty text', kind: 'text' }
    ],
    events: ['onLoad']
  },
  CRUD_TABLE: {
    label: 'CRUD Table', icon: '⇄', category: 'Data', defaultColSpan: 12, custom: 'crud',
    defaults: {
      properties: {
        title: 'Data',
        dataSource: 'sheet',       // 'expression' | 'sheet'
        rowsExpression: '',
        spreadsheetId: '', sheet: '', keyColumn: '',
        serviceRead: '', serviceCreate: '', serviceUpdate: '', serviceDelete: '',
        columns: [],
        filters: [],
        searchable: true,
        allowAdd: true, allowEdit: true, allowDelete: true,
        emptyText: 'Belum ada data',
        relatedTo: null
      }
    },
    fields: [], // custom Inspector UI — see CrudWizard.vue
    events: ['onLoad']
  }
};

export const CATEGORIES = ['Display', 'Form', 'Action', 'Data'];

export function paletteByCategory() {
  return CATEGORIES.map((cat) => ({
    category: cat,
    items: Object.entries(REGISTRY)
      .filter(([, def]) => def.category === cat)
      .map(([type, def]) => ({ type, ...def }))
  }));
}
