# Schema Change: Text Input Modes

**Date:** 2026-03-19
**Affects:** `textInput` form elements in `form_layout_config` arrays within step exports

## Summary

The `textInput` form element now supports six input modes that control what kind of data the field accepts at runtime. Two modes (`dropdown` and `combobox`) introduce list-based selection.

## New Fields on `textInput` Elements

### `inputMode` (optional string)

Controls the type of data this input accepts. **Defaults to `"text"` when absent** (backward compatible).

| Value        | Runtime Behavior                                                                  |
| ------------ | --------------------------------------------------------------------------------- |
| `"text"`     | Any free-form text (default, same as before)                                      |
| `"number"`   | Numeric input only. Allowed characters: `0-9 + - . ,`                             |
| `"phone"`    | Phone number input. Allowed characters: `0-9 + - ( ) <space>`                     |
| `"password"` | Text is masked (dots/asterisks) at runtime. Value stored as plain text in output. |
| `"dropdown"` | Read-only dropdown list. User must pick from available options.                   |
| `"combobox"` | Editable dropdown. User can pick from options OR type a custom value.             |

### `listItems` (optional array of `OptionEntry`)

Fixed list of selectable options for `dropdown` and `combobox` modes. **Ignored when `inputMode` is not `"dropdown"` or `"combobox"`.**

Each entry has the same structure as checkbox/radio options:

```json
{
  "label": "High", // Display text shown to the user
  "value": "high" // Value stored in the step output object under fieldName
}
```

Example:

```json
"listItems": [
  { "label": "High", "value": "high" },
  { "label": "Medium", "value": "medium" },
  { "label": "Low", "value": "low" }
]
```

### `listSource` (optional object)

Controls where list items come from for `dropdown`/`combobox` modes. **Ignored when `inputMode` is not `"dropdown"` or `"combobox"`.**

Two modes:

1. **Static** (default when absent or `listSource` is `{ "mode": "static" }`):
   Items come from the `listItems` array on this element.

2. **Input Parameter** (`{ "mode": "input", "value": "<paramName>" }`):
   Items are provided at runtime via the named step input parameter.
   The runtime should expect the parameter value to be a JSON string array (e.g., `["High", "Medium", "Low"]`).
   When using input mode, `listItems` may still be present but should be ignored at runtime.

## Backward Compatibility

- All new fields are optional. Existing `textInput` elements without these fields behave exactly as before (`inputMode` defaults to `"text"`).
- The `type` discriminant `"textInput"` is unchanged.
- The `fieldName`, `placeholder`, `required`, `outputParameter`, `defaultSource`, `placeholderSource`, and `fontSize` fields are unchanged.

## Runtime Implementation Notes

### For `number` mode:

- Restrict keyboard/input to: `0 1 2 3 4 5 6 7 8 9 + - . ,`
- Consider using `<input type="text" inputmode="decimal">` on mobile for appropriate keyboard
- Validate on submission that the value is numeric

### For `phone` mode:

- Restrict keyboard/input to: `0 1 2 3 4 5 6 7 8 9 + - ( ) <space>`
- Consider using `<input type="tel">` on mobile for phone keyboard
- Do NOT validate phone format — just restrict characters

### For `password` mode:

- Mask the display (use `<input type="password">` or equivalent)
- Store the actual typed value (not masked) in the output under `fieldName`

### For `dropdown` mode:

- Render as a native `<select>` or styled dropdown
- User cannot type custom values — must pick from available options
- If `listSource.mode === "input"`, populate options from the input parameter at runtime
- Otherwise use `listItems` array
- The selected option's `value` field is stored in the output under `fieldName`

### For `combobox` mode:

- Render as an editable text field with a dropdown suggestion list
- User can pick from available options OR type a custom value
- Same list source logic as `dropdown`
- The selected/typed value is stored in the output under `fieldName`

## Example Export (dropdown with fixed items)

```json
{
  "type": "textInput",
  "x": 20,
  "y": 100,
  "width": 300,
  "height": 60,
  "label": "Priority",
  "fieldName": "priority",
  "required": true,
  "inputMode": "dropdown",
  "listItems": [
    { "label": "High", "value": "high" },
    { "label": "Medium", "value": "medium" },
    { "label": "Low", "value": "low" }
  ],
  "listSource": { "mode": "static" }
}
```

## Example Export (combobox with input parameter)

```json
{
  "type": "textInput",
  "x": 20,
  "y": 100,
  "width": 300,
  "height": 60,
  "label": "Technician",
  "fieldName": "technician",
  "inputMode": "combobox",
  "listItems": [],
  "listSource": { "mode": "input", "value": "technicianList" }
}
```

## Example Export (number mode)

```json
{
  "type": "textInput",
  "x": 20,
  "y": 180,
  "width": 200,
  "height": 60,
  "label": "Temperature",
  "fieldName": "temperature",
  "placeholder": "0.0",
  "inputMode": "number",
  "required": true
}
```
