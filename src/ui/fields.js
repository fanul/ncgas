/**
 * Small controlled field components for the Inspector, written as render
 * functions. All emit `update:modelValue`. FieldExpression validates through
 * the real engine on every keystroke; FieldJson round-trips JSON safely.
 */
import { h, ref, watch, defineComponent } from 'vue';
import { Expression } from '../engine.js';

function baseInput(props, emit, type, cast) {
  return h('input', {
    class: 'ed-input',
    type,
    value: props.modelValue ?? '',
    placeholder: props.placeholder || '',
    onInput: (e) => emit('update:modelValue', cast ? cast(e.target.value) : e.target.value)
  });
}

export const FieldText = defineComponent({
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  setup: (props, { emit }) => () => baseInput(props, emit, 'text', null)
});

export const FieldNumber = defineComponent({
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  setup: (props, { emit }) => () => baseInput(props, emit, 'number', (v) => (v === '' ? null : Number(v)))
});

export const FieldBoolean = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup: (props, { emit }) => () =>
    h('label', { class: 'ed-switch' }, [
      h('input', {
        type: 'checkbox',
        checked: !!props.modelValue,
        onChange: (e) => emit('update:modelValue', e.target.checked)
      }),
      h('span', props.modelValue ? 'Ya' : 'Tidak')
    ])
});

export const FieldSelect = defineComponent({
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  setup: (props, { emit }) => () =>
    h('select', {
      class: 'ed-input',
      value: props.modelValue ?? '',
      onChange: (e) => emit('update:modelValue', e.target.value)
    }, (props.options || []).map((opt) => {
      const val = typeof opt === 'object' ? opt.value : opt;
      const label = typeof opt === 'object' ? opt.label : opt;
      return h('option', { value: val }, String(label));
    }))
});

export const FieldTextarea = defineComponent({
  props: ['modelValue', 'placeholder', 'rows'],
  emits: ['update:modelValue'],
  setup: (props, { emit }) => () =>
    h('textarea', {
      class: 'ed-input ed-textarea',
      rows: props.rows || 3,
      value: props.modelValue ?? '',
      placeholder: props.placeholder || '',
      onInput: (e) => emit('update:modelValue', e.target.value)
    })
});

/** Expression input with live syntax validation dot + message. */
export const FieldExpression = defineComponent({
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => {
      const value = props.modelValue ?? '';
      const check = value.trim() ? Expression.validate(value) : null;
      return h('div', { class: 'ed-expr' }, [
        h('div', { class: 'ed-expr-row' }, [
          h('span', {
            class: 'ed-expr-dot ' + (check === null ? 'is-empty' : check.ok ? 'is-ok' : 'is-bad'),
            title: check === null ? 'kosong' : check.ok ? 'expression valid' : check.error
          }),
          h('input', {
            class: 'ed-input ed-mono',
            type: 'text',
            value,
            placeholder: props.placeholder || "cth. user.role === 'Admin'",
            onInput: (e) => emit('update:modelValue', e.target.value)
          })
        ]),
        check && !check.ok ? h('div', { class: 'ed-expr-err' }, check.error) : null
      ]);
    };
  }
});

/** JSON textarea: emits parsed value only when valid; shows parse errors. */
export const FieldJson = defineComponent({
  props: ['modelValue', 'rows'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const text = ref(JSON.stringify(props.modelValue ?? null, null, 2));
    const error = ref('');
    watch(() => props.modelValue, (v) => {
      // resync only when external value diverges from our (valid) text
      try { if (JSON.stringify(JSON.parse(text.value)) === JSON.stringify(v)) return; } catch (e) { /* keep editing */ }
      text.value = JSON.stringify(v ?? null, null, 2);
    });
    return () =>
      h('div', [
        h('textarea', {
          class: 'ed-input ed-textarea ed-mono' + (error.value ? ' is-invalid' : ''),
          rows: props.rows || 6,
          value: text.value,
          onInput: (e) => {
            text.value = e.target.value;
            try {
              emit('update:modelValue', JSON.parse(e.target.value));
              error.value = '';
            } catch (err) {
              error.value = 'JSON belum valid: ' + err.message;
            }
          }
        }),
        error.value ? h('div', { class: 'ed-expr-err' }, error.value) : null
      ]);
  }
});

/** Editable list of {label, value} pairs (FORM_SELECT options). */
export const FieldOptions = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const update = (list) => emit('update:modelValue', list);
    return () => {
      const list = Array.isArray(props.modelValue) ? props.modelValue : [];
      return h('div', { class: 'ed-list' }, [
        ...list.map((opt, i) =>
          h('div', { class: 'ed-list-row', key: i }, [
            h('input', {
              class: 'ed-input', placeholder: 'label', value: opt.label ?? '',
              onInput: (e) => update(list.map((o, j) => (j === i ? { ...o, label: e.target.value } : o)))
            }),
            h('input', {
              class: 'ed-input', placeholder: 'value', value: opt.value ?? '',
              onInput: (e) => update(list.map((o, j) => (j === i ? { ...o, value: e.target.value } : o)))
            }),
            h('button', { class: 'ed-btn-icon', title: 'hapus', onClick: () => update(list.filter((_, j) => j !== i)) }, '✕')
          ])
        ),
        h('button', { class: 'ed-btn ed-btn-ghost', onClick: () => update([...list, { label: '', value: '' }]) }, '+ Opsi')
      ]);
    };
  }
});

/** Editable list of {key, label} pairs (DATA_TABLE columns). */
export const FieldColumns = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const update = (list) => emit('update:modelValue', list);
    return () => {
      const list = Array.isArray(props.modelValue) ? props.modelValue : [];
      return h('div', { class: 'ed-list' }, [
        ...list.map((col, i) =>
          h('div', { class: 'ed-list-row', key: i }, [
            h('input', {
              class: 'ed-input ed-mono', placeholder: 'key data', value: col.key ?? '',
              onInput: (e) => update(list.map((c, j) => (j === i ? { ...c, key: e.target.value } : c)))
            }),
            h('input', {
              class: 'ed-input', placeholder: 'judul kolom', value: col.label ?? '',
              onInput: (e) => update(list.map((c, j) => (j === i ? { ...c, label: e.target.value } : c)))
            }),
            h('button', { class: 'ed-btn-icon', title: 'hapus', onClick: () => update(list.filter((_, j) => j !== i)) }, '✕')
          ])
        ),
        h('button', { class: 'ed-btn ed-btn-ghost', onClick: () => update([...list, { key: '', label: '' }]) }, '+ Kolom')
      ]);
    };
  }
});

export const FIELD_KINDS = {
  text: FieldText,
  number: FieldNumber,
  boolean: FieldBoolean,
  select: FieldSelect,
  textarea: FieldTextarea,
  expression: FieldExpression,
  json: FieldJson,
  options: FieldOptions,
  columns: FieldColumns
};
