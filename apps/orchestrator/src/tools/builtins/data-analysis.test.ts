import { describe, expect, it } from "vitest"
import {
  analyzeRecords,
  compileVegaLiteSpec,
  dataAnalysisTools,
  parseTabularData,
} from "./data-analysis"

describe("data-analysis tools", () => {
  const tools = dataAnalysisTools({
    orgId: "org-1",
    agentId: "agent-1",
    roomId: "room-1",
  })
  const analyzeTool = tools.find((t) => t.name === "data_analyze")!
  const chartTool = tools.find((t) => t.name === "compile_chart")!

  it("parses CSV and JSON tabular data accurately", () => {
    const csv = `product,revenue,units\nWidget A,1200,10\nWidget B,2500,20\nWidget C,800,8`
    const records = parseTabularData(csv)
    expect(records).toHaveLength(3)
    expect(records[0]).toEqual({ product: "Widget A", revenue: 1200, units: 10 })
    expect(records[1]?.revenue).toBe(2500)

    const json = JSON.stringify([{ a: 1 }, { a: 2 }])
    expect(parseTabularData(json)).toHaveLength(2)
  })

  it("computes accurate column statistics and group-by aggregations", () => {
    const data = [
      { dept: "Engineering", salary: 100000 },
      { dept: "Engineering", salary: 120000 },
      { dept: "Marketing", salary: 80000 },
    ]
    const analysis = analyzeRecords(data, {
      groupBy: "dept",
      aggregateField: "salary",
      aggregateOp: "mean",
    })

    expect(analysis.rowCount).toBe(3)
    expect(analysis.columnCount).toBe(2)

    const salaryCol = analysis.columns.find((c) => c.name === "salary")!
    expect(salaryCol.min).toBe(80000)
    expect(salaryCol.max).toBe(120000)
    expect(salaryCol.mean).toBe(100000)

    expect(analysis.aggregations?.results).toEqual({
      Engineering: 110000,
      Marketing: 80000,
    })
  })

  it("compiles standard Vega-Lite v5 specification", () => {
    const data = [
      { month: "Jan", sales: 100 },
      { month: "Feb", sales: 150 },
    ]
    const spec = compileVegaLiteSpec({
      title: "Monthly Sales",
      chartType: "bar",
      data,
      xField: "month",
      yField: "sales",
      description: "Q1 sales growth",
    })

    expect(spec.$schema).toContain("vega-lite/v5.json")
    expect(spec.title).toEqual({ text: "Monthly Sales", subtitle: "Q1 sales growth" })
    expect(spec.mark).toBe("bar")
    expect((spec.encoding as any).x.field).toBe("month")
    expect((spec.encoding as any).y.field).toBe("sales")
  })

  it("executes data_analyze tool correctly", async () => {
    const res = (await analyzeTool.execute({
      data: [
        { category: "A", val: 10 },
        { category: "B", val: 20 },
      ],
      group_by: "category",
      aggregate_field: "val",
      aggregate_op: "sum",
    })) as any

    expect(res.ok).toBe(true)
    expect(res.rowCount).toBe(2)
    expect(res.aggregations.results).toEqual({ A: 10, B: 20 })
  })

  it("executes compile_chart tool correctly", async () => {
    const res = (await chartTool.execute({
      title: "Category Breakdown",
      chart_type: "pie",
      data: [
        { category: "A", val: 10 },
        { category: "B", val: 20 },
      ],
      x_field: "category",
      y_field: "val",
    })) as any

    expect(res.ok).toBe(true)
    expect(res.chart_type).toBe("pie")
    expect(res.vega_lite_spec.mark).toEqual({ type: "arc", innerRadius: 0 })
  })
})
