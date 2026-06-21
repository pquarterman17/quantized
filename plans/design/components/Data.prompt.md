One-sentence: data-display primitives for the Inspector and workspace — `Card`, `MetaRow`, `Badge`, `StatusDot`, `DataTable`.

```jsx
<Card title="Scan metadata" count={6}>
  <MetaRow label="instrument" value="PPMS DynaCool" />
  <MetaRow label="temp" value="4.20 K" />
</Card>
<Badge tone="accent">3 selected</Badge>
<StatusDot tone="ok" label="backend connected" />
<DataTable columns={["peak","center","FWHM","area"]} rows={[["1","38.41","0.214","1203"]]} />
```

- `Card` is a native `<details>` — collapsible, keyboard-accessible, uppercase tracked title.
- `MetaRow` / `DataTable` values are monospace so numbers align; labels are faint.
- `StatusDot` and `Badge` are used sparingly — a single dot or one word, never decorative.
