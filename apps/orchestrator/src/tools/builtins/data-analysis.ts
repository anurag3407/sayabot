import { z } from "zod"
import type { ToolSpec } from "../audited"

export interface DataAnalysisOptions {
  orgId: string
  agentId: string
  roomId: string
}

export type ChartType = "bar" | "line" | "area" | "pie" | "scatter" | "histogram"

export interface ColumnSummary {
  name: string
  type: "number" | "string" | "boolean" | "date"
  totalCount: number
  nullCount: number
  // Numerical fields
  min?: number
  max?: number
  mean?: number
  median?: number
  sum?: number
  // Categorical fields
  uniqueCount?: number
  topValues?: Array<{ value: string; count: number }>
}

export interface DatasetAnalysisResult {
  rowCount: number
  columnCount: number
  columns: ColumnSummary[]
  sample: Record<string, unknown>[]
  aggregations?: Record<string, unknown>
}

/**
 * Parses raw tabular input (Array of objects or CSV string) into standard JSON records.
 */
export function parseTabularData(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
  }

  if (typeof input === "string") {
    const trimmed = input.trim()
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        }
      } catch {}
    }

    // Parse simple CSV
    const lines = trimmed.split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) return []

    const headerLine = lines[0]
    if (!headerLine) return []
    const headers = headerLine.split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""))

    const rows: Record<string, unknown>[] = []
    for (let i = 1; i < lines.length; i++) {
      const currentLine = lines[i]
      if (!currentLine) continue
      const values = currentLine.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""))
      const row: Record<string, unknown> = {}
      for (let j = 0; j < headers.length; j++) {
        const h = headers[j]
        if (!h) continue
        const rawVal = values[j] ?? ""
        const numVal = Number(rawVal)
        row[h] = !isNaN(numVal) && rawVal.trim() !== "" ? numVal : rawVal
      }
      rows.push(row)
    }
    return rows
  }

  return []
}

/**
 * Analyzes tabular records, generating statistical column summaries.
 */
export function analyzeRecords(
  rows: Record<string, unknown>[],
  options?: {
    groupBy?: string
    aggregateField?: string
    aggregateOp?: "sum" | "mean" | "count" | "min" | "max"
  },
): DatasetAnalysisResult {
  if (rows.length === 0) {
    return { rowCount: 0, columnCount: 0, columns: [], sample: [] }
  }

  const columnNames = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  const columns: ColumnSummary[] = []

  for (const col of columnNames) {
    let nullCount = 0
    const numbers: number[] = []
    const strings: string[] = []

    for (const row of rows) {
      const val = row[col]
      if (val === null || val === undefined || val === "") {
        nullCount++
      } else if (typeof val === "number" && !isNaN(val)) {
        numbers.push(val)
      } else {
        strings.push(String(val))
      }
    }

    const isNumeric = numbers.length > 0 && strings.length === 0
    if (isNumeric) {
      numbers.sort((a, b) => a - b)
      const sum = numbers.reduce((a, b) => a + b, 0)
      const mean = numbers.length > 0 ? sum / numbers.length : 0
      const mid = Math.floor(numbers.length / 2)
      const median =
        numbers.length % 2 === 0
          ? ((numbers[mid - 1] ?? 0) + (numbers[mid] ?? 0)) / 2
          : (numbers[mid] ?? 0)

      columns.push({
        name: col,
        type: "number",
        totalCount: rows.length,
        nullCount,
        min: numbers[0],
        max: numbers[numbers.length - 1],
        mean: Math.round(mean * 1000) / 1000,
        median: Math.round(median * 1000) / 1000,
        sum: Math.round(sum * 1000) / 1000,
      })
    } else {
      const freqMap = new Map<string, number>()
      for (const s of strings) {
        freqMap.set(s, (freqMap.get(s) || 0) + 1)
      }
      const sortedFreq = Array.from(freqMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }))

      columns.push({
        name: col,
        type: "string",
        totalCount: rows.length,
        nullCount,
        uniqueCount: freqMap.size,
        topValues: sortedFreq,
      })
    }
  }

  let aggregations: Record<string, unknown> | undefined
  if (options?.groupBy && options.aggregateField) {
    const groupMap = new Map<string, number[]>()
    for (const r of rows) {
      const grp = String(r[options.groupBy] ?? "Unknown")
      const val = Number(r[options.aggregateField])
      if (!isNaN(val)) {
        if (!groupMap.has(grp)) groupMap.set(grp, [])
        groupMap.get(grp)!.push(val)
      }
    }

    const aggResults: Record<string, number> = {}
    const op = options.aggregateOp || "sum"
    for (const [grp, vals] of groupMap.entries()) {
      if (op === "sum") {
        aggResults[grp] = vals.reduce((a, b) => a + b, 0)
      } else if (op === "mean") {
        aggResults[grp] = vals.reduce((a, b) => a + b, 0) / vals.length
      } else if (op === "count") {
        aggResults[grp] = vals.length
      } else if (op === "min") {
        aggResults[grp] = Math.min(...vals)
      } else if (op === "max") {
        aggResults[grp] = Math.max(...vals)
      }
    }
    aggregations = {
      groupBy: options.groupBy,
      aggregateField: options.aggregateField,
      operation: op,
      results: aggResults,
    }
  }

  return {
    rowCount: rows.length,
    columnCount: columnNames.length,
    columns,
    sample: rows.slice(0, 5),
    aggregations,
  }
}

