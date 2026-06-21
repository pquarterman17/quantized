One-sentence: form controls for the Inspector and dialogs — `NumberField`, `Select`, `Checkbox`, `Switch`, `SliderRow`.

```jsx
<NumberField value={hc} onChange={setHc} unit="Oe" width={84} />
<Select options={["pseudo-Voigt","Lorentzian","Pearson VII"]} value={model} onChange={setModel} />
<Checkbox checked={subtractBg} onChange={setSubtractBg}>Subtract background</Checkbox>
<Switch label="Grid lines" checked={grid} onChange={setGrid} />
<SliderRow label="γ" value={gamma} min={0.2} max={3} step={0.05} onChange={setGamma} format={v=>v.toFixed(2)} />
```

- `NumberField` is monospace + right-aligned by default so scientific values align in a column; pass `numeric={false}` for free text.
- `Switch` is for instant-apply on/off; `Checkbox` for form-style multi-select.
- All inputs are `--row-h` tall and focus to an accent border.
