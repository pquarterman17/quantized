One-sentence: token-driven action buttons and toggles for the Quantized desktop UI — `Button`, `IconButton`, `SegmentedControl`, `Pill`.

```jsx
<Button variant="primary" onClick={runFit}>Fit</Button>
<Button variant="ghost" icon="↻">Reset</Button>
<IconButton title="Zoom to fit" active>⤢</IconButton>
<SegmentedControl options={["Linear", "Log"]} value={scale} onChange={setScale} />
<Pill active onClick={toggleXrd}>XRD</Pill>
```

- `Button` variants: `default` · `primary` (accent) · `ghost` · `danger` (red on hover); `size="sm"` for inline 22px rows.
- All cursors are `default` (desktop tool, not a web page). Buttons are 28px tall at regular density, scaling with `--row-h`.
- `SegmentedControl` is for 2–4 short options; reach for a `Select` past that.