/**
 * Generates standard Vega-Lite v5 JSON specification from dataset.
 */
export function compileVegaLiteSpec(args: {
  title: string
  chartType: ChartType
  data: Record<string, unknown>[]
  xField: string
  yField: string
  colorField?: string
  description?: string
}): Record<string, unknown> {
  const { title, chartType, data, xField, yField, colorField, description } = args

  let mark: string | Record<string, unknown> = chartType
  if (chartType === "pie") {
    mark = { type: "arc", innerRadius: 0 }
  } else if (chartType === "histogram") {
    mark = "bar"
  }

  const encoding: Record<string, unknown> = {}

  if (chartType === "pie") {
    encoding.theta = { field: yField, type: "quantitative" }
    encoding.color = { field: xField, type: "nominal" }
  } else if (chartType === "histogram") {
    encoding.x = { field: xField, bin: true, type: "quantitative" }
    encoding.y = { aggregate: "count", type: "quantitative" }
  } else {
    encoding.x = { field: xField, type: "nominal", title: xField }
    encoding.y = { field: yField, type: "quantitative", title: yField }
    if (colorField) {
      encoding.color = { field: colorField, type: "nominal" }
    }
  }

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: {
      text: title,
      subtitle: description,
    },
    data: { values: data },
    mark,
    encoding,
    width: "container",
    height: 320,
    config: {
      view: { stroke: "transparent" },
      axis: { gridColor: "#e5e7eb", domainColor: "#9ca3af" },
    },
  }
}

export function dataAnalysisTools(_opts: DataAnalysisOptions): ToolSpec[] {
  const dataAnalyzeTool: ToolSpec = {
    name: "data_analyze",
    description:
      "Perform statistical analysis on tabular data (JSON array or CSV). Computes column metrics (min, max, mean, median, nulls, frequencies) and optional group-by aggregations.",
    schema: z.object({
      data: z
        .union([z.array(z.record(z.string(), z.unknown())), z.string()])
        .describe("Dataset to analyze: either JSON array of objects or raw CSV string"),
      group_by: z.string().optional().describe("Optional column name to group by"),
      aggregate_field: z
        .string()
        .optional()
        .describe("Numerical column name to aggregate when grouping"),
      aggregate_op: z
        .enum(["sum", "mean", "count", "min", "max"])
        .optional()
        .default("sum")
        .describe("Aggregation operation to apply"),
    }),
    dangerous: false,
    execute: async (input: {
      data: unknown
      group_by?: string
      aggregate_field?: string
      aggregate_op?: "sum" | "mean" | "count" | "min" | "max"
    }) => {
      const records = parseTabularData(input.data)
      if (records.length === 0) {
        return { ok: false, error: "No valid rows could be parsed from the provided dataset." }
      }

      const analysis = analyzeRecords(records, {
        groupBy: input.group_by,
        aggregateField: input.aggregate_field,
        aggregateOp: input.aggregate_op,
      })

      return {
        ok: true,
        summary: `Analyzed dataset with ${analysis.rowCount} rows across ${analysis.columnCount} columns.`,
        ...analysis,
      }
    },
  }

  const compileChartTool: ToolSpec = {
    name: "compile_chart",
    description:
      "Compile dataset records into an interactive Vega-Lite chart specification for rendering rich visual graphs (bar, line, area, pie, scatter, histogram).",
    schema: z.object({
      title: z.string().min(1).describe("Descriptive chart title"),
      chart_type: z
        .enum(["bar", "line", "area", "pie", "scatter", "histogram"])
        .describe("Visualization type"),
      data: z
        .union([z.array(z.record(z.string(), z.unknown())), z.string()])
        .describe("Dataset to visualize: either JSON array or CSV string"),
      x_field: z.string().min(1).describe("Field to map on the X-axis (or category for pie charts)"),
      y_field: z
        .string()
        .min(1)
        .describe("Field to map on the Y-axis (or numeric value for pie charts)"),
      color_field: z.string().optional().describe("Optional field for category coloring / series"),
      description: z.string().optional().describe("Chart subtitle or key takeaway"),
    }),
    dangerous: false,
    execute: async (input: {
      title: string
      chart_type: ChartType
      data: unknown
      x_field: string
      y_field: string
      color_field?: string
      description?: string
    }) => {
      const records = parseTabularData(input.data)
      if (records.length === 0) {
        return { ok: false, error: "No valid data rows found to generate chart." }
      }

      const spec = compileVegaLiteSpec({
        title: input.title,
        chartType: input.chart_type,
        data: records,
        xField: input.x_field,
        yField: input.y_field,
        colorField: input.color_field,
        description: input.description,
      })

      return {
        ok: true,
        chart_title: input.title,
        chart_type: input.chart_type,
        records_plotted: records.length,
        vega_lite_spec: spec,
        recharts_config: {
          type: input.chart_type,
          xKey: input.x_field,
          yKey: input.y_field,
          colorKey: input.color_field,
          data: records.slice(0, 100),
        },
      }
    },
  }

  return [dataAnalyzeTool, compileChartTool]
}
