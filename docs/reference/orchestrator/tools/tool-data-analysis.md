# Data Analysis & Vega-Lite Chart Compiler Tools

> Reference guide for `data_analyze` and `compile_chart` tools in the Sayabot orchestrator.

## Overview

The data analysis tools enable Sayabot agents to process tabular data (CSV or JSON arrays), compute statistical column metrics, perform group-by aggregations, and compile Vega-Lite v5 visualization specifications.

---

## 1. `data_analyze`

Performs statistical analysis across numerical and categorical columns.

### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `data` | `string \| object[]` | Yes | Tabular data as raw CSV string or JSON array of objects |
| `group_by` | `string` | No | Column name to group records by |
| `aggregate_field` | `string` | No | Target numerical column to aggregate when grouping |
| `aggregate_op` | `sum \| mean \| count \| min \| max` | No | Aggregation function (default: `sum`) |

### Output

```json
{
  "ok": true,
  "rowCount": 150,
  "columnCount": 4,
  "columns": [
    {
      "name": "revenue",
      "type": "number",
      "min": 120,
      "max": 9500,
      "mean": 2450.5,
      "median": 2100,
      "sum": 367575
    }
  ],
  "aggregations": {
    "groupBy": "region",
    "aggregateField": "revenue",
    "operation": "sum",
    "results": {
      "North America": 180000,
      "Europe": 125000,
      "Asia": 62575
    }
  }
}
```

---

## 2. `compile_chart`

Compiles tabular datasets into standard Vega-Lite v5 visual graph specifications.

### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `title` | `string` | Yes | Title of the chart |
| `chart_type` | `bar \| line \| area \| pie \| scatter \| histogram` | Yes | Visual graph format |
| `data` | `string \| object[]` | Yes | Data points to plot |
| `x_field` | `string` | Yes | Field for X-axis / categories |
| `y_field` | `string` | Yes | Field for Y-axis / values |
| `color_field` | `string` | No | Series / category color dimension |
| `description` | `string` | No | Subtitle or key takeaway |

### Safety & Approval

- **Dangerous Flag**: `false` (Deterministic data analysis and chart specification generation produces no external side effects).
