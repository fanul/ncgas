/**
 * Editor-side component registry: palette metadata, per-type defaults and
 * inspector field specs. The RENDERING for each type lives in
 * shared/runtime-core.js — adding a new component type means touching both
 * files (registry entry here, renderer there).
 *
 * Inspector field kinds: text | number | boolean | select | textarea |
 * expression (validated live) | json (parsed live) | options | columns
 */

export const REGISTRY = {
  HEADING: {
    label: 'Heading', icon: 'H', category: 'Display',
    defaults: { properties: { text: 'Judul Baru', level: 2 }, layoutGrid: { xs: 12, md: 12 } },
    fields: [
      { path: 'properties.text', label: 'Text', kind: 'text' },
      { path: 'properties.level', label: 'Level (1-4)', kind: 'number' },
      { path: 'properties.textExpression', label: 'Text expression (overrides)', kind: 'expression' }
    ],
    events: []
  },
  TEXT: {
    label: 'Text', icon: '¶', category: 'Display',
    defaults: { properties: { text: 'Paragraf teks…' }, layoutGrid: { xs: 12, md: 12 } },
    fields: [
      { path: 'properties.text', label: 'Text', kind: 'textarea' },
      { path: 'properties.textExpression', label: 'Text expression (overrides)', kind: 'expression' }
    ],
    events: []
  },
  KPI_CARD: {
    label: 'KPI Card', icon: '▣', category: 'Display',
    defaults: { properties: { label: 'Total', valueExpression: '0' }, layoutGrid: { xs: 12, md: 3 } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.valueExpression', label: 'Value expression', kind: 'expression' }
    ],
    events: ['onLoad']
  },
  DIVIDER: {
    label: 'Divider', icon: '—', category: 'Display',
    defaults: { properties: {}, layoutGrid: { xs: 12, md: 12 } },
    fields: [],
    events: []
  },
  FORM_INPUT_TEXT: {
    label: 'Text Input', icon: 'ab', category: 'Form',
    defaults: { properties: { label: 'Label', placeholder: '', defaultValue: '' }, layoutGrid: { xs: 12, md: 6 } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.placeholder', label: 'Placeholder', kind: 'text' },
      { path: 'properties.defaultValue', label: 'Default value', kind: 'text' }
    ],
    events: ['onChange', 'onBlur']
  },
  FORM_INPUT_NUMBER: {
    label: 'Number Input', icon: '12', category: 'Form',
    defaults: { properties: { label: 'Angka', placeholder: '', defaultValue: 0 }, layoutGrid: { xs: 12, md: 6 } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.placeholder', label: 'Placeholder', kind: 'text' },
      { path: 'properties.defaultValue', label: 'Default value', kind: 'number' }
    ],
    events: ['onChange', 'onBlur']
  },
  FORM_INPUT_DATE: {
    label: 'Date Input', icon: '📅', category: 'Form',
    defaults: { properties: { label: 'Tanggal' }, layoutGrid: { xs: 12, md: 6 } },
    fields: [{ path: 'properties.label', label: 'Label', kind: 'text' }],
    events: ['onChange', 'onBlur']
  },
  FORM_SELECT: {
    label: 'Select', icon: '▾', category: 'Form',
    defaults: {
      properties: { label: 'Pilihan', placeholder: 'Pilih...', options: [{ label: 'Opsi A', value: 'A' }] },
      layoutGrid: { xs: 12, md: 6 }
    },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.placeholder', label: 'Placeholder', kind: 'text' },
      { path: 'properties.options', label: 'Options', kind: 'options' },
      { path: 'properties.optionsExpression', label: 'Options expression (overrides)', kind: 'expression' }
    ],
    events: ['onChange']
  },
  FORM_CHECKBOX: {
    label: 'Checkbox', icon: '☑', category: 'Form',
    defaults: { properties: { label: 'Setuju', defaultValue: false }, layoutGrid: { xs: 12, md: 6 } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.defaultValue', label: 'Checked by default', kind: 'boolean' }
    ],
    events: ['onChange']
  },
  BUTTON: {
    label: 'Button', icon: '⏺', category: 'Action',
    defaults: { properties: { label: 'Submit', variant: 'primary' }, layoutGrid: { xs: 12, md: 3 } },
    fields: [
      { path: 'properties.label', label: 'Label', kind: 'text' },
      { path: 'properties.variant', label: 'Variant', kind: 'select', options: ['primary', 'secondary'] }
    ],
    events: ['onClick']
  },
  DATA_TABLE: {
    label: 'Data Table', icon: '▦', category: 'Data',
    defaults: {
      properties: { title: 'Data', columns: [], rowsExpression: '', emptyText: 'Belum ada data' },
      layoutGrid: { xs: 12, md: 12 }
    },
    fields: [
      { path: 'properties.title', label: 'Title', kind: 'text' },
      { path: 'properties.rowsExpression', label: 'Rows expression (array)', kind: 'expression' },
      { path: 'properties.columns', label: 'Columns (empty = auto)', kind: 'columns' },
      { path: 'properties.emptyText', label: 'Empty text', kind: 'text' }
    ],
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
