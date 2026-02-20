/**
 * DMMS AI — Middleware Pipeline
 * Koa-style middleware runner: each step calls next() to continue.
 */

/**
 * Create a composable middleware pipeline.
 * @param {Array<(ctx: object, next: () => Promise<void>) => Promise<void>>} steps
 * @returns {(ctx: object) => Promise<void>}
 */
export function createPipeline(steps) {
  return async function run(ctx) {
    let index = 0

    async function next() {
      if (index >= steps.length) return
      const step = steps[index++]
      try {
        await step(ctx, next)
      } catch (err) {
        console.error(`[Pipeline] Error in step ${index - 1}:`, err.message)
        throw err // Re-throw so the connector can handle it
      }
    }

    await next()
  }
}
