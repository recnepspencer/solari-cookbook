import type { BenchmarkRejection, BenchmarkRejectionCategory, BenchmarkRejectionCode } from "./contract.js"

export function addBenchmarkRejection(
  target: BenchmarkRejection[],
  category: BenchmarkRejectionCategory,
  code: BenchmarkRejectionCode,
  path: string,
  message: string,
): void {
  target.push({ category, code, path, message })
}
